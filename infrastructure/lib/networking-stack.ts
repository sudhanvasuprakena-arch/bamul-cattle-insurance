import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

/**
 * Networking Stack — VPC, subnets, security groups.
 *
 * Full implementation in Story 1.2.
 * Architecture ref: D16 — Container Orchestration: AWS ECS Fargate
 *
 * Will provision:
 * - VPC with public, private-app, and private-data subnets (2 AZs)
 * - Security groups: app-api → RDS allowed; ai-service → RDS biometric_rw only
 * - NAT Gateway for private subnet egress
 * - VPC Flow Logs to CloudWatch
 */
export class NetworkingStack extends cdk.Stack {
  // TODO Story 1.2: expose vpc, appSecurityGroup, dbSecurityGroup as public properties

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    // Story 1.2 implementation
  }
}
