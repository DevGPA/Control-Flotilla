// tests/tallerApagador.test.ts
//
// Task 10 (el apagador): el esquema híbrido de Taller se prende para toda la
// flota y todos los talleres a la vez, sin piloto (decisión 21) — el freno de
// mano no es opcional. Este archivo cubre:
//   1. esquemaHibridoActivo — el predicado puro (dado por el brief).
//   2. R60 — el modelo AppConfig copia el patrón de autorización de Anulacion.
//   3. R62 — con el switch apagado, la derivación de partidas NO aplica en
//      ningún resolver (ni el upload strip, ni el candado de #tf-gasto, ni el
//      guard de export, ni las analíticas) — un solo predicado, consultado en
//      cada resolver, nunca sprinkleado en los consumidores.
//   4. Fix ronda 1 (Important 1) — el short-circuit de "snapshot sin cambios"
//      de hydrateFromCloud() tiene que reaccionar a un flip del switch aunque
//      NADA más en el tenant se haya movido.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { esquemaHibridoActivo } from "../src/taller/partidas";
import type { Partida } from "../src/taller/partidas";
import { visitaKeyDe } from "../src/api/tallerPartidas";
import { uploadTallerToCloud, type LegacyTallerEntry } from "../src/api/batchUpload";
import { hydrateSignature } from "../src/api/cloudHydrate";

describe("esquemaHibridoActivo — freno de mano", () => {
  it("apagado por omisión: nada se prende por accidente", () => {
    expect(esquemaHibridoActivo(undefined)).toBe(false);
    expect(esquemaHibridoActivo(null)).toBe(false);
    expect(esquemaHibridoActivo({})).toBe(false);
  });

  it("se prende solo con el valor booleano exacto", () => {
    expect(esquemaHibridoActivo({ tallerHibrido: true })).toBe(true);
    expect(esquemaHibridoActivo({ tallerHibrido: "true" })).toBe(false);
    expect(esquemaHibridoActivo({ tallerHibrido: 1 })).toBe(false);
    expect(esquemaHibridoActivo({ tallerHibrido: false })).toBe(false);
  });

  it("no truena con basura", () => {
    expect(esquemaHibridoActivo("sí")).toBe(false);
    expect(esquemaHibridoActivo(42)).toBe(false);
  });
});

// ── R60 — AppConfig copia el patrón de autorización de Anulacion ────────────
describe("schema — AppConfig (R60: todo el tenant lee, solo admin escribe)", () => {
  const schema = readFileSync("amplify/data/resource.ts", "utf8");

  it("declara el modelo AppConfig", () => {
    expect(schema).toContain("AppConfig: a");
  });

  it("usa tenantId como identificador — una fila por tenant", () => {
    expect(schema).toMatch(/identifier\(\["tenantId"\]\)/);
  });

  it("declara el campo tallerHibrido como booleano", () => {
    const inicio = schema.indexOf("AppConfig: a");
    const fin = schema.indexOf(".identifier(", inicio);
    const bloqueCampos = schema.slice(inicio, fin);
    expect(bloqueCampos).toMatch(/tallerHibrido:\s*a\.boolean\(\)/);
  });

  it("todo el tenant LEE; SOLO admin escribe — mismo patrón que Anulacion", () => {
    // Acota el bloque de AppConfig: el siguiente modelo de nivel superior marca el
    // fin de su declaración (mismo patrón de bound que tallerPartidaSchema.test.ts).
    const inicio = schema.indexOf("AppConfig: a");
    const resto = schema.slice(inicio);
    const finRel = resto.search(/\n {4}\w+: a\n?\s*\.model\(/);
    const bloque = finRel === -1 ? resto : resto.slice(0, finRel);

    // Prueba que el bound funciona: el bloque NO debe alcanzar UserProfile,
    // el siguiente modelo de nivel superior tras AppConfig.
    expect(bloque).not.toContain("UserProfile: a");

    expect(bloque).toContain('allow.groupDefinedIn("tenantId").to(["read"])');
    expect(bloque).toContain('allow.group("admin")');
    // Un switch que cualquiera puede voltear no es un freno de mano: ni viewer
    // ni operativo tienen escritura sobre este modelo.
    expect(bloque).not.toMatch(/allow\.group\("viewer"\)\.to\(\[.*(create|update).*\]\)/);
    expect(bloque).not.toMatch(/allow\.group\("operativo"\)\.to\(\[.*(create|update).*\]\)/);
  });
});

// ── R62 — con el switch, la derivación de partidas no aplica en ningún lado ─
// Mismo resolver que src/api/cloudWire.ts publica como `partidasDeEntry` (los
// otros dos sitios — cloudHydrate.ts orphan migration y el shim de
// main.ts — comparten EXACTAMENTE el mismo predicado: `window.__tallerHibrido
// ? <lookup real> : undefined`). Se reimplementa aquí, tal cual, para probar
// el CONTRATO del seam contra uploadTallerToCloud/sinGastoSiTienePartidas —
// mismo enfoque que tests/tallerGastoNoPersiste.test.ts usa para el resolver
// de huérfanos.
const upserts: Array<{ datos: Record<string, unknown> }> = [];
vi.mock("../src/api/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/api/client")>();
  return {
    ...real,
    upsertTaller: (arg: { datos: Record<string, unknown> }) => {
      upserts.push(arg);
      return Promise.resolve({});
    },
  };
});

