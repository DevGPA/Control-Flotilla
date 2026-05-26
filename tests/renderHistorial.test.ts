import { describe, expect, it, vi } from "vitest";
import {
  buildHistorialRows,
  filterAndSortHistorial,
  renderHistorial,
} from "../src/taller/renderHistorial";
import type { TallerEntry } from "../src/taller/types";

function mk(overrides: Partial<TallerEntry> = {}): TallerEntry {
  return {
    id: "t1",
    unitKey: "U1",
    eco: "A-117",
    plate: "ABC-123",
    brand: "Toyota Hilux",
    sucursal: "GDL",
    area: "LOGISTICA",
    tipo: "Correctivo",
    estado: "Finalizado",
    fentrada: "2026-04-10",
    fsalidaReal: "2026-04-12",
    gastoRef: 500,
    gastoMO: 1000,
    updatedAt: "2026-04-12T10:00:00Z",
    ...overrides,
  };
}

function setup(): {
  tbody: HTMLElement;
  thead: HTMLElement;
  rcnt: HTMLElement;
  kpi: HTMLElement;
} {
  document.body.replaceChildren();
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  table.appendChild(thead);
  table.appendChild(tbody);
  document.body.appendChild(table);
  const rcnt = document.createElement("span");
  const kpi = document.createElement("div");
  document.body.appendChild(rcnt);
  document.body.appendChild(kpi);
  return { tbody, thead, rcnt, kpi };
}

// ═══════════════════════════════════════════════════════════════
//  buildHistorialRows
// ═══════════════════════════════════════════════════════════════

