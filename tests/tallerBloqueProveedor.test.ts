import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");

describe("bloque Proveedor en el registro de la unidad", () => {
  it("existe bajo el apagador y después de la identificación", () => {
    const iIdent = html.indexOf(">Identificación de la unidad<");
    const iProv = html.indexOf('id="tf-proveedor"');
    // Texto EXACTO del encabezado de sección, no la subcadena suelta
    // ">Mantenimiento<": esa aparece antes, en un <option> de Área ajeno a
    // este modal (línea ~653), y un indexOf ingenuo la agarraba primero.
    const iMant = html.indexOf('<div class="tl-sec">Mantenimiento</div>');
    expect(iIdent).toBeGreaterThan(-1);
    expect(iProv).toBeGreaterThan(iIdent);
    expect(iProv).toBeLessThan(iMant);
    const tag = html.slice(html.lastIndexOf("<div", iProv), iProv + 200);
    expect(tag).toContain("needs-hibrido");
  });

  it("los botones de liga viven en el bloque, ya no en el pie del modal", () => {
    const iProv = html.indexOf('id="tf-proveedor"');
    const iFin = html.indexOf('id="tf-prov-partidas"', iProv);
    const bloque = html.slice(iProv, iFin);
    expect(bloque).toContain('id="btn-liga-copiar"');
    expect(bloque).toContain('id="btn-liga-revocar"');
    // El pie del MODAL DE TALLER es el próximo tl-mftr tras nuestro bloque —
    // no el primero del documento: otros modales (Agregar unidad, Editar
    // checklist, Accesorios…) también usan la clase tl-mftr antes que este.
    const pie = html.slice(html.indexOf('class="tl-mftr"', iFin));
    expect(pie).not.toContain('id="btn-liga-copiar"');
  });

  it("los botones de liga conservan needs-liga y needs-hibrido", () => {
    for (const id of ["btn-liga-copiar", "btn-liga-revocar"]) {
      const i = html.indexOf(`id="${id}"`);
      const tag = html.slice(html.lastIndexOf("<button", i), html.indexOf(">", i));
      expect(tag, id).toContain("needs-liga");
      expect(tag, id).toContain("needs-hibrido");
    }
  });

  it("_provPintar usa la capa pura y NUNCA recalcula fechas a mano", () => {
    const i = html.indexOf("function _provPintar(");
    expect(i).toBeGreaterThan(-1);
    const cuerpo = html.slice(i, html.indexOf("\nfunction ", i + 10));
    expect(cuerpo).toContain("window.__estadoLiga(");
    expect(cuerpo).toContain("window.__promesaTaller(");
    // Nada de aritmética de fechas inline en el monolito.
    expect(cuerpo).not.toMatch(/24\s*\*\s*60\s*\*\s*60/);
  });

  it("pinta con textContent, nunca con innerHTML", () => {
    const i = html.indexOf("function _provPintar(");
    const cuerpo = html.slice(i, html.indexOf("\nfunction ", i + 10));
    expect(cuerpo).not.toContain(".innerHTML");
  });

  it("openTallerModal llama a _provPintar solo con una visita persistida", () => {
    const i = html.indexOf("function openTallerModal(");
    const cuerpo = html.slice(i, html.indexOf("\nfunction closeTallerModal", i));
    expect(cuerpo).toContain("_provPintar(e)");
    expect(cuerpo).toMatch(/if\s*\(\s*e\s*\)\s*_provPintar\(e\)|e\s*\?\s*_provPintar\(e\)/);
  });

  // Important 2 (revisión final): kmTaller sin el km de ingreso al lado se
  // veía como el único dato — spec §4.1/§6.1.2 pide mostrar ambos si difieren.
  it("_provPintar muestra km del taller y km de ingreso cuando difieren", () => {
    const i = html.indexOf("function _provPintar(");
    const cuerpo = html.slice(i, html.indexOf("\nfunction ", i + 10));
    expect(cuerpo).toContain("km del taller");
    expect(cuerpo).toContain("km ingreso");
  });
});
