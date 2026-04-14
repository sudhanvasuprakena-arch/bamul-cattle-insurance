import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as events_targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import { type NetworkingOutputs } from './networking-stack';
import { type DatabaseOutputs } from './database-stack';
import { type MonitoringOutputs } from './monitoring-stack';

export interface IrdaiSlaStackProps extends cdk.StackProps {
  readonly networking: NetworkingOutputs;
  readonly database: DatabaseOutputs;
  readonly monitoring: MonitoringOutputs;
}

/**
 * IRDAI SLA Stack — EventBridge hourly rule + SLA checker Lambda stub.
 *
 * Provisions:
 * - Lambda function `bamul-irdai-sla-checker` (Node.js 20.x, stub)
 *   Full implementation in Story 1.12 (adds DB query + SNS publish logic)
 *   Placed in private-app subnets for DB access in Story 1.12
 * - EventBridge rule: fires every 1 hour → Lambda target
 * - Lambda IAM grants: secretsmanager:GetSecretValue, sns:Publish
 *
 * SLA thresholds (Story 1.12 will implement the checks):
 * - Policy in `pending` state > 2 business days → bamul-ops-alerts SNS (48h pre-breach warning)
 * - Claim in `open` state > 12 days → bamul-ops-alerts SNS (14-day SLA warning)
 * - Dispute unresolved > 12 days → bamul-ops-alerts SNS (15-day IRDAI grievance pre-breach)
 *
 * Architecture ref: D17 — Monitoring & Observability: IRDAI SLA clock
 */
export class IrdaiSlaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: IrdaiSlaStackProps) {
    super(scope, id, props);

    const { networking, database, monitoring } = props;

    // ── SLA Checker Lambda ────────────────────────────────────────────────────
    // Stub implementation — full DB query + SNS publish logic added in Story 1.12
    const slaCheckerFn = new lambda.Function(this, 'IrdaiSlaChecker', {
      functionName: 'bamul-irdai-sla-checker',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        /**
         * IRDAI SLA Checker — stub.
         * Full implementation: Story 1.12 (Compliance Monitoring).
         *
         * Will query PostgreSQL for:
         *   - policies in 'pending' state > 2 business days
         *   - claims in 'open' state > 12 days
         *   - disputes unresolved > 12 days
         * and publish SNS alerts for approaching SLA breaches.
         */
        exports.handler = async (event) => {
          console.log(JSON.stringify({ event: 'irdai_sla_checker.invoked', payload: event }));
          // TODO Story 1.12: implement DB queries and SNS alerts
          return { statusCode: 200, body: 'SLA check stub — full implementation in Story 1.12' };
        };
      `),
      description: 'IRDAI SLA breach pre-warning checker — queries DB hourly, fires SNS on approaching breaches',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      // VPC placement for DB access in Story 1.12
      vpc: networking.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      environment: {
        SNS_OPS_TOPIC_ARN: monitoring.opsAlarmTopic.topicArn,
        SNS_DPO_TOPIC_ARN: monitoring.dpoAlertTopic.topicArn,
        DB_SECRET_ARN: database.dbSecret.secretArn,
        AWS_REGION_NAME: 'ap-south-1',
        // DB_HOST, DB_PORT, DB_NAME populated from secret in Story 1.12 implementation
      },
    });

    // ── IAM Grants ────────────────────────────────────────────────────────────
    database.dbSecret.grantRead(slaCheckerFn);
    monitoring.opsAlarmTopic.grantPublish(slaCheckerFn);
    monitoring.dpoAlertTopic.grantPublish(slaCheckerFn);

    // ── EventBridge Hourly Schedule ───────────────────────────────────────────
    const slaRule = new events.Rule(this, 'IrdaiSlaSchedule', {
      ruleName: 'bamul-irdai-sla-hourly',
      description: 'Triggers IRDAI SLA checker every hour — D17 monitoring',
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
    });
    slaRule.addTarget(new events_targets.LambdaFunction(slaCheckerFn, {
      retryAttempts: 2,
    }));

    // ── Stack Outputs ─────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'SlaCheckerFunctionArn', {
      value: slaCheckerFn.functionArn,
      exportName: 'BamulSlaCheckerFunctionArn',
    });
  }
}