function partidasDeEntryComoCloudWire(win: {
  tallerHibrido: boolean;
  tallerPartidas: Map<string, Partida[]>;
}) {
  return (e: LegacyTallerEntry): Partida[] | undefined =>
    win.tallerHibrido ? win.tallerPartidas.get(visitaKeyDe(e)) : undefined;
}

// ── B-C2 — "el admin apagó el switch" ≠ "la lectura de AppConfig falló" ─────
// El resolver de arriba solo distingue prendido/apagado, y por eso el test de
// más abajo ("switch APAGADO: el tecleado sobrevive") fijaba como CORRECTO el
// upload del gasto tecleado en los DOS casos: el legítimo (R62) y el de una
// lectura fallida de 30 segundos, donde ese "tecleado" puede ser el `$0` que
// el formulario escribe al crear el ingreso — encima del dinero firmado.
// El candado real del segundo caso NO vive en este resolver: vive en el
// tri-estado del monolito (`_partidasConfiables`), que bloquea `#tf-gasto` y,
// por el mismo centinela, impide que `saveTallerEntry` persista las tres
// llaves. Se extrae y EJECUTA el literal real del HTML, igual que
// `_partidasDeVisita` más abajo.
function partidasConfiablesReal(win: {
  __tallerHibrido?: boolean;
  __tallerHibridoDesconocido?: boolean;
  __tallerPartidasCargadas?: boolean;
}): () => boolean {
  const src = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");
  const m = /function _partidasConfiables\(\)\{[\s\S]*?\n\}/.exec(src);
  if (!m) throw new Error("No se encontró _partidasConfiables() en el HTML");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- extracción/ejecución del literal real, patrón ya usado en tallerBadgePendientesDeFirma.test.ts
  const outer = new Function("window", `${m[0]}\nreturn _partidasConfiables;`);
  return outer(win) as () => boolean;
}

describe("tri-estado (B-C2) — 'el switch está apagado' no puede disfrazarse de 'no se pudo leer'", () => {
  it("APAGADO y confirmado: las partidas son confiables — el [] es un dato y el tecleado manda (R62)", () => {
    expect(
      partidasConfiablesReal({ __tallerHibrido: false, __tallerHibridoDesconocido: false })(),
    ).toBe(true);
  });

  it("la lectura de AppConfig FALLÓ: NO es confiable — nada de desbloquear el gasto ni de escribir $0", () => {
    expect(partidasConfiablesReal({ __tallerHibridoDesconocido: true })()).toBe(false);
  });

  it("ninguna hidratación exitosa todavía: NO es confiable (no es lo mismo que 'apagado')", () => {
    expect(partidasConfiablesReal({})()).toBe(false);
  });

  it("PRENDIDO con las partidas cargadas: confiable", () => {
    expect(
      partidasConfiablesReal({
        __tallerHibrido: true,
        __tallerHibridoDesconocido: false,
        __tallerPartidasCargadas: true,
      })(),
    ).toBe(true);
  });

  it("PRENDIDO pero con la lectura de partidas FALLIDA: NO confiable — el $0 derivado sería una mentira", () => {
    expect(
      partidasConfiablesReal({
        __tallerHibrido: true,
        __tallerHibridoDesconocido: false,
        __tallerPartidasCargadas: false,
      })(),
    ).toBe(false);
  });
});

