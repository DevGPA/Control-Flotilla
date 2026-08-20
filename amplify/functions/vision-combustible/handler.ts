import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/vision-combustible";
import type { Schema } from "../../data/resource";
import {
  analizaCarga,
  type DepsAnaliza,
  type EscritoVision,
  type EventoVision,
  type ValidacionExistente,
} from "../../../src/vision/analiza";
import type { LecturaVision } from "../../../src/vision/fusion";
import { TOOL_LECTURA, type VisionPrompt } from "../../../src/vision/prompt";
import type { ImagenPreparada } from "../../../src/vision/resize";

// Lambda de visión IA (Fase 1). Dos modos:
//  - EVENTO (invoke asíncrono del receptor): analiza UNA carga {tenantId, loadId, fnames}.
//  - REPROCESO (invocación directa, Tarea 6): lotes del histórico — aún no implementado.
// Toda la lógica de decisión vive en src/vision/analiza.ts (pura, testeada); aquí solo
// se proveen las dependencias reales (S3, Bedrock, data client).

const s3 = new S3Client({});
const BUCKET = process.env.CAPTURE_BUCKET ?? "";
const TENANT = process.env.OPS_TENANT_ID ?? "gpa";
const MODELO = process.env.MODELO_VISION ?? "anthropic.claude-sonnet-5";
const REGION = process.env.BEDROCK_REGION ?? "us-east-1";

// ── Amplify data client (lazy, IAM) — mismo patrón que el receptor ──
let configured = false;
let dataClient: ReturnType<typeof generateClient<Schema>> | null = null;
async function getDataClient() {
  if (!configured) {
    const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(
      env as unknown as Parameters<typeof getAmplifyDataClientConfig>[0],
    );
    Amplify.configure(resourceConfig, libraryOptions);
    configured = true;
  }
  if (!dataClient) dataClient = generateClient<Schema>({ authMode: "iam" });
  return dataClient;
}

type GraphqlErrors = Array<{ errorType?: string; message?: string }> | undefined;
function isConditionalCheckFailed(errors: GraphqlErrors): boolean {
  return (errors ?? []).some((e) =>
    `${e.errorType ?? ""} ${e.message ?? ""}`.includes("ConditionalCheckFailed"),
  );
}

// ── Dependencias reales de analizaCarga ──

/** Bytes de photos/{tenant}/{fname} — null si el objeto no existe (copia tolerante a fallo). */
async function bajaFoto(fname: string): Promise<Buffer | null> {
  try {
    const r = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        // Regla del proyecto: los fnames en photos/ SIEMPRE en minúsculas (S3 es case-sensitive).
        Key: `photos/${TENANT}/${fname.toLowerCase()}`,
      }),
    );
    const bytes = await r.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  } catch (e) {
    const nombre = (e as { name?: string }).name ?? "";
    if (nombre === "NoSuchKey" || nombre === "NotFound") return null;
    throw e;
  }
}

/** Una sola llamada a Bedrock: fotos etiquetadas + tool use FORZADO (registrar_lectura). */
async function llamaBedrock(
  prompt: VisionPrompt,
  imagenes: ImagenPreparada[],
): Promise<LecturaVision> {
  const anthropic = new AnthropicBedrockMantle({ awsRegion: REGION });
  const contenido: unknown[] = imagenes.flatMap((img, i) => [
    { type: "text", text: `Foto ${i + 1}:` },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: img.mediaType,
        data: img.data.toString("base64"),
      },
    },
  ]);
  contenido.push({ type: "text", text: prompt.texto });

  const res = await anthropic.messages.create({
    model: MODELO,
    max_tokens: 2048,
    system: prompt.system,
    tools: [TOOL_LECTURA as never],
    tool_choice: { type: "tool", name: TOOL_LECTURA.name },
    messages: [{ role: "user", content: contenido as never }],
  });

  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(`Bedrock no devolvió tool_use (stop: ${res.stop_reason})`);
  }
  return toolUse.input as LecturaVision;
}

async function leeValidacion(loadId: string): Promise<ValidacionExistente | null> {
  const client = await getDataClient();
  const model = client.models.ValidacionCarga as unknown as {
    get: (k: never) => Promise<{
      data?: { tsVision?: string | null; visionDetalle?: unknown } | null;
    }>;
  };
  const r = await model.get({ tenantId: TENANT, loadId } as never);
  if (!r.data) return null;
  let detalle: { fnames?: string[] } | null = null;
  try {
    const crudo = r.data.visionDetalle;
    detalle =
      typeof crudo === "string" ? (JSON.parse(crudo) as { fnames?: string[] }) : (crudo as never);
  } catch {
    detalle = null;
  }
  return { tsVision: r.data.tsVision, visionDetalle: detalle };
}

/**
 * Persistencia de la lectura: create-if-absent → update PARCIAL con SOLO campos de
 * visión. Jamás toca verdictGlobal / porEvidencia / fuenteDeteccion / kmDetectado —
 * el veredicto es de humanos y del puente; la autoría de la lectura vive en tsVision.
 */
async function escribeVision(loadId: string, campos: EscritoVision): Promise<void> {
  const client = await getDataClient();
  const model = client.models.ValidacionCarga as unknown as {
    create: (i: never) => Promise<{ errors?: GraphqlErrors }>;
    update: (i: never) => Promise<{ errors?: GraphqlErrors }>;
  };
  const input = {
    tenantId: TENANT,
    loadId,
    montoDetectado: campos.montoDetectado,
    litrosDetectado: campos.litrosDetectado,
    precioDetectado: campos.precioDetectado,
    fechaDetectada: campos.fechaDetectada,
    nivelDetectado: campos.nivelDetectado,
    confianzaVision: campos.confianzaVision,
    tsVision: campos.tsVision,
    modeloVision: campos.modeloVision,
    visionDetalle: JSON.stringify(campos.visionDetalle),
  };
  const created = await model.create(input as never);
  if (!created.errors) return;
  if (!isConditionalCheckFailed(created.errors)) {
    throw new Error(`ValidacionCarga.create: ${JSON.stringify(created.errors)}`);
  }
  const upd = await model.update(input as never);
  if (upd.errors) throw new Error(`ValidacionCarga.update: ${JSON.stringify(upd.errors)}`);
}

function depsReales(): DepsAnaliza {
  return {
    bajaFoto,
    llamaBedrock,
    leeValidacion,
    escribeVision,
    ahora: () => new Date().toISOString(),
    modelo: MODELO,
  };
}

// ── Entry point ──

export const handler = async (event: unknown): Promise<unknown> => {
  const ev = (event ?? {}) as Partial<EventoVision> & { reproceso?: boolean };

  if (ev.reproceso) {
    // Tarea 6 del plan: modo batch por invocación directa sobre el histórico.
    return { error: "modo reproceso aún no implementado (Tarea 6)" };
  }

  if (!ev.loadId || !ev.fnames) {
    console.warn("[vision] evento sin loadId/fnames — ignorado");
    return { estado: "ignorado" };
  }

  const r = await analizaCarga(ev as EventoVision, depsReales());
  console.info(
    `[vision] ${ev.loadId}: ${r.estado}` +
      (r.faltantes.length ? ` (faltantes: ${r.faltantes.join(", ")})` : ""),
  );
  return r;
};
