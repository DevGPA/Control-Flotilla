import { describe, expect, it, beforeEach } from "vitest";
import {
  filterAndSortFuel,
  verdictOf,
  renderTableCombustible,
  populateFuelSelects,
  type FuelTableFilter,
} from "../src/fuel/renderTableCombustible";
import { buildKpisFuel } from "../src/fuel/renderKpis";
import {
  computeFuelMetrics,
  buildFleetBaseline,
  detectFuelAnomalies,
} from "../src/fuel/fuelAnalysis";
import type { FuelEntry } from "../src/fuel/types";

function entry(p: Partial<FuelEntry> & { eco: string; tipo: "carga" | "solicitud" }): FuelEntry {
  return {
    loadId: `${p.eco}|${p.tipo}|${p.eventoId ?? p.fecha ?? "x"}`,
    eventoId: p.eventoId ?? p.fecha ?? "x",
    sucursal: "Guadalajara",
    fecha: "2026-03-01",
    photos: [],
    ...p,
  } as FuelEntry;
}

const NO_FILTER: FuelTableFilter = {
  tipo: "all",
  verdict: "all",
  sucursal: "",
  responsable: "",
  search: "",
};

describe("filterAndSortFuel", () => {
  const entries: FuelEntry[] = [
    entry({
      eco: "10",
      tipo: "carga",
      placa: "AAA",
      fecha: "2026-03-01",
      sucursal: "Monterrey",
      responsable: "JUAN",
      km: 100,
      litros: 40,
      monto: 1000,
    }),
    entry({
      eco: "20",
      tipo: "solicitud",
      placa: "BBB",
      fecha: "2026-03-05",
      sucursal: "Guadalajara",
      responsable: "ANA",
    }),
    entry({
      eco: "10",
      tipo: "carga",
      placa: "AAA",
      fecha: "2026-03-10",
      sucursal: "Monterrey",
      responsable: "JUAN",
      km: 600,
      litros: 50,
      monto: 1350,
      review: { verdictGlobal: "discrepancia", porEvidencia: {} },
    }),
  ];

  it("filtra por tipo / sucursal / verdict", () => {
    expect(filterAndSortFuel(entries, { ...NO_FILTER, tipo: "carga" }, "_idx", -1)).toHaveLength(2);
    expect(
      filterAndSortFuel(entries, { ...NO_FILTER, sucursal: "Guadalajara" }, "_idx", -1),
    ).toHaveLength(1);
    expect(
      filterAndSortFuel(entries, { ...NO_FILTER, verdict: "discrepancia" }, "_idx", -1),
    ).toHaveLength(1);
  });

  it("búsqueda numérica matchea ID de unidad; texto matchea placa/responsable", () => {
    expect(filterAndSortFuel(entries, { ...NO_FILTER, search: "20" }, "_idx", -1)).toHaveLength(1);
    expect(filterAndSortFuel(entries, { ...NO_FILTER, search: "ana" }, "_idx", -1)).toHaveLength(1);
    expect(filterAndSortFuel(entries, { ...NO_FILTER, search: "bbb" }, "_idx", -1)).toHaveLength(1);
  });

  it("filtra por rango de fechas", () => {
    expect(
      filterAndSortFuel(
        entries,
        { ...NO_FILTER, desde: "2026-03-04", hasta: "2026-03-06" },
        "_idx",
        -1,
      ),
    ).toHaveLength(1);
  });

  it("ordena por monto asc/desc", () => {
    const asc = filterAndSortFuel(
      entries.filter((e) => e.monto != null),
      NO_FILTER,
      "monto",
      1,
    );
    expect(asc[0]!.monto).toBe(1000);
    const desc = filterAndSortFuel(
      entries.filter((e) => e.monto != null),
      NO_FILTER,
      "monto",
      -1,
    );
    expect(desc[0]!.monto).toBe(1350);
  });

  it("_idx ordena por fecha desc (más reciente primero)", () => {
    const r = filterAndSortFuel(entries, NO_FILTER, "_idx", -1);
    expect(r[0]!.fecha).toBe("2026-03-10");
  });
});