describe("R62 — con el switch apagado, la derivación de partidas no aplica en ningún lado", () => {
  const entryConPartidas: LegacyTallerEntry = {
    id: "tl_x",
    plate: "ABC-123",
    fentrada: "2026-08-01",
    estado: "Finalizado",
    gasto: 999,
    gastoRef: 0,
    gastoMO: 0,
  };
  // La llave se DERIVA del entry (R44), nunca se teclea: con el literal "ABC-123|2026-08-01"
  // el fixture dejó de coincidir en cuanto R59 canonizó la placa, y el test pasaba a probar
  // "no hay partidas" creyendo probar "el switch prendido recorta".
  const claveVisita = visitaKeyDe(entryConPartidas);
  const ps: Partida[] = [
    {
      partidaId: "p1",
      visitaKey: claveVisita,
      descripcion: "Refacción mayor",
      estado: "autorizada",
      precio: 1500,
      precioAutorizado: 1500,
      tipo: "refaccion",
      fotos: [],
    },
  ];
  const porVisita = new Map<string, Partida[]>([[claveVisita, ps]]);

  // El switch APAGADO **y confirmado** (la lectura de AppConfig tuvo éxito): el
  // caso de una lectura FALLIDA no llega hasta aquí — lo detiene antes el
  // tri-estado del monolito, ver el describe de arriba.
  it("switch APAGADO y confirmado: el tecleado sobrevive intacto — la visita CON partidas sube su gasto tal cual (Ruling R62)", async () => {
    upserts.length = 0;
    const partidasDe = partidasDeEntryComoCloudWire({
      tallerHibrido: false,
      tallerPartidas: porVisita,
    });
    await uploadTallerToCloud([entryConPartidas], "tenant-x", partidasDe);
    expect(upserts).toHaveLength(1);
    const { datos } = upserts[0]!;
    expect(datos.gasto).toBe(999);
    expect(datos.gastoRef).toBe(0);
    expect(datos.gastoMO).toBe(0);
  });

  it("switch PRENDIDO: la MISMA visita se recorta — el dinero deriva de lo firmado", async () => {
    upserts.length = 0;
    const partidasDe = partidasDeEntryComoCloudWire({
      tallerHibrido: true,
      tallerPartidas: porVisita,
    });
    await uploadTallerToCloud([entryConPartidas], "tenant-x", partidasDe);
    expect(upserts).toHaveLength(1);
    const { datos } = upserts[0]!;
    expect(datos).not.toHaveProperty("gasto");
    expect(datos).not.toHaveProperty("gastoRef");
    expect(datos).not.toHaveProperty("gastoMO");
  });
});

// ── R62 — el resolver REAL del monolito (_partidasDeVisita) ─────────────────
// Se extrae y EJECUTA el literal tal cual vive en el HTML (new Function) —
// mismo enfoque que tests/tallerBadgePendientesDeFirma.test.ts — para probar
// el candado real, no una copia que podría divergir en silencio.
const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");

function partidasDeVisitaReal(win: {
  __tallerHibrido?: boolean;
  __tallerPartidas?: Map<string, unknown[]>;
  __visitaKeyDe?: (e: unknown) => string;
}): (e: unknown) => unknown[] {
  // [\s\S]*?\n\} no-greedy hasta el primer "}" que abre línea — CRLF-safe (el
  // archivo usa \r\n: la "\n" del salto de línea queda igual inmediatamente
  // antes de "}").
  const m = /function _partidasDeVisita\(e\)\{[\s\S]*?\n\}/.exec(html);
  if (!m) throw new Error("No se encontró _partidasDeVisita() en el HTML");
  const bloque = m[0];
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- extracción/ejecución del literal real, patrón ya usado en tallerBadgePendientesDeFirma.test.ts
  const outer = new Function("window", `${bloque}\nreturn _partidasDeVisita;`);
  return outer(win) as (e: unknown) => unknown[];
}

