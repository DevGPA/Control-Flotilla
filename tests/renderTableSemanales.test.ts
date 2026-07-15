import { describe, expect, it, vi } from "vitest";
import {
  computeEffectiveRisk,
  filterAndSortWeekly,
  populateSucursalSelect,
  renderTableSemanales,
  type RenderTableSemanalesDeps,
  type WeeklyTableFilter,
} from "../src/weekly/renderTableSemanales";
import type { WeeklyPeriodo } from "../src/weekly/weeklyStore";
import type { WeeklyEntry } from "../src/types";

function mk(overrides: Partial<WeeklyEntry> = {}): WeeklyEntry {
  return {
    uid: "u1",
    eco: "A-100",
    plate: "ABC-123",
    brand: "Toyota",
    branch: "GDL",
    fecha: "2026-04-15",
    km: 120000,
    responsable: "Juan",
    aceiteRisk: "OK",
    radiadorRisk: "OK",
    carroceriaRisk: "OK",
    llantaRisk: "OK",
    ...overrides,
  };
}

function mkPeriodo(entries: WeeklyEntry[]): WeeklyPeriodo {
  return { id: "p1", label: "2026-W16", entries };
}

const BASE_FILTER: WeeklyTableFilter = {
  riskFilter: "all",
  sucursal: "all",
  search: "",
};

// ═══════════════════════════════════════════════════════════════
//  computeEffectiveRisk
// ═══════════════════════════════════════════════════════════════

describe("computeEffectiveRisk", () => {
  it("Urgente si aceite o radiador Urgente", () => {
    expect(computeEffectiveRisk(mk({ aceiteRisk: "Urgente" }))).toBe("Urgente");
    expect(computeEffectiveRisk(mk({ radiadorRisk: "Urgente" }))).toBe("Urgente");
  });

  it("Revisar si aceite o radiador Revisar (sin Urgente)", () => {
    expect(computeEffectiveRisk(mk({ aceiteRisk: "Revisar" }))).toBe("Revisar");
    expect(computeEffectiveRisk(mk({ radiadorRisk: "Revisar" }))).toBe("Revisar");
  });

  it("ignora carroceria y llanta (solo vitales votan)", () => {
    expect(
      computeEffectiveRisk(mk({ carroceriaRisk: "Urgente", llantaRisk: "Urgente" })),
    ).toBe("OK");
  });

  it("OK cuando aceite+radiador OK", () => {
    expect(computeEffectiveRisk(mk())).toBe("OK");
  });

  it("Urgente dominates Revisar", () => {
    expect(
      computeEffectiveRisk(mk({ aceiteRisk: "Revisar", radiadorRisk: "Urgente" })),
    ).toBe("Urgente");
  });
});

// ═══════════════════════════════════════════════════════════════
//  filterAndSortWeekly
// ═══════════════════════════════════════════════════════════════

