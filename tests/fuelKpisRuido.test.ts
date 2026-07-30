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
    // Un decimal, igual que la tasa de comprobación: comparten fila.
    expect(cob?.value).toBe("75.0 %");
    expect(cob?.sub).toBe("3 de 4 cargas");
    expect(cob?.title).toContain("Montacargas: 1");
  });

  it("el tooltip del chip explica SOLO sus motivos; los estructurales van a la cobertura", () => {
    const es = [entry(), entry(), entry(), entry()];
    const ms = [
      metric(es[0]!.loadId, "odometro_retroceso"), // accionable
      metric(es[1]!.loadId, "parcial_en_ventana"), // estructural
      metric(es[2]!.loadId, "montacargas"), // estructural
      metric(es[3]!.loadId, "primera_carga"), // estructural
    ];
    const cards = buildKpisFuel(es, ms, BASELINE, []);
    const chip = card(cards, "errores-captura")!;
    const cob = card(cards, "cobertura-kmpl")!;
    // El `sub` de un chip está oculto por CSS: su `title` es la única explicación que llega.
    expect(chip.value).toBe("1");
    expect(chip.title).toBe("Odómetro retrocede: 1");
    for (const estructural of ["Suma a ventana", "Montacargas", "1ª carga"]) {
      expect(chip.title, `el chip no debe mencionar «${estructural}»`).not.toContain(estructural);
      expect(cob.title, `la cobertura sí abarca «${estructural}»`).toContain(estructural);
    }
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
    // Frase legible, con concordancia de número y sin concatenar label + sub entre paréntesis.
    expect(linea?.textContent).toBe(
      "1 registro histórico (antes de 2026-06-01) fuera del control de validación",
    );
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
/** Ciclo CERRADO que sí pasó por una carga = consumo comprobado. */
const CERRADO_CON_CARGA = { cerrado: true, viaCarga: true } as RecorridoInfo;

describe("C3 — tasa de comprobación separando montacargas de vehículos", () => {
  it("numerador y denominador salen de la MISMA población: ciclos cerrados de vehículos", () => {
    const comprobada = entry({ tipo: "solicitud", montoEstimado: 1000 });
    const sinReporte = entry({ tipo: "solicitud", montoEstimado: 1000 });
    const sinReporte2 = entry({ tipo: "solicitud", montoEstimado: 500 });
    const rec = new Map([
      [comprobada.loadId, CERRADO_CON_CARGA],
      [sinReporte.loadId, CERRADO_SIN_CARGA],
      [sinReporte2.loadId, CERRADO_SIN_CARGA],
    ]);
    const cards = buildKpisFuel([comprobada, sinReporte, sinReporte2], [], BASELINE, [], rec);
    const t = card(cards, "tasa-comprobacion")!;
    // 1 de 3 ciclos cerrados terminó en carga. Un decimal: la tasa real de producción es
    // ~42 % y redondearla a entero borra el movimiento mes a mes.
    expect(t.value).toBe("33.3 %");
    // El sub es el COMPLEMENTO exacto del numerador (3 − 1 = 2): valor y sub reconcilian.
    expect(t.sub).toContain("2 sin reporte");
    expect(t.sub).toContain("$1,500");
    expect(card(cards, "sin-carga")).toBeUndefined();
  });

  it("el filtro de tipo no la falsea: sin cargas en la ventana sigue reconciliando", () => {
    // Con "Solo solicitudes" `cargas` queda vacío; la vieja fórmula (cargas/solicitudes)
    // pintaba 0.0 % junto a un sub que decía "1 sin reporte".
    const comprobada = entry({ tipo: "solicitud", montoEstimado: 1000 });
    const sinReporte = entry({ tipo: "solicitud", montoEstimado: 1000 });
    const rec = new Map([
      [comprobada.loadId, CERRADO_CON_CARGA],
      [sinReporte.loadId, CERRADO_SIN_CARGA],
    ]);
    const cards = buildKpisFuel([comprobada, sinReporte], [], BASELINE, [], rec);
    expect(card(cards, "cargas")?.value).toBe("0");
    expect(card(cards, "tasa-comprobacion")?.value).toBe("50.0 %");
  });

  it("no puede pasar de 100 %: una carga sin solicitud no infla el numerador", () => {
    const comprobada = entry({ tipo: "solicitud", montoEstimado: 1000 });
    const huerfana1 = entry({ tipo: "carga" });
    const huerfana2 = entry({ tipo: "carga" });
    const rec = new Map([[comprobada.loadId, CERRADO_CON_CARGA]]);
    const cards = buildKpisFuel([comprobada, huerfana1, huerfana2], [], BASELINE, [], rec);
    expect(card(cards, "tasa-comprobacion")?.value).toBe("100.0 %");
  });

  it("los montacargas NO entran en la tasa: van a contexto con su propio monto", () => {
    const mc = entry({ tipo: "solicitud", esMontacargas: true, montoEstimado: 700 });
    const solOk = entry({ tipo: "solicitud", montoEstimado: 1000 });
    const solMal = entry({ tipo: "solicitud", montoEstimado: 1000 });
    const rec = new Map([
      [mc.loadId, CERRADO_SIN_CARGA],
      [solOk.loadId, CERRADO_CON_CARGA],
      [solMal.loadId, CERRADO_SIN_CARGA],
    ]);
    const cards = buildKpisFuel([mc, solOk, solMal], [], BASELINE, [], rec);
    // 1 de 2 ciclos cerrados DE VEHÍCULOS: el montacargas no está en el denominador.
    expect(card(cards, "tasa-comprobacion")?.value).toBe("50.0 %");
    expect(card(cards, "tasa-comprobacion")?.sub).toContain("1 sin reporte");
    const mcCard = card(cards, "montacargas-sin-carga");
    expect(mcCard?.value).toBe("1");
    expect(mcCard?.grupo).toBe("contexto");
    expect(mcCard?.tone).toBe("n");
  });

  it("un ciclo cerrado DE MONTACARGAS con carga tampoco mueve la tasa de los vehículos", () => {
    const mcSol = entry({ tipo: "solicitud", esMontacargas: true, montoEstimado: 700 });
    const mcCarga = entry({ tipo: "carga", esMontacargas: true });
    const solOk = entry({ tipo: "solicitud", montoEstimado: 1000 });
    const solMal = entry({ tipo: "solicitud", montoEstimado: 1000 });
    const rec = new Map([
      [mcSol.loadId, CERRADO_CON_CARGA],
      [solOk.loadId, CERRADO_CON_CARGA],
      [solMal.loadId, CERRADO_SIN_CARGA],
    ]);
    const conMc = buildKpisFuel([mcSol, mcCarga, solOk, solMal], [], BASELINE, [], rec);
    const sinMc = buildKpisFuel([solOk, solMal], [], BASELINE, [], rec);
    expect(card(conMc, "tasa-comprobacion")?.value).toBe("50.0 %");
    expect(card(conMc, "tasa-comprobacion")?.value).toBe(card(sinMc, "tasa-comprobacion")?.value);
    expect(card(conMc, "tasa-comprobacion")?.sub).toBe(card(sinMc, "tasa-comprobacion")?.sub);
    // Y el montacargas no baja a contexto: su ciclo SÍ terminó en carga.
    expect(card(conMc, "montacargas-sin-carga")).toBeUndefined();
  });

  it("un ciclo en curso (no cerrado) o con carga no cuenta como sin comprobante", () => {
    const enCurso = entry({ tipo: "solicitud", montoEstimado: 900 });
    const conCarga = entry({ tipo: "solicitud", montoEstimado: 900 });
    const rec = new Map([
      [enCurso.loadId, { cerrado: false, viaCarga: false } as RecorridoInfo],
      [conCarga.loadId, CERRADO_CON_CARGA],
    ]);
    const cards = buildKpisFuel([enCurso, conCarga], [], BASELINE, [], rec);
    // El ciclo en curso no está en NINGÚN lado de la fracción: 1 de 1 comprobado.
    expect(card(cards, "tasa-comprobacion")?.value).toBe("100.0 %");
    expect(card(cards, "tasa-comprobacion")?.sub).toContain("0 sin reporte");
    expect(card(cards, "montacargas-sin-carga")).toBeUndefined();
  });

  it("sin ciclos cerrados de vehículos la tasa es «—», no un 0.0 % falso", () => {
    const enCurso = entry({ tipo: "solicitud", montoEstimado: 900 });
    const rec = new Map([[enCurso.loadId, { cerrado: false, viaCarga: false } as RecorridoInfo]]);
    const cards = buildKpisFuel([enCurso], [], BASELINE, [], rec);
    expect(card(cards, "tasa-comprobacion")?.value).toBe("—");
    expect(card(cards, "tasa-comprobacion")?.sub).toContain("0 sin reporte");
  });

  it("sin datos de recorrido la métrica se omite por completo", () => {
    const cards = buildKpisFuel([entry({ tipo: "solicitud" })], [], BASELINE, []);
    expect(card(cards, "tasa-comprobacion")).toBeUndefined();
    expect(card(cards, "montacargas-sin-carga")).toBeUndefined();
  });
});

describe("C5 — la bandeja no invita a trabajo que el candado prohíbe", () => {
  /** Pendientes (sin `review`) posteriores al corte, uno por origen/status. */
  const moreapp = () => entry({ fecha: "2026-07-15" });
  const ops = (opsStatus: string) => entry({ fecha: "2026-07-15", fuente: "ops-gpa", opsStatus });

  it("«Por revisar» cuenta solo lo que Tesorería puede resolver", () => {
    const es = [moreapp(), ops("Pendiente"), ops("Por corregir"), ops("Aprobada")];
    const p = card(buildKpisFuel(es, [], BASELINE, []), "pendientes")!;
    expect(p.label).toBe("Por revisar");
    expect(p.grupo).toBe("estado");
    expect(p.filter).toBe("pendiente");
    // MoreApp (nadie más la validará) + la de Ops ya aprobada (Ops ya decidió) = 2.
    expect(p.value).toBe("2");
    expect(p.tone).toBe("a");
  });

  it("los que esperan a Ops salen a contexto, en tono neutro y sin filtro", () => {
    const es = [moreapp(), ops("Pendiente"), ops("Por corregir")];
    const cards = buildKpisFuel(es, [], BASELINE, []);
    expect(card(cards, "pendientes")?.value).toBe("1");
    const w = card(cards, "esperando-ops")!;
    expect(w.value).toBe("2");
    expect(w.label).toBe("Esperando a Ops");
    expect(w.grupo).toBe("contexto");
    expect(w.tone).toBe("n"); // se vacía sola cuando Ops aprueba: no es alerta
    expect(w.filter).toBeUndefined(); // la tabla no sabe filtrar por origen
    expect(w.sub).toContain("puente");
  });

  it("se auto-oculta cuando no hay nada esperando a Ops", () => {
    const cards = buildKpisFuel([moreapp(), ops("Rechazada")], [], BASELINE, []);
    expect(card(cards, "esperando-ops")).toBeUndefined();
    expect(card(cards, "pendientes")?.value).toBe("2");
  });

  it("los dos buckets suman exactamente los pendientes del universo", () => {
    const es = [moreapp(), moreapp(), ops("Pendiente"), ops("Aprobado"), ops("Por corregir")];
    const cards = buildKpisFuel(es, [], BASELINE, []);
    const n = (k: string) => Number(card(cards, k)?.value ?? 0);
    expect(n("pendientes") + n("esperando-ops")).toBe(5);
  });

  it("la línea de contexto lo dice en una frase legible, sin paréntesis anidados", () => {
    const cont = document.createElement("div");
    const es = [
      ops("Pendiente"),
      entry({ tipo: "solicitud", esMontacargas: true, montoEstimado: 700 }),
    ];
    const rec = new Map([[es[1]!.loadId, CERRADO_SIN_CARGA]]);
    renderKpisFuel(cont, buildKpisFuel(es, [], BASELINE, [], rec));
    const txt = cont.querySelector(".kpi-contexto")!.textContent ?? "";
    expect(txt).toContain("1 registro espera el veredicto de Operaciones-GPA");
    expect(txt).toContain("1 solicitud de montacargas ($700) sin reporte de carga");
    expect(txt).not.toContain("((");
    expect(txt).not.toContain("))");
  });
});
