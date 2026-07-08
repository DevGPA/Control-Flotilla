/**
 * Agregadores PUROS para el dashboard ejecutivo de combustible. Sin DOM.
 */
import type { FuelEntry, FleetBaseline, FuelStat } from "./types";
import { percentile } from "../analyzer/statistics";

/** km/l representativo de un grupo: el ponderado por volumen (kmplVol) si existe; si no, la media. */
function repKmpl(s: FuelStat): number {
  return s.kmplVol != null && Number.isFinite(s.kmplVol) ? s.kmplVol : s.mean;
}

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
  /** Última sucursal conocida de la unidad (comparativo entre sucursales por submarca). */
  sucursal?: string;
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
    const k = repKmpl(s); // km/l ponderado por volumen (fallback media)
    if (s.n >= minN && Number.isFinite(k) && k > 0) out.push({ eco, kmpl: k, n: s.n });
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
    const k = repKmpl(s); // km/l ponderado por volumen de la unidad
    if (!(s.n >= minN && Number.isFinite(k) && k > 0)) continue;
    const tipo = baseline.tipoDe.get(eco) ?? "(sin tipo)";
    const ts = baseline.porTipo.get(tipo);
    const tk = ts ? repKmpl(ts) : NaN; // km/l ponderado del tipo
    const tipoConfiable = !!ts && ts.n >= minTipoN && Number.isFinite(tk) && tk > 0;
    const desviacion = tipoConfiable ? (k - tk) / tk : 0;
    out.push({ eco, kmpl: k, n: s.n, tipo, tipoMean: ts ? tk : undefined, desviacion });
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

/**
 * Ranking de unidades por km/l (ponderado por volumen) AGRUPADO por submarca comercial
 * ("Aumark TM3", "NP 300…"). Dentro del MISMO tipo el km/l absoluto SÍ es comparable —
 * es el comparativo del auditor: ¿qué unidades de este tipo rinden peor y de qué sucursal
 * son? Cada grupo va ordenado ASC (peor primero). Las submarcas se fusionan
 * case-insensitive (la clave del Map conserva la primera grafía vista).
 *
 * `minN = 2` (más laxo que el 4 del ranking global): dentro del mismo tipo se prefiere
 * transparencia con pocas lecturas a dejar unidades fuera; con n<4 el promedio entra sin
 * recorte IQR, así que el tooltip muestra `n` para ponderar la confianza.
 */
export function rankUnitsBySubmarca(
  baseline: FleetBaseline,
  submarcaDe: ReadonlyMap<string, string>,
  sucursalDe: ReadonlyMap<string, string>,
  minN = 2,
): Map<string, UnitRank[]> {
  const canon = new Map<string, string>(); // clave case-insensitive → etiqueta visible
  const out = new Map<string, UnitRank[]>();
  for (const [eco, s] of baseline.porUnidad) {
    const k = repKmpl(s);
    if (!(s.n >= minN && Number.isFinite(k) && k > 0)) continue;
    const label = submarcaDe.get(eco) || "(sin tipo)";
    const key = label.toUpperCase();
    if (!canon.has(key)) {
      canon.set(key, label);
      out.set(label, []);
    }
    out.get(canon.get(key)!)!.push({ eco, kmpl: k, n: s.n, sucursal: sucursalDe.get(eco) });
  }
  for (const ranks of out.values()) ranks.sort((a, b) => a.kmpl - b.kmpl); // peor primero
  return out;
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

/**
 * Offset UTC (horas) de la sucursal — México sin DST desde 2022. Cancún (Quintana Roo)
 * = UTC-5, Cabos (BCS) = UTC-7, el resto de la operación GPA (GDL/MTY/CDMX/Vallarta)
 * = UTC-6. `fechaHora` viene en hora local del DISPOSITIVO; sin este offset, las
 * duraciones de Cancún salían corridas −1 h (observado en payloads reales).
 */
export function tzOffsetDeSucursal(sucursal: string | undefined): number {
  const s = (sucursal ?? "").toLowerCase();
  if (s.includes("canc")) return -5;
  if (s.includes("cabo")) return -7;
  return -6;
}

/**
 * Minutos entre la APERTURA del formulario (`fechaHora`, hora local que el widget
 * auto-llena al abrir) y su CIERRE (`formCerrado`, ISO UTC de meta.registrationDate).
 * undefined si falta alguno, si sale negativa (reloj/huso roto o fecha editada hacia
 * adelante) o si supera 24 h (el chofer registró un evento viejo — eso no es "tiempo
 * de captura"). Precisión ±1 min (la apertura es minuto-granular).
 */
export function duracionCapturaMin(
  e: Pick<FuelEntry, "fechaHora" | "formCerrado" | "sucursal">,
): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(String(e.fechaHora ?? ""));
  if (!m || !e.formCerrado) return undefined;
  const offset = tzOffsetDeSucursal(e.sucursal);
  const abiertoUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]! - offset, +m[5]!);
  const cerradoUtc = Date.parse(e.formCerrado);
  if (!Number.isFinite(cerradoUtc)) return undefined;
  const min = (cerradoUtc - abiertoUtc) / 60000;
  if (!Number.isFinite(min) || min < 0 || min > 24 * 60) return undefined;
  return Math.round(min * 10) / 10;
}

export type DuracionGrupo = { group: string; medianaMin: number; p90Min: number; n: number };

/**
 * Duración de captura agrupada por responsable — mediana (robusta a outliers) y p90.
 * Orden DESC por mediana: quien más tarda en cerrar el formulario, primero (obs. 4
 * de auditoría). Solo entradas con duración medible.
 */
export function duracionPorResponsable(entries: readonly FuelEntry[]): DuracionGrupo[] {
  const porResp = new Map<string, number[]>();
  for (const e of entries) {
    const d = duracionCapturaMin(e);
    if (d == null) continue;
    const r = e.responsable || "(sin responsable)";
    const arr = porResp.get(r);
    if (arr) arr.push(d);
    else porResp.set(r, [d]);
  }
  const out: DuracionGrupo[] = [];
  for (const [group, vals] of porResp)
    out.push({
      group,
      medianaMin: Math.round(percentile(vals, 50) * 10) / 10,
      p90Min: Math.round(percentile(vals, 90) * 10) / 10,
      n: vals.length,
    });
  return out.sort((a, b) => b.medianaMin - a.medianaMin);
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
