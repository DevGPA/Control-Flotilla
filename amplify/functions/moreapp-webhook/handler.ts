import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/moreapp-webhook";
import { analyzeRow } from "../../../src/analyzer/analyzeRow";
import type { ExcelRow } from "../../../src/types";
import type { Schema } from "../../data/resource";

// FASE 2 — mapper. POST: rutea por formId; el mensual ROF se mapea a Unit+Checklist
// (reusando analyzeRow, el clasificador canónico) y se escribe en DynamoDB vía IAM.
// Otros forms (gasolina/semanal) se ignoran (200). Sigue guardando crudo en S3 (auditoría).
// GET ?all=1 / ?key= sigue para inspección.

const s3 = new S3Client({});
const BUCKET = process.env.CAPTURE_BUCKET ?? "";
const TOKEN = process.env.WEBHOOK_TOKEN ?? "";
const TENANT_ID = process.env.MOREAPP_TENANT_ID ?? "";
const SIGNING_SECRET = process.env.MOREAPP_SIGNING_SECRET ?? "";
const PREFIX = "moreapp-capture/";
const MENSUAL_FORM_ID = "687aa9b5a443e15d45370dfc";

// ── Amplify data client (lazy, IAM auth) ──────────────────────
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

// dataName (MoreApp) → nombre de columna Excel que espera analyzeRow.
const FIELD_MAP: Record<string, string> = {
  kilometraje: "Kilometraje",
  kilometrajeDelSiguienteServicio: "Kilometraje del siguiente servicio",
  fechaEstimadaDelSiguienteServicio: "Fecha estimada del siguiente servicio",
  nivelTACODeLlantaPilotoDelantera: "Nivel TACO de llanta piloto delantera",
  nivelTACODeLlantaCopilotoDelantera: "Nivel TACO de llanta copiloto delantera",
  nivelTACODeLlantaPilotoTrasera: "Nivel TACO de llanta piloto trasera",
  nivelTACODeLlantaPilotoTraseraINTERNA: "Nivel TACO de llanta piloto trasera INTERNA",
  nivelTACODeLlantaCopilotoTrasera: "Nivel TACO de llanta copiloto trasera",
  nivelTACODeLlantaCopilotoTraseraINTERNA: "Nivel TACO de llanta copiloto trasera INTERNA",
  nivelTACODeLlantaREFACCION: "Nivel TACO de llanta REFACCION",
  cuentaConLlantaDeRefaccin: "Cuenta con llanta de Refacción?",
  cuentaConLlantaPilotoTraseraINTERNA: "¿Cuenta con Llanta Piloto trasera INTERNA?",
  cuentaConLlantaCopilotoTraseraINTERNA: "¿Cuenta con Llanta Copiloto trasera INTERNA?",
  lucesYCuartosDelanterosFuncionando: "Luces y cuartos delanteros funcionando",
  cinturonesDeSeguridadFuncionandoTodos: "Cinturones de seguridad funcionando (todos)",
  carroceriaSinGolpesORaspaduras: "Carroceria con golpes o raspaduras",
  espejosLateralesEnBuenEstado: "Espejos laterales en buen estado",
  cristalesEnBuenasCondiciones: "Cristales en buenas condiciones",
  taponDeLaGasolina: "Tapon de la gasolina",
  bocinaDelClaxonFuncionando: "Bocina del claxon funcionando",
  limpiaParaBrisasFuncionandoCorrectamente: "Limpia parabrisas funcionando correctamente",
  tacometroEnBuenasCondiciones: "Tacometro en buenas condiciones",
  espejoRetrovisorEnBuenasCondiciones: "Espejo retrovisor en buenas condiciones",
  lucesInterioresFuncionando: "Luces interiores funcionando",
  asientosEnBuenEstado: "Asientos en buen estado",
  tapetesCompletos: "Tapetes completos",
  gatoAdecuadoParaElVehiculoYSuPalanca: "Gato adecuado para el vehiculo y su palanca",
  llaveDeCruzOPalancaAcordeALosBirlosDeLasLlantas:
    "Llave de cruz o palanca acorde a los birlos de las llantas",
  trianguloDeSeguridad: "Triangulo de seguridad",
  cablesPasaCorriente: "Cables pasa corriente",
  nivelDeLiquidoDeFrenosMax: "Nivel de liquido de frenos max",
  nivelDeAceiteDeMotorMax: "Nivel de aceite de motor max",
  nivelDeLiquidoDeRadiadorMax: "Nivel de liquido de radiador max",
  nivelDeAceiteDeDireccionMax: "Nivel de aceite de direccion max",
  licenciaDeChoferAcordeAVehiculoVigente: 'Licencia de "chofer" acorde a vehiculo vigente',
  tarjetaDeCirculacionVigente: "Tarjeta de circulacion vigente",
  polizaDeSeguroVigente: "Poliza de seguro vigente",
  calcomoniaDeRefrendoVehicular: "Calcomonia de refrendo vehicular",
  tarjetacalcamoniaDeVerificacionAmbientalVigente:
    "Tarjeta/calcamonia de verificacion ambiental vigente",
  calcamoniaDeUltimoServicioEnParabrisas: "Calcamonia de ultimo servicio (en parabrisas)",
};

