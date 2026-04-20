import { describe, expect, it, vi } from "vitest";
import {
  buildKpisSemanales,
  renderKpisSemanales,
} from "../src/weekly/renderKpisSemanales";
import type { WeeklyPeriodo } from "../src/weekly/weeklyStore";
import type { WeeklyEntry } from "../src/types";

function mk(overrides: Partial<WeeklyEntry> = {}): WeeklyEntry {
  return {
    uid: "u1",
    eco: "A-100",
    aceiteRisk: "OK",
    radiadorRisk: "OK",
    carroceriaRisk: "OK",
    llantaRisk: "OK",
    ...overrides,
  };
}

function per(entries: WeeklyEntry[], label = "2026-W16"): WeeklyPeriodo {
  return { id: "p1", label, entries };
}

function setup(): HTMLElement {
  document.body.replaceChildren();
  const c = document.createElement("div");
  document.body.appendChild(c);
  return c;
}

// ═══════════════════════════════════════════════════════════════
//  buildKpisSemanales
// ═══════════════════════════════════════════════════════════════

describe("buildKpisSemanales", () => {
  it("sin periodo → null", () => {
    expect(buildKpisSemanales(undefined)).toBeNull();
  });

  it("cuenta Urgente/Revisar/OK por risk efectivo (vitales)", () => {
    const k = buildKpisSemanales(
      per([
        mk({ aceiteRisk: "Urgente" }),
        mk({ radiadorRisk: "Revisar" }),
        mk(),
      ]),
    )!;
    expect(k.total).toBe(3);
    expect(k.urgente).toBe(1);
    expect(k.revisar).toBe(1);
    expect(k.ok).toBe(1);
  });

  it("cuenta carroceria/llanta separadamente", () => {
    const k = buildKpisSemanales(
      per([
        mk({ carroceriaRisk: "Urgente" }),
        mk({ carroceriaRisk: "Revisar" }),
        mk({ llantaRisk: "Revisar" }),
      ]),
    )!;
    expect(k.carroceriaUrgente).toBe(1);
    expect(k.carroceriaRevisar).toBe(1);
    expect(k.llantaRevisar).toBe(1);
  });

  it("incluye label del periodo", () => {
    const k = buildKpisSemanales(per([mk()], "2026-W20"))!;
    expect(k.label).toBe("2026-W20");
  });
});

// ═══════════════════════════════════════════════════════════════
//  renderKpisSemanales (DOM)
// ═══════════════════════════════════════════════════════════════

describe("renderKpisSemanales", () => {
  it("sin periodo → container vacío y retorna null", () => {
    const c = setup();
    c.textContent = "STALE";
    const out = renderKpisSemanales({ container: c, periodo: undefined, onFilter: vi.fn() });
    expect(out).toBeNull();
    expect(c.textContent).toBe("");
  });

  it("renderiza 8 tarjetas", () => {
    const c = setup();
    renderKpisSemanales({ container: c, periodo: per([mk()]), onFilter: vi.fn() });
    expect(c.querySelectorAll(".kpi-row > .kc").length).toBe(8);
  });

  it("primeras 6 cards tienen onClick (btn class)", () => {
    const c = setup();
    renderKpisSemanales({ container: c, periodo: per([mk()]), onFilter: vi.fn() });
    const cards = c.querySelectorAll(".kpi-row > .kc");
    for (let i = 0; i < 6; i++) {
      expect(cards[i]!.classList.contains("btn")).toBe(true);
    }
    expect(cards[6]!.classList.contains("btn")).toBe(false);
    expect(cards[7]!.classList.contains("btn")).toBe(false);
  });

  it("click cards disparan onFilter con bucket correcto", () => {
    const c = setup();
    const onFilter = vi.fn();
    renderKpisSemanales({ container: c, periodo: per([mk()]), onFilter });
    const cards = c.querySelectorAll<HTMLElement>(".kpi-row > .kc");
    cards[0]!.click();
    cards[1]!.click();
    cards[2]!.click();
    cards[3]!.click();
    cards[4]!.click();
    cards[5]!.click();
    expect(onFilter).toHaveBeenNthCalledWith(1, "all");
    expect(onFilter).toHaveBeenNthCalledWith(2, "Urgente");
    expect(onFilter).toHaveBeenNthCalledWith(3, "Revisar");
    expect(onFilter).toHaveBeenNthCalledWith(4, "all");
    expect(onFilter).toHaveBeenNthCalledWith(5, "carroceria");
    expect(onFilter).toHaveBeenNthCalledWith(6, "llanta");
  });

  it("valores de cards reflejan contadores", () => {
    const c = setup();
    renderKpisSemanales({
      container: c,
      periodo: per([
        mk({ aceiteRisk: "Urgente" }),
        mk({ radiadorRisk: "Revisar" }),
        mk(),
      ]),
      onFilter: vi.fn(),
    });
    const cards = c.querySelectorAll(".kpi-row > .kc");
    expect(cards[0]!.querySelector(".kval")?.textContent).toBe("3");
    expect(cards[1]!.querySelector(".kval")?.textContent).toBe("1");
    expect(cards[2]!.querySelector(".kval")?.textContent).toBe("1");
    expect(cards[3]!.querySelector(".kval")?.textContent).toBe("2");
  });

  it("carrocería muestra 'Sin daños' cuando 0", () => {
    const c = setup();
    renderKpisSemanales({ container: c, periodo: per([mk()]), onFilter: vi.fn() });
    const cards = c.querySelectorAll(".kpi-row > .kc");
    expect(cards[4]!.querySelector(".ksub")?.textContent).toContain("Sin daños");
  });

  it("llanta muestra 'Todas funcionales' cuando 0 Revisar", () => {
    const c = setup();
    renderKpisSemanales({ container: c, periodo: per([mk()]), onFilter: vi.fn() });
    const cards = c.querySelectorAll(".kpi-row > .kc");
    expect(cards[5]!.querySelector(".ksub")?.textContent).toContain("Todas funcionales");
  });

  it("XSS safe — label con HTML no ejecuta", () => {
    const c = setup();
    renderKpisSemanales({
      container: c,
      periodo: per([mk()], "<img onerror=x>"),
      onFilter: vi.fn(),
    });
    expect(c.querySelector("img")).toBeFalsy();
    expect(c.textContent).toContain("<img onerror=x>");
  });

  it("reemplaza contenido previo", () => {
    const c = setup();
    c.innerHTML = "<span>STALE</span>";
    renderKpisSemanales({ container: c, periodo: per([mk()]), onFilter: vi.fn() });
    expect(c.textContent).not.toContain("STALE");
  });
});
