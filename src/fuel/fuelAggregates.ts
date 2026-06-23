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

export type UnitRank = {
  eco: string;
  kmpl: number;
  n: number;
  /** Tipo de la unidad (Diesel / Gasolina Magna / …) cuando se rankea por desviación. */
  tipo?: string;
  /** km/l medio del tipo (baseline contra el que se compara). */
  tipoMean?: number;
  /** Desviación relativa vs su tipo: (kmpl − tipoMean) / tipoMean. + = mejor que sus pares. */
  desviacion?: number;
};

/**
 * Ranking de unidades por km/l (de baseline.porUnidad). Desc (mejor primero).
 * minN=4: una unidad necesita ≥4 lecturas de km/l para entrar al ranking. El umbral es 4
 * (no 3) a propósito: `clampOutliers` (IQR) solo recorta con ≥4 valores, así que con 3 el
 * promedio entra SIN protección contra outliers y un solo llenado parcial define su posición
 * en mejores/peores. Con ≥4 toda unidad clasificada queda recortada por IQR. (Implica ≥5
 * cargas, porque la 1ª carga de cada unidad no produce km/l.)
 */
export function rankUnitsByKmpl(baseline: FleetBaseline, minN = 4): UnitRank[] {
  const out: UnitRank[] = [];
  for (const [eco, s] of baseline.porUnidad) {
    if (s.n >= minN && Number.isFinite(s.mean) && s.mean > 0)
      out.push({ eco, kmpl: s.mean, n: s.n });
  }
  return out.sort((a, b) => b.kmpl - a.kmpl);
}

/**
 * Ranking por DESVIACIÓN del km/l de cada unidad respecto al promedio de su MISMO tipo
 * (Diesel/Magna/Premium tienen km/l muy distinto por física: comparar en absoluto mete
 * siempre a los diésel/pesados en "peores" aunque gestionen bien). Desc por desviación
 * (mejor-que-sus-pares primero). `minN` lecturas por unidad (IQR ya recorta con ≥4);
 * `minTipoN` lecturas para confiar en el baseline del tipo — si el tipo no es confiable
 * la unidad entra con desviación 0 (ni premia ni penaliza) en vez de quedar fuera.
 */
export function rankUnitsByDeviation(baseline: FleetBaseline, minN = 4, minTipoN = 4): UnitRank[] {
  const out: UnitRank[] = [];
  for (const [eco, s] of baseline.porUnidad) {
    if (!(s.n >= minN && Number.isFinite(s.mean) && s.mean > 0)) continue;
    const tipo = baseline.tipoDe.get(eco) ?? "(sin tipo)";
    const ts = baseline.porTipo.get(tipo);
    const tipoConfiable = !!ts && ts.n >= minTipoN && ts.mean > 0;
    const desviacion = tipoConfiable ? (s.mean - ts.mean) / ts.mean : 0;
    out.push({ eco, kmpl: s.mean, n: s.n, tipo, tipoMean: ts?.mean, desviacion });
  }
  return out.sort((a, b) => (b.desviacion ?? 0) - (a.desviacion ?? 0));
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