function res(status: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function streamToString(stream: unknown): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/** Valida firma HMAC `moreapp-signature: t=<ts>, v1=<hex>`. Best-effort: si no hay secret, true. */
function verifySignature(sigHeader: string | undefined, rawBody: string): boolean {
  if (!SIGNING_SECRET) return true; // sin secret configurado → solo token protege
  if (!sigHeader) return false;
  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) =>
      p
        .trim()
        .split("=")
        .map((s) => s.trim()),
    ),
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  const expected = createHmac("sha256", SIGNING_SECRET).update(`${t}.${rawBody}`).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch {
    return false;
  }
}

function pickStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return "";
  return String(v).trim();
}

/** Construye un ExcelRow desde data.data usando FIELD_MAP + lookup economico. */
function buildRow(answers: Record<string, unknown>): ExcelRow {
  const row: ExcelRow = {};
  for (const [dn, col] of Object.entries(FIELD_MAP)) {
    const v = answers[dn];
    if (v === null || v === undefined) continue;
    row[col] = typeof v === "object" ? JSON.stringify(v) : (v as string | number);
  }
  const eco = answers.economico;
  if (eco && typeof eco === "object") {
    const e = eco as Record<string, unknown>;
    if (e.PLACAS) row["# Economico - PLACAS"] = String(e.PLACAS);
    if (e.id) row["# Economico - id"] = String(e.id);
    if (e.SUBMARCA) row["# Economico - SUBMARCA"] = String(e.SUBMARCA);
    if (e.SUCURSAL) row["# Economico - SUCURSAL"] = String(e.SUCURSAL);
  }
  return row;
}

function isConditionalCheckFailed(
  errors: readonly { errorType?: string; message?: string }[] | undefined,
): boolean {
  if (!errors) return false;
  return errors.some(
    (e) =>
      e.errorType === "DynamoDB:ConditionalCheckFailedException" ||
      (e.message ?? "").includes("ConditionalCheckFailed"),
  );
}

