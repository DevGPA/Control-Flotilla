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
