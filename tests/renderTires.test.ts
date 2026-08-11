import { beforeEach, describe, expect, it } from "vitest";
import { renderTires } from "../src/ui/detail/renderTires";
import type { Unit } from "../src/types";

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    uid: "u1",
    risk: "OK",
    F: [],
    T: {},
    minT: null,
    ...overrides,
  };
}

function setupContainer(): HTMLElement {
  document.body.replaceChildren();
  const c = document.createElement("div");
  document.body.appendChild(c);
  return c;
}

describe("renderTires", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("empty state: sin mediciones y con refacción → mensaje", () => {
    const c = setupContainer();
    renderTires(c, { unit: makeUnit({ T: {}, hasRefaccion: true }) });
    expect(c.textContent).toContain("Sin datos de llantas");
    expect(c.querySelector(".trr")).toBeNull();
  });

  it("empty state NO aparece si hay refacción=false (muestra row 'Sin refacción')", () => {
    const c = setupContainer();
    renderTires(c, { unit: makeUnit({ T: {}, hasRefaccion: false }) });
    expect(c.querySelector(".trr")).not.toBeNull();
    expect(c.textContent).toContain("Sin refacción");
  });

  it("renderiza fila por cada llanta", () => {
    const c = setupContainer();
    const u = makeUnit({
      T: { "Piloto Del.": 8, "Copiloto Del.": 7, "Piloto Tras.": 5 },
      minT: 5,
    });
    renderTires(c, { unit: u });
    const rows = c.querySelectorAll(".trr");
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it("colorea CRÍTICO para valores ≤TCRIT (3.99)", () => {
    const c = setupContainer();
    renderTires(c, { unit: makeUnit({ T: { Piloto: 3 }, minT: 3 }) });
    const status = c.querySelector(".trrst") as HTMLElement;
    expect(status.textContent).toBe("CRÍTICO");
    expect(status.style.color).toBe("var(--R)");
  });

  it("colorea Vigilar (ambar) para valores entre TCRIT y TWARN", () => {
    const c = setupContainer();
    renderTires(c, { unit: makeUnit({ T: { Piloto: 5 }, minT: 5 }) });
    const status = c.querySelector(".trrst") as HTMLElement;
    expect(status.textContent).toBe("Vigilar");
    expect(status.style.color).toBe("var(--A)");
  });

  it("colorea OK (verde) para valores > TWARN (6.99)", () => {
    const c = setupContainer();
    renderTires(c, { unit: makeUnit({ T: { Piloto: 8 }, minT: 8 }) });
    const status = c.querySelector(".trrst") as HTMLElement;
    expect(status.textContent).toBe("OK");
    expect(status.style.color).toBe("var(--G)");
  });

  it("barra fill refleja porcentaje (v/10*100, capped a 100)", () => {
    const c = setupContainer();
    renderTires(c, { unit: makeUnit({ T: { a: 5 }, minT: 5 }) });
    const fill = c.querySelector(".trrfill") as HTMLElement;
    expect(fill.style.width).toBe("50%");
  });

  it("valor mm se muestra en el label", () => {
    const c = setupContainer();
    renderTires(c, { unit: makeUnit({ T: { "Piloto Del.": 8.5 }, minT: 8.5 }) });
    const val = c.querySelector(".trrv") as HTMLElement;
    expect(val.textContent).toBe("8.5mm");
  });

  it("alert box: 'Reemplazo urgente' cuando minT ≤ TCRIT", () => {
    const c = setupContainer();
    renderTires(c, { unit: makeUnit({ T: { x: 3 }, minT: 3 }) });
    const alert = c.querySelector(".talert");
    expect(alert?.textContent).toContain("Reemplazo urgente");
    expect(alert?.textContent).toContain("3mm");
  });

  it("alert box: 'Buen estado' cuando minT > TWARN", () => {
    const c = setupContainer();
    renderTires(c, { unit: makeUnit({ T: { x: 9 }, minT: 9 }) });
    expect(c.querySelector(".talert")?.textContent).toContain("Buen estado");
  });

  // La refacción ya no entra al minT (decisión Navares 2026-08-11). El recuadro lo dice
  // para que no parezca contradictorio junto a una fila de refacción en rojo.
  it("alert box aclara que el mínimo es de llantas en circulación", () => {
    const c = setupContainer();
    renderTires(c, { unit: makeUnit({ T: { "Piloto Delantera": 8, Refacción: 2 }, minT: 8 }) });
    expect(c.querySelector(".talert")?.textContent).toContain("en circulación");
  });

  it("referencia siempre se renderiza", () => {
    const c = setupContainer();
    renderTires(c, { unit: makeUnit({ T: { x: 8 }, minT: 8 }) });
    const ref = c.querySelector(".tref");
    expect(ref?.textContent).toContain("Referencia:");
    expect(ref?.textContent).toContain("≥7mm OK");
    expect(ref?.textContent).toContain("4–6mm revisar");
    expect(ref?.textContent).toContain("≤3.99mm urgente");
  });

  it("umbrales custom respetados", () => {
    const c = setupContainer();
    renderTires(c, { unit: makeUnit({ T: { x: 8 }, minT: 8 }), tcrit: 5, twarn: 10 });
    const status = c.querySelector(".trrst") as HTMLElement;
    expect(status.textContent).toBe("Vigilar"); // 5 < 8 ≤ 10 → ámbar
  });

  it("input hostil en name de llanta → textContent safe", () => {
    const c = setupContainer();
    renderTires(c, { unit: makeUnit({ T: { "<script>evil</script>": 8 }, minT: 8 }) });
    expect(c.querySelector("script")).toBeNull();
    expect(c.querySelector(".trn")?.textContent).toContain("<script>");
  });

  it("minT null → alertBox NO se renderiza pero referencia sí", () => {
    const c = setupContainer();
    renderTires(c, { unit: makeUnit({ T: {}, hasRefaccion: false, minT: null }) });
    expect(c.querySelector(".talert")).toBeNull();
    expect(c.querySelector(".tref")).not.toBeNull();
  });

  it("re-render reemplaza contenido", () => {
    const c = setupContainer();
    renderTires(c, { unit: makeUnit({ T: { a: 8 }, minT: 8 }) });
    expect(c.querySelectorAll(".trr")).toHaveLength(1);
    renderTires(c, { unit: makeUnit({ T: {}, hasRefaccion: true }) });
    expect(c.querySelectorAll(".trr")).toHaveLength(0);
  });
});
