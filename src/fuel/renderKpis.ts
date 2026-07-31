/**
 * KPIs del módulo de combustible. `buildKpisFuel` es PURA (testeable); `renderKpisFuel`
 * pinta tarjetas `.kc` (mismo look que Semanales/Inspecciones) con la API DOM segura.
 */
import type { FuelEntry, FuelMetrics, FleetBaseline, FuelFinding, MotivoSinKmpl } from "./types";
import type { RecorridoInfo } from "./fuelAnalysis";
import { MOTIVO_SIN_KMPL_CORTO, MOTIVO_SIN_KMPL_ACCIONABLE } from "./fuelAnalysis";
import { verdictOf, displayVerdictOf, FUEL_VALIDACION_DESDE } from "./renderTableCombustible";
import { montoEfectivo } from "./fuelAggregates";
import { mean, clampOutliers } from "../analyzer/statistics";
import type { DeltaKpi } from "./kpiDeltas";
import { deltaKpi } from "./kpiDeltas";

export type FuelKpiCard = {
  key: string;
  label: string;
  value: string;
  sub?: string;
  tone: "n" | "r" | "a" | "g"; // neutro / rojo / ámbar / verde
  /**
   * Jerarquía: núcleo (métricas grandes) vs estado (chips de alerta) vs contexto (archivo y
   * huecos estructurales — spec 2026-07-30 C2/C3: datos que NO se esconden pero que no deben
   * pesar como trabajo pendiente; van en una línea al pie, no como tarjeta).
   */
  grupo: "nucleo" | "estado" | "contexto";
  /**
   * Frase completa —con el valor ya dentro— para la línea de contexto. Solo la usan las
   * tarjetas `grupo: "contexto"`: concatenar `label` + `sub` produce copy agramatical con
   * paréntesis anidados. Sin ella se cae a `value + label` en minúsculas.
   */
  frase?: string;
  filter?: "discrepancia" | "pendiente" | "anomalia" | "historico" | "rechazada"; // clic → filtro
  title?: string; // tooltip (p.ej. desglose por motivo)
  delta?: DeltaKpi | null; // vs periodo anterior de la misma duración (sin `prev` → undefined)
};

const PESO = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});
const NUM = new Intl.NumberFormat("es-MX");

/** Frase de contexto: el número al frente y con la concordancia de número correcta. */
const frasePlural = (n: number, singular: string, plural: string): string =>
  `${NUM.format(n)} ${n === 1 ? singular : plural}`;

