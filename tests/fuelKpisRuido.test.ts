// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { buildKpisFuel, renderKpisFuel } from "../src/fuel/renderKpis";
import { buildFleetBaseline, type RecorridoInfo } from "../src/fuel/fuelAnalysis";
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
    expect(card(cards, "errores-captura")?.grupo).toBe("estado");
    expect(card(cards, "cobertura-kmpl")?.grupo).toBe("nucleo");
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

describe("C2 — el histórico es contexto, no una alarma", () => {
  it("la tarjeta de histórico viene marcada como contexto y conserva su filtro", () => {
    // Pendiente + fecha < corte (2026-06-01) ⇒ displayVerdict "historico"
    const viejo = entry({ fecha: "2026-03-10" });
    const cards = buildKpisFuel([viejo], [], BASELINE, []);
    const h = cards.find((c) => c.key === "historico");
    expect(h?.value).toBe("1");
    expect(h?.grupo).toBe("contexto");
    expect(h?.filter).toBe("historico");
  });

  it("renderKpisFuel NO pinta las de contexto como tarjeta .kc", () => {
    const viejo = entry({ fecha: "2026-03-10" });
    const cont = document.createElement("div");
    renderKpisFuel(cont, buildKpisFuel([viejo], [], BASELINE, []));
    const etiquetas = [...cont.querySelectorAll(".kc .klbl")].map((n) => n.textContent);
    expect(etiquetas).not.toContain("Histórico");
    const linea = cont.querySelector(".kpi-contexto");
    expect(linea?.textContent).toContain("1");
    expect(linea?.textContent).toContain("istórico");
  });

  it("la línea de contexto es accionable (dispara el filtro con teclado y ratón)", () => {
    const viejo = entry({ fecha: "2026-03-10" });
    const cont = document.createElement("div");
    const vistos: string[] = [];
    renderKpisFuel(cont, buildKpisFuel([viejo], [], BASELINE, []), (f) => vistos.push(f));
    const btn = cont.querySelector<HTMLElement>(".kpi-contexto [role=button]");
    expect(btn).not.toBeNull();
    btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    btn!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(vistos).toEqual(["historico", "historico"]);
  });

  it("sin histórico no se pinta ninguna línea de contexto", () => {
    const cont = document.createElement("div");
    renderKpisFuel(cont, buildKpisFuel([entry()], [], BASELINE, []));
    expect(cont.querySelector(".kpi-contexto")).toBeNull();
  });
});

/** Ciclo CERRADO sin carga de por medio = solicitud sin comprobante de consumo. */
const CERRADO_SIN_CARGA = { cerrado: true, viaCarga: false } as RecorridoInfo;

describe("C3 — tasa de comprobación separando montacargas de vehículos", () => {
  it("la tasa se calcula solo con vehículos y reporta el dinero sin comprobante", () => {
    const solVeh = entry({ tipo: "solicitud", montoEstimado: 1000 });
    const solVeh2 = entry({ tipo: "solicitud", montoEstimado: 500 });
    const cargaVeh = entry({ tipo: "carga" });
    const rec = new Map([
      [solVeh.loadId, CERRADO_SIN_CARGA],
      [solVeh2.loadId, CERRADO_SIN_CARGA],
    ]);
    const cards = buildKpisFuel([solVeh, solVeh2, cargaVeh], [], BASELINE, [], rec);
    const t = card(cards, "tasa-comprobacion");
    // 1 carga de vehículo / 2 solicitudes de vehículo = 50 %. Un decimal: la tasa real de
    // producción es 42.5 % y redondearla a entero borra el movimiento mes a mes.
    expect(t?.value).toBe("50.0 %");
    expect(t?.sub).toContain("2 sin reporte");
    expect(t?.sub).toContain("$1,500");
    expect(card(cards, "sin-carga")).toBeUndefined();
  });

  it("los montacargas NO entran en la tasa: van a contexto con su propio monto", () => {
    const mc = entry({ tipo: "solicitud", esMontacargas: true, montoEstimado: 700 });
    const sol = entry({ tipo: "solicitud", montoEstimado: 1000 });
    const carga = entry({ tipo: "carga" });
    const rec = new Map([
      [mc.loadId, CERRADO_SIN_CARGA],
      [sol.loadId, CERRADO_SIN_CARGA],
    ]);
    const cards = buildKpisFuel([mc, sol, carga], [], BASELINE, [], rec);
    // La tasa ignora al montacargas: 1 carga / 1 solicitud de vehículo = 100 %
    expect(card(cards, "tasa-comprobacion")?.value).toBe("100.0 %");
    expect(card(cards, "tasa-comprobacion")?.sub).toContain("1 sin reporte");
    const mcCard = card(cards, "montacargas-sin-carga");
    expect(mcCard?.value).toBe("1");
    expect(mcCard?.grupo).toBe("contexto");
    expect(mcCard?.tone).toBe("n");
  });

  it("un ciclo en curso (no cerrado) o con carga no cuenta como sin comprobante", () => {
    const enCurso = entry({ tipo: "solicitud", montoEstimado: 900 });
    const conCarga = entry({ tipo: "solicitud", montoEstimado: 900 });
    const rec = new Map([
      [enCurso.loadId, { cerrado: false, viaCarga: false } as RecorridoInfo],
      [conCarga.loadId, { cerrado: true, viaCarga: true } as RecorridoInfo],
    ]);
    const cards = buildKpisFuel([enCurso, conCarga], [], BASELINE, [], rec);
    expect(card(cards, "tasa-comprobacion")?.sub).toContain("0 sin reporte");
    expect(card(cards, "montacargas-sin-carga")).toBeUndefined();
  });

  it("sin datos de recorrido la métrica se omite por completo", () => {
    const cards = buildKpisFuel([entry({ tipo: "solicitud" })], [], BASELINE, []);
    expect(card(cards, "tasa-comprobacion")).toBeUndefined();
    expect(card(cards, "montacargas-sin-carga")).toBeUndefined();
  });
});