describe("verdictOf", () => {
  it("pendiente si no hay revisión", () => {
    expect(verdictOf(entry({ eco: "1", tipo: "carga" }))).toBe("pendiente");
  });
});

describe("renderTableCombustible (DOM)", () => {
  let tbody: HTMLElement;
  beforeEach(() => {
    tbody = document.createElement("tbody");
  });
  it("pinta filas, pill de verdict y maneja vacío", () => {
    const entries = [
      entry({ eco: "10", tipo: "carga", km: 100, litros: 40, monto: 1000 }),
      entry({
        eco: "20",
        tipo: "carga",
        km: 200,
        litros: 30,
        monto: 800,
        review: { verdictGlobal: "discrepancia", porEvidencia: {} },
      }),
    ];
    const r = renderTableCombustible({
      tbody,
      entries,
      filter: NO_FILTER,
      sortCol: "_idx",
      sortDir: -1,
    });
    expect(r.filtered).toBe(2);
    expect(tbody.querySelectorAll("tr")).toHaveLength(2);
    expect(tbody.querySelector(".sw-urg")).toBeTruthy(); // fila con discrepancia
    expect(tbody.textContent).toContain("Discrepancia");

    const empty = renderTableCombustible({
      tbody,
      entries,
      filter: { ...NO_FILTER, search: "zzz" },
      sortCol: "_idx",
      sortDir: -1,
    });
    expect(empty.empty).toBe(true);
    expect(tbody.querySelectorAll("tr")).toHaveLength(0);
  });

  it("onRowClick recibe loadId y el orden visible", () => {
    const entries = [entry({ eco: "10", tipo: "carga" }), entry({ eco: "20", tipo: "carga" })];
    let clicked = "";
    let order: string[] = [];
    renderTableCombustible({
      tbody,
      entries,
      filter: NO_FILTER,
      sortCol: "_idx",
      sortDir: -1,
      onRowClick: (id, ord) => {
        clicked = id;
        order = ord;
      },
    });
    (tbody.querySelector("tr") as HTMLElement).click();
    expect(clicked).toBeTruthy();
    expect(order).toHaveLength(2);
  });
});

describe("populateFuelSelects", () => {
  it("llena sucursales y responsables únicos", () => {
    const sel = document.createElement("select");
    const sel2 = document.createElement("select");
    populateFuelSelects(sel, sel2, [
      entry({ eco: "1", tipo: "carga", sucursal: "Monterrey", responsable: "JUAN" }),
      entry({ eco: "2", tipo: "carga", sucursal: "Cabos", responsable: "ANA" }),
      entry({ eco: "3", tipo: "carga", sucursal: "Monterrey", responsable: "JUAN" }),
    ]);
    // 1 placeholder + 2 sucursales únicas
    expect(sel.querySelectorAll("option")).toHaveLength(3);
    expect(sel2.querySelectorAll("option")).toHaveLength(3);
  });
});

describe("buildKpisFuel", () => {
  it("calcula cargas, litros, gasto, discrepancias y anomalías", () => {
    const entries = [
      entry({ eco: "U1", tipo: "carga", fecha: "2026-01-01", km: 0, litros: 50, monto: 1350 }),
      entry({ eco: "U1", tipo: "carga", fecha: "2026-01-10", km: 500, litros: 50, monto: 1350 }),
      entry({ eco: "U2", tipo: "solicitud", fecha: "2026-01-02" }),
    ];
    const metrics = computeFuelMetrics(entries);
    const baseline = buildFleetBaseline(metrics, entries);
    const anomalies = detectFuelAnomalies(metrics, baseline);
    const kpis = buildKpisFuel(entries, metrics, baseline, anomalies);
    const byKey = Object.fromEntries(kpis.map((k) => [k.key, k.value]));
    expect(byKey.cargas).toBe("2");
    expect(byKey.litros).toBe("100 L");
    expect(byKey.gasto).toContain("2,700");
  });
});
