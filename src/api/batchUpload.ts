// Pipeline batch upload: ZIP MoreApp parseado → DynamoDB via API client.
//
// Idempotente — re-subir el mismo ZIP NO crea duplicados gracias a composite
// identifiers en el schema. Sobrescribe lo existente con los datos nuevos.
//
// Procesa SOLO el XLSX embedido. Las fotos del ZIP siguen en IndexedDB local
// por ahora — migración a S3 = fase aparte.

import type { LoadedZip } from "../io/zipLoader";
import { analyzeRow } from "../analyzer/analyzeRow";
import { upsertUnit, upsertChecklist, upsertSemanal, upsertTaller, type UnitInput } from "./client";

/** Shape mínima de Unit que el legacy expone en window.units. */
interface LegacyUnit {
  uid?: string;
  eco?: string;
  plate?: string;
  brand?: string;
  branch?: string;
  area?: string;
  insp?: string;
  fecha?: string;
  km?: number | string;
  obs?: string;
  nextSvc?: string;
  kmNextSvc?: number | string;
  risk?: string;
  F?: unknown[];
  T?: Record<string, number>;
  minT?: number | null;
  photos?: unknown[]; // [{fname, col, group}, ...] del legacy
}

export interface BatchResult {
  units: number;
  checklist: number;
  semanal: number;
  skipped: number;
  errors: { placa: string; error: string }[];
  duration_ms: number;
}

interface RowLite {
  [key: string]: unknown;
}

function pickStr(row: RowLite, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function pickNum(row: RowLite, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null) {
      const n = Number(v);
      if (!isNaN(n)) return n;
    }
  }
  return undefined;
}

/**
 * Sube los rows del ZIP al backend. Retorna conteos + errores por unidad.
 * Si zip.report.kind === "mensual" → crea Unit + Checklist.
 * Si zip.report.kind === "semanal" → crea Semanal (sin Unit nuevo, asume existe).
 */
export async function uploadZipToCloud(zip: LoadedZip, tenantId: string): Promise<BatchResult> {
  const start = Date.now();
  const result: BatchResult = {
    units: 0,
    checklist: 0,
    semanal: 0,
    skipped: 0,
    errors: [],
    duration_ms: 0,
  };

  if (!zip.report) {
    throw new Error("ZIP sin XLSX embedido. Nada que subir.");
  }

  const rows = zip.report.rows as RowLite[];
  const kind = zip.report.kind;

  for (const row of rows) {
    const placa = pickStr(
      row,
      "# Economico - PLACAS",
      "No. de unidad / ECO",
      "Número de unidad",
      "# Economico - id",
    );
    if (!placa) {
      result.skipped++;
      continue;
    }

    try {
      if (kind === "mensual") {
        // 1. Unit (catálogo). Idempotente por (tenantId, placa).
        const rawEcoId = pickStr(row, "# Economico - id");
        const ecoIdRaw = rawEcoId && rawEcoId !== placa ? rawEcoId : undefined;
        const unit: UnitInput = {
          tenantId,
          placa,
          economicoId: ecoIdRaw,
          marca: pickStr(row, "Marca", "# Economico - SUBMARCA") || undefined,
          modelo: pickStr(row, "Modelo") || undefined,
          anio: pickNum(row, "Año", "Anio"),
          sucursal:
            pickStr(row, "Sucursal", "Sucursal / Area", "Area", "# Economico - SUCURSAL") ||
            undefined,
          vin: pickStr(row, "VIN", "NIV") || undefined,
        };
        await upsertUnit(unit);
        result.units++;

        // 2. Checklist (1 por unidad por fecha). Findings + tires JSON.
        const fechaRaw = pickStr(row, "Fecha y Hora", "Fecha");
        const fecha = fechaRaw.split(/[ T]/)[0] || new Date().toISOString().split("T")[0]!;
        const analyzed = analyzeRow(row as Parameters<typeof analyzeRow>[0]);
        const resultadosClean = JSON.parse(
          JSON.stringify({
            findings: analyzed.F,
            tires: analyzed.T,
            max: analyzed.max,
            minT: analyzed.minT ?? null,
            validationErrors: analyzed.validationErrors,
          }),
        );
        await upsertChecklist({
          tenantId,
          unitUid: placa,
          fecha,
          tipoInspeccion: "mensual",
          resultados: resultadosClean,
          responsable: pickStr(row, "Responsable", "Nombre de quien verifica") || "",
        });
        result.checklist++;
      } else if (kind === "semanal") {
        // Semanal: 1 por (periodoId, unitUid). periodoId se infiere del filename
        // del ZIP — convención: "ROF-Semanal-2026-W21.zip" → "2026-W21".
        const periodoId =
          zip.filename.replace(/\.zip$/i, "").replace(/^.*?(\d{4}-W\d{1,2}).*$/i, "$1") ||
          zip.filename;
        const sucursal = pickStr(row, "Sucursal", "Area") || "—";
        const datosClean = JSON.parse(JSON.stringify(row));
        await upsertSemanal({
          tenantId,
          periodoId,
          sucursal,
          unitUid: placa,
          datos: datosClean,
        });
        result.semanal++;
      }
    } catch (e) {
      result.errors.push({ placa, error: (e as Error).message });
    }
  }

  result.duration_ms = Date.now() - start;
  return result;
}

