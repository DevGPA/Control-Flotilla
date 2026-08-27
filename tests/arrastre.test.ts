import { describe, it, expect } from "vitest";
import { buildArrastre } from "../src/inspecciones/arrastre";
import { renderChecklist } from "../src/ui/detail/renderChecklist";
import type { Unit, Finding } from "../src/types";

const f = (key: string, text: string, lv: Finding["lv"] = "Revisar"): Finding =>
  ({ key, text, lv, cat: "Checklist" }) as Finding;

const insp = (fecha: string, F: Finding[], overrides: Partial<Unit> = {}): Unit => ({
  uid: `ABC123__${fecha}`,
  plate: "ABC123",
  fecha,
  risk: "OK",
  F,
  T: {},
  minT: null,
  ...overrides,
});

const TAPETES = f("Bin:Tapetes completos", "Tapetes faltantes");
const ACEITE = f("Fluido:Nivel de aceite de motor max", "aceite BAJO");

describe("buildArrastre", () => {
  it("cadena consecutiva de 3 inspecciones → desde la más antigua de la cadena", () => {
    const historia = [
      insp("2026-06-05", [TAPETES]),
      insp("2026-07-10", [TAPETES, ACEITE]),
      insp("2026-08-15", [TAPETES, ACEITE]),
    ];
    const arr = buildArrastre(historia, "ABC123", "ABC123__2026-08-15");
    expect(arr.get("Bin:Tapetes completos")).toEqual({
      desdeYm: "2026-06",
      desdeLabel: "Jun 2026",
      veces: 3,
    });
    expect(arr.get("Fluido:Nivel de aceite de motor max")).toMatchObject({
      desdeYm: "2026-07",
      veces: 2,
    });
  });

  it("la cadena se ROMPE si una inspección intermedia no lo reporta", () => {
    const historia = [
      insp("2026-05-05", [TAPETES]),
      insp("2026-06-05", []), // no reportado → rompe
      insp("2026-07-05", [TAPETES]),
      insp("2026-08-05", [TAPETES]),
    ];
    const arr = buildArrastre(historia, "ABC123", "ABC123__2026-08-05");
    expect(arr.get("Bin:Tapetes completos")).toMatchObject({ desdeYm: "2026-07", veces: 2 });
  });

  it("una sola aparición NO es arrastre (sin entrada)", () => {
    const historia = [insp("2026-07-05", []), insp("2026-08-05", [TAPETES])];
    const arr = buildArrastre(historia, "ABC123", "ABC123__2026-08-05");
    expect(arr.has("Bin:Tapetes completos")).toBe(false);
  });

  it("ancla en una fila VIEJA: la cadena termina ahí (no mira hacia adelante)", () => {
    const historia = [
      insp("2026-06-05", [TAPETES]),
      insp("2026-07-05", [TAPETES]),
      insp("2026-08-05", [TAPETES]),
    ];
    const arr = buildArrastre(historia, "ABC123", "ABC123__2026-07-05");
    expect(arr.get("Bin:Tapetes completos")).toMatchObject({ desdeYm: "2026-06", veces: 2 });
  });

  it("pre-C1 sin key (texto con valores embebidos) no encadena entre meses", () => {
    const historia = [
      insp("2026-07-05", [{ text: "Piloto Delantera: 4mm — desgaste", lv: "Revisar" } as Finding]),
      insp("2026-08-05", [{ text: "Piloto Delantera: 3mm — desgaste", lv: "Revisar" } as Finding]),
    ];
    const arr = buildArrastre(historia, "ABC123", "ABC123__2026-08-05");
    expect(arr.size).toBe(0);
  });

  it("solo cuenta inspecciones de la misma placa; uid inexistente o placa vacía → vacío", () => {
    const historia = [
      insp("2026-07-05", [TAPETES]),
      insp("2026-08-05", [TAPETES]),
      insp("2026-07-20", [TAPETES], { uid: "XYZ__2026-07-20", plate: "XYZ999" }),
    ];
    expect(
      buildArrastre(historia, "ABC123", "ABC123__2026-08-05").get("Bin:Tapetes completos"),
    ).toMatchObject({ veces: 2 });
    expect(buildArrastre(historia, "ABC123", "no-existe").size).toBe(0);
    expect(buildArrastre(historia, "", "ABC123__2026-08-05").size).toBe(0);
  });

  it("filas sin fecha parseable quedan fuera de la secuencia", () => {
    const historia = [
      insp("", [TAPETES], { uid: "ABC123__x" }),
      insp("2026-07-05", [TAPETES]),
      insp("2026-08-05", [TAPETES]),
    ];
    const arr = buildArrastre(historia, "ABC123", "ABC123__2026-08-05");
    expect(arr.get("Bin:Tapetes completos")).toMatchObject({ desdeYm: "2026-07", veces: 2 });
  });
});

describe("renderChecklist — chip de arrastre (módulo espejo)", () => {
  function mount(): HTMLElement {
    document.body.replaceChildren();
    const c = document.createElement("div");
    document.body.appendChild(c);
    return c;
  }

  it("pendiente con arrastre lleva el chip; atendido no", () => {
    const c = mount();
    const u = insp("2026-08-15", [TAPETES, ACEITE]);
    const arrastre = new Map([
      ["Bin:Tapetes completos", { desdeYm: "2026-06", desdeLabel: "Jun 2026", veces: 3 }],
    ]);
    renderChecklist(c, {
      unit: u,
      checklistDB: {
        [u.uid]: {
          "Fluido:Nivel de aceite de motor max": { done: true, ts: "2026-08-16T10:00:00Z" },
        },
      },
      arrastre,
    });
    const chips = c.querySelectorAll(".ck-arrastre");
    expect(chips).toHaveLength(1);
    expect(chips[0]!.textContent).toBe("⏳ desde Jun 2026");
    expect(chips[0]!.getAttribute("title")).toContain("3 inspecciones");
  });

  it("sin dep arrastre no truena ni pinta chips", () => {
    const c = mount();
    renderChecklist(c, { unit: insp("2026-08-15", [TAPETES]) });
    expect(c.querySelectorAll(".ck-arrastre")).toHaveLength(0);
  });

  it("XSS: desdeLabel malicioso no inyecta", () => {
    const c = mount();
    const arrastre = new Map([
      ["Bin:Tapetes completos", { desdeYm: "", desdeLabel: "<img src=x>", veces: 2 }],
    ]);
    renderChecklist(c, { unit: insp("2026-08-15", [TAPETES]), arrastre });
    expect(c.querySelector("img")).toBeFalsy();
  });
});
