// Pipeline batch upload: ZIP MoreApp parseado → DynamoDB via API client.
//
// Idempotente — re-subir el mismo ZIP NO crea duplicados gracias a composite
// identifiers en el schema. Sobrescribe lo existente con los datos nuevos.
//
// Procesa SOLO el XLSX embedido. Las fotos del ZIP siguen en IndexedDB local
// por ahora — migración a S3 = fase aparte.

import type { LoadedZip } from "../io/zipLoader";
import { analyzeRow } from "../analyzer/analyzeRow";
import {
  upsertUnit,
  upsertChecklist,
  upsertSemanal,
  type UnitInput,
} from "./client";

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
export async function uploadZipToCloud(
  zip: LoadedZip,
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
        const unit: UnitInput = {
          tenantId,
          placa,
          marca: pickStr(row, "Marca") || undefined,
          modelo: pickStr(row, "Modelo") || undefined,
          anio: pickNum(row, "Año", "Anio"),
          sucursal: pickStr(row, "Sucursal", "Sucursal / Area", "Area") || undefined,
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
          zip.filename
            .replace(/\.zip$/i, "")
            .replace(/^.*?(\d{4}-W\d{1,2}).*$/i, "$1") || zip.filename;
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
        await upsertUnit({
          tenantId,
          placa,
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
          fname
            .replace(/\.(zip|xlsx?)$/i, "")
            .replace(/^.*?(\d{4}-W\d{1,2}).*$/i, "$1") || fname;
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

/** Type re-export para que cloudWire pueda tipar legacy units. */
export type { LegacyUnit };
