import { defineFunction, secret } from "@aws-amplify/backend";

/**
 * Lambda receptor del webhook de MoreApp (FASE 1 — captura).
 *
 * MoreApp hace POST a una Function URL pública en cada `submission.created`.
 * Esta versión solo guarda el payload crudo en S3 + CloudWatch para inspeccionar
 * la estructura real (no documentada). FASE 2 mapeará a Unit/Checklist.
 *
 * El token va en la URL del webhook (?t=...) como única protección (MoreApp no
 * firma con HMAC documentado). Guardado aquí en env, no es secreto de alto valor
 * para la fase de captura; rotar antes de producción.
 */
export const moreappWebhook = defineFunction({
  name: "moreapp-webhook",
  entry: "./handler.ts",
  // 300s para soportar lotes de backfill (descarga de fotos de varios envíos).
  timeoutSeconds: 300,
  environment: {
    WEBHOOK_TOKEN: "gpa-moreapp-268066bd8f7868cc06d2edd6bfefe5b1",
    // Tenant Cognito al que se asignan los datos de MoreApp (customerId 14922).
    MOREAPP_TENANT_ID: "gpa",
    // API key de MoreApp (secret de Amplify) — descarga de fotos vía API.
    MOREAPP_API_KEY: secret("MOREAPP_API_KEY"),
    // Secret de firma del webhook MoreApp. Vacío = validación HMAC omitida (solo token).
    MOREAPP_SIGNING_SECRET: "",
  },
});
