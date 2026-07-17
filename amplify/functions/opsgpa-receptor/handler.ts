import {
  CopyObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/opsgpa-receptor";
import type { Schema } from "../../data/resource";
import { nombreEvidencia, inputSinCampos, normalizarArea } from "../../../src/opsgpa/contract";
import type { OpsCargaRecord, OpsClRecord, OpsSolRecord } from "../../../src/opsgpa/contract";
import {
  toOpsRecord,
  validarEvento,
  verificarFirma,
  type GpaOpsEvento,
} from "../../../src/opsgpa/evento";
import { mapCombustible } from "../../../src/opsgpa/mapCarga";
import {
  mapValidacion,
  OPS_FUENTE_DETECCION,
  type ValidacionCargaInput,
} from "../../../src/opsgpa/mapValidacion";
import {
  mapSemanal,
  mapMensual,
  type SemanalInput,
  type UnitInput,
} from "../../../src/opsgpa/mapChecklist";
import {
  runBackfill,
  type BackfillRequest,
  type BackfillResumen,
} from "../../../src/opsgpa/backfill";
import type { CargaCombustibleInput } from "../../../src/opsgpa/contract";

// Receptor del puente gpa.ops.v1 (ver src/opsgpa/README.md y el contrato en el repo
// Eco-Admin: Operaciones-GPA/bridge/CONTRATO-gpa.ops.v1.md). Flujo por POST:
// verificar firma → validar contrato → archivar crudo (ops-capture/) → copiar
// evidencias S3→S3 (idempotente) → mapear con los adaptadores probados → upsert
// idempotente (mismo patrón create→update del webhook MoreApp). Errores de negocio
// responden 422: el publisher los reintenta y terminan VISIBLES en su DLQ.

const s3 = new S3Client({});
const ddb = new DynamoDBClient({});
const BUCKET = process.env.CAPTURE_BUCKET ?? ""; // bucket de FC (fotos + capturas)
const OPS_BUCKET = process.env.OPS_EVIDENCIAS_BUCKET ?? "";
const OPS_TABLE = process.env.OPS_TABLE ?? "gpa_operaciones_prod";
const SECRET = process.env.OPS_BRIDGE_SECRET ?? "";
const TENANT = process.env.OPS_TENANT_ID ?? "gpa";
const CAPTURE_PREFIX = "ops-capture/";

// ── Amplify data client (lazy, IAM) — mismo patrón que el webhook ──
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

function res(status: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

type GraphqlErrors = Array<{ errorType?: string; message?: string }> | undefined;
function isConditionalCheckFailed(errors: GraphqlErrors): boolean {
  return (errors ?? []).some((e) =>
    `${e.errorType ?? ""} ${e.message ?? ""}`.includes("ConditionalCheckFailed"),
  );
}

/**
 * Upsert idempotente create→update (mismo patrón que process* del webhook).
 * `omitirEnUpdate`: campos que se escriben SOLO al CREAR (no se pisan en unidades ya
 * existentes). Se usa con `["sucursal"]` en Unit — el admin de FC manda sobre la
 * sucursal (unidades que se trasladan entre sucursales); la ingesta ya no la revierte
 * (2026-07-17, decisión "sucursal editable-admin").
 */
async function upsert(
  modelo: "CargaCombustible" | "Unit" | "Semanal" | "Checklist",
  input: Record<string, unknown>,
  omitirEnUpdate: string[] = [],
): Promise<void> {
  const client = await getDataClient();
  const model = client.models[modelo] as unknown as {
    create: (i: never) => Promise<{ errors?: GraphqlErrors }>;
    update: (i: never) => Promise<{ errors?: GraphqlErrors }>;
  };
  const created = await model.create(input as never);
  if (created.errors) {
    if (isConditionalCheckFailed(created.errors)) {
      const upd = await model.update(inputSinCampos(input, omitirEnUpdate) as never);
      if (upd.errors) throw new Error(`${modelo}.update: ${JSON.stringify(upd.errors)}`);
    } else {
      throw new Error(`${modelo}.create: ${JSON.stringify(created.errors)}`);
    }
  }
}

// ── Área de la unidad desde el catálogo de Ops (CAT#VEHICLE.responsable) ──
// Fuente ÚNICA y completa del área: la `areaResponsable` por-carga viene vacía ~80%,
// así que NO sirve para mantener el campo. El catálogo tiene 100% de cobertura. Se
// cachea por invocación (1 Query a Ops por contenedor, reutilizada en todo el batch del
// backfill). Ops manda sobre el área: se escribe en create Y update (a diferencia de
// sucursal, que solo se escribe en create). Decisión 2026-07-17 "área automática".
let areasOps: Map<string, string> | null = null;
const ecoNorm = (e: unknown): string =>
  String(e ?? "")
    .trim()
    .replace(/^0+/, "") || "0";
async function cargarAreasOps(): Promise<Map<string, string>> {
  if (areasOps) return areasOps;
  const m = new Map<string, string>();
  let cursor: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: OPS_TABLE,
        KeyConditionExpression: "PK = :p",
        ExpressionAttributeValues: { ":p": { S: "CAT#VEHICLE" } },
        ExclusiveStartKey: cursor as never,
      }),
    );
    for (const raw of r.Items ?? []) {
      const it = unmarshall(raw);
      const area = normalizarArea(it.responsable);
      if (area) m.set(ecoNorm(it.economico), area);
    }
    cursor = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (cursor);
  areasOps = m;
  return m;
}

