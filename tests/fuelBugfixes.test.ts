import { describe, expect, it } from "vitest";
import {
  computeFuelMetrics,
  detectFuelAnomalies,
  buildFleetBaseline,
} from "../src/fuel/fuelAnalysis";
import { montoEfectivo, aggByGroup, aggByMonth } from "../src/fuel/fuelAggregates";
import type { FuelEntry } from "../src/fuel/types";

function carga(
  eco: string,
  fecha: string,
  km: number,
  litros: number,
  over: Partial<FuelEntry> = {},
): FuelEntry {
  return {
    loadId: `${eco}|carga|${fecha}`,
    tipo: "carga",
    eco,
    eventoId: fecha,
    sucursal: "Guadalajara",
    fecha,
    km,
    litros,
    seLlenoTanque: "Si", // eventos llenos: la ventana equivale al intervalo clásico
    photos: [],
    ...over,
  };
}

describe("#1 toTime: orden con fecha-solo vs fechaHora (fix husos)", () => {
  it("ordena cronológicamente aunque mezcle formatos y NO inventa km-retrocede", () => {
    const entries = [
      carga("U1", "2026-03-01", 1000, 50, { fechaHora: "2026-03-01 20:00" }),
      carga("U1", "2026-03-02", 1100, 50), // sin fechaHora (solo fecha)
    ];
    const m = computeFuelMetrics(entries);
    const later = m.find((x) => x.fecha === "2026-03-02")!;
    expect(later.kmDesdeAnterior).toBe(100); // 1100 - 1000, no negativo
    expect(later.kmPorLitro).toBe(2);
    // Antes del fix, el desfase de huso invertía el orden → km/l negativo y un
    // FALSO "km-retrocede". Con el fix el orden es correcto y no aparece.
    const f = detectFuelAnomalies(m, buildFleetBaseline(m, entries));
    expect(f.some((x) => x.key.startsWith("Fuel:km-retrocede:"))).toBe(false);
  });
});

describe("#2 montoEfectivo (fix gasto subestimado)", () => {
  it("usa monto si está; reconstruye litros×precio si falta; 0 si nada", () => {
    expect(montoEfectivo({ monto: 1200 })).toBe(1200);
    expect(montoEfectivo({ litros: 50, precioPorLitro: 24 })).toBe(1200);
    expect(montoEfectivo({ litros: 50 })).toBe(0);
    expect(montoEfectivo({})).toBe(0);
  });
  it("aggByGroup y aggByMonth suman el monto reconstruido", () => {
    const e = [carga("U1", "2026-03-01", 100, 50, { precioPorLitro: 24 })]; // sin monto
    expect(aggByGroup(e, (x) => x.sucursal)[0]!.gasto).toBe(1200);
    expect(aggByMonth(e)[0]!.gasto).toBe(1200);
  });
});
