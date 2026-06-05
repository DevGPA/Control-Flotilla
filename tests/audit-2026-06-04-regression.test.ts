// Tests de regresión de la auditoría 2026-06-04 — FASE A (fixes de legacy puro).
// Ver audit/AUDITORIA-2026-06-04-detalle.md. Cada test FALLA con el código previo
// al fix y PASA con el fix aplicado.
//
// COBERTURA: de los 4 P1 de Fase A, solo normFluidRisk tiene un gemelo testeable en
// src/analyzer/risk.ts (mismo bug que la copia inline del monolito legacy, corregida
// en paralelo). Los otros 3 viven SOLO en `Control de flotilla.html` (export jsPDF /
// XLSX / filtro de rango semanal) y se verifican vía E2E (pdf-regression.spec.ts,
// kpi-taller.spec.ts, specs semanales) + prueba manual offline con ?e2e=1:
//   • exportFleetPDF — faltaba C.O en la paleta → setTextColor(undefined) abortaba el PDF.
//   • getSwEntriesInRange — comparaba e.fecha (DMY) contra el rango ISO → vaciaba la vista.
//   • exportTallerActivasExcel — Gasto Total sin fallback a e.gasto → siempre $0.

import { describe, expect, it } from "vitest";
import { normFluidRisk } from "../src/analyzer/risk";

describe("audit 2026-06-04 · normFluidRisk — 'sin fuga' / 'no hay fuga' NO son Urgente", () => {
  it.each([
    "sin fuga",
    "Sin fuga",
    "no hay fuga",
    "No hay fuga de aceite", // contiene "no hay fuga"
    "no presenta fuga", // contiene "no presenta"
  ])("'%s' → OK (antes del fix: Urgente por el match suelto de 'fuga')", (input) => {
    expect(normFluidRisk(input)).toBe("OK");
  });

  it.each(["fuga", "fuga de aceite", "fuga detectada", "Fuga en radiador"])(
    "'%s' → Urgente (una fuga real sigue siendo inmovilizante)",
    (input) => {
      expect(normFluidRisk(input)).toBe("Urgente");
    },
  );

  it("no rompe los casos nominales existentes", () => {
    expect(normFluidRisk("Nivel óptimo")).toBe("OK");
    expect(normFluidRisk("nivel bajo")).toBe("Revisar");
    expect(normFluidRisk("vacío")).toBe("Urgente");
    expect(normFluidRisk("sin aceite")).toBe("Urgente");
    expect(normFluidRisk("")).toBe("OK");
  });
});
