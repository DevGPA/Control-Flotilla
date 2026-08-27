import { describe, it, expect } from "vitest";
import { plateKey, latestPorUnidad, rangoCountLabel } from "../src/inspecciones/unidades";

type Row = { plate?: string; uid?: string; fecha?: string; minT?: number | null };

const mkRow = (overrides: Partial<Row> = {}): Row => ({
  plate: "ABC123",
  uid: "ABC123__2026-08-01",
  fecha: "2026-08-01",
  minT: 5,
  ...overrides,
});

describe("plateKey", () => {
  it("usa plate cuando existe", () => {
    expect(plateKey(mkRow())).toBe("ABC123");
  });

  it("sin plate deriva la placa del uid sintético placa__fecha", () => {
    expect(plateKey({ uid: "XYZ789__2026-08-01" })).toBe("XYZ789");
  });

  it("uid sin separador cae al uid crudo", () => {
    expect(plateKey({ uid: "XYZ789" })).toBe("XYZ789");
  });
});

describe("latestPorUnidad", () => {
  it("con rango multi-mes gana la inspección más reciente por unidad", () => {
    const rows = [
      mkRow({ uid: "ABC123__2026-07-05", fecha: "2026-07-05", minT: 2 }),
      mkRow({ uid: "ABC123__2026-08-10", fecha: "2026-08-10", minT: 6 }),
      mkRow({ plate: "DEF456", uid: "DEF456__2026-07-20", fecha: "2026-07-20" }),
    ];
    const out = latestPorUnidad(rows);
    expect(out).toHaveLength(2);
    const abc = out.find((r) => plateKey(r) === "ABC123")!;
    expect(abc.fecha).toBe("2026-08-10");
    expect(abc.minT).toBe(6);
  });

  it("no confía en el orden del arreglo (más reciente primero también funciona)", () => {
    const rows = [
      mkRow({ fecha: "2026-08-10", minT: 6 }),
      mkRow({ uid: "ABC123__2026-07-05", fecha: "2026-07-05", minT: 2 }),
    ];
    const out = latestPorUnidad(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.fecha).toBe("2026-08-10");
  });

  it("mezcla DMY e ISO: compara normalizado", () => {
    const rows = [
      mkRow({ fecha: "05/07/2026", minT: 2 }), // 2026-07-05 legacy
      mkRow({ fecha: "2026-08-10", minT: 6 }),
    ];
    const out = latestPorUnidad(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.minT).toBe(6);
  });

  it("empate de fecha conserva la primera vista (como Semanales)", () => {
    const a = mkRow({ minT: 1 });
    const b = mkRow({ minT: 9 });
    expect(latestPorUnidad([a, b])[0]!.minT).toBe(1);
  });

  it("sin plate agrupa por la placa del uid sintético", () => {
    const rows = [
      { uid: "XYZ789__2026-07-01", fecha: "2026-07-01" },
      { uid: "XYZ789__2026-08-01", fecha: "2026-08-01" },
    ];
    const out = latestPorUnidad(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.fecha).toBe("2026-08-01");
  });

  it("no muta el input", () => {
    const rows = [mkRow(), mkRow({ fecha: "2026-08-10" })];
    const copia = [...rows];
    latestPorUnidad(rows);
    expect(rows).toEqual(copia);
  });

  it("vacío → vacío", () => {
    expect(latestPorUnidad([])).toEqual([]);
  });
});

describe("rangoCountLabel", () => {
  it("difieren: '34 inspecciones · 28 unidades' (formato N · M)", () => {
    const rows = [
      mkRow({ fecha: "2026-07-05" }),
      mkRow({ fecha: "2026-08-10" }),
      mkRow({ plate: "DEF456" }),
    ];
    expect(rangoCountLabel(rows)).toBe("3 inspecciones · 2 unidades");
  });

  it("coinciden: solo 'N inspecciones'", () => {
    const rows = [mkRow(), mkRow({ plate: "DEF456" })];
    expect(rangoCountLabel(rows)).toBe("2 inspecciones");
  });

  it("cero y singular", () => {
    expect(rangoCountLabel([])).toBe("0 inspecciones");
    expect(rangoCountLabel([mkRow()])).toBe("1 inspección");
  });

  it("singular de unidad: '2 inspecciones · 1 unidad'", () => {
    const rows = [mkRow({ fecha: "2026-07-05" }), mkRow({ fecha: "2026-08-10" })];
    expect(rangoCountLabel(rows)).toBe("2 inspecciones · 1 unidad");
  });
});
