// Reglas de negocio de la LLANTA DE REFACCIÓN (decisión Navares 2026-08-11):
//  1. La refacción NO está en circulación → su desgaste nunca escala a Urgente
//     (tope Revisar). Coherente con que NO traerla es "Completar".
//  2. La refacción NO entra al TACO mínimo de la unidad (columna Llantas, recuadro
//     del detalle, PDF): ese número refleja solo lo que toca el piso.
//  3. `hasRefaccion` se DERIVA de los hallazgos — antes se fijaba en `true` a mano
//     en cloudHydrate y el aviso "Sin refacción" nunca aparecía.
import { describe, expect, it } from "vitest";

import { REFACCION, minTRodaje, normalizaRefaccion } from "../src/analyzer/refaccion";
import type { Finding } from "../src/types";

const tacoRefaccion = (lv: Finding["lv"], mm = 2): Finding => ({
  cat: "Llantas",
  key: `Llanta:${REFACCION}`,
  text: `${REFACCION}: ${mm}mm — desgaste crítico`,
  lv,
});

const sinRefaccionFinding = (): Finding => ({
  cat: "Checklist",
  key: "Chk:Refaccion",
  text: "Sin llanta de refacción funcional",
  lv: "Completar",
});

describe("minTRodaje — el TACO mínimo ignora la refacción", () => {
  it("excluye la refacción del mínimo", () => {
    expect(minTRodaje({ "Piloto Delantera": 8, "Copiloto Delantera": 7, [REFACCION]: 3 })).toBe(7);
  });

  it("devuelve null si la única lectura es la refacción", () => {
    expect(minTRodaje({ [REFACCION]: 3 })).toBeNull();
  });

  it("devuelve null sin lecturas", () => {
    expect(minTRodaje({})).toBeNull();
    expect(minTRodaje(undefined)).toBeNull();
  });

  it("no altera el mínimo cuando no hay refacción medida", () => {
    expect(minTRodaje({ "Piloto Delantera": 4, "Piloto Trasera": 9 })).toBe(4);
  });
});

describe("normalizaRefaccion — tope de severidad", () => {
  it("baja el hallazgo de desgaste de la refacción de Urgente a Revisar", () => {
    const out = normalizaRefaccion({
      findings: [tacoRefaccion("Urgente")],
      risk: "Urgente",
      tires: { "Piloto Delantera": 8, [REFACCION]: 2 },
      minT: 2,
    });
    expect(out.findings[0]!.lv).toBe("Revisar");
  });

  it("recalcula el riesgo de la unidad cuando la refacción era el único Urgente", () => {
    const out = normalizaRefaccion({
      findings: [tacoRefaccion("Urgente")],
      risk: "Urgente",
      tires: { "Piloto Delantera": 8, [REFACCION]: 2 },
      minT: 2,
    });
    expect(out.risk).toBe("Revisar");
  });

  it("conserva Urgente si otro hallazgo real lo justifica", () => {
    const out = normalizaRefaccion({
      findings: [
        tacoRefaccion("Urgente"),
        { cat: "Fluidos", key: "Fluido:x", text: "aceite BAJO", lv: "Urgente" },
      ],
      risk: "Urgente",
      tires: { "Piloto Delantera": 8, [REFACCION]: 2 },
      minT: 2,
    });
    expect(out.risk).toBe("Urgente");
  });

  it("no toca los hallazgos de llantas de rodaje", () => {
    const rodaje: Finding = {
      cat: "Llantas",
      key: "Llanta:Piloto Delantera",
      text: "Piloto Delantera: 2mm — desgaste crítico",
      lv: "Urgente",
    };
    const out = normalizaRefaccion({
      findings: [rodaje],
      risk: "Urgente",
      tires: { "Piloto Delantera": 2 },
      minT: 2,
    });
    expect(out.findings[0]!.lv).toBe("Urgente");
    expect(out.risk).toBe("Urgente");
  });

  it("deja intactos findings y riesgo cuando no hay nada que bajar", () => {
    const findings = [sinRefaccionFinding()];
    const out = normalizaRefaccion({
      findings,
      risk: "Completar",
      tires: { "Piloto Delantera": 8 },
      minT: 8,
    });
    expect(out.findings).toBe(findings);
    expect(out.risk).toBe("Completar");
  });
});

describe("normalizaRefaccion — TACO mínimo de registros ya guardados", () => {
  it("recalcula el mínimo excluyendo la refacción", () => {
    const out = normalizaRefaccion({
      findings: [],
      risk: "OK",
      tires: { "Piloto Delantera": 8, "Copiloto Delantera": 9, [REFACCION]: 3 },
      minT: 3,
    });
    expect(out.minT).toBe(8);
  });

  it("conserva el minT guardado si el registro no trae lecturas por posición", () => {
    const out = normalizaRefaccion({ findings: [], risk: "OK", tires: {}, minT: 5 });
    expect(out.minT).toBe(5);
  });

  it("devuelve null si la única lectura guardada era la refacción", () => {
    const out = normalizaRefaccion({
      findings: [],
      risk: "OK",
      tires: { [REFACCION]: 3 },
      minT: 3,
    });
    expect(out.minT).toBeNull();
  });
});

describe("normalizaRefaccion — hasRefaccion derivado", () => {
  it("false cuando existe el hallazgo Chk:Refaccion", () => {
    const out = normalizaRefaccion({
      findings: [sinRefaccionFinding()],
      risk: "Completar",
      tires: {},
      minT: null,
    });
    expect(out.hasRefaccion).toBe(false);
  });

  it("false con el texto legacy del monolito (sin 'funcional')", () => {
    const out = normalizaRefaccion({
      findings: [{ cat: "Checklist", text: "Sin llanta de refacción", lv: "Completar" }],
      risk: "Completar",
      tires: {},
      minT: null,
    });
    expect(out.hasRefaccion).toBe(false);
  });

  it("true cuando ningún hallazgo reporta falta de refacción", () => {
    const out = normalizaRefaccion({
      findings: [tacoRefaccion("Revisar")],
      risk: "Revisar",
      tires: { [REFACCION]: 2 },
      minT: null,
    });
    expect(out.hasRefaccion).toBe(true);
  });
});
