/**
 * Glue del módulo de combustible: monta las funciones globales que el HTML y
 * cloudHydrate invocan (window.renderCombustible / initRangoFuel / updateFuelNavBadge
 * / openFuelDetail), mantiene el estado de UI (filtros, orden, rango) y orquesta
 * el cálculo (métricas/baseline/anomalías) + render (KPIs + tabla).
 *
 * Importado una vez desde src/main.ts. Toda la lógica pesada vive en módulos puros
 * (fuelAnalysis, renderTableCombustible, renderKpis); aquí solo cableado de DOM.
 */
import type { FuelEntry, FuelMetrics } from "./types";
import { computeFuelMetrics, buildFleetBaseline, detectFuelAnomalies } from "./fuelAnalysis";
import {
  renderTableCombustible,
  populateFuelSelects,
  verdictOf,
  type FuelTableFilter,
  type FuelSortCol,
  type FuelTipoFilter,
  type FuelVerdictFilter,
} from "./renderTableCombustible";
import { buildKpisFuel, renderKpisFuel } from "./renderKpis";

declare global {
  interface Window {
    fuelEntries?: FuelEntry[];
    renderCombustible?: () => void;
    initRangoFuel?: () => void;
    updateFuelNavBadge?: () => void;
    openFuelDetail?: (loadId: string, order?: string[]) => void;
    scopeBySucursal?: <T extends { sucursal?: string }>(rows: T[]) => T[];
    lockedSucursal?: () => string | null;
    notify?: (msg: string, kind?: string, ms?: number) => void;
  }
}

// ── Estado de UI (módulo) ──────────────────────────────
const filter: FuelTableFilter = {
  tipo: "all",
  verdict: "all",
  sucursal: "",
  responsable: "",
  search: "",
  desde: undefined,
  hasta: undefined,
};
let sortCol: FuelSortCol = "_idx";
let sortDir: 1 | -1 = -1;
let searchDebounce: ReturnType<typeof setTimeout> | null = null;

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/** Aplica el lock por sucursal (no-op para admin/"Todas"). */
function scoped(): FuelEntry[] {
  const all = window.fuelEntries ?? [];
  return typeof window.scopeBySucursal === "function" ? window.scopeBySucursal(all) : all;
}

function inRange(e: FuelEntry): boolean {
  if (filter.desde && e.fecha < filter.desde) return false;
  if (filter.hasta && e.fecha > filter.hasta) return false;
  return true;
}

function renderCombustible(): void {
  const tbody = $("fuel-tbody");
  if (!tbody) return; // vista no montada aún
  const all = scoped();

  // Métricas/baseline/anomalías sobre TODO el histórico scopeado (el km/l de una
  // carga usa la carga anterior aunque caiga fuera del rango visible).
  const allMetrics = computeFuelMetrics(all);
  const metricsByLoad = new Map<string, FuelMetrics>(allMetrics.map((m) => [m.loadId, m]));
  const baseline = buildFleetBaseline(allMetrics, all);
  const anomalies = detectFuelAnomalies(allMetrics, baseline);

  // Subconjunto del rango para KPIs (la tabla aplica el rango vía filtro).
  const ranged = all.filter(inRange);
  const rangedIds = new Set(ranged.map((e) => e.loadId));
  const rangedMetrics = allMetrics.filter((m) => rangedIds.has(m.loadId));
  const rangedAnomalies = anomalies.filter((a) => a.loadId && rangedIds.has(a.loadId));

  const kpisEl = $("fuel-kpis");
  if (kpisEl)
    renderKpisFuel(kpisEl, buildKpisFuel(ranged, rangedMetrics, baseline, rangedAnomalies), (f) => {
      if (f === "discrepancia") setVerdictFilter("discrepancia");
      else if (f === "pendiente") setVerdictFilter("pendiente");
      else if (f === "anomalia") {
        // Sin filtro propio de anomalía en la tabla: enfocar discrepancias + pendientes.
        setVerdictFilter("pendiente");
      }
    });

  populateFuelSelects(
    $("fuel-filt-suc") as HTMLSelectElement | null,
    $("fuel-filt-resp") as HTMLSelectElement | null,
    all,
  );

  renderTableCombustible({
    tbody,
    countEl: $("fuel-rcnt"),
    emptyEl: $("fuel-empty"),
    tableEl: $("fuel-table"),
    entries: all,
    filter,
    sortCol,
    sortDir,
    metricsByLoad,
    onRowClick: (loadId, order) => window.openFuelDetail?.(loadId, order),
  });

  updateFuelNavBadge();
}

