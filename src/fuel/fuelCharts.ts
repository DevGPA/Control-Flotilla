/**
 * Charts del dashboard ejecutivo de combustible (ECharts + paleta Tremor del tema).
 * Mismo patrón que src/dashboard/charts.ts. Se importa dinámicamente (echarts es
 * pesado) solo cuando se abre el dashboard, para no inflar el bundle inicial.
 */
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { TooltipComponent, GridComponent, LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { getTremorPalette, onThemeChange, type TremorPalette } from "../dashboard/chartTheme";
import type { UnitRank, GroupConsumo, MonthConsumo } from "./fuelAggregates";

echarts.use([
  BarChart,
  LineChart,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  CanvasRenderer,
]);

const NUM = new Intl.NumberFormat("es-MX");
const PESO = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

/** Crea/recrea un chart en `container` con la opción dada; resync en theme toggle. */
function makeChart(
  container: HTMLElement,
  build: (p: TremorPalette) => echarts.EChartsCoreOption,
): void {
  const existing = echarts.getInstanceByDom(container);
  if (existing) existing.dispose();
  const chart = echarts.init(container, null, { renderer: "canvas" });
  chart.setOption(build(getTremorPalette()));
  const off = onThemeChange(() => chart.setOption(build(getTremorPalette())));
  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(container);
  const origDispose = chart.dispose.bind(chart);
  chart.dispose = () => {
    off();
    ro.disconnect();
    origDispose();
  };
}

const axisCommon = (p: TremorPalette) => ({
  axisLine: { lineStyle: { color: p.ln } },
  axisLabel: { color: p.textSub, fontSize: 10 },
  splitLine: { lineStyle: { color: p.ln, opacity: 0.4 } },
});

const pct1 = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}%`;

/**
 * Barra horizontal de ranking (los peores arriba si color=R). Si los items traen
 * `desviacion` (ranking vs su tipo), la barra mide la magnitud de la desviación % y la
 * etiqueta la muestra con signo; el km/l absoluto y el baseline del tipo van en el tooltip.
 * Si no, muestra el km/l directo (modo histórico).
 */
function hbar(
  container: HTMLElement,
  items: UnitRank[],
  color: (p: TremorPalette) => string,
): void {
  const esDesv = items.some((d) => typeof d.desviacion === "number");
  makeChart(container, (p) => {
    const data = [...items].reverse(); // ECharts pinta de abajo→arriba
    return {
      grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: p.bg2,
        borderColor: p.ln,
        textStyle: { color: p.text },
        formatter: (ps: unknown) => {
          const a = (ps as { name: string; value: number }[])[0]!;
          const item = data.find((d) => d.eco === a.name);
          const n = item ? item.n : 0;
          const cargas = `<span style="opacity:.7">${n} carga${n === 1 ? "" : "s"} en el período</span>`;
          if (esDesv && item) {
            const dv = (item.desviacion ?? 0) * 100;
            const base = item.tipoMean ? `${item.tipoMean.toFixed(2)} km/l` : "—";
            return `Unidad ${a.name}<br/><b>${pct1(dv)} vs ${item.tipo ?? "su tipo"}</b><br/>${item.kmpl.toFixed(2)} km/l · tipo ${base}<br/>${cargas}`;
          }
          return `Unidad ${a.name}<br/><b>${a.value.toFixed(2)} km/l</b><br/>${cargas}`;
        },
      },
      xAxis: {
        type: "value",
        ...axisCommon(p),
        axisLabel: { color: p.textSub, fontSize: 10, formatter: esDesv ? "{value}%" : "{value}" },
      },
      yAxis: { type: "category", data: data.map((d) => d.eco), ...axisCommon(p) },
      series: [
        {
          type: "bar",
          data: data.map((d) =>
            esDesv
              ? Math.round(Math.abs((d.desviacion ?? 0) * 100) * 10) / 10
              : Math.round(d.kmpl * 100) / 100,
          ),
          itemStyle: { color: color(p), borderRadius: [0, 4, 4, 0] },
          label: {
            show: true,
            position: "right",
            color: p.textSub,
            fontSize: 10,
            formatter: esDesv
              ? (pt: { dataIndex: number }) => pct1((data[pt.dataIndex]!.desviacion ?? 0) * 100)
              : "{c}",
          },
          barMaxWidth: 18,
        },
      ],
    };
  });
}

/** Barra vertical de consumo por grupo (gasto $). */
function consumoBar(container: HTMLElement, groups: GroupConsumo[], p0: TremorPalette): void {
  void p0;
  makeChart(container, (p) => ({
    grid: { left: 8, right: 8, top: 12, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: p.bg2,
      borderColor: p.ln,
      textStyle: { color: p.text },
      formatter: (ps: unknown) => {
        const a = (ps as { name: string; dataIndex: number }[])[0]!;
        const g = groups[a.dataIndex]!;
        return `<b>${g.group}</b><br/>${PESO.format(g.gasto)}<br/>${NUM.format(Math.round(g.litros))} L · ${g.cargas} cargas`;
      },
    },
    xAxis: {
      type: "category",
      data: groups.map((g) => g.group),
      ...axisCommon(p),
      axisLabel: { color: p.textSub, fontSize: 9, interval: 0, rotate: groups.length > 5 ? 28 : 0 },
    },
    yAxis: { type: "value", ...axisCommon(p) },
    series: [
      {
        type: "bar",
        data: groups.map((g) => Math.round(g.gasto)),
        itemStyle: { color: p.ac, borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 40,
      },
    ],
  }));
}

/** Línea de tendencia mensual: litros + gasto (doble eje). */
function tendencia(container: HTMLElement, meses: MonthConsumo[]): void {
  makeChart(container, (p) => ({
    grid: { left: 8, right: 8, top: 30, bottom: 8, containLabel: true },
    legend: { data: ["Litros", "Gasto"], textStyle: { color: p.textSub, fontSize: 10 }, top: 0 },
    tooltip: {
      trigger: "axis",
      backgroundColor: p.bg2,
      borderColor: p.ln,
      textStyle: { color: p.text },
      formatter: (ps: unknown) => {
        const arr = ps as { axisValue: string; seriesName: string; value: number }[];
        if (!arr.length) return "";
        const lines = arr.map((a) =>
          a.seriesName === "Gasto"
            ? `Gasto: <b>${PESO.format(a.value)}</b>`
            : `Litros: <b>${NUM.format(a.value)} L</b>`,
        );
        return `${arr[0]!.axisValue}<br/>${lines.join("<br/>")}`;
      },
    },
    xAxis: { type: "category", data: meses.map((m) => m.mes), ...axisCommon(p) },
    yAxis: [
      { type: "value", name: "L", ...axisCommon(p) },
      { type: "value", name: "$", ...axisCommon(p), splitLine: { show: false } },
    ],
    series: [
      {
        name: "Litros",
        type: "bar",
        data: meses.map((m) => Math.round(m.litros)),
        itemStyle: { color: p.B, borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 30,
      },
      {
        name: "Gasto",
        type: "line",
        yAxisIndex: 1,
        data: meses.map((m) => Math.round(m.gasto)),
        smooth: true,
        itemStyle: { color: p.ac },
        lineStyle: { color: p.ac, width: 2 },
      },
    ],
  }));
}

export type FuelDashboardData = {
  peores: UnitRank[];
  mejores: UnitRank[];
  porSucursal: GroupConsumo[];
  porResponsable: GroupConsumo[];
  porTipo: GroupConsumo[];
  meses: MonthConsumo[];
};

export type FuelDashboardEls = {
  peores: HTMLElement | null;
  mejores: HTMLElement | null;
  sucursal: HTMLElement | null;
  responsable: HTMLElement | null;
  tipo: HTMLElement | null;
  tendencia: HTMLElement | null;
};

/** Renderiza todos los charts del dashboard en sus contenedores. */
export function renderFuelDashboard(els: FuelDashboardEls, data: FuelDashboardData): void {
  const p = getTremorPalette();
  if (els.peores) hbar(els.peores, data.peores, (pp) => pp.R);
  if (els.mejores) hbar(els.mejores, data.mejores, (pp) => pp.G);
  if (els.sucursal) consumoBar(els.sucursal, data.porSucursal, p);
  if (els.responsable) consumoBar(els.responsable, data.porResponsable, p);
  if (els.tipo) consumoBar(els.tipo, data.porTipo, p);
  if (els.tendencia) tendencia(els.tendencia, data.meses);
}
