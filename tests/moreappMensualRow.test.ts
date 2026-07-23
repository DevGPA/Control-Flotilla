import { describe, expect, it } from "vitest";
import { buildRow, dataNamesLlantaNoMapeados } from "../src/moreapp/mensualRow";
import { analyzeRow } from "../src/analyzer/analyzeRow";

/**
 * Bug internas jun-jul 2026: MoreApp regeneró los dataNames de 3 campos del
 * formulario MENSUAL con sufijo "1" (nivelTACODeLlanta*INTERNA1 / *REFACCION1).
 * El FIELD_MAP solo conocía los nombres viejos → analyzeRow omitía en SILENCIO
 * las llantas internas y el TACO de refacción desde el rename (feb-may bien,
 * jun casi 0, jul 0 de 40). Verificado contra un envío real de MoreApp (6-jul).
 */

/** Shape real de un envío de julio (subconjunto de llantas; valores del envío real). */
const ANSWERS_JULIO = {
  kilometraje: 13800,
  cuentaConLlantaPilotoTraseraINTERNA: "Si",
  cuentaConLlantaCopilotoTraseraINTERNA: "Si",
  cuentaConLlantaDeRefaccin: "Si",
  nivelTACODeLlantaPilotoDelantera: 9,
  nivelTACODeLlantaCopilotoDelantera: 9,
  nivelTACODeLlantaPilotoTrasera: 6,
  nivelTACODeLlantaCopilotoTrasera: 9,
  // dataNames RENOMBRADOS por MoreApp (sufijo 1):
  nivelTACODeLlantaPilotoTraseraINTERNA1: 9,
  nivelTACODeLlantaCopilotoTraseraINTERNA1: 3,
  nivelTACODeLlantaREFACCION1: 1,
  economico: { PLACAS: "JX36945", id: "13" },
};

describe("buildRow: dataNames renombrados del mensual (sufijo 1)", () => {
  it("mapea los dataNames NUEVOS a las columnas de analyzeRow", () => {
    const row = buildRow(ANSWERS_JULIO);
    expect(row["Nivel TACO de llanta piloto trasera INTERNA"]).toBe(9);
    expect(row["Nivel TACO de llanta copiloto trasera INTERNA"]).toBe(3);
    expect(row["Nivel TACO de llanta REFACCION"]).toBe(1);
  });

  it("sigue aceptando los dataNames VIEJOS (envíos feb-may / backfill histórico)", () => {
    const row = buildRow({
      cuentaConLlantaPilotoTraseraINTERNA: "Si",
      nivelTACODeLlantaPilotoTraseraINTERNA: 7,
      nivelTACODeLlantaREFACCION: 5,
    });
    expect(row["Nivel TACO de llanta piloto trasera INTERNA"]).toBe(7);
    expect(row["Nivel TACO de llanta REFACCION"]).toBe(5);
  });

  it("si coexistieran ambos, gana el dataName nuevo (campo vigente del form)", () => {
    const row = buildRow({
      nivelTACODeLlantaREFACCION: 5,
      nivelTACODeLlantaREFACCION1: 2,
    });
    expect(row["Nivel TACO de llanta REFACCION"]).toBe(2);
  });

  it("end-to-end: las internas del envío de julio llegan a tires de analyzeRow", () => {
    const analyzed = analyzeRow(buildRow(ANSWERS_JULIO));
    expect(analyzed.T["Piloto Trasera Int."]).toBe(9);
    expect(analyzed.T["Copiloto Trasera Int."]).toBe(3); // ≤3.99 → además debe alertar
    expect(analyzed.T["Refacción"]).toBe(1);
    expect(
      analyzed.F.some((f) => f.cat === "Llantas" && /Copiloto Trasera Int\./.test(f.text)),
    ).toBe(true);
  });
});

describe("dataNamesLlantaNoMapeados: detector de drift del formulario", () => {
  it("detecta un futuro rename de llantas que el FIELD_MAP no conozca", () => {
    expect(
      dataNamesLlantaNoMapeados({
        nivelTACODeLlantaREFACCION2: 4, // rename futuro hipotético
        cuentaConLlantaDeRefaccin1: "Si",
        kilometraje: 1000, // no-llanta: ignorado
      }),
    ).toEqual(["cuentaConLlantaDeRefaccin1", "nivelTACODeLlantaREFACCION2"]);
  });

  it("con el formulario actual (julio) no reporta nada", () => {
    expect(dataNamesLlantaNoMapeados(ANSWERS_JULIO)).toEqual([]);
  });
});
