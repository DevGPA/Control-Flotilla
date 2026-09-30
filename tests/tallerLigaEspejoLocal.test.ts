// tests/tallerLigaEspejoLocal.test.ts
//
// Espejo local inmediato de la liga (spec §4.2, decisión 2 — hallazgo de la prueba en Chrome
// 2026-09-24): al EMITIR y al REVOCAR, el puente `window.__tallerLiga` relee la fila de la nube
// y devuelve `liga` (las cinco columnas, vía `columnasLigaDe`), y el monolito la espeja en la copia
// local (`Object.assign` + `saveTallerDB` + `_provPintar`). Sin esto, emitir y dar salida SIN
// recargar dejaba un entry sin `ligaCreadaEn`: `cierraVisitaConLiga` decía false, la subida no
// releía la nube y la liga NO se revocaba (revivía al reabrir).
//
// Pruebas ESTRUCTURALES (patrón de tallerCierreRevocaLiga.test.ts y tallerLigaCierreUi.test.ts):
// cloudWire.ts y el HTML se leen como texto; lo que se afirma se busca en CÓDIGO, no en comentarios.
// La regla de negocio (estadoLiga / columnasLigaDe) ya tiene sus pruebas puras.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const raiz = join(__dirname, "..");
const wire = readFileSync(join(raiz, "src", "api", "cloudWire.ts"), "utf8");
const html = readFileSync(join(raiz, "Control de flotilla.html"), "utf8");

/** Quita los comentarios de línea: lo que se afirma debe estar en CÓDIGO. */
const sinComentarios = (s: string): string => s.replace(/^[ \t]*\/\/.*$/gm, "");

/** Cuerpo de una función del monolito: desde su declaración hasta la SIGUIENTE
 *  declaración a inicio de línea, sea `function` o `async function`.
 *  (Copiado de tallerLigaCierreUi.test.ts a propósito: cada archivo es autónomo.) */
const cuerpo = (nombre: string): string => {
  const i = html.indexOf(`function ${nombre}(`);
  expect(i, `no existe ${nombre}`).toBeGreaterThan(-1);
  const cortes = [
    html.indexOf("\nfunction ", i + 10),
    html.indexOf("\nasync function ", i + 10),
  ].filter((k) => k > -1);
  expect(cortes.length, `no encontré el fin de ${nombre}`).toBeGreaterThan(0);
  return html.slice(i, Math.min(...cortes));
};

/** Un método del literal `window.__tallerLiga = {…}` de cloudWire: desde `nombre: async`
 *  hasta el siguiente método (`siguiente: async`). */
const metodoPuente = (nombre: string, siguiente: string): string => {
  const bloque = wire.indexOf("window.__tallerLiga = {");
  expect(bloque, "no existe window.__tallerLiga = {").toBeGreaterThan(-1);
  const a = wire.indexOf(`${nombre}: async`, bloque);
  const b = wire.indexOf(`${siguiente}: async`, a + 1);
  expect(a, `no existe el método ${nombre}`).toBeGreaterThan(-1);
  expect(b, `no encontré el fin de ${nombre} (${siguiente})`).toBeGreaterThan(a);
  return sinComentarios(wire.slice(a, b));
};

describe("cloudWire — el puente relee la nube y devuelve `liga` al emitir y al revocar", () => {
  it("importa columnasLigaDe (y el tipo ColumnasLiga) de ../taller/liga — la ÚNICA proyección nube→entry", () => {
    const m = wire.match(/import\s*\{([^}]*)\}\s*from\s*"\.\.\/taller\/liga";/);
    expect(m, 'no hay import de "../taller/liga"').not.toBeNull();
    expect(m![1]).toContain("columnasLigaDe");
    expect(m![1]).toContain("ColumnasLiga");
  });

  it("importa getTaller de ./client (la relectura lanza si AppSync devuelve errores)", () => {
    const m = wire.match(/import\s*\{([^}]*)\}\s*from\s*"\.\/client";/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/\bgetTaller\b/);
  });

  it("emitir: llama getTaller( DESPUÉS de generarLigaTaller y devuelve liga: columnasLigaDe(", () => {
    const c = metodoPuente("emitir", "revocar");
    const iMut = c.indexOf("generarLigaTaller(");
    const iGet = c.indexOf("getTaller(");
    expect(iMut, "emitir no llama generarLigaTaller").toBeGreaterThan(-1);
    expect(iGet, "emitir no relee con getTaller").toBeGreaterThan(-1);
    expect(iGet).toBeGreaterThan(iMut);
    expect(c).toContain("liga: columnasLigaDe(");
    // La sesión ya no se descarta: hace falta su tenantId para releer la fila.
    expect(c).toMatch(/const session = await ensureSession\(\)/);
    expect(c).toContain("session.tenantId");
  });

  it("revocar: llama getTaller( DESPUÉS de revocarLigaTaller y devuelve liga: columnasLigaDe(", () => {
    const c = metodoPuente("revocar", "estado");
    const iMut = c.indexOf("revocarLigaTaller(");
    const iGet = c.indexOf("getTaller(");
    expect(iMut, "revocar no llama revocarLigaTaller").toBeGreaterThan(-1);
    expect(iGet, "revocar no relee con getTaller").toBeGreaterThan(-1);
    expect(iGet).toBeGreaterThan(iMut);
    expect(c).toContain("liga: columnasLigaDe(");
    expect(c).toMatch(/const session = await ensureSession\(\)/);
    expect(c).toContain("session.tenantId");
  });

  it("si la relectura falla, la emisión/revocación YA ocurrió: se devuelve sin `liga` y se avisa (console.warn), NUNCA {error}", () => {
    for (const [nombre, sig] of [
      ["emitir", "revocar"],
      ["revocar", "estado"],
    ] as const) {
      const c = metodoPuente(nombre, sig);
      const iGet = c.indexOf("getTaller(");
      const tras = c.slice(iGet);
      expect(tras, `${nombre}: la relectura no va en try/catch`).toMatch(/catch\s*\(/);
      expect(tras, `${nombre}: la relectura fallida no avisa`).toContain("console.warn(");
      // Dentro del catch de la relectura no se devuelve {error}.
      const catchBody = tras.slice(tras.indexOf("catch"));
      expect(catchBody.slice(0, catchBody.indexOf("}") + 1)).not.toContain("error:");
    }
  });

  it("el tipo del puente declara `liga?: ColumnasLiga` en emitir y en revocar", () => {
    const a = wire.indexOf("__tallerLiga?: {");
    expect(a).toBeGreaterThan(-1);
    const decl = wire.slice(a, wire.indexOf("mensajeWhatsApp: typeof mensajeWhatsApp", a));
    const tEmitir = decl.slice(decl.indexOf("emitir:"), decl.indexOf("revocar:"));
    const tRevocar = decl.slice(decl.indexOf("revocar:"), decl.indexOf("estado:"));
    expect(tEmitir).toMatch(/url: string;\s*expira: number;\s*liga\?: ColumnasLiga/);
    expect(tRevocar).toMatch(/ligaVersion: number;\s*liga\?: ColumnasLiga/);
  });
});

