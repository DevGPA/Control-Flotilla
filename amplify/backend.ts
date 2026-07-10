import { defineBackend } from "@aws-amplify/backend";
import {
  FunctionUrlAuthType,
  HttpMethod,
  Function as LambdaFunction,
} from "aws-cdk-lib/aws-lambda";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { storage } from "./storage/resource";
import { moreappWebhook } from "./functions/moreapp-webhook/resource";
import { adminUsers } from "./functions/admin-users/resource";
import { opsgpaReceptor } from "./functions/opsgpa-receptor/resource";

/**
 * Amplify Gen 2 backend entrypoint.
 *
 * Recursos:
 * - auth: Cognito user pool + group 'admin' + custom attr 'tenantId'.
 * - data: AppSync GraphQL API con 6 modelos (Unit/Taller/Nota/Checklist/Periodo/Semanal).
 *   Cada modelo respaldado por una tabla DynamoDB con GSIs por tenant + sort key.
 * - storage: S3 bucket 'gpa-fleet-photos' particionado por tenantId.
 *
 * Deploy: TI debe habilitar backend builds en el Amplify app antes de que
 * `amplify.yml` con sección `backend:` corra en CI.
 *
 * Dev local: `npm run amplify:sandbox` crea backend temporal en cuenta AWS
 * (requiere AWS CLI + credentials configurados).
 */
const backend = defineBackend({
  auth,
  data,
  storage,
  moreappWebhook,
  adminUsers,
  opsgpaReceptor,
});

// ── MoreApp webhook (FASE 1 captura) ──────────────────────────
// Function URL pública (sin IAM): MoreApp hace POST con el payload del form.
// Protección por token en query (?t=...). El Lambda guarda el JSON crudo en el
// bucket de fotos bajo prefix moreapp-capture/ para inspeccionar la estructura.
const webhookFn = backend.moreappWebhook.resources.lambda;
const webhookUrl = webhookFn.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE,
  cors: { allowedOrigins: ["*"], allowedMethods: [HttpMethod.ALL] },
});

const bucket = backend.storage.resources.bucket;
bucket.grantReadWrite(webhookFn);
(webhookFn as LambdaFunction).addEnvironment("CAPTURE_BUCKET", bucket.bucketName);

backend.addOutput({ custom: { moreappWebhookUrl: webhookUrl.url } });

// ── Receptor del puente Operaciones-GPA (gpa.ops.v1, 2026-07-10) ──────────────
// Function URL dedicada (POST del publisher de Eco-Admin/operaciones-gpa). La
// autenticación es la firma HMAC verificada en el handler (fail-closed sin secreto):
// no depende del token estático del webhook legacy. Escribe en el bucket de FC
// (fotos copiadas + capturas crudas ops-capture/) y LEE el bucket de evidencias
// de Operaciones-GPA (mismo account) — permiso mínimo s3:GetObject.
const receptorFn = backend.opsgpaReceptor.resources.lambda;
const receptorUrl = receptorFn.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE,
  cors: { allowedOrigins: ["*"], allowedMethods: [HttpMethod.POST] },
});
bucket.grantReadWrite(receptorFn);
(receptorFn as LambdaFunction).addEnvironment("CAPTURE_BUCKET", bucket.bucketName);
receptorFn.addToRolePolicy(
  new PolicyStatement({
    actions: ["s3:GetObject"],
    // Evidencias de Operaciones-GPA (prod y, si algún día aplica, otros envs).
    resources: ["arn:aws:s3:::gpa-ops-evidencias-*/*"],
  }),
);
receptorFn.addToRolePolicy(
  new PolicyStatement({
    // Sin ListBucket, S3 reporta un objeto AUSENTE como AccessDenied en vez de 404
    // (lo vimos en la validación sandbox). Solo listado, sigue siendo read-only.
    actions: ["s3:ListBucket"],
    resources: ["arn:aws:s3:::gpa-ops-evidencias-*"],
  }),
);
// Modo BACKFILL (invocación directa): lectura de la tabla de Ops vía su GSI
// tipo-fecha. Solo Query — nunca escritura sobre Operaciones-GPA.
receptorFn.addToRolePolicy(
  new PolicyStatement({
    actions: ["dynamodb:Query"],
    resources: [
      "arn:aws:dynamodb:*:*:table/gpa_operaciones_*",
      "arn:aws:dynamodb:*:*:table/gpa_operaciones_*/index/*",
    ],
  }),
);
backend.addOutput({ custom: { opsgpaReceptorUrl: receptorUrl.url } });

// ── Módulo de Administración de Usuarios (2026-06-12) ─────────────────────────
// La Lambda admin-users opera la Cognito Admin API. Permisos ACOTADOS al ARN del
// User Pool del proyecto (no '*'); + env USER_POOL_ID. AppSync ya restringe la
// invocación al grupo 'admin' (ver data/resource.ts).
const adminFn = backend.adminUsers.resources.lambda;
const userPool = backend.auth.resources.userPool;
(adminFn as LambdaFunction).addEnvironment("USER_POOL_ID", userPool.userPoolId);
adminFn.addToRolePolicy(
  new PolicyStatement({
    actions: [
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminUpdateUserAttributes",
      "cognito-idp:AdminEnableUser",
      "cognito-idp:AdminDisableUser",
      "cognito-idp:AdminDeleteUser",
      "cognito-idp:AdminResetUserPassword",
      "cognito-idp:AdminSetUserPassword",
      "cognito-idp:AdminAddUserToGroup",
      "cognito-idp:AdminRemoveUserFromGroup",
      "cognito-idp:AdminListGroupsForUser",
      "cognito-idp:ListUsers",
      "cognito-idp:ListUsersInGroup",
    ],
    resources: [userPool.userPoolArn],
  }),
);
