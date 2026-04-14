#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { NetworkingStack } from '../lib/networking-stack';
import { DatabaseStack } from '../lib/database-stack';
import { ComputeStack } from '../lib/compute-stack';
import { MonitoringStack } from '../lib/monitoring-stack';

const app = new cdk.App();

// All stacks deploy to ap-south-1 (Mumbai) — DPDP Act 2023 mandatory region
const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT || 'PLACEHOLDER',
  region: process.env.CDK_DEFAULT_REGION || 'ap-south-1',
};

const networkingStack = new NetworkingStack(app, 'BamulNetworkingStack', { env });

const databaseStack = new DatabaseStack(app, 'BamulDatabaseStack', { env });
databaseStack.addDependency(networkingStack);

const computeStack = new ComputeStack(app, 'BamulComputeStack', { env });
computeStack.addDependency(databaseStack);

const monitoringStack = new MonitoringStack(app, 'BamulMonitoringStack', { env });
monitoringStack.addDependency(computeStack);
