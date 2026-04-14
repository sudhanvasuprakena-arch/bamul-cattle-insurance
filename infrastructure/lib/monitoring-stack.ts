import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as guardduty from 'aws-cdk-lib/aws-guardduty';
import { Construct } from 'constructs';
import { type NetworkingOutputs } from './networking-stack';
import { type DatabaseOutputs } from './database-stack';
import { type ComputeOutputs } from './compute-stack';

export interface MonitoringStackProps extends cdk.StackProps {
  readonly networking: NetworkingOutputs;
  readonly database: DatabaseOutputs;
  readonly compute: ComputeOutputs;
}

/**
 * Monitoring outputs shared with IrdaiSlaStack.
 */
export interface MonitoringOutputs {
  readonly opsAlarmTopic: sns.Topic;
  readonly dpoAlertTopic: sns.Topic;
}

/**
 * Monitoring Stack — CloudWatch alarms, GuardDuty, SNS topics, X-Ray group, dashboard.
 *
 * Provisions:
 * - GuardDuty detector (15-min publishing frequency) — infrastructure anomaly detection
 * - SNS topics:
 *   bamul-ops-alerts: operational alarms (5xx, latency, DLQ, RDS CPU)
 *   bamul-dpo-alerts: DPDP security alarms → BAMUL DPO (biometric query rate, auth failures)
 * - CloudWatch Metric Alarms:
 *   - App API 5xx rate > 5 in 1 min
 *   - AI Service custom latency > 2500ms p95 (custom metric — application emits it)
 *   - Embedding DLQ messages > 0
 *   - Match DLQ messages > 0
 *   - RDS CPU > 70%
 *   - Biometric query rate > 100/min → DPO alert (DPDP D22)
 *   - Auth failure rate > 50/min → DPO alert (DPDP D22)
 * - CloudWatch Dashboard: BamulOperations
 * - CloudWatch Log Metric Filters: biometric query rate + auth failure rate from structured logs
 *
 * Architecture ref: D17 (CloudWatch + X-Ray + IRDAI SLA), D22 (DPDP Breach Detection)
 */
export class MonitoringStack extends cdk.Stack {
  public readonly outputs: MonitoringOutputs;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const { networking, database, compute } = props;

    // ── SNS Alert Topics ──────────────────────────────────────────────────────

    const opsAlarmTopic = new sns.Topic(this, 'OpsAlarmTopic', {
      topicName: 'bamul-ops-alerts',
      displayName: 'BAMUL Operational Alerts',
    });

    const dpoAlertTopic = new sns.Topic(this, 'DpoAlertTopic', {
      topicName: 'bamul-dpo-alerts',
      displayName: 'BAMUL DPDP Security Alerts — DPO',
    });

    // ── GuardDuty (L1 — no CDK L2 for GuardDuty) ─────────────────────────────
    new guardduty.CfnDetector(this, 'GuardDutyDetector', {
      enable: true,
      findingPublishingFrequency: 'FIFTEEN_MINUTES',
      dataSources: {
        s3Logs: { enable: true },
        malwareProtection: {
          scanEc2InstanceWithFindings: { ebsVolumes: true },
        },
      },
    });

    // ── CloudWatch Log Metric Filters ─────────────────────────────────────────
    // App API emits structured JSON logs via structlog.
    // Filter on specific log event patterns to create custom metrics for DPDP alarms.

    // Biometric query rate: App API logs emit `event: "biometric.query"` on each query to AI service
    const biometricQueryMetricFilter = new logs.MetricFilter(
      this,
      'BiometricQueryMetricFilter',
      {
        logGroup: compute.appApiLogGroup,
        filterPattern: logs.FilterPattern.stringValue('$.event', '=', 'biometric.query'),
        metricNamespace: 'BAMUL/Security',
        metricName: 'BiometricQueryCount',
        metricValue: '1',
        unit: cloudwatch.Unit.COUNT,
      },
    );

    // Auth failure rate: App API logs emit `event: "auth.otp_failed"` on OTP validation failure
    const authFailureMetricFilter = new logs.MetricFilter(
      this,
      'AuthFailureMetricFilter',
      {
        logGroup: compute.appApiLogGroup,
        filterPattern: logs.FilterPattern.stringValue('$.event', '=', 'auth.otp_failed'),
        metricNamespace: 'BAMUL/Security',
        metricName: 'AuthFailureCount',
        metricValue: '1',
        unit: cloudwatch.Unit.COUNT,
      },
    );

    // Suppress unused variable lint warnings
    void biometricQueryMetricFilter;
    void authFailureMetricFilter;

    // ── CloudWatch Alarms ─────────────────────────────────────────────────────