function setVerdictFilter(v: FuelVerdictFilter): void {
  filter.verdict = v;
  syncFilterControls();
  renderCombustible();
}

/** Sincroniza los controles del DOM con el estado del filtro (idempotente). */
function syncFilterControls(): void {
  const vSel = $("fuel-filt-verdict") as HTMLSelectElement | null;
  if (vSel) vSel.value = filter.verdict;
  const tSel = $("fuel-filt-tipo") as HTMLSelectElement | null;
  if (tSel) tSel.value = filter.tipo;
}

function updateFuelNavBadge(): void {
  const badge = $("fuel-nav-badge");
  if (!badge) return;
  const pend = scoped().filter((e) => {
    const v = verdictOf(e);
    return v === "pendiente" || v === "discrepancia";
  }).length;
  badge.textContent = pend > 99 ? "99+" : pend > 0 ? String(pend) : "";
  badge.style.display = pend > 0 ? "" : "none";
}

/** Inicializa el rango de fechas a partir de los datos (default: últimos 3 meses). */
function initRangoFuel(): void {
  const all = scoped();
  const fechas = all
    .map((e) => e.fecha)
    .filter(Boolean)
    .sort();
  if (fechas.length === 0) return;
  const max = fechas[fechas.length - 1]!;
  // Default: 3 meses hacia atrás desde la fecha máxima (sin Date.now para estabilidad).
  const [y, m] = max.split("-").map((s) => parseInt(s, 10));
  let yy = y!;
  let mm = (m ?? 1) - 3;
  while (mm <= 0) {
    mm += 12;
    yy -= 1;
  }
  const desde = `${yy}-${String(mm).padStart(2, "0")}-01`;
  filter.desde = desde < fechas[0]! ? fechas[0]! : desde;
  filter.hasta = max;
  const dEl = $("fuel-rango-desde") as HTMLInputElement | null;
  const hEl = $("fuel-rango-hasta") as HTMLInputElement | null;
  if (dEl) dEl.value = filter.desde;
  if (hEl) hEl.value = filter.hasta;
}

/** Cablea los listeners de los controles de la vista. Llamar una vez al montar. */
function mountControls(): void {
  const srch = $("fuel-srch") as HTMLInputElement | null;
  srch?.addEventListener("input", () => {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      filter.search = srch.value;
      renderCombustible();
    }, 200);
  });
  ($("fuel-filt-suc") as HTMLSelectElement | null)?.addEventListener("change", (e) => {
    filter.sucursal = (e.target as HTMLSelectElement).value;
    renderCombustible();
  });
  ($("fuel-filt-resp") as HTMLSelectElement | null)?.addEventListener("change", (e) => {
    filter.responsable = (e.target as HTMLSelectElement).value;
    renderCombustible();
  });
  ($("fuel-filt-tipo") as HTMLSelectElement | null)?.addEventListener("change", (e) => {
    filter.tipo = (e.target as HTMLSelectElement).value as FuelTipoFilter;
    renderCombustible();
  });
  ($("fuel-filt-verdict") as HTMLSelectElement | null)?.addEventListener("change", (e) => {
    filter.verdict = (e.target as HTMLSelectElement).value as FuelVerdictFilter;
    renderCombustible();
  });
  ($("fuel-rango-desde") as HTMLInputElement | null)?.addEventListener("change", (e) => {
    filter.desde = (e.target as HTMLInputElement).value || undefined;
    renderCombustible();
  });
  ($("fuel-rango-hasta") as HTMLInputElement | null)?.addEventListener("change", (e) => {
    filter.hasta = (e.target as HTMLInputElement).value || undefined;
    renderCombustible();
  });
  // Ordenamiento por click en headers (data-sort).
  $("fuel-thead-row")?.addEventListener("click", (ev) => {
    const th = (ev.target as HTMLElement).closest("[data-sort]") as HTMLElement | null;
    if (!th) return;
    const col = th.dataset.sort as FuelSortCol;
    if (sortCol === col) sortDir = sortDir === 1 ? -1 : 1;
    else {
      sortCol = col;
      sortDir = 1;
    }
    renderCombustible();
  });
}

// Exponer al HTML/cloudHydrate.
window.renderCombustible = renderCombustible;
window.initRangoFuel = initRangoFuel;
window.updateFuelNavBadge = updateFuelNavBadge;

// Montar listeners cuando el DOM esté listo.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountControls);
} else {
  mountControls();
}
