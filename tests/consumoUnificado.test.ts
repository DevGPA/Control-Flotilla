import { describe, expect, it } from "vitest";
import {
  modoDesglose,
  codigoSucursal,
  mesCorto,
  buildComparativoOption,
  buildDetalleOption,
} from "../src/fuel/consumoUnificado";
import { aggByGroupAndMonth } from "../src/fuel/fuelAggregates";
import type { TremorPalette } from "../src/dashboard/chartTheme";
import type { FuelEntry } from "../src/fuel/types";

const P = {
  mode: "light",
  bg: "#fff",
  bg2: "#eee",
  bg3: "#ddd",
  ln: "#ccc",
  text: "#000",
  textSub: "#666",
  R: "#e11d48",
  A: "#b45309",
  G: "#047857",
  B: "#1d4ed8",
  O: "#ea580c",
  ac: "#1e4fa3",
  ac2: "#15397a",
  mes1: "#047857",
  mes2: "#1e4fa3",
  mes3: "#b45309",
} as TremorPalette;

const carga = (suc: string, fecha: string, monto: number): FuelEntry =>
  ({
    tipo: "carga",
    eco: "1",
    loadId: fecha + suc,
    fecha,
    litros: monto / 24,
    monto,
    sucursal: suc,
  }) as FuelEntry;

const MATRIZ = aggByGroupAndMonth(
  [
    carga("Guadalajara", "2026-05-01", 100),
    carga("Guadalajara", "2026-06-01", 200),
    carga("Monterrey", "2026-05-15", 900),
    carga("Monterrey", "2026-07-01", 100),
  ],
  (e) => e.sucursal ?? "",
);

describe("modoDesglose", () => {
  it("1→oculto, 2-3→agrupadas, 4+→apiladas", () => {
    expect(modoDesglose(1)).toBe("oculto");
    expect(modoDesglose(3)).toBe("agrupadas");
    expect(modoDesglose(4)).toBe("apiladas");
  });
});

describe("codigoSucursal / mesCorto", () => {
  it("códigos cortos estables", () => {
    expect(codigoSucursal("Ciudad de México")).toBe("CDMX");
    expect(codigoSucursal("Guadalajara")).toBe("GDL");
    expect(mesCorto("2026-05")).toBe("may 26");
  });
});

describe("buildComparativoOption", () => {
  it("por mes: una serie bar por mes con la paleta mensual en orden fijo", () => {
    const opt = buildComparativoOption(P, MATRIZ, { porMes: true, metrica: "gasto" }) as {
      series: { name: string; type: string; stack?: string }[];
      xAxis: { data: string[] };
    };
    expect(opt.series).toHaveLength(3);
    expect(opt.series.every((s) => s.type === "bar" && !s.stack)).toBe(true);
    expect(opt.xAxis.data[0]).toBe("MTY"); // grupos por gasto DESC → códigos
  });
  it("total: una sola serie con etiqueta visible", () => {
    const opt = buildComparativoOption(P, MATRIZ, { porMes: false, metrica: "litros" }) as {
      series: { data: number[]; label: { show: boolean } }[];
    };
    expect(opt.series).toHaveLength(1);
    expect(opt.series[0]!.label.show).toBe(true);
  });
  it("tooltip: usa seriesIndex (no la posición en `ps`) para mapear cada línea a su mes — sobrevive des-seleccionar un mes en la leyenda", () => {
    // 3 meses (ene/feb/mar 26), 1 sola sucursal, montos distintos y fáciles de
    // distinguir por mes para detectar si el formatter lee el mes equivocado.
    const m3 = aggByGroupAndMonth(
      [
        carga("Guadalajara", "2026-01-10", 2400), // litros 100
        carga("Guadalajara", "2026-02-10", 4800), // litros 200
        carga("Guadalajara", "2026-03-10", 7200), // litros 300
      ],
      (e) => e.sucursal ?? "",
    );
    expect(m3.meses).toEqual(["2026-01", "2026-02", "2026-03"]);
    const opt = buildComparativoOption(P, m3, { porMes: true, metrica: "gasto" }) as {
      tooltip: { formatter: (ps: unknown) => string };
    };
    // Simula que ECharts des-seleccionó "feb 26" (seriesIndex 1) en la leyenda:
    // el arreglo de params llega COMPACTADO (2 elementos, no 3) pero cada param
    // trae su seriesIndex real y estable (0 y 2), no contiguo.
    const psSinFebrero = [
      { dataIndex: 0, seriesName: "ene 26", marker: "<m0>", seriesIndex: 0 },
      { dataIndex: 0, seriesName: "mar 26", marker: "<m2>", seriesIndex: 2 },
    ];
    const html = opt.tooltip.formatter(psSinFebrero);
    // Fila de "ene 26" debe traer las cifras de enero ($2,400 · 100 L).
    expect(html).toContain("ene 26&nbsp;&nbsp;$2,400 · 100 L · 1 cargas");
    // Fila de "mar 26" debe traer las cifras de MARZO ($7,200 · 300 L), no las
    // de febrero ($4,800 · 200 L) que el código posicional (bug) mostraría al
    // indexar `m.meses[1]` en vez de `m.meses[a.seriesIndex]` (=2).
    expect(html).toContain("mar 26&nbsp;&nbsp;$7,200 · 300 L · 1 cargas");
    expect(html).not.toContain("$4,800 · 200 L");
  });

  it("4+ meses → apiladas (stack)", () => {
    const m4 = aggByGroupAndMonth(
      ["2026-01", "2026-02", "2026-03", "2026-04"].map((mm, i) =>
        carga("GDL", `${mm}-10`, 100 + i),
      ),
      (e) => e.sucursal ?? "",
    );
    const opt = buildComparativoOption(P, m4, { porMes: true, metrica: "gasto" }) as {
      series: { stack?: string }[];
    };
    expect(opt.series.every((s) => s.stack === "meses")).toBe(true);
  });
});

describe("buildDetalleOption", () => {
  it("detalle de sucursal: barras de litros + línea de gasto en eje secundario", () => {
    const opt = buildDetalleOption(P, MATRIZ, "Guadalajara") as {
      series: { name: string; type: string; yAxisIndex?: number }[];
      yAxis: unknown[];
    };
    expect(opt.yAxis).toHaveLength(2);
    expect(opt.series[0]).toMatchObject({ name: "Litros", type: "bar" });
    expect(opt.series[1]).toMatchObject({ name: "Gasto", type: "line", yAxisIndex: 1 });
  });
  it("grupo null = evolución global (suma de todas)", () => {
    const opt = buildDetalleOption(P, MATRIZ, null) as { series: { data: number[] }[] };
    expect(opt.series[1]!.data).toEqual([1000, 200, 100]); // gasto por mes global
  });
});
