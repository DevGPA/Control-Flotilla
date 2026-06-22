import { describe, expect, it } from "vitest";
import { rankUnitsByKmpl, aggByGroup, aggByMonth } from "../src/fuel/fuelAggregates";
import type { FuelEntry, FleetBaseline } from "../src/fuel/types";

function carga(
  eco: string,
  fecha: string,
  litros: number,
  monto: number,
  over: Partial<FuelEntry> = {},
): FuelEntry {
  return {
    loadId: `${eco}|carga|${fecha}`,
    tipo: "carga",
    eco,
    eventoId: fecha,
    sucursal: over.sucursal ?? "Monterrey",
    fecha,
    litros,
    monto,
    photos: [],
    ...over,
  };
}

describe("rankUnitsByKmpl", () => {
  it("ordena desc por km/l y respeta minN", () => {
    const base: FleetBaseline = {
      porUnidad: new Map([
        ["A", { mean: 8, sd: 1, n: 5 }],
        ["B", { mean: 12, sd: 1, n: 4 }],
        ["C", { mean: 20, sd: 0, n: 1 }], // n<2 → excluido
      ]),
      porTipo: new Map(),
      flotaMean: 10,
    };
    const r = rankUnitsByKmpl(base);
    expect(r.map((x) => x.eco)).toEqual(["B", "A"]);
  });
});

describe("aggByGroup", () => {
  it("suma litros/gasto/cargas por clave, solo cargas, orden desc por gasto", () => {
    const entries = [
      carga("1", "2026-03-01", 40, 1000, { sucursal: "Monterrey" }),
      carga("2", "2026-03-02", 30, 800, { sucursal: "Cabos" }),
      carga("3", "2026-03-03", 50, 1500, { sucursal: "Monterrey" }),
      { ...carga("4", "2026-03-04", 0, 0), tipo: "solicitud" } as FuelEntry,
    ];
    const r = aggByGroup(entries, (e) => e.sucursal);
    expect(r[0]).toEqual({ group: "Monterrey", litros: 90, gasto: 2500, cargas: 2 });
    expect(r[1]).toEqual({ group: "Cabos", litros: 30, gasto: 800, cargas: 1 });
  });
});

describe("aggByMonth", () => {
  it("agrupa por YYYY-MM en orden cronológico", () => {
    const entries = [
      carga("1", "2026-02-15", 40, 1000),
      carga("1", "2026-03-10", 30, 900),
      carga("1", "2026-03-20", 20, 600),
    ];
    const r = aggByMonth(entries);
    expect(r.map((x) => x.mes)).toEqual(["2026-02", "2026-03"]);
    expect(r[1]!.litros).toBe(50);
    expect(r[1]!.gasto).toBe(1500);
  });
});
