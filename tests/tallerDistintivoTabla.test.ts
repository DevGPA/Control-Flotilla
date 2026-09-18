import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");
const cuerpo = (nombre: string): string => {
  const i = html.indexOf(`function ${nombre}(`);
  expect(i, `no existe ${nombre}`).toBeGreaterThan(-1);
  return html.slice(i, html.indexOf("\nfunction ", i + 10));
};

describe("distintivo del proveedor en la tabla de Taller", () => {
  it("la columna existe en el arreglo de columnas y está bajo el apagador", () => {
    expect(html).toContain('{lbl:"Proveedor", key:"proveedor"');
    const i = html.indexOf('{lbl:"Proveedor", key:"proveedor"');
    expect(html.slice(i, i + 200)).toContain("needs-hibrido");
  });

  it("la celda usa la capa pura y arma la pastilla, no una regla propia", () => {
    const c = cuerpo("_provCelda");
    expect(c).toContain("window.__distintivoProveedor(");
    expect(c).toContain("_partidasConfiables()");
    expect(c).toContain("_provPill(");
    expect(c).not.toContain(".innerHTML");
  });

  it("la pastilla sale de la etiqueta de la capa pura y tacha la liga revocada", () => {
    const c = cuerpo("_provPill");
    expect(c).toContain("window.__etiquetaDistintivo(");
    expect(c).not.toContain(".innerHTML");
    expect(c).toContain("line-through");
  });

  it("renderActivas pinta la celda con DOM tras el innerHTML, colspan 12 en el vacío, y ordena por urgencia", () => {
    const iInicio = html.indexOf("function renderActivas(");
    expect(iInicio).toBeGreaterThan(-1);
    const iFin = html.indexOf("\nfunction renderHistorial", iInicio);
    expect(iFin).toBeGreaterThan(iInicio);
    const c = html.slice(iInicio, iFin);
    expect(c).toContain("data-prov-cell");
    expect(c).toContain("td[data-prov-cell]");
    expect(c).toContain("_provCelda(");
    expect(c).toContain('colspan="12"');
    expect(c).not.toContain('colspan="11"');
    expect(c).toContain("__prioridadDistintivo");
  });

  // Deferred minor L488 (revisión final): en modo degradado (sin partidas
  // confiables o sin los puentes) el orden efectivo cae a días, no a
  // "proveedor" — la flechita/resaltado en ese encabezado mentía sobre
  // cómo quedó ordenada la tabla.
  it("el encabezado Proveedor no se marca activo cuando _provRanks es null (orden degradado)", () => {
    const iInicio = html.indexOf("function renderActivas(");
    const iFin = html.indexOf("\nfunction renderHistorial", iInicio);
    const c = html.slice(iInicio, iFin);
    expect(c).toContain('c.key==="proveedor" && !_provRanks');
  });
});

describe("puente __prioridadDistintivo en cloudWire", () => {
  it("cloudWire expone window.__prioridadDistintivo = prioridadDistintivo", () => {
    const cloudWire = readFileSync(join(__dirname, "..", "src", "api", "cloudWire.ts"), "utf8");
    expect(cloudWire).toContain("window.__prioridadDistintivo = prioridadDistintivo");
  });
});