/** Procesa un envío del form mensual → upsert Unit + Checklist. */
async function processMensual(envelope: Record<string, unknown>): Promise<{ placa: string }> {
  const answers = (envelope.data ?? {}) as Record<string, unknown>;
  const eco = (answers.economico ?? {}) as Record<string, unknown>;
  const placa = pickStr(eco.PLACAS);
  if (!placa) throw new Error("Sin placa (economico.PLACAS) — no se puede identificar la unidad");

  const ecoId = pickStr(eco.id);
  const client = await getDataClient();

  // 1. Unit (idempotente por tenantId+placa)
  const unitInput = {
    tenantId: TENANT_ID,
    placa,
    economicoId: ecoId && ecoId !== placa ? ecoId : undefined,
    marca: pickStr(eco.SUBMARCA) || undefined,
    sucursal: pickStr(eco.SUCURSAL) || undefined,
  };
  const uCreated = await client.models.Unit.create(unitInput);
  if (uCreated.errors) {
    if (isConditionalCheckFailed(uCreated.errors)) {
      const uUpd = await client.models.Unit.update(unitInput);
      if (uUpd.errors) throw new Error(`Unit.update: ${JSON.stringify(uUpd.errors)}`);
    } else {
      throw new Error(`Unit.create: ${JSON.stringify(uCreated.errors)}`);
    }
  }

  // 2. Checklist (1 por unidad por fecha). Reusa analyzeRow (canon).
  const row = buildRow(answers);
  const analyzed = analyzeRow(row as Parameters<typeof analyzeRow>[0]);
  const fechaRaw = pickStr(answers.dateAndTime);
  const fecha = fechaRaw.split(/[ T]/)[0] || new Date().toISOString().split("T")[0]!;

  const responsableRaw = answers.nombreDelChoferQueRegistraDatos;
  const responsable =
    responsableRaw && typeof responsableRaw === "object"
      ? pickStr((responsableRaw as Record<string, unknown>).RESPONSABLE)
      : pickStr(responsableRaw);
  const obs = [
    pickStr(answers.observaciones),
    pickStr(answers.reportesOComentariosEnGeneralSoloSiAplica),
  ]
    .filter(Boolean)
    .join("\n\n");

  const resultados = JSON.stringify({
    findings: analyzed.F,
    tires: analyzed.T,
    max: analyzed.max,
    risk: analyzed.max,
    minT: analyzed.minT ?? null,
    validationErrors: analyzed.validationErrors,
    obs,
    km: pickStr(answers.kilometraje),
    nextSvc: pickStr(answers.fechaEstimadaDelSiguienteServicio),
    kmNextSvc: pickStr(answers.kilometrajeDelSiguienteServicio),
    photos: [],
  });

  const clInput = {
    tenantId: TENANT_ID,
    unitUid: placa,
    fecha,
    tipoInspeccion: "mensual",
    resultados,
    responsable,
  };
  const cCreated = await client.models.Checklist.create(clInput);
  if (cCreated.errors) {
    if (isConditionalCheckFailed(cCreated.errors)) {
      const cUpd = await client.models.Checklist.update(clInput);
      if (cUpd.errors) throw new Error(`Checklist.update: ${JSON.stringify(cUpd.errors)}`);
    } else {
      throw new Error(`Checklist.create: ${JSON.stringify(cCreated.errors)}`);
    }
  }
  return { placa };
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext?.http?.method ?? "POST";
  const token = event.queryStringParameters?.t ?? "";
  if (!TOKEN || token !== TOKEN) return res(401, { error: "unauthorized" });

  if (method === "GET") {
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX }));
    const items = (listed.Contents ?? [])
      .filter((o) => o.Key && o.Key !== PREFIX)
      .sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0));
    if (items.length === 0) return res(200, { captures: 0, latest: null });
    const readKey = async (k: string) => {
      const o = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: k }));
      return JSON.parse(await streamToString(o.Body));
    };
    const wantKey = event.queryStringParameters?.key;
    const wantAll = event.queryStringParameters?.all === "1";
    const keys = items.slice(0, 20).map((o) => o.Key!);
    if (wantKey) return res(200, { captures: items.length, keys, payload: await readKey(wantKey) });
    if (wantAll) {
      const top = items.slice(0, 10).map((o) => o.Key!);
      const payloads = await Promise.all(top.map((k) => readKey(k)));
      return res(200, {
        captures: items.length,
        keys,
        all: top.map((k, i) => ({ key: k, payload: payloads[i] })),
      });
    }
    return res(200, {
      captures: items.length,
      latestKey: items[0]!.Key!,
      keys,
      payload: await readKey(items[0]!.Key!),
    });
  }

  // POST — webhook real de MoreApp.
  const raw =
    event.isBase64Encoded && event.body
      ? Buffer.from(event.body, "base64").toString("utf-8")
      : (event.body ?? "");

  // Auditoría: guarda crudo en S3 (todos los forms).
  const auditKey = `${PREFIX}${Date.now()}.json`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: auditKey,
      Body: JSON.stringify(
        { receivedAt: new Date().toISOString(), headers: event.headers, bodyRaw: raw },
        null,
        2,
      ),
      ContentType: "application/json",
    }),
  );

  if (!verifySignature(event.headers?.["moreapp-signature"], raw)) {
    console.warn("[moreapp-webhook] firma HMAC inválida");
    return res(401, { error: "invalid signature" });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return res(400, { error: "invalid json" });
  }

  const envelope = (body.data ?? {}) as Record<string, unknown>;
  const info = (envelope.info ?? {}) as Record<string, unknown>;
  const formId = pickStr(info.formId);

  if (formId !== MENSUAL_FORM_ID) {
    console.info(`[moreapp-webhook] ignorado formId=${formId} (no mensual)`);
    return res(200, { ok: true, ignored: formId });
  }

  try {
    const { placa } = await processMensual(envelope);
    console.info(`[moreapp-webhook] mensual ingerido placa=${placa}`);
    return res(200, { ok: true, ingested: placa });
  } catch (e) {
    console.error("[moreapp-webhook] error ingiriendo mensual:", (e as Error).message);
    // 200 para que MoreApp no reintente en loop por un error de mapeo nuestro.
    return res(200, { ok: false, error: (e as Error).message });
  }
};
