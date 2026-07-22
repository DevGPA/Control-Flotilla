import { describe, expect, it } from "vitest";
import {
  computeFuelMetrics,
  buildFleetBaseline,
  detectFuelAnomalies,
  FUEL_RULE_LABEL,
} from "../src/fuel/fuelAnalysis";
import type { FuelEntry } from "../src/fuel/types";

/**
 * Alerta "parciales crónicos": si ≥60% de las últimas 8 cargas de una unidad no
 * llenan el tanque, no se puede medir su rendimiento — chip en la carga más reciente
 * para que logística corrija el hábito en campo (caso real: unidad 47).
 */

let seq = 0;
function carga(lleno: "Si" | "No", over: Partial<FuelEntry> = {}): FuelEntry {
  const n = ++seq;
  const fecha = `2026-06-${String((n % 27) + 1).padStart(2, "0")}`;
  return {
    loadId: `47|carga|p${n}`,
    tipo: "carga",
    eco: "47",
    eventoId: `p${n}`,
    sucursal: "Cancun",
    fecha,
    fechaHora: `${fecha} 08:00`,
    km: 10000 + n * 300,
    litros: 30,
    monto: 800,
    seLlenoTanque: lleno,
    tanque: "58",
    photos: [],
    ...over,
  };
}

function findingsDe(entries: FuelEntry[]) {
  const metrics = computeFuelMetrics(entries);
  return detectFuelAnomalies(metrics, buildFleetBaseline(metrics, entries));
}

describe("alerta parciales-cronicos", () => {
  it("dispara con 6 de 8 parciales, anclada a la carga MÁS RECIENTE", () => {
    seq = 0;
    const entries = [
      carga("Si"),
      carga("No"),
      carga("No"),
      carga("No"),
      carga("Si"),
      carga("No"),
      carga("No"),
      carga("No"),
    ];
    const f = findingsDe(entries).filter((x) => x.key.includes("parciales-cronicos"));
    expect(f).toHaveLength(1);
    expect(f[0]!.loadId).toBe(entries[entries.length - 1]!.loadId);
    expect(f[0]!.text).toContain("6 de las últimas 8");
  });

  it("NO dispara con menos parciales (4 de 8) ni con muestra chica (5 cargas)", () => {
    seq = 0;
    const pocos = [
      carga("Si"),
      carga("No"),
      carga("Si"),
      carga("No"),
      carga("Si"),
      carga("No"),
      carga("Si"),
      carga("No"),
    ];
    expect(findingsDe(pocos).some((x) => x.key.includes("parciales-cronicos"))).toBe(false);
    seq = 0;
    const muestraChica = [carga("No"), carga("No"), carga("No"), carga("No"), carga("No")];
    expect(findingsDe(muestraChica).some((x) => x.key.includes("parciales-cronicos"))).toBe(false);
  });

  it("los llenos INFERIDOS (≥95% del tanque) cuentan como llenos y desactivan la alerta", () => {
    seq = 0;
    // 6 marcadas "No" pero con 56 L (≥ 0.95·58): físicamente llenaron → no es hábito parcial.
    const entries = [
      carga("Si"),
      carga("No", { litros: 56 }),
      carga("No", { litros: 56 }),
      carga("No", { litros: 56 }),
      carga("Si"),
      carga("No", { litros: 56 }),
      carga("No", { litros: 56 }),
      carga("No", { litros: 56 }),
    ];
    expect(findingsDe(entries).some((x) => x.key.includes("parciales-cronicos"))).toBe(false);
  });

  it("montacargas quedan fuera (no cargan a tanque lleno por diseño)", () => {
    seq = 0;
    const entries = Array.from({ length: 8 }, () => carga("No", { esMontacargas: true }));
    expect(findingsDe(entries).some((x) => x.key.includes("parciales-cronicos"))).toBe(false);
  });

  it("tiene etiqueta legible para el filtro de alertas", () => {
    expect(FUEL_RULE_LABEL["parciales-cronicos"]).toBe("Parciales crónicos");
  });
});
