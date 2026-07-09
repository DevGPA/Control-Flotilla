import { describe, expect, it, beforeEach } from "vitest";
import { buildFuelEntries } from "../src/fuel/mapEntry";
import { computeFuelMetrics } from "../src/fuel/fuelAnalysis";
import { renderTableCombustible, type FuelTableFilter } from "../src/fuel/renderTableCombustible";
import type { FuelEntry } from "../src/fuel/types";

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

describe("buildFuelEntries — overlay de anulación", () => {
  const rows = [
    { economicoId: "44", tipo: "carga", eventoId: "4050", fecha: "2026-07-02" },
    { economicoId: "44", tipo: "carga", eventoId: "4051", fecha: "2026-07-05" },
  ];

  it("etiqueta la entrada cuya identidad natural está anulada (refId con prefijo)", () => {
    const anuladas = new Map([
      [
        "combustible|44|carga|4050",
        { motivo: "duplicada", anuladoPor: "admin@gpa.com.mx", ts: "2026-07-09T10:00:00Z" },
      ],
    ]);
    const entries = buildFuelEntries(rows, [], undefined, anuladas);
    const byEvento = new Map(entries.map((e) => [e.eventoId, e]));
    expect(byEvento.get("4050")!.anulada?.motivo).toBe("duplicada");
    expect(byEvento.get("4051")!.anulada).toBeUndefined();
  });

  it("sin mapa de anulaciones nada se etiqueta (compat)", () => {
    const entries = buildFuelEntries(rows);
    expect(entries.every((e) => e.anulada === undefined)).toBe(true);
  });
});

describe("efecto en métricas al excluir una carga anulada", () => {
  const carga = (eventoId: string, fecha: string, km: number, litros: number): FuelEntry =>
    ({
      loadId: `10|carga|${eventoId}`,
      tipo: "carga",
      eco: "10",
      eventoId,
      sucursal: "Guadalajara",
      fecha,
      km,
      litros,
      photos: [],
    }) as FuelEntry;

  it("el km/l de la carga siguiente se RE-ANCLA contra la última carga vigente", () => {
    const a = carga("A", "2026-07-01", 1000, 40);
    const errónea = carga("B", "2026-07-03", 90000, 40); // odómetro capturado mal
    const c = carga("C", "2026-07-05", 1400, 40);

    // Con la errónea presente: C ancla contra 90000 → retroceso (sin km/l).
    const conTodas = computeFuelMetrics([a, errónea, c]);
    const cCon = conTodas.find((m) => m.loadId === c.loadId)!;
    expect(cCon.kmPorLitro).toBeNull();

    // Excluyendo la anulada (como hace scoped()): C ancla contra A → 400/40 = 10 km/l.
    const sinAnulada = computeFuelMetrics([a, c]);
    const cSin = sinAnulada.find((m) => m.loadId === c.loadId)!;
    expect(cSin.kmDesdeAnterior).toBe(400);
    expect(cSin.kmPorLitro).toBeCloseTo(10, 5);
  });
});

describe("render — pill 'Anulada' en la celda de Validación", () => {
  let tbody: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    const table = document.createElement("table");
    tbody = document.createElement("tbody");
    table.appendChild(tbody);
    document.body.appendChild(table);
  });

  it("muestra pill gris con quién/fecha y el motivo en tooltip", () => {
    const e = {
      loadId: "44|carga|4050",
      tipo: "carga",
      eco: "44",
      eventoId: "4050",
      sucursal: "Guadalajara",
      fecha: "2026-07-02",
      photos: [],
      anulada: {
        motivo: "carga duplicada",
        anuladoPor: "admin@gpa.com.mx",
        ts: "2026-07-09T10:00:00Z",
      },
    } as FuelEntry;
    renderTableCombustible({
      tbody,
      entries: [e],
      filter: NO_FILTER,
      sortCol: "_idx",
      sortDir: -1,
    });
    const pill = tbody.querySelector(".sw-pill.sw-pill-hist")!;
    expect(pill.textContent).toBe("Anulada");
    expect(pill.getAttribute("title")).toBe("carga duplicada");
    const sub = tbody.querySelector(".sw-valby")!;
    expect(sub.textContent).toContain("admin");
    expect(sub.textContent).toContain("09/07/26");
  });
});
