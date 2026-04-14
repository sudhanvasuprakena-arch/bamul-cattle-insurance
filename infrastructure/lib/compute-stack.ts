import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as autoscaling from 'aws-cdk-lib/aws-applicationautoscaling';
import { Construct } from 'constructs';
import { type NetworkingOutputs } from './networking-stack';
import { type DatabaseOutputs } from './database-stack';
import { type StorageOutputs } from './storage-stack';

export interface ComputeStackProps extends cdk.StackProps {
  readonly networking: NetworkingOutputs;
  readonly database: DatabaseOutputs;
  readonly storage: StorageOutputs;
}

/**
 * Compute outputs shared with MonitoringStack and IrdaiSlaStack.
 */
export interface ComputeOutputs {
  readonly cluster: ecs.Cluster;
  readonly appApiService: ecs.FargateService;
  readonly aiServiceService: ecs.FargateService;
  readonly embeddingQueue: sqs.Queue;
  readonly embeddingDlq: sqs.Queue;
  readonly matchQueue: sqs.Queue;
  readonly matchDlq: sqs.Queue;
  readonly appApiLogGroup: logs.LogGroup;
  readonly aiServiceLogGroup: logs.LogGroup;
}

/**
 * Compute Stack — ECS Fargate services, ALB targets, SQS queues, auto-scaling.
 *
 * Provisions:
 * - ECS Cluster with Container Insights enabled
 * - bamul-app-api Fargate service (1 vCPU / 2 GB):
 *   - Placed in private-app subnets behind Public ALB
 *   - Auto-scale: CPU > 60% → scale out; min 2, max 10 tasks
 * - bamul-ai-service Fargate service (2 vCPU / 4 GB):
 *   - Placed in private-app subnets behind Internal ALB
 *   - Auto-scale: embedding queue depth > 50 → scale out; min 2, max 20 tasks
 *   - Health check grace period: 120s (FAISS index cold-start)
 * - SQS queues: embedding and match (with DLQs, maxReceiveCount: 3)
 * - CloudWatch log groups for structured JSON logs
 *
 * Architecture ref: D16 (ECS Fargate), D21 (FAISS cold-start), D6 (service-to-service auth)
 */
export class ComputeStack extends cdk.Stack {
  public readonly outputs: ComputeOutputs;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const { networking, database, storage } = props;

