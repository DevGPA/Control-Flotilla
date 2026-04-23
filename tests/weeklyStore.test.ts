import { describe, expect, it } from "vitest";
import {
  applyWeeklyFilters,
  buildKpisFromEntries,
  buildKpisFromPeriodo,
  comparePeriodos,
  effRisk,
  findPeriodo,
  formatIsoWeek,
  getISOWeek,
  latestEntryForUnit,
  latestPeriodo,
  sortPeriodos,
  uniqueWeeklySucursales,
  type WeeklyPeriodo,
} from "../src/weekly/weeklyStore";
import type { WeeklyEntry } from "../src/types";

function mkE(overrides: Partial<WeeklyEntry> = {}): WeeklyEntry {
  return { uid: "u1", ...overrides };
}

function mkP(id: string, entries: WeeklyEntry[] = []): WeeklyPeriodo {
  return { id, label: id, entries };
}

describe("effRisk", () => {
  it("aceite Urgente → Urgente", () => {
    expect(effRisk(mkE({ aceiteRisk: "Urgente", radiadorRisk: "OK" }))).toBe("Urgente");
  });
  it("radiador Urgente → Urgente", () => {
    expect(effRisk(mkE({ aceiteRisk: "OK", radiadorRisk: "Urgente" }))).toBe("Urgente");
  });
  it("aceite Revisar → Revisar", () => {
    expect(effRisk(mkE({ aceiteRisk: "Revisar", radiadorRisk: "OK" }))).toBe("Revisar");
  });
  it("ambos OK → OK", () => {
    expect(effRisk(mkE({ aceiteRisk: "OK", radiadorRisk: "OK" }))).toBe("OK");
  });
  it("carroceria/llanta se ignoran", () => {
    expect(
      effRisk(
        mkE({
          aceiteRisk: "OK",
          radiadorRisk: "OK",
          carroceriaRisk: "Urgente",
          llantaRisk: "Revisar",
        }),
      ),
    ).toBe("OK");
  });
  it("undefined → OK", () => expect(effRisk(undefined)).toBe("OK"));
});

describe("getISOWeek / formatIsoWeek", () => {
  it("1 de enero", () => {
    const r = getISOWeek(new Date("2026-01-01"));
    expect(r.year).toBe(2026);
    expect(r.week).toBeGreaterThan(0);
  });
  it("formato 'YYYY-Www' con padding", () => {
    expect(formatIsoWeek(2026, 5)).toBe("2026-W05");
    expect(formatIsoWeek(2026, 15)).toBe("2026-W15");
  });
});

describe("buildKpisFromEntries", () => {
  it("cuenta por risk efectivo", () => {
    const e: WeeklyEntry[] = [
      mkE({ uid: "1", aceiteRisk: "Urgente", radiadorRisk: "OK" }),
      mkE({ uid: "2", aceiteRisk: "OK", radiadorRisk: "Revisar" }),
      mkE({ uid: "3", aceiteRisk: "OK", radiadorRisk: "OK" }),
    ];
    const k = buildKpisFromEntries(e);
    expect(k.total).toBe(3);
    expect(k.urgente).toBe(1);
    expect(k.revisar).toBe(1);
    expect(k.ok).toBe(1);
  });

  it("desglose por tipo de risk (aceite/radiador/carroceria/llanta)", () => {
    const e: WeeklyEntry[] = [
      mkE({
        aceiteRisk: "Urgente",
        radiadorRisk: "Revisar",
        carroceriaRisk: "Revisar",
        llantaRisk: "Revisar",
      }),
      mkE({ aceiteRisk: "Revisar", radiadorRisk: "Urgente", carroceriaRisk: "Urgente" }),
    ];
    const k = buildKpisFromEntries(e);
    expect(k.aceiteUrgente).toBe(1);
    expect(k.aceiteRevisar).toBe(1);
    expect(k.radiadorUrgente).toBe(1);
    expect(k.radiadorRevisar).toBe(1);
    expect(k.carroceriaUrgente).toBe(1);
    expect(k.carroceriaRevisar).toBe(1);
    expect(k.llantaRevisar).toBe(1);
  });

  it("porcentajes calculados", () => {
    const e: WeeklyEntry[] = [
      mkE({ aceiteRisk: "Urgente" }),
      mkE({ aceiteRisk: "Revisar" }),
      mkE({ aceiteRisk: "OK" }),
      mkE({ aceiteRisk: "OK" }),
    ];
    const k = buildKpisFromEntries(e);
    expect(k.pctUrgente).toBe(25);
    expect(k.pctRevisar).toBe(25);
    expect(k.pctOk).toBe(50);
  });

  it("empty entries → kpis en cero sin divide-by-zero", () => {
    const k = buildKpisFromEntries([]);
    expect(k.total).toBe(0);
    expect(k.pctUrgente).toBe(0);
  });
});

describe("buildKpisFromPeriodo", () => {
  it("undefined → null", () => expect(buildKpisFromPeriodo(undefined)).toBeNull());
  it("delega a buildKpisFromEntries", () => {
    const p = mkP("x", [mkE({ aceiteRisk: "Urgente" })]);
    expect(buildKpisFromPeriodo(p)?.urgente).toBe(1);
  });
});

