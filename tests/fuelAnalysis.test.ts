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

describe("computeFuelMetrics — exclusiones que protegen el ranking", () => {
  it("salto de odómetro improbable (> MAX_KM_JUMP) → km/l null pero alerta viva", () => {
    const m = computeFuelMetrics([
      carga("U1", "2026-01-01", 1000, 50),
      carga("U1", "2026-01-20", 10500, 50), // salto 9500 km > 8000
    ]);
    expect(m[1]!.kmDesdeAnterior).toBe(9500);
    expect(m[1]!.kmPorLitro).toBeNull(); // excluido de baseline/ranking (no infla)
    // la alerta km-salto sigue disparando (usa kmDesdeAnterior, no kmPorLitro)
    const f = detectFuelAnomalies(m, buildFleetBaseline(m, []));
    expect(f.some((x) => x.key.startsWith("Fuel:km-salto:"))).toBe(true);
  });

  it("si la carga ANTERIOR es montacargas, no computa km/l (guard sobre prev)", () => {
    const m = computeFuelMetrics([
      carga("U1", "2026-01-01", 100, 50, undefined, { esMontacargas: true }),
      carga("U1", "2026-01-10", 600, 50),
    ]);
    expect(m[1]!.kmPorLitro).toBeNull();
  });

  it("dos cargas el mismo día sin hora → orden por odómetro, sin falso retroceso", () => {
    const hi = carga("U1", "2026-01-01", 1500, 50, undefined, {
      fechaHora: "2026-01-01",
      loadId: "U1|carga|hi",
    });
    const lo = carga("U1", "2026-01-01", 1000, 50, undefined, {
      fechaHora: "2026-01-01",
      loadId: "U1|carga|lo",
    });
    const m = computeFuelMetrics([hi, lo]); // entra desordenada (mayor km primero)
    expect(m[0]!.km).toBe(1000); // se reordena por km asc
    expect(m[1]!.km).toBe(1500);
    expect(m[1]!.kmDesdeAnterior).toBe(500); // +500, no -500
    expect(m[1]!.kmPorLitro).toBe(10);
  });
});

describe("buildFleetBaseline", () => {
  it("calcula media por unidad, media de flota y ponderado por volumen", () => {
    const entries = [
      carga("U1", "2026-01-01", 0, 50),
      carga("U1", "2026-01-10", 500, 50), // 10 km/l
      carga("U1", "2026-01-20", 1000, 50), // 10 km/l
    ];
    const base = buildFleetBaseline(computeFuelMetrics(entries), entries);
    expect(base.porUnidad.get("U1")!.mean).toBeCloseTo(10, 6);
    expect(base.porUnidad.get("U1")!.kmplVol!).toBeCloseTo(10, 6); // (500+500)/(50+50)
    expect(base.flotaMean).toBeCloseTo(10, 6);
    expect(base.flotaKmplVol!).toBeCloseTo(10, 6);
  });

  it("kmplVol = Σkm/Σlitros (ponderado), NO la media de ratios", () => {
    // 1ª sin km/l; luego 50 km/10 L = 5 y 500 km/50 L = 10.
    // Media de ratios = 7.5 (sesgada); ponderado = 550/60 = 9.17 (fiel).
    const entries = [
      carga("U1", "2026-01-01", 0, 10),
      carga("U1", "2026-01-05", 50, 10),
      carga("U1", "2026-01-10", 550, 50),
    ];
    const base = buildFleetBaseline(computeFuelMetrics(entries), entries);
    const s = base.porUnidad.get("U1")!;
    expect(s.mean).toBeCloseTo(7.5, 2); // distribución por evento (anomalías)
    expect(s.kmplVol!).toBeCloseTo(9.17, 2); // eficiencia ponderada (se muestra/ranquea)
    expect(base.flotaKmplVol!).toBeCloseTo(9.17, 2);
  });

  it("la cerca IQR excluye un dedazo de litros antes de ponderar", () => {
    const entries = [
      carga("U1", "2026-01-01", 0, 50),
      carga("U1", "2026-01-05", 500, 50), // 10
      carga("U1", "2026-01-09", 1000, 50), // 10
      carga("U1", "2026-01-13", 1500, 50), // 10
      carga("U1", "2026-01-17", 2000, 50), // 10
      carga("U1", "2026-01-21", 2050, 250), // 50 km / 250 L = 0.2 (dedazo) → fuera de cerca
    ];
    const base = buildFleetBaseline(computeFuelMetrics(entries), entries);
    // Sin la cerca el ponderado sería (2000+50)/(200+250)=4.56; con la cerca el dedazo se excluye.
    expect(base.porUnidad.get("U1")!.kmplVol!).toBeCloseTo(10, 1);
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
