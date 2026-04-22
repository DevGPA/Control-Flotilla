// Dashboard charts — ECharts vanilla wrappers. Usa paleta Tremor (main.css CSS vars)
// y se resyncra cuando data-theme="dark" cambia.
//
// Patrón: cada render* acepta container + data + callbacks; retorna la instancia
// ECharts para permitir .resize() o .dispose() desde el caller.

import * as echarts from "echarts/core";
import { PieChart } from "echarts/charts";
import { TooltipComponent, LegendComponent, TitleComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { getTremorPalette, onThemeChange, type ThemeMode } from "./chartTheme";

echarts.use([PieChart, TooltipComponent, LegendComponent, TitleComponent, CanvasRenderer]);

export type RiskCounts = {
  urgente: number;
  revisar: number;
  completar: number;
  ok: number;
};

type RiskKey = "urgente" | "revisar" | "completar" | "ok";
type DonutHandlers = {
  onSegmentClick?: (key: RiskKey) => void;
};

/**
 * Donut de composición de riesgo — 4 segmentos exclusivos que suman a total.
 * Reemplaza el SVG custom de `#dsvg` con ECharts interactivo:
 * tooltip con %, click-to-filter via onSegmentClick, dark-mode auto.
 */
export function renderDonut(
  container: HTMLElement,
  data: RiskCounts,
  handlers: DonutHandlers = {},
): echarts.ECharts {
  // Evita múltiples instancias sobre el mismo contenedor (caller debería disposear,
  // pero defensa por si buildKPIs corre varias veces sin cleanup).
  const existing = echarts.getInstanceByDom(container);
  if (existing) existing.dispose();

  const chart = echarts.init(container, null, { renderer: "canvas" });
  chart.setOption(buildDonutOption(data, getTremorPalette().mode));

  chart.on("click", "series", (params) => {
    if (!handlers.onSegmentClick) return;
    const name = (params.data as { key?: RiskKey }).key;
    if (name) handlers.onSegmentClick(name);
  });

  // Re-sync colores en theme toggle — usa CSS vars frescas del :root dark.
  const off = onThemeChange((mode) => {
    chart.setOption(buildDonutOption(data, mode));
  });

  // Resize responsive
  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(container);

  // Cleanup — ECharts no expone teardown automático, caller debe invocar dispose
  const origDispose = chart.dispose.bind(chart);
  chart.dispose = () => {
    off();
    ro.disconnect();
    origDispose();
  };

  return chart;
}

function buildDonutOption(data: RiskCounts, _mode: ThemeMode): echarts.EChartsCoreOption {
  const p = getTremorPalette();
  const total = data.urgente + data.revisar + data.completar + data.ok;
  return {
    tooltip: {
      trigger: "item",
      backgroundColor: p.bg2,
      borderColor: p.ln,
      textStyle: { color: p.text, fontSize: 12 },
      formatter: (params: unknown) => {
        const pp = params as { name: string; value: number; percent: number };
        return `${pp.name}<br/><b>${pp.value}</b> (${pp.percent.toFixed(0)}%)`;
      },
    },
    legend: {
      bottom: 0,
      textStyle: { color: p.textSub, fontSize: 11 },
      icon: "circle",
    },
    series: [
      {
        name: "Riesgo",
        type: "pie",
        radius: ["62%", "82%"],
        center: ["50%", "44%"],
        avoidLabelOverlap: true,
        label: {
          show: true,
          position: "center",
          formatter: () => {
            const worst =
              data.urgente > 0
                ? { label: "Urgente", value: data.urgente, color: p.R }
                : data.revisar > 0
                  ? { label: "Revisar", value: data.revisar, color: p.A }
                  : data.completar > 0
                    ? { label: "Completar", value: data.completar, color: p.B }
                    : { label: "Operativa", value: data.ok, color: p.G };
            const pct = total ? ((worst.value / total) * 100).toFixed(0) : "0";
            return `{v|${pct}%}\n{l|${worst.label}}`;
          },
          rich: {
            v: { fontSize: 22, fontWeight: 700, color: p.text, lineHeight: 26 },
            l: { fontSize: 11, color: p.textSub, lineHeight: 16 },
          },
        },
        labelLine: { show: false },
        itemStyle: {
          borderColor: p.bg,
          borderWidth: 2,
          borderRadius: 4,
        },
        data: [
          { name: "Urgente", value: data.urgente, itemStyle: { color: p.R }, key: "urgente" },
          { name: "Revisar", value: data.revisar, itemStyle: { color: p.A }, key: "revisar" },
          { name: "Completar", value: data.completar, itemStyle: { color: p.B }, key: "completar" },
          { name: "OK", value: data.ok, itemStyle: { color: p.G }, key: "ok" },
        ].filter((s) => s.value > 0),
      },
    ],
  };
}
