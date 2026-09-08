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
import { adminUsers } from "./functions/admin-users/resource";
import { opsgpaReceptor } from "./functions/opsgpa-receptor/resource";
import { tallerPortal } from "./functions/taller-portal/resource";
import { visionCombustible } from "./functions/vision-combustible/resource";

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
  adminUsers,
  opsgpaReceptor,
  visionCombustible,
  tallerPortal,
});

// ── Webhook MoreApp RETIRADO (2026-08-20) ──────────────────────
// MoreApp se dio de baja (migración a Operaciones-GPA completada); la Function URL
// pública con token estático era un hallazgo de seguridad abierto. Retirar la
// función elimina el endpoint y su Lambda del stack. El histórico ingerido por
// MoreApp permanece intacto en DynamoDB/S3 (moreapp-capture/ incluido).

const bucket = backend.storage.resources.bucket;

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

// ── Portal del proveedor de taller (2026-09-08) ───────────────────────────────
// Function URL pública: el taller abre la liga en su celular. La autenticación
// es la firma del token (fail-closed sin secreto). Sirve la página y recibe las
// partidas; emite PUT prefirmados para las fotos, con la llave generada por el
// servidor bajo photos/<tenant>/taller-partidas/.
const portalFn = backend.tallerPortal.resources.lambda;
const portalUrl = portalFn.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE,
  cors: { allowedOrigins: ["*"], allowedMethods: [HttpMethod.GET, HttpMethod.POST] },
});
bucket.grantReadWrite(portalFn);
(portalFn as LambdaFunction).addEnvironment("CAPTURE_BUCKET", bucket.bucketName);

backend.addOutput({ custom: { tallerPortalUrl: portalUrl.url } });

// ── Visión IA de tickets de combustible (Fase 1, 2026-08-20) ──────────────────
// SIN Function URL: la única puerta es lambda:InvokeFunction (el receptor la invoca
// asíncrona tras cada reporte de carga) + invocación directa para el modo reproceso.
// Bedrock con permiso mínimo: solo InvokeModel sobre modelos Anthropic (foundation
// model directo o inference profile regional us.anthropic.*).
const visionFn = backend.visionCombustible.resources.lambda;
bucket.grantRead(visionFn);
(visionFn as LambdaFunction).addEnvironment("CAPTURE_BUCKET", bucket.bucketName);
visionFn.addToRolePolicy(
  new PolicyStatement({
    actions: ["bedrock:InvokeModel"],
    resources: [
      "arn:aws:bedrock:*::foundation-model/anthropic.*",
      "arn:aws:bedrock:*:*:inference-profile/*.anthropic.*",
    ],
  }),
);
visionFn.grantInvoke(receptorFn);
(receptorFn as LambdaFunction).addEnvironment("VISION_FUNCTION_NAME", visionFn.functionName);

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
