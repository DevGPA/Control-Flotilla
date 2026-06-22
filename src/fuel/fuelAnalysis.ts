/**
 * Motor PURO de rendimiento y anomalías de combustible. Sin DOM ni red.
 *
 * km/l por evento = (km de esta carga − km de la carga anterior de la MISMA unidad)
 * / litros cargados. Supuesto tanque-lleno: si una carga no llenó el tanque el evento
 * es ruidoso → el baseline por unidad recorta outliers (IQR) y los KPIs/alertas
 * priorizan el promedio por unidad sobre el km/l de un evento aislado.
 */
import type {
  FuelEntry,
  FuelMetrics,
  FleetBaseline,
  FuelStat,
  FuelThresholds,
  FuelFinding,
  RiskLevel,
} from "./types";
import { mean, stdDev, percentile, clampOutliers } from "../analyzer/statistics";

export const DEFAULT_FUEL_THRESHOLDS: FuelThresholds = {
  DROP_SD: 1.5,
  DROP_PCT: 0.75,
  LITERS_SD: 2,
  // Salto de odómetro entre cargas consecutivas. Una unidad recorre fácilmente >1500 km
  // entre llenadas (sobre todo con cargas no consecutivas en el histórico), así que el
  // umbral marca solo saltos genuinamente improbables (probable error de captura / cargas
  // intermedias sin registrar).
  MAX_KM_JUMP: 8000,
  MIN_DAYS: 1,
  PRICE_MIN: 18,
  PRICE_MAX: 35,
  LEAK_PCT: 0.5,
  MIN_BASELINE_N: 3,
};

/** Timestamp para ordenar cronológicamente (fechaHora si existe, si no fecha). */
function toTime(e: Pick<FuelEntry, "fecha" | "fechaHora">): number {
  const s = (e.fechaHora || e.fecha || "").replace(" ", "T");
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

/** Agrupa entradas por unidad (economicoId), preservando el array por clave. */
export function groupByUnit<T extends { eco: string }>(items: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) pushInto(m, it.eco, it);
  return m;
}

/** Empuja `val` al array de la clave `key` en `m`, creándolo si no existe. */
function pushInto<T>(m: Map<string, T[]>, key: string, val: T): void {
  const arr = m.get(key);
  if (arr) arr.push(val);
  else m.set(key, [val]);
}

/**
 * Calcula métricas km/l por evento de CARGA. Ignora solicitudes (sin litros reales).
 * La primera carga de cada unidad no tiene km/l (sin carga anterior).
 */
export function computeFuelMetrics(entries: readonly FuelEntry[]): FuelMetrics[] {
  const cargas = entries.filter((e) => e.tipo === "carga");
  const byUnit = groupByUnit(cargas);
  const out: FuelMetrics[] = [];
  for (const arr of byUnit.values()) {
    const sorted = [...arr].sort((a, b) => toTime(a) - toTime(b));
    let prev: FuelEntry | null = null;
    for (const e of sorted) {
      const km = typeof e.km === "number" && Number.isFinite(e.km) ? e.km : null;
      const litros = typeof e.litros === "number" && e.litros > 0 ? e.litros : null;
      const monto = typeof e.monto === "number" && Number.isFinite(e.monto) ? e.monto : null;
      let kmDesdeAnterior: number | null = null;
      let kmPorLitro: number | null = null;
      let diasDesdeAnterior: number | null = null;
      if (prev) {
        const dt = toTime(e) - toTime(prev);
        diasDesdeAnterior = dt > 0 ? dt / 86400000 : 0;
        // Montacargas Gas LP: su `km` es horómetro (horas), no odómetro → NO se computa
        // km recorrido ni km/l (sería ruido que contamina baseline/ranking/anomalías).
        if (typeof prev.km === "number" && km != null && !e.esMontacargas) {
          kmDesdeAnterior = km - prev.km;
          if (litros != null && kmDesdeAnterior > 0) kmPorLitro = kmDesdeAnterior / litros;
        }
      }
      const precioPorLitro =
        monto != null && litros != null
          ? monto / litros
          : typeof e.precioPorLitro === "number"
            ? e.precioPorLitro
            : null;
      out.push({
        loadId: e.loadId,
        eco: e.eco,
        fecha: e.fecha,
        km,
        litros,
        monto,
        kmDesdeAnterior,
        kmPorLitro,
        precioPorLitro,
        diasDesdeAnterior,
      });
      prev = e;
    }
  }
  return out;
}

