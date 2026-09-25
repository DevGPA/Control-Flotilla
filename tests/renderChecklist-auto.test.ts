import { beforeEach, describe, expect, it } from "vitest";
import { renderChecklist } from "../src/ui/detail/renderChecklist";
import type { ChecklistDB, Unit } from "../src/types";

const unit = (over: Partial<Unit> = {}): Unit => ({
  uid: "ABC123__2026-06-02",
  plate: "ABC123",
  fecha: "2026-06-02",
  risk: "OK",
  F: [
    {
      cat: "Checklist",
      key: "Bin:Tapetes completos",
      text: "Tapetes faltantes / incompletos",
      lv: "Completar",
    },
  ],
  T: {},
  minT: null,
  ...over,
});

describe("renderChecklist — leyenda de auto-resueltos", () => {
  beforeEach(() => document.body.replaceChildren());

  it("ítem auto-resuelto muestra la leyenda con fecha de la inspección", () => {
    const c = document.createElement("div");
    const db: ChecklistDB = {
      "ABC123__2026-06-02": {
        "Bin:Tapetes completos": { done: true, ts: "2026-07-06", by: "auto", auto: true },
      },
    };
    renderChecklist(c, { unit: unit(), checklistDB: db });
    expect(c.textContent).toContain("resuelto — inspección 06/07/2026");
  });

  it("marca manual lleva atribución (quién · fecha), NO leyenda de inspección", () => {
    const c = document.createElement("div");
    const db: ChecklistDB = {
      "ABC123__2026-06-02": {
        "Bin:Tapetes completos": { done: true, ts: "2026-07-06T10:00:00Z", by: "navares@gpa" },
      },
    };
    renderChecklist(c, { unit: unit(), checklistDB: db });
    expect(c.textContent).not.toContain("resuelto — inspección");
    // Del correo solo se muestra el usuario (antes de la @).
    expect(c.textContent).toContain("atendido — navares · 06/07/2026");
  });

  it("la fecha del atendido es la LOCAL, no el día UTC (marcado de noche no sale 'mañana')", () => {
    const c = document.createElement("div");
    // 25/09 a las 19:30 hora local; en UTC ya puede ser 26/09.
    const ts = new Date(2026, 8, 25, 19, 30).toISOString();
    const db: ChecklistDB = {
      "ABC123__2026-06-02": {
        "Bin:Tapetes completos": { done: true, ts, by: "tesoreria@gpa.com.mx" },
      },
    };
    renderChecklist(c, { unit: unit(), checklistDB: db });
    expect(c.textContent).toContain("atendido — tesoreria · 25/09/2026");
  });
});
