// tests/tallerPartidasVigentes.test.ts
//
// Fix ronda 1 (Task 7): una partida de una visita ANULADA no debe llegar al
// badge de firma — "anulación, nunca borrado" también aplica aquí.
//
// Fix ronda 2: el filtro es FORWARD-ONLY. `visitasAnuladasKeys` construye el
// set de visitaKey de las visitas anuladas HACIA ADELANTE (juntaVisitaKey
// sobre las filas cloud de Taller), nunca separando de vuelta una visitaKey
// existente — la versión anterior invertía `visitaKey` con un `.split("|")`
// y un `unitUid` con un "|" propio la hacía fallar en silencio.
// `partidasVigentes` es ahora un filtro de membresía de set, puro y simple.
import { describe, it, expect } from "vitest";
import { partidasVigentes, visitasAnuladasKeys } from "../src/api/cloudHydrate";
import { buildAnuladasActivas, refIdTaller } from "../src/anulacion/anulacion";
import type { Partida } from "../src/taller/partidas";

const P = (visitaKey: string, partidaId: string): Partida => ({
  partidaId,
  visitaKey,
  descripcion: "x",
  estado: "propuesta",
  fotos: [],
});

describe("visitasAnuladasKeys — construye la llave HACIA ADELANTE, nunca separa una existente", () => {
  it("una fila de Taller anulada aporta su visitaKey al set", () => {
    const anuladas = buildAnuladasActivas([
      { refId: refIdTaller("JV98698", "2026-09-01"), ts: "2026-09-02T10:00:00Z" },
    ]);
    const set = visitasAnuladasKeys([{ unitUid: "JV98698", fechaEntrada: "2026-09-01" }], anuladas);
    expect(set.has("JV98698|2026-09-01")).toBe(true);
    expect(set.size).toBe(1);
  });

  it("una fila que NO está anulada no aporta nada", () => {
    const set = visitasAnuladasKeys(
      [{ unitUid: "JV98698", fechaEntrada: "2026-09-01" }],
      buildAnuladasActivas([]),
    );
    expect(set.size).toBe(0);
  });

  it("restaurar la anulación (restauradaTs) la saca del set — recalculado, no cacheado", () => {
    const anuladas = buildAnuladasActivas([
      {
        refId: refIdTaller("JV98698", "2026-09-01"),
        ts: "2026-09-02T10:00:00Z",
        restauradaPor: "riesgos@gpa",
        restauradaTs: "2026-09-03T08:00:00Z",
      },
    ]);
    const set = visitasAnuladasKeys([{ unitUid: "JV98698", fechaEntrada: "2026-09-01" }], anuladas);
    expect(set.size).toBe(0);
  });

  it("un unitUid que contiene '|' se junta igual — no hay separación que pueda confundirse", () => {
    const anuladas = buildAnuladasActivas([
      { refId: refIdTaller("JV|98698", "2026-09-01"), ts: "2026-09-02T10:00:00Z" },
    ]);
    const set = visitasAnuladasKeys(
      [{ unitUid: "JV|98698", fechaEntrada: "2026-09-01" }],
      anuladas,
    );
    expect(set.has("JV|98698|2026-09-01")).toBe(true);
  });

  it("el fallback sin-fecha:<id> (visita sin fentrada/freporte) también junta bien", () => {
    const anuladas = buildAnuladasActivas([
      { refId: refIdTaller("JV98698", "sin-fecha:tl_1"), ts: "2026-09-02T10:00:00Z" },
    ]);
    const set = visitasAnuladasKeys(
      [{ unitUid: "JV98698", fechaEntrada: "sin-fecha:tl_1" }],
      anuladas,
    );
    expect(set.has("JV98698|sin-fecha:tl_1")).toBe(true);
  });
});

describe("partidasVigentes — excluye partidas cuya visitaKey está en el set de anuladas", () => {
  it("partida de visita anulada → excluida", () => {
    const anuladas = new Set(["JV98698|2026-09-01"]);
    expect(partidasVigentes([P("JV98698|2026-09-01", "p1")], anuladas)).toEqual([]);
  });

  it("la misma partida SÍ pasa si su visita no está en el set", () => {
    const anuladas = new Set<string>();
    const ps = [P("JV98698|2026-09-01", "p1")];
    expect(partidasVigentes(ps, anuladas)).toEqual(ps);
  });

  it("otra visita distinta no se contagia de la anulación de la primera", () => {
    const anuladas = new Set(["JV98698|2026-09-01"]);
    const ps = [P("OTRA-PLACA|2026-09-01", "p1")];
    expect(partidasVigentes(ps, anuladas)).toEqual(ps);
  });

  it("un unitUid con '|' se excluye correctamente END-TO-END (visitasAnuladasKeys + partidasVigentes)", () => {
    const anuladas = visitasAnuladasKeys(
      [{ unitUid: "JV|98698", fechaEntrada: "2026-09-01" }],
      buildAnuladasActivas([
        { refId: refIdTaller("JV|98698", "2026-09-01"), ts: "2026-09-02T10:00:00Z" },
      ]),
    );
    const ps = [P("JV|98698|2026-09-01", "p1")];
    expect(partidasVigentes(ps, anuladas)).toEqual([]);
  });

  it("el fallback sin-fecha:<id> se excluye correctamente END-TO-END", () => {
    const anuladas = visitasAnuladasKeys(
      [{ unitUid: "JV98698", fechaEntrada: "sin-fecha:tl_1" }],
      buildAnuladasActivas([
        { refId: refIdTaller("JV98698", "sin-fecha:tl_1"), ts: "2026-09-02T10:00:00Z" },
      ]),
    );
    const ps = [P("JV98698|sin-fecha:tl_1", "p1")];
    expect(partidasVigentes(ps, anuladas)).toEqual([]);
  });
});
