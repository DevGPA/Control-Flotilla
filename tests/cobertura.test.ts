import { describe, it, expect } from "vitest";
import { buildCobertura, coberturaNivel } from "../src/inspecciones/cobertura";

type Roster = { plate?: string; uid?: string };

const mkRoster = (n: number): Roster[] =>
  Array.from({ length: n }, (_, i) => ({ plate: `ECO${i + 1}`, uid: `ECO${i + 1}` }));

describe("buildCobertura", () => {
  it("52 unidades, 38 con check → {52, 38, 14, 73}", () => {
    const roster = mkRoster(52);
    const presentes = new Set(roster.slice(0, 38).map((r) => r.plate!));
    expect(buildCobertura(roster, presentes)).toEqual({
      total: 52,
      conCheck: 38,
      faltan: 14,
      pct: 73,
    });
  });

  it("placas fuera del catálogo (dadas de baja) NO inflan el numerador", () => {
    const roster = mkRoster(10);
    const presentes = new Set([
      ...roster.map((r) => r.plate!),
      "BAJA-1",
      "BAJA-2", // inspecciones de unidades que ya no están en el catálogo
    ]);
    const cob = buildCobertura(roster, presentes);
    expect(cob.conCheck).toBe(10);
    expect(cob.pct).toBe(100);
    expect(cob.pct).toBeLessThanOrEqual(100);
  });

  it("roster vacío → todo 0 (sin división entre cero)", () => {
    expect(buildCobertura([], new Set(["X"]))).toEqual({
      total: 0,
      conCheck: 0,
      faltan: 0,
      pct: 0,
    });
  });

  it("cobertura completa y cobertura cero", () => {
    const roster = mkRoster(5);
    expect(buildCobertura(roster, new Set(roster.map((r) => r.plate!)))).toMatchObject({
      pct: 100,
      faltan: 0,
    });
    expect(buildCobertura(roster, new Set())).toMatchObject({ pct: 0, faltan: 5 });
  });

  it("sin plate cae al uid (roster del catálogo usa placa como uid)", () => {
    const roster: Roster[] = [{ uid: "XYZ1" }, { uid: "XYZ2" }];
    expect(buildCobertura(roster, new Set(["XYZ1"])).conCheck).toBe(1);
  });

  it("propiedad: conCheck + faltan === total (varios tamaños)", () => {
    for (const [n, k] of [
      [1, 0],
      [7, 3],
      [52, 38],
      [100, 99],
    ] as const) {
      const roster = mkRoster(n);
      const presentes = new Set(roster.slice(0, k).map((r) => r.plate!));
      const cob = buildCobertura(roster, presentes);
      expect(cob.conCheck + cob.faltan).toBe(cob.total);
    }
  });
});

describe("coberturaNivel", () => {
  it("bordes exactos: 90 y 70 inclusive", () => {
    expect(coberturaNivel(100)).toBe("ok");
    expect(coberturaNivel(90)).toBe("ok");
    expect(coberturaNivel(89)).toBe("warn");
    expect(coberturaNivel(70)).toBe("warn");
    expect(coberturaNivel(69)).toBe("bad");
    expect(coberturaNivel(0)).toBe("bad");
  });
});
