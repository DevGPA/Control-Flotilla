/**
 * KPIs del módulo de combustible. `buildKpisFuel` es PURA (testeable); `renderKpisFuel`
 * pinta tarjetas `.kc` (mismo look que Semanales/Inspecciones) con la API DOM segura.
 */
import type { FuelEntry, FuelMetrics, FleetBaseline, FuelFinding } from "./types";
import { verdictOf } from "./renderTableCombustible";
import { montoEfectivo } from "./fuelAggregates";
import { mean, clampOutliers } from "../analyzer/statistics";

export type FuelKpiCard = {
  key: string;
  label: string;
  value: string;
  sub?: string;
  tone: "n" | "r" | "a" | "g"; // neutro / rojo / ámbar / verde
  filter?: "discrepancia" | "pendiente" | "anomalia"; // clic → filtro
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
): FuelKpiCard[] {
  const cargas = entries.filter((e) => e.tipo === "carga");
  const solicitudes = entries.filter((e) => e.tipo === "solicitud");
  const litros = cargas.reduce((a, e) => a + (e.litros ?? 0), 0);
  const gasto = cargas.reduce((a, e) => a + montoEfectivo(e), 0);
  const kmplVals = metrics.map((m) => m.kmPorLitro).filter((x): x is number => x != null && x > 0);
  // Media ROBUSTA (recorte IQR): cargas con huecos grandes (datos esparcidos) producen
  // km/l atípicos que disparan la media cruda; el recorte la mantiene realista.
  const kmplProm = kmplVals.length ? mean(clampOutliers(kmplVals)) : NaN;
  const discrepancias = entries.filter((e) => verdictOf(e) === "discrepancia").length;
  const pendientes = entries.filter((e) => verdictOf(e) === "pendiente").length;
  const unidadesAfectadas = new Set(anomalies.map((a) => a.eco)).size;

  return [
    {
      key: "cargas",
      label: "Cargas",
      value: NUM.format(cargas.length),
      sub: `${NUM.format(solicitudes.length)} solicitudes`,
      tone: "n",
    },
    {
      key: "litros",
      label: "Litros cargados",
      value: `${NUM.format(Math.round(litros))} L`,
      tone: "n",
    },
    {
      key: "kmpl",
      label: "Rendimiento flota",
      value: Number.isFinite(kmplProm) ? `${kmplProm.toFixed(2)} km/l` : "—",
      sub: Number.isFinite(baseline.flotaMean)
        ? `histórico ${baseline.flotaMean.toFixed(2)}`
        : undefined,
      tone: "g",
    },
    { key: "gasto", label: "Gasto", value: PESO.format(gasto), tone: "n" },
    {
      key: "discrepancias",
      label: "Discrepancias",
      value: NUM.format(discrepancias),
      tone: discrepancias ? "r" : "g",
      filter: "discrepancia",
    },
    {
      key: "pendientes",
      label: "Pendientes de revisar",
      value: NUM.format(pendientes),
      tone: pendientes ? "a" : "g",
      filter: "pendiente",
    },
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
    if (c.filter && onFilter) {
      kc.style.cursor = "pointer";
      kc.tabIndex = 0;
      const h = () => onFilter(c.filter!);
      kc.addEventListener("click", h);
      kc.addEventListener("keydown", (ev) => {
        if ((ev as KeyboardEvent).key === "Enter") h();
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
