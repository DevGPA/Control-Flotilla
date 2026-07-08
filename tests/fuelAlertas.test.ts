import { describe, expect, it, beforeEach } from "vitest";
import {
  ruleOfFinding,
  groupFindingsByLoad,
  matchesFlag,
  FUEL_RULE_LABEL,
} from "../src/fuel/fuelAnalysis";
import {
  filterAndSortFuel,
  renderTableCombustible,
  type FuelTableFilter,
} from "../src/fuel/renderTableCombustible";
import type { FuelEntry, FuelFinding } from "../src/fuel/types";

function finding(p: Partial<FuelFinding> & { key: string }): FuelFinding {
  return { cat: "Combustible", text: "detalle", lv: "Revisar", ...p };
}

function entry(p: Partial<FuelEntry> & { eco: string }): FuelEntry {
  const tipo = p.tipo ?? "carga";
  return {
    loadId: `${p.eco}|${tipo}|${p.eventoId ?? p.fecha ?? "x"}`,
    tipo,
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
  flag: "",
  area: "",
  submarca: "",
};

describe("helpers de findings", () => {
  const f1 = finding({ key: "Fuel:frecuencia:10|carga|A", loadId: "10|carga|A" });
  const f2 = finding({ key: "Fuel:tanque-95:10|carga|A", loadId: "10|carga|A" });
  const f3 = finding({
    key: "Fuel:captura-litros:20|carga|B",
    loadId: "20|carga|B",
    lv: "Completar",
  });

  it("ruleOfFinding extrae la regla de la key", () => {
    expect(ruleOfFinding(f1)).toBe("frecuencia");
    expect(ruleOfFinding(f2)).toBe("tanque-95");
    expect(ruleOfFinding(f3)).toBe("captura-litros");
  });

  it("groupFindingsByLoad agrupa por loadId", () => {
    const m = groupFindingsByLoad([f1, f2, f3]);
    expect(m.get("10|carga|A")).toHaveLength(2);
    expect(m.get("20|carga|B")).toHaveLength(1);
    expect(m.get("otro")).toBeUndefined();
  });

  it("matchesFlag: vacío / any / regla exacta / prefijo captura", () => {
    expect(matchesFlag(undefined, "")).toBe(true);
    expect(matchesFlag(undefined, "any")).toBe(false);
    expect(matchesFlag([f1], "any")).toBe(true);
    expect(matchesFlag([f1, f2], "tanque-95")).toBe(true);
    expect(matchesFlag([f1], "tanque-95")).toBe(false);
    expect(matchesFlag([f3], "captura")).toBe(true);
    expect(matchesFlag([f1], "captura")).toBe(false);
  });

  it("toda regla del detector tiene etiqueta corta", () => {
    for (const rule of [
      "frecuencia",
      "tanque-95",
      "km-retrocede",
      "km-salto",
      "rendimiento",
      "consumo",
      "litros-implausibles",
      "fuga",
      "captura-litros",
      "captura-monto",
      "captura-km",
      "captura-precio",
    ])
      expect(FUEL_RULE_LABEL[rule], rule).toBeTruthy();
  });
});

describe("filterAndSortFuel con filtro por alerta", () => {
  const entries = [
    entry({ eco: "10", eventoId: "A" }),
    entry({ eco: "20", eventoId: "B" }),
    entry({ eco: "30", eventoId: "C" }),
  ];
  const findingsByLoad = new Map<string, FuelFinding[]>([
    ["10|carga|A", [finding({ key: "Fuel:frecuencia:10|carga|A", loadId: "10|carga|A" })]],
    ["20|carga|B", [finding({ key: "Fuel:captura-km:20|carga|B", loadId: "20|carga|B" })]],
  ]);

  it("flag vacío no filtra; any deja solo filas con alertas; regla exacta filtra fino", () => {
    expect(filterAndSortFuel(entries, NO_FILTER, "_idx", -1)).toHaveLength(3);
    const conAlertas = filterAndSortFuel(
      entries,
      { ...NO_FILTER, flag: "any" },
      "_idx",
      -1,
      undefined,
      undefined,
      findingsByLoad,
    );
    expect(conAlertas.map((e) => e.eco).sort()).toEqual(["10", "20"]);
    const frecuencia = filterAndSortFuel(
      entries,
      { ...NO_FILTER, flag: "frecuencia" },
      "_idx",
      -1,
      undefined,
      undefined,
      findingsByLoad,
    );
    expect(frecuencia.map((e) => e.eco)).toEqual(["10"]);
  });
});

describe("render de celdas Alertas y Ubicación", () => {
  let tbody: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    const table = document.createElement("table");
    tbody = document.createElement("tbody");
    table.appendChild(tbody);
    document.body.appendChild(table);
  });

  it("pinta chip de alerta con etiqueta corta, +N y tooltip con el detalle", () => {
    const e = entry({ eco: "10", eventoId: "A" });
    const findingsByLoad = new Map<string, FuelFinding[]>([
      [
        e.loadId,
        [
          finding({ key: `Fuel:frecuencia:${e.loadId}`, loadId: e.loadId, text: "muy seguida" }),
          finding({ key: `Fuel:tanque-95:${e.loadId}`, loadId: e.loadId, text: "al tope" }),
        ],
      ],
    ]);
    renderTableCombustible({
      tbody,
      entries: [e],
      filter: NO_FILTER,
      sortCol: "_idx",
      sortDir: -1,
      findingsByLoad,
    });
    const pill = tbody.querySelector(".sw-pill.sw-pill-rev")!;
    expect(pill.textContent).toBe("2ª carga en el día +1");
    expect(pill.getAttribute("title")).toContain("muy seguida");
    expect(pill.getAttribute("title")).toContain("al tope");
  });

  it("pinta liga a Google Maps con rel seguro cuando hay coordenadas", () => {
    const e = entry({
      eco: "10",
      eventoId: "A",
      ubicacion: "Oxxo Gas, Guadalupe",
      ubicacionLatLng: { lat: 25.7, lng: -100.1 },
    });
    renderTableCombustible({
      tbody,
      entries: [e],
      filter: NO_FILTER,
      sortCol: "_idx",
      sortDir: -1,
    });
    const a = tbody.querySelector("a.fuel-gps-link") as HTMLAnchorElement;
    expect(a).toBeTruthy();
    expect(a.getAttribute("href")).toBe("https://www.google.com/maps?q=25.7,-100.1");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.textContent).toBe("📍 Mapa");
    expect(a.title).toBe("Oxxo Gas, Guadalupe");
  });

  it("sin coordenadas muestra el texto truncado; sin nada, guion", () => {
    renderTableCombustible({
      tbody,
      entries: [
        entry({
          eco: "10",
          eventoId: "A",
          ubicacion: "Una dirección larguísima que no cabe en la celda",
        }),
        entry({ eco: "20", eventoId: "B" }),
      ],
      filter: NO_FILTER,
      sortCol: "_idx",
      sortDir: -1,
    });
    expect(tbody.querySelector("a.fuel-gps-link")).toBeNull();
    const filas = [...tbody.querySelectorAll("tr")];
    const textos = filas.map((tr) => tr.lastElementChild!.textContent);
    expect(textos).toContain("Una dirección larguísima qu…");
    expect(textos).toContain("—");
  });
});