    const alarmAction = new cw_actions.SnsAction(opsAlarmTopic);
    const dpoAlarmAction = new cw_actions.SnsAction(dpoAlertTopic);

    // App API 5xx errors (using direct Metric — metricHttpCodeTarget is deprecated in CDK v2.248+)
    const appApi5xxAlarm = new cloudwatch.Alarm(this, 'AppApi5xxAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'HTTPCode_Target_5XX_Count',
        dimensionsMap: { LoadBalancer: networking.publicAlb.loadBalancerFullName },
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'App API 5xx errors elevated',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    appApi5xxAlarm.addAlarmAction(alarmAction);

    // AI Service p95 latency > 2500ms (custom metric emitted by AI service via structlog)
    const aiLatencyAlarm = new cloudwatch.Alarm(this, 'AiServiceLatencyAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'BAMUL/AiService',
        metricName: 'MatchLatencyMs',
        statistic: 'p95',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 2500,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'AI Service p95 match latency > 2.5s — approaching 3s SLA (D21)',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    aiLatencyAlarm.addAlarmAction(alarmAction);

    // Embedding DLQ — any message indicates a failed embedding job
    const embeddingDlqAlarm = new cloudwatch.Alarm(this, 'EmbeddingDlqAlarm', {
      metric: compute.embeddingDlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(1),
        statistic: 'Maximum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Embedding DLQ has messages — investigate failed enrollment embedding jobs',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    embeddingDlqAlarm.addAlarmAction(alarmAction);

    // Match DLQ
    const matchDlqAlarm = new cloudwatch.Alarm(this, 'MatchDlqAlarm', {
      metric: compute.matchDlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(1),
        statistic: 'Maximum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Match DLQ has messages — investigate failed biometric match jobs',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    matchDlqAlarm.addAlarmAction(alarmAction);

    // RDS CPU > 70%
    const rdsCpuAlarm = new cloudwatch.Alarm(this, 'RdsCpuAlarm', {
      metric: database.dbInstance.metricCPUUtilization({
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      }),
      threshold: 70,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'RDS CPU > 70% — consider read replica or query optimization',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    rdsCpuAlarm.addAlarmAction(alarmAction);

    // DPDP D22: Biometric query rate > 100/min → DPO alert
    const biometricQueryAlarm = new cloudwatch.Alarm(this, 'BiometricQueryRateAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'BAMUL/Security',
        metricName: 'BiometricQueryCount',
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 100,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'DPDP Alert: biometric query rate > 100/min — possible bulk enumeration attack',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    biometricQueryAlarm.addAlarmAction(dpoAlarmAction);

    // DPDP D22: Auth failure rate > 50/min → DPO alert
    const authFailureAlarm = new cloudwatch.Alarm(this, 'AuthFailureRateAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'BAMUL/Security',
        metricName: 'AuthFailureCount',
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 50,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'DPDP Alert: auth failure rate > 50/min — possible credential stuffing attack',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    authFailureAlarm.addAlarmAction(dpoAlarmAction);

    // ── CloudWatch Dashboard ──────────────────────────────────────────────────
    const dashboard = new cloudwatch.Dashboard(this, 'BamulDashboard', {
      dashboardName: 'BamulOperations',
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'App API — Request Rate & Errors',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'RequestCount',
            dimensionsMap: { LoadBalancer: networking.publicAlb.loadBalancerFullName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'BAMUL/Security',
            metricName: 'AuthFailureCount',
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
          }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'RDS — CPU & Connections',
        left: [
          database.dbInstance.metricCPUUtilization({ period: cdk.Duration.minutes(5) }),
          database.dbInstance.metricDatabaseConnections({ period: cdk.Duration.minutes(5) }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'SQS Queue Depths',
        left: [
          compute.embeddingQueue.metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(1) }),
          compute.matchQueue.metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(1) }),
        ],
        right: [
          compute.embeddingDlq.metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(1) }),
          compute.matchDlq.metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(1) }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'AI Service — Biometric Query Rate (DPDP)',
        left: [
          new cloudwatch.Metric({
            namespace: 'BAMUL/Security',
            metricName: 'BiometricQueryCount',
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
          }),
        ],
        width: 12,
      }),
    );

    // ── Stack Outputs ─────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'OpsTopicArn', {
      value: opsAlarmTopic.topicArn,
      exportName: 'BamulOpsAlarmTopicArn',
    });
    new cdk.CfnOutput(this, 'DpoTopicArn', {
      value: dpoAlertTopic.topicArn,
      exportName: 'BamulDpoAlertTopicArn',
    });

    this.outputs = {
      opsAlarmTopic,
      dpoAlertTopic,
    };
  }
}