describe("monolito — copiarLigaProveedor espeja la liga releída en la copia local", () => {
  const c = sinComentarios(cuerpo("copiarLigaProveedor"));
  it("el cuerpo acotado es SOLO copiarLigaProveedor (no arrastra revocarLigaProveedor)", () => {
    expect(c).not.toContain("function revocarLigaProveedor");
  });
  it("hace Object.assign(e, r.liga), saveTallerDB() y _provPintar(e) — en CÓDIGO", () => {
    expect(c).toContain("Object.assign(e, r.liga)");
    expect(c).toContain("saveTallerDB()");
    expect(c).toContain("_provPintar(e)");
  });
  it("el espejo va DESPUÉS de descartar {error} y ANTES de componer el mensaje de WhatsApp", () => {
    const iError = c.indexOf('"error" in r');
    const iEspejo = c.indexOf("Object.assign(e, r.liga)");
    const iMsg = c.indexOf("mensajeWhatsApp(");
    expect(iError).toBeGreaterThan(-1);
    expect(iMsg).toBeGreaterThan(-1);
    expect(iEspejo).toBeGreaterThan(iError);
    expect(iEspejo).toBeLessThan(iMsg);
  });
  it("sigue componiendo el mensaje, copiando al portapapeles y mostrando el botón Revocar", () => {
    expect(c).toContain("navigator.clipboard.writeText(msg)");
    expect(c).toContain("mostrarTextoParaCopiar(msg)");
    expect(c).toContain('getElementById("btn-liga-revocar")');
  });
  it("sigue sin innerHTML", () => {
    expect(c).not.toContain(".innerHTML");
  });
});

describe("monolito — revocarLigaProveedor espeja la revocación releída en la copia local", () => {
  const c = sinComentarios(cuerpo("revocarLigaProveedor"));
  it("el cuerpo acotado es SOLO revocarLigaProveedor", () => {
    expect(c).not.toContain("function mostrarTextoParaCopiar");
    expect(c).not.toContain("function copiarLigaProveedor");
  });
  it("hace Object.assign(e, r.liga), saveTallerDB() y _provPintar(e) — en CÓDIGO", () => {
    expect(c).toContain("Object.assign(e, r.liga)");
    expect(c).toContain("saveTallerDB()");
    expect(c).toContain("_provPintar(e)");
  });
  it("el espejo va DESPUÉS de descartar {error} y conserva el aviso 'Liga revocada.'", () => {
    const iError = c.indexOf('"error" in r');
    const iEspejo = c.indexOf("Object.assign(e, r.liga)");
    expect(iError).toBeGreaterThan(-1);
    expect(iEspejo).toBeGreaterThan(iError);
    expect(c).toContain('"Liga revocada."');
  });
  it("sigue sin innerHTML", () => {
    expect(c).not.toContain(".innerHTML");
  });
});

describe("espejo local — pulido de la revisión (carrera del modal y rechazo de IndexedDB)", () => {
  for (const fn of ["copiarLigaProveedor", "revocarLigaProveedor"]) {
    it(`${fn}: repinta el bloque SOLO si el modal sigue en esta visita y maneja el rechazo de saveTallerDB`, () => {
      const c = sinComentarios(cuerpo(fn));
      expect(c).toContain("_tallerEditId===e.id) _provPintar(e)");
      expect(c).toContain("saveTallerDB().catch(");
    });
  }
});
