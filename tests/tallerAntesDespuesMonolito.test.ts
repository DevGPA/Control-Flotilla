// Antes y después en el MONOLITO (spec 2026-09-28 §6.2–6.3). Se extraen y EJECUTAN los
// literales reales del HTML (new Function), como tests/tallerBadgePendientesDeFirma.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { avisoSinDespues, type Partida } from "../src/taller/partidas";

const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");
const cuerpo = (nombre: string): string => {
  const i = html.indexOf(`function ${nombre}(`);
  expect(i, `no existe ${nombre}`).toBeGreaterThan(-1);
  return html.slice(i, html.indexOf("\nfunction ", i + 10));
};

const P = (sobre: Partial<Partida> = {}): Partida => ({
  partidaId: "p",
  visitaKey: "vk",
  descripcion: "Balatas delanteras",
  estado: "autorizada",
  tipo: "refaccion",
  fotos: ["a.jpg"],
  precioAutorizado: 1850,
  creadoEn: "2026-09-14T16:00:00.000Z",
  decididoPor: "riesgos@ejemplo.test",
  decididoEn: "2026-09-15T10:00:00.000Z",
  ...sobre,
});

beforeEach(() => {
  // eslint-disable-next-line no-restricted-syntax -- limpieza de prueba, string literal controlado
  document.body.innerHTML = "";
});

/** Ejecuta el `_provFilaHistorial` REAL con dobles de sus ayudantes. */
function filaDe(p: Partida, win: Record<string, unknown> = {}): HTMLElement {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- se ejecuta el literal real
  const fabrica = new Function(
    "window",
    "_bnThumb",
    "_fmtMon2",
    "fmtDate",
    `${cuerpo("_provFilaHistorial")}\nreturn _provFilaHistorial;`,
  );
  const fn = fabrica(
    win,
    () => document.createElement("div"),
    (n: number) => `$${n.toFixed(2)}`,
    (d: unknown) => String(d ?? ""),
  ) as (p: Partida) => HTMLElement;
  return fn(p);
}

describe("_provFilaHistorial — la fila dice qué falta y abre el A+", () => {
  it("refacción autorizada ⇒ 'Sin foto del después'", () => {
    expect(filaDe(P()).textContent).toContain("Sin foto del después");
  });

  it("el chip es ámbar (tl-pill diag, spec §6.3), no el rojo de un rechazo", () => {
    const chip = Array.from(filaDe(P()).querySelectorAll("span")).find(
      (s) => s.textContent === "Sin foto del después",
    );
    expect(chip?.className).toBe("tl-pill diag");
  });

  it("mano de obra autorizada ⇒ sin chip (su foto es opcional)", () => {
    expect(filaDe(P({ tipo: "manoObra" })).textContent).not.toContain("Sin foto del después");
  });

  it("terminada con fotos ⇒ botón 🖼 que abre el A+ con antes, después, fechas y título", () => {
    const abrir = vi.fn();
    const fila = filaDe(
      P({
        estado: "terminada",
        evidenciaFinal: ["d.jpg"],
        terminadoEn: "2026-09-16T15:00:00.000Z",
      }),
      { __abrirVisorAntesDespues: abrir },
    );
    expect(fila.textContent).not.toContain("Sin foto del después");
    const b = Array.from(fila.querySelectorAll("button")).find((x) =>
      (x.textContent ?? "").includes("Antes y después"),
    );
    expect(b).toBeDefined();
    b!.click();
    expect(abrir).toHaveBeenCalledTimes(1);
    const opts = abrir.mock.calls[0]![0];
    expect(opts.antes).toEqual({ llaves: ["a.jpg"], fecha: "2026-09-14T16:00:00.000Z" });
    expect(opts.despues).toEqual({ llaves: ["d.jpg"], fecha: "2026-09-16T15:00:00.000Z" });
    expect(opts.titulo).toBe("Balatas delanteras");
  });

  it("terminada SIN ninguna foto (mano de obra sin foto) ⇒ sin botón (Review Focus 5)", () => {
    const fila = filaDe(
      P({ tipo: "manoObra", estado: "terminada", fotos: [], evidenciaFinal: [] }),
    );
    expect(
      Array.from(fila.querySelectorAll("button")).some((x) =>
        (x.textContent ?? "").includes("Antes y después"),
      ),
    ).toBe(false);
  });

  it.each(["rechazada", "borrador", "propuesta", "cancelada"] as const)(
    "%s ⇒ ni chip ni botón",
    (estado) => {
      const fila = filaDe(P({ estado }));
      expect(fila.textContent).not.toContain("Sin foto del después");
      expect(fila.textContent).not.toContain("Antes y después");
    },
  );

  it("pinta con textContent, nunca innerHTML", () => {
    expect(cuerpo("_provFilaHistorial")).not.toContain(".innerHTML");
  });
});