describe("filterAndSortWeekly", () => {
  const entries = [
    mk({ uid: "a", eco: "A-100", aceiteRisk: "Urgente", branch: "GDL" }),
    mk({ uid: "b", eco: "B-200", aceiteRisk: "Revisar", branch: "MTY" }),
    mk({ uid: "c", eco: "C-300", branch: "GDL" }),
    mk({ uid: "d", eco: "D-400", carroceriaRisk: "Revisar", branch: "MTY" }),
    mk({ uid: "e", eco: "E-500", llantaRisk: "Revisar", branch: "GDL" }),
  ];

  it("riskFilter 'all' devuelve todo", () => {
    const rows = filterAndSortWeekly(entries, BASE_FILTER, "_idx", 1);
    expect(rows.length).toBe(5);
  });

  it("riskFilter 'Urgente' solo efectivo Urgente", () => {
    const rows = filterAndSortWeekly(entries, { ...BASE_FILTER, riskFilter: "Urgente" }, "_idx", 1);
    expect(rows.map((r) => r.uid)).toEqual(["a"]);
  });

  it("riskFilter 'Revisar' solo efectivo Revisar", () => {
    const rows = filterAndSortWeekly(entries, { ...BASE_FILTER, riskFilter: "Revisar" }, "_idx", 1);
    expect(rows.map((r) => r.uid)).toEqual(["b"]);
  });

  it("riskFilter 'OK' excluye Urgente/Revisar vitales pero mantiene carroceria/llanta no-OK", () => {
    const rows = filterAndSortWeekly(entries, { ...BASE_FILTER, riskFilter: "OK" }, "_idx", 1);
    expect(rows.map((r) => r.uid).sort()).toEqual(["c", "d", "e"]);
  });

  it("riskFilter 'carroceria' solo entries con carroceriaRisk !== OK", () => {
    const rows = filterAndSortWeekly(
      entries,
      { ...BASE_FILTER, riskFilter: "carroceria" },
      "_idx",
      1,
    );
    expect(rows.map((r) => r.uid)).toEqual(["d"]);
  });

  it("riskFilter 'llanta' solo entries con llantaRisk !== OK", () => {
    const rows = filterAndSortWeekly(entries, { ...BASE_FILTER, riskFilter: "llanta" }, "_idx", 1);
    expect(rows.map((r) => r.uid)).toEqual(["e"]);
  });

  it("filtro sucursal limita a branch exacto", () => {
    const rows = filterAndSortWeekly(entries, { ...BASE_FILTER, sucursal: "GDL" }, "_idx", 1);
    expect(rows.map((r) => r.uid).sort()).toEqual(["a", "c", "e"]);
  });

  it("search matchea eco/plate/brand/branch/responsable case-insensitive", () => {
    const rows = filterAndSortWeekly(entries, { ...BASE_FILTER, search: "b-2" }, "_idx", 1);
    expect(rows.map((r) => r.uid)).toEqual(["b"]);
  });

  it("sort 'risk' ordena Urgente>Revisar>OK con dir 1", () => {
    const rows = filterAndSortWeekly(entries, BASE_FILTER, "risk", 1);
    expect(computeEffectiveRisk(rows[0]!)).toBe("Urgente");
    expect(computeEffectiveRisk(rows[1]!)).toBe("Revisar");
  });

  it("sort 'risk' con dir -1 invierte el orden", () => {
    const rows = filterAndSortWeekly(entries, BASE_FILTER, "risk", -1);
    expect(computeEffectiveRisk(rows[rows.length - 1]!)).toBe("Urgente");
  });

  it("sort 'eco' con comparación numérica natural", () => {
    const rows = filterAndSortWeekly(entries, BASE_FILTER, "eco", 1);
    expect(rows.map((r) => r.eco)).toEqual(["A-100", "B-200", "C-300", "D-400", "E-500"]);
  });

  it("sort 'aceiteRisk' usa orden de risk", () => {
    const rows = filterAndSortWeekly(entries, BASE_FILTER, "aceiteRisk", 1);
    expect(rows[0]!.aceiteRisk).toBe("Urgente");
  });
});

// ═══════════════════════════════════════════════════════════════
//  populateSucursalSelect
// ═══════════════════════════════════════════════════════════════

