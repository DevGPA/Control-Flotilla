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

/** Tooltip flotante con la superficie del tema. */
export const tooltipVivo = (p: TremorPalette) => ({
  backgroundColor: p.bg,
  borderColor: p.ln,
  borderWidth: 1,
  padding: [8, 12],
  textStyle: { color: p.text, fontSize: 12 },
  extraCssText: "border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,.16)",
});
