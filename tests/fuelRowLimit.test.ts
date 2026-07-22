import { describe, expect, it, beforeEach } from "vitest";
import {
  renderTableCombustible,
  type FuelTableFilter,
} from "../src/fuel/renderTableCombustible";
import type { FuelEntry } from "../src/fuel/types";

// Perf lag 2026-07-13: la tabla renderizaba las 2,754 filas del dataset en cada
// cambio de filtro (~2s de freeze por tecleo en la búsqueda). rowLimit acota el
// DOM; los datos/conteos/orden NO se acotan (exports y drawer usan el dataset).

function entry(i: number): FuelEntry {
  return {
    loadId: `${i}|carga|E${i}`,
    tipo: "carga",
    eventoId: `E${i}`,
    eco: String(i),
    sucursal: "Guadalajara",
    fecha: "2026-03-01",
    photos: [],
  } as unknown as FuelEntry;
}

const NO_FILTER: FuelTableFilter = {
  tipo: "all",
  verdict: "all",
  sucursal: "",
  responsable: "",
  search: "",
  flag: "",
  area: "",
  submarca: "",
};

let tbody: HTMLTableSectionElement;
beforeEach(() => {
  document.body.innerHTML = "<table><tbody id='tb'></tbody></table>";
  tbody = document.getElementById("tb") as HTMLTableSectionElement;
});

describe("renderTableCombustible — rowLimit", () => {
  it("acota el DOM a rowLimit y agrega la fila 'mostrar más'", () => {
    const entries = Array.from({ length: 50 }, (_, i) => entry(i));
    let more = 0;
    const res = renderTableCombustible({
      tbody,
      entries,
      filter: NO_FILTER,
      sortCol: "_idx",
      sortDir: -1,
      rowLimit: 20,
      onShowMore: () => more++,
    });
    // datos completos, DOM acotado
    expect(res.filtered).toBe(50);
    const dataRows = tbody.querySelectorAll("tr[data-load-id]");
    expect(dataRows.length).toBe(20);
    const btn = tbody.querySelector("button.fv-show-more") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain("30");
    btn.click();
    expect(more).toBe(1);
  });

  it("sin rowLimit (o mayor al total) renderiza todo y no agrega botón", () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry(i));
    renderTableCombustible({
      tbody,
      entries,
      filter: NO_FILTER,
      sortCol: "_idx",
      sortDir: -1,
      rowLimit: 100,
      onShowMore: () => {},
    });
    expect(tbody.querySelectorAll("tr[data-load-id]").length).toBe(10);
    expect(tbody.querySelector("button.fv-show-more")).toBeNull();
  });

  it("el conteo del countEl sigue reflejando los DATOS, no el DOM", () => {
    const countEl = document.createElement("span");
    const entries = Array.from({ length: 40 }, (_, i) => entry(i));
    renderTableCombustible({
      tbody,
      entries,
      filter: NO_FILTER,
      sortCol: "_idx",
      sortDir: -1,
      rowLimit: 5,
      onShowMore: () => {},
      countEl,
    });
    expect(countEl.textContent).toBe("40 de 40");
  });
});
