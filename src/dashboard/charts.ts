// Dashboard charts — ECharts vanilla wrappers. Usa paleta Tremor (main.css CSS vars)
// y se resyncra cuando data-theme="dark" cambia.
//
// Patrón: cada render* acepta container + data + callbacks; retorna la instancia
// ECharts para permitir .resize() o .dispose() desde el caller.

import * as echarts from "echarts/core";
import { PieChart, BarChart, LineChart, HeatmapChart, ScatterChart } from "echarts/charts";
import { MarkLineComponent } from "echarts/components";
import {
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  GridComponent,
  CalendarComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { getTremorPalette, onThemeChange } from "./chartTheme";

echarts.use([
  PieChart,
  BarChart,
  LineChart,
  HeatmapChart,
  ScatterChart,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  GridComponent,
  CalendarComponent,
  VisualMapComponent,
  MarkLineComponent,
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

// ═══════════════════════════════════════════════════════════════════
//  SUCURSALES BAR (horizontal stacked)
// ═══════════════════════════════════════════════════════════════════

export type BranchStat = {
  branch: string;
  urgente: number;
  revisar: number;
  operativa: number;
};

export function renderBranchesBar(
  container: HTMLElement,
  data: BranchStat[],
  handlers: { onBranchClick?: (branch: string) => void } = {},
): echarts.ECharts {
  const existing = echarts.getInstanceByDom(container);
  if (existing) existing.dispose();

  const chart = echarts.init(container, null, { renderer: "canvas" });
  chart.setOption(buildBranchesOption(data));

  chart.on("click", "series", (params) => {
    if (!handlers.onBranchClick) return;
    const branch = params.name;
    if (typeof branch === "string") handlers.onBranchClick(branch);
  });

  const off = onThemeChange(() => chart.setOption(buildBranchesOption(data)));
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

function buildBranchesOption(data: BranchStat[]): echarts.EChartsCoreOption {
  const p = getTremorPalette();
  // Sort desc por urgente (peor arriba en horizontal bar = primera en eje Y inverso)
  const sorted = [...data].sort((a, b) => b.urgente - a.urgente || b.revisar - a.revisar);
  const branches = sorted.map((d) => d.branch);
  const urgente = sorted.map((d) => d.urgente);
  const revisar = sorted.map((d) => d.revisar);
  const operativa = sorted.map((d) => d.operativa);

  return {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: p.bg2,
      borderColor: p.ln,
      textStyle: { color: p.text, fontSize: 11 },
      padding: [8, 12],
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
      type: "value",
      axisLabel: { color: p.textSub, fontSize: 10 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: p.ln } },
    },
    yAxis: {
      type: "category",
      data: branches,
      inverse: true,
      axisLabel: { color: p.text, fontSize: 10.5, fontWeight: 500 },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        name: "Urgente",
        type: "bar",
        stack: "total",
        data: urgente,
        itemStyle: { color: p.R, borderRadius: [3, 0, 0, 3] },
        emphasis: { focus: "series" },
        cursor: "pointer",
      },
      {
        name: "Revisar",
        type: "bar",
        stack: "total",
        data: revisar,
        itemStyle: { color: p.A },
        emphasis: { focus: "series" },
        cursor: "pointer",
      },
      {
        name: "Operativa",
        type: "bar",
        stack: "total",
        data: operativa,
        itemStyle: { color: p.G, borderRadius: [0, 3, 3, 0] },
        emphasis: { focus: "series" },
        cursor: "pointer",
      },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════
//  CATEGORÍAS BAR (grouped by risk level)
// ═══════════════════════════════════════════════════════════════════

export type CategoryStat = {
  cat: string;
  urgente: number;
  revisar: number;
  completar: number;
};

export function renderCategoriesBar(container: HTMLElement, data: CategoryStat[]): echarts.ECharts {
  const existing = echarts.getInstanceByDom(container);
  if (existing) existing.dispose();

  const chart = echarts.init(container, null, { renderer: "canvas" });
  chart.setOption(buildCategoriesOption(data));

  const off = onThemeChange(() => chart.setOption(buildCategoriesOption(data)));
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

function buildCategoriesOption(data: CategoryStat[]): echarts.EChartsCoreOption {
  const p = getTremorPalette();
  const cats = data.map((d) => d.cat);
  const urgente = data.map((d) => d.urgente);
  const revisar = data.map((d) => d.revisar);
  const completar = data.map((d) => d.completar);

  return {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: p.bg2,
      borderColor: p.ln,
      textStyle: { color: p.text, fontSize: 11 },
      padding: [8, 12],
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
      data: cats,
      axisLabel: { color: p.text, fontSize: 10, fontWeight: 500, interval: 0 },
      axisLine: { lineStyle: { color: p.ln } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: p.textSub, fontSize: 10 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: p.ln } },
    },
    series: [
      {
        name: "Urgente",
        type: "bar",
        data: urgente,
        itemStyle: { color: p.R, borderRadius: [3, 3, 0, 0] },
        emphasis: { focus: "series" },
      },
      {
        name: "Revisar",
        type: "bar",
        data: revisar,
        itemStyle: { color: p.A, borderRadius: [3, 3, 0, 0] },
        emphasis: { focus: "series" },
      },
      {
        name: "Completar",
        type: "bar",
        data: completar,
        itemStyle: { color: p.B, borderRadius: [3, 3, 0, 0] },
        emphasis: { focus: "series" },
      },
    ],
  };
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
    tooltip: {
      trigger: "item",
      backgroundColor: p.bg2,
      borderColor: p.ln,
      textStyle: { color: p.text, fontSize: 11 },
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
          borderRadius: 3,
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
    tooltip: {
      trigger: "axis",
      backgroundColor: p.bg2,
      borderColor: p.ln,
      textStyle: { color: p.text, fontSize: 11 },
      padding: [8, 12],
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
      axisLabel: { color: p.textSub, fontSize: 10, formatter: "{value}%" },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: p.ln } },
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
//  TALLER CALENDAR HEATMAP — ingresos por día
// ═══════════════════════════════════════════════════════════════════

export type DayCount = {
  /** YYYY-MM-DD */
  date: string;
  count: number;
};

export function renderTallerHeatmap(container: HTMLElement, data: DayCount[]): echarts.ECharts {
  const existing = echarts.getInstanceByDom(container);
  if (existing) existing.dispose();

  const chart = echarts.init(container, null, { renderer: "canvas" });
  chart.setOption(buildHeatmapOption(data));

  const off = onThemeChange(() => chart.setOption(buildHeatmapOption(data)));
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

function buildHeatmapOption(data: DayCount[]): echarts.EChartsCoreOption {
  const p = getTremorPalette();
  const values = data.map((d) => [d.date, d.count] as [string, number]);
  const maxCount = values.reduce((m, v) => Math.max(m, v[1]), 0);

  // Rango = 90 días hasta hoy (trimestre rolling).
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 89);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  return {
    tooltip: {
      backgroundColor: p.bg2,
      borderColor: p.ln,
      textStyle: { color: p.text, fontSize: 11 },
      padding: [8, 12],
      formatter: (params: unknown) => {
        const pp = params as { value: [string, number] };
        const d = pp.value[0];
        const c = pp.value[1];
        return `${d}<br/><b>${c}</b> ingreso${c === 1 ? "" : "s"}`;
      },
    },
    visualMap: {
      min: 0,
      max: Math.max(maxCount, 1),
      calculable: false,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemWidth: 10,
      itemHeight: 80,
      textStyle: { color: p.textSub, fontSize: 9 },
      inRange: {
        color: [p.bg3, p.A, p.R],
      },
    },
    calendar: {
      range: [fmt(start), fmt(today)],
      cellSize: ["auto", 14],
      top: 10,
      left: 26,
      right: 10,
      bottom: 40,
      orient: "horizontal",
      splitLine: { show: false },
      itemStyle: {
        color: p.bg3,
        borderColor: p.bg,
        borderWidth: 2,
      },
      yearLabel: { show: false },
      monthLabel: { color: p.textSub, fontSize: 9 },
      dayLabel: { color: p.textSub, fontSize: 9, nameMap: "es" },
    },
    series: [
      {
        type: "heatmap",
        coordinateSystem: "calendar",
        data: values,
      },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════
//  KM vs SERVICIO SCATTER — Traccar-style predictive visual
// ═══════════════════════════════════════════════════════════════════

export type KmScatterPoint = {
  /** Kilometraje actual de la unidad. */
  km: number;
  /** Kilometraje del siguiente servicio programado. */
  kmNext: number;
  /** Identificador legible (ECO o placa). */
  label: string;
  /** Nivel de riesgo actual — dicta color del punto. */
  risk: "Urgente" | "Revisar" | "Completar" | "OK";
};

export function renderKmScatter(container: HTMLElement, data: KmScatterPoint[]): echarts.ECharts {
  const existing = echarts.getInstanceByDom(container);
  if (existing) existing.dispose();

  const chart = echarts.init(container, null, { renderer: "canvas" });
  chart.setOption(buildKmScatterOption(data));

  const off = onThemeChange(() => chart.setOption(buildKmScatterOption(data)));
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

function buildKmScatterOption(data: KmScatterPoint[]): echarts.EChartsCoreOption {
  const p = getTremorPalette();
  const byRisk = {
    Urgente: { color: p.R, points: [] as [number, number, string][] },
    Revisar: { color: p.A, points: [] as [number, number, string][] },
    Completar: { color: p.B, points: [] as [number, number, string][] },
    OK: { color: p.G, points: [] as [number, number, string][] },
  };
  for (const d of data) {
    byRisk[d.risk].points.push([d.km, d.kmNext, d.label]);
  }

  const maxKm = data.reduce((m, d) => Math.max(m, d.km, d.kmNext), 0);
  const axisMax = maxKm > 0 ? Math.ceil((maxKm * 1.1) / 1000) * 1000 : 100000;

  return {
    tooltip: {
      trigger: "item",
      backgroundColor: p.bg2,
      borderColor: p.ln,
      textStyle: { color: p.text, fontSize: 11 },
      padding: [8, 12],
      formatter: (params: unknown) => {
        const pp = params as { seriesName: string; value: [number, number, string] };
        const [km, kmNext, label] = pp.value;
        const diff = kmNext - km;
        const diffStr =
          diff <= 0
            ? `<span style="color:${p.R}"><b>VENCIDO</b> ${Math.abs(diff).toLocaleString("es-MX")}km</span>`
            : `<span style="color:${p.G}">${diff.toLocaleString("es-MX")}km restantes</span>`;
        return `<b>${label}</b><br/>${pp.seriesName}<br/>Actual: ${km.toLocaleString("es-MX")}km<br/>Siguiente: ${kmNext.toLocaleString("es-MX")}km<br/>${diffStr}`;
      },
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
    grid: { left: 8, right: 12, top: 26, bottom: 24, containLabel: true },
    xAxis: {
      type: "value",
      name: "Km actual",
      nameLocation: "middle",
      nameGap: 28,
      nameTextStyle: { color: p.textSub, fontSize: 10, fontWeight: 600 },
      min: 0,
      max: axisMax,
      axisLabel: {
        color: p.textSub,
        fontSize: 10,
        formatter: (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)),
      },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: p.ln } },
    },
    yAxis: {
      type: "value",
      name: "Km siguiente servicio",
      nameLocation: "middle",
      nameGap: 46,
      nameTextStyle: { color: p.textSub, fontSize: 10, fontWeight: 600 },
      min: 0,
      max: axisMax,
      axisLabel: {
        color: p.textSub,
        fontSize: 10,
        formatter: (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)),
      },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: p.ln } },
    },
    series: (Object.keys(byRisk) as Array<keyof typeof byRisk>).map((risk, idx) => {
      const s = byRisk[risk];
      const base: Record<string, unknown> = {
        name: risk,
        type: "scatter",
        data: s.points,
        itemStyle: { color: s.color, opacity: 0.85 },
        symbolSize: 9,
        emphasis: { itemStyle: { opacity: 1, borderColor: p.bg, borderWidth: 2 } },
      };
      if (idx === 0) {
        // MarkLine diagonal y=x — linea de "servicio vigente".
        // Puntos DEBAJO = km_actual > km_siguiente = VENCIDO.
        base.markLine = {
          symbol: "none",
          silent: true,
          animation: false,
          lineStyle: { color: p.textSub, type: "dashed", width: 1.2, opacity: 0.6 },
          label: {
            color: p.textSub,
            fontSize: 9,
            position: "end",
            formatter: "Servicio vigente",
          },
          data: [[{ coord: [0, 0] }, { coord: [axisMax, axisMax] }]],
        };
      }
      return base;
    }),
  };
}
