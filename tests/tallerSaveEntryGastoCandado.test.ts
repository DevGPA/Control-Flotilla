// tests/tallerSaveEntryGastoCandado.test.ts
//
// Fix ronda 2 (Task 9, Important 1): editar la fecha de entrada (o la placa/económico) de
// una visita CON partidas recomputaba la visitaKey con los valores ACTUALES del formulario;
// como esa clave ya no coincidía con la de las partidas, el candado viejo (`psVisita.length`)
// daba `false` aunque la visita SIGUIERA teniendo partidas bajo la clave vieja, y el derivado
// pintado en el campo se guardaba como si fuera tecleado a mano. El fix cambió el candado a
// `#tf-gasto.readOnly` — lo fija `openTallerModal()` con la visita ORIGINAL al abrir el modal,
// y no se mueve pase lo que pase con los demás campos.
//
// Fix de la ola (minor C-L1101(d)): el candado pasó de `.disabled` a `.readOnly` — sigue
// enfocable y copiable (Riesgos pega ese monto en su conciliación) y es el semántico de
// "esto se calcula". El centinela de saveTallerEntry y este harness se movieron con él:
// los tres juntos o ninguno.
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
import { sinGastoSiTienePartidas, type LegacyTallerEntry } from "../src/api/batchUpload";

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

type ElementoFalso = { value: string; readOnly: boolean };

/** `document` mínimo: getElementById devuelve `{value, readOnly}` por id, desde un mapa. */
function documentoFalso(valores: Record<string, string>, gastoReadOnly: boolean) {
  const elementos: Record<string, ElementoFalso> = {};
  const de = (id: string): ElementoFalso => {
    if (!elementos[id]) {
      elementos[id] = { value: valores[id] ?? "", readOnly: id === "tf-gasto" && gastoReadOnly };
    }
    return elementos[id]!;
  };
  return { getElementById: (id: string) => de(id) };
}

/** Ejecuta el bloque REAL de construcción de `entry` con un `document`/estado de prueba. */
function construyeEntry(opts: {
  valores: Record<string, string>;
  gastoReadOnly: boolean;
  tallerEditId?: string | null;
  reingresoKey?: string | null;
  tallerEntries?: Array<Record<string, unknown> & { id: string; unitKey?: string }>;
}): LegacyTallerEntry {
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
    documentoFalso(opts.valores, opts.gastoReadOnly),
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
  "tf-gasto": "9999", // el valor que #tf-gasto pintó (derivado, si está en readOnly)
  ...over,
});

describe("saveTallerEntry() — el candado de gasto/gastoRef/gastoMO es #tf-gasto.readOnly, no la visitaKey", () => {
  it("con el campo pintado solo-lectura (visita CON partidas), NO persiste gasto/gastoRef/gastoMO", () => {
    const entry = construyeEntry({ valores: valoresBase(), gastoReadOnly: true });
    expect(entry.gasto).toBeUndefined();
    expect(entry.gastoRef).toBeUndefined();
    expect(entry.gastoMO).toBeUndefined();
  });

  // El caso que Important 1 reporta: el usuario CORRIGE la fecha de entrada de una visita
  // con partidas (p.ej. un typo). Antes esto recomputaba la visitaKey y el candado viejo
  // (psVisita.length) se rompía; el candado actual (#tf-gasto.readOnly) no depende de
  // fentrada/eco/plate en absoluto, así que editarlos no debe cambiar el resultado.
  it("editar la fecha de entrada de una visita CON partidas sigue sin persistir el dinero derivado", () => {
    const entry = construyeEntry({
      valores: valoresBase({ "tf-fentrada": "2026-08-15" }), // fecha CORREGIDA, distinta de la original
      gastoReadOnly: true, // el candado sigue en true — lo fijó openTallerModal con la visita ORIGINAL
    });
    expect(entry.fentrada).toBe("2026-08-15"); // la fecha sí se actualiza
    expect(entry.gasto).toBeUndefined(); // pero el dinero derivado NO se persiste
    expect(entry.gastoRef).toBeUndefined();
    expect(entry.gastoMO).toBeUndefined();
  });

  it("editar la placa/económico de una visita CON partidas tampoco persiste el dinero derivado", () => {
    const entry = construyeEntry({
      valores: valoresBase({ "tf-plate": "XYZ-999" }), // placa CORREGIDA
      gastoReadOnly: true,
    });
    expect(entry.gasto).toBeUndefined();
    expect(entry.gastoRef).toBeUndefined();
    expect(entry.gastoMO).toBeUndefined();
  });

  it("SIN partidas (campo editable), el gasto tecleado a mano SÍ se persiste — las visitas históricas no se tocan", () => {
    const entry = construyeEntry({
      valores: valoresBase({ "tf-gasto": "1234.50" }),
      gastoReadOnly: false,
    });
    expect(entry.gasto).toBe(1234.5);
    expect(entry.gastoRef).toBe(0);
    expect(entry.gastoMO).toBe(0);
  });
});

