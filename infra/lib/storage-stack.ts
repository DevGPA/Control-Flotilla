import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as kms from "aws-cdk-lib/aws-kms";

export interface StorageStackProps extends cdk.StackProps {
  stage: string;
  resourcePrefix: string;
}

/**
 * Single-table DynamoDB design:
 *   PK   = TENANT#{orgId}
 *   SK   = {ISO-date}#{type}#{id}
 *   GSI1 = UNIT#{plate}       + date  (queries por unidad)
 *   GSI2 = BRANCH#{sucursal}  + date  (queries por sucursal)
 *
 * Dedup strategy:
 *   - Deterministic id (UUID v5 of tenantId+naturalKey or SHA-256 of payload).
 *   - Conditional writes (attribute_not_exists) prevent races.
 *   - `version` attribute → optimistic locking on updates.
 *   - Separate IdempotencyTable (TTL 24h) absorbs network retries.
 */
export class StorageStack extends cdk.Stack {
  public readonly table: dynamodb.Table;
  public readonly idempotencyTable: dynamodb.Table;
  public readonly imagesBucket: s3.Bucket;
  public readonly kmsKey: kms.Key;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const isProd = props.stage === "prod";
    const removalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    this.kmsKey = new kms.Key(this, "AppKey", {
      alias: `alias/${props.resourcePrefix}`,
      description: `KMS key for ${props.resourcePrefix}`,
      enableKeyRotation: true,
      removalPolicy,
    });

    this.table = new dynamodb.Table(this, "AppTable", {
      tableName: `${props.resourcePrefix}-app`,
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy,
      deletionProtection: isProd,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: "GSI2",
      partitionKey: { name: "GSI2PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI2SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.idempotencyTable = new dynamodb.Table(this, "IdempotencyTable", {
      tableName: `${props.resourcePrefix}-idempotency`,
      partitionKey: {
        name: "idempotencyKey",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      removalPolicy,
    });

    this.imagesBucket = new s3.Bucket(this, "ImagesBucket", {
      bucketName: `${props.resourcePrefix}-images-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.kmsKey,
      bucketKeyEnabled: true,
      versioned: true,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: "transition-cold-storage",
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(90),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(365),
            },
          ],
          noncurrentVersionExpiration: cdk.Duration.days(180),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.HEAD,
          ],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3000,
        },
      ],
      removalPolicy,
      autoDeleteObjects: !isProd,
    });

    new cdk.CfnOutput(this, "TableName", {
      value: this.table.tableName,
      exportName: `${props.resourcePrefix}-table-name`,
    });
    new cdk.CfnOutput(this, "IdempotencyTableName", {
      value: this.idempotencyTable.tableName,
      exportName: `${props.resourcePrefix}-idempotency-name`,
    });
    new cdk.CfnOutput(this, "ImagesBucketName", {
      value: this.imagesBucket.bucketName,
      exportName: `${props.resourcePrefix}-images-bucket`,
    });
    new cdk.CfnOutput(this, "KmsKeyArn", {
      value: this.kmsKey.keyArn,
      exportName: `${props.resourcePrefix}-kms-arn`,
    });
  }
}
