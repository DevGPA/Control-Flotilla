import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  presetRange,
  wirePeriodoPresets,
  PRESETS,
  hoyLocalISO,
} from "../src/inspecciones/periodoPresets";

describe("presetRange", () => {
  const HOY = "2026-08-26";

  it("este mes: del 1º a hoy", () => {
    expect(presetRange("mes", HOY)).toEqual({ desde: "2026-08-01", hasta: "2026-08-26" });
  });

  it("mes anterior: mes calendario completo", () => {
    expect(presetRange("mesAnterior", HOY)).toEqual({
      desde: "2026-07-01",
      hasta: "2026-07-31",
    });
  });

  it("mes anterior cruzando año: enero → diciembre del año previo", () => {
    expect(presetRange("mesAnterior", "2026-01-15")).toEqual({
      desde: "2025-12-01",
      hasta: "2025-12-31",
    });
  });

  it("mes anterior con febrero bisiesto y no bisiesto", () => {
    expect(presetRange("mesAnterior", "2028-03-10")).toEqual({
      desde: "2028-02-01",
      hasta: "2028-02-29",
    });
    expect(presetRange("mesAnterior", "2027-03-10")).toEqual({
      desde: "2027-02-01",
      hasta: "2027-02-28",
    });
  });

  it("trimestre calendario en curso (Q3 en agosto)", () => {
    expect(presetRange("trimestre", HOY)).toEqual({ desde: "2026-07-01", hasta: HOY });
  });

  it("trimestre en el borde: primer día del trimestre", () => {
    expect(presetRange("trimestre", "2026-07-01")).toEqual({
      desde: "2026-07-01",
      hasta: "2026-07-01",
    });
    expect(presetRange("trimestre", "2026-01-05")).toEqual({
      desde: "2026-01-01",
      hasta: "2026-01-05",
    });
    expect(presetRange("trimestre", "2026-12-31")).toEqual({
      desde: "2026-10-01",
      hasta: "2026-12-31",
    });
  });

  it("año: YTD", () => {
    expect(presetRange("anio", HOY)).toEqual({ desde: "2026-01-01", hasta: HOY });
  });

  it("hoyISO inválido lanza", () => {
    expect(() => presetRange("mes", "26/08/2026")).toThrow();
  });
});

describe("hoyLocalISO", () => {
  it("devuelve YYYY-MM-DD", () => {
    expect(hoyLocalISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("wirePeriodoPresets", () => {
  function setup(): { bar: HTMLElement; desde: HTMLInputElement; hasta: HTMLInputElement } {
    document.body.replaceChildren();
    const bar = document.createElement("div");
    bar.id = "periodo-bar";
    const desde = document.createElement("input");
    desde.type = "date";
    desde.id = "rango-desde";
    const hasta = document.createElement("input");
    hasta.type = "date";
    hasta.id = "rango-hasta";
    const btn = document.createElement("button");
    btn.id = "btn-rango";
    bar.append(desde, hasta, btn);
    document.body.appendChild(bar);
    return { bar, desde, hasta };
  }

  beforeEach(() => {
    delete (window as { aplicarRango?: unknown }).aplicarRango;
  });

  it("inyecta los 4 botones tras #btn-rango", () => {
    const { bar } = setup();
    wirePeriodoPresets();
    const grupo = bar.querySelector(".rango-presets");
    expect(grupo).toBeTruthy();
    const botones = grupo!.querySelectorAll("button.rp-btn");
    expect(botones).toHaveLength(PRESETS.length);
    expect(botones[0]!.textContent).toBe("Este mes");
    // Va inmediatamente después del botón Aplicar
    expect(document.getElementById("btn-rango")!.nextElementSibling).toBe(grupo);
  });

  it("click en un preset setea los inputs y llama window.aplicarRango", () => {
    const { desde, hasta } = setup();
    const spy = vi.fn();
    window.aplicarRango = spy;
    wirePeriodoPresets();
    const btn = document.querySelector(".rp-btn") as HTMLButtonElement; // "Este mes"
    btn.click();
    expect(desde.value).toMatch(/^\d{4}-\d{2}-01$/);
    expect(hasta.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(spy).toHaveBeenCalledOnce();
    expect(btn.classList.contains("active")).toBe(true);
  });

  it("el preset activo es exclusivo y aplicar a mano lo limpia", () => {
    setup();
    window.aplicarRango = vi.fn();
    wirePeriodoPresets();
    const botones = document.querySelectorAll<HTMLButtonElement>(".rp-btn");
    botones[0]!.click();
    botones[2]!.click();
    expect(document.querySelectorAll(".rp-btn.active")).toHaveLength(1);
    expect(botones[2]!.classList.contains("active")).toBe(true);
    // Aplicar el rango a mano limpia el activo
    (document.getElementById("btn-rango") as HTMLButtonElement).click();
    expect(document.querySelectorAll(".rp-btn.active")).toHaveLength(0);
  });

  it("doble wire no duplica botones", () => {
    setup();
    wirePeriodoPresets();
    wirePeriodoPresets();
    expect(document.querySelectorAll(".rp-btn")).toHaveLength(PRESETS.length);
  });

  it("sin #periodo-bar no truena (no-op)", () => {
    document.body.replaceChildren();
    expect(() => wirePeriodoPresets()).not.toThrow();
  });

  it("sin window.aplicarRango no truena (solo setea inputs)", () => {
    const { desde } = setup();
    wirePeriodoPresets();
    (document.querySelector(".rp-btn") as HTMLButtonElement).click();
    expect(desde.value).not.toBe("");
  });
});
