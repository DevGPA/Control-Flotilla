import { describe, it, expect } from "vitest";
import { monthOf, monthLabel, diasEnMes, MES_CORTO } from "../src/dates";

describe("monthOf", () => {
  it("deriva YYYY-MM de fecha ISO", () => {
    expect(monthOf("2026-08-26")).toBe("2026-08");
    expect(monthOf("2026-08")).toBe("2026-08");
  });

  it("deriva YYYY-MM de fecha legacy DD/MM/YYYY (con y sin cero)", () => {
    expect(monthOf("26/08/2026")).toBe("2026-08");
    expect(monthOf("5/3/2025")).toBe("2025-03");
  });

  it("devuelve null con basura, vacío, null y undefined", () => {
    expect(monthOf("no-es-fecha")).toBeNull();
    expect(monthOf("")).toBeNull();
    expect(monthOf("   ")).toBeNull();
    expect(monthOf(null)).toBeNull();
    expect(monthOf(undefined)).toBeNull();
  });
});

describe("monthLabel", () => {
  it('"2026-08" → "Ago 2026"', () => {
    expect(monthLabel("2026-08")).toBe("Ago 2026");
    expect(monthLabel("2025-01")).toBe("Ene 2025");
    expect(monthLabel("2025-12")).toBe("Dic 2025");
  });

  it("no parseable → devuelve el string crudo", () => {
    expect(monthLabel("agosto")).toBe("agosto");
    expect(monthLabel("2026-13")).toBe("2026-13"); // mes fuera de rango
    expect(monthLabel("")).toBe("");
  });
});

describe("diasEnMes", () => {
  it("febrero bisiesto y no bisiesto", () => {
    expect(diasEnMes(2028, 2)).toBe(29);
    expect(diasEnMes(2027, 2)).toBe(28);
    expect(diasEnMes(2000, 2)).toBe(29); // divisible por 400
    expect(diasEnMes(1900, 2)).toBe(28); // divisible por 100, no por 400
  });

  it("meses de 30 y 31 días", () => {
    expect(diasEnMes(2026, 4)).toBe(30);
    expect(diasEnMes(2026, 6)).toBe(30);
    expect(diasEnMes(2026, 9)).toBe(30);
    expect(diasEnMes(2026, 11)).toBe(30);
    expect(diasEnMes(2026, 1)).toBe(31);
    expect(diasEnMes(2026, 8)).toBe(31);
    expect(diasEnMes(2026, 12)).toBe(31);
  });
});

describe("MES_CORTO", () => {
  it("es 1-indexado con índice 0 vacío (como MES_NAMES del legado)", () => {
    expect(MES_CORTO[0]).toBe("");
    expect(MES_CORTO[1]).toBe("Ene");
    expect(MES_CORTO[12]).toBe("Dic");
    expect(MES_CORTO).toHaveLength(13);
  });
});
