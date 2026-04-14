import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { type NetworkingOutputs } from './networking-stack';

export interface DatabaseStackProps extends cdk.StackProps {
  readonly networking: NetworkingOutputs;
}

/**
 * Database outputs shared with ComputeStack and MonitoringStack.
 */
export interface DatabaseOutputs {
  readonly dbInstance: rds.DatabaseInstance;
  /** RDS master credentials — stored in Secrets Manager, auto-rotated every 30 days */
  readonly dbSecret: secretsmanager.ISecret;
  /** JWT signing key — replace default generated value before staging/production deployment */
  readonly jwtSecret: secretsmanager.Secret;
  /** X-Internal-Token for App API → AI Service calls (D6 — Service-to-Service Auth) */
  readonly internalServiceToken: secretsmanager.Secret;
  readonly redisEndpointAddress: string;
  readonly redisPort: number;
  /** Data-tier SGs live in DatabaseStack to prevent cycle with addRotationSingleUser */
  readonly rdsSg: ec2.SecurityGroup;
  readonly redisSg: ec2.SecurityGroup;
}

/**
 * Database Stack — RDS PostgreSQL 15 Multi-AZ + ElastiCache Redis 7 + application secrets.
 *
 * Provisions:
 * - RDS PostgreSQL 15 Multi-AZ, db.r6g.large, 16 GB, private-data subnets
 *   - Storage encrypted (AES-256 via AWS KMS)
 *   - Backup retention 7 days, window 01:00–02:00 UTC (06:30–07:30 IST)
 *   - Deletion protection enabled (prod safety)
 *   - Credentials auto-rotated in Secrets Manager every 30 days
 *   - pg_uuidv7 enabled via Alembic baseline migration (Story 1.3)
 * - ElastiCache Redis 7 (cache.r7g.medium, 6 GB)
 *   - DB 0: ARQ task queue | DB 1: OTP rate limiting | DB 2: JWT refresh tokens
 *   - Encryption in transit and at rest
 * - Secrets Manager secrets: RDS credentials, JWT key, internal service token
 *
 * Architecture ref: D1 (SQLAlchemy + Alembic), D2 (Redis), D3 (connection pooling), D7 (Secrets Manager)
 * RPO ≤ 4 hours, RTO ≤ 2 hours (Multi-AZ automatic failover)
 */
export class DatabaseStack extends cdk.Stack {
  public readonly outputs: DatabaseOutputs;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { networking } = props;

    // ── Application Secrets ───────────────────────────────────────────────────

