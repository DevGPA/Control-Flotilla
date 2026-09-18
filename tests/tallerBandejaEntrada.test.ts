import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");
const cuerpo = (n: string) => {
  const i = html.indexOf(`function ${n}(`);
  expect(i, n).toBeGreaterThan(-1);
  return html.slice(i, html.indexOf("\nfunction ", i + 10));
};

describe("pestaña Pendientes de firma", () => {
  it("la pestaña se llama Pendientes de firma", () => {
    const i = html.indexOf('id="tltab-bandeja"');
    expect(html.slice(i, i + 300)).toContain("Pendientes de firma");
  });

  it("ya no dice Por autorizar en la pestaña", () => {
    const i = html.indexOf('id="tltab-bandeja"');
    expect(html.slice(i, i + 300)).not.toContain("Por autorizar");
  });

  it("renderBandeja lista por UNIDAD y ya no pinta botones de decisión", () => {
    const c = cuerpo("renderBandeja");
    expect(c).toContain("window.__filasPendientes(");
    expect(c).toContain("Abrir registro");
    expect(c).not.toContain("_bnPartida(");
    expect(c).not.toContain("_bnGrupo(");
  });

  it("el botón abre el registro con el filtro en pendientes", () => {
    const c = cuerpo("renderBandeja");
    expect(c).toContain("openTallerModal(");
    expect(c).toContain('_provFiltro = "pendientes"');
  });

  it("vacío honesto", () => {
    expect(cuerpo("renderBandeja")).toContain("No hay partidas esperando tu firma");
  });

  it("la franja de resumen sigue viva — la aritmética no se reimplementa acá", () => {
    expect(cuerpo("renderBandeja")).toContain("window.__resumenBandeja(filas)");
  });

  it("cada fila trae el distintivo del proveedor", () => {
    expect(cuerpo("renderBandeja")).toContain("_provPill(");
  });

  it("el botón nunca abre el registro dos veces (stopPropagation antes de abrir)", () => {
    expect(cuerpo("renderBandeja")).toContain("stopPropagation");
  });

  it("el keydown de la fila no dispara cuando el evento viene del botón anidado", () => {
    expect(cuerpo("renderBandeja")).toContain("ev.target !== row");
  });

  it("el contexto anual ya no se calcula acá (Task 8)", () => {
    expect(cuerpo("renderBandeja")).not.toContain("__gastoAnualPorEco(");
  });

  it("el puente __filasPendientes se publica en cloudWire.ts", () => {
    const src = readFileSync(join(__dirname, "..", "src", "api", "cloudWire.ts"), "utf8");
    expect(src).toContain("window.__filasPendientes");
  });
});
