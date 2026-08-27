import { describe, it, expect } from "vitest";
import { buildTrendFromInspections } from "../src/dashboard/trendData";

type Row = { fecha?: string; risk?: string };

const mkRow = (overrides: Partial<Row> = {}): Row => ({
  fecha: "2026-08-10",
  risk: "OK",
  ...overrides,
});

describe("buildTrendFromInspections", () => {
  it("agrupa por mes, ordena ascendente y etiqueta 'Ago 2026'", () => {
    const rows = [
      mkRow({ fecha: "2026-08-10" }),
      mkRow({ fecha: "2026-07-05" }),
      mkRow({ fecha: "2026-08-20" }),
    ];
    const out = buildTrendFromInspections(rows);
    expect(out.map((p) => p.label)).toEqual(["Jul 2026", "Ago 2026"]);
    expect(out[0]!.total).toBe(1);
    expect(out[1]!.total).toBe(2);
  });

  it("mapea risk como el trend previo: Urgente/Revisar/resto→operativa", () => {
    const rows = [
      mkRow({ risk: "Urgente" }),
      mkRow({ risk: "Revisar" }),
      mkRow({ risk: "Completar" }),
      mkRow({ risk: undefined }),
      mkRow({ risk: "OK" }),
    ];
    const [mes] = buildTrendFromInspections(rows);
    expect(mes).toMatchObject({ total: 5, urgente: 1, revisar: 1, operativa: 3 });
  });

  it("acepta fechas legacy DD/MM/YYYY y las agrupa con las ISO", () => {
    const rows = [mkRow({ fecha: "10/08/2026" }), mkRow({ fecha: "2026-08-15" })];
    const out = buildTrendFromInspections(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.total).toBe(2);
  });

  it("filas sin fecha parseable se excluyen", () => {
    const rows = [mkRow(), mkRow({ fecha: "" }), mkRow({ fecha: "no-fecha" })];
    const out = buildTrendFromInspections(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.total).toBe(1);
  });

  it("con 14 meses conserva los 12 más recientes", () => {
    const rows: Row[] = [];
    for (let i = 0; i < 14; i++) {
      const mes = String((i % 12) + 1).padStart(2, "0");
      const anio = i < 12 ? 2025 : 2026;
      rows.push(mkRow({ fecha: `${anio}-${mes}-05` }));
    }
    const out = buildTrendFromInspections(rows);
    expect(out).toHaveLength(12);
    expect(out[0]!.label).toBe("Mar 2025"); // ene/feb 2025 quedan fuera
    expect(out[11]!.label).toBe("Feb 2026");
  });

  it("maxMeses configurable", () => {
    const rows = [
      mkRow({ fecha: "2026-06-01" }),
      mkRow({ fecha: "2026-07-01" }),
      mkRow({ fecha: "2026-08-01" }),
    ];
    expect(buildTrendFromInspections(rows, { maxMeses: 2 }).map((p) => p.label)).toEqual([
      "Jul 2026",
      "Ago 2026",
    ]);
  });

  it("1 solo mes → length 1 (el caller decide el empty state)", () => {
    expect(buildTrendFromInspections([mkRow()])).toHaveLength(1);
  });

  it("meses sin inspecciones se omiten (no se rellenan con 0)", () => {
    const rows = [mkRow({ fecha: "2026-05-01" }), mkRow({ fecha: "2026-08-01" })];
    const out = buildTrendFromInspections(rows);
    expect(out.map((p) => p.label)).toEqual(["May 2026", "Ago 2026"]); // sin jun/jul
  });

  it("vacío → vacío", () => {
    expect(buildTrendFromInspections([])).toEqual([]);
  });
});
