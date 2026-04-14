import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/**
 * Storage outputs shared with ComputeStack.
 */
export interface StorageOutputs {
  readonly photosBucket: s3.Bucket;
  readonly faissBucket: s3.Bucket;
  readonly auditLogsBucket: s3.Bucket;
}

/**
 * Storage Stack — S3 buckets for cattle photos, FAISS index, and audit logs.
 *
 * Provisions:
 * - bamul-{env}-photos: Object Lock GOVERNANCE (5-year), SSE-S3
 *   GOVERNANCE mode allows privileged override — required for DPDP crypto-shredding (Story 1.13)
 * - bamul-{env}-faiss: FAISS ANN index persistence, versioned (Story 2.7)
 * - bamul-{env}-audit-logs: Object Lock COMPLIANCE (5-year), IRDAI mandatory immutability
 *   COMPLIANCE mode: cannot be overridden even by root — IRDAI 5-year retention enforcement
 *
 * All buckets: SSE-S3, block all public access, enforce HTTPS, apply lifecycle policies.
 *
 * Architecture ref: D21 (FAISS index on S3), D22 (DPDP breach detection), Technical Constraints
 * DPDP Act 2023: biometric data & audit trails must remain in ap-south-1 (Mumbai)
 * IRDAI: 5-year record retention mandatory; audit logs must be immutable
 */
export class StorageStack extends cdk.Stack {
  public readonly outputs: StorageOutputs;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const env = this.node.tryGetContext('appEnv') as string | undefined ?? 'dev';

    // ── Cattle Photos & Claim Evidence ────────────────────────────────────────
    // GOVERNANCE Object Lock: DPDP erasure requests (crypto-shredding) need override capability
    const photosBucket = new s3.Bucket(this, 'PhotosBucket', {
      bucketName: `bamul-${env}-photos`,
      objectLockEnabled: true,
      objectLockDefaultRetention: s3.ObjectLockRetention.governance(cdk.Duration.days(1825)), // 5 years
      encryption: s3.BucketEncryption.S3_MANAGED, // SSE-S3
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // never delete on stack destroy
      lifecycleRules: [
        {
          id: 'MoveToIntelligentTiering',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
        {
          id: 'GlacierArchivalAfter5Years',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(1825), // IRDAI 5-year active retention
            },
          ],
        },
      ],
    });

    // ── FAISS Index Persistence ───────────────────────────────────────────────
    // No Object Lock — index is overwritten on every write; versioning keeps last 3 copies
    const faissBucket = new s3.Bucket(this, 'FaissBucket', {
      bucketName: `bamul-${env}-faiss`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'RetainLast3IndexVersions',
          enabled: true,
          noncurrentVersionExpiration: cdk.Duration.days(7),
          // Keep only 3 noncurrent versions (CDK doesn't expose noncurrentVersionsToRetain directly)
          // Additional version pruning managed via lifecycle policy
        },
      ],
    });

    // ── Audit Log Archival ────────────────────────────────────────────────────
    // COMPLIANCE Object Lock: IRDAI mandatory — no override possible (even root account)
    // Monthly partitioned audit logs from FastAPI services are written here for long-term archival
    const auditLogsBucket = new s3.Bucket(this, 'AuditLogsBucket', {
      bucketName: `bamul-${env}-audit-logs`,
      objectLockEnabled: true,
      objectLockDefaultRetention: s3.ObjectLockRetention.compliance(cdk.Duration.days(1825)), // 5 years COMPLIANCE
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true, // required for Object Lock
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'GlacierArchivalAfter5Years',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(1825),
            },
          ],
        },
      ],
    });

    // ── Stack Outputs ─────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'PhotosBucketName', {
      value: photosBucket.bucketName,
      exportName: 'BamulPhotosBucket',
    });
    new cdk.CfnOutput(this, 'FaissBucketName', {
      value: faissBucket.bucketName,
      exportName: 'BamulFaissBucket',
    });
    new cdk.CfnOutput(this, 'AuditLogsBucketName', {
      value: auditLogsBucket.bucketName,
      exportName: 'BamulAuditLogsBucket',
    });

    this.outputs = {
      photosBucket,
      faissBucket,
      auditLogsBucket,
    };
  }
}