/** Ejecuta el `finalizarUnidad` REAL hasta su confirm (que se niega: nada se guarda). */
function textoAlFinalizar(ps: Partida[]): string {
  const e = { id: "tl_1", eco: "06", plate: "PRB0006", estado: "En Reparación" };
  const textos: string[] = [];
  const win = {
    __tallerHibrido: true,
    __visitaKeyDe: () => "vk",
    __tallerPartidas: new Map([["vk", ps]]),
    __pendientesDeFirma: () => 0,
    __avisoSinDespues: avisoSinDespues,
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- se ejecutan los literales reales
  const fabrica = new Function(
    "window",
    "tallerEntries",
    "confirm",
    "saveTallerDB",
    `${cuerpo("_partidasDeVisita")}\n${cuerpo("_avisoSinDespues")}\n${cuerpo("finalizarUnidad")}\nreturn finalizarUnidad;`,
  );
  const fn = fabrica(
    win,
    [e],
    (t: string) => {
      textos.push(t);
      return false;
    },
    async () => {},
  ) as (id: string) => void;
  fn("tl_1");
  return textos.join("\n");
}

describe("finalizarUnidad — avisa, no bloquea (decisión 6)", () => {
  it("con una refacción autorizada sin después, el confirm lo dice con su nombre y monto", () => {
    const t = textoAlFinalizar([P()]);
    expect(t).toContain(
      "⚠ 1 refacción autorizada no tiene foto del después: Balatas delanteras ($1,850.00).",
    );
    expect(t).toContain("¿Finalizar el ingreso de Unidad 06?");
  });

  it("sin faltantes, el confirm no menciona el después", () => {
    expect(textoAlFinalizar([P({ estado: "terminada", evidenciaFinal: ["d.jpg"] })])).not.toContain(
      "foto del después",
    );
  });
});

describe("saveTallerEntry — guardar la salida real también avisa (Review Focus 4)", () => {
  const src = cuerpo("saveTallerEntry");
  // La SENTENCIA que escribe, no el texto a secas: un comentario de la lista blanca del
  // `entry` (más arriba en la misma función) cita `tallerEntries[idx]=entry` literalmente.
  const ESCRITURA = "if(idx>=0) tallerEntries[idx]=entry;";

  it("pregunta SOLO cuando el guardado cierra la visita (no tenía salida y ahora sí)", () => {
    expect(src).toContain(
      "const cierraAhora = !!srcEntry && !srcEntry.fsalidaReal && !!entry.fsalidaReal;",
    );
    expect(src).toContain("_avisoSinDespues(srcEntry)");
  });

  it("el aviso va DESPUÉS de la guarda de llave y ANTES de tocar tallerEntries", () => {
    const iLlave = src.indexOf("__llaveEnUso");
    const iAviso = src.indexOf("const cierraAhora");
    const iEscribe = src.indexOf(ESCRITURA);
    expect(iLlave).toBeGreaterThan(-1);
    expect(iAviso).toBeGreaterThan(iLlave);
    expect(iEscribe).toBeGreaterThan(iAviso);
  });

  it("si la persona cancela, no se guarda nada (return antes de escribir)", () => {
    const bloque = src.slice(src.indexOf("const cierraAhora"), src.indexOf(ESCRITURA));
    expect(bloque).toMatch(/!confirm\([\s\S]*?\)\) return;/);
  });
});
