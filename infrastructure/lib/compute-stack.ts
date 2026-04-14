import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

/**
 * Compute Stack — ECS Fargate services for App API and AI Service.
 *
 * Full implementation in Story 1.2.
 * Architecture ref: D16 — Container Orchestration
 *
 * ECS Fargate sizing:
 * - bamul-app-api: 1 vCPU, 2GB RAM, min 2 tasks, max 10, scale on CPU > 60%
 * - bamul-ai-service: 2 vCPU, 4GB RAM, min 2 tasks, max 20, scale on SQS depth > 50
 *
 * ECR repositories:
 * - bamul/app-api
 * - bamul/ai-service
 *
 * AI Service health check gates on FAISS index loaded (/health → 200).
 */
export class ComputeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    // Story 1.2 implementation
  }
}
