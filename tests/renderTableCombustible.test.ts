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
  computeRecorridos,
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

  it("búsqueda MULTI-TÉRMINO (espacios/comas) → OR de unidades", () => {
    // "10 20" trae ambas unidades: 2 registros de eco 10 + 1 de eco 20 = 3
    expect(filterAndSortFuel(entries, { ...NO_FILTER, search: "10 20" }, "_idx", -1)).toHaveLength(
      3,
    );
    // la coma también separa; un término inexistente no suma de más
    expect(
      filterAndSortFuel(entries, { ...NO_FILTER, search: "20, 999" }, "_idx", -1),
    ).toHaveLength(1);
    // un solo término se comporta igual que antes
    expect(filterAndSortFuel(entries, { ...NO_FILTER, search: "10" }, "_idx", -1)).toHaveLength(2);
  });

  it("vista Solicitudes: la columna Monto ordena por 'monto a cargar' (montoEstimado)", () => {
    const sols: FuelEntry[] = [
      entry({ eco: "1", tipo: "solicitud", montoEstimado: 500 }),
      entry({ eco: "2", tipo: "solicitud", montoEstimado: 2000 }),
    ];
    const r = filterAndSortFuel(sols, { ...NO_FILTER, tipo: "solicitud" }, "monto", -1);
    expect(r[0]!.eco).toBe("2"); // mayor monto a cargar primero
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

  it("vista Solicitudes: columnas adaptadas (nivel / monto a cargar / recorrido + submarca)", () => {
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    for (const s of ["litros", "monto", "kmpl"]) {
      const th = document.createElement("th");
      th.setAttribute("data-sort", s);
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    table.appendChild(thead);
    const sol = entry({
      eco: "06",
      tipo: "solicitud",
      nivelAntes: "0.25(1/4)",
      nivelDeseado: "1.00",
      montoEstimado: 1525,
      maxLitros: 55,
    });
    renderTableCombustible({
      tbody,
      tableEl: table,
      entries: [sol],
      filter: { ...NO_FILTER, tipo: "solicitud" },
      sortCol: "_idx",
      sortDir: -1,
      submarcaByEco: new Map([["6", "Peugeot"]]),
      recorridosByLoad: new Map([[sol.loadId, { km: 800, viaCarga: true, cerrado: true }]]),
    });
    // Encabezado adaptado
    expect(table.querySelector('[data-sort="monto"]')!.textContent).toBe("Monto a cargar");
    expect(table.querySelector('[data-sort="litros"]')!.textContent).toBe("Nivel (antes→deseado)");
    expect(table.querySelector('[data-sort="kmpl"]')!.textContent).toBe("Recorrido");
    // Celdas con datos de solicitud
    const tds = [...tbody.querySelectorAll("td")].map((td) => td.textContent ?? "");
    expect(tds).toContain("06 · Peugeot"); // económico + submarca del catálogo
    expect(tds.some((t) => t.includes("¼") && t.includes("→"))).toBe(true); // nivel antes→deseado
    expect(tds.some((t) => t.includes("1,525"))).toBe(true); // monto a cargar
    expect(tds.some((t) => t.includes("800 km") && t.includes("✓"))).toBe(true); // recorrido del ciclo
  });

  it("celda de Validación: muestra nombre del validador + fecha bajo el semáforo", () => {
    const e = entry({
      eco: "10",
      tipo: "carga",
      review: {
        verdictGlobal: "ok",
        porEvidencia: {},
        revisadoPor: "navares.oro@gmail.com",
        ts: "2026-06-25T18:30:00.000Z",
      },
    });
    renderTableCombustible({
      tbody,
      entries: [e],
      filter: NO_FILTER,
      sortCol: "_idx",
      sortDir: -1,
      nombreValidador: (email) => (email === "navares.oro@gmail.com" ? "Navares" : "—"),
    });
    const by = tbody.querySelector(".sw-valby");
    expect(by).toBeTruthy();
    expect(by!.textContent).toContain("Navares");
    expect(by!.textContent).toContain("25/06/26");
  });

  it("vista Solicitudes: ordena por la columna Recorrido (km del ciclo)", () => {
    const a = entry({ eco: "1", tipo: "solicitud", eventoId: "a" });
    const b = entry({ eco: "2", tipo: "solicitud", eventoId: "b" });
    const rec = new Map([
      [a.loadId, { km: 200, viaCarga: true, cerrado: true }],
      [b.loadId, { km: 900, viaCarga: false, cerrado: true }],
    ]);
    const r = filterAndSortFuel(
      [a, b],
      { ...NO_FILTER, tipo: "solicitud" },
      "kmpl",
      -1,
      undefined,
      rec,
    );
    expect(r[0]!.eco).toBe("2"); // mayor recorrido primero
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

  it("KPI 'Solicitudes sin carga' cuenta ciclos cerrados sin carga (no la última solicitud)", () => {
    // U1: sol→sol SIN carga (ciclo cerrado sin carga = 1); la 2ª solicitud queda en curso.
    // U2: sol→carga→sol (ciclo cerrado CON carga = no cuenta).
    const entries = [
      entry({ eco: "U1", tipo: "solicitud", fecha: "2026-01-01", km: 0 }),
      entry({ eco: "U1", tipo: "solicitud", fecha: "2026-01-10", km: 500 }),
      entry({ eco: "U2", tipo: "solicitud", fecha: "2026-01-01", km: 0 }),
      entry({ eco: "U2", tipo: "carga", fecha: "2026-01-05", km: 300, litros: 40, monto: 1000 }),
      entry({ eco: "U2", tipo: "solicitud", fecha: "2026-01-12", km: 700 }),
    ];
    const metrics = computeFuelMetrics(entries);
    const baseline = buildFleetBaseline(metrics, entries);
    const anomalies = detectFuelAnomalies(metrics, baseline);
    const rec = computeRecorridos(entries);
    const kpis = buildKpisFuel(entries, metrics, baseline, anomalies, rec);
    const sin = kpis.find((k) => k.key === "sin-carga");
    expect(sin).toBeTruthy();
    expect(sin!.value).toBe("1");
  });

  it("sin recorridosByLoad NO incluye la tarjeta 'sin-carga'", () => {
    const kpis = buildKpisFuel([], [], buildFleetBaseline([], []), []);
    expect(kpis.find((k) => k.key === "sin-carga")).toBeUndefined();
  });
});
