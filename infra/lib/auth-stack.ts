import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";

export interface AuthStackProps extends cdk.StackProps {
  stage: string;
  resourcePrefix: string;
}

/**
 * Cognito setup:
 *   - User Pool with email sign-in. Admin-only user creation.
 *   - Custom attribute `orgId` → maps to TENANT#{orgId} in DDB PK.
 *   - Custom attribute `role` → admin | editor | viewer (gating).
 *   - MFA optional (TOTP). No SMS (cost).
 *   - Password policy: 10+ chars, symbols, numbers, uppercase.
 */
export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const isProd = props.stage === "prod";

    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `${props.resourcePrefix}-users`,
      selfSignUpEnabled: false,
      signInAliases: { email: true, username: false },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
        givenName: { required: false, mutable: true },
        familyName: { required: false, mutable: true },
      },
      customAttributes: {
        orgId: new cognito.StringAttribute({ minLen: 1, maxLen: 64, mutable: false }),
        role: new cognito.StringAttribute({ minLen: 1, maxLen: 32, mutable: true }),
      },
      passwordPolicy: {
        minLength: 10,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      deletionProtection: isProd,
    });

    this.userPoolClient = this.userPool.addClient("WebClient", {
      userPoolClientName: `${props.resourcePrefix}-web`,
      authFlows: {
        userSrp: true,
        userPassword: false,
        custom: false,
        adminUserPassword: false,
      },
      preventUserExistenceErrors: true,
      refreshTokenValidity: cdk.Duration.days(30),
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      enableTokenRevocation: true,
    });

    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
      exportName: `${props.resourcePrefix}-user-pool-id`,
    });
    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
      exportName: `${props.resourcePrefix}-user-pool-client-id`,
    });
  }
}
