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
  let i = html.indexOf(`function ${nombre}(`);
  expect(i, `falta ${nombre} en el monolito`).toBeGreaterThan(-1);
  // Las funciones `async` del monolito se recortan CON su `async`, y el recorte termina
  // en la siguiente declaración, sea `function` o `async function`.
  if (html.slice(i - 6, i) === "async ") i -= 6;
  const fines = ["\nfunction ", "\nasync function "]
    .map((m) => html.indexOf(m, i + 16))
    .filter((j) => j > 0);
  return html.slice(i, fines.length ? Math.min(...fines) : undefined);
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

// Revisión 2026-10-02 (Important 3): si el guardado choca con otra pestaña o con el taller
// (la fila real ya no está en el estado que el usuario vio), "Intenta de nuevo" nunca puede
// funcionar con el registro abierto — el poll se pausa con el modal. Hay que traer la
// verdad de la nube, repintar y decirlo. Un fallo de red sigue siendo "Intenta de nuevo".
describe("_bnAutorizar / _bnRechazar — cuando la partida cambió en otro lado", () => {
  type Firma = (...a: unknown[]) => Promise<void>;
  function guardados(guardar: () => Promise<void>) {
    const win = {
      __guardarDecisionPartida: vi.fn(guardar),
      __cloudHydrate: vi.fn(async () => {}),
      notify: vi.fn(),
    };
    const repintar = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- se ejecuta el literal real
    const fabrica = new Function(
      "window",
      "_bnRepintar",
      "console",
      `${literal("_bnAutorizar")}
      ${literal("_bnRechazar")}
      ${literal("_bnTraerVerdad")}
      return { _bnAutorizar, _bnRechazar };`,
    );
    const fns = fabrica(win, repintar, { error: () => {} }) as {
      _bnAutorizar: Firma;
      _bnRechazar: Firma;
    };
    return { win, repintar, ...fns };
  }
  const cambio = (): Error =>
    Object.assign(new Error("La partida cambió en otra pestaña"), { cambio: true });

  it("autorizar choca ⇒ re-hidrata, repinta y dice que cambió (no 'Intenta de nuevo')", async () => {
    const g = guardados(async () => {
      throw cambio();
    });
    const btn = document.createElement("button");
    await g._bnAutorizar(fila, P({ estado: "rechazada" }), btn);
    expect(g.win.__cloudHydrate).toHaveBeenCalledTimes(1);
    expect(g.repintar).toHaveBeenCalledTimes(1);
    const texto = String(g.win.notify.mock.calls.at(-1)?.[0] ?? "");
    expect(texto).toMatch(/cambió/);
    expect(texto).not.toMatch(/Intenta de nuevo/);
  });

  it("retirar choca (el taller ya lo terminó) ⇒ re-hidrata, repinta y lo dice", async () => {
    const g = guardados(async () => {
      throw cambio();
    });
    const btn = document.createElement("button");
    await g._bnRechazar(fila, P({ estado: "autorizada" }), "No es necesario ahora", "", btn);
    expect(g.win.__cloudHydrate).toHaveBeenCalledTimes(1);
    expect(g.repintar).toHaveBeenCalledTimes(1);
    expect(String(g.win.notify.mock.calls.at(-1)?.[0] ?? "")).toMatch(/cambió/);
  });

  it("un fallo de red sigue diciendo 'Intenta de nuevo' y deja el botón tocable", async () => {
    const g = guardados(async () => {
      throw new Error("Network error");
    });
    const btn = document.createElement("button");
    await g._bnAutorizar(fila, P({ estado: "rechazada" }), btn);
    expect(g.win.__cloudHydrate).not.toHaveBeenCalled();
    expect(String(g.win.notify.mock.calls.at(-1)?.[0] ?? "")).toMatch(/Intenta de nuevo/);
    expect(btn.disabled).toBe(false);
  });
});

describe("guardarDecisionPartida — el choque se distingue de un fallo de red", () => {
  it("el error de la guarda trae la marca `cambio: true` que el monolito lee", () => {
    const src = readFileSync(join(raiz, "src", "api", "tallerPartidas.ts"), "utf8");
    const i = src.indexOf("if (actual.estado !== partida.estado)");
    expect(i, "falta la guarda de estado").toBeGreaterThan(-1);
    expect(src.slice(i, i + 600)).toContain("cambio: true");
  });
});
