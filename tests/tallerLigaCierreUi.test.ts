// tests/tallerLigaCierreUi.test.ts
//
// Task 6 del plan "la liga muere con la visita y ninguna visita hereda a otra"
// (spec docs/superpowers/specs/2026-09-22-taller-liga-cierre-y-llave-design.md).
// Pruebas ESTRUCTURALES sobre el monolito: el HTML no se puede importar, así que
// se lee como texto y se verifica que cada enganche exista, en el orden correcto
// y con los textos que ve el usuario. La regla de negocio vive en la capa pura
// (src/taller/llaveVisita.ts, src/taller/liga.ts) y ya tiene sus propias pruebas.
//
// Ola de arreglo (revisión final I1/I5 + T6 (3)/(4)): `cuerpo()` corta también en
// `async function` (antes seguía 277 líneas hasta deleteTallerEntry), la guarda del
// alta se exige ANTES de la rama de edición, el literal `entry={…}` debe arrastrar
// las columnas solo-nube (sin ellas cerrar desde el modal no revocaba), y lo que se
// afirma se busca en CÓDIGO, nunca en un comentario.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");

/** Cuerpo de una función del monolito: desde su declaración hasta la SIGUIENTE
 *  declaración a inicio de línea, sea `function` o `async function`. */
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

/** Quita los comentarios de línea: lo que se afirma debe estar en CÓDIGO. */
const sinComentarios = (s: string): string => s.replace(/^[ \t]*\/\/.*$/gm, "");

describe("decisión 1 — la guarda del alta en saveTallerEntry", () => {
  const c = cuerpo("saveTallerEntry");
  it("el cuerpo acotado es SOLO saveTallerEntry (no arrastra deleteTallerEntry)", () => {
    expect(c).not.toContain("function deleteTallerEntry");
    expect(c).toContain("tallerEntries.push(entry)");
  });
  it("consulta window.__llaveEnUso ANTES de la rama edición/alta (cubre EDITAR, no solo el alta)", () => {
    const iGuarda = c.indexOf("window.__llaveEnUso(");
    const iRama = c.indexOf("if(_tallerEditId){");
    expect(iGuarda).toBeGreaterThan(-1);
    expect(iRama).toBeGreaterThan(-1);
    expect(iGuarda).toBeLessThan(iRama);
    expect(iGuarda).toBeLessThan(c.indexOf("tallerEntries.push(entry)"));
  });
  it("si la llave está en uso NO guarda y explica (vigente / anulada), con foco en la fecha", () => {
    expect(c).toContain("ya tiene una visita con fecha de atención");
    expect(c).toContain("Cambia la fecha o abre la existente");
    expect(c).toContain("restáurala desde Anulados");
    expect(c).toContain('_markInvalid("tf-fentrada")');
  });
});

describe("decisión 2 (I1) — el entry que arma el modal conserva las columnas solo-nube", () => {
  const c = cuerpo("saveTallerEntry");
  const a = c.indexOf("const entry={");
  const literal = a > -1 ? sinComentarios(c.slice(a, c.indexOf("\n  };", a))) : "";
  it("existe el literal entry={…}", () => {
    expect(a).toBeGreaterThan(-1);
    expect(literal.length).toBeGreaterThan(0);
  });
  // Sin estas cinco, `revocacionPorCierre` ve un entry "sin-liga" (cerrar desde el modal no
  // revoca — decisión 2) y `__estadoLiga` también (anular tras editar no revoca — decisión 3).
  for (const col of [
    "ligaVersion",
    "ligaCreadaEn",
    "ligaCreadaPor",
    "ligaRevocadaEn",
    "ligaRevocadaPor",
  ]) {
    it(`arrastra ${col} de srcEntry (la liga la cuelga la hidratación, no el formulario)`, () => {
      expect(literal).toMatch(new RegExp(`^\\s*${col}:\\s*srcEntry\\?\\.${col},`, "m"));
    });
  }
  // Lo que reporta el proveedor y la marca de la migración: misma pérdida (preexistente),
  // mismo remedio.
  for (const col of [
    "estadoOperativo",
    "kmTaller",
    "fsalidaEstTaller",
    "fsalidaEstCompromiso",
    "_cloud",
  ]) {
    it(`arrastra ${col} de srcEntry`, () => {
      expect(literal).toMatch(new RegExp(`^\\s*${col}:\\s*srcEntry\\?\\.${col},`, "m"));
    });
  }
});

describe("decisión 3 — anular revoca la liga PRIMERO", () => {
  const i = html.indexOf('window.__anulaciones.anular(window.__tallerRefId(e),"taller",motivo)');
  const bloque = html.slice(html.lastIndexOf("onConfirm:async(motivo)=>{", i), i + 60);
  const codigo = sinComentarios(bloque);
  it("revoca si la liga está activa O cerrada-pero-vigente (en CÓDIGO, no en un comentario)", () => {
    expect(codigo).toContain("__estadoLiga(e)");
    expect(codigo).toContain('ligaE === "activa"');
    expect(codigo).toContain('ligaE === "cerrada"');
  });
  it("revoca ANTES de anular y, si revocar falla, aborta con UN solo mensaje legible (ErrorLegible)", () => {
    expect(codigo).toContain("__tallerLiga.revocar(");
    expect(codigo.indexOf("__tallerLiga.revocar(")).toBeLessThan(
      codigo.indexOf("__anulaciones.anular("),
    );
    expect(codigo).toMatch(/throw new window\.__anulacionUI\.ErrorLegible\(/);
    expect(codigo).toContain("la visita no se anuló");
    // El toast se fue: la causa la pinta el overlay (src/anulacion/ui.ts) y nada más —
    // antes la persona veía dos explicaciones distintas.
    expect(codigo).not.toContain("window.notify");
  });
});

describe("decisión 5 — el bloque Proveedor dice 'Liga cerrada con la visita'", () => {
  const c = cuerpo("_provPintar");
  it("pinta el estado 'cerrada' con su leyenda", () => {
    expect(c).toContain('liga.kind === "cerrada"');
    expect(c).toContain("Liga cerrada con la visita");
  });
  it("sigue sin innerHTML", () => {
    expect(c).not.toContain(".innerHTML");
  });
});

describe("higiene — el marcador rojo de un bloqueo no se queda pegado al abrir otra visita (C13)", () => {
  it("openTallerModal limpia el marcador de TODOS los campos que saveTallerEntry puede marcar", () => {
    const abrir = sinComentarios(cuerpo("openTallerModal"));
    const guardar = sinComentarios(cuerpo("saveTallerEntry"));
    const i = abrir.indexOf("_clearInvalid([");
    expect(i, "openTallerModal no llama _clearInvalid").toBeGreaterThan(-1);
    const lista = abrir.slice(i, abrir.indexOf("]", i));
    // Cada campo que saveTallerEntry marca con _markInvalid debe estar en la lista que se limpia.
    const marcados = [...guardar.matchAll(/_markInvalid\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(marcados.length).toBeGreaterThan(0);
    for (const id of marcados) expect(lista, `falta ${id}`).toContain(`"${id}"`);
    expect(lista).toContain('"tf-fentrada"');
  });
  it("_clearInvalid deshace exactamente lo que pone _markInvalid (outline y outlineOffset)", () => {
    const c = sinComentarios(cuerpo("_clearInvalid"));
    expect(c).toContain('el.style.outline=""');
    expect(c).toContain('el.style.outlineOffset=""');
  });
});
