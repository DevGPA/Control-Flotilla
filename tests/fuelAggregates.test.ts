import { describe, expect, it } from "vitest";
import {
  rankUnitsByKmpl,
  splitRanking,
  aggByGroup,
  aggByMonth,
  type UnitRank,
} from "../src/fuel/fuelAggregates";
import type { FuelEntry, FleetBaseline } from "../src/fuel/types";

const rk = (eco: string, kmpl: number): UnitRank => ({ eco, kmpl, n: 5 });

describe("splitRanking (mejores/peores disjuntos)", () => {
  it("NO solapa cuando hay <20 unidades (el bug reportado)", () => {
    // 14 unidades DESC → antes slice(0,10) y slice(-10) compartían 6.
    const ranks = Array.from({ length: 14 }, (_, i) => rk(`u${i}`, 14 - i));
    const { mejores, peores } = splitRanking(ranks, 10);
    expect(mejores).toHaveLength(7); // k = floor(14/2)
    expect(peores).toHaveLength(7);
    const m = new Set(mejores.map((x) => x.eco));
    expect(peores.filter((p) => m.has(p.eco))).toHaveLength(0); // disjuntos
    expect(mejores[0]!.kmpl).toBe(14); // mejor primero
    expect(peores[0]!.kmpl).toBe(1); // peor primero
  });
  it("con ≥20 unidades respeta el tope de 10 por lado, disjuntos", () => {
    const ranks = Array.from({ length: 24 }, (_, i) => rk(`u${i}`, 24 - i));
    const { mejores, peores } = splitRanking(ranks, 10);
    expect(mejores).toHaveLength(10);
    expect(peores).toHaveLength(10);
    const m = new Set(mejores.map((x) => x.eco));
    expect(peores.some((p) => m.has(p.eco))).toBe(false);
  });
  it("0/1 unidad → vacío (no se puede rankear)", () => {
    expect(splitRanking([], 10)).toEqual({ mejores: [], peores: [] });
    expect(splitRanking([rk("a", 5)], 10)).toEqual({ mejores: [], peores: [] });
  });
});

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
  it("ordena desc por km/l y respeta minN=4", () => {
    const base: FleetBaseline = {
      porUnidad: new Map([
        ["A", { mean: 8, sd: 1, n: 5 }],
        ["B", { mean: 12, sd: 1, n: 4 }], // n=4 → entra (IQR ya recorta)
        ["C", { mean: 20, sd: 0, n: 1 }], // n<4 → excluido
      ]),
      porTipo: new Map(),
      flotaMean: 10,
    };
    const r = rankUnitsByKmpl(base);
    expect(r.map((x) => x.eco)).toEqual(["B", "A"]);
  });

  it("excluye unidades con 3 lecturas (n<4 entra al ranking sin recorte IQR)", () => {
    const base: FleetBaseline = {
      porUnidad: new Map([
        ["A", { mean: 8, sd: 1, n: 4 }], // entra
        ["B", { mean: 30, sd: 9, n: 3 }], // excluida pese a km/l alto: muestra sin IQR
      ]),
      porTipo: new Map(),
      flotaMean: 10,
    };
    expect(rankUnitsByKmpl(base).map((x) => x.eco)).toEqual(["A"]);
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
