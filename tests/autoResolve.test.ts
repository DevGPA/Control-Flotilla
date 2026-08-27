import { describe, expect, it } from "vitest";
import {
  evaluoKey,
  injectAutoResolve,
  purgeAutoEntries,
  type AutoRow,
} from "../src/analyzer/autoResolve";
import { mergeCheckDones } from "../src/api/mergeCheckDones";
import type { DoneMap } from "../src/analyzer/findingKey";

const row = (over: Partial<AutoRow>): AutoRow => ({
  uid: "ABC123__2026-06-02",
  plate: "ABC123",
  fecha: "2026-06-02",
  F: [],
  ...over,
});

const fTapetes = { key: "Bin:Tapetes completos", text: "Tapetes faltantes / incompletos" };
const fAceite = { key: "Fluido:Nivel de aceite de motor max", text: "aceite: nivel BAJO" };

describe("purgeAutoEntries", () => {
  it("elimina solo entradas auto y reporta uids tocados", () => {
    const cdb: Record<string, DoneMap> = {
      u1: {
        a: { done: true, auto: true, ts: "2026-07-06" },
        b: { done: true, ts: "2026-07-01T00:00:00Z" },
      },
      u2: { c: { done: false, ts: "2026-07-02T00:00:00Z" } },
    };
    expect(purgeAutoEntries(cdb)).toEqual(["u1"]);
    expect(Object.keys(cdb.u1!)).toEqual(["b"]);
    expect(Object.keys(cdb.u2!)).toEqual(["c"]);
  });
});

describe("evaluoKey — régimen retro (fila sin evaluatedKeys)", () => {
  it("Llanta solo con lectura numérica en tires", () => {
    const e = row({ T: { "Piloto Delantera": 6 } });
    expect(evaluoKey(e, "Llanta:Piloto Delantera")).toBe(true);
    expect(evaluoKey(e, "Llanta:Copiloto Delantera")).toBe(false);
  });

  it("Chk:Refaccion nunca (carve-out d0e7499)", () => {
    expect(evaluoKey(row({}), "Chk:Refaccion")).toBe(false);
  });

  it("Mant:Servicio con datos de km o con nextSvc parseable", () => {
    expect(evaluoKey(row({ km: "50000", kmNextSvc: "55000" }), "Mant:Servicio")).toBe(true);
    expect(evaluoKey(row({ nextSvc: "01/12/2026" }), "Mant:Servicio")).toBe(true);
    expect(evaluoKey(row({}), "Mant:Servicio")).toBe(false);
  });

  it("Bin/Fluido confiados; key legacy (texto display) nunca evaluada", () => {
    expect(evaluoKey(row({}), "Bin:Tapetes completos")).toBe(true);
    expect(evaluoKey(row({}), "Fluido:Nivel de aceite de motor max")).toBe(true);
    expect(evaluoKey(row({}), "Piloto Delantera: 4mm — revisar desgaste")).toBe(false);
  });

  it("con evaluatedKeys presente, manda la lista (incluye Chk:Refaccion)", () => {
    const e = row({ evaluatedKeys: ["Chk:Refaccion"] });
    expect(evaluoKey(e, "Chk:Refaccion")).toBe(true);
    expect(evaluoKey(e, "Bin:Tapetes completos")).toBe(false);
  });
});