    // JWT signing key — generated here; set to a secure value in staging/production
    const jwtSecret = new secretsmanager.Secret(this, 'JwtSecret', {
      secretName: 'bamul/jwt-secret',
      description: 'JWT signing key for BAMUL App API — replace with secure random value before production',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ jwt_algorithm: 'HS256' }),
        generateStringKey: 'jwt_secret_key',
        excludeCharacters: '"@/\\',
        passwordLength: 64,
      },
    });

    // Internal service token (App API → AI Service X-Internal-Token header)
    const internalServiceToken = new secretsmanager.Secret(this, 'InternalServiceToken', {
      secretName: 'bamul/internal-service-token',
      description: 'X-Internal-Token for App API → AI Service calls (D6 — HMAC service auth)',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ service: 'bamul-ai-service' }),
        generateStringKey: 'token', // secretStringTemplate + generateStringKey must be paired
        excludeCharacters: '"@/\\',
        passwordLength: 64,
      },
    });

    // ── RDS PostgreSQL 15 Multi-AZ ────────────────────────────────────────────

    // ── Data-tier Security Groups (live here to avoid addRotationSingleUser cycle) ──
    // rdsSg/redisSg reference NetworkingStack SGs as ingress sources — that direction is safe.
    // Keeping them in DatabaseStack means addRotationSingleUser's rule modification stays
    // within this stack and never creates a back-reference to NetworkingStack.

    const rdsSg = new ec2.SecurityGroup(this, 'RdsSg', {
      vpc: networking.vpc,
      description: 'RDS PostgreSQL — 5432 from App API and AI Service',
      allowAllOutbound: false,
    });
    rdsSg.addIngressRule(networking.appApiSg, ec2.Port.tcp(5432), 'From App API');
    rdsSg.addIngressRule(networking.aiServiceSg, ec2.Port.tcp(5432), 'From AI Service (biometric_rw)');

    const redisSg = new ec2.SecurityGroup(this, 'RedisSg', {
      vpc: networking.vpc,
      description: 'ElastiCache Redis — 6379 from App API only',
      allowAllOutbound: false,
    });
    redisSg.addIngressRule(networking.appApiSg, ec2.Port.tcp(6379), 'From App API');

    const dbSubnetGroup = new rds.SubnetGroup(this, 'DbSubnetGroup', {
      description: 'BAMUL RDS subnet group — private-data subnets',
      vpc: networking.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    const dbInstance = new rds.DatabaseInstance(this, 'BamulDb', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.R6G, ec2.InstanceSize.LARGE),
      vpc: networking.vpc,
      subnetGroup: dbSubnetGroup,
      securityGroups: [rdsSg],
      multiAz: true,
      storageEncrypted: true, // AES-256 via AWS KMS
      allocatedStorage: 100, // GB — expandable via autoscaling
      maxAllocatedStorage: 500, // auto-scaling ceiling
      storageType: rds.StorageType.GP3,
      credentials: rds.Credentials.fromGeneratedSecret('bamul_admin', {
        secretName: 'bamul/rds-credentials',
        excludeCharacters: '"@/\\',
      }),
      databaseName: this.node.tryGetContext('dbName') as string | undefined ?? 'bamul_dev',
      backupRetention: cdk.Duration.days(7),
      preferredBackupWindow: '01:00-02:00', // 06:30–07:30 IST — low traffic
      preferredMaintenanceWindow: 'sun:03:00-sun:04:00', // 08:30–09:30 IST Sunday
      deletionProtection: true,
      enablePerformanceInsights: true,
      performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT, // 7 days free tier
      cloudwatchLogsExports: ['postgresql', 'upgrade'],
      cloudwatchLogsRetention: 365, // 1 year
      // pg_uuidv7: enabled via Alembic baseline migration in Story 1.3
      // (pg_uuidv7 is an extension loaded at DB level, not an RDS parameter group option)
    });

    // Secrets Manager auto-rotation every 30 days
    // Rotation Lambda placed in private-app subnet (NAT access to Secrets Manager endpoint)
    dbInstance.addRotationSingleUser({
      automaticallyAfter: cdk.Duration.days(30),
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // ── ElastiCache Redis 7 (L1 — no CDK L2 for Redis) ───────────────────────

    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'BAMUL Redis 7 subnet group — private-app subnets',
      subnetIds: networking.vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      }).subnetIds,
      cacheSubnetGroupName: 'bamul-redis-subnet-group',
    });

    const redis = new elasticache.CfnReplicationGroup(this, 'BamulRedis', {
      replicationGroupDescription: 'BAMUL Redis 7 — OTP rate-limit (DB1), JWT tokens (DB2), ARQ queue (DB0)',
      cacheNodeType: 'cache.r7g.medium',
      engine: 'redis',
      engineVersion: '7.0',
      numCacheClusters: 1, // single-node MVP; promote to multi-AZ in Growth phase
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
      cacheSubnetGroupName: redisSubnetGroup.ref,
      securityGroupIds: [redisSg.securityGroupId],
      // DB allocation (application-level convention, not Redis server config):
      // DB 0 — ARQ task queue (background jobs: WhatsApp, SMS, FCM)
      // DB 1 — OTP rate limiting (max 3 attempts per 10 min, Story 1.5)
      // DB 2 — JWT refresh token store (Story 1.7)
    });
    redis.addDependency(redisSubnetGroup);

    // ── Stack Outputs ─────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: dbInstance.dbInstanceEndpointAddress,
      exportName: 'BamulDbEndpoint',
    });
    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: dbInstance.secret!.secretArn,
      exportName: 'BamulDbSecretArn',
    });
    new cdk.CfnOutput(this, 'RedisEndpoint', {
      value: redis.attrPrimaryEndPointAddress,
      exportName: 'BamulRedisEndpoint',
    });

    this.outputs = {
      dbInstance,
      dbSecret: dbInstance.secret!,
      jwtSecret,
      internalServiceToken,
      redisEndpointAddress: redis.attrPrimaryEndPointAddress,
      redisPort: 6379,
      rdsSg,
      redisSg,
    };
  }
}
