// tests/tallerBadgePendientesDeFirma.test.ts
//
// Fix ronda 2 (Task 7, Finding 1): el badge de la pestaña Taller (dentro de
// renderTaller(), en el monolito Control de flotilla.html) debe CONSUMIR
// pendientesDeFirma (publicada como window.__pendientesDeFirma por
// cloudHydrate.ts) en vez de reimplementar el filtro "estado === propuesta"
// a mano. Ese código vive en un <script> inline de 10k líneas, sin módulo TS
// equivalente — mismo enfoque que tests/sortInspecciones.test.ts: se
// extrae y EJECUTA el literal real del HTML (new Function), no una copia
// reescrita a mano que podría divergir en silencio del código que corre.
//
// Fix ronda 1 de Task 8 (Important 3): el badge sumaba TODO
// window.__tallerPartidas sin candado de sucursal, mientras la bandeja de
// firmas (que sí escopa con scopeBySucursal) mostraba menos filas — un
// usuario fijado a una sucursal veía "5" en el badge y 3 (o 0) en la bandeja.
// Ahora _pend recorre scopeBySucursal(tallerEntries), resuelve la visitaKey
// de cada entry con window.__visitaKeyDe (nunca un match hand-rolled) y
// suma __pendientesDeFirma de esa visita — el mismo universo de visitas que
// usa la bandeja.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");

/** El bloque del badge vive entre la apertura de renderTaller() y el guard de
 *  vista que la sigue — ambos textos son únicos en el archivo. */
function bloqueBadgeDeRenderTaller(): string {
  const m =
    /function renderTaller\(\)\{([\s\S]*?)if\(document\.body\.dataset\.view!=="taller"\) return;/.exec(
      html,
    );
  if (!m) throw new Error("No se encontró el bloque del badge en renderTaller()");
  return m[1]!;
}

type Entry = { id: string; sucursal?: string };

/** Ejecuta la expresión REAL que calcula `_pend`, con un `window` de prueba. */
function calcPend(win: {
  __tallerPartidas?: Map<string, unknown[]>;
  __pendientesDeFirma?: (ps: unknown[]) => number;
  __visitaKeyDe?: (e: Entry) => string;
  tallerEntries?: Entry[];
  scopeBySucursal?: (arr: Entry[]) => Entry[];
}): number {
  const bloque = bloqueBadgeDeRenderTaller();
  const m = /const _pend = ([\s\S]*?, 0\);)/.exec(bloque);
  if (!m) throw new Error("No se encontró la expresión de _pend dentro de renderTaller()");
  // window.scopeBySucursal/tallerEntries son globales legacy: por defecto un
  // passthrough (sin usuario fijado a sucursal) si el test no los pisa.
  const w = {
    scopeBySucursal: (arr: Entry[]) => arr,
    tallerEntries: [],
    ...win,
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- extracción/ejecución del literal real, patrón ya usado en sortInspecciones.test.ts
  return new Function("window", `return ${m[1]}`)(w) as number;
}

describe("badge de Taller (renderTaller) — consume __pendientesDeFirma, no reimplementa el filtro", () => {
  it("el total es la SUMA de lo que devuelve __pendientesDeFirma por visita — no un conteo propio", () => {
    const tallerPartidas = new Map<string, unknown[]>([
      ["a|1", [{}, {}]],
      ["b|2", [{}]],
    ]);
    const entries: Entry[] = [{ id: "a" }, { id: "b" }];
    // Stub deliberadamente AJENO a "estado === propuesta": si renderTaller()
    // tuviera su propia lógica de filtro en vez de llamar al bridge, este
    // valor no se reflejaría en el total.
    const total = calcPend({
      __tallerPartidas: tallerPartidas,
      __pendientesDeFirma: () => 5,
      __visitaKeyDe: (e) => (e.id === "a" ? "a|1" : "b|2"),
      tallerEntries: entries,
    });
    expect(total).toBe(10); // 2 visitas × 5
  });

  it("distintos stubs por visita se respetan (no hay un total fijo cableado)", () => {
    const tallerPartidas = new Map<string, unknown[]>([
      ["a|1", [{}]],
      ["b|2", [{}]],
      ["c|3", [{}]],
    ]);
    const entries: Entry[] = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const keyOf: Record<string, string> = { a: "a|1", b: "b|2", c: "c|3" };
    let calls = 0;
    const total = calcPend({
      __tallerPartidas: tallerPartidas,
      __visitaKeyDe: (e) => keyOf[e.id]!,
      tallerEntries: entries,
      __pendientesDeFirma: () => {
        calls++;
        return calls; // 1, 2, 3 según orden de iteración de las entries
      },
    });
    expect(total).toBe(6); // 1+2+3
    expect(calls).toBe(3);
  });

  it("escopa por sucursal — una visita fuera del candado del usuario no cuenta (Important 3)", () => {
    const tallerPartidas = new Map<string, unknown[]>([
      ["a|1", [{}]], // GDL
      ["b|2", [{}]], // MTY — fuera del candado
    ]);
    const entries: Entry[] = [
      { id: "a", sucursal: "GDL" },
      { id: "b", sucursal: "MTY" },
    ];
    const keyOf: Record<string, string> = { a: "a|1", b: "b|2" };
    const total = calcPend({
      __tallerPartidas: tallerPartidas,
      __visitaKeyDe: (e) => keyOf[e.id]!,
      tallerEntries: entries,
      __pendientesDeFirma: () => 5,
      // Mismo candado real: un usuario fijado a GDL no ve MTY.
      scopeBySucursal: (arr) => arr.filter((e) => e.sucursal === "GDL"),
    });
    expect(total).toBe(5); // solo la visita "a" cuenta, nunca 10
  });

  it("sin __pendientesDeFirma publicada (bridge aún no cargó) da 0, no revienta", () => {
    const tallerPartidas = new Map<string, unknown[]>([["a|1", [{}]]]);
    const entries: Entry[] = [{ id: "a" }];
    expect(
      calcPend({
        __tallerPartidas: tallerPartidas,
        __visitaKeyDe: (e) => `${e.id}|1`,
        tallerEntries: entries,
      }),
    ).toBe(0);
  });

  it("sin __tallerPartidas publicado da 0 (la visita resuelve a un arreglo vacío)", () => {
    const entries: Entry[] = [{ id: "a" }];
    expect(
      calcPend({
        __pendientesDeFirma: (ps) => ps.length,
        __visitaKeyDe: (e) => `${e.id}|1`,
        tallerEntries: entries,
      }),
    ).toBe(0);
  });
});
