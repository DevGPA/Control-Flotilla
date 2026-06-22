import { describe, expect, it } from "vitest";
import {
  computeFuelMetrics,
  buildFleetBaseline,
  detectFuelAnomalies,
  worstRisk,
} from "../src/fuel/fuelAnalysis";
import type { FuelEntry } from "../src/fuel/types";

function carga(
  eco: string,
  fecha: string,
  km: number,
  litros: number,
  monto?: number,
  extra: Partial<FuelEntry> = {},
): FuelEntry {
  return {
    loadId: `${eco}|carga|${fecha}`,
    tipo: "carga",
    eco,
    eventoId: fecha,
    sucursal: "Guadalajara",
    fecha,
    fechaHora: `${fecha} 08:00`,
    km,
    litros,
    monto,
    photos: [],
    ...extra,
  };
}

describe("computeFuelMetrics", () => {
  it("km/l = km entre cargas / litros; ordena por fecha; primera carga sin km/l", () => {
    const entries = [
      carga("U1", "2026-01-11", 1500, 50, 1350),
      carga("U1", "2026-01-01", 1000, 50),
    ];
    const m = computeFuelMetrics(entries);
    expect(m).toHaveLength(2);
    const [first, second] = m;
    expect(first!.kmPorLitro).toBeNull(); // primera carga
    expect(second!.kmDesdeAnterior).toBe(500);
    expect(second!.kmPorLitro).toBe(10);
    expect(second!.diasDesdeAnterior).toBe(10);
    expect(second!.precioPorLitro).toBe(27); // 1350/50
  });

  it("ignora solicitudes (sin litros reales)", () => {
    const entries: FuelEntry[] = [
      carga("U1", "2026-01-01", 1000, 50),
      {
        loadId: "U1|solicitud|x",
        tipo: "solicitud",
        eco: "U1",
        eventoId: "x",
        sucursal: "Guadalajara",
        fecha: "2026-01-02",
        photos: [],
      },
    ];
    expect(computeFuelMetrics(entries)).toHaveLength(1);
  });

  it("odómetro que retrocede → km/l null y kmDesdeAnterior negativo", () => {
    const m = computeFuelMetrics([
      carga("U1", "2026-01-01", 1000, 50),
      carga("U1", "2026-01-05", 900, 50),
    ]);
    expect(m[1]!.kmDesdeAnterior).toBe(-100);
    expect(m[1]!.kmPorLitro).toBeNull();
  });
});

describe("buildFleetBaseline", () => {
  it("calcula media por unidad y media de flota", () => {
    const entries = [
      carga("U1", "2026-01-01", 0, 50),
      carga("U1", "2026-01-10", 500, 50), // 10 km/l
      carga("U1", "2026-01-20", 1000, 50), // 10 km/l
    ];
    const base = buildFleetBaseline(computeFuelMetrics(entries), entries);
    expect(base.porUnidad.get("U1")!.mean).toBeCloseTo(10, 6);
    expect(base.flotaMean).toBeCloseTo(10, 6);
  });
});

describe("detectFuelAnomalies", () => {
  it("marca Urgente cuando el odómetro retrocede", () => {
    const entries = [carga("U1", "2026-01-01", 1000, 50), carga("U1", "2026-01-05", 900, 50)];
    const metrics = computeFuelMetrics(entries);
    const f = detectFuelAnomalies(metrics, buildFleetBaseline(metrics, entries));
    const retro = f.find((x) => x.key.startsWith("Fuel:km-retrocede:"));
    expect(retro).toBeTruthy();
    expect(retro!.lv).toBe("Urgente");
    expect(retro!.cat).toBe("Combustible");
  });

  it("marca error de captura con litros inválidos", () => {
    const metrics = computeFuelMetrics([carga("U1", "2026-01-01", 1000, 0)]);
    const f = detectFuelAnomalies(metrics, buildFleetBaseline(metrics, []));
    expect(f.some((x) => x.key.startsWith("Fuel:captura-litros:"))).toBe(true);
  });

  it("detecta caída de rendimiento contra el histórico de la unidad", () => {
    // 4 cargas a ~10 km/l + 1 carga a 4 km/l → baseline≈10, evento bajo = Revisar
    const entries = [
      carga("U1", "2026-01-01", 0, 50),
      carga("U1", "2026-01-05", 500, 50), // 10
      carga("U1", "2026-01-09", 1000, 50), // 10
      carga("U1", "2026-01-13", 1500, 50), // 10
      carga("U1", "2026-01-17", 1700, 50), // 4 km/l (200/50)
    ];
    const metrics = computeFuelMetrics(entries);
    const f = detectFuelAnomalies(metrics, buildFleetBaseline(metrics, entries));
    expect(f.some((x) => x.key.startsWith("Fuel:rendimiento:"))).toBe(true);
  });

  it("marca cargas demasiado frecuentes", () => {
    const entries = [
      carga("U1", "2026-01-01", 1000, 50, undefined, { fechaHora: "2026-01-01 08:00" }),
      carga("U1", "2026-01-01", 1100, 50, undefined, { fechaHora: "2026-01-01 14:00" }),
    ];
    const metrics = computeFuelMetrics(entries);
    const f = detectFuelAnomalies(metrics, buildFleetBaseline(metrics, entries));
    expect(f.some((x) => x.key.startsWith("Fuel:frecuencia:"))).toBe(true);
  });
});

describe("worstRisk", () => {
  it("devuelve el nivel más severo", () => {
    expect(worstRisk([{ lv: "OK" }, { lv: "Revisar" }, { lv: "Urgente" }])).toBe("Urgente");
    expect(worstRisk([])).toBe("OK");
  });
});
