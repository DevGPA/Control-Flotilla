import { defineFunction, secret } from "@aws-amplify/backend";

/**
 * Receptor del puente Operaciones-GPA → Fleet Command (contrato gpa.ops.v1).
 *
 * El publisher (Eco-Admin `operaciones-gpa`, bridge/publisher.py) hace POST firmado
 * (HMAC-SHA256, headers X-GPA-Timestamp/X-GPA-Firma) a la Function URL de esta Lambda
 * en cada captura confirmada (SOL combustible / CL checklist).
 *
 * Función DEDICADA (no se reusa el webhook de MoreApp a propósito): el webhook es el
 * camino legacy que se decomisa en la Fase 4; este es el camino permanente. Fail-closed:
 * sin OPS_BRIDGE_SECRET configurado, todo POST responde 401.
 *
 * Secreto (compartido con el parámetro FleetBridgeSecret del stack SAM de Ops):
 *   sandbox:  npx ampx sandbox secret set OPS_BRIDGE_SECRET
 *   branch:   Amplify console → Secrets (mismo nombre)
 */
export const opsgpaReceptor = defineFunction({
  name: "opsgpa-receptor",
  entry: "./handler.ts",
  timeoutSeconds: 60,
  environment: {
    OPS_BRIDGE_SECRET: secret("OPS_BRIDGE_SECRET"),
    // Tenant al que se asignan los datos (mismo que el webhook MoreApp).
    OPS_TENANT_ID: "gpa",
    // Bucket de evidencias de Operaciones-GPA (mismo account). El rol recibe
    // s3:GetObject sobre él en backend.ts para copiar fotos/firmas.
    OPS_EVIDENCIAS_BUCKET: "gpa-ops-evidencias-prod-149857424311",
    // Tabla de Ops para el modo BACKFILL (invocación directa, solo Query al GSI).
    OPS_TABLE: "gpa_operaciones_prod",
  },
});
