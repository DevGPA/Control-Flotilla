// Evolución por unidad — capa PURA del timeline del expediente (tab "Evolución").
//
// Necesidad (Navares, 2026-08-27): con rango "Año" + filtro por unidad se ven
// todos sus registros, pero nada mide si la unidad fue MEJORANDO o EMPEORANDO
// mes con mes. Este builder convierte el histórico de window.__inspections de
// UNA placa en filas de timeline con hallazgos pendientes por severidad y el
// delta contra la inspección anterior (la medición pedida).
//
// Pendientes vía isFindingDone con su CORTE TEMPORAL (la marca de atendido
// solo cubre inspecciones con fecha <= día de la marca): una inspección
// posterior que re-reporta el hallazgo sale pendiente — semántica exacta de
// línea de tiempo. Nota: 9ª copia del contador inline de pendientes
// (precedente renderChecklist.ts) — candidato a refactor compartido.

import type { ChecklistDB, RiskLevel, Unit } from "../types";
import { isFindingDone, isoDayOf } from "../analyzer/findingKey";
import { plateKey } from "./unidades";
import { monthOf, monthLabel } from "../dates";

export type EvolRow = {
  uid: string;
  fecha: string;
  /** "Ago 2026 · día 15" (o la fecha cruda si no parsea). */
  label: string;
  risk: RiskLevel;
  pendUrg: number;
  pendRev: number;
  pendComp: number;
  /** Hallazgos totales reportados en esa inspección. */
  totF: number;
  /**
   * Pendientes totales de esta inspección MENOS los de la inspección
   * cronológicamente anterior. >0 empeoró, <0 mejoró, null = la más antigua.
   */
  deltaPend: number | null;
  minT: number | null;
  km?: number | string;
  insp?: string;
};

/** # de inspecciones históricas de la placa (badge de la tab). */
export function countInspecciones(inspections: ReadonlyArray<Unit>, plate: string): number {
  if (!plate) return 0;
  let n = 0;
  for (const r of inspections) if (plateKey(r) === plate) n++;
  return n;
}

/**
 * Timeline de la unidad: una fila por inspección, MÁS RECIENTE primero
 * (filas sin fecha parseable al final). No muta el input.
 */
export function buildEvolucionUnidad(
  inspections: ReadonlyArray<Unit>,
  plate: string,
  checklistDB: ChecklistDB | undefined,
): EvolRow[] {
  if (!plate) return [];
  const propias = inspections.filter((r) => plateKey(r) === plate);

  // Orden ASC primero para calcular el delta contra la anterior; al final se invierte.
  const asc = [...propias].sort((a, b) => {
    const fa = isoDayOf(a.fecha);
    const fb = isoDayOf(b.fecha);
    if (!fa && !fb) return 0;
    if (!fa) return -1; // sin fecha = "más antigua" (queda al final tras invertir)
    if (!fb) return 1;
    return fa.localeCompare(fb);
  });

  let prevPend: number | null = null;
  const rows: EvolRow[] = asc.map((u) => {
    const dm = checklistDB?.[u.uid];
    let pendUrg = 0;
    let pendRev = 0;
    let pendComp = 0;
    for (const f of u.F ?? []) {
      if (isFindingDone(dm, f, u.fecha)) continue;
      if (f.lv === "Urgente") pendUrg++;
      else if (f.lv === "Revisar") pendRev++;
      else if (f.lv === "Completar") pendComp++;
    }
    const pend = pendUrg + pendRev + pendComp;
    const conFecha = isoDayOf(u.fecha) !== "";
    const row: EvolRow = {
      uid: u.uid,
      fecha: String(u.fecha ?? ""),
      label: labelDe(u.fecha),
      risk: u.risk ?? "OK",
      pendUrg,
      pendRev,
      pendComp,
      totF: (u.F ?? []).length,
      // Sin fecha no hay cronología confiable: sin delta.
      deltaPend: conFecha && prevPend != null ? pend - prevPend : null,
      minT: u.minT ?? null,
      km: u.km,
      insp: u.insp,
    };
    if (conFecha) prevPend = pend;
    return row;
  });

  return rows.reverse();
}

function labelDe(fecha: string | undefined): string {
  const ym = monthOf(fecha);
  const dia = isoDayOf(fecha).slice(8, 10);
  if (!ym) return String(fecha ?? "").trim() || "Sin fecha";
  return dia ? `${monthLabel(ym)} · día ${parseInt(dia, 10)}` : monthLabel(ym);
}