    // ── CloudWatch Log Groups ─────────────────────────────────────────────────
    const appApiLogGroup = new logs.LogGroup(this, 'AppApiLogGroup', {
      logGroupName: '/bamul/app-api',
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const aiServiceLogGroup = new logs.LogGroup(this, 'AiServiceLogGroup', {
      logGroupName: '/bamul/ai-service',
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── SQS Queues ────────────────────────────────────────────────────────────

    const embeddingDlq = new sqs.Queue(this, 'EmbeddingDlq', {
      queueName: 'bamul-embedding-dlq',
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    const embeddingQueue = new sqs.Queue(this, 'EmbeddingQueue', {
      queueName: 'bamul-embedding-queue',
      visibilityTimeout: cdk.Duration.seconds(300),
      retentionPeriod: cdk.Duration.days(4),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: embeddingDlq,
        maxReceiveCount: 3,
      },
    });

    const matchDlq = new sqs.Queue(this, 'MatchDlq', {
      queueName: 'bamul-match-dlq',
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    const matchQueue = new sqs.Queue(this, 'MatchQueue', {
      queueName: 'bamul-match-queue',
      visibilityTimeout: cdk.Duration.seconds(300),
      retentionPeriod: cdk.Duration.days(4),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: matchDlq,
        maxReceiveCount: 3,
      },
    });

    // ── ECS Cluster ───────────────────────────────────────────────────────────
    const cluster = new ecs.Cluster(this, 'BamulCluster', {
      vpc: networking.vpc,
      containerInsights: true,
      clusterName: 'bamul',
    });

    // ── ECR Repository References ─────────────────────────────────────────────
    // Repositories created by CI/CD pipeline (Story 1.1); imported here by name
    const appApiRepo = ecr.Repository.fromRepositoryName(this, 'AppApiRepo', 'bamul/app-api');
    const aiServiceRepo = ecr.Repository.fromRepositoryName(this, 'AiServiceRepo', 'bamul/ai-service');

    // ── bamul-app-api Fargate Task Definition ─────────────────────────────────
    const appApiTaskDef = new ecs.FargateTaskDefinition(this, 'AppApiTaskDef', {
      cpu: 1024,         // 1 vCPU
      memoryLimitMiB: 2048, // 2 GB
      family: 'bamul-app-api',
    });

    // Grant task execution role access to secrets (obtainExecutionRole() eagerly creates the role)
    database.dbSecret.grantRead(appApiTaskDef.obtainExecutionRole());
    database.jwtSecret.grantRead(appApiTaskDef.obtainExecutionRole());
    database.internalServiceToken.grantRead(appApiTaskDef.obtainExecutionRole());

    // Grant task role access to S3 (photo upload/read) and SQS
    storage.photosBucket.grantReadWrite(appApiTaskDef.taskRole);
    embeddingQueue.grantSendMessages(appApiTaskDef.taskRole);
    matchQueue.grantSendMessages(appApiTaskDef.taskRole);

    const appApiContainer = appApiTaskDef.addContainer('AppApiContainer', {
      image: ecs.ContainerImage.fromEcrRepository(appApiRepo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'bamul-app-api',
        logGroup: appApiLogGroup,
      }),
      environment: {
        APP_ENV: this.node.tryGetContext('appEnv') as string | undefined ?? 'development',
        AWS_REGION: 'ap-south-1',
        AWS_S3_BUCKET_NAME: storage.photosBucket.bucketName,
        AWS_SQS_EMBEDDING_QUEUE_URL: embeddingQueue.queueUrl,
        AWS_SQS_MATCH_QUEUE_URL: matchQueue.queueUrl,
        AI_SERVICE_BASE_URL: `http://${networking.internalAlb.loadBalancerDnsName}`,
        REDIS_URL: `redis://${database.redisEndpointAddress}:${database.redisPort}`,
      },
      secrets: {
        // Individual RDS credential fields — config.py reconstructs DATABASE_URL
        DB_HOST: ecs.Secret.fromSecretsManager(database.dbSecret, 'host'),
        DB_PORT: ecs.Secret.fromSecretsManager(database.dbSecret, 'port'),
        DB_NAME: ecs.Secret.fromSecretsManager(database.dbSecret, 'dbname'),
        DB_USERNAME: ecs.Secret.fromSecretsManager(database.dbSecret, 'username'),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(database.dbSecret, 'password'),
        JWT_SECRET_KEY: ecs.Secret.fromSecretsManager(database.jwtSecret, 'jwt_secret_key'),
        AI_SERVICE_INTERNAL_TOKEN: ecs.Secret.fromSecretsManager(database.internalServiceToken, 'token'),
      },
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:8000/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(30),
      },
      portMappings: [{ containerPort: 8000, protocol: ecs.Protocol.TCP }],
    });

    // ── bamul-app-api Fargate Service ─────────────────────────────────────────
    const appApiService = new ecs.FargateService(this, 'AppApiService', {
      cluster,
      taskDefinition: appApiTaskDef,
      desiredCount: 2,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [networking.appApiSg],
      healthCheckGracePeriod: cdk.Duration.seconds(30),
      enableECSManagedTags: true,
      propagateTags: ecs.PropagatedTagSource.SERVICE,
    });

    // Register with Public ALB
    const appApiListener = networking.publicAlb.addListener('AppApiListener', {
      port: 80,
      open: true,
    });
    appApiListener.addTargets('AppApiTargets', {
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [appApiService],
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyHttpCodes: '200',
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // Auto-scaling: App API — scale on CPU > 60%
    const appApiScaling = appApiService.autoScaleTaskCount({
      minCapacity: 2,
      maxCapacity: 10,
    });
    appApiScaling.scaleOnCpuUtilization('AppApiCpuScaling', {
      targetUtilizationPercent: 60,
      scaleInCooldown: cdk.Duration.seconds(300), // 5-min scale-in cooldown (prevents camp burst thrashing)
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // ── bamul-ai-service Fargate Task Definition ──────────────────────────────
    const aiServiceTaskDef = new ecs.FargateTaskDefinition(this, 'AiServiceTaskDef', {
      cpu: 2048,            // 2 vCPU
      memoryLimitMiB: 4096, // 4 GB (FAISS index in memory)
      family: 'bamul-ai-service',
    });

    // Grant task execution role access to AI service secret
    database.internalServiceToken.grantRead(aiServiceTaskDef.obtainExecutionRole());

    // Grant task role access to FAISS S3 bucket (index load/save)
    storage.faissBucket.grantReadWrite(aiServiceTaskDef.taskRole);

    const aiServiceContainer = aiServiceTaskDef.addContainer('AiServiceContainer', {
      image: ecs.ContainerImage.fromEcrRepository(aiServiceRepo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'bamul-ai-service',
        logGroup: aiServiceLogGroup,
      }),
      environment: {
        APP_ENV: this.node.tryGetContext('appEnv') as string | undefined ?? 'development',
        AWS_REGION: 'ap-south-1',
        AWS_S3_BUCKET_NAME: storage.faissBucket.bucketName,
        FAISS_INDEX_PATH: '/tmp/bamul_faiss.index',
        MODEL_PATH: 'models/muzzle_model.pt',
      },
      secrets: {
        INTERNAL_TOKEN: ecs.Secret.fromSecretsManager(database.internalServiceToken, 'token'),
      },
      healthCheck: {
        // 120-second start period: FAISS index cold-start from S3 (D21)
        // ECS will not fail the health check until after startPeriod elapses
        command: ['CMD-SHELL', 'curl -f http://localhost:8001/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(120),
      },
      portMappings: [{ containerPort: 8001, protocol: ecs.Protocol.TCP }],
    });

    // Suppress unused variable lint warning — container added to task def for side effects
    void appApiContainer;
    void aiServiceContainer;

    // ── bamul-ai-service Fargate Service ──────────────────────────────────────
    const aiServiceService = new ecs.FargateService(this, 'AiServiceService', {
      cluster,
      taskDefinition: aiServiceTaskDef,
      desiredCount: 2,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [networking.aiServiceSg],
      healthCheckGracePeriod: cdk.Duration.seconds(120), // FAISS index load time
      enableECSManagedTags: true,
      propagateTags: ecs.PropagatedTagSource.SERVICE,
    });

    // Register with Internal ALB
    const aiServiceListener = networking.internalAlb.addListener('AiServiceListener', {
      port: 80,
      open: false, // internal ALB — not internet-facing
    });
    aiServiceListener.addTargets('AiServiceTargets', {
      port: 8001,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [aiServiceService],
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyHttpCodes: '200',
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(60), // longer drain for in-flight FAISS queries
    });

    // Auto-scaling: AI Service — scale on SQS embedding queue depth > 50
    const aiScaling = aiServiceService.autoScaleTaskCount({
      minCapacity: 2,
      maxCapacity: 20,
    });
    aiScaling.scaleOnMetric('AiServiceSqsDepthScaling', {
      metric: embeddingQueue.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(1),
        statistic: 'Maximum',
      }),
      scalingSteps: [
        { upper: 0, change: -1 },   // queue empty → scale in
        { lower: 50, change: +1 },  // depth > 50 → add 1 task
        { lower: 200, change: +2 }, // depth > 200 → add 2 tasks (camp burst)
      ],
      adjustmentType: autoscaling.AdjustmentType.CHANGE_IN_CAPACITY,
      cooldown: cdk.Duration.seconds(300), // 5-min cooldown (prevents camp burst thrashing)
    });

    // ── Stack Outputs ─────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'EmbeddingQueueUrl', {
      value: embeddingQueue.queueUrl,
      exportName: 'BamulEmbeddingQueueUrl',
    });
    new cdk.CfnOutput(this, 'MatchQueueUrl', {
      value: matchQueue.queueUrl,
      exportName: 'BamulMatchQueueUrl',
    });

    this.outputs = {
      cluster,
      appApiService,
      aiServiceService,
      embeddingQueue,
      embeddingDlq,
      matchQueue,
      matchDlq,
      appApiLogGroup,
      aiServiceLogGroup,
    };
  }
}