describe("_partidasDeVisita (Control de flotilla.html) — el resolver real del monolito", () => {
  it("switch apagado: devuelve [] SIN mirar window.__tallerPartidas", () => {
    const fn = partidasDeVisitaReal({
      __tallerHibrido: false,
      __tallerPartidas: new Map([["a|1", [{ id: "deberia-ser-invisible" }]]]),
      __visitaKeyDe: () => "a|1",
    });
    expect(fn({ id: "a" })).toEqual([]);
  });

  it("switch prendido: resuelve las partidas reales de la visita", () => {
    const partidasReales = [{ id: "p1" }];
    const fn = partidasDeVisitaReal({
      __tallerHibrido: true,
      __tallerPartidas: new Map([["a|1", partidasReales]]),
      __visitaKeyDe: () => "a|1",
    });
    expect(fn({ id: "a" })).toBe(partidasReales);
  });

  it("switch prendido pero sin bridge __tallerPartidas (hidratación no ha corrido) da [], no revienta", () => {
    const fn = partidasDeVisitaReal({ __tallerHibrido: true, __visitaKeyDe: () => "a|1" });
    expect(fn({ id: "a" })).toEqual([]);
  });
});

// ── Fix ronda 1, Important 1 — el flip-only nunca se pega al short-circuit ──
// hydrateFromCloud() salta TODO el rebuild+render (incluida
// applyTallerHibridoGate(), llamada dentro de renderTaller()) cuando
// hydrateSignature() del snapshot actual == la de la última hidratación
// (window.__lastHydrateSig). Antes del fix, esa firma se armaba con units/
// checklists/semanales/tallerCloud/checkDones/combustible/validaciones/
// complianceDocs/anulaciones — SIN appConfigRows: un admin que voltea SOLO
// el switch (common case: nadie más tocó el tenant en ese instante) producía
// la MISMA firma que la hidratación anterior, y updateTallerBadge()/
// renderTaller() nunca volvían a correr — el badge y la sub-pestaña "Por
// autorizar" quedaban pegados al estado de antes del flip hasta que algo
// MÁS cambiara o el usuario recargara.
//
// Dos pruebas, complementarias:
//   B (regresión de código fuente — la que REALMENTE falla sin el fix): que
//      la llamada REAL a hydrateSignature() dentro de hydrateFromCloud()
//      incluya appConfigRows en la lista. Se prefiere sobre un mock completo
//      de hydrateFromCloud() (~11 funciones de client.ts + fetchPartidas de
//      tallerPartidas.ts + fotos) porque esta función no tiene precedente de
//      integration-test en el repo (todo lo demás la cubre con funciones
//      puras extraídas o texto fuente — mismo patrón que
//      tallerPartidaSchema.test.ts) y un mock de ese tamaño sería frágil a
//      cualquier refactor de una parte de la función que nada tiene que ver
//      con el apagador.
//   A (mecanismo — documenta POR QUÉ B es suficiente): con la MISMA
//      composición de arrays que arma el snapshot real (una lista de listas
//      con `updatedAt`), agregar/cambiar la fila de AppConfig cambia la
//      firma — hydrateSignature() ya está probada en general en
//      tests/hydrateSignature.test.ts; esto solo fija el caso concreto de
//      "AppConfig es una lista más" para que quede documentado junto al bug.
describe("hydrateFromCloud — el snapshot sig reacciona a un flip del switch (fix ronda 1, Important 1)", () => {
  const src = readFileSync(join(__dirname, "..", "src", "api", "cloudHydrate.ts"), "utf8");

  it("B: appConfigRows viaja DENTRO de la llamada real a hydrateSignature([...]) en hydrateFromCloud()", () => {
    const m = /const snapshotSig = hydrateSignature\(\[([\s\S]*?)\]\);/.exec(src);
    if (!m) throw new Error("No se encontró la llamada a hydrateSignature() en hydrateFromCloud()");
    expect(m[1]).toMatch(/\bappConfigRows\b/);
  });

  it("A: con appConfigRows en la lista, un flip SOLO en esa fila (nada más se movió) cambia la firma", () => {
    type Row = { updatedAt?: string | null };
    const r = (updatedAt?: string | null): Row => ({ updatedAt });
    // Mismo shape que el snapshot real: N listas de filas, cada una con updatedAt.
    // units/checklists/.../anulaciones se mantienen IDÉNTICOS entre "antes" y
    // "después" — solo la última lista (appConfigRows) cambia.
    const restoDelTenant: Row[][] = [
      [r("2026-09-01T00:00:00Z")], // units
      [], // checklists
      [], // semanales
      [], // tallerCloud
      [], // checkDones
      [], // combustible
      [], // validaciones
      [], // complianceDocs
      [], // anulaciones
    ];
    const antesDelFlip = [...restoDelTenant, [] as Row[]]; // AppConfig: sin fila (switch nunca configurado)
    const despuesDelFlip = [...restoDelTenant, [r("2026-09-10T08:00:00Z")]]; // admin crea/actualiza la fila
    expect(hydrateSignature(antesDelFlip)).not.toBe(hydrateSignature(despuesDelFlip));
  });
});

