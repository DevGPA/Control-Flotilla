import { describe, expect, it } from "vitest";
import { resumenLoteFirma } from "../src/api/tallerPartidas";
import { totalesVisita, type Partida } from "../src/taller/partidas";

/**
 * `resumenLoteFirma` — la aritmética del botón "Autorizar las N" de la
 * bandeja de firmas (fix ronda 1, Important 2). Antes vivía inline en
 * `Control de flotilla.html` (`_bnFooter`), donde ningún test la alcanzaba,
 * pese a ser exactamente el número que Ruling B existe para proteger: nunca
 * autorizar en silencio una partida sin precio.
 */
const P = (o: Partial<Partida>): Partida => ({
  partidaId: "p",
  visitaKey: "v",
  descripcion: "x",
  estado: "propuesta",
  fotos: [],
  ...o,
});

describe("resumenLoteFirma", () => {
  it("todas con precio: autorizables = todas, monto = autorizado previo + suma de precios", () => {
    const ps = [P({ partidaId: "a", precio: 1000 }), P({ partidaId: "b", precio: 2500 })];
    const totales = totalesVisita(ps); // autorizado=0 (ambas siguen "propuesta")
    const r = resumenLoteFirma(ps, totales);
    expect(r.autorizables.map((p) => p.partidaId)).toEqual(["a", "b"]);
    expect(r.monto).toBe(3500);
    expect(r.sinPrecio).toBe(0);
  });

  it("mixto: solo las que tienen precio entran al lote y al monto", () => {
    const ps = [
      P({ partidaId: "a", precio: 1800 }),
      P({ partidaId: "b" /* sin precio */ }),
      P({ partidaId: "c", precio: 400 }),
    ];
    const totales = totalesVisita(ps);
    const r = resumenLoteFirma(ps, totales);
    expect(r.autorizables.map((p) => p.partidaId)).toEqual(["a", "c"]);
    expect(r.monto).toBe(2200);
    expect(r.sinPrecio).toBe(1);
  });

  it("ninguna con precio: autorizables vacío, monto = lo ya autorizado (nada nuevo que firmar)", () => {
    const ps = [P({ partidaId: "a" }), P({ partidaId: "b" })];
    const totales = totalesVisita(ps);
    const r = resumenLoteFirma(ps, totales);
    expect(r.autorizables).toEqual([]);
    expect(r.monto).toBe(0);
    expect(r.sinPrecio).toBe(2);
  });

  it("el monto arranca de lo YA autorizado de la visita, no solo de este lote", () => {
    // Partidas ya autorizadas de OTRA ronda (no están en `ps`, pero sí en `totales`).
    const yaFirmadas = [P({ partidaId: "z", estado: "autorizada", precioAutorizado: 2400 })];
    const pendientes = [P({ partidaId: "a", precio: 1850 })];
    const totales = totalesVisita([...yaFirmadas, ...pendientes]);
    const r = resumenLoteFirma(pendientes, totales);
    expect(r.monto).toBe(2400 + 1850);
  });
});
