import { describe, expect, it } from "vitest";
import {
  computeFuelMetrics,
  buildFleetBaseline,
  detectFuelAnomalies,
} from "../src/fuel/fuelAnalysis";
import type { FuelEntry } from "../src/fuel/types";

function carga(p: Partial<FuelEntry> & { eco: string; fecha: string }): FuelEntry {
  return {
    loadId: `${p.eco}|carga|${p.eventoId ?? p.fecha}`,
    tipo: "carga",
    eventoId: p.eventoId ?? p.fecha,
    sucursal: "Guadalajara",
    photos: [],
    ...p,
  } as FuelEntry;
}

/** Corre el detector sobre las entradas y devuelve solo los findings de la regla tanque-95. */
function tanque95De(entries: FuelEntry[]) {
  const metrics = computeFuelMetrics(entries);
  const baseline = buildFleetBaseline(metrics, entries);
  return detectFuelAnomalies(metrics, baseline).filter((f) => f.key.includes(":tanque-95:"));
}

describe("regla tanque-95 (carga > 95% de la capacidad nominal)", () => {
  it("dispara cuando los litros superan el 95% del tanque", () => {
    const entries = [
      carga({ eco: "10", fecha: "2026-03-01", tanque: "60", litros: 40, km: 100, monto: 1000 }),
      carga({ eco: "10", fecha: "2026-03-10", tanque: "60", litros: 58, km: 600, monto: 1400 }),
    ];
    const found = tanque95De(entries);
    expect(found).toHaveLength(1);
    expect(found[0]!.loadId).toBe("10|carga|2026-03-10");
    expect(found[0]!.lv).toBe("Revisar");
    expect(found[0]!.text).toContain("97%");
    expect(found[0]!.text).toContain("58.0 L de 60 L");
  });

  it("NO dispara al 90% de la capacidad", () => {
    const entries = [
      carga({ eco: "10", fecha: "2026-03-01", tanque: "60", litros: 54, km: 100, monto: 1300 }),
    ];
    expect(tanque95De(entries)).toHaveLength(0);
  });

  it("NO dispara sin capacidad de tanque fiable (ausente o no numérica)", () => {
    const entries = [
      carga({ eco: "10", fecha: "2026-03-01", litros: 80, km: 100, monto: 2000 }),
      carga({ eco: "20", fecha: "2026-03-01", tanque: "N/A", litros: 80, km: 100, monto: 2000 }),
      carga({ eco: "30", fecha: "2026-03-01", tanque: "", litros: 80, km: 100, monto: 2000 }),
    ];
    expect(tanque95De(entries)).toHaveLength(0);
  });

  it("NO dispara en montacargas (tanque Gas LP no comparable)", () => {
    const entries = [
      carga({
        eco: "40",
        fecha: "2026-03-01",
        tanque: "30",
        litros: 29.5,
        km: 100,
        monto: 500,
        esMontacargas: true,
        producto: "GAS LP",
      }),
    ];
    expect(tanque95De(entries)).toHaveLength(0);
  });

  it("computeFuelMetrics pobla tanqueCap solo cuando el tanque parsea", () => {
    const metrics = computeFuelMetrics([
      carga({ eco: "10", fecha: "2026-03-01", tanque: "60", litros: 40, km: 100 }),
      carga({ eco: "20", fecha: "2026-03-01", tanque: "N/A", litros: 40, km: 100 }),
      carga({ eco: "30", fecha: "2026-03-01", litros: 40, km: 100 }),
    ]);
    const byLoad = new Map(metrics.map((m) => [m.eco, m.tanqueCap]));
    expect(byLoad.get("10")).toBe(60);
    expect(byLoad.get("20")).toBeUndefined();
    expect(byLoad.get("30")).toBeUndefined();
  });

  it("convive con litros-implausibles (keys distintas, misma carga)", () => {
    // 4+ cargas del mismo tipo con litros ~40 para armar el techo estadístico; la última
    // carga 130 L en un tanque de 60 → dispara AMBAS reglas con identidad distinta.
    const entries = [
      carga({ eco: "10", fecha: "2026-03-01", tanque: "60", litros: 40, km: 100, monto: 1000 }),
      carga({ eco: "10", fecha: "2026-03-05", tanque: "60", litros: 41, km: 400, monto: 1000 }),
      carga({ eco: "10", fecha: "2026-03-09", tanque: "60", litros: 39, km: 700, monto: 1000 }),
      carga({ eco: "10", fecha: "2026-03-13", tanque: "60", litros: 40, km: 1000, monto: 1000 }),
      carga({ eco: "10", fecha: "2026-03-17", tanque: "60", litros: 130, km: 1300, monto: 3000 }),
    ];
    const metrics = computeFuelMetrics(entries);
    const baseline = buildFleetBaseline(metrics, entries);
    const all = detectFuelAnomalies(metrics, baseline);
    const target = all.filter((f) => f.loadId === "10|carga|2026-03-17");
    expect(target.some((f) => f.key.includes(":tanque-95:"))).toBe(true);
    expect(target.some((f) => f.key.includes(":litros-implausibles:"))).toBe(true);
  });
});
