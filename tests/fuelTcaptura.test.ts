import { describe, expect, it } from "vitest";
import {
  duracionCapturaMin,
  duracionPorResponsable,
  tzOffsetDeSucursal,
} from "../src/fuel/fuelAggregates";
import { mapCargaToFuelEntry } from "../src/fuel/mapEntry";
import { filterAndSortFuel, type FuelTableFilter } from "../src/fuel/renderTableCombustible";
import type { FuelEntry } from "../src/fuel/types";

describe("tzOffsetDeSucursal", () => {
  it("Cancún −5, Cabos −7, resto −6", () => {
    expect(tzOffsetDeSucursal("Cancún")).toBe(-5);
    expect(tzOffsetDeSucursal("cancun")).toBe(-5);
    expect(tzOffsetDeSucursal("Cabos")).toBe(-7);
    expect(tzOffsetDeSucursal("Guadalajara")).toBe(-6);
    expect(tzOffsetDeSucursal(undefined)).toBe(-6);
  });
});

describe("duracionCapturaMin", () => {
  // Caso real observado: solicitud CDMX abierta 16:20 local, guardada 22:21:33Z → 1.6 min.
  it("calcula minutos entre apertura (hora local) y cierre (ISO UTC)", () => {
    expect(
      duracionCapturaMin({
        fechaHora: "2026-06-04 16:20",
        formCerrado: "2026-06-04T22:21:33.248Z",
        sucursal: "CDMX",
      }),
    ).toBeCloseTo(1.6, 1);
  });

  // Caso real observado: Cancún es UTC-5 — con offset −6 salía −58 min (falso negativo).
  it("usa el huso de la sucursal (Cancún UTC-5)", () => {
    expect(
      duracionCapturaMin({
        fechaHora: "2026-06-05 08:11",
        formCerrado: "2026-06-05T13:12:34.264Z",
        sucursal: "Cancún",
      }),
    ).toBeCloseTo(1.6, 1);
  });

  it("descarta negativos, >24 h y datos faltantes", () => {
    expect(
      duracionCapturaMin({
        fechaHora: "2026-06-05 10:00",
        formCerrado: "2026-06-05T15:00:00Z", // 10:00 local GDL = 16:00Z → cierre ANTES de abrir
        sucursal: "Guadalajara",
      }),
    ).toBeUndefined();
    expect(
      duracionCapturaMin({
        fechaHora: "2026-06-01 10:00",
        formCerrado: "2026-06-03T16:00:00Z", // 2 días después: registro tardío, no captura
        sucursal: "Guadalajara",
      }),
    ).toBeUndefined();
    expect(duracionCapturaMin({ fechaHora: "2026-06-01 10:00", sucursal: "GDL" })).toBeUndefined();
    expect(
      duracionCapturaMin({ formCerrado: "2026-06-01T16:00:00Z", sucursal: "GDL" }),
    ).toBeUndefined();
    expect(
      duracionCapturaMin({
        fechaHora: "basura",
        formCerrado: "2026-06-01T16:00:00Z",
        sucursal: "GDL",
      }),
    ).toBeUndefined();
  });
});

function entry(p: Partial<FuelEntry> & { eco: string }): FuelEntry {
  return {
    loadId: `${p.eco}|carga|${p.eventoId ?? "x"}`,
    tipo: "carga",
    eventoId: p.eventoId ?? "x",
    sucursal: "Guadalajara",
    fecha: "2026-06-05",
    photos: [],
    ...p,
  } as FuelEntry;
}

describe("duracionPorResponsable", () => {
  const e = (eco: string, resp: string, min: number, i: number): FuelEntry =>
    entry({
      eco,
      eventoId: `${resp}${i}`,
      responsable: resp,
      fechaHora: "2026-06-05 10:00",
      // 10:00 GDL = 16:00Z; cierre 16:00Z + min
      formCerrado: new Date(Date.UTC(2026, 5, 5, 16, min)).toISOString(),
    });

  it("mediana por responsable, orden DESC (quien más tarda primero), excluye no medibles", () => {
    const entries = [
      e("1", "JUAN", 2, 0),
      e("1", "JUAN", 4, 1),
      e("1", "JUAN", 6, 2),
      e("2", "ANA", 12, 0),
      e("2", "ANA", 14, 1),
      entry({ eco: "3", eventoId: "sin", responsable: "PEDRO" }), // sin formCerrado → fuera
    ];
    const r = duracionPorResponsable(entries);
    expect(r.map((g) => g.group)).toEqual(["ANA", "JUAN"]);
    expect(r[0]!.medianaMin).toBe(13);
    expect(r[1]!.medianaMin).toBe(4);
    expect(r[1]!.n).toBe(3);
    expect(r.find((g) => g.group === "PEDRO")).toBeUndefined();
  });
});

describe("integración", () => {
  it("mapCargaToFuelEntry lee datos.formCerrado", () => {
    const fe = mapCargaToFuelEntry({
      economicoId: "44",
      tipo: "carga",
      eventoId: "E1",
      datos: JSON.stringify({ formCerrado: "2026-06-04T22:21:33.248Z" }),
    });
    expect(fe.formCerrado).toBe("2026-06-04T22:21:33.248Z");
  });

  it("filterAndSortFuel ordena por tcaptura", () => {
    const NO_FILTER: FuelTableFilter = {
      tipo: "all",
      verdict: "all",
      sucursal: "",
      responsable: "",
      search: "",
      flag: "",
    };
    const rapida = entry({
      eco: "1",
      eventoId: "A",
      fechaHora: "2026-06-05 10:00",
      formCerrado: "2026-06-05T16:02:00Z",
    });
    const lenta = entry({
      eco: "2",
      eventoId: "B",
      fechaHora: "2026-06-05 10:00",
      formCerrado: "2026-06-05T16:15:00Z",
    });
    const asc = filterAndSortFuel([lenta, rapida], NO_FILTER, "tcaptura", 1);
    expect(asc.map((x) => x.eco)).toEqual(["1", "2"]);
    const desc = filterAndSortFuel([lenta, rapida], NO_FILTER, "tcaptura", -1);
    expect(desc.map((x) => x.eco)).toEqual(["2", "1"]);
  });
});
