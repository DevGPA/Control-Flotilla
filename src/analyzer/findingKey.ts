// findingKey — identidad ESTABLE de un hallazgo + lectura de completaciones.
//
// Fase C1 (audit 2026-06-04): el itemKey de CheckDone era el texto display del
// hallazgo, que embebe valores volátiles (mm de llanta, redacción de BIN_LABELS,
// km/días de servicio) → al re-inspeccionar, la completación quedaba huérfana y
// el hallazgo "reaparecía". `f.key` es una identidad sintética que JAMÁS embebe
// valores medidos, fechas ni conteos:
//   Llanta:<posición> · Bin:<columnaExcel> · Fluido:<columna> · Mant:Servicio · Chk:Refaccion
// Ningún texto display actual matchea ^(Llanta|Bin|Fluido|Mant|Chk): → sin colisiones.
// Las keys son además el contrato de paridad legacy↔TS (los textos ya divergen).
//
// Este módulo tiene un ESPEJO inline en `Control de flotilla.html` (mismas
// funciones, mismo comportamiento) — el test de paridad vive en
// tests/audit-fase-c1.test.ts. Si cambias la semántica aquí, cambia el espejo.

import type { Finding } from "../types";

export type DoneEntry = { done?: boolean; ts?: string; by?: string };
export type DoneMap = Record<string, DoneEntry>;

/** Identidad estable del hallazgo: key sintética si existe, texto display si no. */
export function findingKey(f: Pick<Finding, "text"> & { key?: string }): string {
  return f.key || f.text;
}

/** Placa desde un unitUid cloud: filas viejas usan `placa__fecha`, nuevas placa cruda. */
export function plateOf(unitUid: unknown): string {
  return String(unitUid ?? "").split("__")[0] ?? "";
}

/** Normaliza "DD/MM/YYYY" | "YYYY-MM-DD[Thh:mm…]" | Date → "YYYY-MM-DD" ("" si no parsea). */
export function isoDayOf(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const s = String(v ?? "").trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, "0")}-${String(dmy[1]).padStart(2, "0")}`;
  return "";
}

/**
 * Resuelve la entrada de completación de un hallazgo con DUAL-READ + LWW:
 * consulta la key nueva Y el texto display (alias legacy — marcas pre-migración
 * y las escritas por frontends viejos durante el rollout). Si existen ambas,
 * gana la de `ts` mayor; sin ts = más vieja. Sin esto, el deploy huerfanaría
 * todas las marcas existentes (H1) y los tombstones no matarían alias (H2).
 */
export function resolveDoneEntry(
  dm: DoneMap | undefined,
  f: Pick<Finding, "text"> & { key?: string },
): DoneEntry | undefined {
  if (!dm) return undefined;
  const k = findingKey(f);
  const a = dm[k];
  const b = k !== f.text ? dm[f.text] : undefined;
  if (a && b) return (b.ts ?? "") > (a.ts ?? "") ? b : a;
  return a ?? b;
}

/**
 * ¿El hallazgo está atendido para una fila de inspección dada?
 * - Tombstones (`done:false`) cuentan como NO atendido (pero conservan su ts
 *   para el LWW — por eso el merge nunca borra entradas, solo las sobrescribe).
 * - Corte temporal: la marca cubre solo inspecciones con fecha <= día del ts de
 *   la marca. Una inspección POSTERIOR que re-reporta el hallazgo sale pendiente
 *   (el problema persiste/reapareció). Sin fecha de fila o sin ts → aplica.
 */
export function isFindingDone(
  dm: DoneMap | undefined,
  f: Pick<Finding, "text"> & { key?: string },
  fechaFila?: unknown,
): boolean {
  const e = resolveDoneEntry(dm, f);
  if (!e || e.done !== true) return false;
  if (fechaFila != null && e.ts) {
    const fila = isoDayOf(fechaFila);
    const marca = isoDayOf(e.ts);
    if (fila && marca && fila > marca) return false;
  }
  return true;
}
