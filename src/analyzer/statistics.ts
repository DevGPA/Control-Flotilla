/**
 * Utilidades estadísticas puras para el análisis de rendimiento de combustible
 * (y reusables por otros módulos). Sin dependencias, sin DOM. Todas las funciones
 * ignoran valores no finitos (NaN/Infinity/null) y son seguras con arrays vacíos.
 */

/** Filtra a números finitos. */
function finite(xs: readonly number[]): number[] {
  return xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
}

/** Media aritmética. NaN si no hay valores finitos. */
export function mean(xs: readonly number[]): number {
  const v = finite(xs);
  if (v.length === 0) return NaN;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/**
 * Desviación estándar. `sample=true` (default) usa n-1 (muestral); n para poblacional.
 * 0 si hay <2 valores (sin dispersión medible).
 */
export function stdDev(xs: readonly number[], sample = true): number {
  const v = finite(xs);
  const n = v.length;
  if (n < 2) return 0;
  const m = mean(v);
  const ss = v.reduce((a, b) => a + (b - m) * (b - m), 0);
  return Math.sqrt(ss / (sample ? n - 1 : n));
}

/**
 * Percentil `p` (0..100) por interpolación lineal sobre los valores ordenados.
 * NaN si no hay valores. p se acota a [0,100].
 */
export function percentile(xs: readonly number[], p: number): number {
  const v = finite(xs).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  if (v.length === 1) return v[0]!;
  const pp = Math.min(100, Math.max(0, p));
  const idx = (pp / 100) * (v.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return v[lo]!;
  const frac = idx - lo;
  return v[lo]! + (v[hi]! - v[lo]!) * frac;
}

/** Mediana (percentil 50). */
export function median(xs: readonly number[]): number {
  return percentile(xs, 50);
}

/** z-score de x respecto a (mean, sd). 0 si sd<=0 (sin dispersión). */
export function zScore(x: number, m: number, sd: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(m) || !Number.isFinite(sd) || sd <= 0) return 0;
  return (x - m) / sd;
}

/**
 * Recorta outliers por la regla IQR (Tukey): descarta valores fuera de
 * [Q1 - k·IQR, Q3 + k·IQR]. `k=1.5` por defecto. Devuelve el subconjunto filtrado
 * (los valores que quedan), útil para baselines robustos de km/l donde una carga
 * que no llenó el tanque produce un evento atípico.
 */
export function clampOutliers(xs: readonly number[], k = 1.5): number[] {
  const v = finite(xs);
  if (v.length < 4) return v; // muy pocos datos para detectar outliers de forma fiable
  const q1 = percentile(v, 25);
  const q3 = percentile(v, 75);
  const iqr = q3 - q1;
  const lo = q1 - k * iqr;
  const hi = q3 + k * iqr;
  return v.filter((x) => x >= lo && x <= hi);
}
