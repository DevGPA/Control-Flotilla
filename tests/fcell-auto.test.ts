import { describe, expect, it } from "vitest";
import { fcell } from "../src/ui/renderTable";
import type { ChecklistDB, Unit } from "../src/types";

const unit = (over: Partial<Unit> = {}): Unit => ({
  uid: "ABC123__2026-06-02",
  plate: "ABC123",
  fecha: "2026-06-02",
  risk: "OK",
  F: [],
  T: {},
  minT: null,
  ...over,
});

const F = [
  {
    cat: "Fluidos" as const,
    key: "Fluido:Nivel de aceite de motor max",
    text: "aceite BAJO",
    lv: "Urgente" as const,
  },
  {
    cat: "Checklist" as const,
    key: "Bin:Tapetes completos",
    text: "Tapetes faltantes",
    lv: "Completar" as const,
  },
];

describe("fcell — línea de auto-resueltos", () => {
  it("cuenta autos tachados con la fecha INLINE (visible en móvil) y descuenta pendientes", () => {
    const db: ChecklistDB = {
      "ABC123__2026-06-02": {
        "Fluido:Nivel de aceite de motor max": {
          done: true,
          ts: "2026-07-06",
          by: "auto",
          auto: true,
        },
      },
    };
    const el = fcell(unit({ F }), db);
    expect(el.textContent).toContain("1 resuelto · 06/07/2026");
    expect(el.textContent).toContain("1 completar");
    expect(el.textContent).not.toContain("urgente");
  });

  it("marca manual NO aparece como resuelto tachado (desaparece, como hoy)", () => {
    const db: ChecklistDB = {
      "ABC123__2026-06-02": {
        "Fluido:Nivel de aceite de motor max": {
          done: true,
          ts: "2026-07-06T10:00:00Z",
          by: "navares@gpa",
        },
      },
    };
    const el = fcell(unit({ F }), db);
    expect(el.textContent).not.toContain("resuelto");
    expect(el.textContent).toContain("1 completar");
  });

  it("todo auto-resuelto y nada pendiente → muestra solo la línea tachada", () => {
    const db: ChecklistDB = {
      "ABC123__2026-06-02": {
        "Fluido:Nivel de aceite de motor max": {
          done: true,
          ts: "2026-07-06",
          by: "auto",
          auto: true,
        },
        "Bin:Tapetes completos": { done: true, ts: "2026-07-06", by: "auto", auto: true },
      },
    };
    const el = fcell(unit({ F }), db);
    expect(el.textContent).toContain("2 resueltos");
    expect(el.textContent).not.toContain("Ninguno");
  });

  it("sin hallazgos ni autos → 'Ninguno' como siempre", () => {
    expect(fcell(unit(), {}).textContent).toBe("Ninguno");
  });
});
