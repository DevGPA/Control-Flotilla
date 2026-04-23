import { describe, expect, it } from "vitest";
import {
  applyFilters,
  canTransitionTo,
  computeTotals,
  diasEnTaller,
  filterActivas,
  filterCerradas,
  gastoTotal,
  groupByUnit,
  isClosed,
  matchesSearch,
  nextStates,
  sortByUrgencia,
  sortEntries,
  uniqueAreas,
  uniqueSucursales,
  uniqueTipos,
} from "../src/taller/tallerStore";
import type { TallerEntry } from "../src/taller/types";

function mk(overrides: Partial<TallerEntry> = {}): TallerEntry {
  return {
    id: "t1",
    eco: "A-117",
    estado: "Reparando",
    ...overrides,
  };
}

describe("isClosed", () => {
  it("Finalizado → true", () => expect(isClosed(mk({ estado: "Finalizado" }))).toBe(true));
  it("Listo → true", () => expect(isClosed(mk({ estado: "Listo" }))).toBe(true));
  it("Reparando → false", () => expect(isClosed(mk({ estado: "Reparando" }))).toBe(false));
  it("En Revisión → false", () => expect(isClosed(mk({ estado: "En Revisión" }))).toBe(false));
});

describe("filterActivas / filterCerradas", () => {
  const entries: TallerEntry[] = [
    mk({ id: "1", estado: "Reparando" }),
    mk({ id: "2", estado: "Finalizado" }),
    mk({ id: "3", estado: "En Revisión" }),
    mk({ id: "4", estado: "Listo" }),
  ];
  it("filterActivas", () => {
    const r = filterActivas(entries).map((e) => e.id);
    expect(r).toEqual(["1", "3"]);
  });
  it("filterCerradas", () => {
    const r = filterCerradas(entries).map((e) => e.id);
    expect(r).toEqual(["2", "4"]);
  });
});

describe("diasEnTaller", () => {
  it("calcula días redondeando", () => {
    const today = new Date("2026-04-17");
    const e = mk({ fentrada: "2026-04-10" });
    expect(diasEnTaller(e, today)).toBe(7);
  });
  it("sin fentrada → null", () => expect(diasEnTaller(mk({}))).toBeNull());
  it("fentrada inválida → null", () =>
    expect(diasEnTaller(mk({ fentrada: "invalid" }))).toBeNull());
  it("fentrada futura → 0 (max 0)", () => {
    const today = new Date("2026-04-10");
    const e = mk({ fentrada: "2026-04-20" });
    expect(diasEnTaller(e, today)).toBe(0);
  });
});

describe("gastoTotal", () => {
  it("suma ref + mo", () => expect(gastoTotal(mk({ gastoRef: 500, gastoMO: 300 }))).toBe(800));
  it("sin valores → 0", () => expect(gastoTotal(mk({}))).toBe(0));
  it("solo ref", () => expect(gastoTotal(mk({ gastoRef: 100 }))).toBe(100));
});

describe("matchesSearch", () => {
  it("query vacío → true", () => expect(matchesSearch(mk(), "")).toBe(true));
  it("matches eco case-insensitive", () =>
    expect(matchesSearch(mk({ eco: "A-117" }), "a-117")).toBe(true));
  it("matches tildes normalizadas", () => {
    expect(matchesSearch(mk({ comentario: "Reparación" }), "reparacion")).toBe(true);
  });
  it("no match", () => expect(matchesSearch(mk({ eco: "A-117" }), "xyz")).toBe(false));
  it("matches plate, tecnico, brand, refacciones", () => {
    expect(matchesSearch(mk({ plate: "XYZ-999" }), "xyz")).toBe(true);
    expect(matchesSearch(mk({ tecnico: "Juan" }), "juan")).toBe(true);
    expect(matchesSearch(mk({ brand: "Toyota" }), "toyota")).toBe(true);
    expect(matchesSearch(mk({ refacciones: "batería" }), "bateria")).toBe(true);
  });
});

describe("applyFilters", () => {
  const entries: TallerEntry[] = [
    mk({ id: "1", sucursal: "Norte", area: "Mantenimiento", tipo: "Preventivo" }),
    mk({ id: "2", sucursal: "Sur", area: "Mantenimiento", tipo: "Correctivo" }),
    mk({ id: "3", sucursal: "Norte", area: "Carrocería", tipo: "Correctivo" }),
  ];
  it("sin filtros → todas", () => expect(applyFilters(entries)).toHaveLength(3));
  it("sucursal 'all' ignora filtro", () =>
    expect(applyFilters(entries, { sucursal: "all" })).toHaveLength(3));
  it("sucursal Norte → 2", () =>
    expect(applyFilters(entries, { sucursal: "Norte" })).toHaveLength(2));
  it("combinados (Norte + Correctivo) → 1", () => {
    const r = applyFilters(entries, { sucursal: "Norte", tipo: "Correctivo" });
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe("3");
  });
});

describe("uniqueSucursales/Areas/Tipos", () => {
  const e: TallerEntry[] = [
    mk({ sucursal: "Norte", area: "A", tipo: "P" }),
    mk({ sucursal: "Sur", area: "B", tipo: "C" }),
    mk({ sucursal: "Norte", area: "A", tipo: "C" }),
    mk({ sucursal: undefined }),
  ];
  it("sucursales únicas ordenadas", () => expect(uniqueSucursales(e)).toEqual(["Norte", "Sur"]));
  it("áreas únicas", () => expect(uniqueAreas(e)).toEqual(["A", "B"]));
  it("tipos únicos", () => expect(uniqueTipos(e)).toEqual(["C", "P"]));
});

