// Tests de la Fase C1 (auditoría 2026-06-04): identidad estable de hallazgos
// (findingKey), lectura dual-read/LWW/corte-temporal (isFindingDone) y el merge
// puro de CheckDones cloud (mergeCheckDones). Cada bloque documenta el bug P1
// que previene.

import { describe, expect, it } from "vitest";
import {
  findingKey,
  isFindingDone,
  isoDayOf,
  plateOf,
  resolveDoneEntry,
  type DoneMap,
} from "../src/analyzer/findingKey";
import { analyzeRow } from "../src/analyzer/analyzeRow";
import { mergeCheckDones } from "../src/api/mergeCheckDones";

describe("findingKey — identidad estable", () => {
  it("usa f.key cuando existe, f.text como fallback", () => {
    expect(findingKey({ key: "Llanta:Refacción", text: "Refacción: 3mm — x" })).toBe(
      "Llanta:Refacción",
    );
    expect(findingKey({ text: "texto legacy sin key" })).toBe("texto legacy sin key");
  });

  it("analyzeRow genera la MISMA key aunque cambie el mm (el texto sí cambia)", () => {
    const rowA = { "Nivel TACO de llanta piloto delantera": "3" };
    const rowB = { "Nivel TACO de llanta piloto delantera": "2" };
    const fA = analyzeRow(rowA).F.find((f) => f.cat === "Llantas")!;
    const fB = analyzeRow(rowB).F.find((f) => f.cat === "Llantas")!;
    expect(fA.text).not.toBe(fB.text); // display distinto (3mm vs 2mm)
    expect(fA.key).toBe(fB.key); // identidad estable
    expect(fA.key).toMatch(/^Llanta:/);
  });

  it("keys sintéticas de analyzeRow cubren todas las categorías y nunca embeben valores", () => {
    const r = analyzeRow({
      "Cuenta con llanta de Refacción?": "No",
      "Nivel TACO de llanta piloto delantera": "2",
      "Luces y cuartos delanteros funcionando": "No",
      "Nivel de liquido de frenos max": "bajo",
      Kilometraje: "10000",
      "Kilometraje del siguiente servicio": "9000",
    });
    for (const f of r.F) {
      expect(f.key, `finding sin key: ${f.text}`).toMatch(/^(Llanta|Bin|Fluido|Mant|Chk):/);
      expect(f.key).not.toMatch(/\d+mm|\d+km|\d+ días/);
    }
  });
});

describe("isFindingDone — dual-read + LWW + tombstones (H1/H2)", () => {
  const f = { key: "Llanta:Piloto Delantera", text: "Piloto Delantera: 3mm — desgaste crítico" };

  it("lee marcas legacy guardadas bajo el TEXTO display (no huérfana el deploy)", () => {
    const dm: DoneMap = { [f.text]: { done: true, ts: "2026-06-01T10:00:00Z" } };
    expect(isFindingDone(dm, f)).toBe(true);
  });

  it("tombstone bajo la key nueva MATA una marca legacy más vieja (LWW)", () => {
    const dm: DoneMap = {
      [f.text]: { done: true, ts: "2026-06-01T10:00:00Z" },
      [f.key]: { done: false, ts: "2026-06-09T10:00:00Z" },
    };
    expect(isFindingDone(dm, f)).toBe(false);
  });

  it("marca nueva gana a tombstone viejo (re-marcar tras desmarcar)", () => {
    const dm: DoneMap = {
      [f.key]: { done: true, ts: "2026-06-09T12:00:00Z" },
      [f.text]: { done: false, ts: "2026-06-09T11:00:00Z" },
    };
    expect(isFindingDone(dm, f)).toBe(true);
  });

  it("entrada sin ts cuenta como la más vieja", () => {
    const dm: DoneMap = {
      [f.text]: { done: true }, // legacy sin ts
      [f.key]: { done: false, ts: "2026-06-09T10:00:00Z" },
    };
    expect(isFindingDone(dm, f)).toBe(false);
  });

  it("corte temporal: una inspección POSTERIOR a la marca sale pendiente", () => {
    const dm: DoneMap = { [f.key]: { done: true, ts: "2026-06-05T10:00:00Z" } };
    expect(isFindingDone(dm, f, "2026-06-01")).toBe(true); // inspección anterior → cubierta
    expect(isFindingDone(dm, f, "05/06/2026")).toBe(true); // mismo día (DMY) → cubierta
    expect(isFindingDone(dm, f, "2026-06-08")).toBe(false); // posterior → re-abre
  });

  it("sin fecha de fila o sin ts → la marca aplica", () => {
    expect(isFindingDone({ [f.key]: { done: true } }, f, "2026-06-08")).toBe(true);
    expect(isFindingDone({ [f.key]: { done: true, ts: "2026-06-05T10:00:00Z" } }, f)).toBe(true);
  });

  it("resolveDoneEntry devuelve la entrada ganadora", () => {
    const a = { done: true, ts: "2026-06-02T00:00:00Z" };
    const b = { done: false, ts: "2026-06-03T00:00:00Z" };
    expect(resolveDoneEntry({ [f.key]: a, [f.text]: b }, f)).toBe(b);
    expect(resolveDoneEntry({ [f.key]: a }, f)).toBe(a);
    expect(resolveDoneEntry({}, f)).toBeUndefined();
  });
});

