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

  it("agrega Completar cuando la refacción no es funcional y no la mide", () => {
    const r = analyzeRow({
      "Llanta de refaccion funcional": "No",
      "Nivel TACO de llanta REFACCION": 2,
    });
    expect(r.F.some((f) => f.text === "Llanta de refaccion funcional")).toBe(true);
    expect(r.F.some((f) => f.cat === "Llantas" && f.text.includes("Refacción"))).toBe(false);
  });

  it("detecta tarjeta de circulación vencida", () => {
    const r = analyzeRow({ "Tarjeta de circulacion vigente": "Vencida 2023" });
    expect(r.F.some((f) => f.cat === "Documentos")).toBe(true);
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
