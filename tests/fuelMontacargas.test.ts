import { describe, expect, it } from "vitest";
import { mapCargaToFuelEntry, type CargaRow } from "../src/fuel/mapEntry";
import {
  computeFuelMetrics,
  buildFleetBaseline,
  detectFuelAnomalies,
} from "../src/fuel/fuelAnalysis";
import type { FuelEntry } from "../src/fuel/types";

function row(eco: string, producto: string, combustible = "Gasolina"): CargaRow {
  return {
    economicoId: eco,
    tipo: "carga",
    eventoId: "1",
    sucursal: "Cedis",
    fecha: "2026-03-01",
    kmCapturado: 600,
    litrosCargados: 21,
    montoTotal: 250,
    datos: JSON.stringify({ producto, combustible }),
  };
}

describe("mapEntry — detección de montacargas por producto", () => {
  it("Gas LP → esMontacargas=true, tipoUnidad 'Gas LP' (aunque combustible diga Gasolina)", () => {
    const e = mapCargaToFuelEntry(row("41", "TOKA COMBUSTIBLE GAS LP CHIP", "Gasolina"));
    expect(e.esMontacargas).toBe(true);
    expect(e.tipoUnidad).toMatch(/gas lp/i);
  });
  it("Diesel → no montacargas, tipoUnidad Diesel", () => {
    const e = mapCargaToFuelEntry(row("90", "TOKA COMBUSTIBLE DIESEL CHIP", "Diesel"));
    expect(e.esMontacargas).toBe(false);
    expect(e.tipoUnidad).toMatch(/diesel/i);
  });
  it("Premium → no montacargas", () => {
    const e = mapCargaToFuelEntry(row("65", "TOKA COMBUSTIBLE PREMIUM CHIP", "Gasolina"));
    expect(e.esMontacargas).toBe(false);
  });
});

// Montacargas: km = horómetro (incrementos chicos), NO debe producir km/l.
function carga(
  eco: string,
  fecha: string,
  km: number,
  litros: number,
  esMontacargas: boolean,
): FuelEntry {
  return {
    loadId: `${eco}|carga|${fecha}`,
    tipo: "carga",
    eco,
    eventoId: fecha,
    sucursal: "Cedis",
    fecha,
    fechaHora: `${fecha} 08:00`,
    km,
    litros,
    monto: litros * 12,
    esMontacargas,
    photos: [],
  };
}

describe("computeFuelMetrics — excluye km/l de montacargas", () => {
  it("montacargas: kmPorLitro null aunque el horómetro incremente", () => {
    const m = computeFuelMetrics([
      carga("41", "2026-01-01", 571, 21, true),
      carga("41", "2026-01-12", 577, 21, true),
    ]);
    expect(m[1]!.kmPorLitro).toBeNull();
    expect(m[1]!.kmDesdeAnterior).toBeNull();
  });
  it("vehículo normal: sí calcula km/l", () => {
    const m = computeFuelMetrics([
      carga("90", "2026-01-01", 1000, 50, false),
      carga("90", "2026-01-10", 1500, 50, false),
    ]);
    expect(m[1]!.kmPorLitro).toBe(10);
  });
});

describe("detectFuelAnomalies — no marca rendimiento/fuga a montacargas", () => {
  it("montacargas no genera caída de rendimiento ni fuga", () => {
    const entries = [
      carga("41", "2026-01-01", 571, 21, true),
      carga("41", "2026-01-12", 577, 21, true),
      carga("41", "2026-01-20", 583, 21, true),
      carga("41", "2026-01-28", 589, 21, true),
    ];
    const metrics = computeFuelMetrics(entries);
    const baseline = buildFleetBaseline(metrics, entries);
    const f = detectFuelAnomalies(metrics, baseline);
    expect(f.some((x) => x.key.startsWith("Fuel:rendimiento:"))).toBe(false);
    expect(f.some((x) => x.key.startsWith("Fuel:fuga:"))).toBe(false);
    expect(f.some((x) => x.key.startsWith("Fuel:km-"))).toBe(false);
  });
});