describe("helpers", () => {
  it("plateOf extrae la placa de uids legacy placa__fecha", () => {
    expect(plateOf("ABC-123__2026-06-01")).toBe("ABC-123");
    expect(plateOf("ABC-123")).toBe("ABC-123");
    expect(plateOf(null)).toBe("");
  });
  it("isoDayOf normaliza DMY/ISO/Date", () => {
    expect(isoDayOf("05/06/2026")).toBe("2026-06-05");
    expect(isoDayOf("2026-06-05T10:30:00Z")).toBe("2026-06-05");
    expect(isoDayOf(new Date(2026, 5, 5))).toBe("2026-06-05");
    expect(isoDayOf("garbage")).toBe("");
  });
});

describe("mergeCheckDones — fan-out por placa, tombstones, dirty-skip", () => {
  const rows = [
    { uid: "ABC-123__2026-05-01", plate: "ABC-123" },
    { uid: "ABC-123__2026-06-01", plate: "ABC-123" },
    { uid: "XYZ-9__2026-06-01", plate: "XYZ-9" },
  ];

  it("aplica un CheckDone (unitUid=placa) a TODAS las filas de esa placa", () => {
    const { cdb, modifiedUids } = mergeCheckDones({
      checkDones: [{ unitUid: "ABC-123", itemKey: "Llanta:PD", done: true, ts: "2026-06-09" }],
      rows,
      cdb: {},
    });
    expect(modifiedUids.sort()).toEqual(
      ["ABC-123", "ABC-123__2026-05-01", "ABC-123__2026-06-01"].sort(),
    );
    expect(cdb["ABC-123__2026-05-01"]!["Llanta:PD"]!.done).toBe(true);
    expect(cdb["XYZ-9__2026-06-01"]).toBeUndefined();
  });

  it("registros legacy (unitUid=placa__fecha) hacen fan-out vía plateOf", () => {
    const { cdb } = mergeCheckDones({
      checkDones: [
        { unitUid: "ABC-123__2026-05-01", itemKey: "viejo texto", done: true, ts: "2026-01-01" },
      ],
      rows,
      cdb: {},
    });
    expect(cdb["ABC-123__2026-06-01"]!["viejo texto"]!.done).toBe(true);
  });

  it("tombstone (done:false) se ESCRIBE con su ts — no borra la entry (propaga desmarcados)", () => {
    const { cdb } = mergeCheckDones({
      checkDones: [{ unitUid: "ABC-123", itemKey: "Llanta:PD", done: false, ts: "2026-06-09" }],
      rows,
      cdb: { "ABC-123__2026-06-01": { "Llanta:PD": { done: true, ts: "2026-06-01" } } },
    });
    const e = cdb["ABC-123__2026-06-01"]!["Llanta:PD"]!;
    expect(e.done).toBe(false);
    expect(e.ts).toBe("2026-06-09");
  });

  it("dirty-skip: no pisa un toggle local más reciente que el snapshot", () => {
    const { cdb, modifiedUids } = mergeCheckDones({
      checkDones: [
        { unitUid: "ABC-123", itemKey: "Llanta:PD", done: true, ts: "2026-06-09T10:00:00Z" },
      ],
      rows,
      cdb: { "ABC-123__2026-06-01": { "Llanta:PD": { done: false, ts: "2026-06-09T11:00:00Z" } } },
      dirty: { "ABC-123 Llanta:PD": "2026-06-09T11:00:00Z" },
    });
    expect(cdb["ABC-123__2026-06-01"]!["Llanta:PD"]!.done).toBe(false); // intacto
    expect(modifiedUids).toEqual([]);
  });

  it("LWW por entrada: un registro cloud más viejo no pisa una entry local más nueva", () => {
    const { cdb } = mergeCheckDones({
      checkDones: [{ unitUid: "ABC-123", itemKey: "k", done: true, ts: "2026-06-01" }],
      rows,
      cdb: { "ABC-123__2026-06-01": { k: { done: false, ts: "2026-06-09" } } },
    });
    expect(cdb["ABC-123__2026-06-01"]!.k!.done).toBe(false);
  });

  it("ignora registros sin placa real (SIN_ID / vacíos)", () => {
    const { modifiedUids } = mergeCheckDones({
      checkDones: [
        { unitUid: "SIN_ID", itemKey: "k", done: true, ts: "2026-06-09" },
        { unitUid: "", itemKey: "k", done: true, ts: "2026-06-09" },
        { unitUid: "ABC-123", itemKey: "", done: true, ts: "2026-06-09" },
      ],
      rows,
      cdb: {},
    });
    expect(modifiedUids).toEqual([]);
  });
});
