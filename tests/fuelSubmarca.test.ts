import { describe, expect, it } from "vitest";
import { buildFuelEntries, normSubmarca } from "../src/fuel/mapEntry";
import { rankUnitsBySubmarca } from "../src/fuel/fuelAggregates";
import type { FleetBaseline, FuelStat } from "../src/fuel/types";

describe("normSubmarca", () => {
  it("colapsa espacios y recorta, conservando el casing visible", () => {
    expect(normSubmarca("  Aumark   TM3  ")).toBe("Aumark TM3");
    expect(normSubmarca("NP 300 Chasis")).toBe("NP 300 Chasis");
    expect(normSubmarca("")).toBeUndefined();
    expect(normSubmarca(null)).toBeUndefined();
    expect(normSubmarca("   ")).toBeUndefined();
  });
});

describe("buildFuelEntries — join de submarca por economicoId", () => {
  const rows = [
    { economicoId: "6", tipo: "carga", eventoId: "E1", fecha: "2026-07-01" },
    { economicoId: "44", tipo: "carga", eventoId: "E2", fecha: "2026-07-01" },
    { economicoId: "99", tipo: "carga", eventoId: "E3", fecha: "2026-07-01" },
  ];

  it("normaliza claves del catálogo con ecoKey ('06' del catálogo casa con '6' de la carga)", () => {
    const entries = buildFuelEntries(
      rows,
      [],
      new Map([
        ["06", { submarca: "Peugeot Partner" }],
        ["44", { submarca: "  Aumark  TM3 " }],
      ]),
    );
    const byEco = new Map(entries.map((e) => [e.eco, e.submarca]));
    expect(byEco.get("6")).toBe("Peugeot Partner");
    expect(byEco.get("44")).toBe("Aumark TM3"); // normalizada
    expect(byEco.get("99")).toBeUndefined(); // sin unidad en el catálogo
  });

  it("sin catálogo, submarca queda undefined (compat con llamadores existentes)", () => {
    const entries = buildFuelEntries(rows);
    expect(entries.every((e) => e.submarca === undefined)).toBe(true);
  });
});

describe("rankUnitsBySubmarca", () => {
  const stat = (kmplVol: number, n: number): FuelStat => ({ mean: kmplVol, sd: 0, n, kmplVol });
  const baseline: FleetBaseline = {
    porUnidad: new Map([
      ["10", stat(8.2, 5)],
      ["20", stat(5.1, 4)],
      ["30", stat(6.7, 3)],
      ["40", stat(9.9, 1)], // n < minN → fuera
      ["50", stat(12.0, 6)],
    ]),
    porTipo: new Map(),
    tipoDe: new Map(),
    flotaMean: 7,
  };
  const submarcaDe = new Map([
    ["10", "Aumark TM3"],
    ["20", "AUMARK TM3"], // variante de casing → mismo grupo
    ["30", "Aumark TM3"],
    ["40", "Aumark TM3"],
    // "50" sin submarca → "(sin tipo)"
  ]);
  const sucursalDe = new Map([
    ["10", "Guadalajara"],
    ["20", "Monterrey"],
    ["30", "Cancún"],
  ]);

  it("agrupa case-insensitive, ordena peor primero y anexa sucursal", () => {
    const m = rankUnitsBySubmarca(baseline, submarcaDe, sucursalDe);
    expect([...m.keys()].sort()).toEqual(["(sin tipo)", "Aumark TM3"]);
    const tm3 = m.get("Aumark TM3")!;
    expect(tm3.map((r) => r.eco)).toEqual(["20", "30", "10"]); // 5.1 < 6.7 < 8.2
    expect(tm3[0]!.sucursal).toBe("Monterrey");
    expect(tm3.every((r) => r.n >= 2)).toBe(true); // "40" (n=1) quedó fuera
    expect(m.get("(sin tipo)")!.map((r) => r.eco)).toEqual(["50"]);
  });

  it("respeta minN configurable", () => {
    const m = rankUnitsBySubmarca(baseline, submarcaDe, sucursalDe, 5);
    expect(m.get("Aumark TM3")!.map((r) => r.eco)).toEqual(["10"]);
  });
});
