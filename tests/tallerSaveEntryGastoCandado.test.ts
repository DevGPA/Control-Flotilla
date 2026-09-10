// tests/tallerSaveEntryGastoCandado.test.ts
//
// Fix ronda 2 (Task 9, Important 1): editar la fecha de entrada (o la placa/económico) de
// una visita CON partidas recomputaba la visitaKey con los valores ACTUALES del formulario;
// como esa clave ya no coincidía con la de las partidas, el candado viejo (`psVisita.length`)
// daba `false` aunque la visita SIGUIERA teniendo partidas bajo la clave vieja, y el derivado
// pintado en el campo se guardaba como si fuera tecleado a mano. El fix cambió el candado a
// `#tf-gasto.disabled` — lo fija `openTallerModal()` con la visita ORIGINAL al abrir el modal,
// y no se mueve pase lo que pase con los demás campos.
//
// `saveTallerEntry()` vive en un <script> inline de 10k líneas sin módulo TS equivalente —
// mismo patrón que `tests/tallerBadgePendientesDeFirma.test.ts`: se extrae y EJECUTA el
// literal real del HTML (`new Function`), no una copia reescrita a mano que podría divergir
// en silencio del código que corre. Se extrae desde la apertura de la función hasta que
// `entry` termina de construirse (justo antes del bloque de validación de fechas, que no
// toca `gasto`/`gastoRef`/`gastoMO` y no hace falta ejecutar).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");

/** El bloque de saveTallerEntry() que construye `entry`, tal cual vive en el HTML. */
function bloqueConstruccionEntry(): string {
  const marcadorInicio = "async function saveTallerEntry(){";
  const inicio = html.indexOf(marcadorInicio);
  if (inicio < 0) throw new Error("No se encontró saveTallerEntry() en el HTML");
  const marcadorFin = "// Validaci"; // "// Validación lógica de fechas..." — único en la función
  const fin = html.indexOf(marcadorFin, inicio);
  if (fin < 0) throw new Error("No se encontró el marcador de fin (construcción de `entry`)");
  return html.slice(inicio + marcadorInicio.length, fin);
}

type ElementoFalso = { value: string; disabled: boolean };

/** `document` mínimo: getElementById devuelve `{value, disabled}` por id, desde un mapa. */
function documentoFalso(valores: Record<string, string>, gastoDisabled: boolean) {
  const elementos: Record<string, ElementoFalso> = {};
  const de = (id: string): ElementoFalso => {
    if (!elementos[id]) {
      elementos[id] = { value: valores[id] ?? "", disabled: id === "tf-gasto" && gastoDisabled };
    }
    return elementos[id]!;
  };
  return { getElementById: (id: string) => de(id) };
}

/** Ejecuta el bloque REAL de construcción de `entry` con un `document`/estado de prueba. */
function construyeEntry(opts: {
  valores: Record<string, string>;
  gastoDisabled: boolean;
  tallerEditId?: string | null;
  reingresoKey?: string | null;
  tallerEntries?: Array<{ id: string; unitKey?: string }>;
}): { gasto?: number; gastoRef?: number; gastoMO?: number; fentrada?: string } {
  const bloque = bloqueConstruccionEntry();
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- extracción/ejecución del literal real, patrón ya usado en tallerBadgePendientesDeFirma.test.ts
  const fn = new Function(
    "document",
    "_tallerEditId",
    "_tallerReingresoKey",
    "tallerEntries",
    `${bloque}\nreturn entry;`,
  );
  return fn(
    documentoFalso(opts.valores, opts.gastoDisabled),
    opts.tallerEditId ?? null,
    opts.reingresoKey ?? null,
    opts.tallerEntries ?? [],
  );
}

const valoresBase = (over: Record<string, string> = {}): Record<string, string> => ({
  "tf-eco": "42",
  "tf-plate": "ABC-123",
  "tf-tipo": "Correctivo",
  "tf-km": "85000",
  "tf-freporte": "2026-08-01",
  "tf-fentrada": "2026-08-01",
  "tf-gasto": "9999", // el valor que #tf-gasto pintó (derivado, si está disabled)
  ...over,
});

describe("saveTallerEntry() — el candado de gasto/gastoRef/gastoMO es #tf-gasto.disabled, no la visitaKey", () => {
  it("con el campo pintado solo-lectura (visita CON partidas), NO persiste gasto/gastoRef/gastoMO", () => {
    const entry = construyeEntry({ valores: valoresBase(), gastoDisabled: true });
    expect(entry.gasto).toBeUndefined();
    expect(entry.gastoRef).toBeUndefined();
    expect(entry.gastoMO).toBeUndefined();
  });

  // El caso que Important 1 reporta: el usuario CORRIGE la fecha de entrada de una visita
  // con partidas (p.ej. un typo). Antes esto recomputaba la visitaKey y el candado viejo
  // (psVisita.length) se rompía; el candado actual (#tf-gasto.disabled) no depende de
  // fentrada/eco/plate en absoluto, así que editarlos no debe cambiar el resultado.
  it("editar la fecha de entrada de una visita CON partidas sigue sin persistir el dinero derivado", () => {
    const entry = construyeEntry({
      valores: valoresBase({ "tf-fentrada": "2026-08-15" }), // fecha CORREGIDA, distinta de la original
      gastoDisabled: true, // el candado sigue en true — lo fijó openTallerModal con la visita ORIGINAL
    });
    expect(entry.fentrada).toBe("2026-08-15"); // la fecha sí se actualiza
    expect(entry.gasto).toBeUndefined(); // pero el dinero derivado NO se persiste
    expect(entry.gastoRef).toBeUndefined();
    expect(entry.gastoMO).toBeUndefined();
  });

  it("editar la placa/económico de una visita CON partidas tampoco persiste el dinero derivado", () => {
    const entry = construyeEntry({
      valores: valoresBase({ "tf-plate": "XYZ-999" }), // placa CORREGIDA
      gastoDisabled: true,
    });
    expect(entry.gasto).toBeUndefined();
    expect(entry.gastoRef).toBeUndefined();
    expect(entry.gastoMO).toBeUndefined();
  });

  it("SIN partidas (campo editable), el gasto tecleado a mano SÍ se persiste — las visitas históricas no se tocan", () => {
    const entry = construyeEntry({
      valores: valoresBase({ "tf-gasto": "1234.50" }),
      gastoDisabled: false,
    });
    expect(entry.gasto).toBe(1234.5);
    expect(entry.gastoRef).toBe(0);
    expect(entry.gastoMO).toBe(0);
  });
});