describe("applyWeeklyFilters", () => {
  const e: WeeklyEntry[] = [
    mkE({ uid: "1", eco: "A-117", branch: "Norte", aceiteRisk: "Urgente" }),
    mkE({ uid: "2", eco: "B-200", branch: "Sur", aceiteRisk: "Revisar" }),
    mkE({ uid: "3", eco: "C-300", branch: "Norte", aceiteRisk: "OK" }),
  ];
  it("sin filtros → todas", () => expect(applyWeeklyFilters(e)).toHaveLength(3));
  it("riskFilter Urgente → 1", () =>
    expect(applyWeeklyFilters(e, { riskFilter: "Urgente" })).toHaveLength(1));
  it("sucursal Norte → 2", () =>
    expect(applyWeeklyFilters(e, { sucursal: "Norte" })).toHaveLength(2));
  it("search por eco", () => expect(applyWeeklyFilters(e, { search: "B-200" })).toHaveLength(1));
  it("combinados", () => {
    const r = applyWeeklyFilters(e, { sucursal: "Norte", riskFilter: "OK" });
    expect(r).toHaveLength(1);
    expect(r[0]!.eco).toBe("C-300");
  });
  it("'all' sentinel ignora filtro", () => {
    expect(applyWeeklyFilters(e, { sucursal: "all", riskFilter: "all" })).toHaveLength(3);
  });
});

describe("uniqueWeeklySucursales", () => {
  it("únicas ordenadas alfabético es", () => {
    const e: WeeklyEntry[] = [
      mkE({ branch: "Zona" }),
      mkE({ branch: "Alpha" }),
      mkE({ branch: "Mitad" }),
    ];
    expect(uniqueWeeklySucursales(e)).toEqual(["Alpha", "Mitad", "Zona"]);
  });
});

describe("sortPeriodos / latestPeriodo / findPeriodo", () => {
  const periodos: WeeklyPeriodo[] = [mkP("2026-W15"), mkP("2026-W10"), mkP("2026-W20")];
  it("sort ascendente por id", () => {
    expect(sortPeriodos(periodos).map((p) => p.id)).toEqual(["2026-W10", "2026-W15", "2026-W20"]);
  });
  it("latest = último sorted", () => {
    expect(latestPeriodo(periodos)?.id).toBe("2026-W20");
  });
  it("empty → null", () => expect(latestPeriodo([])).toBeNull());
  it("findPeriodo por id", () => {
    expect(findPeriodo(periodos, "2026-W15")?.id).toBe("2026-W15");
    expect(findPeriodo(periodos, "nope")).toBeNull();
  });
});

describe("latestEntryForUnit", () => {
  const periodos: WeeklyPeriodo[] = [
    mkP("2026-W10", [mkE({ uid: "u1", eco: "A-117", aceiteRisk: "OK" })]),
    mkP("2026-W15", [mkE({ uid: "u1", eco: "A-117", aceiteRisk: "Urgente" })]),
    mkP("2026-W12", [mkE({ uid: "u2", eco: "B-200" })]),
  ];
  it("busca match por uid descendente", () => {
    const r = latestEntryForUnit(periodos, { uid: "u1" });
    expect(r?.periodo.id).toBe("2026-W15");
    expect(r?.entry.aceiteRisk).toBe("Urgente");
  });
  it("fallback por eco", () => {
    const r = latestEntryForUnit(periodos, { uid: "nope", eco: "B-200" });
    expect(r?.periodo.id).toBe("2026-W12");
  });
  it("sin match → null", () => {
    expect(latestEntryForUnit(periodos, { uid: "xxx" })).toBeNull();
  });
});

describe("comparePeriodos", () => {
  it("improved + worsened + unchanged + new + gone", () => {
    const prev = mkP("p", [
      mkE({ uid: "u1", aceiteRisk: "Urgente" }), // será improved (→ OK)
      mkE({ uid: "u2", aceiteRisk: "OK" }), // será worsened (→ Urgente)
      mkE({ uid: "u3", aceiteRisk: "OK" }), // unchanged
      mkE({ uid: "u4", aceiteRisk: "OK" }), // será gone (no está en cur)
    ]);
    const cur = mkP("c", [
      mkE({ uid: "u1", aceiteRisk: "OK" }),
      mkE({ uid: "u2", aceiteRisk: "Urgente" }),
      mkE({ uid: "u3", aceiteRisk: "OK" }),
      mkE({ uid: "u5", aceiteRisk: "Revisar" }), // new
    ]);
    const cmp = comparePeriodos(prev, cur);
    expect(cmp.improved).toBe(1);
    expect(cmp.worsened).toBe(1);
    expect(cmp.unchanged).toBe(1);
    expect(cmp.new).toBe(1);
    expect(cmp.gone).toBe(1);
  });

  it("empty vs empty → todo cero", () => {
    const cmp = comparePeriodos(mkP("a"), mkP("b"));
    expect(cmp).toEqual({ improved: 0, worsened: 0, unchanged: 0, new: 0, gone: 0 });
  });
});
