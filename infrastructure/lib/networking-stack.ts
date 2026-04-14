import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

/**
 * Networking outputs shared with downstream stacks via direct TypeScript references.
 * Architecture ref: Architectural Boundaries — Public ALB / Internal VPC ALB
 */
export interface NetworkingOutputs {
  readonly vpc: ec2.Vpc;
  readonly publicAlbSg: ec2.SecurityGroup;
  readonly internalAlbSg: ec2.SecurityGroup;
  readonly appApiSg: ec2.SecurityGroup;
  readonly aiServiceSg: ec2.SecurityGroup;
  // rdsSg and redisSg are created in DatabaseStack (data-tier SGs) to avoid
  // cross-stack cycle when addRotationSingleUser modifies the RDS security group.
  readonly publicAlb: elbv2.ApplicationLoadBalancer;
  readonly internalAlb: elbv2.ApplicationLoadBalancer;
}

/**
 * Networking Stack — VPC, subnets, security groups, load balancers.
 *
 * Provisions:
 * - VPC with 3 subnet tiers across 2 AZs (ap-south-1a, ap-south-1b)
 *   PUBLIC     — Internet-facing ALB, NAT Gateways
 *   PRIVATE_APP — ECS Fargate tasks (has NAT egress)
 *   PRIVATE_DATA — RDS PostgreSQL, ElastiCache Redis (isolated, no internet)
 * - 2 NAT Gateways (one per AZ for HA)
 * - VPC Flow Logs → CloudWatch
 * - Security groups enforcing least-privilege access
 * - Public ALB (internet-facing) for bamul-app-api
 * - Internal ALB (VPC-only) for bamul-ai-service
 *
 * Architecture ref: D16 — Container Orchestration; D8 — Biometric Data ACL
 * DPDP Act 2023: ap-south-1 (Mumbai) only — enforced via cdk.json context
 */
export class NetworkingStack extends cdk.Stack {
  public readonly outputs: NetworkingOutputs;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── VPC ──────────────────────────────────────────────────────────────────
    const vpc = new ec2.Vpc(this, 'BamulVpc', {
      maxAzs: 2,
      natGateways: 2, // one per AZ — HA for ECS task egress and rotation Lambda
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'PrivateApp',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, // ECS tasks — NAT egress
          cidrMask: 24,
        },
        {
          name: 'PrivateData',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED, // RDS + Redis — no internet
          cidrMask: 24,
        },
      ],
    });

    // VPC Flow Logs for DPDP Act compliance / security audit trail
    vpc.addFlowLog('VpcFlowLog');

    // ── Security Groups ───────────────────────────────────────────────────────

    // Public ALB: accepts 80/443 from internet
    const publicAlbSg = new ec2.SecurityGroup(this, 'PublicAlbSg', {
      vpc,
      description: 'Public ALB — inbound HTTP/HTTPS from internet',
      allowAllOutbound: true,
    });
    publicAlbSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP');
    publicAlbSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');

    // Internal ALB: accepts port 80 from App API only (added after appApiSg)
    const internalAlbSg = new ec2.SecurityGroup(this, 'InternalAlbSg', {
      vpc,
      description: 'Internal ALB — inbound port 80 from App API SG only',
      allowAllOutbound: true,
    });

    // App API: accepts 8000 from Public ALB; egress unrestricted (NAT)
    const appApiSg = new ec2.SecurityGroup(this, 'AppApiSg', {
      vpc,
      description: 'bamul-app-api ECS tasks',
      allowAllOutbound: true,
    });
    appApiSg.addIngressRule(publicAlbSg, ec2.Port.tcp(8000), 'Inbound from Public ALB');

    // Now wire internal ALB → App API rule (avoids forward-reference issue)
    internalAlbSg.addIngressRule(appApiSg, ec2.Port.tcp(80), 'Inbound from App API (AI service calls)');

    // AI Service: accepts 8001 from Internal ALB; egress unrestricted (NAT)
    const aiServiceSg = new ec2.SecurityGroup(this, 'AiServiceSg', {
      vpc,
      description: 'bamul-ai-service ECS tasks — accessible only via internal ALB',
      allowAllOutbound: true,
    });
    aiServiceSg.addIngressRule(internalAlbSg, ec2.Port.tcp(8001), 'Inbound from Internal ALB');

    // rdsSg and redisSg are defined in DatabaseStack (data-tier SGs live alongside the data resources).
    // Moving them out of NetworkingStack avoids a cross-stack dependency cycle:
    //   addRotationSingleUser() would add an ingress rule to rdsSg → NetworkingStack → DatabaseStack
    //   which conflicts with DatabaseStack.addDependency(NetworkingStack).

    // ── Load Balancers ────────────────────────────────────────────────────────

    // Public ALB: internet-facing — routes to bamul-app-api
    const publicAlb = new elbv2.ApplicationLoadBalancer(this, 'PublicAlb', {
      vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: publicAlbSg,
    });
    publicAlb.setAttribute('routing.http.drop_invalid_header_fields.enabled', 'true');

    // Internal ALB: VPC-only — routes to bamul-ai-service from App API
    const internalAlb = new elbv2.ApplicationLoadBalancer(this, 'InternalAlb', {
      vpc,
      internetFacing: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroup: internalAlbSg,
    });

    // ── Stack Outputs (CloudFormation) ────────────────────────────────────────
    new cdk.CfnOutput(this, 'VpcId', { value: vpc.vpcId, exportName: 'BamulVpcId' });
    new cdk.CfnOutput(this, 'PublicAlbDns', {
      value: publicAlb.loadBalancerDnsName,
      exportName: 'BamulPublicAlbDns',
    });
    new cdk.CfnOutput(this, 'InternalAlbDns', {
      value: internalAlb.loadBalancerDnsName,
      exportName: 'BamulInternalAlbDns',
    });

    // ── TypeScript outputs for cross-stack references ─────────────────────────
    this.outputs = {
      vpc,
      publicAlbSg,
      internalAlbSg,
      appApiSg,
      aiServiceSg,
      publicAlb,
      internalAlb,
    };
  }
}