/** Calcula los KPIs a partir de las entradas (ya scopeadas/filtradas por período). */
export function buildKpisFuel(
  entries: readonly FuelEntry[],
  metrics: readonly FuelMetrics[],
  baseline: FleetBaseline,
  anomalies: readonly FuelFinding[],
  recorridosByLoad?: ReadonlyMap<string, RecorridoInfo>,
  prev?: { litros: number; gasto: number; cargas: number },
): FuelKpiCard[] {
  const cargas = entries.filter((e) => e.tipo === "carga");
  const solicitudes = entries.filter((e) => e.tipo === "solicitud");
  // Solicitudes con ciclo CERRADO (hay una solicitud posterior) y SIN carga de por medio:
  // dinero autorizado sin comprobante de consumo. La última solicitud de cada unidad
  // (ciclo en curso) no cuenta. Si no hay datos de recorrido, la métrica se omite.
  //
  // C3 (spec 2026-07-30 §2.5): montacargas y vehículos NO se mezclan. Un montacargas Gas LP
  // no emite reporte de carga con odómetro (su km es horómetro), así que contarlo como
  // incumplimiento es ruido: 1,020 de los 2,932 en producción. `esMontacargas` se deriva de
  // `producto`, el campo fiable — los montacargas traen combustible "Gasolina".
  const sinComprobante = (e: FuelEntry): boolean => {
    const r = recorridosByLoad?.get(e.loadId);
    return r != null && r.cerrado && !r.viaCarga;
  };
  // La tasa de comprobación se mide sobre UNA SOLA población: los ciclos CERRADOS de
  // vehículos. Numerador (los que terminaron en carga) y denominador salen del mismo
  // conjunto, así que la tasa queda acotada a 0-100 %, reconcilia exactamente con su sub
  // (los "sin reporte" son el complemento) y es estable ante el filtro de tipo de la vista,
  // porque `recorridosByLoad` se calcula sobre el dataset completo. Dividir cargas entre
  // solicitudes mezclaba poblaciones: daba 0 % con el filtro "Solo solicitudes" (numerador
  // vacío) y podía pasar de 100 % en ventanas con cargas de MoreApp sin solicitud previa.
  const cicloCerrado = (e: FuelEntry): boolean => recorridosByLoad?.get(e.loadId)?.cerrado === true;
  const conComprobante = (e: FuelEntry): boolean =>
    recorridosByLoad?.get(e.loadId)?.viaCarga === true;
  const solVehiculos = solicitudes.filter((e) => !e.esMontacargas);
  const cerradosVeh = recorridosByLoad ? solVehiculos.filter(cicloCerrado) : null;
  const comprobadosVeh = cerradosVeh ? cerradosVeh.filter(conComprobante).length : 0;
  const sinCargaVeh = cerradosVeh ? cerradosVeh.filter((e) => !conComprobante(e)) : null;
  const sinCargaMc = recorridosByLoad
    ? solicitudes.filter((e) => e.esMontacargas).filter(sinComprobante)
    : null;
  // El dinero de una solicitud vive en montoEstimado (montoTotal es de la carga).
  const montoAutorizado = (arr: readonly FuelEntry[]): number =>
    arr.reduce((a, e) => a + (e.montoEstimado ?? 0), 0);
  const litros = cargas.reduce((a, e) => a + (e.litros ?? 0), 0);
  const gasto = cargas.reduce((a, e) => a + montoEfectivo(e), 0);
  const kmplVals = metrics.map((m) => m.kmPorLitro).filter((x): x is number => x != null && x > 0);
  // Media ROBUSTA por evento (recorte IQR) — fallback si no hay ponderado.
  const kmplProm = kmplVals.length ? mean(clampOutliers(kmplVals)) : NaN;
  // Rendimiento de flota PONDERADO POR VOLUMEN (Σkm/Σlitros): la métrica fiel (sin sesgo de
  // tramos cortos, robusta a tanque no lleno). Cae a la media de eventos si no está disponible.
  const kmplFlota = Number.isFinite(baseline.flotaKmplVol ?? NaN)
    ? (baseline.flotaKmplVol as number)
    : kmplProm;
  // Las discrepancias siguen contando aunque sean del histórico (hallazgo real, no se oculta).
  const discrepancias = entries.filter((e) => verdictOf(e) === "discrepancia").length;
  // Rechazadas en origen (Ops) SIN triage: siguen sumando gasto hasta que tesorería decida
  // (anular o validar como gasto real). Las ya anuladas no llegan aquí (scoped() las excluye).
  const rechazadas = entries.filter((e) => verdictOf(e) === "rechazada").length;
  // C5 (spec 2026-07-30 §2.5-2): la cola de "pendiente" está partida por ORIGEN y una mitad
  // no es de Tesorería. Los dos buckets se leen del veredicto DERIVADO
  // (`displayVerdictOf`), que es también el que filtra la tabla y alimenta el badge de la
  // pestaña: así el chip, su clic y el badge no pueden discrepar. El criterio de origen vive
  // en un solo sitio (`puedeValidarManual`, dentro de `displayVerdictOf`).
  const pendientesTesoreria = entries.filter((e) => displayVerdictOf(e) === "pendiente").length;
  const pendientesOps = entries.filter((e) => displayVerdictOf(e) === "esperando").length;
  const historicos = entries.filter((e) => displayVerdictOf(e) === "historico").length;
  const unidadesAfectadas = new Set(anomalies.map((a) => a.eco)).size;

  // Cargas sin km/l (las métricas ya son solo de tipo=carga): cuántas y por qué. Separa las
  // "por revisar" (captura mala, accionables) de los huecos estructurales correctos; el
  // desglose completo por motivo va en el tooltip de la tarjeta.
  const sinKmpl = metrics.filter((m) => m.kmPorLitro == null);
  const porRevisar = sinKmpl.filter(
    (m) => m.motivoSinKmpl && MOTIVO_SIN_KMPL_ACCIONABLE[m.motivoSinKmpl],
  ).length;
  // Cargas que SÍ tienen km/l — numerador de la cobertura.
  const conKmpl = metrics.length - sinKmpl.length;
  const porMotivo = new Map<MotivoSinKmpl, number>();
  for (const m of sinKmpl)
    if (m.motivoSinKmpl) porMotivo.set(m.motivoSinKmpl, (porMotivo.get(m.motivoSinKmpl) ?? 0) + 1);
  const desglose = (soloAccionables: boolean): string =>
    [...porMotivo.entries()]
      .filter(([mo]) => !soloAccionables || MOTIVO_SIN_KMPL_ACCIONABLE[mo])
      .sort((a, b) => b[1] - a[1])
      .map(([mo, n]) => `${MOTIVO_SIN_KMPL_CORTO[mo]}: ${n}`)
      .join(" · ");
  // Dos desgloses, uno por tarjeta: el `sub` de un chip está oculto por CSS
  // (`#fuel-kpis .kpi-chips .ksub { display: none }`), así que su `title` es la ÚNICA
  // explicación que recibe el usuario. Poner ahí el desglose completo hacía que un chip
  // que dice 32 mostrara una lista que suma 635. El completo pertenece a "Cobertura de
  // km/l", que sí abarca todos los motivos.
  const desgloseSinRend = desglose(false);
  const desgloseAccionable = desglose(true);

  return [
    {
      key: "cargas",
      grupo: "nucleo",
      label: "Cargas",
      value: NUM.format(cargas.length),
      sub: `${NUM.format(solicitudes.length)} solicitudes`,
      tone: "n",
      delta: prev ? deltaKpi(cargas.length, prev.cargas, "neutral") : undefined,
    },
    {
      key: "litros",
      grupo: "nucleo",
      label: "Litros cargados",
      value: `${NUM.format(Math.round(litros))} L`,
      tone: "n",
      delta: prev ? deltaKpi(litros, prev.litros, "neutral") : undefined,
    },
    {
      key: "kmpl",
      grupo: "nucleo",
      label: "Rendimiento flota",
      value: Number.isFinite(kmplFlota) ? `${kmplFlota.toFixed(2)} km/l` : "—",
      sub: "ponderado por litros",
      tone: "g",
    },
    // C1 (spec 2026-07-30 §2.5-1): el chip cuenta SOLO lo accionable. Los huecos
    // estructurales (ventana, montacargas, 1ª carga, llenado partido) son correctos y no
    // son trabajo: su sitio es el desglose de "Cobertura de km/l". Se auto-oculta en 0
    // porque es deuda FINITA de la era MoreApp, no un KPI permanente.
    //
    // NO se llama "Errores de captura": ese nombre ya lo usa el filtro `captura` del HTML
    // (reglas `captura-*` de matchesFlag), que es una población DISTINTA y más chica — el
    // chip diría 32 y la lista mostraría 2. Y el copy no puede prometer odómetro: la
    // población incluye `sin_litros` y `odometro_no_fiable`, que no se arreglan con
    // `kmDetectado` (no hay corrector de litros en FC). Lo que las une es el efecto.
    ...(porRevisar > 0
      ? [
          {
            key: "errores-captura",
            grupo: "estado" as const,
            label: "Capturas por revisar",
            value: NUM.format(porRevisar),
            sub: "bloquean el cálculo de km/l",
            tone: "a" as const,
            title: desgloseAccionable || undefined,
          } as FuelKpiCard,
        ]
      : []),
    {
      key: "cobertura-kmpl",
      // Salud, no alerta: una tasa va en el núcleo con el valor en tinta.
      grupo: "nucleo",
      label: "Cobertura de km/l",
      // Un decimal, igual que la tasa de comprobación: comparten fila y el mismo argumento
      // (ver el movimiento mes a mes) — dos precisiones distintas se leen como un error.
      value: metrics.length ? `${((conKmpl / metrics.length) * 100).toFixed(1)} %` : "—",
      sub: `${NUM.format(conKmpl)} de ${NUM.format(metrics.length)} cargas`,
      tone: "n",
      // El desglose completo (cuántas por cada motivo) explica el hueco sin gritar.
      title: desgloseSinRend || undefined,
    },
    {
      key: "gasto",
      grupo: "nucleo",
      label: "Gasto",
      value: PESO.format(gasto),
      tone: "n",
      delta: prev ? deltaKpi(gasto, prev.gasto, "costo") : undefined,
    },
    {
      key: "discrepancias",
      grupo: "estado",
      label: "Discrepancias",
      value: NUM.format(discrepancias),
      tone: discrepancias ? "r" : "g",
      filter: "discrepancia",
    },
    // Radar de triage: solo aparece si hay rechazadas pendientes de decisión.
    ...(rechazadas > 0
      ? [
          {
            key: "rechazadas",
            grupo: "estado" as const,
            label: "Rechazadas sin triage",
            value: NUM.format(rechazadas),
            sub: "decidir: no contar o gasto real",
            tone: "r" as const,
            filter: "rechazada" as const,
          },
        ]
      : []),
    {
      key: "pendientes",
      grupo: "estado",
      label: "Por revisar",
      value: NUM.format(pendientesTesoreria),
      tone: pendientesTesoreria ? "a" : "g",
      filter: "pendiente",
    },
    // Los pendientes que esperan a Ops NO son trabajo de Tesorería: bajan a la línea de
    // contexto y en tono neutro, porque el chip se vacía solo cuando Ops aprueba (se
    // verificaron 3 desapariciones entre dos corridas del mismo día). Sin `filter`: la
    // tabla filtra por "pendiente" sin distinguir origen, así que un clic mentiría.
    ...(pendientesOps > 0
      ? [
          {
            key: "esperando-ops",
            grupo: "contexto" as const,
            label: "Esperando a Ops",
            value: NUM.format(pendientesOps),
            sub: "el veredicto llega por el puente de Operaciones-GPA",
            tone: "n" as const,
            frase: frasePlural(
              pendientesOps,
              "registro espera el veredicto de Operaciones-GPA",
              "registros esperan el veredicto de Operaciones-GPA",
            ),
          } as FuelKpiCard,
        ]
      : []),
    // Histórico (backfill migrado, previo al corte): se muestra para no esconder los datos,
    // en tono NEUTRO para que no pese como pendiente. Solo aparece si hay alguno.
    ...(historicos > 0
      ? [
          {
            key: "historico",
            // C2: 70 % del universo y nadie lo validará retroactivamente → contexto, no alerta.
            grupo: "contexto" as const,
            label: "Histórico",
            value: NUM.format(historicos),
            sub: `sin validar · previo a ${FUEL_VALIDACION_DESDE}`,
            tone: "n",
            filter: "historico",
            frase: `${frasePlural(historicos, "registro histórico", "registros históricos")} (antes de ${FUEL_VALIDACION_DESDE}) fuera del control de validación`,
          } as FuelKpiCard,
        ]
      : []),
    ...(sinCargaVeh !== null
      ? [
          {
            key: "tasa-comprobacion",
            // Salud: una tasa pertenece al núcleo, no a los chips de alerta.
            grupo: "nucleo" as const,
            label: "Tasa de comprobación",
            // Sin ciclos cerrados de vehículos no hay tasa que medir: "—", no un 0.0 % falso.
            value:
              cerradosVeh && cerradosVeh.length
                ? `${((comprobadosVeh / cerradosVeh.length) * 100).toFixed(1)} %`
                : "—",
            sub: `${NUM.format(sinCargaVeh.length)} sin reporte · ${PESO.format(montoAutorizado(sinCargaVeh))}`,
            tone: "n",
          } as FuelKpiCard,
        ]
      : []),
    ...(sinCargaMc && sinCargaMc.length > 0
      ? [
          {
            key: "montacargas-sin-carga",
            // Estructural: no es incumplimiento, es que un montacargas no lleva odómetro.
            grupo: "contexto" as const,
            label: "Montacargas sin reporte",
            value: NUM.format(sinCargaMc.length),
            sub: `${PESO.format(montoAutorizado(sinCargaMc))} · estructural (horómetro)`,
            tone: "n",
            frase: `${frasePlural(sinCargaMc.length, "solicitud de montacargas", "solicitudes de montacargas")} (${PESO.format(montoAutorizado(sinCargaMc))}) sin reporte de carga: su medidor es horómetro, no odómetro`,
          } as FuelKpiCard,
        ]
      : []),
    {
      key: "anomalias",
      grupo: "estado",
      label: "Anomalías",
      value: NUM.format(anomalies.length),
      sub: unidadesAfectadas ? `${unidadesAfectadas} unidades` : undefined,
      tone: anomalies.length ? "a" : "g",
      filter: "anomalia",
    },
  ];
}

