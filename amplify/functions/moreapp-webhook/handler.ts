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
const SEMANAL_FORM_ID = "687aa9caa4ea6a369e62fe05";

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
  group = "Inspección Mensual",
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
        return { group, col: dn, fname };
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

// ─── Riesgo semanal — réplica de la lógica del front (normFluid/Tire/estatus) ───
// Mantener en sync con Control de flotilla.html (normFluidRisk/normTireRisk/calcEstatusSemanal).
function norm(s: unknown): string {
  return String(s ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}
function normFluidRisk(val: unknown): string {
  const v = norm(val);
  if (!v) return "OK";
  const URG = [
    "vacio",
    "sin aceite",
    "sin refrigerante",
    "sin agua",
    "sin fluido",
    "fuga",
    "peligro",
    "agotado",
    "quemado",
    "no tiene aceite",
    "no tiene fluido",
    "perdida de aceite",
    "sin oil",
  ];
  if (URG.some((kw) => v.includes(kw))) return "Urgente";
  const OK = [
    "ok",
    "correcto",
    "correcta",
    "normal",
    "bien",
    "bueno",
    "buena",
    "optimo",
    "optima",
    "nivel optimo",
    "nivel optima",
    "maximo",
    "al tope",
    "lleno",
    "llena",
    "completo",
    "completa",
    "suficiente",
    "adecuado",
    "adecuada",
    "a nivel",
    "al nivel",
    "en nivel",
    "dentro de",
    "no presenta",
    "sin fuga",
    "sin novedad",
    "funciona",
    "operativo",
    "operativa",
    "limpio",
    "limpia",
    "verde",
    "no hay fuga",
    "estable",
    "perfecto",
    "perfecta",
  ];
  if (OK.some((kw) => v === kw || v.includes(kw))) return "OK";
  if (v === "si") return "OK";
  return "Revisar";
}
function normTireRisk(val: unknown): string {
  const v = norm(val);
  if (!v) return "OK";
  if (
    v === "no" ||
    v.startsWith("no ") ||
    v.includes("sin refacc") ||
    v.includes("sin llanta") ||
    v.includes("falta") ||
    v.includes("ponchad") ||
    v.includes("danad") ||
    v.includes("no funcional") ||
    v.includes("mala") ||
    v.includes("no hay")
  )
    return "Revisar";
  const OK = [
    "si",
    "funcional",
    "ok",
    "bueno",
    "buena",
    "tiene",
    "correcto",
    "correcta",
    "completa",
    "completo",
    "bien",
    "operativa",
    "operativo",
    "disponible",
    "infla",
    "buen estado",
    "lista",
  ];
  if (OK.some((kw) => v === kw || v.includes(kw))) return "OK";
  return "Revisar";
}
// "carroceriaSinGolpesORaspaduras": Si = sin golpes = OK; No = tiene golpes = Revisar.
function bodyRiskFromSiNo(val: unknown): string {
  const v = norm(val);
  if (!v || v === "si" || v.startsWith("si ")) return "OK";
  return "Revisar";
}
function calcEstatusSemanal(aceiteRisk: string, radiadorRisk: string): string {
  if (aceiteRisk === "Urgente" || radiadorRisk === "Urgente") return "Urgente";
  if (aceiteRisk === "Revisar" || radiadorRisk === "Revisar") return "Revisar";
  return "OK";
}
/** "2025-08-11 07:25" → "2025-W33" (semana ISO, igual que getISOWeek del front). */
function isoWeekId(dateStr: string): string {
  const d = new Date(String(dateStr).replace(" ", "T"));
  if (isNaN(d.getTime())) return "sin-fecha";
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const wk =
    1 +
    Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(wk).padStart(2, "0")}`;
}

/** Trae una página (50) de submissions de un form en un rango de fechas (info.date). */
async function fetchFormPage(
  formId: string,
  page: number,
  fromMs: number,
  toMs: number,
): Promise<{ totalSize: number; elements: Array<Record<string, unknown>> }> {
  const r = await fetch(
    `${MOREAPP_API_BASE}/customers/14922/forms/${formId}/submissions/filter/${page}`,
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

/** Página del form mensual (compat: delega en fetchFormPage). */
function fetchMensualPage(page: number, fromMs: number, toMs: number) {
  return fetchFormPage(MENSUAL_FORM_ID, page, fromMs, toMs);
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

/** Procesa un envío del form SEMANAL → upsert Unit + Semanal (por semana ISO). */
async function processSemanal(
  envelope: Record<string, unknown>,
  customerId: string,
): Promise<{ placa: string }> {
  const answers = (envelope.data ?? {}) as Record<string, unknown>;
  const eco = (answers.economico ?? {}) as Record<string, unknown>;
  const placa = pickStr(eco.PLACAS);
  if (!placa) throw new Error("Sin placa (economico.PLACAS) — semanal");

  const ecoId = pickStr(eco.id);
  const sucursal = pickStr(eco.SUCURSAL);
  const fechaRaw = pickStr(answers.dateAndTime);
  const periodoId = isoWeekId(fechaRaw);
  const client = await getDataClient();

  // 1. Unit (idempotente) — consistencia con el catálogo.
  const unitInput = {
    tenantId: TENANT_ID,
    placa,
    economicoId: ecoId && ecoId !== placa ? ecoId : undefined,
    marca: pickStr(eco.SUBMARCA) || undefined,
    sucursal: sucursal || undefined,
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

  // 2. Riesgos por categoría (réplica del front).
  const responsableRaw = answers.nombreDelChoferQueRegistraDatos;
  const responsable =
    responsableRaw && typeof responsableRaw === "object"
      ? pickStr((responsableRaw as Record<string, unknown>).RESPONSABLE)
      : pickStr(responsableRaw);
  const aceite = pickStr(answers.nivelDeAceiteDeMotorMax);
  const radiador = pickStr(answers.nivelDeLiquidoDeRadiadorMax);
  const carroceria = pickStr(answers.carroceriaSinGolpesORaspaduras);
  const llanta = pickStr(answers.llantaDeRefaccionFuncional);
  const aceiteRisk = normFluidRisk(aceite);
  const radiadorRisk = normFluidRisk(radiador);
  const carroceriaRisk = bodyRiskFromSiNo(carroceria);
  const llantaRisk = normTireRisk(llanta);
  const risk = calcEstatusSemanal(aceiteRisk, radiadorRisk);

  // 3. Fotos (gridfs → S3) → array de filenames (shape que espera el front).
  const photoRecs = await downloadPhotos(
    customerId,
    answers,
    placa,
    TENANT_ID,
    "Inspección Semanal",
  );
  const photos = photoRecs.map((p) => p.fname);

  const datos = {
    economicoId: ecoId,
    brand: pickStr(eco.SUBMARCA),
    km: pickStr(answers.kilometraje),
    fecha: fechaRaw,
    responsable,
    aceite,
    aceiteRisk,
    radiador,
    radiadorRisk,
    carroceria,
    carroceriaRisk,
    llanta,
    llantaRisk,
    risk,
    photos,
  };

  // 4. Semanal (idempotente por tenantId+periodoId+unitUid).
  const semInput = {
    tenantId: TENANT_ID,
    periodoId,
    sucursal,
    unitUid: placa,
    datos: JSON.stringify(datos),
  };
  const sCreated = await client.models.Semanal.create(semInput);
  if (sCreated.errors) {
    if (isConditionalCheckFailed(sCreated.errors)) {
      const sUpd = await client.models.Semanal.update(semInput);
      if (sUpd.errors) throw new Error(`Semanal.update: ${JSON.stringify(sUpd.errors)}`);
    } else {
      throw new Error(`Semanal.create: ${JSON.stringify(sCreated.errors)}`);
    }
  }
  return { placa };
}

/** Backfill por lotes del form SEMANAL (ene-2026 → hoy). Reusa processSemanal. */
async function runBackfillSemanal(
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
  const data = await fetchFormPage(SEMANAL_FORM_ID, page, fromMs, toMs);
  const elements = data.elements ?? [];
  const slice = elements.slice(within, within + count);
  const results: { placa?: string; error?: string }[] = [];
  for (const el of slice) {
    try {
      const { placa } = await processSemanal(el, "14922");
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

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext?.http?.method ?? "POST";
  const token = event.queryStringParameters?.t ?? "";
  if (!TOKEN || token !== TOKEN) return res(401, { error: "unauthorized" });

  if (method === "GET" && event.queryStringParameters?.sample === "1") {
    // Read-only: trae N envíos crudos de un form (default semanal) para inspeccionar
    // su estructura de campos (dataNames) y construir el mapeo. No escribe nada.
    if (!API_KEY) return res(200, { error: "sin MOREAPP_API_KEY" });
    const form = event.queryStringParameters?.form ?? SEMANAL_FORM_ID;
    const n = Math.min(parseInt(event.queryStringParameters?.n ?? "1", 10) || 1, 5);
    const r = await fetch(
      `${MOREAPP_API_BASE}/customers/14922/forms/${form}/submissions/filter/0`,
      {
        method: "POST",
        headers: { "X-Api-Key": API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ query: [] }),
      },
    );
    if (!r.ok) return res(200, { error: `HTTP ${r.status}`, form });
    const data = (await r.json()) as {
      totalSize?: number;
      elements?: Array<Record<string, unknown>>;
    };
    const els = (data.elements ?? []).slice(0, n);
    return res(200, {
      form,
      totalSize: data.totalSize ?? 0,
      samples: els.map((el) => ({
        id: el.id,
        info: el.info,
        dataKeys: Object.keys((el.data ?? {}) as Record<string, unknown>),
        data: el.data,
      })),
    });
  }

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

    // Compara contra DynamoDB: cuántos Checklist existen en el rango y cuáles faltan.
    const client = await getDataClient();
    const enDynamoPF = new Set<string>();
    let nextToken: string | null | undefined = undefined;
    let dynamoPages = 0;
    do {
      const list: { data?: { unitUid?: string; fecha?: string }[]; nextToken?: string | null } =
        await client.models.Checklist.list({
          filter: { fecha: { between: [from, to] } },
          limit: 1000,
          nextToken: nextToken ?? undefined,
        });
      for (const c of list.data ?? []) {
        enDynamoPF.add(`${(c.unitUid ?? "").trim()}__${c.fecha ?? ""}`);
      }
      nextToken = list.nextToken;
      dynamoPages++;
    } while (nextToken && dynamoPages < 50);
    const faltantes = [...placaFecha]
      .filter((pf) => !enDynamoPF.has(pf))
      .map((pf) => {
        const [placa, fecha] = pf.split("__");
        return { placa, fecha };
      });

    return res(200, {
      from,
      to,
      total,
      sinPlaca,
      distinctPlaca: placas.size,
      distinctPlacaFecha: placaFecha.size,
      enDynamo: enDynamoPF.size,
      faltan: faltantes.length,
      faltantes,
      colisiones,
      porMes,
      items: rows.slice(0, 400),
    });
  }

  if (method === "GET" && event.queryStringParameters?.units === "1") {
    // Read-only: lista Units del tenant y reporta total, distintos por placa y dups.
    const client = await getDataClient();
    const placas = new Set<string>();
    const rows: { placa: string; sucursal?: string; marca?: string; economicoId?: string }[] = [];
    let nextToken: string | null | undefined = undefined;
    let pages = 0;
    do {
      const list: {
        data?: {
          placa?: string;
          sucursal?: string | null;
          marca?: string | null;
          economicoId?: string | null;
          tenantId?: string;
        }[];
        nextToken?: string | null;
      } = await client.models.Unit.list({
        filter: { tenantId: { eq: TENANT_ID } },
        limit: 1000,
        nextToken: nextToken ?? undefined,
      });
      for (const u of list.data ?? []) {
        const p = (u.placa ?? "").trim();
        placas.add(p);
        rows.push({
          placa: p,
          sucursal: u.sucursal ?? "",
          marca: u.marca ?? "",
          economicoId: u.economicoId ?? "",
        });
      }
      nextToken = list.nextToken;
      pages++;
    } while (nextToken && pages < 50);
    const totalRows = rows.length;
    const distinctPlacas = placas.size;
    const dupsByPlaca = totalRows - distinctPlacas;
    // Verificación adicional: economicoId que se repite entre placas distintas
    // (caso real de duplicación lógica — misma unidad cargada con 2 placas).
    const ecoCount: Record<string, string[]> = {};
    for (const r of rows) {
      const k = (r.economicoId || "").trim();
      if (!k) continue;
      (ecoCount[k] ??= []).push(r.placa);
    }
    const ecoDups = Object.entries(ecoCount)
      .filter(([, ps]) => ps.length > 1)
      .map(([eco, ps]) => ({ economicoId: eco, placas: ps }));
    return res(200, {
      tenantId: TENANT_ID,
      totalRows,
      distinctPlacas,
      dupsByPlaca,
      ecoDups,
      sample: rows.slice(0, 50),
    });
  }

  if (method === "GET" && event.queryStringParameters?.backfill === "1") {
    // Backfill por lotes (ene-2026 → hoy). ?form=mensual|semanal&cursor=K&count=C
    const cursor = parseInt(event.queryStringParameters?.cursor ?? "0", 10) || 0;
    const count = parseInt(event.queryStringParameters?.count ?? "3", 10) || 3;
    const form = event.queryStringParameters?.form ?? "mensual";
    try {
      const out =
        form === "semanal"
          ? await runBackfillSemanal(cursor, count)
          : await runBackfill(cursor, count);
      return res(200, { form, ...out });
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

  const customerId = pickStr(body.customerId) || "14922";
  try {
    if (formId === MENSUAL_FORM_ID) {
      const { placa } = await processMensual(envelope, customerId);
      console.info(`[moreapp-webhook] mensual ingerido placa=${placa}`);
      return res(200, { ok: true, ingested: placa, tipo: "mensual" });
    }
    if (formId === SEMANAL_FORM_ID) {
      const { placa } = await processSemanal(envelope, customerId);
      console.info(`[moreapp-webhook] semanal ingerido placa=${placa}`);
      return res(200, { ok: true, ingested: placa, tipo: "semanal" });
    }
    console.info(`[moreapp-webhook] ignorado formId=${formId}`);
    return res(200, { ok: true, ignored: formId });
  } catch (e) {
    console.error("[moreapp-webhook] error ingiriendo:", (e as Error).message);
    // 200 para que MoreApp no reintente en loop por un error de mapeo nuestro.
    return res(200, { ok: false, error: (e as Error).message });
  }
};