describe("injectAutoResolve", () => {
  const jun = (over: Partial<AutoRow> = {}) =>
    row({ uid: "ABC123__2026-06-02", fecha: "2026-06-02", F: [fTapetes, fAceite], ...over });
  const jul = (over: Partial<AutoRow> = {}) =>
    row({ uid: "ABC123__2026-07-06", fecha: "2026-07-06", F: [], ...over });

  it("hallazgo desaparecido en la inspección nueva → entrada auto en la fila vieja", () => {
    const cdb: Record<string, DoneMap> = {};
    const mod = injectAutoResolve({ rows: [jul(), jun()], cdb });
    expect(mod).toEqual(["ABC123__2026-06-02"]);
    expect(cdb["ABC123__2026-06-02"]!["Bin:Tapetes completos"]).toEqual({
      done: true,
      ts: "2026-07-06",
      by: "auto",
      auto: true,
    });
  });

  it("hallazgo aún reportado en la nueva → sin entrada para esa key", () => {
    const cdb: Record<string, DoneMap> = {};
    injectAutoResolve({ rows: [jul({ F: [fTapetes] }), jun()], cdb });
    expect(cdb["ABC123__2026-06-02"]?.["Bin:Tapetes completos"]).toBeUndefined();
    expect(cdb["ABC123__2026-06-02"]?.["Fluido:Nivel de aceite de motor max"]?.auto).toBe(true);
  });

  it("evidencia con validationErrors se descarta por completo", () => {
    const cdb: Record<string, DoneMap> = {};
    injectAutoResolve({
      rows: [jul({ validationErrors: ["Datos de llantas incompletos (2/4)"] }), jun()],
      cdb,
    });
    expect(cdb["ABC123__2026-06-02"]).toBeUndefined();
  });

  it("tombstone humano POSTERIOR a la evidencia gana (sigue pendiente)", () => {
    const cdb: Record<string, DoneMap> = {
      "ABC123__2026-06-02": {
        "Bin:Tapetes completos": { done: false, ts: "2026-07-10T09:00:00Z" },
      },
    };
    injectAutoResolve({ rows: [jul(), jun()], cdb });
    expect(cdb["ABC123__2026-06-02"]!["Bin:Tapetes completos"]!.done).toBe(false);
    expect(cdb["ABC123__2026-06-02"]!["Fluido:Nivel de aceite de motor max"]!.auto).toBe(true);
  });

  it("tombstone humano ANTERIOR a la evidencia pierde (se tacha)", () => {
    const cdb: Record<string, DoneMap> = {
      "ABC123__2026-06-02": {
        "Bin:Tapetes completos": { done: false, ts: "2026-06-20T09:00:00Z" },
      },
    };
    injectAutoResolve({ rows: [jul(), jun()], cdb });
    expect(cdb["ABC123__2026-06-02"]!["Bin:Tapetes completos"]!.auto).toBe(true);
  });

  it("marca humana done:true se preserva (atribución intacta)", () => {
    const cdb: Record<string, DoneMap> = {
      "ABC123__2026-06-02": {
        "Bin:Tapetes completos": { done: true, ts: "2026-06-15T09:00:00Z", by: "navares@gpa" },
      },
    };
    injectAutoResolve({ rows: [jul(), jun()], cdb });
    expect(cdb["ABC123__2026-06-02"]!["Bin:Tapetes completos"]!.by).toBe("navares@gpa");
    expect(cdb["ABC123__2026-06-02"]!["Bin:Tapetes completos"]!.auto).toBeUndefined();
  });

  it("marca humana bajo el alias texto display también se respeta (dual-read)", () => {
    const cdb: Record<string, DoneMap> = {
      "ABC123__2026-06-02": {
        "Tapetes faltantes / incompletos": { done: true, ts: "2026-06-15T09:00:00Z", by: "x@gpa" },
      },
    };
    injectAutoResolve({ rows: [jul(), jun()], cdb });
    expect(cdb["ABC123__2026-06-02"]!["Bin:Tapetes completos"]).toBeUndefined();
  });

  it("usa la fila más reciente QUE EVALUÓ la key, no la más reciente absoluta", () => {
    const junLl = row({
      uid: "ABC123__2026-06-02",
      fecha: "2026-06-02",
      F: [{ key: "Llanta:Piloto Delantera", text: "Piloto Delantera: 3mm — desgaste crítico" }],
    });
    const julLl = row({
      uid: "ABC123__2026-07-06",
      fecha: "2026-07-06",
      F: [],
      T: { "Piloto Delantera": 8 },
    });
    const agoSinLlantas = row({ uid: "ABC123__2026-08-03", fecha: "2026-08-03", F: [] });
    const cdb: Record<string, DoneMap> = {};
    injectAutoResolve({ rows: [agoSinLlantas, julLl, junLl], cdb });
    expect(cdb["ABC123__2026-06-02"]!["Llanta:Piloto Delantera"]!.ts).toBe("2026-07-06");
  });

  it("si el hallazgo REAPARECE en una inspección más nueva, no se tacha en las viejas", () => {
    const ago = row({ uid: "ABC123__2026-08-03", fecha: "2026-08-03", F: [fTapetes] });
    const cdb: Record<string, DoneMap> = {};
    injectAutoResolve({ rows: [ago, jul(), jun({ F: [fTapetes] })], cdb });
    expect(cdb["ABC123__2026-06-02"]).toBeUndefined();
  });

  it("placas vacías/SIN_ID y placas con una sola fila se ignoran", () => {
    const cdb: Record<string, DoneMap> = {};
    const solo = row({ uid: "XYZ__2026-06-02", plate: "XYZ987", F: [fTapetes] });
    const sinId = row({ uid: "SIN_ID__2026-06-02", plate: "SIN_ID", F: [fTapetes] });
    expect(injectAutoResolve({ rows: [solo, sinId], cdb })).toEqual([]);
    expect(cdb).toEqual({});
  });
});