/** Estampa `unit.area` desde el catálogo de Ops (solo si Ops la tiene; nunca la vacía). */
async function estampaArea(unit: UnitInput): Promise<UnitInput> {
  const area = (await cargarAreasOps()).get(ecoNorm(unit.economicoId));
  if (area) unit.area = area;
  return unit;
}

/**
 * Upsert de ValidacionCarga con REGLA DE NO-PISADO: si ya existe un veredicto y NO fue
 * escrito por el puente (fuenteDeteccion ≠ "ops-gpa"), es de un humano de tesorería en
 * FC y se respeta — el puente jamás lo sobreescribe (auditoría selectiva conserva la
 * última palabra).
 */
async function upsertValidacion(input: ValidacionCargaInput): Promise<void> {
  const client = await getDataClient();
  const model = client.models.ValidacionCarga as unknown as {
    create: (i: never) => Promise<{ errors?: GraphqlErrors }>;
    update: (i: never) => Promise<{ errors?: GraphqlErrors }>;
    get: (k: never) => Promise<{ data?: { fuenteDeteccion?: string | null } | null }>;
  };
  const created = await model.create(input as never);
  if (!created.errors) return;
  if (!isConditionalCheckFailed(created.errors)) {
    throw new Error(`ValidacionCarga.create: ${JSON.stringify(created.errors)}`);
  }
  const existente = await model.get({ tenantId: input.tenantId, loadId: input.loadId } as never);
  if (existente.data && existente.data.fuenteDeteccion !== OPS_FUENTE_DETECCION) {
    console.log(`validación humana respetada (no-pisado): ${input.loadId}`);
    return;
  }
  const upd = await model.update(input as never);
  if (upd.errors) throw new Error(`ValidacionCarga.update: ${JSON.stringify(upd.errors)}`);
}

// nombreEvidencia vive en src/opsgpa/contract.ts (pura, testeable) — SIEMPRE lowercase
// desde el fix 2026-07-14: el pipeline de fotos del front minusculiza antes de firmar
// y S3 es case-sensitive (fotos de Ops con camelCase salían rotas en el drawer).

