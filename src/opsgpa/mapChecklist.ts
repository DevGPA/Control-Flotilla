/**
 * Adaptador: checklist de reparto (CL) de Operaciones-GPA → modelos de Fleet Command.
 *
 * SEMANAL (este módulo): espeja `processSemanal` del webhook MoreApp — upsert de `Unit`
 * (catálogo) + `Semanal` idempotente por [tenantId, periodoId(semana ISO), unitUid(placa)].
 * Los motores de riesgo canónicos (`analyzer/risk.ts`) ya entienden el vocabulario de
 * Operaciones-GPA sin traducción: "Nivel Optimo"→OK, "Bajo"/"Muy Bajo"/"Sin Nivel"→Revisar,
 * "Sin daños"→OK, "Si"/"No" de refacción→OK/Revisar. Misma regla de negocio (A1: solo
 * aceite y radiador votan el estatus) para ambas fuentes.
 *
 * MENSUAL: NO implementado aún a propósito — requiere la matriz completa itemId→columna
 * de `analyzeRow` (~40 campos con vocabularios). El receptor responde 422 y el evento
 * queda visible en la DLQ del publisher (nunca se pierde en silencio).
 */
import { calcEstatusSemanal, normBodyRisk, normFluidRisk, normTireRisk } from "../analyzer/risk";
import {
  OPS_SOURCE,
  OPS_TENANT_ID,
  opsEventoId,
  type EvidenceResolver,
  type OpsClRecord,
} from "./contract";

/** Semana ISO "YYYY-Www" — misma implementación que el webhook (`isoWeekId`, en sync). */
export function isoWeekId(dateStr: string): string {
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

/** Input idempotente para Unit (subset del catálogo que el ingest mantiene). */
export interface UnitInput {
  tenantId: string;
  placa: string;
  economicoId?: string;
  marca?: string;
  sucursal?: string;
}

/** Input idempotente para Semanal ([tenantId, periodoId, unitUid]). */
export interface SemanalInput {
  tenantId: string;
  periodoId: string;
  sucursal?: string;
  unitUid: string;
  datos: string; // JSON — mismo shape que produce el webhook (el front lo consume igual)
}

const esKeyEvidencia = (v: unknown): v is string =>
  typeof v === "string" && /^(SOL|CL|MC|FRM)\/[0-9a-f]{32}\.(jpg|png|webp)$/.test(v);

export function mapSemanal(
  ops: OpsClRecord,
  resolveFname: EvidenceResolver,
): { unit: UnitInput; semanal: SemanalInput } {
  if (ops.tipo !== "semanal") {
    throw new Error(`CL ${ops.id}: tipo "${String(ops.tipo)}" no implementado (solo semanal)`);
  }
  const placa = String(ops.placas ?? "").trim();
  if (!placa) throw new Error(`CL ${ops.id}: registro sin placas — no mapeable`);

  const answers = (ops.answers ?? {}) as Record<string, unknown>;

  // Riesgos con los motores canónicos (mismos que webhook y front).
  const aceite = String(answers.aceite ?? "");
  const radiador = String(answers.radiador ?? "");
  const carroceria = String(answers.carroceria ?? "");
  const llanta = String(answers.llanta_ref ?? "");
  const aceiteRisk = normFluidRisk(aceite);
  const radiadorRisk = normFluidRisk(radiador);
  const carroceriaRisk = normBodyRisk(carroceria);
  const llantaRisk = normTireRisk(llanta);
  const risk = calcEstatusSemanal(aceiteRisk, radiadorRisk, carroceriaRisk, llantaRisk);

  // Fotos: fotoKm + toda evidencia dentro de answers → fnames (shape que espera el front).
  const photos: string[] = [];
  if (esKeyEvidencia(ops.fotoKm)) photos.push(resolveFname(ops.fotoKm));
  for (const [, v] of Object.entries(answers)) {
    if (esKeyEvidencia(v)) photos.push(resolveFname(v));
  }
  if (esKeyEvidencia(ops.firma)) photos.push(resolveFname(ops.firma));

  const economicoId = String(ops.economico ?? "").trim() || undefined;
  const sucursal = String(ops.sucursal ?? "").trim() || undefined;
  const brand = String(ops.subMarca ?? "").trim();

  const datos = {
    economicoId: economicoId ?? "",
    brand,
    km: ops.km != null ? String(ops.km) : "",
    fecha: String(ops.fecha ?? ""),
    responsable: String(ops.responsable ?? ""),
    aceite,
    aceiteRisk,
    radiador,
    radiadorRisk,
    carroceria,
    carroceriaRisk,
    llanta,
    llantaRisk,
    risk,
    // Folio visible en el front (mismo campo que usa el flujo MoreApp).
    moreappId: opsEventoId(ops.id),
    photos,
    fuente: OPS_SOURCE,
    opsId: ops.id,
    opsStatus: ops.status ?? null,
  };

  return {
    unit: {
      tenantId: OPS_TENANT_ID,
      placa,
      economicoId: economicoId && economicoId !== placa ? economicoId : undefined,
      marca: brand || undefined,
      sucursal,
    },
    semanal: {
      tenantId: OPS_TENANT_ID,
      periodoId: isoWeekId(String(ops.fecha ?? "")),
      sucursal,
      unitUid: placa,
      datos: JSON.stringify(datos),
    },
  };
}