describe("ciclo purga → merge → inyección (spec §3/§7, integración pura)", () => {
  const junC = () => row({ uid: "ABC123__2026-06-02", fecha: "2026-06-02", F: [fTapetes] });
  const julC = () => row({ uid: "ABC123__2026-07-06", fecha: "2026-07-06", F: [] });
  const rowsRefs = [
    { uid: "ABC123__2026-06-02", plate: "ABC123" },
    { uid: "ABC123__2026-07-06", plate: "ABC123" },
  ];

  it("un auto de la ronda anterior no bloquea el re-merge de una marca humana", () => {
    const cdb: Record<string, DoneMap> = {};
    injectAutoResolve({ rows: [julC(), junC()], cdb }); // ronda 1
    expect(cdb["ABC123__2026-06-02"]!["Bin:Tapetes completos"]!.auto).toBe(true);
    // ronda 2: purga → merge (marca humana cloud con ts ANTERIOR al auto) → inyección
    purgeAutoEntries(cdb);
    mergeCheckDones({
      checkDones: [
        {
          unitUid: "ABC123",
          itemKey: "Bin:Tapetes completos",
          done: true,
          ts: "2026-06-15T09:00:00Z",
          por: "navares@gpa",
        },
      ],
      rows: rowsRefs,
      cdb,
    });
    injectAutoResolve({ rows: [julC(), junC()], cdb });
    const e = cdb["ABC123__2026-06-02"]!["Bin:Tapetes completos"]!;
    expect(e.by).toBe("navares@gpa"); // atribución humana intacta
    expect(e.auto).toBeUndefined();
  });

  it("al desaparecer la evidencia (anulada), el tachado desaparece en la siguiente ronda", () => {
    const cdb: Record<string, DoneMap> = {};
    injectAutoResolve({ rows: [julC(), junC()], cdb });
    purgeAutoEntries(cdb);
    injectAutoResolve({ rows: [junC()], cdb }); // julio anulada → ya no viene
    expect(cdb["ABC123__2026-06-02"]!["Bin:Tapetes completos"]).toBeUndefined();
  });

  it("idempotencia: dos rondas con los mismos datos → mismo estado", () => {
    const cdb: Record<string, DoneMap> = {};
    injectAutoResolve({ rows: [julC(), junC()], cdb });
    const snap = JSON.stringify(cdb);
    purgeAutoEntries(cdb);
    injectAutoResolve({ rows: [julC(), junC()], cdb });
    expect(JSON.stringify(cdb)).toBe(snap);
  });
});
