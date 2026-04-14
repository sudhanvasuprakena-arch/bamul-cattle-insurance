#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { NetworkingStack } from '../lib/networking-stack';
import { DatabaseStack } from '../lib/database-stack';
import { StorageStack } from '../lib/storage-stack';
import { ComputeStack } from '../lib/compute-stack';
import { MonitoringStack } from '../lib/monitoring-stack';
import { IrdaiSlaStack } from '../lib/irdai-sla-stack';

const app = new cdk.App();

// All stacks deploy to ap-south-1 (Mumbai) — DPDP Act 2023 mandatory region
// Biometric data and farmer PII must not leave Indian AWS region.
const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT ?? 'PLACEHOLDER',
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-south-1',
};

// ── Stack dependency graph ────────────────────────────────────────────────────
//
//  NetworkingStack
//       ↓
//  DatabaseStack   StorageStack (parallel — no VPC deps on Storage)
//       ↓
//  ComputeStack
//       ↓
//  MonitoringStack
//       ↓
//  IrdaiSlaStack
//
// Cross-stack references are passed via TypeScript props (NOT Fn.importValue)
// so stacks remain strongly typed and CloudFormation ordering is inferred
// automatically by CDK from the property references.
// ─────────────────────────────────────────────────────────────────────────────

const networkingStack = new NetworkingStack(app, 'BamulNetworkingStack', { env });

const databaseStack = new DatabaseStack(app, 'BamulDatabaseStack', {
  env,
  networking: networkingStack.outputs,
});
databaseStack.addDependency(networkingStack);

// Storage is independent of Networking (no VPC required for S3)
const storageStack = new StorageStack(app, 'BamulStorageStack', { env });

const computeStack = new ComputeStack(app, 'BamulComputeStack', {
  env,
  networking: networkingStack.outputs,
  database: databaseStack.outputs,
  storage: storageStack.outputs,
});
computeStack.addDependency(databaseStack);
computeStack.addDependency(storageStack);

const monitoringStack = new MonitoringStack(app, 'BamulMonitoringStack', {
  env,
  networking: networkingStack.outputs,
  database: databaseStack.outputs,
  compute: computeStack.outputs,
});
monitoringStack.addDependency(computeStack);

const irdaiSlaStack = new IrdaiSlaStack(app, 'BamulIrdaiSlaStack', {
  env,
  networking: networkingStack.outputs,
  database: databaseStack.outputs,
  monitoring: monitoringStack.outputs,
});
irdaiSlaStack.addDependency(monitoringStack);
