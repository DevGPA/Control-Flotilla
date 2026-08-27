import { describe, it, expect, vi } from "vitest";
import { renderEvolucion } from "../src/ui/detail/renderEvolucion";
import type { EvolRow } from "../src/inspecciones/evolucionUnidad";

const mkRow = (overrides: Partial<EvolRow> = {}): EvolRow => ({
  uid: "ABC123__2026-08-15",
  fecha: "2026-08-15",
  label: "Ago 2026 · día 15",
  risk: "OK",
  pendUrg: 0,
  pendRev: 0,
  pendComp: 0,
  totF: 0,
  deltaPend: null,
  minT: null,
  ...overrides,
});

function mount(): HTMLElement {
  document.body.replaceChildren();
  const c = document.createElement("div");
  document.body.appendChild(c);
  return c;
}

describe("renderEvolucion", () => {
  it("pinta N filas en el orden recibido con el CSS del timeline", () => {
    const c = mount();
    renderEvolucion(c, {
      rows: [
        mkRow({ uid: "u3", label: "Ago 2026 · día 15" }),
        mkRow({ uid: "u2", label: "Jul 2026 · día 10" }),
        mkRow({ uid: "u1", label: "Jun 2026 · día 5" }),
      ],
      selUid: "u3",
    });
    const filas = c.querySelectorAll(".evol-timeline .evol-row");
    expect(filas).toHaveLength(3);
    expect(filas[0]!.textContent).toContain("Ago 2026");
  });

  it("la fila abierta lleva .evol-active + badge ABIERTA y NO salta", () => {
    const c = mount();
    const spy = vi.fn();
    renderEvolucion(c, { rows: [mkRow({ uid: "u1" })], selUid: "u1", onJump: spy });
    const activa = c.querySelector(".evol-row.evol-active") as HTMLElement;
    expect(activa).toBeTruthy();
    expect(activa.querySelector(".evol-now")!.textContent).toBe("ABIERTA");
    activa.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it("click y Enter en fila NO activa llaman onJump con el uid", () => {
    const c = mount();
    const spy = vi.fn();
    renderEvolucion(c, {
      rows: [mkRow({ uid: "actual" }), mkRow({ uid: "vieja", label: "Jul 2026 · día 1" })],
      selUid: "actual",
      onJump: spy,
    });
    const vieja = c.querySelectorAll(".evol-row")[1] as HTMLElement;
    vieja.click();
    expect(spy).toHaveBeenCalledExactlyOnceWith("vieja");
    vieja.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(vieja.getAttribute("role")).toBe("button");
  });

  it("delta: ▲ empeoró (rojo), ▼ mejoró (verde), = igual", () => {
    const c = mount();
    renderEvolucion(c, {
      rows: [
        mkRow({ uid: "a", deltaPend: 2 }),
        mkRow({ uid: "b", deltaPend: -3 }),
        mkRow({ uid: "c", deltaPend: 0 }),
      ],
      selUid: null,
    });
    const deltas = [...c.querySelectorAll(".evol-delta")].map((d) => d.textContent);
    expect(deltas[0]).toContain("▲ +2");
    expect(deltas[1]).toContain("▼ -3");
    expect(deltas[2]).toContain("=");
  });

  it("pendientes por severidad y contexto (llanta/km/inspector)", () => {
    const c = mount();
    renderEvolucion(c, {
      rows: [
        mkRow({ pendUrg: 2, pendRev: 1, minT: 3, km: 82000, insp: "PEREZ JUAN" }),
        mkRow({ uid: "u2", totF: 4 }),
      ],
      selUid: null,
    });
    expect(c.textContent).toContain("2 urgentes · 1 a revisar");
    expect(c.textContent).toContain("llanta mín 3mm · 82000 km · PEREZ JUAN");
    expect(c.textContent).toContain("Sin pendientes (4 hallazgos atendidos)");
  });

  it("XSS: inspector malicioso no inyecta HTML", () => {
    const c = mount();
    renderEvolucion(c, {
      rows: [mkRow({ insp: '<img src=x onerror="x">' })],
      selUid: null,
    });
    expect(c.querySelector("img")).toBeFalsy();
  });

  it("sin filas → .evol-empty y reemplaza contenido previo", () => {
    const c = mount();
    c.appendChild(document.createElement("table"));
    renderEvolucion(c, { rows: [], selUid: null });
    expect(c.querySelector("table")).toBeFalsy();
    expect(c.querySelector(".evol-empty")!.textContent).toContain("Sin inspecciones");
  });
});
