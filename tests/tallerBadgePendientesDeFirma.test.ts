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

/** Ejecuta la expresión REAL que calcula `_pend`, con un `window` de prueba. */
function calcPend(win: {
  __tallerPartidas?: Map<string, unknown[]>;
  __pendientesDeFirma?: (ps: unknown[]) => number;
}): number {
  const bloque = bloqueBadgeDeRenderTaller();
  const m = /const _pend = ([\s\S]*?, 0\);)/.exec(bloque);
  if (!m) throw new Error("No se encontró la expresión de _pend dentro de renderTaller()");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- extracción/ejecución del literal real, patrón ya usado en sortInspecciones.test.ts
  return new Function("window", `return ${m[1]}`)(win) as number;
}

describe("badge de Taller (renderTaller) — consume __pendientesDeFirma, no reimplementa el filtro", () => {
  it("el total es la SUMA de lo que devuelve __pendientesDeFirma por visita — no un conteo propio", () => {
    const tallerPartidas = new Map<string, unknown[]>([
      ["a|1", [{}, {}]],
      ["b|2", [{}]],
    ]);
    // Stub deliberadamente AJENO a "estado === propuesta": si renderTaller()
    // tuviera su propia lógica de filtro en vez de llamar al bridge, este
    // valor no se reflejaría en el total.
    const total = calcPend({ __tallerPartidas: tallerPartidas, __pendientesDeFirma: () => 5 });
    expect(total).toBe(10); // 2 visitas × 5
  });

  it("distintos stubs por visita se respetan (no hay un total fijo cableado)", () => {
    const tallerPartidas = new Map<string, unknown[]>([
      ["a|1", [{}]],
      ["b|2", [{}]],
      ["c|3", [{}]],
    ]);
    let calls = 0;
    const total = calcPend({
      __tallerPartidas: tallerPartidas,
      __pendientesDeFirma: () => {
        calls++;
        return calls; // 1, 2, 3 según orden de iteración del Map
      },
    });
    expect(total).toBe(6); // 1+2+3
    expect(calls).toBe(3);
  });

  it("sin __pendientesDeFirma publicada (bridge aún no cargó) da 0, no revienta", () => {
    const tallerPartidas = new Map<string, unknown[]>([["a|1", [{}]]]);
    expect(calcPend({ __tallerPartidas: tallerPartidas })).toBe(0);
  });

  it("sin __tallerPartidas publicado da 0", () => {
    expect(calcPend({ __pendientesDeFirma: () => 5 })).toBe(0);
  });
});
