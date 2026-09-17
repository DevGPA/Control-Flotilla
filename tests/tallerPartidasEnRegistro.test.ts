import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");
const cuerpo = (nombre: string): string => {
  const i = html.indexOf(`function ${nombre}(`);
  expect(i, `no existe ${nombre}`).toBeGreaterThan(-1);
  return html.slice(i, html.indexOf("\nfunction ", i + 10));
};

describe("partidas dentro del registro de la unidad", () => {
  it("_provPartidas reusa la fila de la bandeja, no reimplementa la decisión", () => {
    const c = cuerpo("_provPartidas");
    expect(c).toContain("_bnPartida(");
    expect(c).not.toContain("__guardarDecisionPartida(");
  });

  it("los cuatro filtros existen con sus conteos de la capa pura", () => {
    const c = cuerpo("_provPartidas");
    expect(c).toContain("window.__resumenPartidas(");
    for (const f of ["Todas", "Pendientes", "Autorizadas", "Rechazadas"]) {
      expect(c, `falta el filtro ${f}`).toContain(f);
    }
  });

  it("con el tri-estado en duda NO se pinta la lista ni se permite decidir", () => {
    const c = cuerpo("_provPartidas");
    expect(c).toContain("_partidasConfiables()");
    expect(c).toContain("No se pudieron cargar las partidas");
  });

  // Ruling del controlador: estos dos literales viven en _provFilaHistorial
  // (la fila de historial), no en _provPartidas — el brief original apuntaba
  // mal el ancla.
  it("el historial declara quién decidió, cuándo y el motivo", () => {
    const c = cuerpo("_provFilaHistorial");
    expect(c).toContain("decididoPor");
    expect(c).toContain("decididoEn");
    expect(c).toContain("motivoRechazo");
  });

  it("los borradores del taller se muestran sin botones de decisión", () => {
    const c = cuerpo("_provFilaHistorial");
    expect(c).toContain("Borrador del taller");
  });

  it("tras decidir se repinta el bloque, la tabla y el contador — sin recargar", () => {
    const c = cuerpo("_bnRepintar");
    expect(c).toContain("_provPartidas");
    expect(c).toContain("renderTaller");
    expect(c).toContain("updateTallerBadge");
  });

  it("pinta con textContent, nunca innerHTML", () => {
    expect(cuerpo("_provPartidas")).not.toContain(".innerHTML");
  });

  // ── Rulings del controlador: seis estados, filtro por visita, gasto vivo, visor ──

  it("el filtro Autorizadas incluye terminada, y la fila reusa el proveedor de la visita", () => {
    const c = cuerpo("_provPartidas");
    expect(c).toContain("terminada");
    expect(c).toContain("e.tecnico");
  });

  it("el historial pinta terminada y cancelada con su propio rótulo, sin innerHTML", () => {
    const c = cuerpo("_provFilaHistorial");
    expect(c).toContain("terminada");
    expect(c).toContain("TERMINADA");
    expect(c).toContain("CANCELADA");
    expect(c).not.toContain(".innerHTML");
  });

  it("la miniatura de la partida abre el visor de fotos", () => {
    const c = cuerpo("_bnThumb");
    expect(c).toContain("__abrirVisorFotos(");
    expect(c).toContain("aria-label");
  });

  it("openTallerModal delega #tf-gasto a _tfGastoPintar sin perder psGasto (lo usa el candado de identidad)", () => {
    const c = cuerpo("openTallerModal");
    expect(c).toContain("_tfGastoPintar(e)");
    expect(c).toContain("const psGasto = e ? _partidasDeVisita(e) : [];");
  });

  it("_bnRepintar también refresca #tf-gasto con el modal abierto", () => {
    expect(cuerpo("_bnRepintar")).toContain("_tfGastoPintar(");
  });

  it("_tfGastoPintar es el bloque real de Task 9 extraído, no una reescritura", () => {
    const c = cuerpo("_tfGastoPintar");
    expect(c).toContain("__gastoDerivado");
    expect(c).toContain("Suma de las partidas autorizadas");
  });
});
