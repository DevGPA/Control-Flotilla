import { defineFunction } from "@aws-amplify/backend";

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
  timeoutSeconds: 30,
  environment: {
    WEBHOOK_TOKEN: "gpa-moreapp-268066bd8f7868cc06d2edd6bfefe5b1",
  },
});
