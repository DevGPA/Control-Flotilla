import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as logs from "aws-cdk-lib/aws-logs";

const BACKEND_ROOT = path.resolve(__dirname, "..", "..", "backend");
const BACKEND_LOCK = path.join(BACKEND_ROOT, "package-lock.json");

export interface ApiStackProps extends cdk.StackProps {
  stage: string;
  resourcePrefix: string;
  table: dynamodb.Table;
  idempotencyTable: dynamodb.Table;
  imagesBucket: s3.Bucket;
  userPool: cognito.UserPool;
}

/**
 * API Gateway REST API protected by Cognito Authorizer.
 * Each entity (units, taller, notas, checklist, periodos, semanales) has a Lambda handler.
 * Plus image-pipeline endpoint that returns presigned S3 URLs.
 *
 * All write handlers MUST:
 *   1. Validate Idempotency-Key header → check idempotencyTable.
 *   2. Compute deterministic id from natural key.
 *   3. PutItem with ConditionExpression: attribute_not_exists(PK) for creates.
 *   4. UpdateItem with version increment for updates (optimistic lock).
 */
export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const backendDir = path.resolve(__dirname, "..", "..", "backend", "src");

    const sharedEnv: Record<string, string> = {
      APP_TABLE: props.table.tableName,
      IDEMPOTENCY_TABLE: props.idempotencyTable.tableName,
      IMAGES_BUCKET: props.imagesBucket.bucketName,
      STAGE: props.stage,
      NODE_OPTIONS: "--enable-source-maps",
    };

    const fnDefaults: Partial<nodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(10),
      environment: sharedEnv,
      projectRoot: BACKEND_ROOT,
      depsLockFilePath: BACKEND_LOCK,
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node20",
        externalModules: ["@aws-sdk/*"],
      },
    };

    const makeFn = (name: string, file: string): nodejs.NodejsFunction => {
      const logGroup = new logs.LogGroup(this, `${name}LogGroup`, {
        logGroupName: `/aws/lambda/${props.resourcePrefix}-${name.toLowerCase()}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy:
          props.stage === "prod" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      });
      const fn = new nodejs.NodejsFunction(this, name, {
        ...fnDefaults,
        functionName: `${props.resourcePrefix}-${name.toLowerCase()}`,
        entry: path.join(backendDir, "handlers", file),
        handler: "handler",
        logGroup,
      });
      props.table.grantReadWriteData(fn);
      props.idempotencyTable.grantReadWriteData(fn);
      return fn;
    };

    const unitsFn = makeFn("Units", "units.ts");
    const tallerFn = makeFn("Taller", "taller.ts");
    const notasFn = makeFn("Notas", "notas.ts");
    const checklistFn = makeFn("Checklist", "checklist.ts");
    const periodosFn = makeFn("Periodos", "periodos.ts");
    const semanalesFn = makeFn("Semanales", "semanales.ts");

    const imagesFn = makeFn("Images", "images.ts");
    props.imagesBucket.grantReadWrite(imagesFn);
    props.imagesBucket.grantPutAcl(imagesFn);

    const api = new apigw.RestApi(this, "Api", {
      restApiName: `${props.resourcePrefix}-api`,
      description: "Control Flotilla REST API",
      deployOptions: {
        stageName: props.stage,
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: [
          "Content-Type",
          "Authorization",
          "X-Amz-Date",
          "X-Api-Key",
          "X-Amz-Security-Token",
          "Idempotency-Key",
          "If-Match",
        ],
        maxAge: cdk.Duration.hours(1),
      },
      cloudWatchRole: true,
    });

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, "CognitoAuth", {
      cognitoUserPools: [props.userPool],
      authorizerName: `${props.resourcePrefix}-auth`,
    });

    const methodOpts: apigw.MethodOptions = {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    };

    const wireResource = (pathPart: string, fn: lambda.IFunction, includeIdParam = true): void => {
      const root = api.root.addResource(pathPart);
      const integ = new apigw.LambdaIntegration(fn);
      root.addMethod("GET", integ, methodOpts);
      root.addMethod("POST", integ, methodOpts);
      if (includeIdParam) {
        const item = root.addResource("{id}");
        item.addMethod("GET", integ, methodOpts);
        item.addMethod("PUT", integ, methodOpts);
        item.addMethod("DELETE", integ, methodOpts);
      }
    };

    wireResource("units", unitsFn);
    wireResource("taller", tallerFn);
    wireResource("notas", notasFn);
    wireResource("checklist", checklistFn);
    wireResource("periodos", periodosFn);
    wireResource("semanales", semanalesFn);

    const images = api.root.addResource("images");
    const imagesInteg = new apigw.LambdaIntegration(imagesFn);
    images.addResource("presign").addMethod("POST", imagesInteg, methodOpts);
    images.addResource("{key+}").addMethod("GET", imagesInteg, methodOpts);

    new cdk.CfnOutput(this, "ApiUrl", {
      value: api.url,
      exportName: `${props.resourcePrefix}-api-url`,
    });
  }
}