describe("groupByUnit", () => {
  const e: TallerEntry[] = [
    mk({ id: "1", unitKey: "U1", fentrada: "2026-04-10" }),
    mk({ id: "2", unitKey: "U1", fentrada: "2026-04-15" }),
    mk({ id: "3", unitKey: "U2", fentrada: "2026-04-12" }),
  ];
  it("agrupa por unitKey", () => {
    const g = groupByUnit(e);
    expect(g.size).toBe(2);
    expect(g.get("U1")).toHaveLength(2);
    expect(g.get("U2")).toHaveLength(1);
  });
  it("dentro del grupo, ordenado desc por fentrada", () => {
    const g = groupByUnit(e);
    const u1 = g.get("U1")!;
    expect(u1[0]!.id).toBe("2"); // más reciente
    expect(u1[1]!.id).toBe("1");
  });
  it("fallback keys: eco > plate > id", () => {
    const ent: TallerEntry[] = [
      mk({ id: "a", unitKey: undefined, eco: "E1" }),
      mk({ id: "b", unitKey: undefined, eco: undefined, plate: "P1" }),
      mk({ id: "c", unitKey: undefined, eco: undefined, plate: undefined }),
    ];
    const g = groupByUnit(ent);
    expect(g.has("E1")).toBe(true);
    expect(g.has("P1")).toBe(true);
    expect(g.has("c")).toBe(true);
  });
});

describe("sortEntries", () => {
  const today = new Date("2026-04-17");
  const e: TallerEntry[] = [
    mk({
      id: "1",
      fentrada: "2026-04-10",
      gastoRef: 500,
      gastoMO: 100,
      eco: "B-200",
      sucursal: "Sur",
    }),
    mk({
      id: "2",
      fentrada: "2026-04-15",
      gastoRef: 200,
      gastoMO: 50,
      eco: "A-117",
      sucursal: "Norte",
    }),
    mk({
      id: "3",
      fentrada: "2026-04-05",
      gastoRef: 1000,
      gastoMO: 200,
      eco: "C-300",
      sucursal: "Norte",
    }),
  ];
  it("sort por fentrada desc", () => {
    const ids = sortEntries(e, "fentrada", "desc").map((x) => x.id);
    expect(ids).toEqual(["2", "1", "3"]);
  });
  it("sort por dias desc (mayor días primero)", () => {
    const ids = sortEntries(e, "dias", "desc", today).map((x) => x.id);
    expect(ids).toEqual(["3", "1", "2"]);
  });
  it("sort por gasto desc", () => {
    const ids = sortEntries(e, "gasto", "desc").map((x) => x.id);
    expect(ids).toEqual(["3", "1", "2"]);
  });
  it("sort por eco asc", () => {
    const ids = sortEntries(e, "eco", "asc").map((x) => x.id);
    expect(ids).toEqual(["2", "1", "3"]);
  });
});

describe("sortByUrgencia", () => {
  it("mayor días primero, luego mayor gasto", () => {
    const today = new Date("2026-04-17");
    const e: TallerEntry[] = [
      mk({ id: "1", fentrada: "2026-04-15", gastoRef: 100 }),
      mk({ id: "2", fentrada: "2026-04-05", gastoRef: 50 }),
      mk({ id: "3", fentrada: "2026-04-05", gastoRef: 500 }),
    ];
    const ids = sortByUrgencia(e, today).map((x) => x.id);
    expect(ids).toEqual(["3", "2", "1"]); // id3 más días+más gasto
  });
});

describe("computeTotals", () => {
  it("calcula métricas agregadas", () => {
    const today = new Date("2026-04-17");
    const e: TallerEntry[] = [
      mk({ id: "1", estado: "Reparando", fentrada: "2026-04-10", gastoRef: 500, gastoMO: 100 }),
      mk({ id: "2", estado: "Reparando", fentrada: "2026-04-15", gastoRef: 200 }),
      mk({ id: "3", estado: "Finalizado", gastoRef: 1000, gastoMO: 200 }),
    ];
    const t = computeTotals(e, today);
    expect(t.activas).toBe(2);
    expect(t.cerradas).toBe(1);
    expect(t.gastoTotalActivas).toBe(800); // 600 + 200
    expect(t.gastoTotalCerradas).toBe(1200);
    expect(t.diasPromedioActivas).toBe(5); // (7 + 2) / 2 = 4.5 → 5
  });
});

describe("canTransitionTo / nextStates", () => {
  it("En Revisión → Reparando (OK)", () => {
    expect(canTransitionTo("En Revisión", "Reparando")).toBe(true);
  });
  it("Finalizado → cualquier otro (NO)", () => {
    expect(canTransitionTo("Finalizado", "Reparando")).toBe(false);
  });
  it("Listo → Finalizado (OK), pero NO 'En Revisión'", () => {
    expect(canTransitionTo("Listo", "Finalizado")).toBe(true);
    expect(canTransitionTo("Listo", "En Revisión")).toBe(false);
  });
  it("nextStates devuelve array", () => {
    expect(nextStates("En Revisión")).toContain("Reparando");
    expect(nextStates("Finalizado")).toEqual([]);
  });
});
