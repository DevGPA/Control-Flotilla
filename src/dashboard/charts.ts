// Dashboard charts — ECharts vanilla wrappers. Usa paleta Tremor (main.css CSS vars)
// y se resyncra cuando data-theme="dark" cambia.
//
// Patrón: cada render* acepta container + data + callbacks; retorna la instancia
// ECharts para permitir .resize() o .dispose() desde el caller.

import * as echarts from "echarts/core";
import { PieChart } from "echarts/charts";
import { TooltipComponent, LegendComponent, TitleComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { getTremorPalette, onThemeChange } from "./chartTheme";

echarts.use([PieChart, TooltipComponent, LegendComponent, TitleComponent, CanvasRenderer]);

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
  const dominant = visible.reduce((a, b) => (b.value > a.value ? b : a), visible[0] || null);
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
