import { describe, expect, it } from "vitest";
import { analyzeRow } from "../src/analyzer/analyzeRow";

describe("analyzeRow", () => {
  it("marca Urgente cuando una llanta está debajo del umbral crítico", () => {
    const r = analyzeRow({ "Nivel TACO de llanta piloto delantera": 3 });
    expect(r.max).toBe("Urgente");
    expect(r.F.some((f) => f.lv === "Urgente" && f.cat === "Llantas")).toBe(true);
    expect(r.minT).toBe(3);
  });

  it("marca Revisar cuando una llanta está entre TCRIT y TWARN", () => {
    const r = analyzeRow({ "Nivel TACO de llanta piloto delantera": 5 });
    expect(r.max).toBe("Revisar");
    expect(r.minT).toBe(5);
  });

  it("no marca nada cuando todas las llantas están por encima de TWARN", () => {
    const r = analyzeRow({
      "Nivel TACO de llanta piloto delantera": 8,
      "Nivel TACO de llanta copiloto delantera": 9,
    });
    expect(r.max).toBe("OK");
  });

  it("agrega Completar cuando la refacción no es funcional y no la mide (legacy col)", () => {
    const r = analyzeRow({
      "Llanta de refaccion funcional": "No",
      "Nivel TACO de llanta REFACCION": 2,
    });
    expect(r.F.some((f) => f.text === "Sin llanta de refacción funcional")).toBe(true);
    expect(r.F.some((f) => f.cat === "Llantas" && f.text.includes("Refacción"))).toBe(false);
  });

  it("Refacción 'No' en col real + 0mm → Completar, no Urgente", () => {
    const r = analyzeRow({
      "Cuenta con llanta de Refacción?": "No",
      "Nivel TACO de llanta REFACCION": 0,
    });
    expect(r.max).toBe("Revisar");
    expect(r.F.some((f) => f.text === "Sin llanta de refacción funcional")).toBe(true);
    expect(r.F.some((f) => f.cat === "Llantas" && f.lv === "Urgente")).toBe(false);
    expect(r.T["Refacción"]).toBeUndefined();
  });

  it("Refacción 'Si' + 0mm → Urgente (caso correcto)", () => {
    const r = analyzeRow({
      "Cuenta con llanta de Refacción?": "Si",
      "Nivel TACO de llanta REFACCION": 0,
    });
    expect(r.max).toBe("Urgente");
    expect(r.F.some((f) => f.cat === "Llantas" && f.text.includes("Refacción"))).toBe(true);
  });

  it("Internas 'No' + 0mm → skip, no Urgente", () => {
    const r = analyzeRow({
      "¿Cuenta con Llanta Piloto trasera INTERNA?": "No",
      "¿Cuenta con Llanta Copiloto trasera INTERNA?": "No",
      "Nivel TACO de llanta piloto trasera INTERNA": 0,
      "Nivel TACO de llanta copiloto trasera INTERNA": 0,
    });
    expect(r.max).toBe("OK");
    expect(r.T["Piloto Trasera Int."]).toBeUndefined();
    expect(r.T["Copiloto Trasera Int."]).toBeUndefined();
  });

  it("detecta tarjeta de circulación vencida (via isBinFail)", () => {
    const r = analyzeRow({ "Tarjeta de circulacion vigente": "Si vencida" });
    expect(r.F.some((f) => f.text.includes("Tarjeta de circulación vencida"))).toBe(true);
    expect(r.max).toBe("Completar");
  });

  it("BIN: 'Con Raspaduras/Golpes' → Revisar (carrocería dañada)", () => {
    const r = analyzeRow({ "Carroceria con golpes o raspaduras": "Con Raspaduras/Golpes" });
    expect(r.max).toBe("Revisar");
    expect(r.F.some((f) => f.text.includes("Carrocería con daños"))).toBe(true);
  });

  it("BIN: 'Sin Raspaduras/Golpes' → OK (carrocería limpia)", () => {
    const r = analyzeRow({ "Carroceria con golpes o raspaduras": "Sin Raspaduras/Golpes" });
    expect(r.max).toBe("OK");
  });

  it("BIN: 'No lleva' (tapón) → Revisar", () => {
    const r = analyzeRow({ "Tapon de la gasolina": "No lleva" });
    expect(r.max).toBe("Revisar");
    expect(r.F.some((f) => f.text === "Sin tapón de gasolina")).toBe(true);
  });

  it("BIN: 'No aplica' (verificación ambiental) → no dispara", () => {
    const r = analyzeRow({ "Tarjeta/calcamonia de verificacion ambiental vigente": "No aplica" });
    expect(r.max).toBe("OK");
  });

  it("BIN: 'Si vigente' → no dispara", () => {
    const r = analyzeRow({ "Poliza de seguro vigente": "Si vigente" });
    expect(r.max).toBe("OK");
  });

  it("BIN: 'Si vencida' (póliza) → dispara Completar", () => {
    const r = analyzeRow({ "Poliza de seguro vigente": "Si vencida" });
    expect(r.max).toBe("Completar");
    expect(r.F.some((f) => f.text.includes("Póliza de seguro vencida"))).toBe(true);
  });

  it("BIN_LABELS: usa label friendly, no key crudo", () => {
    const r = analyzeRow({ "Espejo retrovisor en buenas condiciones": "No" });
    expect(r.F.some((f) => f.text === "Espejo retrovisor dañado")).toBe(true);
    expect(r.F.some((f) => f.text === "Espejo retrovisor en buenas condiciones")).toBe(false);
  });

  it("marca Urgente cuando nivel de aceite está bajo", () => {
    const r = analyzeRow({ "Nivel de aceite de motor max": "Nivel bajo" });
    expect(r.max).toBe("Urgente");
  });

  it("marca Revisar cuando radiador está bajo", () => {
    const r = analyzeRow({ "Nivel de liquido de radiador max": "nivel bajo" });
    expect(r.max).toBe("Revisar");
  });

  it("BIN: luces 'No' produce Urgente", () => {
    const r = analyzeRow({ "Luces y cuartos delanteros funcionando": "No" });
    expect(r.max).toBe("Urgente");
  });

  it("maneja fila vacía sin reventar", () => {
    const r = analyzeRow({});
    expect(r.max).toBe("OK");
    expect(r.F).toHaveLength(0);
    expect(r.minT).toBeNull();
  });
});
