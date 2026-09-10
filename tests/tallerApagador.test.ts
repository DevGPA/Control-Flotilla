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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { esquemaHibridoActivo } from "../src/taller/partidas";
import type { Partida } from "../src/taller/partidas";
import { visitaKeyDe } from "../src/api/tallerPartidas";
import { uploadTallerToCloud, type LegacyTallerEntry } from "../src/api/batchUpload";

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

describe("R62 — con el switch apagado, la derivación de partidas no aplica en ningún lado", () => {
  const ps: Partida[] = [
    {
      partidaId: "p1",
      visitaKey: "ABC-123|2026-08-01",
      descripcion: "Refacción mayor",
      estado: "autorizada",
      precio: 1500,
      precioAutorizado: 1500,
      tipo: "refaccion",
      fotos: [],
    },
  ];
  const entryConPartidas: LegacyTallerEntry = {
    id: "tl_x",
    plate: "ABC-123",
    fentrada: "2026-08-01",
    estado: "Finalizado",
    gasto: 999,
    gastoRef: 0,
    gastoMO: 0,
  };
  const porVisita = new Map<string, Partida[]>([["ABC-123|2026-08-01", ps]]);

  it("switch APAGADO: el tecleado sobrevive intacto — la visita CON partidas sube su gasto tal cual (Ruling R62)", async () => {
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
