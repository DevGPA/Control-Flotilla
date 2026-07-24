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
  // dinero cargado a la tarjeta sin comprobante de consumo. La última solicitud de cada unidad
  // (ciclo en curso) no cuenta. Si no hay datos de recorrido, la métrica se omite.
  const sinCarga = recorridosByLoad
    ? solicitudes.filter((e) => {
        const r = recorridosByLoad.get(e.loadId);
        return r != null && r.cerrado && !r.viaCarga;
      }).length
    : null;
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
  // "Pendientes" = lo accionable: el backfill previo al corte cae a "historico", no a pendiente.
  const pendientes = entries.filter((e) => displayVerdictOf(e) === "pendiente").length;
  const historicos = entries.filter((e) => displayVerdictOf(e) === "historico").length;
  const unidadesAfectadas = new Set(anomalies.map((a) => a.eco)).size;

  // Cargas sin km/l (las métricas ya son solo de tipo=carga): cuántas y por qué. Separa las
  // "por revisar" (captura mala, accionables) de los huecos estructurales correctos; el
  // desglose completo por motivo va en el tooltip de la tarjeta.
  const sinKmpl = metrics.filter((m) => m.kmPorLitro == null);
  // Cargas parciales que SUMAN a una ventana abierta (estructural del motor de ventanas):
  // el desglose evita que el usuario las lea como "datos por revisar".
  const enVentana = sinKmpl.filter((m) => m.motivoSinKmpl === "parcial_en_ventana").length;
  const porRevisar = sinKmpl.filter(
    (m) => m.motivoSinKmpl && MOTIVO_SIN_KMPL_ACCIONABLE[m.motivoSinKmpl],
  ).length;
  const porMotivo = new Map<MotivoSinKmpl, number>();
  for (const m of sinKmpl)
    if (m.motivoSinKmpl) porMotivo.set(m.motivoSinKmpl, (porMotivo.get(m.motivoSinKmpl) ?? 0) + 1);
  const desgloseSinRend = [...porMotivo.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([mo, n]) => `${MOTIVO_SIN_KMPL_CORTO[mo]}: ${n}`)
    .join(" · ");

  return [
    {
      key: "cargas",
      label: "Cargas",
      value: NUM.format(cargas.length),
      sub: `${NUM.format(solicitudes.length)} solicitudes`,
      tone: "n",
      delta: prev ? deltaKpi(cargas.length, prev.cargas, "neutral") : undefined,
    },
    {
      key: "litros",
      label: "Litros cargados",
      value: `${NUM.format(Math.round(litros))} L`,
      tone: "n",
      delta: prev ? deltaKpi(litros, prev.litros, "neutral") : undefined,
    },
    {
      key: "kmpl",
      label: "Rendimiento flota",
      value: Number.isFinite(kmplFlota) ? `${kmplFlota.toFixed(2)} km/l` : "—",
      sub: "ponderado por litros",
      tone: "g",
    },
    {
      key: "sin-rendimiento",
      label: "Sin rendimiento",
      value: NUM.format(sinKmpl.length),
      sub:
        porRevisar > 0
          ? `${porRevisar} por revisar · ${enVentana} suman a ventana · ${sinKmpl.length - porRevisar - enVentana} normales`
          : enVentana > 0
            ? `${enVentana} suman a ventana · resto explicado`
            : "todas explicadas",
      tone: porRevisar > 0 ? "a" : "n",
      title: desgloseSinRend || undefined,
    },
    {
      key: "gasto",
      label: "Gasto",
      value: PESO.format(gasto),
      tone: "n",
      delta: prev ? deltaKpi(gasto, prev.gasto, "costo") : undefined,
    },
    {
      key: "discrepancias",
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
      label: "Pendientes de revisar",
      value: NUM.format(pendientes),
      tone: pendientes ? "a" : "g",
      filter: "pendiente",
    },
    // Histórico (backfill migrado, previo al corte): se muestra para no esconder los datos,
    // en tono NEUTRO para que no pese como pendiente. Solo aparece si hay alguno.
    ...(historicos > 0
      ? [
          {
            key: "historico",
            label: "Histórico",
            value: NUM.format(historicos),
            sub: `sin validar · previo a ${FUEL_VALIDACION_DESDE}`,
            tone: "n",
            filter: "historico",
          } as FuelKpiCard,
        ]
      : []),
    ...(sinCarga !== null
      ? [
          {
            key: "sin-carga",
            label: "Solicitudes sin carga",
            value: NUM.format(sinCarga),
            sub: "ciclo cerrado, sin consumo",
            tone: sinCarga ? "a" : "g",
          } as FuelKpiCard,
        ]
      : []),
    {
      key: "anomalias",
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
  // .kc usa flex:1 → DEBE ir dentro de un contenedor flex .kpi-row (igual que Semanales),
  // si no, cada tarjeta se apila a ancho completo y empuja la tabla fuera del viewport.
  const row = document.createElement("div");
  row.className = "kpi-row";
  container.appendChild(row);
  for (const c of cards) {
    const kc = document.createElement("div");
    kc.className = "kc";
    if (c.title) kc.title = c.title;
    if (c.filter && onFilter) {
      kc.style.cursor = "pointer";
      kc.tabIndex = 0;
      // A11y: es un control interactivo — role + Enter/Espacio (WCAG 4.1.2)
      kc.setAttribute("role", "button");
      kc.setAttribute("aria-label", `Filtrar por ${c.label}`);
      const h = () => onFilter(c.filter!);
      kc.addEventListener("click", h);
      kc.addEventListener("keydown", (ev) => {
        const k = (ev as KeyboardEvent).key;
        if (k === "Enter" || k === " ") {
          ev.preventDefault();
          h();
        }
      });
    }
    const ktop = document.createElement("div");
    ktop.className = "ktop";
    ktop.style.background = TONE_COLOR[c.tone];
    kc.appendChild(ktop);

    const klbl = document.createElement("div");
    klbl.className = "klbl";
    klbl.textContent = c.label;
    kc.appendChild(klbl);

    const kval = document.createElement("div");
    kval.className = "kval";
    kval.style.color = TONE_COLOR[c.tone];
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
    row.appendChild(kc);
  }
}
