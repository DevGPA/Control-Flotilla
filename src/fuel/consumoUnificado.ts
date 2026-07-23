/**
 * Gráfica unificada de consumo (spec Producto Vivo 2026-07-23): comparativo por
 * sucursal ⇄ detalle mensual (drill-down) ⇄ evolución global. Esta mitad del
 * módulo es PURA (option-builders testeables); el estado/DOM va en mountConsumo
 * (misma file, Task 6).
 */
import type { TremorPalette } from "../dashboard/chartTheme";
import { ejesVivo, tooltipVivo, gradBar, rampaSecuencial, animVivo } from "../dashboard/chartVivo";
import type { ConsumoPorGrupoMes, CeldaConsumo } from "./fuelAggregates";

const NUM = new Intl.NumberFormat("es-MX");
const PESO = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

export type ModoDesglose = "oculto" | "agrupadas" | "apiladas";
export type MetricaConsumo = "gasto" | "litros";

/** 1 mes → sin desglose · 2-3 → agrupadas (paleta categórica de 3) · 4+ → apiladas. */
export function modoDesglose(nMeses: number): ModoDesglose {
  if (nMeses <= 1) return "oculto";
  return nMeses <= 3 ? "agrupadas" : "apiladas";
}

const CODIGOS: Record<string, string> = {
  "ciudad de mexico": "CDMX",
  "ciudad de méxico": "CDMX",
  guadalajara: "GDL",
  monterrey: "MTY",
  cancun: "CUN",
  cancún: "CUN",
  cabos: "CSL",
  vallarta: "PVR",
  cedis: "CEDIS",
};
export function codigoSucursal(nombre: string): string {
  const k = nombre.trim().toLowerCase();
  return CODIGOS[k] ?? nombre.trim().slice(0, 4).toUpperCase();
}

const MES_NOMBRE = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];
export function mesCorto(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  return `${MES_NOMBRE[Number(m) - 1] ?? yyyymm} ${String(y).slice(2)}`;
}

const fmtK = (metrica: MetricaConsumo, v: number): string =>
  metrica === "gasto" ? `$${Math.round(v / 1000)}k` : `${NUM.format(Math.round(v / 1000))}k L`;
const celdaTxt = (c: CeldaConsumo): string =>
  `${PESO.format(Math.round(c.gasto))} · ${NUM.format(Math.round(c.litros))} L · ${c.cargas} cargas`;

/** Nivel 1 — comparativo por sucursal (Total | Por mes). */
export function buildComparativoOption(
  p: TremorPalette,
  m: ConsumoPorGrupoMes,
  o: { porMes: boolean; metrica: MetricaConsumo },
): Record<string, unknown> {
  const modo = modoDesglose(m.meses.length);
  const porMes = o.porMes && modo !== "oculto";
  const val = (c: CeldaConsumo) =>
    o.metrica === "gasto" ? Math.round(c.gasto) : Math.round(c.litros);
  const colores =
    modo === "apiladas" ? rampaSecuencial(p.ac, m.meses.length) : [p.mes1, p.mes2, p.mes3];
  const series = porMes
    ? m.meses.map((mes, i) => ({
        name: mesCorto(mes),
        type: "bar",
        ...(modo === "apiladas" ? { stack: "meses" } : {}),
        barMaxWidth: modo === "apiladas" ? 26 : 13,
        barGap: "25%",
        itemStyle: {
          color: gradBar(colores[i]!),
          borderRadius: modo === "apiladas" && i < m.meses.length - 1 ? [0, 0, 0, 0] : [5, 5, 0, 0],
          borderColor: p.bg,
          borderWidth: 1,
        },
        data: m.grupos.map((g) => val(m.celdas[g]![mes]!)),
        label: { show: false },
      }))
    : [
        {
          name: "Total",
          type: "bar",
          barMaxWidth: 26,
          itemStyle: { color: gradBar(p.ac), borderRadius: [5, 5, 0, 0] },
          label: {
            show: true,
            position: "top",
            color: p.textSub,
            fontSize: 10,
            formatter: (pt: { value: number }) => fmtK(o.metrica, pt.value),
          },
          data: m.grupos.map((g) => val(m.totalesGrupo[g]!)),
        },
      ];
  return {
    ...animVivo(),
    grid: { left: 6, right: 6, top: porMes ? 30 : 26, bottom: 4, containLabel: true },
    legend: porMes
      ? {
          top: 0,
          left: 0,
          itemWidth: 10,
          itemHeight: 10,
          icon: "roundRect",
          itemGap: 14,
          textStyle: { color: p.textSub, fontSize: 11 },
        }
      : { show: false },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: p.bg3, opacity: 0.5 } },
      ...tooltipVivo(p),
      formatter: (ps: unknown) => {
        const arr = ps as { dataIndex: number; seriesName: string; marker: string }[];
        const g = m.grupos[arr[0]!.dataIndex]!;
        if (!porMes)
          return `<b>${g}</b><br/>${celdaTxt(m.totalesGrupo[g]!)}<br/><span style="opacity:.6">Click para ver detalle mensual</span>`;
        const lineas = arr.map(
          (a, i) =>
            `${a.marker} ${a.seriesName}&nbsp;&nbsp;${celdaTxt(m.celdas[g]![m.meses[i]!]!)}`,
        );
        return `<b>${g}</b><br/>${lineas.join("<br/>")}<br/><span style="opacity:.6">Click para ver detalle mensual</span>`;
      },
    },
    xAxis: {
      type: "category",
      data: m.grupos.map(codigoSucursal),
      ...ejesVivo(p),
      axisLabel: { color: p.textSub, fontSize: 10.5, interval: 0 },
    },
    yAxis: {
      type: "value",
      ...ejesVivo(p),
      axisLabel: { color: p.textSub, fontSize: 10.5, formatter: (v: number) => fmtK(o.metrica, v) },
    },
    series,
  };
}

