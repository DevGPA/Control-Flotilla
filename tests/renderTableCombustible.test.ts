import { describe, expect, it, beforeEach } from "vitest";
import {
  filterAndSortFuel,
  verdictOf,
  displayVerdictOf,
  esHistorico,
  FUEL_VALIDACION_DESDE,
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

describe("corte del control de validación → 'Histórico' (backfill previo al corte)", () => {
  const reciente = "2026-06-15"; // >= corte
  const viejo = "2026-03-01"; // < corte

  it("el corte por defecto es 2026-06-01", () => {
    expect(FUEL_VALIDACION_DESDE).toBe("2026-06-01");
  });

  it("PREVIA al corte sin validar → 'historico'; DESDE el corte → 'pendiente'", () => {
    const v = entry({ eco: "1", tipo: "carga", fecha: viejo });
    const r = entry({ eco: "2", tipo: "carga", fecha: reciente });
    expect(verdictOf(v)).toBe("pendiente"); // veredicto base SIN cambios
    expect(esHistorico(v)).toBe(true);
    expect(displayVerdictOf(v)).toBe("historico");
    expect(esHistorico(r)).toBe(false);
    expect(displayVerdictOf(r)).toBe("pendiente");
  });

  it("la fecha de corte es INCLUSIVA (ese mismo día ya NO es histórico)", () => {
    const e = entry({ eco: "1", tipo: "carga", fecha: FUEL_VALIDACION_DESDE });
    expect(esHistorico(e)).toBe(false);
    expect(displayVerdictOf(e)).toBe("pendiente");
  });

  it("una validación REAL del histórico se RESPETA (no se reclasifica)", () => {
    const ok = entry({
      eco: "1",
      tipo: "carga",
      fecha: viejo,
      review: { verdictGlobal: "ok", porEvidencia: {} },
    });
    const disc = entry({
      eco: "2",
      tipo: "carga",
      fecha: viejo,
      review: { verdictGlobal: "discrepancia", porEvidencia: {} },
    });
    expect(displayVerdictOf(ok)).toBe("ok");
    expect(displayVerdictOf(disc)).toBe("discrepancia");
  });

  it("el corte es parametrizable (mover la fecha al pasado revierte el efecto)", () => {
    const e = entry({ eco: "1", tipo: "carga", fecha: viejo });
    expect(displayVerdictOf(e, "2020-01-01")).toBe("pendiente");
  });

  it("filtro 'historico' vs 'pendiente' respetan el corte", () => {
    const set: FuelEntry[] = [
      entry({ eco: "A", tipo: "carga", fecha: "2026-02-01" }), // histórico sin validar
      entry({ eco: "B", tipo: "carga", fecha: reciente }), // pendiente real
      entry({
        eco: "C",
        tipo: "carga",
        fecha: "2026-02-15",
        review: { verdictGlobal: "ok", porEvidencia: {} },
      }), // histórico ya validado → ni historico ni pendiente
    ];
    expect(
      filterAndSortFuel(set, { ...NO_FILTER, verdict: "historico" }, "_idx", -1).map((e) => e.eco),
    ).toEqual(["A"]);
    expect(
      filterAndSortFuel(set, { ...NO_FILTER, verdict: "pendiente" }, "_idx", -1).map((e) => e.eco),
    ).toEqual(["B"]);
  });

  it("KPI: 'Pendientes' excluye histórico; tarjeta 'Histórico' lo cuenta aparte y solo si hay", () => {
    const mixto = [
      entry({ eco: "U1", tipo: "carga", fecha: "2026-02-01", km: 0, litros: 40, monto: 1000 }), // histórico
      entry({ eco: "U2", tipo: "carga", fecha: reciente, km: 100, litros: 40, monto: 1000 }), // pendiente
    ];
    const m1 = computeFuelMetrics(mixto);
    const k1 = buildKpisFuel(mixto, m1, buildFleetBaseline(m1, mixto), []);
    const by1 = Object.fromEntries(k1.map((k) => [k.key, k.value]));
    expect(by1.pendientes).toBe("1"); // solo U2 (junio)
    expect(by1.historico).toBe("1"); // U1 (febrero) clasificado aparte

    const soloReciente = [
      entry({ eco: "U3", tipo: "carga", fecha: reciente, km: 0, litros: 40, monto: 1000 }),
    ];
    const m2 = computeFuelMetrics(soloReciente);
    const k2 = buildKpisFuel(soloReciente, m2, buildFleetBaseline(m2, soloReciente), []);
    expect(k2.find((k) => k.key === "historico")).toBeUndefined(); // sin histórico → sin tarjeta
  });

  it("DOM: carga histórica sin validar pinta píldora 'Histórico' y no resalta la fila", () => {
    const tb = document.createElement("tbody");
    renderTableCombustible({
      tbody: tb,
      entries: [entry({ eco: "9", tipo: "carga", fecha: "2026-01-20" })],
      filter: NO_FILTER,
      sortCol: "_idx",
      sortDir: -1,
    });
    expect(tb.querySelector(".sw-pill-hist")).toBeTruthy();
    expect(tb.textContent).toContain("Histórico");
    expect(tb.textContent).not.toContain("Pendiente");
    expect(tb.querySelector(".sw-rev")).toBeFalsy(); // no resalta como pendiente
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

  it("KPI 'Sin rendimiento' cuenta cargas sin km/l y separa 'por revisar' de estructurales", () => {
    // U1: 1ª carga (estructural) + 2ª válida; U2: 1ª carga (estructural) + retroceso (por revisar).
    const entries = [
      entry({ eco: "U1", tipo: "carga", fecha: "2026-06-01", km: 1000, litros: 50, monto: 1000 }),
      entry({ eco: "U1", tipo: "carga", fecha: "2026-06-10", km: 1500, litros: 50, monto: 1000 }),
      entry({ eco: "U2", tipo: "carga", fecha: "2026-06-01", km: 2000, litros: 50, monto: 1000 }),
      entry({ eco: "U2", tipo: "carga", fecha: "2026-06-10", km: 1800, litros: 50, monto: 1000 }),
    ];
    const metrics = computeFuelMetrics(entries);
    const baseline = buildFleetBaseline(metrics, entries);
    const card = buildKpisFuel(entries, metrics, baseline, []).find(
      (k) => k.key === "sin-rendimiento",
    );
    expect(card).toBeTruthy();
    expect(card!.value).toBe("3"); // 2 primeras cargas + 1 retroceso
    expect(card!.sub).toContain("1 por revisar"); // solo el retroceso es accionable
  });
});