/**
 * Copia una evidencia del bucket de Ops al de FC (idempotente por HeadObject).
 * TOLERANTE a fotos faltantes: si la copia falla (objeto ausente en el origen,
 * permiso, transitorio) se registra y se devuelve el MISMO nombre determinístico —
 * el dato del registro nunca se bloquea por una foto, y la referencia se auto-repara
 * en el siguiente backfill/re-entrega (la copia reintentará hacia el mismo nombre).
 */
async function copiarEvidencia(
  tipo: string,
  unidad: { economico?: string | null; placas?: string | null },
  campo: string,
  key: string,
): Promise<string> {
  const fname = nombreEvidencia(tipo, unidad, campo, key);
  const destino = `photos/${TENANT}/${fname}`;
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: destino }));
    return fname; // ya copiada (re-entrega del evento)
  } catch {
    /* no existe aún */
  }
  try {
    await s3.send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        Key: destino,
        CopySource: `${OPS_BUCKET}/${encodeURIComponent(key)}`,
      }),
    );
  } catch (e) {
    console.error(`evidencia NO copiada (${campo} ${key} → ${fname}): ${(e as Error).message}`);
  }
  return fname;
}

// ── Modo BACKFILL (invocación directa: aws lambda invoke --payload '{"backfill":true,...}') ──
// Lee la tabla de Ops vía GSI tipo-fecha (solo-lectura) y reingiere con los MISMOS
// adaptadores/upserts. Cierra el hueco del modo espera antes de activar la URL.
// Sin URL expuesta: solo credenciales AWS con lambda:InvokeFunction pueden dispararlo.
async function ejecutarBackfill(req: BackfillRequest): Promise<BackfillResumen> {
  return runBackfill(req, {
    leerPagina: async (tipo, cursor) => {
      const r = await ddb.send(
        new QueryCommand({
          TableName: OPS_TABLE,
          IndexName: "tipo-fecha-idx",
          KeyConditionExpression: "GSI1PK = :t",
          ExpressionAttributeValues: { ":t": { S: tipo } },
          ExclusiveStartKey: cursor as never,
        }),
      );
      return {
        items: (r.Items ?? []).map((i) => unmarshall(i)),
        siguiente: r.LastEvaluatedKey as Record<string, unknown> | undefined,
      };
    },
    copiarEvidencia: (tipo, unidad, campo, key) => copiarEvidencia(tipo, unidad, campo, key),
    persistirCarga: async (input: CargaCombustibleInput) =>
      upsert("CargaCombustible", input as unknown as Record<string, unknown>),
    persistirSemanal: async (unit: UnitInput, semanal: SemanalInput) => {
      await estampaArea(unit);
      await upsert("Unit", unit as unknown as Record<string, unknown>, ["sucursal"]);
      await upsert("Semanal", semanal as unknown as Record<string, unknown>);
    },
    persistirChecklist: async (unit, checklist) => {
      await estampaArea(unit);
      await upsert("Unit", unit as unknown as Record<string, unknown>, ["sucursal"]);
      await upsert("Checklist", checklist as unknown as Record<string, unknown>);
    },
    persistirValidacion: (input) => upsertValidacion(input),
  });
}

