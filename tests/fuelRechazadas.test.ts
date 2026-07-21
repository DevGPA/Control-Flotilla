import { describe, expect, it } from "vitest";
import { mapCargaToFuelEntry, type CargaRow, type ValidacionRow } from "../src/fuel/mapEntry";
import {
  filterAndSortFuel,
  renderTableCombustible,
  type FuelTableFilter,
} from "../src/fuel/renderTableCombustible";
import type { FuelEntry } from "../src/fuel/types";

const ROW = {
  economicoId: "45",
  eventoId: "OPS-abc123",
  tipo: "carga",
  fecha: "2026-07-20",
  sucursal: "Monterrey",
} as CargaRow;

function val(over: Partial<ValidacionRow> = {}): ValidacionRow {
  return {
    loadId: "45|carga|OPS-abc123",
    verdictGlobal: "rechazada",
    revisadoPor: "ops-gpa",
    nota: "Rechazada en origen (Operaciones-GPA)",
    fuenteDeteccion: "ops-gpa",
    ...over,
  };
}

describe("hidratación de rechazadas (spec 2026-07-21)", () => {
  it("verdictGlobal 'rechazada' sobrevive la hidratación", () => {
    const e = mapCargaToFuelEntry(ROW, val());
    expect(e.review?.verdictGlobal).toBe("rechazada");
  });

  it("fuenteDeteccion 'ops-gpa' ya NO se aplana a 'manual'", () => {
    const e = mapCargaToFuelEntry(ROW, val());
    expect(e.review?.fuenteDeteccion).toBe("ops-gpa");
  });

  it("valores desconocidos siguen degradando: verdict → 'pendiente', fuente rara → 'manual'", () => {
    const e = mapCargaToFuelEntry(ROW, val({ verdictGlobal: "zzz", fuenteDeteccion: "zzz" }));
    expect(e.review?.verdictGlobal).toBe("pendiente");
    expect(e.review?.fuenteDeteccion).toBe("manual");
  });

  it("'ia' y vacío no cambian de comportamiento", () => {
    expect(mapCargaToFuelEntry(ROW, val({ fuenteDeteccion: "ia" })).review?.fuenteDeteccion).toBe(
      "ia",
    );
    expect(
      mapCargaToFuelEntry(ROW, val({ fuenteDeteccion: null })).review?.fuenteDeteccion,
    ).toBeUndefined();
  });
});

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

function fe(p: Partial<FuelEntry> & { eco: string }): FuelEntry {
  return {
    loadId: `${p.eco}|carga|${p.eventoId ?? "x"}`,
    tipo: "carga",
    eventoId: p.eventoId ?? "x",
    sucursal: "Monterrey",
    fecha: "2026-07-20",
    photos: [],
    ...p,
  } as FuelEntry;
}

const VIGENTE_RECHAZADA = fe({
  eco: "45",
  eventoId: "r1",
  monto: 700004,
  review: {
    verdictGlobal: "rechazada",
    porEvidencia: {},
    revisadoPor: "ops-gpa",
    fuenteDeteccion: "ops-gpa",
  },
});
const NO_CONTADA = fe({
  eco: "45",
  eventoId: "r2",
  monto: 700004,
  review: { verdictGlobal: "rechazada", porEvidencia: {}, fuenteDeteccion: "ops-gpa" },
  anulada: {
    motivo: "Rechazada en Operaciones-GPA — registro inválido",
    anuladoPor: "x@gpa",
    ts: "2026-07-21T10:00:00Z",
  },
});
const OK_OPS = fe({
  eco: "44",
  eventoId: "a1",
  monto: 700,
  review: {
    verdictGlobal: "ok",
    porEvidencia: {},
    revisadoPor: "admin · ops-gpa",
    fuenteDeteccion: "ops-gpa",
  },
});

describe("tabla: rechazadas (spec 2026-07-21)", () => {
  it("el filtro verdict='rechazada' matchea vigentes y no contadas", () => {
    const rows = filterAndSortFuel(
      [VIGENTE_RECHAZADA, NO_CONTADA, OK_OPS],
      { ...NO_FILTER, verdict: "rechazada" },
      "_idx",
      -1,
    );
    expect(rows).toHaveLength(2);
  });

  it("pills y clases de fila: 'Rechazada · Ops' (sw-rej), 'Rechazada · no contada' (sw-nocontada, monto tachado), 'Validado · Ops'", () => {
    const tbody = document.createElement("tbody");
    renderTableCombustible({
      tbody,
      entries: [VIGENTE_RECHAZADA, NO_CONTADA, OK_OPS],
      filter: NO_FILTER,
      sortCol: "eco",
      sortDir: 1,
    });
    const html = tbody.textContent ?? "";
    expect(html).toContain("Rechazada · Ops");
    expect(html).toContain("Rechazada · no contada");
    expect(html).toContain("Validado · Ops");
    expect(tbody.querySelector("tr.sw-rej")).toBeTruthy();
    const noContada = tbody.querySelector("tr.sw-nocontada");
    expect(noContada).toBeTruthy();
    expect(noContada!.querySelector("s")).toBeTruthy(); // monto tachado
  });
});
