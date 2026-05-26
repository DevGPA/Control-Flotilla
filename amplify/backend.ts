import { defineBackend } from "@aws-amplify/backend";
import {
  FunctionUrlAuthType,
  HttpMethod,
  Function as LambdaFunction,
} from "aws-cdk-lib/aws-lambda";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { storage } from "./storage/resource";
import { moreappWebhook } from "./functions/moreapp-webhook/resource";

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
