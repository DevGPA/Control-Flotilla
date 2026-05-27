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

// API MoreApp para descargar fotos. La key se inyecta como secret (env MOREAPP_API_KEY).
// Si está vacía, las fotos se saltan (la data igual se ingiere).
const MOREAPP_API_BASE = "https://api.moreapp.com/api/v1.0";
const API_KEY = process.env.MOREAPP_API_KEY ?? "";

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

type PhotoRec = { group: string; col: string; fname: string };

/**
 * Descarga las fotos (`gridfs://registrationFiles/<uuid>`) de las respuestas vía
 * la API de MoreApp y las sube a S3 `photos/{tenantId}/`. Devuelve los registros
 * {group, col, fname} para el render legacy. Si no hay API key, salta (devuelve []).
 */
async function downloadPhotos(
  customerId: string,
  answers: Record<string, unknown>,
  placa: string,
  tenantId: string,
): Promise<PhotoRec[]> {
  if (!API_KEY) {
    console.warn("[moreapp-webhook] sin MOREAPP_API_KEY — fotos omitidas");
    return [];
  }
  const refs = Object.entries(answers)
    .filter(([, v]) => typeof v === "string" && (v as string).startsWith("gridfs://"))
    .map(([dn, v]) => ({ dn, uuid: (v as string).split("/").pop() ?? "" }))
    .filter((t) => t.uuid);

  // Descarga + sube todas las fotos del envío en paralelo (acelera el backfill).
  const settled = await Promise.all(
    refs.map(async ({ dn, uuid }): Promise<PhotoRec | null> => {
      try {
        const r = await fetch(
          `${MOREAPP_API_BASE}/customers/${customerId}/registrationFile/${uuid}/download`,
          { headers: { "X-Api-Key": API_KEY } },
        );
        if (!r.ok) {
          console.warn(`[moreapp-webhook] foto ${dn} download HTTP ${r.status}`);
          return null;
        }
        const ct = r.headers.get("content-type") || "image/jpeg";
        const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
        const buf = Buffer.from(await r.arrayBuffer());
        const fname = `moreapp_${placa}_${dn}.${ext}`.toLowerCase().replace(/[^a-z0-9._-]/g, "_");
        await s3.send(
          new PutObjectCommand({
            Bucket: BUCKET,
            Key: `photos/${tenantId}/${fname}`,
            Body: buf,
            ContentType: ct,
          }),
        );
        return { group: "Inspección Mensual", col: dn, fname };
      } catch (e) {
        console.warn(`[moreapp-webhook] foto ${dn} error:`, (e as Error).message);
        return null;
      }
    }),
  );
  const photos = settled.filter((p): p is PhotoRec => p !== null);
  console.info(`[moreapp-webhook] ${photos.length} fotos subidas para ${placa}`);
  return photos;
}

/** Trae una página (50) de submissions del mensual en un rango de fechas. */
async function fetchMensualPage(
  page: number,
  fromMs: number,
  toMs: number,
): Promise<{ totalSize: number; elements: Array<Record<string, unknown>> }> {
  const r = await fetch(
    `${MOREAPP_API_BASE}/customers/14922/forms/${MENSUAL_FORM_ID}/submissions/filter/${page}`,
    {
      method: "POST",
      headers: { "X-Api-Key": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: [{ path: "info.date", type: "date", value: { start: fromMs, end: toMs } }],
      }),
    },
  );
  if (!r.ok) throw new Error(`filter page ${page} HTTP ${r.status}`);
  return (await r.json()) as { totalSize: number; elements: Array<Record<string, unknown>> };
}

/**
 * Backfill por lotes: procesa `count` submissions desde el índice global `cursor`
 * (ene-2026 → hoy). Cada element de la API equivale al envelope del webhook
 * (element.data = answers, element.info = info), así que reusa processMensual.
 * Devuelve cursor de avance; el caller llama en loop hasta done.
 */
async function runBackfill(
  cursor: number,
  count: number,
): Promise<{
  cursor: number;
  processed: number;
  results: { placa?: string; error?: string }[];
  totalSize: number;
  nextCursor: number;
  done: boolean;
}> {
  if (!API_KEY) throw new Error("sin MOREAPP_API_KEY");
  const fromMs = Date.parse("2026-01-01T00:00:00Z");
  const toMs = Date.now();
  const page = Math.floor(cursor / 50);
  const within = cursor % 50;
  const data = await fetchMensualPage(page, fromMs, toMs);
  const elements = data.elements ?? [];
  const slice = elements.slice(within, within + count);
  const results: { placa?: string; error?: string }[] = [];
  for (const el of slice) {
    try {
      const { placa } = await processMensual(el, "14922");
      results.push({ placa });
    } catch (e) {
      results.push({ error: (e as Error).message });
    }
  }
  const nextCursor = cursor + slice.length;
  return {
    cursor,
    processed: slice.length,
    results,
    totalSize: data.totalSize ?? 0,
    nextCursor,
    done: slice.length === 0 || nextCursor >= (data.totalSize ?? 0),
  };
}

