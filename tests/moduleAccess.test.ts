import { describe, expect, it } from "vitest";
import { parseModulos, gatingPlan } from "../src/api/moduleAccess";

describe("parseModulos", () => {
  it("CSV válido → lista (lowercase, dedup)", () => {
    expect(parseModulos("inspecciones,combustible")).toEqual(["inspecciones", "combustible"]);
    expect(parseModulos(" Combustible , COMBUSTIBLE ")).toEqual(["combustible"]);
  });
  it("vacío/undefined/null → null (= todos)", () => {
    expect(parseModulos("")).toBeNull();
    expect(parseModulos(undefined)).toBeNull();
    expect(parseModulos(null)).toBeNull();
  });
  it("solo tokens inválidos → null (no bloquear por dato corrupto)", () => {
    expect(parseModulos("foo,bar")).toBeNull();
  });
  it("mezcla válidos+inválidos → solo válidos", () => {
    expect(parseModulos("combustible,foo,taller")).toEqual(["combustible", "taller"]);
  });
});

describe("gatingPlan", () => {
  it("admin → sin gating", () => {
    expect(gatingPlan(["combustible"], true, "inspecciones")).toEqual({
      hidden: [],
      redirectTo: null,
    });
  });
  it("modulos null → sin gating", () => {
    expect(gatingPlan(null, false, "inspecciones")).toEqual({ hidden: [], redirectTo: null });
  });
  it("oculta los no asignados", () => {
    const p = gatingPlan(["combustible"], false, "combustible");
    expect(p.hidden).toEqual(["mn-insp", "mn-taller", "mn-semanales", "mn-analytics"]);
    expect(p.redirectTo).toBeNull(); // ya está en una vista permitida
  });
  it("redirige al primer permitido si la vista actual no está permitida", () => {
    const p = gatingPlan(["combustible", "taller"], false, "inspecciones");
    expect(p.redirectTo).toBe("combustible");
    expect(p.hidden).toContain("mn-insp");
    expect(p.hidden).not.toContain("mn-combustible");
  });
});
