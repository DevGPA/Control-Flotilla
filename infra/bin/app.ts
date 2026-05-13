#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { StorageStack } from "../lib/storage-stack";
import { AuthStack } from "../lib/auth-stack";
import { ApiStack } from "../lib/api-stack";

const app = new cdk.App();

const stage = (app.node.tryGetContext("stage") as string) ?? "dev";
const org = app.node.tryGetContext("app:org") as string;
const name = app.node.tryGetContext("app:name") as string;
const region =
  process.env.CDK_DEFAULT_REGION ?? (app.node.tryGetContext("app:defaultRegion") as string);
const account = process.env.CDK_DEFAULT_ACCOUNT;

if (!account) {
  throw new Error(
    "CDK_DEFAULT_ACCOUNT not set. Run with `cdk deploy` using configured AWS credentials, or set env var.",
  );
}

const env: cdk.Environment = { account, region };
const prefix = `${org}-${name}-${stage}`;
const tags = { Project: name, Stage: stage, Org: org, ManagedBy: "cdk" };

const storage = new StorageStack(app, `${prefix}-storage`, {
  env,
  stackName: `${prefix}-storage`,
  description: "S3 buckets + DynamoDB single-table + KMS keys",
  stage,
  resourcePrefix: prefix,
});

const auth = new AuthStack(app, `${prefix}-auth`, {
  env,
  stackName: `${prefix}-auth`,
  description: "Cognito User Pool + App Client",
  stage,
  resourcePrefix: prefix,
});

new ApiStack(app, `${prefix}-api`, {
  env,
  stackName: `${prefix}-api`,
  description: "Lambda handlers + API Gateway + Cognito Authorizer",
  stage,
  resourcePrefix: prefix,
  table: storage.table,
  idempotencyTable: storage.idempotencyTable,
  imagesBucket: storage.imagesBucket,
  userPool: auth.userPool,
});

for (const [k, v] of Object.entries(tags)) {
  cdk.Tags.of(app).add(k, v);
}
