// tests/tallerPartidasVigentes.test.ts
//
// Fix ronda 1 (Task 7): una partida de una visita ANULADA no debe llegar al
// badge de firma — "anulación, nunca borrado" también aplica aquí. Cubre
// ambas direcciones (si solo se probara "se excluye", un filtro que tirara
// TODO también pasaría) más la reversibilidad de restaurar.
import { describe, it, expect } from "vitest";
import { partidasVigentes } from "../src/api/cloudHydrate";
import { buildAnuladasActivas, refIdTaller } from "../src/anulacion/anulacion";
import type { Partida } from "../src/taller/partidas";

const P = (visitaKey: string, partidaId: string): Partida => ({
  partidaId,
  visitaKey,
  descripcion: "x",
  estado: "propuesta",
  fotos: [],
});

describe("partidasVigentes — la anulación de la visita excluye sus partidas", () => {
  it("una partida de una visita ANULADA no pasa el filtro", () => {
    const anuladas = buildAnuladasActivas([
      {
        refId: refIdTaller("JV98698", "2026-09-01"),
        modulo: "taller",
        motivo: "duplicado",
        anuladoPor: "riesgos@gpa",
        ts: "2026-09-02T10:00:00Z",
      },
    ]);
    const ps = [P("JV98698|2026-09-01", "p1")];
    expect(partidasVigentes(ps, anuladas)).toEqual([]);
  });

  it("la misma partida SÍ pasa si su visita no está anulada", () => {
    const anuladas = buildAnuladasActivas([]);
    const ps = [P("JV98698|2026-09-01", "p1")];
    expect(partidasVigentes(ps, anuladas)).toEqual(ps);
  });

  it("otra visita distinta no se contagia de la anulación", () => {
    const anuladas = buildAnuladasActivas([
      { refId: refIdTaller("JV98698", "2026-09-01"), ts: "2026-09-02T10:00:00Z" },
    ]);
    const ps = [P("OTRA-PLACA|2026-09-01", "p1")];
    expect(partidasVigentes(ps, anuladas)).toEqual(ps);
  });

  it("restaurar la anulación (restauradaTs) vuelve a incluir la partida — recalculado, no cacheado", () => {
    const anuladas = buildAnuladasActivas([
      {
        refId: refIdTaller("JV98698", "2026-09-01"),
        ts: "2026-09-02T10:00:00Z",
        restauradaPor: "riesgos@gpa",
        restauradaTs: "2026-09-03T08:00:00Z",
      },
    ]);
    const ps = [P("JV98698|2026-09-01", "p1")];
    expect(partidasVigentes(ps, anuladas)).toEqual(ps);
  });
});
