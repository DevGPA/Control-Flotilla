import { describe, expect, it } from "vitest";
import { buildFuelEntries } from "../src/fuel/mapEntry";
import { aggByGroup } from "../src/fuel/fuelAggregates";
import { filterAndSortFuel, type FuelTableFilter } from "../src/fuel/renderTableCombustible";
import { AREAS_FLOTILLA, type FuelEntry } from "../src/fuel/types";

const NO_FILTER: FuelTableFilter = {
  tipo: "all",
  verdict: "all",
  sucursal: "",
  responsable: "",
  search: "",
  flag: "",
  area: "",
  submarca: "",
};

function entry(p: Partial<FuelEntry> & { eco: string }): FuelEntry {
  return {
    loadId: `${p.eco}|carga|${p.eventoId ?? "x"}`,
    tipo: "carga",
    eventoId: p.eventoId ?? "x",
    sucursal: "Guadalajara",
    fecha: "2026-07-01",
    photos: [],
    ...p,
  } as FuelEntry;
}

describe("join de área por economicoId", () => {
  it("buildFuelEntries anexa area del catálogo; sin unidad queda undefined", () => {
    const entries = buildFuelEntries(
      [
        { economicoId: "6", tipo: "carga", eventoId: "E1" },
        { economicoId: "99", tipo: "carga", eventoId: "E2" },
      ],
      [],
      new Map([["06", { area: "Logística" }]]),
    );
    const byEco = new Map(entries.map((e) => [e.eco, e.area]));
    expect(byEco.get("6")).toBe("Logística");
    expect(byEco.get("99")).toBeUndefined();
  });

  it("AREAS_FLOTILLA expone las 4 áreas canónicas", () => {
    expect(AREAS_FLOTILLA).toEqual(["Logística", "Almacén", "Postventa", "Administración"]);
  });
});

describe("areaCarga: área solicitante declarada en la carga (datos.areaResponsable)", () => {
  it("buildFuelEntries expone datos.areaResponsable como areaCarga; ausente = undefined", () => {
    const entries = buildFuelEntries(
      [
        {
          economicoId: "10",
          tipo: "carga",
          eventoId: "R1",
          datos: JSON.stringify({ areaResponsable: "MANTENIMIENTO" }),
        },
        { economicoId: "20", tipo: "carga", eventoId: "R2" },
      ],
      [],
      new Map(),
    );
    const byEco = new Map(entries.map((e) => [e.eco, e.areaCarga]));
    expect(byEco.get("10")).toBe("MANTENIMIENTO");
    expect(byEco.get("20")).toBeUndefined();
  });
});

describe("filtro y agregación por área", () => {
  const entries = [
    entry({ eco: "10", eventoId: "A", area: "Logística", litros: 40, monto: 1000 }),
    entry({ eco: "20", eventoId: "B", area: "Postventa", litros: 30, monto: 750 }),
    entry({ eco: "30", eventoId: "C", litros: 20, monto: 500 }), // sin área
  ];

  it("filterAndSortFuel filtra por área exacta y por '(sin área)'", () => {
    expect(
      filterAndSortFuel(entries, { ...NO_FILTER, area: "Logística" }, "_idx", -1).map((e) => e.eco),
    ).toEqual(["10"]);
    expect(
      filterAndSortFuel(entries, { ...NO_FILTER, area: "(sin área)" }, "_idx", -1).map(
        (e) => e.eco,
      ),
    ).toEqual(["30"]);
    expect(filterAndSortFuel(entries, NO_FILTER, "_idx", -1)).toHaveLength(3);
  });

  it("aggByGroup por área agrupa '(sin área)' y ordena por gasto DESC", () => {
    const g = aggByGroup(entries, (e) => e.area ?? "(sin área)");
    expect(g.map((x) => x.group)).toEqual(["Logística", "Postventa", "(sin área)"]);
    expect(g[0]!.gasto).toBe(1000);
    expect(g[2]!.litros).toBe(20);
  });
});
