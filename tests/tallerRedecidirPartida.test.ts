// Cambiar de decisión (Navares, 2026-10-01): un hallazgo del taller ya autorizado o
// rechazado vuelve a ofrecer la acción contraria en el registro mientras la visita siga
// abierta y el taller no lo haya terminado. Se ejecuta el literal REAL del monolito
// (patrón de tests/tallerRegistroFichaMonolito.test.ts) con dobles de lo que ya existe.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Partida } from "../src/taller/partidas";

const raiz = join(__dirname, "..");
const html = readFileSync(join(raiz, "Control de flotilla.html"), "utf8");

const literal = (nombre: string): string => {
  const i = html.indexOf(`function ${nombre}(`);
  expect(i, `falta ${nombre} en el monolito`).toBeGreaterThan(-1);
  const j = html.indexOf("\nfunction ", i + 10);
  return html.slice(i, j > 0 ? j : undefined);
};

const P = (o: Partial<Partida> = {}): Partida => ({
  partidaId: "p1",
  visitaKey: "06|2026-09-26",
  descripcion: "Amortiguador trasero",
  tipo: "refaccion",
  precio: 2400,
  estado: "rechazada",
  fotos: [],
  ...o,
});

type Dobles = {
  _provFilaHistorial: ReturnType<typeof vi.fn>;
  _bnPanelRechazo: ReturnType<typeof vi.fn>;
  _bnAutorizar: ReturnType<typeof vi.fn>;
  _bnPanelVisible: ReturnType<typeof vi.fn>;
};

function armar(): { fn: (fila: unknown, p: Partida) => HTMLElement; d: Dobles } {
  const d: Dobles = {
    _provFilaHistorial: vi.fn(() => {
      const row = document.createElement("div");
      row.className = "hist";
      return row;
    }),
    _bnPanelRechazo: vi.fn(() => {
      const panel = document.createElement("div");
      panel.className = "panel";
      panel.hidden = true;
      return panel;
    }),
    _bnAutorizar: vi.fn(),
    _bnPanelVisible: vi.fn((panel: HTMLElement, visible: boolean) => {
      panel.hidden = !visible;
    }),
  };
  const win = { __MOTIVOS_RECHAZO: ["No es necesario ahora", "Otro"] };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- se ejecuta el literal real
  const fabrica = new Function(
    "window",
    "document",
    "_provFilaHistorial",
    "_bnPanelRechazo",
    "_bnAutorizar",
    "_bnPanelVisible",
    `${literal("_provFilaRedecidir")}
    return _provFilaRedecidir;`,
  );
  const fn = fabrica(
    win,
    document,
    d._provFilaHistorial,
    d._bnPanelRechazo,
    d._bnAutorizar,
    d._bnPanelVisible,
  ) as (fila: unknown, p: Partida) => HTMLElement;
  return { fn, d };
}

const fila = { visitaKey: "06|2026-09-26", proveedor: "Taller X" };
const boton = (el: HTMLElement): HTMLButtonElement | null => el.querySelector("button");

describe("_provFilaRedecidir — la acción contraria sobre una partida ya decidida", () => {
  beforeEach(() => {
    // eslint-disable-next-line no-restricted-syntax -- armado de prueba, literal controlado
    document.body.innerHTML = "";
  });

  it("una RECHAZADA ofrece '✓ Autorizar' y el clic guarda con la misma ruta de la bandeja", () => {
    const { fn, d } = armar();
    const p = P({ estado: "rechazada", motivoRechazo: "No es necesario ahora" });
    const el = fn(fila, p);
    const b = boton(el);
    expect(b?.textContent).toBe("✓ Autorizar");
    expect(b?.disabled).toBe(false);
    expect(b?.className).toContain("needs-write");
    b?.click();
    expect(d._bnAutorizar).toHaveBeenCalledWith(fila, p, b);
    expect(d._bnPanelRechazo).not.toHaveBeenCalled();
  });

  it("una rechazada SIN precio no se puede autorizar (mismo candado R92 de la bandeja)", () => {
    const { fn } = armar();
    const b = boton(fn(fila, P({ estado: "rechazada", precio: undefined })));
    expect(b?.textContent).toBe("✓ Autorizar");
    expect(b?.disabled).toBe(true);
  });

  it("una AUTORIZADA ofrece '✕ Retirar autorización' con el panel de motivos cerrado; el clic lo abre", () => {
    const { fn, d } = armar();
    const p = P({ estado: "autorizada", precioAutorizado: 2400 });
    const el = fn(fila, p);
    const b = boton(el);
    expect(b?.textContent).toBe("✕ Retirar autorización");
    expect(d._bnPanelRechazo).toHaveBeenCalledWith(fila, p, ["No es necesario ahora", "Otro"]);
    const panel = el.querySelector(".panel") as HTMLElement;
    expect(panel.hidden).toBe(true);
    b?.click();
    expect(d._bnPanelVisible).toHaveBeenCalledWith(panel, true);
    expect(panel.hidden).toBe(false);
  });

  it("terminada, propuesta, cancelada y borrador: solo la fila de rastro, sin botón", () => {
    const { fn, d } = armar();
    for (const estado of ["terminada", "propuesta", "cancelada", "borrador"] as const) {
      const el = fn(fila, P({ estado }));
      expect(el.className, estado).toBe("hist");
      expect(boton(el), estado).toBeNull();
    }
    expect(d._bnPanelRechazo).not.toHaveBeenCalled();
  });
});

describe("cableado — el registro usa la fila y el puente de visita cerrada", () => {
  it("_provPartidas pinta con _provFilaRedecidir SOLO si la visita está abierta (fail-closed sin puente)", () => {
    const src = literal("_provPartidas");
    expect(src).toContain("__visitaCerrada");
    expect(src).toContain("_provFilaRedecidir(fila, p)");
    expect(src).toContain(
      'typeof window.__visitaCerrada === "function" && !window.__visitaCerrada(e)',
    );
  });

  it("cloudWire publica __visitaCerrada desde la capa pura y cloudHydrate lo declara", () => {
    const wire = readFileSync(join(raiz, "src", "api", "cloudWire.ts"), "utf8");
    const hydrate = readFileSync(join(raiz, "src", "api", "cloudHydrate.ts"), "utf8");
    expect(wire).toContain("window.__visitaCerrada = visitaCerrada");
    expect(hydrate).toContain("__visitaCerrada?:");
  });
});