export const handler = async (
  event: APIGatewayProxyEventV2 | BackfillRequest,
): Promise<APIGatewayProxyResultV2 | BackfillResumen> => {
  if ((event as BackfillRequest).backfill === true) {
    return ejecutarBackfill(event as BackfillRequest);
  }
  event = event as APIGatewayProxyEventV2;
  if (event.requestContext.http.method !== "POST") {
    return res(405, { error: "solo POST" });
  }

  const cuerpo = event.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf-8")
    : (event.body ?? "");

  // 1) Firma (fail-closed) — headers en minúsculas en API GW/Function URL v2.
  const v = verificarFirma(
    event.headers?.["x-gpa-timestamp"],
    event.headers?.["x-gpa-firma"],
    cuerpo,
    SECRET,
  );
  if (!v.ok) return res(401, { error: v.motivo });

  // 2) Parse + contrato.
  let evento: GpaOpsEvento;
  try {
    evento = JSON.parse(cuerpo) as GpaOpsEvento;
  } catch {
    return res(400, { error: "JSON inválido" });
  }
  const errores = validarEvento(evento);
  if (errores.length) return res(422, { errores });

  // 3) Auditoría cruda ANTES de mapear: todo evento queda re-procesable.
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: `${CAPTURE_PREFIX}${ts}-${evento.folio}.json`,
      Body: cuerpo,
      ContentType: "application/json",
    }),
  );

  try {
    // 4) Evidencias → bucket de FC, nombres determinísticos; resolver key→fname.
    // Perf F3-7: copias S3→S3 en PARALELO (antes secuenciales — la latencia del POST
    // era la suma de todas; con 4-6 evidencias por carga ahora se paga solo la más
    // lenta). Mismo patrón que downloadPhotos del webhook MoreApp.
    const fnames = new Map<string, string>();
    const copias: Promise<void>[] = (evento.evidencias ?? []).map(async ({ campo, key }) => {
      fnames.set(key, await copiarEvidencia(evento.tipo, evento.unidad, campo, key));
    });
    if (evento.firma) {
      const firmaKey = evento.firma;
      copias.push(
        (async () => {
          fnames.set(
            firmaKey,
            await copiarEvidencia(evento.tipo, evento.unidad, "firma", firmaKey),
          );
        })(),
      );
    }
    await Promise.all(copias);
    const resolver = (key: string): string => fnames.get(key) ?? key;

    // 5) Mapear con los adaptadores probados y persistir con upsert idempotente.
    const plano = toOpsRecord(evento);
    if (evento.tipo === "SOL") {
      const input = mapCombustible(plano as OpsSolRecord | OpsCargaRecord, resolver);
      await upsert("CargaCombustible", input as unknown as Record<string, unknown>);
      // Validación en origen (decisión 2026-07-10): la aprobación de Ops ES la
      // validación de FC. Con regla de no-pisado de veredictos humanos.
      const validacion = mapValidacion(plano as Record<string, unknown>, input);
      if (validacion) await upsertValidacion(validacion);
      return res(200, {
        folio: evento.folio,
        evento: evento.evento,
        destino: `CargaCombustible/${input.tipo}`,
        validada: validacion ? validacion.verdictGlobal : "pendiente",
      });
    }
    // CL mensual (2026-07-13): Unit + Checklist con analyzeRow (mismo pipeline que
    // el mensual de MoreApp — aparece en Inspecciones con riesgo/hallazgos/llantas).
    if ((plano as OpsClRecord).tipo === "mensual") {
      const { unit, checklist } = mapMensual(plano as OpsClRecord, resolver);
      await estampaArea(unit);
      await upsert("Unit", unit as unknown as Record<string, unknown>, ["sucursal"]);
      await upsert("Checklist", checklist as unknown as Record<string, unknown>);
      return res(200, { folio: evento.folio, evento: evento.evento, destino: "Checklist/mensual" });
    }
    // CL semanal (subtipos desconocidos → throw de mapSemanal → 422 visible en DLQ).
    const { unit, semanal } = mapSemanal(plano as OpsClRecord, resolver);
    await estampaArea(unit);
    await upsert("Unit", unit as unknown as Record<string, unknown>, ["sucursal"]);
    await upsert("Semanal", semanal as unknown as Record<string, unknown>);
    return res(200, { folio: evento.folio, evento: evento.evento, destino: "Semanal" });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    // Errores de negocio (sin económico/placa, tipo no implementado) → 422 reintentable
    // y visible en la DLQ del publisher. Errores de infraestructura → 500.
    const esNegocio = /no mapeable|no implementado|sin econ|sin placa/i.test(msg);
    console.error(`receptor ${evento.folio}: ${msg}`);
    return res(esNegocio ? 422 : 500, { error: msg, folio: evento.folio });
  }
};
