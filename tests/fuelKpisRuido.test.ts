// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { buildKpisFuel } from "../src/fuel/renderKpis";
import { buildFleetBaseline } from "../src/fuel/fuelAnalysis";
import type { FuelEntry, FuelMetrics, FleetBaseline } from "../src/fuel/types";

/** loadId determinista: un contador, para que un fallo sea reproducible. */
let seq = 0;

/** Carga mínima viable; `over` sobreescribe lo que el test necesite. */
function entry(over: Partial<FuelEntry> = {}): FuelEntry {
  return {
    loadId: `${over.eco ?? "10"}|carga|E${++seq}`,
    tipo: "carga",
    eco: "10",
    eventoId: "E1",
    sucursal: "Guadalajara",
    fecha: "2026-07-15",
    tipoUnidad: "Gasolina Magna",
    esMontacargas: false,
    photos: [],
    ...over,
  } as FuelEntry;
}

/** Métrica de una carga: `kmPorLitro: null` + motivo = "sin rendimiento". */
function metric(loadId: string, motivo?: FuelMetrics["motivoSinKmpl"]): FuelMetrics {
  return {
    loadId,
    eco: "10",
    fecha: "2026-07-15",
    kmPorLitro: motivo ? null : 8,
    motivoSinKmpl: motivo,
  } as FuelMetrics;
}

const BASELINE: FleetBaseline = buildFleetBaseline([], []);
const card = (cards: ReturnType<typeof buildKpisFuel>, key: string) =>
  cards.find((c) => c.key === key);

describe("C1 — el chip cuenta errores de captura, no huecos estructurales", () => {
  it("cuenta SOLO los motivos accionables, no las 5 estructurales", () => {
    // 2 accionables (odómetro retrocede, salto) + 3 estructurales (ventana, montacargas, 1ª carga)
    const es = [entry(), entry(), entry(), entry(), entry()];
    const ms = [
      metric(es[0]!.loadId, "odometro_retroceso"),
      metric(es[1]!.loadId, "salto_improbable"),
      metric(es[2]!.loadId, "parcial_en_ventana"),
      metric(es[3]!.loadId, "montacargas"),
      metric(es[4]!.loadId, "primera_carga"),
    ];
    const cards = buildKpisFuel(es, ms, BASELINE, []);
    expect(card(cards, "errores-captura")?.value).toBe("2");
    expect(card(cards, "sin-rendimiento")).toBeUndefined();
  });

  it("se auto-oculta cuando no hay errores accionables", () => {
    const e = entry();
    const cards = buildKpisFuel([e], [metric(e.loadId, "montacargas")], BASELINE, []);
    expect(card(cards, "errores-captura")).toBeUndefined();
  });

  it("la cobertura de km/l reporta el porcentaje CON rendimiento y su desglose", () => {
    const es = [entry(), entry(), entry(), entry()];
    const ms = [
      metric(es[0]!.loadId), // con km/l
      metric(es[1]!.loadId), // con km/l
      metric(es[2]!.loadId), // con km/l
      metric(es[3]!.loadId, "montacargas"),
    ];
    const cards = buildKpisFuel(es, ms, BASELINE, []);
    const cob = card(cards, "cobertura-kmpl");
    expect(cob?.value).toBe("75 %");
    expect(cob?.sub).toBe("3 de 4 cargas");
    expect(cob?.title).toContain("Montacargas: 1");
  });

  it("sin métricas no divide por cero", () => {
    const cards = buildKpisFuel([], [], BASELINE, []);
    expect(card(cards, "cobertura-kmpl")?.value).toBe("—");
  });
});
