import { describe, expect, it } from "vitest";
import { buildKpisFuel } from "../src/fuel/renderKpis";
import {
  buildFleetBaseline,
  detectFuelAnomalies,
  computeFuelMetrics,
} from "../src/fuel/fuelAnalysis";
import type { FuelEntry } from "../src/fuel/types";

// Mismo estilo de fixture que tests/renderTableCombustible.test.ts.
function entry(p: Partial<FuelEntry> & { eco: string; tipo: "carga" | "solicitud" }): FuelEntry {
  return {
    loadId: `${p.eco}|${p.tipo}|${p.eventoId ?? p.fecha ?? "x"}`,
    eventoId: p.eventoId ?? p.fecha ?? "x",
    sucursal: "Guadalajara",
    fecha: "2026-03-01",
    photos: [],
    ...p,
  } as FuelEntry;
}

describe("buildKpisFuel — deltas con `prev` (Task 10)", () => {
  // Periodo ACTUAL: 2 cargas, 100 L, $2,700 — mayor gasto/litros/cargas que `prev`.
  const entries = [
    entry({ eco: "U1", tipo: "carga", fecha: "2026-03-01", km: 0, litros: 50, monto: 1350 }),
    entry({ eco: "U1", tipo: "carga", fecha: "2026-03-10", km: 500, litros: 50, monto: 1350 }),
  ];
  const metrics = computeFuelMetrics(entries);
  const baseline = buildFleetBaseline(metrics, entries);
  const anomalies = detectFuelAnomalies(metrics, baseline);

  it("con `prev`: cargas/litros/gasto llevan delta con el tono correcto; el resto no", () => {
    // prev: 1 carga, 50 L, $1,000 → actual sube en las 3 métricas.
    const prev = { cargas: 1, litros: 50, gasto: 1000 };
    const kpis = buildKpisFuel(entries, metrics, baseline, anomalies, undefined, prev);
    const byKey = Object.fromEntries(kpis.map((k) => [k.key, k]));

    // gasto sube → semántica "costo" → tone "mala"
    expect(byKey.gasto!.delta).toBeTruthy();
    expect(byKey.gasto!.delta!.direccion).toBe("up");
    expect(byKey.gasto!.delta!.tone).toBe("mala");

    // litros sube → semántica "neutral" → tone "neutra" (no "buena"/"mala" aunque suba)
    expect(byKey.litros!.delta).toBeTruthy();
    expect(byKey.litros!.delta!.direccion).toBe("up");
    expect(byKey.litros!.delta!.tone).toBe("neutra");

    // cargas sube → también "neutral"
    expect(byKey.cargas!.delta).toBeTruthy();
    expect(byKey.cargas!.delta!.direccion).toBe("up");
    expect(byKey.cargas!.delta!.tone).toBe("neutra");

    // el resto de tarjetas (fuera del alcance de esta tarea) no lleva delta
    expect(byKey.kmpl!.delta).toBeFalsy();
    expect(byKey["cobertura-kmpl"]!.delta).toBeFalsy();
    expect(byKey.discrepancias!.delta).toBeFalsy();
    expect(byKey.pendientes!.delta).toBeFalsy();
    expect(byKey.anomalias!.delta).toBeFalsy();
  });

  it("sin `prev`: ninguna tarjeta lleva delta (compatibilidad hacia atrás)", () => {
    const kpis = buildKpisFuel(entries, metrics, baseline, anomalies);
    for (const k of kpis) expect(k.delta).toBeFalsy();
  });

  it("`prev` con gasto anterior 0: delta de gasto es null (sin base honesta)", () => {
    const prev = { cargas: 1, litros: 50, gasto: 0 };
    const kpis = buildKpisFuel(entries, metrics, baseline, anomalies, undefined, prev);
    const byKey = Object.fromEntries(kpis.map((k) => [k.key, k]));
    expect(byKey.gasto!.delta).toBeNull();
  });
});

describe("buildKpisFuel — jerarquía de grupos (fix Producto Vivo #2)", () => {
  const entries = [
    entry({ eco: "U1", tipo: "carga", fecha: "2026-03-01", km: 0, litros: 50, monto: 1350 }),
    entry({ eco: "U1", tipo: "carga", fecha: "2026-03-10", km: 500, litros: 50, monto: 1350 }),
  ];
  const metrics = computeFuelMetrics(entries);
  const baseline = buildFleetBaseline(metrics, entries);
  const anomalies = detectFuelAnomalies(metrics, baseline);

  it("núcleo = cargas/litros/rendimiento/gasto; estado = alertas accionables", () => {
    const kpis = buildKpisFuel(entries, metrics, baseline, anomalies);
    const byKey = Object.fromEntries(kpis.map((k) => [k.key, k]));
    for (const k of ["cargas", "litros", "kmpl", "gasto"]) {
      expect(byKey[k]!.grupo, `${k} debe ser núcleo`).toBe("nucleo");
    }
    // cobertura-kmpl es ahora la métrica núcleo que reemplaza sin-rendimiento (pero es nucleo, no estado)
    expect(byKey["cobertura-kmpl"]!.grupo, "cobertura-kmpl debe ser nucleo").toBe("nucleo");
    // errores-captura es la tarjeta de estado que aparece si hay errores accionables
    if (byKey["errores-captura"]) {
      expect(byKey["errores-captura"]!.grupo, "errores-captura debe ser estado").toBe("estado");
    }
    // el resto de chips siempre existen y son estado
    for (const k of ["discrepancias", "pendientes", "anomalias"]) {
      expect(byKey[k]!.grupo, `${k} debe ser estado`).toBe("estado");
    }
  });
});
