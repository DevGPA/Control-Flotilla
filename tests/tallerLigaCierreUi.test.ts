// tests/tallerLigaCierreUi.test.ts
//
// Task 6 del plan "la liga muere con la visita y ninguna visita hereda a otra"
// (spec docs/superpowers/specs/2026-09-22-taller-liga-cierre-y-llave-design.md).
// Pruebas ESTRUCTURALES sobre el monolito: el HTML no se puede importar, así que
// se lee como texto y se verifica que cada enganche exista, en el orden correcto
// y con los textos que ve el usuario. La regla de negocio vive en la capa pura
// (src/taller/llaveVisita.ts, src/taller/liga.ts) y ya tiene sus propias pruebas.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");
const cuerpo = (nombre: string): string => {
  const i = html.indexOf(`function ${nombre}(`);
  expect(i, `no existe ${nombre}`).toBeGreaterThan(-1);
  return html.slice(i, html.indexOf("\nfunction ", i + 10));
};

describe("decisión 1 — la guarda del alta en saveTallerEntry", () => {
  const c = cuerpo("saveTallerEntry");
  it("consulta window.__llaveEnUso ANTES de meter la visita en tallerEntries", () => {
    const iGuarda = c.indexOf("window.__llaveEnUso(");
    expect(iGuarda).toBeGreaterThan(-1);
    expect(iGuarda).toBeLessThan(c.indexOf("tallerEntries.push(entry)"));
  });
  it("si la llave está en uso NO guarda y explica (vigente / anulada), con foco en la fecha", () => {
    expect(c).toContain("ya tiene una visita con fecha de atención");
    expect(c).toContain("Cambia la fecha o abre la existente");
    expect(c).toContain("restáurala desde Anulados");
    expect(c).toContain('_markInvalid("tf-fentrada")');
  });
});

describe("decisión 3 — anular revoca la liga PRIMERO", () => {
  const i = html.indexOf('window.__anulaciones.anular(window.__tallerRefId(e),"taller",motivo)');
  const bloque = html.slice(html.lastIndexOf("onConfirm:async(motivo)=>{", i), i + 60);
  it("revoca (si la liga está activa O cerrada-pero-vigente) antes de anular, y aborta si revocar falla", () => {
    expect(bloque).toContain("__estadoLiga(e)");
    expect(bloque).toContain('"cerrada"');
    expect(bloque).toContain("__tallerLiga.revocar(");
    expect(bloque.indexOf("__tallerLiga.revocar(")).toBeLessThan(
      bloque.indexOf("__anulaciones.anular("),
    );
    expect(bloque).toContain("la visita no se anuló");
    expect(bloque).toMatch(/throw new Error\(/);
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
