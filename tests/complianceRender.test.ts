import { describe, expect, it } from "vitest";
import {
  filterAndSortCumplimiento,
  buildKpisCumplimiento,
  renderTableCumplimiento,
  renderKpisCumplimiento,
  renderExpedienteUnidad,
  renderCapturaForm,
  tieneIssue,
  type CumplimientoTableFilter,
} from "../src/compliance/renderCumplimiento";
import type {
  CapturaFields,
  ComplianceEntry,
  ComplianceResumenUnidad,
} from "../src/compliance/types";

function unidad(eco: string, over: Partial<ComplianceResumenUnidad> = {}): ComplianceResumenUnidad {
  return {
    eco,
    estado: "vigente",
    vencidos: 0,
    porVencer: 0,
    adeudos: 0,
    montoAdeudo: 0,
    docs: [],
    ...over,
  };
}

const NOFILTER: CumplimientoTableFilter = { estado: "all", sucursal: "", search: "" };

const FLOTA: ComplianceResumenUnidad[] = [
  unidad("10", { estado: "vencido", vencidos: 2, sucursal: "Guadalajara", placa: "JAB-10-05" }),
  unidad("20", { estado: "porVencer", porVencer: 1, sucursal: "Monterrey", placa: "ABC-20-07" }),
  unidad("30", { estado: "adeudo", adeudos: 3, montoAdeudo: 4200, sucursal: "Guadalajara" }),
  unidad("40", { estado: "vigente", sucursal: "Monterrey" }),
  unidad("50", { estado: "desconocido", sucursal: "Guadalajara" }),
];

describe("tieneIssue", () => {
  it("es true si hay vencidos, por vencer o adeudos", () => {
    expect(tieneIssue(unidad("1", { vencidos: 1 }))).toBe(true);
    expect(tieneIssue(unidad("2", { porVencer: 1 }))).toBe(true);
    expect(tieneIssue(unidad("3", { adeudos: 1 }))).toBe(true);
    expect(tieneIssue(unidad("4"))).toBe(false);
  });
});

describe("filterAndSortCumplimiento", () => {
  it("filtra por estado vencido / porVencer / adeudo / conIssues", () => {
    expect(
      filterAndSortCumplimiento(FLOTA, { ...NOFILTER, estado: "vencido" }, "eco", 1),
    ).toHaveLength(1);
    expect(
      filterAndSortCumplimiento(FLOTA, { ...NOFILTER, estado: "porVencer" }, "eco", 1),
    ).toHaveLength(1);
    expect(
      filterAndSortCumplimiento(FLOTA, { ...NOFILTER, estado: "adeudo" }, "eco", 1),
    ).toHaveLength(1);
    expect(
      filterAndSortCumplimiento(FLOTA, { ...NOFILTER, estado: "conIssues" }, "eco", 1),
    ).toHaveLength(3);
  });

  it("filtra por sucursal", () => {
    const r = filterAndSortCumplimiento(FLOTA, { ...NOFILTER, sucursal: "Monterrey" }, "eco", 1);
    expect(r.map((u) => u.eco)).toEqual(["20", "40"]);
  });

  it("busca por eco o placa (multi-término OR)", () => {
    expect(
      filterAndSortCumplimiento(FLOTA, { ...NOFILTER, search: "10 20" }, "eco", 1).map(
        (u) => u.eco,
      ),
    ).toEqual(["10", "20"]);
    expect(
      filterAndSortCumplimiento(FLOTA, { ...NOFILTER, search: "ABC" }, "eco", 1).map((u) => u.eco),
    ).toEqual(["20"]);
  });

  it("ordena por estado peor-primero (dir -1)", () => {
    const r = filterAndSortCumplimiento(FLOTA, NOFILTER, "estado", -1);
    expect(r[0]?.estado).toBe("vencido");
    expect(r[r.length - 1]?.estado).toBe("desconocido");
  });

  it("ordena por monto y desempata por eco", () => {
    const r = filterAndSortCumplimiento(FLOTA, NOFILTER, "monto", -1);
    expect(r[0]?.eco).toBe("30"); // único con monto
  });
});

