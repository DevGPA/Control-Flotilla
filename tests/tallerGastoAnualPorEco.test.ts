import { describe, expect, it } from "vitest";
import { gastoAnualPorEco } from "../src/taller/exportExcel";
import type { TallerEntry } from "../src/taller/types";

/**
 * `gastoAnualPorEco` — el número de contexto de la bandeja de firmas (Ruling A,
 * Task 8): "esta unidad ya lleva $X este año" antes de firmar una partida más.
 *
 * Reglas que este archivo fija con test propio (no las inventa `filasBandeja`,
 * que solo recibe el mapa ya armado):
 *  - Reusa gastoTotalDe (Ref+MO, fallback a `gasto`) — nunca una suma propia.
 *  - Solo CUENTAN visitas cerradas ("Finalizado"), mismo criterio que
 *    `resumenPorUnidad` — el costo de una visita abierta no es gasto real aún.
 *  - El año se lee de `fentrada` (fallback `freporte`), igual que `_mesDe` en
 *    el monolito — mismo ancla temporal en todo el módulo.
 *  - Agrupa por `eco`, no por unitKey/placa: la bandeja identifica unidades
 *    por económico.
 */
const entry = (over: Partial<TallerEntry> = {}): TallerEntry => ({
  id: "t1",
  estado: "Finalizado",
  eco: "42",
  fentrada: "2026-03-10",
  ...over,
});

describe("gastoAnualPorEco", () => {
  it("suma solo las visitas CERRADAS del año pedido, por eco", () => {
    const out = gastoAnualPorEco(
      [
        entry({ id: "a", gastoRef: 1000, gastoMO: 500 }), // cerrada, 2026 → cuenta
        entry({ id: "b", estado: "En Reparación", gasto: 9999 }), // abierta → NO cuenta
        entry({ id: "c", fentrada: "2025-11-01", gasto: 2000 }), // otro año → NO cuenta
      ],
      2026,
    );
    expect(out.get("42")).toEqual({ gasto: 1500, visitas: 1 });
  });

  it("usa gastoTotalDe: Ref+MO manda, `gasto` es el respaldo sin desglose", () => {
    const out = gastoAnualPorEco([entry({ gastoRef: 0, gastoMO: 0, gasto: 700 })], 2026);
    expect(out.get("42")?.gasto).toBe(700);
  });

  it("acumula varias visitas cerradas de la misma unidad en el año", () => {
    const out = gastoAnualPorEco(
      [entry({ id: "a", gasto: 1000 }), entry({ id: "b", gasto: 2500, fentrada: "2026-07-20" })],
      2026,
    );
    expect(out.get("42")).toEqual({ gasto: 3500, visitas: 2 });
  });

  it("separa por eco — no mezcla el gasto de dos unidades distintas", () => {
    const out = gastoAnualPorEco(
      [entry({ id: "a", eco: "42", gasto: 1000 }), entry({ id: "b", eco: "17", gasto: 2000 })],
      2026,
    );
    expect(out.get("42")).toEqual({ gasto: 1000, visitas: 1 });
    expect(out.get("17")).toEqual({ gasto: 2000, visitas: 1 });
  });

  it("cae a freporte cuando falta fentrada, igual que _mesDe en el monolito", () => {
    const out = gastoAnualPorEco(
      [entry({ fentrada: undefined, freporte: "2026-05-01", gasto: 800 })],
      2026,
    );
    expect(out.get("42")).toEqual({ gasto: 800, visitas: 1 });
  });

  it("sin eco, sin fecha o sin entries: mapa vacío, no truena", () => {
    expect(gastoAnualPorEco([], 2026).size).toBe(0);
    expect(gastoAnualPorEco([entry({ eco: "" })], 2026).size).toBe(0);
    expect(gastoAnualPorEco([entry({ fentrada: "", freporte: "" })], 2026).size).toBe(0);
  });
});
