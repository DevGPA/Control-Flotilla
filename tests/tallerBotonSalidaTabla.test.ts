// tests/tallerBotonSalidaTabla.test.ts
//
// Hallazgo C8 de la prueba en Chrome real (2026-09-23): el boton "✓ Salida" de la tabla de
// Operaciones Activas no hacia nada. Desde el refactor XSS (commit 50a681a) el boton usa
// data-action y lo atiende UN repartidor en `document` (fase de burbuja), pero su celda
// conservaba `onclick="event.stopPropagation()"` de la epoca del onclick inline: el clic
// moria en la celda y nunca llegaba al repartidor. El boton ya trae data-stop-propagation="1",
// que es lo que evita que el clic abra la fila. Preexistente en main; corregido aqui.
// Ademas dos textos rotos que la misma prueba vio en pantalla.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");

describe("boton ✓ Salida de la tabla de taller (C8)", () => {
  it("la celda que envuelve al boton NO se traga el clic con un onclick inline", () => {
    const i = html.indexOf('data-action="finalizarUnidad"');
    expect(i, "no existe el boton finalizarUnidad").toBeGreaterThan(-1);
    // La etiqueta <td ...> inmediatamente anterior al boton.
    const iTd = html.lastIndexOf("<td", i);
    const td = html.slice(iTd, html.indexOf(">", iTd) + 1);
    expect(td, `la celda es ${td}`).not.toContain("onclick");
  });
  it("el boton sigue frenando la propagacion por dataset (para no abrir la fila) y el repartidor lo honra", () => {
    const i = html.indexOf('data-action="finalizarUnidad"');
    const boton = html.slice(html.lastIndexOf("<button", i), html.indexOf(">", i) + 1);
    expect(boton).toContain('data-stop-propagation="1"');
    expect(html).toContain('if(el.dataset.stopPropagation === "1") e.stopPropagation();');
  });
  it("ninguna otra celda con onclick=stopPropagation envuelve un control data-action (misma trampa)", () => {
    const trampa = /<td[^>]*onclick="event\.stopPropagation\(\)"[^>]*>\s*<button[^>]*data-action=/g;
    expect(html.match(trampa) ?? []).toEqual([]);
  });
});

describe("textos que la prueba en Chrome vio rotos en pantalla", () => {
  it('el aviso de urgentes en singular lleva espacio: "1 unidad lleva", no "1 unidadlleva"', () => {
    expect(html).toContain('unidad${urgEcos.length>1?"es llevan":" lleva"}');
    expect(html).not.toContain('unidad${urgEcos.length>1?"es llevan":"lleva"}');
  });
  it('el confirm de Finalizar dice "reingresarla"', () => {
    expect(html).not.toContain("reingresorla");
    expect(html).toContain("Podrás reingresarla en cualquier momento");
  });
});
