import { describe, expect, it } from "vitest";
import {
  calcEstatusSemanal,
  normBodyRisk,
  normFluidRisk,
  normTireRisk,
} from "../src/analyzer/risk";

describe("normFluidRisk", () => {
  it.each([
    ["Vacío", "Urgente"],
    ["fuga detectada", "Urgente"],
    ["Nivel óptimo", "OK"],
    ["OK", "OK"],
    ["SI", "OK"],
    ["", "OK"],
    ["algo raro", "Revisar"],
    ["nivel bajo", "Revisar"],
  ] as const)("'%s' → %s", (input, expected) => {
    expect(normFluidRisk(input)).toBe(expected);
  });
});

describe("normBodyRisk", () => {
  it.each([
    ["No", "OK"],
    ["N/A", "OK"],
    ["sin daños", "OK"],
    ["Golpe menor", "Revisar"],
    ["Rayón", "Revisar"],
    ["fuera de servicio", "Urgente"],
    ["pérdida total", "Urgente"],
    ["", "OK"],
  ] as const)("'%s' → %s", (input, expected) => {
    expect(normBodyRisk(input)).toBe(expected);
  });
});

describe("normTireRisk", () => {
  it.each([
    ["Sí", "OK"],
    ["Funcional", "OK"],
    ["No", "Revisar"],
    ["Ponchada", "Revisar"],
    ["Dañada", "Revisar"],
    ["", "OK"],
  ] as const)("'%s' → %s", (input, expected) => {
    expect(normTireRisk(input)).toBe(expected);
  });
});

describe("calcEstatusSemanal", () => {
  it("cualquier Urgente en aceite o radiador → Urgente", () => {
    expect(calcEstatusSemanal("Urgente", "OK", "OK", "OK")).toBe("Urgente");
    expect(calcEstatusSemanal("OK", "Urgente", "OK", "OK")).toBe("Urgente");
  });

  it("carrocería/llanta no afectan el estatus global", () => {
    expect(calcEstatusSemanal("OK", "OK", "Urgente", "Urgente")).toBe("OK");
  });

  it("Revisar en vitales escala a Revisar", () => {
    expect(calcEstatusSemanal("Revisar", "OK")).toBe("Revisar");
  });

  it("todo OK → OK", () => {
    expect(calcEstatusSemanal("OK", "OK", "OK", "OK")).toBe("OK");
  });
});
