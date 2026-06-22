/**
 * Agregadores PUROS para el dashboard ejecutivo de combustible. Sin DOM.
 */
import type { FuelEntry, FleetBaseline } from "./types";

export type UnitRank = { eco: string; kmpl: number; n: number };

/** Ranking de unidades por km/l (de baseline.porUnidad). Desc (mejor primero). */
export function rankUnitsByKmpl(baseline: FleetBaseline, minN = 2): UnitRank[] {
  const out: UnitRank[] = [];
  for (const [eco, s] of baseline.porUnidad) {
    if (s.n >= minN && Number.isFinite(s.mean) && s.mean > 0)
      out.push({ eco, kmpl: s.mean, n: s.n });
  }
  return out.sort((a, b) => b.kmpl - a.kmpl);
}

export type GroupConsumo = { group: string; litros: number; gasto: number; cargas: number };

/** Consumo (litros/gasto/cargas) agrupado por una clave. Solo cuenta cargas. */
export function aggByGroup(
  entries: readonly FuelEntry[],
  keyOf: (e: FuelEntry) => string,
): GroupConsumo[] {
  const m = new Map<string, GroupConsumo>();
  for (const e of entries) {
    if (e.tipo !== "carga") continue;
    const key = keyOf(e) || "(sin dato)";
    let g = m.get(key);
    if (!g) {
      g = { group: key, litros: 0, gasto: 0, cargas: 0 };
      m.set(key, g);
    }
    g.litros += e.litros ?? 0;
    g.gasto += e.monto ?? 0;
    g.cargas += 1;
  }
  return [...m.values()].sort((a, b) => b.gasto - a.gasto);
}

export type MonthConsumo = { mes: string; litros: number; gasto: number; cargas: number };

/** Tendencia mensual (YYYY-MM) de litros y gasto. Solo cargas. Orden cronológico. */
export function aggByMonth(entries: readonly FuelEntry[]): MonthConsumo[] {
  const m = new Map<string, MonthConsumo>();
  for (const e of entries) {
    if (e.tipo !== "carga") continue;
    const mes = (e.fecha || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mes)) continue;
    let g = m.get(mes);
    if (!g) {
      g = { mes, litros: 0, gasto: 0, cargas: 0 };
      m.set(mes, g);
    }
    g.litros += e.litros ?? 0;
    g.gasto += e.monto ?? 0;
    g.cargas += 1;
  }
  return [...m.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}