/** Métricas agrupadas por unidad (para historial y comparativos). */
export function groupMetricsByUnit(metrics: readonly FuelMetrics[]): Map<string, FuelMetrics[]> {
  return groupByUnit(metrics);
}

function statOf(values: number[]): FuelStat {
  const clean = clampOutliers(values);
  const base = clean.length >= 2 ? clean : values;
  return {
    mean: mean(base),
    sd: stdDev(base),
    n: values.length,
    p25: percentile(base, 25),
    p75: percentile(base, 75),
  };
}

/**
 * Baseline de la flota a partir de las métricas: km/l por unidad, por tipo de unidad
 * (para "vs unidades similares") y media de flota. Usa recorte IQR para robustez.
 */
export function buildFleetBaseline(
  metrics: readonly FuelMetrics[],
  entries: readonly FuelEntry[] = [],
): FleetBaseline {
  const tipoOf = new Map<string, string>();
  for (const e of entries) if (e.tipoUnidad) tipoOf.set(e.eco, e.tipoUnidad);

  const kmplByUnit = new Map<string, number[]>();
  const kmplByTipo = new Map<string, number[]>();
  const allKmpl: number[] = [];
  for (const m of metrics) {
    if (m.kmPorLitro == null || !(m.kmPorLitro > 0) || !Number.isFinite(m.kmPorLitro)) continue;
    pushInto(kmplByUnit, m.eco, m.kmPorLitro);
    pushInto(kmplByTipo, tipoOf.get(m.eco) ?? "(sin tipo)", m.kmPorLitro);
    allKmpl.push(m.kmPorLitro);
  }

  const porUnidad = new Map<string, FuelStat>();
  for (const [eco, vals] of kmplByUnit) porUnidad.set(eco, statOf(vals));
  const porTipo = new Map<string, FuelStat>();
  for (const [tipo, vals] of kmplByTipo) porTipo.set(tipo, statOf(vals));

  return { porUnidad, porTipo, flotaMean: mean(clampOutliers(allKmpl)) };
}

/** Precedencia de RiskLevel para agregar el peor. */
const RISK_ORDER: Record<RiskLevel, number> = { Urgente: 3, Revisar: 2, Completar: 1.5, OK: 1 };

/** Devuelve el RiskLevel más severo de una lista de findings (OK si vacía). */
export function worstRisk(findings: readonly { lv: RiskLevel }[]): RiskLevel {
  let worst: RiskLevel = "OK";
  for (const f of findings) if (RISK_ORDER[f.lv] > RISK_ORDER[worst]) worst = f.lv;
  return worst;
}

/**
 * Detecta anomalías de combustible y devuelve hallazgos con identidad estable.
 * Reglas (umbrales configurables vía cfg): caída de rendimiento, consumo inusual,
 * discrepancia de km (odómetro retrocede / salto improbable), cargas demasiado
 * frecuentes, errores de captura, posible fuga/uso indebido sostenido.
 */