/** Procesa un envío del form mensual → upsert Unit + Checklist. */
async function processMensual(
  envelope: Record<string, unknown>,
  customerId: string,
): Promise<{ placa: string }> {
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

  // Descarga fotos (gridfs://) → S3 + registros para el render. Salta si no hay API key.
  const photos = await downloadPhotos(customerId, answers, placa, TENANT_ID);

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
    photos,
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

  if (method === "GET" && event.queryStringParameters?.diag === "1") {
    // Diagnóstico read-only: cuenta submissions del mensual en MoreApp por rango,
    // SIN escribir. Compara la verdad de MoreApp contra los Checklist que existirían.
    if (!API_KEY) return res(200, { error: "sin MOREAPP_API_KEY" });
    const from = event.queryStringParameters?.from ?? "2026-01-01";
    const to = event.queryStringParameters?.to ?? new Date().toISOString().slice(0, 10);
    const fromMs = Date.parse(`${from}T00:00:00Z`);
    const toMs = Date.parse(`${to}T23:59:59Z`);
    const rows: { placa: string; fecha: string }[] = [];
    let sinPlaca = 0;
    let total = 0;
    let page = 0;
    while (page < 100) {
      const data = await fetchMensualPage(page, fromMs, toMs);
      const els = data.elements ?? [];
      if (!els.length) break;
      for (const el of els) {
        total++;
        const answers = (el.data ?? {}) as Record<string, unknown>;
        const eco = (answers.economico ?? {}) as Record<string, unknown>;
        const placa = pickStr(eco.PLACAS).trim();
        const fechaRaw = pickStr(answers.dateAndTime);
        const fecha = fechaRaw.split(/[ T]/)[0] || "(sin fecha)";
        if (!placa) sinPlaca++;
        rows.push({ placa: placa || "(sin placa)", fecha });
      }
      if ((page + 1) * 50 >= (data.totalSize ?? 0)) break;
      page++;
    }
    const placas = new Set<string>();
    const placaFecha = new Set<string>();
    const pfCount = new Map<string, number>();
    const porMesTotal = new Map<string, number>();
    const porMesPF = new Map<string, Set<string>>();
    for (const r of rows) {
      placas.add(r.placa);
      const pf = `${r.placa}__${r.fecha}`;
      placaFecha.add(pf);
      pfCount.set(pf, (pfCount.get(pf) ?? 0) + 1);
      const mes = r.fecha.slice(0, 7);
      porMesTotal.set(mes, (porMesTotal.get(mes) ?? 0) + 1);
      if (!porMesPF.has(mes)) porMesPF.set(mes, new Set());
      porMesPF.get(mes)!.add(pf);
    }
    const colisiones = [...pfCount.entries()]
      .filter(([, n]) => n > 1)
      .map(([pf, n]) => ({ pf, n }));
    const porMes = [...porMesTotal.keys()].sort().map((mes) => ({
      mes,
      total: porMesTotal.get(mes) ?? 0,
      distinctPlacaFecha: porMesPF.get(mes)?.size ?? 0,
    }));
    return res(200, {
      from,
      to,
      total,
      sinPlaca,
      distinctPlaca: placas.size,
      distinctPlacaFecha: placaFecha.size,
      colisiones,
      porMes,
      items: rows.slice(0, 400),
    });
  }

  if (method === "GET" && event.queryStringParameters?.backfill === "1") {
    // Backfill por lotes del mensual (ene-2026 → hoy). ?cursor=K&count=C
    const cursor = parseInt(event.queryStringParameters?.cursor ?? "0", 10) || 0;
    const count = parseInt(event.queryStringParameters?.count ?? "3", 10) || 3;
    try {
      const out = await runBackfill(cursor, count);
      return res(200, out);
    } catch (e) {
      return res(200, { ok: false, error: (e as Error).message });
    }
  }

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

  const customerId = pickStr(body.customerId) || "14922";
  try {
    const { placa } = await processMensual(envelope, customerId);
    console.info(`[moreapp-webhook] mensual ingerido placa=${placa}`);
    return res(200, { ok: true, ingested: placa });
  } catch (e) {
    console.error("[moreapp-webhook] error ingiriendo mensual:", (e as Error).message);
    // 200 para que MoreApp no reintente en loop por un error de mapeo nuestro.
    return res(200, { ok: false, error: (e as Error).message });
  }
};