const TONE_COLOR: Record<FuelKpiCard["tone"], string> = {
  n: "var(--ac)",
  r: "var(--R)",
  a: "var(--A)",
  g: "var(--G)",
};

export function renderKpisFuel(
  container: HTMLElement,
  cards: FuelKpiCard[],
  onFilter?: (f: NonNullable<FuelKpiCard["filter"]>) => void,
): void {
  container.replaceChildren();
  // Jerarquía (fix Producto Vivo #2/#4): las métricas NÚCLEO (cargas, litros, rendimiento,
  // gasto) van en tarjetas grandes con el valor en tinta; las de ESTADO/alerta van como
  // chips compactos que solo "encienden" color cuando hay algo que atender. El color deja
  // de ser decoración uniforme y pasa a señalar severidad. Mismo patrón que #sw-kpis.
  const rowNucleo = document.createElement("div");
  rowNucleo.className = "kpi-row kpi-row-nucleo";
  const rowEstado = document.createElement("div");
  rowEstado.className = "kpi-row kpi-chips";
  container.append(rowNucleo, rowEstado);

  /**
   * Cablea un elemento como control de filtro: role + tabIndex + aria-label + Enter/Espacio
   * (WCAG 4.1.2). Lo usan la tarjeta y la línea de contexto — un solo sitio para que los dos
   * contratos de a11y no se desincronicen.
   */
  const wireFiltro = (el: HTMLElement, c: FuelKpiCard): void => {
    if (!c.filter || !onFilter) return;
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", `Filtrar por ${c.label}`);
    const h = () => onFilter(c.filter!);
    el.addEventListener("click", h);
    el.addEventListener("keydown", (ev) => {
      const k = (ev as KeyboardEvent).key;
      if (k === "Enter" || k === " ") {
        ev.preventDefault();
        h();
      }
    });
  };

  const make = (c: FuelKpiCard): HTMLElement => {
    const esChip = c.grupo === "estado";
    const kc = document.createElement("div");
    kc.className = "kc";
    // El chip oculta su .ksub (CSS): conserva ese contexto en el tooltip al pasar el cursor.
    if (c.title) kc.title = c.title;
    else if (esChip && c.sub) kc.title = c.sub;
    if (c.filter && onFilter) {
      kc.style.cursor = "pointer";
      wireFiltro(kc, c);
    }
    const ktop = document.createElement("div");
    ktop.className = "ktop";
    // Núcleo: franja de acento neutro de marca. Estado: color por severidad.
    ktop.style.background = esChip ? TONE_COLOR[c.tone] : "var(--ac)";
    kc.appendChild(ktop);

    const klbl = document.createElement("div");
    klbl.className = "klbl";
    klbl.textContent = c.label;
    kc.appendChild(klbl);

    const kval = document.createElement("div");
    kval.className = "kval";
    // El valor del núcleo va en tinta (sobrio); el color se reserva para los chips de estado.
    if (esChip) kval.style.color = TONE_COLOR[c.tone];
    kval.textContent = c.value;
    if (c.delta) {
      const kd = document.createElement("span");
      kd.className = `kdelta ${c.delta.tone}`;
      const flecha = c.delta.direccion === "up" ? "▲" : c.delta.direccion === "down" ? "▼" : "•";
      kd.textContent = ` ${flecha} ${Math.abs(c.delta.pct).toFixed(1)}%`;
      kd.title = "vs periodo anterior de la misma duración";
      kval.appendChild(kd);
    }
    kc.appendChild(kval);

    if (c.sub) {
      const ksub = document.createElement("div");
      ksub.className = "ksub";
      ksub.textContent = c.sub;
      kc.appendChild(ksub);
    }
    return kc;
  };

  // C2/C3: lo que es archivo o estructural no compite con el trabajo pendiente. No se
  // esconde: baja a una línea al pie, conservando su clic al filtro.
  const contexto = cards.filter((c) => c.grupo === "contexto");
  for (const c of cards) {
    if (c.grupo === "contexto") continue;
    (c.grupo === "nucleo" ? rowNucleo : rowEstado).appendChild(make(c));
  }
  if (contexto.length) {
    const linea = document.createElement("div");
    linea.className = "kpi-contexto";
    contexto.forEach((c, i) => {
      if (i > 0) linea.appendChild(document.createTextNode(" · "));
      // `frase` es copy escrito para leerse; el fallback solo cubre una tarjeta de contexto
      // que se añada sin frase (concatenar label + sub daba paréntesis anidados).
      const txt = c.frase ?? `${c.value} ${c.label.toLowerCase()}`;
      if (c.filter && onFilter) {
        // Accionable: mismo contrato de a11y que las tarjetas (role + Enter/Espacio).
        const b = document.createElement("span");
        b.className = "kpi-contexto-link";
        b.textContent = txt;
        wireFiltro(b, c);
        linea.appendChild(b);
      } else {
        linea.appendChild(document.createTextNode(txt));
      }
    });
    container.appendChild(linea);
  }
}
