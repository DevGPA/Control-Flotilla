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

  // Decisión de negocio 2026-06-11 (A1): SOLO aceite + radiador son vitales.
  // Carrocería y llanta NO votan el estatus global — una unidad con un golpe
  // o sin refacción sigue circulando (antes el motor TS escalaba con los 4,
  // divergiendo del HTML y del webhook que siempre fueron 2-vital).
  it("carrocería Urgente NO escala el estatus (2-vital, decisión A1)", () => {
    expect(calcEstatusSemanal("OK", "OK", "Urgente", "OK")).toBe("OK");
  });

  it("llanta Urgente NO escala el estatus (2-vital, decisión A1)", () => {
    expect(calcEstatusSemanal("OK", "OK", "OK", "Urgente")).toBe("OK");
  });

  it("carrocería o llanta Revisar NO escalan (2-vital, decisión A1)", () => {
    expect(calcEstatusSemanal("OK", "OK", "Revisar", "OK")).toBe("OK");
    expect(calcEstatusSemanal("OK", "OK", "OK", "Revisar")).toBe("OK");
  });

  it("Revisar en vitales escala a Revisar", () => {
    expect(calcEstatusSemanal("Revisar", "OK")).toBe("Revisar");
  });

  it("todo OK → OK", () => {
    expect(calcEstatusSemanal("OK", "OK", "OK", "OK")).toBe("OK");
  });
});
