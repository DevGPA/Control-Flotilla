import { describe, expect, it } from "vitest";
import { classifyReport, isWeeklyReport } from "../src/analyzer/classifyReport";

describe("classifyReport", () => {
  it("prioriza nombre de archivo 'mensual'", () => {
    expect(classifyReport(["llanta de refaccion"], "Control Vehicular Mensual.xlsx")).toBe(
      "mensual",
    );
  });

  it("prioriza nombre de archivo 'semanal'", () => {
    expect(classifyReport([], "Control Vehicular Semanal.xlsx")).toBe("semanal");
  });

  it("usa contenido cuando nombre no es concluyente y hay ≥3 señales con exclusiva", () => {
    expect(
      classifyReport(
        [
          "Llanta de refaccion funcional",
          "Carroceria con golpes o raspaduras",
          "Nombre de quien verifica",
          "Kilometraje al momento",
        ],
        "Export.xlsx",
      ),
    ).toBe("semanal");
  });

  it("devuelve mensual por defecto cuando no hay exclusivas", () => {
    expect(classifyReport(["kilometraje", "nivel de aceite de motor"], "Export.xlsx")).toBe(
      "mensual",
    );
  });

  it("normaliza tildes en headers", () => {
    expect(
      classifyReport(
        [
          "LLANTA DE REFACCIÓN",
          "Carrocería con golpe",
          "# Económico - Combustible",
          "radiador",
        ],
        "",
      ),
    ).toBe("semanal");
  });

  it("isWeeklyReport es un alias booleano", () => {
    expect(isWeeklyReport([], "Semanal.xlsx")).toBe(true);
    expect(isWeeklyReport([], "Mensual.xlsx")).toBe(false);
  });
});
