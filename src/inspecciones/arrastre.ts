// Arrastre de hallazgos — "⏳ se arrastra desde <mes>" (capa pura).
//
// Necesidad (Navares, 2026-08-27): la lista de pendientes de una inspección es
// plana — nada dice cuánto lleva abierto cada hallazgo. Este builder calcula,
// para la inspección ABIERTA en el expediente, la cadena de presencia
// CONSECUTIVA de cada hallazgo hacia atrás en el histórico de la placa
// (por secuencia de inspecciones, no calendario: un mes sin check no rompe
// la cadena — la observación anterior es la inspección anterior que existe).
//
// Identidad = findingKey (key estable C1). Findings pre-C1 (texto display con
// valores embebidos) no matchean entre meses → sin etiqueta (fail-safe, misma
// limitación aceptada que el overlay de auto-resueltos, spec 2026-07-23).

import type { Unit } from "../types";
import { findingKey, isoDayOf } from "../analyzer/findingKey";
import { plateKey } from "./unidades";
import { monthOf, monthLabel } from "../dates";

export type ArrastreInfo = {
  /** "YYYY-MM" del inicio de la cadena consecutiva ("" si la fecha no parsea). */
  desdeYm: string;
  /** "Jun 2026" (o la fecha cruda si no parsea). */
  desdeLabel: string;
  /** Inspecciones consecutivas (incluida la abierta) que reportan el hallazgo. */
  veces: number;
};

/**
 * Mapa findingKey → arrastre para los hallazgos de la inspección `uidAncla`.
 * Solo entradas con veces >= 2 (reportado en la abierta Y al menos la
 * inspección inmediata anterior); una sola aparición no es arrastre.
 */
export function buildArrastre(
  inspections: ReadonlyArray<Unit>,
  plate: string,
  uidAncla: string,
): Map<string, ArrastreInfo> {
  const out = new Map<string, ArrastreInfo>();
  if (!plate || !uidAncla) return out;

  // Secuencia cronológica ASC de la placa (sin filas de fecha no parseable:
  // no hay cronología confiable para encadenar).
  const secuencia = inspections
    .filter((r) => plateKey(r) === plate && isoDayOf(r.fecha) !== "")
    .sort((a, b) => isoDayOf(a.fecha).localeCompare(isoDayOf(b.fecha)));

  const idxAncla = secuencia.findIndex((r) => r.uid === uidAncla);
  if (idxAncla < 0) return out;
  const ancla = secuencia[idxAncla]!;

  // Set de keys por inspección previa (solo se computan al necesitarse).
  const keysDe = (r: Unit): Set<string> => new Set((r.F ?? []).map((f) => findingKey(f)));

  for (const f of ancla.F ?? []) {
    const k = findingKey(f);
    if (out.has(k)) continue;
    let veces = 1;
    let desde = ancla;
    for (let i = idxAncla - 1; i >= 0; i--) {
      const prev = secuencia[i]!;
      if (!keysDe(prev).has(k)) break; // la cadena consecutiva se rompe
      veces++;
      desde = prev;
    }
    if (veces < 2) continue;
    const ym = monthOf(desde.fecha) ?? "";
    out.set(k, {
      desdeYm: ym,
      desdeLabel: ym ? monthLabel(ym) : String(desde.fecha ?? "").trim(),
      veces,
    });
  }
  return out;
}