/**
 * Sube units YA PARSEADOS por el legacy (window.units) al cloud.
 * Más eficiente que re-parsear el XLSX — el legacy ya hizo el trabajo de
 * dedup por uid, acumular findings, contar inspecciones, etc.
 *
 * El kind ("mensual" | "semanal") decide qué entidades crear:
 * - mensual: Unit + Checklist por unidad.
 * - semanal: Semanal por unidad (asume Unit ya existe del mensual previo).
 *
 * Idempotente: re-subir crea/sobrescribe vía composite identifiers.
 */
export async function uploadUnitsToCloud(
  units: LegacyUnit[],
  fname: string,
  kind: "mensual" | "semanal",
  tenantId: string,
): Promise<BatchResult> {
  const start = Date.now();
  const result: BatchResult = {
    units: 0,
    checklist: 0,
    semanal: 0,
    skipped: 0,
    errors: [],
    duration_ms: 0,
  };

  for (const u of units) {
    const placa = String(u.plate || u.eco || u.uid || "").trim();
    if (!placa) {
      result.skipped++;
      continue;
    }
    try {
      if (kind === "mensual") {
        // u.eco viene del Excel "# Economico - id" (numérico interno tipo "78").
        // Solo lo guardamos si difiere de placa (algunos Excel duplican valor).
        const ecoId = u.eco && u.eco !== placa ? u.eco : undefined;
        await upsertUnit({
          tenantId,
          placa,
          economicoId: ecoId,
          marca: u.brand || undefined,
          sucursal: u.branch || undefined,
        });
        result.units++;

        // fecha del legacy puede venir como DD/MM/YYYY. Usamos string raw —
        // composite identifier (tenantId, unitUid, fecha) requiere consistencia,
        // misma fuente = misma key.
        const fecha = String(u.fecha || "").trim() || new Date().toISOString().split("T")[0]!;
        // Sanitize: JSON-roundtrip strip undefined (GraphQL rechaza undefined en variables).
        const resultadosClean = JSON.parse(
          JSON.stringify({
            findings: u.F ?? [],
            tires: u.T ?? {},
            risk: u.risk ?? "OK",
            minT: u.minT ?? null,
            obs: u.obs ?? "",
            km: u.km ?? "",
            nextSvc: u.nextSvc ?? "",
            kmNextSvc: u.kmNextSvc ?? "",
            photos: u.photos ?? [],
          }),
        );
        await upsertChecklist({
          tenantId,
          unitUid: placa,
          fecha,
          tipoInspeccion: "mensual",
          resultados: resultadosClean,
          responsable: u.insp || u.area || "",
        });
        result.checklist++;
      } else {
        // semanal: derivar periodoId del filename.
        const periodoId =
          fname.replace(/\.(zip|xlsx?)$/i, "").replace(/^.*?(\d{4}-W\d{1,2}).*$/i, "$1") || fname;
        const datosClean = JSON.parse(
          JSON.stringify({
            findings: u.F ?? [],
            risk: u.risk ?? "OK",
            obs: u.obs ?? "",
            km: u.km ?? "",
          }),
        );
        await upsertSemanal({
          tenantId,
          periodoId,
          sucursal: u.branch || "—",
          unitUid: placa,
          datos: datosClean,
        });
        result.semanal++;
      }
    } catch (e) {
      result.errors.push({ placa, error: (e as Error).message });
    }
  }

  result.duration_ms = Date.now() - start;
  return result;
}

/** Shape mínima de entry semanal legacy. */
interface LegacySemanalEntry {
  uid?: string;
  eco?: string;
  plate?: string;
  brand?: string;
  branch?: string;
  area?: string;
  km?: number | string;
  fecha?: string;
  responsable?: string;
  aceite?: string;
  aceiteRisk?: string;
  radiador?: string;
  radiadorRisk?: string;
  carroceria?: string;
  carroceriaRisk?: string;
  llanta?: string;
  llantaRisk?: string;
  risk?: string;
  photos?: string[];
}

/**
 * Sube entries de un período semanal a DynamoDB (Semanal model).
 * Composite identifier (tenantId, periodoId, unitUid) garantiza idempotencia:
 * re-subir el mismo XLSX semanal no duplica, sobrescribe.
 */
