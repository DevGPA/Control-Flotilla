/**
 * Agregadores PUROS para el dashboard ejecutivo de combustible. Sin DOM.
 */
import type { FuelEntry, FleetBaseline } from "./types";

/**
 * Monto efectivo de una carga: el `monto` capturado, o reconstruido litros×precio
 * cuando el ticket llegó sin total (montoTotal vacío pero litros+precio presentes).
 * Sin esto, el KPI de Gasto y el desglose por sucursal/mes subestiman (suman $0).
 */
export function montoEfectivo(e: {
  monto?: number;
  litros?: number;
  precioPorLitro?: number;
}): number {
  if (typeof e.monto === "number" && Number.isFinite(e.monto)) return e.monto;
  if (typeof e.litros === "number" && typeof e.precioPorLitro === "number")
    return e.litros * e.precioPorLitro;
  return 0;
}

export type UnitRank = { eco: string; kmpl: number; n: number };

/**
 * Ranking de unidades por km/l (de baseline.porUnidad). Desc (mejor primero).
 * minN=3: una unidad necesita ≥3 lecturas de km/l para entrar al ranking — con 1-2
 * cargas el promedio es ruido (un error de captura lo dispara) y distorsiona el orden.
 */
export function rankUnitsByKmpl(baseline: FleetBaseline, minN = 3): UnitRank[] {
  const out: UnitRank[] = [];
  for (const [eco, s] of baseline.porUnidad) {
    if (s.n >= minN && Number.isFinite(s.mean) && s.mean > 0)
      out.push({ eco, kmpl: s.mean, n: s.n });
  }
  return out.sort((a, b) => b.kmpl - a.kmpl);
}

/**
 * Parte el ranking en mejores y peores DISJUNTOS. `ranks` viene DESC (mejor→peor).
 * Toma como máximo floor(n/2) por lado para que NINGUNA unidad aparezca en ambas listas
 * (antes slice(0,10) y slice(-10) se solapaban cuando había <20 unidades). `peores` se
 * devuelve con el PEOR primero (para que el gráfico lo muestre arriba).
 */
export function splitRanking(
  ranks: readonly UnitRank[],
  n = 10,
): { mejores: UnitRank[]; peores: UnitRank[] } {
  const k = Math.min(n, Math.floor(ranks.length / 2));
  const mejores = ranks.slice(0, k); // mejor primero (desc)
  const peores = ranks.slice(ranks.length - k).reverse(); // peor primero (asc)
  return { mejores, peores };
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
    g.gasto += montoEfectivo(e);
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
    g.gasto += montoEfectivo(e);
    g.cargas += 1;
  }
  return [...m.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}