/** Nivel 2 — detalle mensual (grupo, o null = todas): barras litros + línea gasto (formato actual de la app, decisión del usuario). */
export function buildDetalleOption(
  p: TremorPalette,
  m: ConsumoPorGrupoMes,
  grupo: string | null,
): Record<string, unknown> {
  const celda = (mes: string): CeldaConsumo =>
    grupo ? m.celdas[grupo]![mes]! : (m.totalesMes[mes] ?? { litros: 0, gasto: 0, cargas: 0 });
  const nombre = grupo ?? "Todas las sucursales";
  return {
    ...animVivo(),
    grid: { left: 6, right: 6, top: 30, bottom: 4, containLabel: true },
    legend: {
      top: 0,
      left: 0,
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 14,
      textStyle: { color: p.textSub, fontSize: 11 },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: p.bg3, opacity: 0.5 } },
      ...tooltipVivo(p),
      formatter: (ps: unknown) => {
        const i = (ps as { dataIndex: number }[])[0]!.dataIndex;
        return `<b>${nombre} · ${mesCorto(m.meses[i]!)}</b><br/>${celdaTxt(celda(m.meses[i]!))}`;
      },
    },
    xAxis: { type: "category", data: m.meses.map(mesCorto), ...ejesVivo(p) },
    yAxis: [
      {
        type: "value",
        ...ejesVivo(p),
        axisLabel: {
          color: p.textSub,
          fontSize: 10.5,
          formatter: (v: number) => `${NUM.format(Math.round(v / 1000))}k L`,
        },
      },
      {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          color: p.textSub,
          fontSize: 10.5,
          formatter: (v: number) => `$${Math.round(v / 1000)}k`,
        },
      },
    ],
    series: [
      {
        name: "Litros",
        type: "bar",
        barMaxWidth: 44,
        itemStyle: { color: gradBar(p.ac), borderRadius: [5, 5, 0, 0] },
        data: m.meses.map((mes) => Math.round(celda(mes).litros)),
      },
      {
        name: "Gasto",
        type: "line",
        yAxisIndex: 1,
        smooth: true,
        symbol: "circle",
        symbolSize: 8,
        lineStyle: { width: 2.5, color: p.mes3 },
        itemStyle: { color: p.mes3, borderColor: p.bg, borderWidth: 2 },
        label: {
          show: true,
          position: "top",
          color: p.textSub,
          fontSize: 10.5,
          formatter: (pt: { value: number }) => `$${Math.round(pt.value / 1000)}k`,
        },
        data: m.meses.map((mes) => Math.round(celda(mes).gasto)),
      },
    ],
  };
}
