// La hidratación desde la nube fijaba `hasRefaccion: true` a mano, así que el aviso
// "Sin refacción" de la pestaña Llantas y el renglón del PDF nunca se activaban aunque
// el chofer hubiera contestado "No". Aquí se prueba el CABLEADO (donde vivía el bug),
// no solo la regla pura (tests/refaccion.test.ts).
//
// Además normaliza lo YA guardado en DynamoDB: los meses capturados con la regla vieja
// se leen con la nueva (tope Revisar + TACO mínimo sin refacción) sin backfill.
import { describe, expect, it } from "vitest";
import { mergeUnitWithChecklist } from "../src/api/cloudHydrate";

type MergeArgs = Parameters<typeof mergeUnitWithChecklist>;

const unidad = (): MergeArgs[0] =>
  ({
    tenantId: "gpa",
    placa: "ABC-123",
    economicoId: "78",
  }) as unknown as MergeArgs[0];

const checklist = (resultados: Record<string, unknown>): MergeArgs[1] =>
  ({
    tenantId: "gpa",
    unitUid: "ABC-123",
    fecha: "2026-07-15",
    resultados: JSON.stringify(resultados),
  }) as unknown as MergeArgs[1];

const SIN_REFACCION = {
  cat: "Checklist",
  key: "Chk:Refaccion",
  text: "Sin llanta de refacción funcional",
  lv: "Completar",
};

const TACO_REFACCION_URGENTE = {
  cat: "Llantas",
  key: "Llanta:Refacción",
  text: "Refacción: 2mm — desgaste crítico",
  lv: "Urgente",
};

describe("mergeUnitWithChecklist — hasRefaccion derivado de los hallazgos", () => {
  it("false cuando el checklist guardado reporta que no trae refacción", () => {
    const u = mergeUnitWithChecklist(
      unidad(),
      checklist({
        findings: [SIN_REFACCION],
        risk: "Completar",
        tires: { "Piloto Delantera": 8 },
        minT: 8,
      }),
    );
    expect(u.hasRefaccion).toBe(false);
  });

  it("true cuando la unidad sí trae refacción", () => {
    const u = mergeUnitWithChecklist(
      unidad(),
      checklist({ findings: [], risk: "OK", tires: { "Piloto Delantera": 8 }, minT: 8 }),
    );
    expect(u.hasRefaccion).toBe(true);
  });

  it("true en unidades sin checklist (no hay evidencia de falta)", () => {
    const u = mergeUnitWithChecklist(unidad(), undefined);
    expect(u.hasRefaccion).toBe(true);
    expect(u.minT).toBeNull();
  });
});

describe("mergeUnitWithChecklist — normaliza registros guardados con la regla vieja", () => {
  it("recalcula el TACO mínimo excluyendo la refacción", () => {
    const u = mergeUnitWithChecklist(
      unidad(),
      checklist({
        findings: [],
        risk: "OK",
        tires: { "Piloto Delantera": 8, "Copiloto Delantera": 9, Refacción: 3 },
        minT: 3,
      }),
    );
    expect(u.minT).toBe(8);
    expect(u.T["Refacción"]).toBe(3); // la lectura se conserva para mostrarla aparte
  });

  it("baja a Revisar el hallazgo de refacción guardado como Urgente", () => {
    const u = mergeUnitWithChecklist(
      unidad(),
      checklist({
        findings: [TACO_REFACCION_URGENTE],
        risk: "Urgente",
        tires: { "Piloto Delantera": 8, Refacción: 2 },
        minT: 2,
      }),
    );
    expect(u.F[0]!.lv).toBe("Revisar");
    expect(u.risk).toBe("Revisar");
    expect(u.minT).toBe(8);
  });

  it("no rebaja unidades con una falla real de rodaje", () => {
    const u = mergeUnitWithChecklist(
      unidad(),
      checklist({
        findings: [
          TACO_REFACCION_URGENTE,
          {
            cat: "Llantas",
            key: "Llanta:Piloto Delantera",
            text: "Piloto Delantera: 2mm — desgaste crítico",
            lv: "Urgente",
          },
        ],
        risk: "Urgente",
        tires: { "Piloto Delantera": 2, Refacción: 2 },
        minT: 2,
      }),
    );
    expect(u.risk).toBe("Urgente");
    expect(u.minT).toBe(2);
  });

  it("conserva el minT guardado en registros viejos sin lecturas por posición", () => {
    const u = mergeUnitWithChecklist(
      unidad(),
      checklist({ findings: [], risk: "Revisar", minT: 5 }),
    );
    expect(u.minT).toBe(5);
  });
});