// ── BC-C1 (+ R89) — la firma del snapshot INCLUYE partidas y accesorios ─────
// El hallazgo #1 de todo el cierre: `TallerPartida` no participaba de
// `hydrateSignature`, así que firmar/rechazar/crear/enviar una partida — que no
// toca ni una fila de `Taller` — producía una firma IDÉNTICA y
// `hydrateFromCloud` retornaba por el corto-circuito sin re-armar
// `window.__tallerPartidas`: en una sesión abierta la partida seguía
// "pendiente", los chips no se movían, el badge no bajaba y el botón quedaba
// deshabilitado para siempre. `accesorioRows` es el mismo defecto para otro
// modelo (L1567, preexistente de `main`), cerrado en la misma edición.
//
// Golden test de la lista completa (pedido por el área D): si alguien agrega un
// modelo al `Promise.all` y olvida meterlo en la firma, este test lo delata —
// y si lo agrega a la firma, tiene que decirlo aquí a propósito.
describe("hydrateFromCloud — la lista de hydrateSignature() es completa (BC-C1, R89)", () => {
  const src = readFileSync(join(__dirname, "..", "src", "api", "cloudHydrate.ts"), "utf8");
  const m = /const snapshotSig = hydrateSignature\(\[([\s\S]*?)\]\);/.exec(src);
  if (!m) throw new Error("No se encontró la llamada a hydrateSignature() en hydrateFromCloud()");
  const listado = m[1]!
    .split(",")
    .map((s) => s.replace(/\/\/.*$/gm, "").trim())
    .filter(Boolean);

  it("incluye partidaRows — sin él, ningún cambio de partidas se ve en una sesión abierta", () => {
    expect(listado.some((x) => x.startsWith("partidaRows"))).toBe(true);
  });

  it("incluye accesorioRows — R89, el mismo defecto para otro modelo", () => {
    expect(listado).toContain("accesorioRows");
  });

  it("golden: la lista completa, en orden — agregar un modelo obliga a declararlo aquí", () => {
    expect(listado).toEqual([
      "units",
      "checklists",
      "semanales",
      "tallerCloud",
      "checkDones",
      "combustible",
      "validaciones",
      "complianceDocs",
      "accesorioRows",
      "anulaciones",
      "appConfigRows ?? []",
      "partidaRows ?? []",
    ]);
  });

  it("las partidas se leen UNA sola vez, dentro del Promise.all — nunca después del corto-circuito", () => {
    // `listTallerPartidas(` debe aparecer exactamente una vez (la del Promise.all)
    // y `fetchPartidas(` ninguna: la segunda lectura (L1295) desapareció con el fix.
    expect(src.match(/listTallerPartidas\(/g)?.length ?? 0).toBe(1);
    expect(src).not.toContain("fetchPartidas(");
    const idxFirma = src.indexOf("const snapshotSig = hydrateSignature([");
    expect(src.indexOf("listTallerPartidas(tenantId)")).toBeLessThan(idxFirma);
  });
});