// ── Remate §2.2 / Ruling R95 — "anulación, nunca borrado" también al guardar a mano ──
//
// El residual que la re-revisión dejó abierto: `saveTallerEntry` reconstruía el
// entry con una lista blanca que NO incluía `gastoCapturadoOriginal`, y con el
// campo bloqueado mandaba las tres llaves de dinero en `undefined`. Como
// `upsertTaller` REEMPLAZA `datos` completo, el primer guardado manual posterior
// borraba de DynamoDB el subtotal que R87 había preservado — y en la "variante
// peor" (el primer escrito tras aparecer las partidas ES un guardado manual) no
// se preservaba nunca nada, porque el entry ya llegaba vacío al chokepoint.
//
// Estos tests componen las DOS piezas reales: el bloque de construcción del
// entry extraído del HTML y `sinGastoSiTienePartidas` importado de su módulo —
// que es exactamente la cadena que corre en producción (`saveTallerEntry` →
// `__cloudReplaceTaller` → `uploadTallerToCloud` → `sinGastoSiTienePartidas`).
describe("saveTallerEntry() — el subtotal tecleado sobrevive al guardado manual (R95)", () => {
  const ORIGINAL = { gasto: 7400, gastoRef: 5000, gastoMO: 2400, en: "2026-09-01T10:00:00Z" };

  it("(a) lo YA preservado sobrevive a un guardado manual de otro campo", () => {
    const entry = construyeEntry({
      valores: valoresBase(), // #tf-gasto pinta el DERIVADO (9999)
      gastoReadOnly: true, // la visita tiene partidas
      tallerEditId: "tl_a",
      tallerEntries: [{ id: "tl_a", unitKey: "tl_a", gastoCapturadoOriginal: ORIGINAL }],
    });
    // El entry reconstruido ya no pierde el rastro…
    expect(entry.gastoCapturadoOriginal).toEqual(ORIGINAL);
    expect(entry.gasto).toBeUndefined(); // …y sigue sin persistir el derivado
    // …y el chokepoint no lo sobrescribe con un recorte posterior.
    const subido = sinGastoSiTienePartidas(entry, true, "2026-09-11T12:00:00Z");
    expect(subido.gastoCapturadoOriginal).toEqual(ORIGINAL);
  });

  it("(b) variante peor: el PRIMER escrito tras aparecer las partidas es un guardado manual", () => {
    const entry = construyeEntry({
      valores: valoresBase({ "tf-gasto": "9999" }), // el DERIVADO pintado por openTallerModal
      gastoReadOnly: true,
      tallerEditId: "tl_b",
      tallerEntries: [
        { id: "tl_b", unitKey: "tl_b", gasto: 1234.5, gastoRef: 1000, gastoMO: 234.5 },
      ],
    });
    // Del DOM no sale nada: el 9999 derivado NO entra; sale lo que había EN MEMORIA.
    expect(entry.gasto).toBe(1234.5);
    expect(entry.gastoRef).toBe(1000);
    expect(entry.gastoMO).toBe(234.5);
    expect(entry.gastoCapturadoOriginal).toBeUndefined(); // todavía no hay nada preservado
    // Por eso el chokepoint SÍ tiene qué preservar antes de recortar.
    const subido = sinGastoSiTienePartidas(entry, true, "2026-09-11T12:00:00Z");
    expect(subido.gasto).toBeUndefined();
    expect(subido.gastoRef).toBeUndefined();
    expect(subido.gastoMO).toBeUndefined();
    expect(subido.gastoCapturadoOriginal).toEqual({
      gasto: 1234.5,
      gastoRef: 1000,
      gastoMO: 234.5,
      en: "2026-09-11T12:00:00Z",
    });
  });

  it("sin partidas (o en estado desconocido) se conserva lo que había — no un $0 fabricado", () => {
    const entry = construyeEntry({
      valores: valoresBase(),
      gastoReadOnly: true, // bloqueado por el TRI-ESTADO: partidas no cargadas
      tallerEditId: "tl_c",
      tallerEntries: [{ id: "tl_c", unitKey: "tl_c", gasto: 555 }],
    });
    expect(entry.gasto).toBe(555);
    const subido = sinGastoSiTienePartidas(entry, false);
    expect(subido.gasto).toBe(555); // la verdad previa vuelve a la nube intacta
  });
});
