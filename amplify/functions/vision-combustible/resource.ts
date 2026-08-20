import { defineFunction } from "@aws-amplify/backend";

/**
 * Visión IA de tickets de combustible (Fase 1, plan 2026-08-19).
 *
 * La invoca el receptor Ops-GPA de forma ASÍNCRONA (InvocationType: Event) tras cada
 * upsert de un reporte de carga; lee las fotos del bucket de FC, las reescala, llama
 * a Claude en Bedrock (tool use forzado) y persiste SOLO los campos de visión en
 * ValidacionCarga (jamás el veredicto — ver src/vision/analiza.ts). Sin Function URL:
 * solo lambda:InvokeFunction (receptor) e invocación directa (modo reproceso).
 *
 * Timeout 600 s: el modo reproceso procesa lotes de ~50 cargas históricas.
 * MODELO_VISION es config, no código: cambiar de modelo no requiere deploy de lógica,
 * y cada lectura estampa `modeloVision` para saber siempre qué modelo leyó qué.
 */
export const visionCombustible = defineFunction({
  name: "vision-combustible",
  entry: "./handler.ts",
  timeoutSeconds: 600,
  memoryMB: 1024, // jimp reescala en memoria; 128 MB se queda corto con fotos de varios MB
  environment: {
    // Candidatos del plan: anthropic.claude-sonnet-5 (recomendado) /
    // anthropic.claude-haiku-4-5 (costo mínimo) / anthropic.claude-opus-5 (máxima
    // precisión). El default definitivo lo decide Navares tras el A/B del piloto.
    MODELO_VISION: "anthropic.claude-sonnet-5",
    BEDROCK_REGION: "us-east-1",
    OPS_TENANT_ID: "gpa",
  },
});