export async function uploadSemanalesToCloud(
  periodoId: string,
  entries: LegacySemanalEntry[],
  tenantId: string,
): Promise<BatchResult> {
  const start = Date.now();
  const result: BatchResult = {
    units: 0,
    checklist: 0,
    semanal: 0,
    skipped: 0,
    errors: [],
    duration_ms: 0,
  };

  for (const e of entries) {
    const placa = String(e.plate || e.eco || e.uid || "").trim();
    if (!placa) {
      result.skipped++;
      continue;
    }
    try {
      // economicoId: ID interno GPA del Excel "# Economico - id". Skip si === placa.
      const ecoIdForDatos = e.eco && e.eco !== placa ? e.eco : "";
      const datosClean = JSON.parse(
        JSON.stringify({
          economicoId: ecoIdForDatos,
          fecha: e.fecha ?? "",
          km: e.km ?? "",
          brand: e.brand ?? "",
          area: e.area ?? "",
          responsable: e.responsable ?? "",
          aceite: e.aceite ?? "",
          aceiteRisk: e.aceiteRisk ?? "OK",
          radiador: e.radiador ?? "",
          radiadorRisk: e.radiadorRisk ?? "OK",
          carroceria: e.carroceria ?? "",
          carroceriaRisk: e.carroceriaRisk ?? "OK",
          llanta: e.llanta ?? "",
          llantaRisk: e.llantaRisk ?? "OK",
          risk: e.risk ?? "OK",
          photos: e.photos ?? [],
        }),
      );
      await upsertSemanal({
        tenantId,
        periodoId,
        sucursal: e.branch || "—",
        unitUid: placa,
        datos: datosClean,
      });
      result.semanal++;
    } catch (err) {
      result.errors.push({ placa, error: (err as Error).message });
    }
  }

  result.duration_ms = Date.now() - start;
  return result;
}

/** Shape mínima de entry de taller legacy. */
interface LegacyTallerEntry {
  id: string;
  unitKey?: string;
  eco?: string;
  plate?: string;
  brand?: string;
  sucursal?: string;
  area?: string;
  estado?: string;
  tipo?: string;
  freporte?: string;
  fentrada?: string;
  fsalidaEst?: string;
  fsalidaReal?: string;
  km?: number;
  gasto?: number;
  gastoRef?: number;
  gastoMO?: number;
  tecnico?: string;
  refacciones?: string;
  comentario?: string;
  updatedAt?: string;
}

/**
 * Sube entries de taller a DynamoDB. Composite key (tenantId, unitUid, fechaEntrada).
 * Idempotente — re-subir mismo entry sobrescribe. Todo el legacy entry vive
 * en datos (JSON) — campos del schema (motivo, estatus) son strict-typed para
 * compatibility con queries.
 */
/**
 * Clave cloud de un registro de taller — Fase C2 (audit 2026-06-04 P1 #11).
 * El identifier del modelo es (tenantId, unitUid, fechaEntrada). Antes, con
 * fentrada/freporte vacíos, fechaEntrada caía a `updatedAt` (regenerado en CADA
 * guardado) → cada edición/finalización creaba una fila cloud NUEVA (duplicados
 * fantasma). Ahora el fallback es `sin-fecha:`+e.id — e.id (`tl_<ts>`) es
 * inmutable, así que la clave es estable y recomputable. La UI no se rompe:
 * `fentrada` se hidrata desde `datos.fentrada` (el JSON), no desde la clave.
 * Regla operativa (decisión 2026-06-09): máx. 1 ingreso por unidad por día —
 * un segundo ingreso same-day upserta sobre la misma fila.
 */
export function tallerCloudKey(e: LegacyTallerEntry): { unitUid: string; fechaEntrada: string } {
  const unitUid = String(e.plate || e.eco || e.unitKey || e.id || "");
  const fechaEntrada = e.fentrada || e.freporte || `sin-fecha:${e.id}`;
  return { unitUid, fechaEntrada };
}

export async function uploadTallerToCloud(
  entries: LegacyTallerEntry[],
  tenantId: string,
): Promise<BatchResult> {
  const start = Date.now();
  const result: BatchResult = {
    units: 0,
    checklist: 0,
    semanal: 0,
    skipped: 0,
    errors: [],
    duration_ms: 0,
  };

  for (const e of entries) {
    const { unitUid, fechaEntrada } = tallerCloudKey(e);
    if (!unitUid) {
      result.skipped++;
      continue;
    }
    try {
      const estatus = e.fsalidaReal ? ("cerrado" as const) : ("abierto" as const);
      const motivo = e.tipo || e.estado || "Sin motivo";
      await upsertTaller({
        tenantId,
        unitUid: String(unitUid),
        fechaEntrada,
        fechaSalida: e.fsalidaReal || undefined,
        folio: e.id,
        motivo,
        estatus,
        datos: e,
      });
      // Reuse semanal counter — BatchResult shape no tiene `taller` campo,
      // pero el caller solo necesita totales agregados. Sumamos a semanal
      // por convención hasta refactor del shape.
      result.semanal++;
    } catch (err) {
      const placa = String(e.plate || e.eco || e.id);
      result.errors.push({ placa, error: (err as Error).message });
    }
  }

  result.duration_ms = Date.now() - start;
  return result;
}

/** Type re-export para que cloudWire pueda tipar legacy units. */
export type { LegacyUnit, LegacySemanalEntry, LegacyTallerEntry };
