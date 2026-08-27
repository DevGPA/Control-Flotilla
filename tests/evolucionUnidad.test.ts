import { describe, it, expect } from "vitest";
import { buildEvolucionUnidad, countInspecciones } from "../src/inspecciones/evolucionUnidad";
import type { Unit, ChecklistDB, Finding } from "../src/types";

const f = (lv: Finding["lv"], text: string): Finding => ({ lv, text }) as Finding;

const mkInsp = (overrides: Partial<Unit> = {}): Unit => ({
  uid: "ABC123__2026-08-15",
  plate: "ABC123",
  fecha: "2026-08-15",
  risk: "OK",
  F: [],
  T: {},
  minT: null,
  ...overrides,
});

describe("buildEvolucionUnidad", () => {
  it("filtra por placa (incluye fallback plateOf del uid sintético) y ordena DESC", () => {
    const rows = buildEvolucionUnidad(
      [
        mkInsp({ uid: "ABC123__2026-06-10", fecha: "2026-06-10" }),
        mkInsp({ uid: "XYZ999__2026-08-01", plate: "XYZ999", fecha: "2026-08-01" }),
        // sin plate: la placa sale del uid sintético
        mkInsp({ uid: "ABC123__2026-08-15", plate: undefined, fecha: "2026-08-15" }),
      ],
      "ABC123",
      undefined,
    );
    expect(rows.map((r) => r.uid)).toEqual(["ABC123__2026-08-15", "ABC123__2026-06-10"]);
    expect(rows[0]!.label).toBe("Ago 2026 · día 15");
  });

  it("cuenta pendientes por severidad con corte temporal de isFindingDone", () => {
    const hallazgo = f("Urgente", "Frenos gastados");
    const db: ChecklistDB = {
      // marca de atendido con ts 2026-06-15: cubre inspecciones con fecha <= 2026-06-15
      "ABC123__2026-05-01": { "Frenos gastados": { done: true, ts: "2026-06-15T10:00:00Z" } },
      "ABC123__2026-07-01": { "Frenos gastados": { done: true, ts: "2026-06-15T10:00:00Z" } },
    };
    const rows = buildEvolucionUnidad(
      [
        mkInsp({ uid: "ABC123__2026-05-01", fecha: "2026-05-01", F: [hallazgo] }),
        // re-reporte POSTERIOR a la marca → vuelve a salir pendiente
        mkInsp({ uid: "ABC123__2026-07-01", fecha: "2026-07-01", F: [hallazgo] }),
      ],
      "ABC123",
      db,
    );
    const mayo = rows.find((r) => r.uid.endsWith("05-01"))!;
    const julio = rows.find((r) => r.uid.endsWith("07-01"))!;
    expect(mayo.pendUrg).toBe(0); // atendido
    expect(julio.pendUrg).toBe(1); // re-reportado tras la marca
  });

  it("agrupa pendientes por severidad y reporta totF", () => {
    const rows = buildEvolucionUnidad(
      [
        mkInsp({
          F: [f("Urgente", "a"), f("Urgente", "b"), f("Revisar", "c"), f("Completar", "d")],
        }),
      ],
      "ABC123",
      undefined,
    );
    expect(rows[0]).toMatchObject({ pendUrg: 2, pendRev: 1, pendComp: 1, totF: 4 });
  });

  it("deltaPend: empeora (+), mejora (−) y null en la más antigua", () => {
    const rows = buildEvolucionUnidad(
      [
        mkInsp({ uid: "ABC123__2026-06-01", fecha: "2026-06-01", F: [f("Revisar", "x")] }), // 1 pend
        mkInsp({
          uid: "ABC123__2026-07-01",
          fecha: "2026-07-01",
          F: [f("Urgente", "y"), f("Revisar", "x"), f("Revisar", "z")],
        }), // 3 pend → +2
        mkInsp({ uid: "ABC123__2026-08-01", fecha: "2026-08-01", F: [] }), // 0 pend → −3
      ],
      "ABC123",
      undefined,
    );
    // DESC: ago, jul, jun
    expect(rows.map((r) => r.deltaPend)).toEqual([-3, 2, null]);
  });

  it("fila sin fecha: no truena, va al final, sin delta, label fallback", () => {
    const rows = buildEvolucionUnidad(
      [
        mkInsp({ uid: "ABC123__x", fecha: "", plate: "ABC123" }),
        mkInsp({ uid: "ABC123__2026-08-01", fecha: "2026-08-01" }),
      ],
      "ABC123",
      undefined,
    );
    expect(rows.map((r) => r.uid)).toEqual(["ABC123__2026-08-01", "ABC123__x"]);
    expect(rows[1]!.label).toBe("Sin fecha");
    expect(rows[1]!.deltaPend).toBeNull();
  });

  it("acepta fechas legacy DD/MM/YYYY", () => {
    const rows = buildEvolucionUnidad(
      [mkInsp({ uid: "ABC123__15/08/2026", fecha: "15/08/2026" })],
      "ABC123",
      undefined,
    );
    expect(rows[0]!.label).toBe("Ago 2026 · día 15");
  });

  it("checklistDB undefined → todo pendiente; input vacío/placa vacía → []", () => {
    const rows = buildEvolucionUnidad([mkInsp({ F: [f("Urgente", "a")] })], "ABC123", undefined);
    expect(rows[0]!.pendUrg).toBe(1);
    expect(buildEvolucionUnidad([], "ABC123", undefined)).toEqual([]);
    expect(buildEvolucionUnidad([mkInsp()], "", undefined)).toEqual([]);
  });

  it("no muta el input", () => {
    const input = [
      mkInsp({ uid: "ABC123__2026-06-01", fecha: "2026-06-01" }),
      mkInsp({ uid: "ABC123__2026-08-01", fecha: "2026-08-01" }),
    ];
    const copia = [...input];
    buildEvolucionUnidad(input, "ABC123", undefined);
    expect(input).toEqual(copia);
  });
});

describe("countInspecciones", () => {
  it("cuenta solo las de la placa (y coincide con el builder)", () => {
    const insp = [
      mkInsp({ uid: "ABC123__2026-06-01", fecha: "2026-06-01" }),
      mkInsp({ uid: "ABC123__2026-08-01", fecha: "2026-08-01" }),
      mkInsp({ uid: "XYZ999__2026-08-01", plate: "XYZ999" }),
    ];
    expect(countInspecciones(insp, "ABC123")).toBe(2);
    expect(countInspecciones(insp, "ABC123")).toBe(
      buildEvolucionUnidad(insp, "ABC123", undefined).length,
    );
    expect(countInspecciones(insp, "")).toBe(0);
  });
});
