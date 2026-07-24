/**
 * Estilo compartido "Producto Vivo" (spec 2026-07-23) para TODOS los charts ECharts
 * de la app: gradientes de barra, ejes recesivos, tooltip elevado y animación de
 * entrada (respetando prefers-reduced-motion). Puro salvo animVivo (lee matchMedia).
 */
import * as echarts from "echarts/core";
import type { TremorPalette } from "./chartTheme";

/** Mezcla un hex hacia blanco. f=0 → color, f=1 → blanco. */
export function aclarar(hex: string, f: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  const mix = (c: number) => Math.round(c + (255 - c) * f);
  const r = mix((n >> 16) & 255),
    g = mix((n >> 8) & 255),
    b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Degradado vertical claro→color para barras (dirección C). */
export function gradBar(hex: string): echarts.graphic.LinearGradient {
  return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: aclarar(hex, 0.28) },
    { offset: 1, color: hex },
  ]);
}

/** Variante horizontal (barras hbar): claro a la izquierda. */
export function gradBarH(hex: string): echarts.graphic.LinearGradient {
  return new echarts.graphic.LinearGradient(0, 0, 1, 0, [
    { offset: 0, color: aclarar(hex, 0.28) },
    { offset: 1, color: hex },
  ]);
}

/** Rampa secuencial de un hue (claro→base) para apiladas de 4+ meses. */
export function rampaSecuencial(hex: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(aclarar(hex, 0.55 * (1 - i / Math.max(1, n - 1))));
  out[n - 1] = hex;
  return out;
}

/** Animación de entrada única; 0 si el usuario pide reduced-motion (o sin window). */
export function animVivo(): { animationDuration: number; animationEasing: "cubicOut" } {
  const reduce =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return { animationDuration: reduce ? 0 : 700, animationEasing: "cubicOut" };
}

/** Ejes recesivos: sin línea ni ticks, grid sutil. */
export const ejesVivo = (p: TremorPalette) => ({
  axisLine: { show: false },
  axisTick: { show: false },
  axisLabel: { color: p.textSub, fontSize: 10.5 },
  splitLine: { lineStyle: { color: p.ln, opacity: 0.55 } },
});

const NF_COMPACT = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });
const round1 = (x: number): number => Math.round(x * 10) / 10;

/**
 * Número compacto y legible para ejes/etiquetas de charts: 375→"375", 3500→"3.5k",
 * 2_300_000→"2.3M". Sustituye al viejo `Math.round(v/1000)+"k"`, que colapsaba los
 * ticks de 500 en etiquetas duplicadas ("$3k $3k") y los cientos de litros en "0k L".
 */
export function compactNumber(v: number): string {
  const a = Math.abs(v);
  if (a < 1000) return NF_COMPACT.format(Math.round(v));
  // Re-bucketiza TRAS redondear: 999_950 → k=1000.0, que debe leerse "1M", no "1,000k".
  const k = round1(v / 1000);
  if (Math.abs(k) < 1000) return `${NF_COMPACT.format(k)}k`;
  return `${NF_COMPACT.format(round1(v / 1_000_000))}M`;
}

/** Moneda compacta para ejes/etiquetas: 3000→"$3k", 375→"$375". */
export const fmtMoneda = (v: number): string => `$${compactNumber(v)}`;

/** Litros compactos para ejes/etiquetas: 375→"375 L", 1200→"1.2k L" (nunca "0k L"). */
export const fmtLitros = (v: number): string => `${compactNumber(v)} L`;

/** Tooltip flotante con la superficie del tema. */
export const tooltipVivo = (p: TremorPalette) => ({
  backgroundColor: p.bg,
  borderColor: p.ln,
  borderWidth: 1,
  padding: [8, 12],
  textStyle: { color: p.text, fontSize: 12 },
  extraCssText: "border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,.16)",
});