export function detectFuelAnomalies(
  metrics: readonly FuelMetrics[],
  baseline: FleetBaseline,
  cfg: FuelThresholds = DEFAULT_FUEL_THRESHOLDS,
): FuelFinding[] {
  const out: FuelFinding[] = [];
  const push = (m: FuelMetrics, rule: string, text: string, lv: RiskLevel) =>
    out.push({
      cat: "Combustible",
      text,
      lv,
      key: `Fuel:${rule}:${m.loadId}`,
      loadId: m.loadId,
      eco: m.eco,
    });

  // litros por unidad para "consumo inusual"
  const litrosByUnit = new Map<string, number[]>();
  for (const m of metrics)
    if (m.litros != null && m.litros > 0) pushInto(litrosByUnit, m.eco, m.litros);
  const litrosStat = new Map<string, FuelStat>();
  for (const [eco, vals] of litrosByUnit) litrosStat.set(eco, statOf(vals));

  const byUnit = groupMetricsByUnit(metrics);
  for (const arr of byUnit.values()) {
    // arr ya viene ordenado por computeFuelMetrics (orden de inserción cronológico)
    let prevLeak = false;
    for (const m of arr) {
      // 1. Errores de captura
      if (m.litros == null || m.litros <= 0)
        push(m, "captura-litros", "Litros inválidos o ausentes en la captura", "Completar");
      if (m.monto != null && m.monto <= 0)
        push(m, "captura-monto", "Monto inválido o ausente en la captura", "Completar");
      if (m.km == null) push(m, "captura-km", "Kilometraje ausente en la captura", "Completar");
      if (
        m.precioPorLitro != null &&
        (m.precioPorLitro < cfg.PRICE_MIN || m.precioPorLitro > cfg.PRICE_MAX)
      )
        push(
          m,
          "captura-precio",
          `Precio por litro fuera de rango: $${m.precioPorLitro.toFixed(2)}/l`,
          "Completar",
        );

      // 2. Discrepancia de km vs histórico
      if (m.kmDesdeAnterior != null && m.kmDesdeAnterior < 0)
        push(
          m,
          "km-retrocede",
          `El odómetro retrocede ${Math.abs(m.kmDesdeAnterior).toLocaleString("es-MX")} km respecto a la carga anterior`,
          "Urgente",
        );
      else if (m.kmDesdeAnterior != null && m.kmDesdeAnterior > cfg.MAX_KM_JUMP)
        push(
          m,
          "km-salto",
          `Salto de odómetro improbable: ${m.kmDesdeAnterior.toLocaleString("es-MX")} km entre cargas`,
          "Revisar",
        );

      // 3. Cargas demasiado frecuentes
      if (m.diasDesdeAnterior != null && m.diasDesdeAnterior < cfg.MIN_DAYS)
        push(
          m,
          "frecuencia",
          `Carga muy cercana a la anterior (${m.diasDesdeAnterior.toFixed(1)} días)`,
          "Revisar",
        );

      // 4. Caída de rendimiento (requiere baseline confiable de la unidad)
      const stat = baseline.porUnidad.get(m.eco);
      if (m.kmPorLitro != null && stat && stat.n >= cfg.MIN_BASELINE_N && stat.mean > 0) {
        const umbralSd = stat.mean - cfg.DROP_SD * stat.sd;
        const umbralPct = stat.mean * cfg.DROP_PCT;
        if (m.kmPorLitro < umbralSd && m.kmPorLitro < umbralPct)
          push(
            m,
            "rendimiento",
            `Rendimiento bajo: ${m.kmPorLitro.toFixed(2)} km/l vs histórico ${stat.mean.toFixed(2)} km/l`,
            "Revisar",
          );
      }

      // 5. Consumo inusual de litros
      const ls = litrosStat.get(m.eco);
      if (m.litros != null && ls && ls.n >= cfg.MIN_BASELINE_N && ls.sd > 0) {
        if (m.litros > ls.mean + cfg.LITERS_SD * ls.sd)
          push(
            m,
            "consumo",
            `Consumo inusual: ${m.litros.toFixed(1)} L vs habitual ${ls.mean.toFixed(1)} L`,
            "Revisar",
          );
      }

      // 6. Posible fuga / uso indebido (km/l muy bajo vs flota, sostenido 2+ cargas)
      const leakNow =
        m.kmPorLitro != null &&
        baseline.flotaMean > 0 &&
        m.kmPorLitro < baseline.flotaMean * cfg.LEAK_PCT;
      if (leakNow && prevLeak)
        push(
          m,
          "fuga",
          `Posible fuga/uso indebido: km/l muy por debajo de la flota en cargas consecutivas`,
          "Urgente",
        );
      prevLeak = !!leakNow;
    }
  }
  return out;
}
