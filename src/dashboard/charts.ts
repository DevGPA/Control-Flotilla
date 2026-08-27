// Dashboard charts — ECharts vanilla wrappers. Usa paleta Tremor (main.css CSS vars)
// y se resyncra cuando data-theme="dark" cambia.
//
// Patrón: cada render* acepta container + data + callbacks; retorna la instancia
// ECharts para permitir .resize() o .dispose() desde el caller.

import * as echarts from "echarts/core";
import { PieChart, BarChart, LineChart } from "echarts/charts";
import {
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  GridComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { getTremorPalette, onThemeChange } from "./chartTheme";
import type { GastoMes } from "../analytics/opsTablero";
import { gradBar, ejesVivo, tooltipVivo, animVivo, fmtMoneda } from "./chartVivo";

echarts.use([
  PieChart,
  BarChart,
  LineChart,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  GridComponent,
  CanvasRenderer,
]);

export type DonutSegment = {
  /** Clave estable usada en onSegmentClick — independiente del label. */
  key: string;
  label: string;
  value: number;
  /** Color literal (hex o rgba). Leer de CSS vars vía getTremorPalette en el caller. */
  color: string;
};

type DonutHandlers = {
  onSegmentClick?: (key: string) => void;
};

/**
 * Donut compacto genérico. Sin legend built-in — caller provee leyenda custom
 * para máxima flexibilidad (ej. legend con dim-on-hover del legacy).
 * Center label muestra el % del segmento dominante.
 */
export function renderDonut(
  container: HTMLElement,
  segments: DonutSegment[],
  handlers: DonutHandlers = {},
): echarts.ECharts {
  // Dispose previa si existe (buildKPIs corre múltiples veces).
  const existing = echarts.getInstanceByDom(container);
  if (existing) existing.dispose();

  const chart = echarts.init(container, null, { renderer: "canvas" });
  chart.setOption(buildDonutOption(segments));

  chart.on("click", "series", (params) => {
    if (!handlers.onSegmentClick) return;
    const key = (params.data as { key?: string }).key;
    if (key) handlers.onSegmentClick(key);
  });

  // Re-sync colores en theme toggle — re-lee CSS vars del :root dark.
  const off = onThemeChange(() => {
    // Caller debe re-invocar renderDonut con colores nuevos; aquí solo resize
    // por seguridad (theme change también puede afectar tooltip bg).
    chart.setOption(buildDonutOption(segments));
  });

  // Resize responsive
  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(container);

  // Cleanup wrap
  const origDispose = chart.dispose.bind(chart);
  chart.dispose = () => {
    off();
    ro.disconnect();
    origDispose();
  };

  return chart;
}

function buildDonutOption(segments: DonutSegment[]): echarts.EChartsCoreOption {
  const p = getTremorPalette();
  const visible = segments.filter((s) => s.value > 0);
  const total = visible.reduce((acc, s) => acc + s.value, 0);
  // Segmento dominante para center label
  const dominant = visible.reduce<DonutSegment | null>(
    (a, b) => (a === null || b.value > a.value ? b : a),
    visible[0] ?? null,
  );
  const dominantPct = total && dominant ? Math.round((dominant.value / total) * 100) : 0;

  return {
    ...animVivo(),
    tooltip: {
      trigger: "item",
      ...tooltipVivo(p),
      padding: [6, 10],
      formatter: (params: unknown) => {
        const pp = params as { name: string; value: number; percent: number };
        return `${pp.name} <b>${pp.value}</b> (${pp.percent.toFixed(0)}%)`;
      },
    },
    series: [
      {
        name: "Riesgo",
        type: "pie",
        radius: ["62%", "88%"],
        center: ["50%", "50%"],
        avoidLabelOverlap: false,
        silent: false,
        label: {
          show: !!dominant,
          position: "center",
          formatter: () => {
            if (!dominant) return "";
            return `{v|${dominantPct}%}\n{l|${dominant.label}}`;
          },
          rich: {
            v: { fontSize: 17, fontWeight: 800, color: p.text, lineHeight: 18 },
            l: {
              fontSize: 8.5,
              fontWeight: 700,
              color: p.textSub,
              lineHeight: 12,
              letterSpacing: 0.4,
            },
          },
        },
        labelLine: { show: false },
        itemStyle: {
          borderColor: p.bg,
          borderWidth: 2,
          borderRadius: 5,
        },
        data: visible.map((s) => ({
          name: s.label,
          value: s.value,
          itemStyle: { color: s.color },
          key: s.key,
        })),
      },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════
//  TREND LINE — % Urgente/Revisar/OK periodo-a-periodo
// ═══════════════════════════════════════════════════════════════════

export type PeriodTrend = {
  /** Label legible del periodo (ej "Marzo 2026") — va al eje X. */
  label: string;
  total: number;
  urgente: number;
  revisar: number;
  operativa: number;
};

export function renderTrendLine(container: HTMLElement, data: PeriodTrend[]): echarts.ECharts {
  const existing = echarts.getInstanceByDom(container);
  if (existing) existing.dispose();

  const chart = echarts.init(container, null, { renderer: "canvas" });
  chart.setOption(buildTrendOption(data));

  const off = onThemeChange(() => chart.setOption(buildTrendOption(data)));
  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(container);

  const origDispose = chart.dispose.bind(chart);
  chart.dispose = () => {
    off();
    ro.disconnect();
    origDispose();
  };

  return chart;
}

function buildTrendOption(data: PeriodTrend[]): echarts.EChartsCoreOption {
  const p = getTremorPalette();
  const labels = data.map((d) => d.label);
  const pctUrgente = data.map((d) => (d.total ? +((d.urgente / d.total) * 100).toFixed(1) : 0));
  const pctRevisar = data.map((d) => (d.total ? +((d.revisar / d.total) * 100).toFixed(1) : 0));
  const pctOperativa = data.map((d) => (d.total ? +((d.operativa / d.total) * 100).toFixed(1) : 0));

  return {
    ...animVivo(),
    tooltip: {
      trigger: "axis",
      ...tooltipVivo(p),
      valueFormatter: (v: unknown) => `${v}%`,
    },
    legend: {
      top: 0,
      right: 0,
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 12,
      textStyle: { color: p.textSub, fontSize: 10 },
      icon: "circle",
    },
    grid: { left: 8, right: 12, top: 26, bottom: 4, containLabel: true },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { color: p.text, fontSize: 10, fontWeight: 500 },
      axisLine: { lineStyle: { color: p.ln } },
      axisTick: { show: false },
      boundaryGap: false,
    },
    yAxis: {
      type: "value",
      ...ejesVivo(p),
      axisLabel: { color: p.textSub, fontSize: 10, formatter: "{value}%" },
      max: 100,
    },
    series: [
      {
        name: "Urgente",
        type: "line",
        data: pctUrgente,
        smooth: true,
        lineStyle: { color: p.R, width: 2.5 },
        itemStyle: { color: p.R },
        symbol: "circle",
        symbolSize: 7,
      },
      {
        name: "Revisar",
        type: "line",
        data: pctRevisar,
        smooth: true,
        lineStyle: { color: p.A, width: 2.5 },
        itemStyle: { color: p.A },
        symbol: "circle",
        symbolSize: 7,
      },
      {
        name: "Operativa",
        type: "line",
        data: pctOperativa,
        smooth: true,
        lineStyle: { color: p.G, width: 2.5 },
        itemStyle: { color: p.G },
        symbol: "circle",
        symbolSize: 7,
      },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════
//  GASTO DE TALLER POR MES (stacked bar por sucursal)
// ═══════════════════════════════════════════════════════════════════

export function renderGastoMensualBar(container: HTMLElement, data: GastoMes[]): echarts.ECharts {
  const existing = echarts.getInstanceByDom(container);
  if (existing) existing.dispose();

  const chart = echarts.init(container, null, { renderer: "canvas" });
  chart.setOption(buildGastoMensualOption(data));

  const off = onThemeChange(() => chart.setOption(buildGastoMensualOption(data)));
  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(container);

  const origDispose = chart.dispose.bind(chart);
  chart.dispose = () => {
    off();
    ro.disconnect();
    origDispose();
  };

  return chart;
}

function buildGastoMensualOption(data: GastoMes[]): echarts.EChartsCoreOption {
  const p = getTremorPalette();
  const labels = data.map((d) => d.label);
  // Series = sucursales presentes en la ventana, ordenadas por gasto total desc
  // (las grandes abajo del stack, legible).
  const totalPorSuc = new Map<string, number>();
  for (const d of data) {
    for (const [suc, g] of Object.entries(d.porSucursal)) {
      totalPorSuc.set(suc, (totalPorSuc.get(suc) || 0) + g);
    }
  }
  const sucursales = [...totalPorSuc.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const colores = [p.B, p.G, p.A, p.ac, p.O, p.R, p.ac2];

  return {
    ...animVivo(),
    tooltip: {
      ...tooltipVivo(p),
      trigger: "axis",
      valueFormatter: (v: unknown) => (typeof v === "number" && v > 0 ? fmtMoneda(v) : "—"),
    },
    legend: {
      bottom: 0,
      itemWidth: 10,
      itemHeight: 10,
      icon: "circle",
      textStyle: { color: p.textSub, fontSize: 10 },
    },
    grid: { left: 8, right: 12, top: 16, bottom: 28, containLabel: true },
    xAxis: {
      type: "category",
      data: labels,
      ...ejesVivo(p),
    },
    yAxis: {
      type: "value",
      ...ejesVivo(p),
      axisLabel: { color: p.textSub, fontSize: 10, formatter: (v: number) => fmtMoneda(v) },
    },
    series: sucursales.map((suc, i) => ({
      name: suc,
      type: "bar" as const,
      stack: "gasto",
      barMaxWidth: 26,
      emphasis: { focus: "series" as const },
      itemStyle: { color: gradBar(colores[i % colores.length]!), borderRadius: 0 },
      data: data.map((d) => d.porSucursal[suc] || 0),
    })),
  };
}
