import { describe, expect, it } from "vitest";
import { rangoAnterior, deltaKpi, totalesCargas } from "../src/fuel/kpiDeltas";
import type { FuelEntry } from "../src/fuel/types";

describe("rangoAnterior", () => {
  it("mismo largo, inmediatamente anterior (inclusivo)", () => {
    expect(rangoAnterior({ from: "2026-05-01", to: "2026-07-31" })).toEqual({
      from: "2026-01-29",
      to: "2026-04-30",
    });
    expect(rangoAnterior({ from: "2026-07-01", to: "2026-07-01" })).toEqual({
      from: "2026-06-30",
      to: "2026-06-30",
    });
  });
});

describe("deltaKpi", () => {
  it("semántica costo: subir gasto es malo", () => {
    expect(deltaKpi(110, 100, "costo")).toEqual({ pct: 10, direccion: "up", tone: "mala" });
    expect(deltaKpi(90, 100, "costo")).toEqual({ pct: -10, direccion: "down", tone: "buena" });
  });
  it("neutral: cualquier dirección es neutra; sin base → null; sin cambio → flat", () => {
    expect(deltaKpi(110, 100, "neutral")!.tone).toBe("neutra");
    expect(deltaKpi(5, 0, "neutral")).toBeNull();
    expect(deltaKpi(100, 100, "costo")).toEqual({ pct: 0, direccion: "flat", tone: "neutra" });
  });
});

describe("totalesCargas", () => {
  it("suma solo cargas dentro del rango inclusivo", () => {
    const es = [
      { tipo: "carga", fecha: "2026-06-30", litros: 10, monto: 240 },
      { tipo: "carga", fecha: "2026-07-01", litros: 5, monto: 120 },
      { tipo: "solicitud", fecha: "2026-06-30", litros: 99, monto: 999 },
    ] as FuelEntry[];
    expect(totalesCargas(es, { from: "2026-06-01", to: "2026-06-30" })).toEqual({
      litros: 10,
      gasto: 240,
      cargas: 1,
    });
  });
});
