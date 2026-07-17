import { describe, expect, it } from "vitest";
import {
  computeFuelMetrics,
  buildFleetBaseline,
  detectFuelAnomalies,
  ruleOfFinding,
} from "../src/fuel/fuelAnalysis";
import type { FuelEntry } from "../src/fuel/types";

/**
 * Detector de ECONÓMICO EQUIVOCADO (cross-match de odómetro). Caso real 2026-07-17:
 * la carga de la unidad 73 (JY38194, odómetro ~101,430) se capturó bajo el económico 32
 * en Operaciones-GPA → retroceso de 23,435 km para la 32. El detector reconoce que esa
 * lectura encaja con el histórico de OTRA unidad de la misma sucursal y lo señala.
 */

function carga(
  eco: string,
  fecha: string,
  km: number,
  over: Partial<FuelEntry> = {},
): FuelEntry {
  return {
    loadId: `${eco}|carga|${fecha}`,
    tipo: "carga",
    eco,
    eventoId: fecha,
    sucursal: "Monterrey",
    fecha,
    fechaHora: `${fecha} 09:00`,
    km,
    litros: 30,
    monto: 720,
    seLlenoTanque: "Si",
    placa: `PL-${eco}`,
    photos: [],
    ...over,
  };
}

/** Corre el pipeline y devuelve los findings de econonómico-equivocado por loadId. */
function ecoEqFindings(entries: FuelEntry[]) {
  const metrics = computeFuelMetrics(entries);
  const baseline = buildFleetBaseline(metrics, entries);
  const findings = detectFuelAnomalies(metrics, baseline, undefined, entries);
  return findings.filter((f) => ruleOfFinding(f) === "economico-equivocado");
}

describe("detector de económico equivocado (cross-match de odómetro)", () => {
  it("marca la carga huérfana nombrando la unidad cuyo histórico encaja (caso 32↔73)", () => {
    const entries = [
      // Unidad 32: sube ~124k
      carga("32", "2026-07-03", 123754),
      carga("32", "2026-07-08", 124265),
      carga("32", "2026-07-15", 124865),
      // Unidad 73: sube ~101k
      carga("73", "2026-07-08", 100116),
      carga("73", "2026-07-13", 100824),
      carga("73", "2026-07-16", 101258),
      // La carga mal capturada: entra como 32 pero el odómetro es de la 73
      carga("32", "2026-07-17", 101430, { loadId: "32|carga|MAL", eventoId: "MAL", placa: "PU7496A" }),
    ];
    const fs = ecoEqFindings(entries);
    expect(fs).toHaveLength(1);
    expect(fs[0]!.loadId).toBe("32|carga|MAL");
    expect(fs[0]!.text).toContain("73"); // nombra la unidad correcta
    expect(fs[0]!.text.toLowerCase()).toContain("económico");
  });

  it("NO marca si el odómetro no encaja con ninguna otra unidad (solo retroceso normal)", () => {
    const entries = [
      carga("32", "2026-07-03", 123754),
      carga("32", "2026-07-15", 124865),
      carga("32", "2026-07-17", 500, { loadId: "32|carga|BAJO", eventoId: "BAJO" }), // typo, no encaja con nadie
      carga("73", "2026-07-16", 101258),
    ];
    expect(ecoEqFindings(entries)).toHaveLength(0);
  });

  it("NO cruza entre sucursales distintas (evita falsos positivos)", () => {
    const entries = [
      carga("32", "2026-07-15", 124865, { sucursal: "Monterrey" }),
      carga("32", "2026-07-17", 101430, { loadId: "32|carga|MAL", eventoId: "MAL" }),
      // 73 encaja por km PERO está en otra sucursal → no debe cruzar
      carga("73", "2026-07-16", 101258, { sucursal: "Guadalajara" }),
    ];
    expect(ecoEqFindings(entries)).toHaveLength(0);
  });

  it("NO marca cargas normales (sin retroceso) aunque su km ronde el de otra unidad", () => {
    const entries = [
      carga("32", "2026-07-10", 100200),
      carga("32", "2026-07-17", 100450), // avance normal para la 32
      carga("73", "2026-07-16", 100300), // km cercano, pero la 32 no es huérfana
    ];
    expect(ecoEqFindings(entries)).toHaveLength(0);
  });

  it("ignora montacargas como candidato y como match (odómetro = horómetro)", () => {
    const entries = [
      carga("M1", "2026-07-15", 5000, { esMontacargas: true }),
      carga("M1", "2026-07-17", 120, { loadId: "M1|carga|MAL", eventoId: "MAL", esMontacargas: true }),
      carga("73", "2026-07-16", 118, { esMontacargas: true }),
    ];
    expect(ecoEqFindings(entries)).toHaveLength(0);
  });

  it("no encaja si la lectura de la otra unidad está demasiado lejos en el tiempo", () => {
    const entries = [
      carga("32", "2026-07-15", 124865),
      carga("32", "2026-07-17", 101430, { loadId: "32|carga|MAL", eventoId: "MAL" }),
      // 73 tuvo ~101k pero hace meses; su odómetro actual ya está muy por encima
      carga("73", "2026-01-05", 101300),
      carga("73", "2026-07-16", 140000),
    ];
    expect(ecoEqFindings(entries)).toHaveLength(0);
  });
});