describe("buildKpisCumplimiento", () => {
  const cards = buildKpisCumplimiento(FLOTA);
  const byKey = Object.fromEntries(cards.map((c) => [c.key, c]));
  it("cuenta unidades, vencidos, por vencer, adeudos y monto", () => {
    expect(byKey.unidades?.value).toBe("5");
    expect(byKey.vencidos?.value).toBe("1");
    expect(byKey.porVencer?.value).toBe("1");
    expect(byKey.adeudos?.value).toBe("1");
    expect(byKey.monto?.tone).toBe("a"); // hay adeudo > 0
  });
  it("'al día' excluye los desconocidos", () => {
    expect(byKey.aldia?.value).toBe("1"); // solo eco 40
  });
});

describe("render DOM", () => {
  it("renderTableCumplimiento pinta una fila por unidad con el pill correcto", () => {
    const tbody = document.createElement("tbody");
    const countEl = document.createElement("div");
    const res = renderTableCumplimiento({
      tbody,
      countEl,
      unidades: FLOTA,
      filter: NOFILTER,
      sortCol: "estado",
      sortDir: -1,
    });
    expect(res.filtered).toBe(5);
    expect(tbody.querySelectorAll("tr")).toHaveLength(5);
    expect(countEl.textContent).toBe("5 de 5");
    // Primera fila = peor estado (vencido) con pill rojo.
    const primerPill = tbody.querySelector("tr .sw-pill");
    expect(primerPill?.textContent).toBe("Vencido");
    expect(tbody.querySelector("tr")?.dataset.eco).toBe("10");
  });

  it("renderKpisCumplimiento crea una tarjeta por KPI", () => {
    const cont = document.createElement("div");
    renderKpisCumplimiento(cont, buildKpisCumplimiento(FLOTA));
    expect(cont.querySelectorAll(".kc")).toHaveLength(6);
  });
});

describe("renderExpedienteUnidad", () => {
  const entry = (over: Partial<ComplianceEntry>): ComplianceEntry => ({
    tenantId: "gpa",
    economicoId: "78",
    docId: "seguro",
    tipoDoc: "seguro",
    estado: "vigente",
    diasParaVencer: null,
    ...over,
  });

  it("muestra info derivada de placa + lista de documentos", () => {
    const cont = document.createElement("div");
    renderExpedienteUnidad(cont, "78", "JAB-12-05", [
      entry({
        tipoDoc: "seguro",
        estado: "vencido",
        fechaVencimiento: "2026-06-01",
        diasParaVencer: -25,
      }),
      entry({ docId: "multa#cdmx#1", tipoDoc: "multa", estado: "adeudo", monto: 1500 }),
    ]);
    // terminación 5 → engomado amarillo + Hoy No Circula lunes
    expect(cont.textContent).toContain("amarillo");
    expect(cont.textContent).toContain("Lunes");
    expect(cont.querySelectorAll(".sw-pill")).toHaveLength(2);
    expect(cont.textContent).toContain("Seguro");
    expect(cont.textContent).toContain("Multa");
  });

  it("muestra empty state cuando no hay documentos", () => {
    const cont = document.createElement("div");
    renderExpedienteUnidad(cont, "78", undefined, []);
    expect(cont.textContent).toContain("Sin documentos");
  });

  it("muestra botón de borrar por fila cuando se pasa onDelete", () => {
    const cont = document.createElement("div");
    const borrados: string[] = [];
    renderExpedienteUnidad(
      cont,
      "78",
      "JAB-12-05",
      [entry({ docId: "seguro", tipoDoc: "seguro", fechaVencimiento: "2026-12-31" })],
      { onDelete: (docId) => borrados.push(docId) },
    );
    const del = cont.querySelector("button");
    expect(del).not.toBeNull();
    del?.dispatchEvent(new Event("click"));
    expect(borrados).toEqual(["seguro"]);
  });
});

describe("renderCapturaForm", () => {
  it("llama onSave con los campos capturados", () => {
    const cont = document.createElement("div");
    const calls: CapturaFields[] = [];
    renderCapturaForm(cont, (f) => calls.push(f));
    (cont.querySelector("select[aria-label='Tipo de documento']") as HTMLSelectElement).value =
      "seguro";
    (cont.querySelector("input[type='date']") as HTMLInputElement).value = "2026-12-31";
    (cont.querySelector("button") as HTMLButtonElement).click();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.tipoDoc).toBe("seguro");
    expect(calls[0]?.fechaVencimiento).toBe("2026-12-31");
  });

  it("no llama onSave si no hay fecha, monto ni referencia (validación)", () => {
    const cont = document.createElement("div");
    let called = 0;
    renderCapturaForm(cont, () => {
      called++;
    });
    (cont.querySelector("button") as HTMLButtonElement).click();
    expect(called).toBe(0);
  });
});
