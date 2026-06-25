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

/**
 * Timestamp para ordenar cronológicamente (fechaHora si existe, si no fecha).
 * Construye la fecha por COMPONENTES en hora local para que "YYYY-MM-DD" (solo
 * fecha) y "YYYY-MM-DD HH:MM" usen el MISMO huso. Antes se usaba Date.parse, que
 * interpreta la solo-fecha como UTC y la fecha+hora como local → en UTC-6 invertía
 * el orden de cargas de la misma unidad y corrompía km/l + disparaba falsas anomalías.
 */
function toTime(e: Pick<FuelEntry, "fecha" | "fechaHora">): number {
  const raw = String(e.fechaHora || e.fecha || "").trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : 0;
  }
  return new Date(+m[1]!, +m[2]! - 1, +m[3]!, m[4] ? +m[4] : 0, m[5] ? +m[5] : 0).getTime();
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
    const sorted = [...arr].sort((a, b) => {
      const dt = toTime(a) - toTime(b);
      if (dt !== 0) return dt;
      // Mismo timestamp (típico cuando MoreApp manda solo fecha sin hora): ordena por
      // odómetro ascendente para no inventar un "retroceso" entre dos cargas del mismo
      // día, y desempata estable por loadId. Sin esto el orden quedaba a merced del
      // orden de listado de DynamoDB → falso km-retrocede + km/l mal repartido.
      const ka = typeof a.km === "number" ? a.km : 0;
      const kb = typeof b.km === "number" ? b.km : 0;
      if (ka !== kb) return ka - kb;
      return a.loadId.localeCompare(b.loadId);
    });
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
        // Se revisa también `prev` por defensa en profundidad (montacargas mal etiquetado).
        if (typeof prev.km === "number" && km != null && !e.esMontacargas && !prev.esMontacargas) {
          kmDesdeAnterior = km - prev.km;
          // km/l solo si el tramo es plausible: >0 y por debajo del salto improbable.
          // Un salto > MAX_KM_JUMP casi siempre significa cargas intermedias no
          // registradas → ese km/l estaría inflado (km de varios tanques ÷ litros de uno)
          // y, si no se excluyera del baseline, podría empujar la unidad a "mejores".
          // Dejamos kmDesdeAnterior poblado para que la alerta km-salto siga disparando.
          if (
            litros != null &&
            kmDesdeAnterior > 0 &&
            kmDesdeAnterior <= DEFAULT_FUEL_THRESHOLDS.MAX_KM_JUMP
          )
            kmPorLitro = kmDesdeAnterior / litros;
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

/** Un evento de rendimiento: km recorridos, litros cargados y su km/l. */
type KmEvent = { km: number; litros: number; kmpl: number };

/** Cerca IQR (Tukey k) sobre los km/l; [-∞,∞] si hay <4 (no se puede recortar fiable). */
function iqrBounds(kmpls: readonly number[], k = 1.5): [number, number] {
  if (kmpls.length < 4) return [-Infinity, Infinity];
  const q1 = percentile(kmpls as number[], 25);
  const q3 = percentile(kmpls as number[], 75);
  const iqr = q3 - q1;
  return [q1 - k * iqr, q3 + k * iqr];
}

/**
 * km/l PONDERADO POR VOLUMEN: Σkm/Σlitros sobre los eventos cuyo km/l cae dentro de la cerca
 * IQR. La cerca descarta llenados parciales atípicos y dedazos de litros ANTES de sumar (el
 * ponderado por volumen no recorta solo). NaN si no quedan litros. Esta es la métrica fiel
 * (sin sesgo de tramos cortos, robusta a tanque no lleno) que se muestra/ranquea.
 */
function volWeightedKmpl(events: readonly KmEvent[]): number {
  const [lo, hi] = iqrBounds(events.map((e) => e.kmpl));
  let sumKm = 0;
  let sumLitros = 0;
  for (const e of events) {
    if (e.kmpl < lo || e.kmpl > hi) continue;
    sumKm += e.km;
    sumLitros += e.litros;
  }
  return sumLitros > 0 ? sumKm / sumLitros : NaN;
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

  // Reúne EVENTOS válidos (km recorrido + litros + km/l) por unidad/tipo/flota. El filtro es
  // el mismo de siempre (km/l finito y >0 ya excluye montacargas/retroceso/salto/litros≤0); el
  // guard extra de km/litros es para TS (cuando hay km/l, ambos existen y son >0).
  const evByUnit = new Map<string, KmEvent[]>();
  const evByTipo = new Map<string, KmEvent[]>();
  const allEv: KmEvent[] = [];
  for (const m of metrics) {
    if (m.kmPorLitro == null || !(m.kmPorLitro > 0) || !Number.isFinite(m.kmPorLitro)) continue;
    if (m.kmDesdeAnterior == null || m.litros == null || !(m.litros > 0)) continue;
    const ev: KmEvent = { km: m.kmDesdeAnterior, litros: m.litros, kmpl: m.kmPorLitro };
    pushInto(evByUnit, m.eco, ev);
    pushInto(evByTipo, tipoOf.get(m.eco) ?? "(sin tipo)", ev);
    allEv.push(ev);
  }

  // mean/sd/p25/p75 = distribución de km/l por evento (para anomalías). kmplVol = ponderado.
  const porUnidad = new Map<string, FuelStat>();
  for (const [eco, evs] of evByUnit)
    porUnidad.set(eco, { ...statOf(evs.map((e) => e.kmpl)), kmplVol: volWeightedKmpl(evs) });
  const porTipo = new Map<string, FuelStat>();
  for (const [tipo, evs] of evByTipo)
    porTipo.set(tipo, { ...statOf(evs.map((e) => e.kmpl)), kmplVol: volWeightedKmpl(evs) });

  return {
    porUnidad,
    porTipo,
    tipoDe: tipoOf,
    flotaMean: mean(clampOutliers(allEv.map((e) => e.kmpl))),
    flotaKmplVol: volWeightedKmpl(allEv),
  };
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