describe("buildHistorialRows", () => {
  it("agrupa por unitKey y cuenta solo cerradas", () => {
    const rows = buildHistorialRows([
      mk({ id: "a1", unitKey: "U1", estado: "Finalizado" }),
      mk({ id: "a2", unitKey: "U1", estado: "Finalizado" }),
      mk({ id: "a3", unitKey: "U1", estado: "En Reparación" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.closedCount).toBe(2);
    expect(rows[0]!.entries).toHaveLength(3);
  });

  it("omite unidades sin ingresos cerrados", () => {
    const rows = buildHistorialRows([
      mk({ id: "a1", unitKey: "U1", estado: "En Reparación" }),
      mk({ id: "a2", unitKey: "U2", estado: "Finalizado" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.unitKey).toBe("U2");
  });

  it("suma gastos solo de cerradas", () => {
    const rows = buildHistorialRows([
      mk({ id: "a1", unitKey: "U1", estado: "Finalizado", gastoRef: 100, gastoMO: 200 }),
      mk({ id: "a2", unitKey: "U1", estado: "Finalizado", gastoRef: 50, gastoMO: 50 }),
      mk({ id: "a3", unitKey: "U1", estado: "En Reparación", gastoRef: 999, gastoMO: 999 }),
    ]);
    expect(rows[0]!.totalGasto).toBe(400);
    expect(rows[0]!.totalGastoRef).toBe(150);
    expect(rows[0]!.totalGastoMO).toBe(250);
  });

  it("usa e.gasto como fallback si no hay gastoRef/gastoMO", () => {
    const rows = buildHistorialRows([
      mk({ id: "a1", unitKey: "U1", estado: "Finalizado", gastoRef: 0, gastoMO: 0, gasto: 777 }),
    ]);
    expect(rows[0]!.totalGasto).toBe(777);
  });

  it("filtro desde descarta cerradas anteriores", () => {
    const rows = buildHistorialRows(
      [
        mk({
          id: "a1",
          unitKey: "U1",
          estado: "Finalizado",
          fentrada: "2026-03-01",
          gastoRef: 100,
          gastoMO: 0,
        }),
        mk({
          id: "a2",
          unitKey: "U1",
          estado: "Finalizado",
          fentrada: "2026-04-15",
          gastoRef: 200,
          gastoMO: 0,
        }),
      ],
      { desde: "2026-04-01" },
    );
    expect(rows[0]!.closedCount).toBe(1);
    expect(rows[0]!.totalGasto).toBe(200);
  });

  it("filtro hasta descarta cerradas posteriores", () => {
    const rows = buildHistorialRows(
      [
        mk({
          id: "a1",
          unitKey: "U1",
          estado: "Finalizado",
          fentrada: "2026-03-01",
          gastoRef: 100,
          gastoMO: 0,
        }),
        mk({
          id: "a2",
          unitKey: "U1",
          estado: "Finalizado",
          fentrada: "2026-05-15",
          gastoRef: 200,
          gastoMO: 0,
        }),
      ],
      { hasta: "2026-04-01" },
    );
    expect(rows[0]!.closedCount).toBe(1);
    expect(rows[0]!.totalGasto).toBe(100);
  });

  it("filtro tipo descarta cerradas no coincidentes", () => {
    const rows = buildHistorialRows(
      [
        mk({
          id: "a1",
          unitKey: "U1",
          estado: "Finalizado",
          tipo: "Correctivo",
          gastoRef: 100,
          gastoMO: 0,
        }),
        mk({
          id: "a2",
          unitKey: "U1",
          estado: "Finalizado",
          tipo: "Preventivo",
          gastoRef: 200,
          gastoMO: 0,
        }),
      ],
      { tipo: "Preventivo" },
    );
    expect(rows[0]!.closedCount).toBe(1);
    expect(rows[0]!.totalGasto).toBe(200);
  });

  it("tipo=sin captura cerradas sin campo tipo", () => {
    const rows = buildHistorialRows(
      [
        mk({
          id: "a1",
          unitKey: "U1",
          estado: "Finalizado",
          tipo: undefined,
          gastoRef: 50,
          gastoMO: 0,
        }),
        mk({
          id: "a2",
          unitKey: "U1",
          estado: "Finalizado",
          tipo: "Correctivo",
          gastoRef: 999,
          gastoMO: 0,
        }),
      ],
      { tipo: "sin" },
    );
    expect(rows[0]!.closedCount).toBe(1);
    expect(rows[0]!.totalGasto).toBe(50);
  });
});

// ═══════════════════════════════════════════════════════════════
//  filterAndSortHistorial
// ═══════════════════════════════════════════════════════════════

describe("filterAndSortHistorial", () => {
  const base = buildHistorialRows([
    mk({
      id: "a1",
      unitKey: "U1",
      eco: "A-101",
      sucursal: "GDL",
      plate: "AAA-111",
      fentrada: "2026-04-10",
      updatedAt: "2026-04-10T10:00:00Z",
    }),
    mk({
      id: "b1",
      unitKey: "U2",
      eco: "B-202",
      sucursal: "MTY",
      plate: "BBB-222",
      fentrada: "2026-04-15",
      updatedAt: "2026-04-15T10:00:00Z",
    }),
    mk({
      id: "c1",
      unitKey: "U3",
      eco: "C-303",
      sucursal: "GDL",
      plate: "CCC-333",
      fentrada: "2026-04-05",
      updatedAt: "2026-04-05T10:00:00Z",
    }),
  ]);

  it("filtro sucursal", () => {
    const out = filterAndSortHistorial(base, { sucursal: "GDL" }, null, -1);
    expect(out.map((r) => r.latestClosed.eco)).toEqual(["A-101", "C-303"]);
  });

  it("filtro search por eco", () => {
    const out = filterAndSortHistorial(base, { search: "B-2" }, null, -1);
    expect(out).toHaveLength(1);
    expect(out[0]!.latestClosed.eco).toBe("B-202");
  });

  it("filtro search por plate (case-insensitive)", () => {
    const out = filterAndSortHistorial(base, { search: "ccc" }, null, -1);
    expect(out[0]!.latestClosed.eco).toBe("C-303");
  });

  it("sort fentrada asc", () => {
    const out = filterAndSortHistorial(base, {}, "fentrada", 1);
    expect(out.map((r) => r.latestClosed.eco)).toEqual(["C-303", "A-101", "B-202"]);
  });

  it("sort fentrada desc", () => {
    const out = filterAndSortHistorial(base, {}, "fentrada", -1);
    expect(out.map((r) => r.latestClosed.eco)).toEqual(["B-202", "A-101", "C-303"]);
  });

  it("tie-break por updatedAt desc cuando no hay sortCol", () => {
    const out = filterAndSortHistorial(base, {}, null, -1);
    expect(out[0]!.latestClosed.eco).toBe("B-202"); // updatedAt más reciente
  });
});

// ═══════════════════════════════════════════════════════════════
//  renderHistorial (DOM)
// ═══════════════════════════════════════════════════════════════

describe("renderHistorial", () => {
  it("renderiza empty state cuando no hay unidades cerradas", () => {
    const { tbody, thead, rcnt } = setup();
    const summary = renderHistorial(tbody, thead, rcnt, { entries: [] });
    expect(tbody.querySelector(".tl-empty")).toBeTruthy();
    expect(summary.visibles).toBe(0);
    expect(rcnt.textContent).toContain("0 unidades");
  });

  it("renderiza una fila con todos los campos", () => {
    const { tbody, thead, rcnt } = setup();
    renderHistorial(tbody, thead, rcnt, {
      entries: [mk({ id: "a1", unitKey: "U1" })],
    });
    const tr = tbody.querySelector("tr");
    expect(tr).toBeTruthy();
    const tds = tr!.querySelectorAll("td");
    expect(tds.length).toBe(9);
    expect(tds[0]!.textContent).toContain("A-117");
    expect(tds[1]!.textContent).toContain("ABC-123");
    expect(tds[2]!.textContent).toContain("Toyota Hilux");
    expect(tds[3]!.textContent).toContain("GDL");
    expect(tds[5]!.textContent).toBe("10/04/2026");
    expect(tds[6]!.textContent).toContain("12/04/2026");
    expect(tds[7]!.textContent).toBe("2d");
    expect(tds[8]!.textContent).toContain("$1,500");
  });

  it("muestra tag EN TALLER si última entry es activa", () => {
    const { tbody, thead, rcnt } = setup();
    renderHistorial(tbody, thead, rcnt, {
      entries: [
        mk({ id: "a1", unitKey: "U1", estado: "Finalizado", updatedAt: "2026-04-10T10:00:00Z" }),
        mk({ id: "a2", unitKey: "U1", estado: "En Reparación", updatedAt: "2026-04-20T10:00:00Z" }),
      ],
    });
    const tr = tbody.querySelector("tr")!;
    expect(tr.querySelector("td")!.textContent).toContain("EN TALLER");
  });

  it("NO muestra tag EN TALLER si latest es cerrada", () => {
    const { tbody, thead, rcnt } = setup();
    renderHistorial(tbody, thead, rcnt, {
      entries: [mk({ id: "a1", unitKey: "U1" })],
    });
    const tr = tbody.querySelector("tr")!;
    expect(tr.textContent).not.toContain("EN TALLER");
  });

  it("rcnt con 1 unidad: singular", () => {
    const { tbody, thead, rcnt } = setup();
    renderHistorial(tbody, thead, rcnt, {
      entries: [mk({ id: "a1", unitKey: "U1" })],
    });
    expect(rcnt.textContent).toContain("1 unidad ");
  });

  it("rcnt plural + tag período filtrado", () => {
    const { tbody, thead, rcnt } = setup();
    renderHistorial(tbody, thead, rcnt, {
      entries: [
        mk({ id: "a1", unitKey: "U1", fentrada: "2026-04-01" }),
        mk({ id: "a2", unitKey: "U2", fentrada: "2026-04-10" }),
      ],
      filter: { desde: "2026-04-01" },
    });
    expect(rcnt.textContent).toContain("2 unidades");
    expect(rcnt.textContent).toContain("período filtrado");
  });

  it("rcnt tag tipo (lowercase)", () => {
    const { tbody, thead, rcnt } = setup();
    renderHistorial(tbody, thead, rcnt, {
      entries: [mk({ id: "a1", unitKey: "U1", tipo: "Correctivo" })],
      filter: { tipo: "Correctivo" },
    });
    expect(rcnt.textContent).toContain("correctivo");
  });

  it("thead agrega flechas y dispara onSort", () => {
    const { tbody, thead, rcnt } = setup();
    const onSort = vi.fn();
    renderHistorial(tbody, thead, rcnt, {
      entries: [mk({ id: "a1", unitKey: "U1" })],
      sortCol: "eco",
      sortDir: 1,
      onSort,
    });
    const ths = thead.querySelectorAll("th");
    expect(ths[0]!.textContent).toContain("▲");
    (ths[1] as HTMLElement).click();
    expect(onSort).toHaveBeenCalledWith("plate");
  });

  it("click en fila dispara onOpen con unitKey", () => {
    const { tbody, thead, rcnt } = setup();
    const onOpen = vi.fn();
    renderHistorial(tbody, thead, rcnt, {
      entries: [mk({ id: "a1", unitKey: "U1" })],
      onOpen,
    });
    const tr = tbody.querySelector("tr")!;
    (tr as HTMLElement).click();
    expect(onOpen).toHaveBeenCalledWith("U1");
  });

  it("click en btn reingreso dispara onReingreso y NO onOpen", () => {
    const { tbody, thead, rcnt } = setup();
    const onOpen = vi.fn();
    const onReingreso = vi.fn();
    renderHistorial(tbody, thead, rcnt, {
      entries: [mk({ id: "a1", unitKey: "U1" })],
      onOpen,
      onReingreso,
    });
    const btn = tbody.querySelector(".tl-reing-btn") as HTMLElement;
    btn.click();
    expect(onReingreso).toHaveBeenCalledWith("U1");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("mix Correctivo/Preventivo aparece en columna visitas", () => {
    const { tbody, thead, rcnt } = setup();
    renderHistorial(tbody, thead, rcnt, {
      entries: [
        mk({ id: "a1", unitKey: "U1", tipo: "Correctivo" }),
        mk({ id: "a2", unitKey: "U1", tipo: "Correctivo" }),
        mk({ id: "a3", unitKey: "U1", tipo: "Preventivo" }),
      ],
    });
    const tr = tbody.querySelector("tr")!;
    expect(tr.textContent).toContain("2C");
    expect(tr.textContent).toContain("1P");
  });

  it("XSS safe — eco con <script> escapa vía textContent", () => {
    const { tbody, thead, rcnt } = setup();
    renderHistorial(tbody, thead, rcnt, {
      entries: [mk({ id: "a1", unitKey: "U1", eco: "<script>alert(1)</script>" })],
    });
    const tr = tbody.querySelector("tr")!;
    expect(tr.querySelector("script")).toBeFalsy();
    expect(tr.querySelector("td")!.textContent).toContain("<script>");
  });

  it("KPI bar renderiza totals + top5", () => {
    const { tbody, thead, rcnt, kpi } = setup();
    renderHistorial(tbody, thead, rcnt, {
      entries: [
        mk({ id: "a1", unitKey: "U1", eco: "A-1", gastoRef: 1000, gastoMO: 500 }),
        mk({ id: "a2", unitKey: "U2", eco: "B-2", gastoRef: 200, gastoMO: 100 }),
      ],
      kpiBar: kpi,
    });
    expect(kpi.style.display).toBe("");
    expect(kpi.textContent).toContain("$1,800");
    expect(kpi.querySelectorAll(".hist-rank-item").length).toBe(2);
  });

  it("KPI bar se oculta sin unidades", () => {
    const { tbody, thead, rcnt, kpi } = setup();
    renderHistorial(tbody, thead, rcnt, { entries: [], kpiBar: kpi });
    expect(kpi.style.display).toBe("none");
  });

  it("summary refleja totals post-filtro", () => {
    const { tbody, thead, rcnt } = setup();
    const summary = renderHistorial(tbody, thead, rcnt, {
      entries: [
        mk({ id: "a1", unitKey: "U1", gastoRef: 100, gastoMO: 0 }),
        mk({ id: "a2", unitKey: "U2", gastoRef: 200, gastoMO: 0 }),
      ],
    });
    expect(summary.visibles).toBe(2);
    expect(summary.totalGasto).toBe(300);
    expect(summary.totalVisitas).toBe(2);
  });

  it("reemplaza contenido previo del tbody", () => {
    const { tbody, thead, rcnt } = setup();
    // eslint-disable-next-line no-restricted-syntax -- test seed, string literal controlado
    tbody.innerHTML = "<tr><td>STALE</td></tr>";
    renderHistorial(tbody, thead, rcnt, {
      entries: [mk({ id: "a1", unitKey: "U1" })],
    });
    expect(tbody.textContent).not.toContain("STALE");
  });
});