describe("populateSucursalSelect", () => {
  it("pobla opciones unicas + 'all' primero", () => {
    const sel = document.createElement("select");
    const per = mkPeriodo([
      mk({ branch: "GDL" }),
      mk({ branch: "MTY" }),
      mk({ branch: "GDL" }),
    ]);
    populateSucursalSelect(sel, per);
    const opts = Array.from(sel.options).map((o) => o.value);
    expect(opts[0]).toBe("all");
    expect(opts.slice(1).sort()).toEqual(["GDL", "MTY"]);
  });

  it("preserva seleccion previa si sigue disponible", () => {
    const sel = document.createElement("select");
    const per = mkPeriodo([mk({ branch: "GDL" }), mk({ branch: "MTY" })]);
    populateSucursalSelect(sel, per);
    sel.value = "MTY";
    populateSucursalSelect(sel, per);
    expect(sel.value).toBe("MTY");
  });

  it("no-op sin periodo o selSuc null", () => {
    expect(() => populateSucursalSelect(null, undefined)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
//  renderTableSemanales (DOM)
// ═══════════════════════════════════════════════════════════════

function setupDom() {
  document.body.replaceChildren();
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const theadRow = document.createElement("tr");
  thead.appendChild(theadRow);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  table.appendChild(tbody);
  const empty = document.createElement("div");
  const rcnt = document.createElement("span");
  const selSuc = document.createElement("select");
  document.body.append(table, empty, rcnt, selSuc);
  return { table, theadRow, tbody, empty, rcnt, selSuc };
}

function baseDeps(periodo: WeeklyPeriodo | undefined): RenderTableSemanalesDeps {
  const { table, theadRow, tbody, empty, rcnt, selSuc } = setupDom();
  return {
    tbody,
    theadRow,
    table,
    empty,
    rcnt,
    selSuc,
    periodo,
    filter: BASE_FILTER,
    sortCol: "_idx",
    sortDir: 1,
    hasZipPhotos: false,
    onPhotos: vi.fn(),
    onEnviarATaller: vi.fn(),
    onSort: vi.fn(),
  };
}

describe("renderTableSemanales", () => {
  it("sin periodo → empty visible, summary empty=true", () => {
    const deps = baseDeps(undefined);
    const sum = renderTableSemanales(deps);
    expect(sum).toEqual({ total: 0, filtered: 0, empty: true });
    expect(deps.empty!.style.display).toBe("block");
    expect(deps.table!.style.display).toBe("none");
  });

  it("periodo vacio → empty visible", () => {
    const deps = baseDeps(mkPeriodo([]));
    const sum = renderTableSemanales(deps);
    expect(sum.empty).toBe(true);
    expect(deps.empty!.style.display).toBe("block");
  });

  it("renderiza una fila por entry", () => {
    const deps = baseDeps(
      mkPeriodo([mk({ uid: "a" }), mk({ uid: "b" }), mk({ uid: "c" })]),
    );
    const sum = renderTableSemanales(deps);
    expect(sum.total).toBe(3);
    expect(sum.filtered).toBe(3);
    expect(deps.tbody.querySelectorAll("tr").length).toBe(3);
  });

  it("thead tiene 13 columnas (12 sort + accion)", () => {
    const deps = baseDeps(mkPeriodo([mk()]));
    renderTableSemanales(deps);
    expect(deps.theadRow!.querySelectorAll("th").length).toBe(13);
  });

  it("thead activo muestra flecha y color accent", () => {
    const deps = baseDeps(mkPeriodo([mk()]));
    deps.sortCol = "eco";
    deps.sortDir = 1;
    renderTableSemanales(deps);
    const ths = deps.theadRow!.querySelectorAll("th");
    expect(ths[1]!.textContent).toContain("▲");
    expect(ths[1]!.getAttribute("style")).toContain("var(--ac)");
  });

  it("click en th dispara onSort con la key", () => {
    const deps = baseDeps(mkPeriodo([mk()]));
    renderTableSemanales(deps);
    const ths = deps.theadRow!.querySelectorAll("th");
    (ths[1] as HTMLElement).click();
    expect(deps.onSort).toHaveBeenCalledWith("eco");
  });

  it("fila Urgente recibe clase sw-urg", () => {
    const deps = baseDeps(mkPeriodo([mk({ aceiteRisk: "Urgente" })]));
    renderTableSemanales(deps);
    expect(deps.tbody.querySelector("tr")?.className).toBe("sw-urg");
  });

  it("fila Revisar recibe clase sw-rev", () => {
    const deps = baseDeps(mkPeriodo([mk({ radiadorRisk: "Revisar" })]));
    renderTableSemanales(deps);
    expect(deps.tbody.querySelector("tr")?.className).toBe("sw-rev");
  });

  it("Urgente → columna accion tiene boton taller", () => {
    const deps = baseDeps(mkPeriodo([mk({ uid: "x", aceiteRisk: "Urgente" })]));
    renderTableSemanales(deps);
    const btn = deps.tbody.querySelector(".sw-btn-taller") as HTMLElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(deps.onEnviarATaller).toHaveBeenCalledWith("x");
  });

  it("OK → sin boton taller", () => {
    const deps = baseDeps(mkPeriodo([mk()]));
    renderTableSemanales(deps);
    expect(deps.tbody.querySelector(".sw-btn-taller")).toBeFalsy();
  });

  it("click row dispara onPhotos solo con hasZipPhotos + fotos", () => {
    const deps = baseDeps(mkPeriodo([mk({ uid: "p", photos: ["f1.jpg"] })]));
    deps.hasZipPhotos = true;
    renderTableSemanales(deps);
    (deps.tbody.querySelector("tr") as HTMLElement).click();
    expect(deps.onPhotos).toHaveBeenCalledWith("p");
  });

  it("sin hasZipPhotos no dispara onPhotos", () => {
    const deps = baseDeps(mkPeriodo([mk({ uid: "p", photos: ["f1.jpg"] })]));
    renderTableSemanales(deps);
    (deps.tbody.querySelector("tr") as HTMLElement).click();
    expect(deps.onPhotos).not.toHaveBeenCalled();
  });

  it("camIcon con count cuando hasZipPhotos", () => {
    const deps = baseDeps(mkPeriodo([mk({ photos: ["a", "b", "c"] })]));
    deps.hasZipPhotos = true;
    renderTableSemanales(deps);
    const icon = deps.tbody.querySelector("i[data-lucide='camera']");
    expect(icon).toBeTruthy();
    expect(icon?.parentElement?.textContent).toContain("3");
  });

  it("formato km con locale es-MX", () => {
    const deps = baseDeps(mkPeriodo([mk({ km: 123456 })]));
    renderTableSemanales(deps);
    const kmCell = deps.tbody.querySelector(".sw-km");
    expect(kmCell?.textContent).toMatch(/123[,.]456/);
    expect(kmCell?.textContent).toContain("km");
  });

  it("km vacio muestra —", () => {
    const deps = baseDeps(mkPeriodo([mk({ km: undefined })]));
    renderTableSemanales(deps);
    expect(deps.tbody.querySelector(".sw-km")?.textContent).toBe("—");
  });

  it("rcnt muestra total cuando filtered == total", () => {
    const deps = baseDeps(mkPeriodo([mk({ uid: "a" }), mk({ uid: "b" })]));
    renderTableSemanales(deps);
    expect(deps.rcnt!.textContent).toContain("2 unidades");
  });

  it("rcnt muestra 'N de M' cuando hay filtro", () => {
    const deps = baseDeps(
      mkPeriodo([mk({ uid: "a", aceiteRisk: "Urgente" }), mk({ uid: "b" })]),
    );
    deps.filter = { ...BASE_FILTER, riskFilter: "Urgente" };
    renderTableSemanales(deps);
    expect(deps.rcnt!.textContent).toBe("1 de 2");
  });

  it("rcnt singular con 1 unidad", () => {
    const deps = baseDeps(mkPeriodo([mk()]));
    renderTableSemanales(deps);
    expect(deps.rcnt!.textContent).toBe("1 unidad");
  });

  it("XSS safe — responsable con HTML no ejecuta", () => {
    const deps = baseDeps(mkPeriodo([mk({ responsable: "<img onerror=x>" })]));
    renderTableSemanales(deps);
    expect(deps.tbody.querySelector("img")).toBeFalsy();
    expect(deps.tbody.textContent).toContain("<img onerror=x>");
  });

  it("reemplaza tbody previo en rerender", () => {
    const deps = baseDeps(mkPeriodo([mk({ uid: "a" })]));
    deps.tbody.innerHTML = "<tr><td>STALE</td></tr>";
    renderTableSemanales(deps);
    expect(deps.tbody.textContent).not.toContain("STALE");
    expect(deps.tbody.querySelectorAll("tr").length).toBe(1);
  });

  // Semanales-2A: lo normal se silencia, solo el hallazgo lleva pastilla.
  it("fila 100% OK: todas las celdas de estado silenciadas (.sw-ok-muted, sin pastilla)", () => {
    const deps = baseDeps(mkPeriodo([mk()]));
    renderTableSemanales(deps);
    expect(deps.tbody.querySelectorAll(".sw-ok-muted").length).toBeGreaterThanOrEqual(4);
    // OK no debe pintar pastilla verde en la tabla semanal
    expect(deps.tbody.querySelector(".sw-pill-ok")).toBeFalsy();
  });

  it("hallazgo Urgente conserva pastilla; carrocería/llanta no-OK conservan pastilla", () => {
    const deps = baseDeps(
      mkPeriodo([
        mk({
          aceiteRisk: "Urgente",
          carroceriaRisk: "Revisar",
          carroceria: "Rayón",
          llantaRisk: "Revisar",
        }),
      ]),
    );
    renderTableSemanales(deps);
    expect(deps.tbody.querySelector(".sw-pill-urg")).toBeTruthy(); // aceite + estado
    expect(deps.tbody.querySelector(".sw-pill-info")).toBeTruthy(); // carrocería revisar
    expect(deps.tbody.querySelector(".sw-pill-note")).toBeTruthy(); // llanta faltante
    // radiador sigue OK → silenciado
    expect(deps.tbody.querySelector(".sw-ok-muted")).toBeTruthy();
  });

  it("summary refleja filter aplicado", () => {
    const deps = baseDeps(
      mkPeriodo([
        mk({ uid: "a", aceiteRisk: "Urgente" }),
        mk({ uid: "b" }),
        mk({ uid: "c" }),
      ]),
    );
    deps.filter = { ...BASE_FILTER, riskFilter: "Urgente" };
    const sum = renderTableSemanales(deps);
    expect(sum).toEqual({ total: 3, filtered: 1, empty: false });
  });
});
