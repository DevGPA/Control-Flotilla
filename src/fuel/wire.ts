/**
 * Glue del módulo de combustible: monta las funciones globales que el HTML y
 * cloudHydrate invocan (window.renderCombustible / initRangoFuel / updateFuelNavBadge
 * / openFuelDetail), mantiene el estado de UI (filtros, orden, rango) y orquesta
 * el cálculo (métricas/baseline/anomalías) + render (KPIs + tabla).
 *
 * Importado una vez desde src/main.ts. Toda la lógica pesada vive en módulos puros
 * (fuelAnalysis, renderTableCombustible, renderKpis); aquí solo cableado de DOM.
 */
import type { FuelEntry, FuelMetrics, FuelEvidenceKind, FuelVerdict } from "./types";
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
import { renderDetalleCarga, deriveGlobalVerdict } from "./renderDetalleCarga";
import { rankUnitsByKmpl, aggByGroup, aggByMonth } from "./fuelAggregates";
import { upsertValidacionCarga } from "../api/client";

declare global {
  interface Window {
    fuelEntries?: FuelEntry[];
    renderCombustible?: () => void;
    initRangoFuel?: () => void;
    updateFuelNavBadge?: () => void;
    openFuelDetail?: (loadId: string, order?: string[]) => void;
    scopeBySucursal?: <T extends { sucursal?: string }>(rows: T[]) => T[];
    lockedSucursal?: () => string | null;
    canWrite?: () => boolean;
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
// Detalle/validación
let lastMetricsByLoad = new Map<string, FuelMetrics>();
let detailOrder: string[] = [];
let detailIndex = -1;
// Dashboard
let dashShown = false;

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
  lastMetricsByLoad = metricsByLoad;
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

  if (dashShown) void renderFuelDash();
  updateFuelNavBadge();
}

/** Alterna entre Lista y Dashboard (control segmentado). */
function setDashView(show: boolean): void {
  dashShown = show;
  const tw = $("fuel-table-wrap");
  const dash = $("fuel-dash");
  if (tw) tw.style.display = show ? "none" : "";
  if (dash) dash.style.display = show ? "block" : "none";
  const bl = $("fuel-seg-lista");
  const bd = $("fuel-seg-dash");
  bl?.classList.toggle("on", !show);
  bl?.setAttribute("aria-selected", String(!show));
  bd?.classList.toggle("on", show);
  bd?.setAttribute("aria-selected", String(show));
  if (show) void renderFuelDash();
}

/** Render del dashboard ejecutivo (carga echarts dinámicamente al primer uso). */
async function renderFuelDash(): Promise<void> {
  const dash = $("fuel-dash");
  if (!dash) return;
  const all = scoped();
  const ranged = all.filter(inRange);
  const allMetrics = computeFuelMetrics(all);
  const baseline = buildFleetBaseline(allMetrics, all);
  const ranks = rankUnitsByKmpl(baseline);
  const data = {
    peores: ranks.slice(-10),
    mejores: ranks.slice(0, 10),
    porSucursal: aggByGroup(ranged, (e) => e.sucursal),
    porResponsable: aggByGroup(ranged, (e) => e.responsable ?? "").slice(0, 12),
    porTipo: aggByGroup(ranged, (e) => e.tipoUnidad ?? e.combustible ?? "(sin tipo)"),
    meses: aggByMonth(ranged),
  };
  const els = {
    peores: $("fchart-peores"),
    mejores: $("fchart-mejores"),
    sucursal: $("fchart-sucursal"),
    responsable: $("fchart-responsable"),
    tipo: $("fchart-tipo"),
    tendencia: $("fchart-tendencia"),
  };
  try {
    const { renderFuelDashboard } = await import("./fuelCharts");
    renderFuelDashboard(els, data);
  } catch (e) {
    console.warn("[fuel] no se pudo cargar el dashboard:", e);
  }
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
  // Toggle segmentado Lista | Dashboard.
  $("fuel-seg-lista")?.addEventListener("click", () => setDashView(false));
  $("fuel-seg-dash")?.addEventListener("click", () => setDashView(true));
  // Controles del drawer de detalle.
  $("fuel-det-close")?.addEventListener("click", closeFuelDetail);
  $("fuel-det-prev")?.addEventListener("click", () => navDetail(-1));
  $("fuel-det-next")?.addEventListener("click", () => navDetail(1));
  document.addEventListener("keydown", (ev) => {
    const det = $("fuel-det");
    if (!det || !det.classList.contains("open")) return;
    const k = (ev as KeyboardEvent).key;
    if (k === "Escape") closeFuelDetail();
    else if (k === "ArrowLeft") navDetail(-1);
    else if (k === "ArrowRight") navDetail(1);
  });
}

// ── Drawer de detalle / validación de evidencias ──────────────
function resolveUrl(fname: string): string | null {
  const map = (
    window as unknown as { __cloudPhotoUrlMap?: Map<string, { url: string; expires?: number }> }
  ).__cloudPhotoUrlMap;
  const e = map?.get(fname.toLowerCase());
  if (!e) return null;
  // Descartar URLs firmadas vencidas (el auto-refresh de 4 min las re-firma). Igual
  // que el legacy imgUrl; sin esto, el drawer muestra imágenes rotas tras el TTL.
  if (typeof e.expires === "number" && e.expires <= Date.now()) return null;
  return e.url ?? null;
}

function canWrite(): boolean {
  return typeof window.canWrite === "function" ? window.canWrite() : true;
}

function loadById(loadId: string): FuelEntry | undefined {
  return (window.fuelEntries ?? []).find((e) => e.loadId === loadId);
}

function renderCurrentDetail(): void {
  const loadId = detailOrder[detailIndex];
  if (!loadId) return;
  const load = loadById(loadId);
  const body = $("fuel-det-body");
  if (!load || !body) return;
  const pos = $("fuel-det-pos");
  if (pos) pos.textContent = `${detailIndex + 1} / ${detailOrder.length}`;
  renderDetalleCarga({
    body,
    titleEl: $("fuel-det-title"),
    metaEl: $("fuel-det-meta"),
    load,
    metrics: lastMetricsByLoad.get(loadId),
    resolveUrl,
    canWrite: canWrite(),
    onValidate: handleValidate,
  });
}

function openFuelDetail(loadId: string, order?: string[]): void {
  detailOrder = order && order.length ? order : [loadId];
  detailIndex = Math.max(0, detailOrder.indexOf(loadId));
  const det = $("fuel-det");
  if (det) det.classList.add("open");
  renderCurrentDetail();
}

function closeFuelDetail(): void {
  $("fuel-det")?.classList.remove("open");
}

function navDetail(delta: number): void {
  if (detailOrder.length === 0) return;
  detailIndex = (detailIndex + delta + detailOrder.length) % detailOrder.length;
  renderCurrentDetail();
}

/** Aplica un veredicto (por evidencia o global) y persiste en ValidacionCarga. */
function handleValidate(
  loadId: string,
  kind: FuelEvidenceKind | "all",
  verdict: FuelVerdict,
  nota?: string,
): void {
  const load = loadById(loadId);
  if (!load) return;
  const prevReview = load.review; // para rollback si falla la persistencia
  const review = load.review ?? { verdictGlobal: "pendiente" as const, porEvidencia: {} };
  const por: Partial<Record<FuelEvidenceKind, FuelVerdict>> = { ...review.porEvidencia };
  if (kind === "all") {
    // Marca OK todas las evidencias presentes (odometro/medidor/ticket).
    for (const k of ["odometro", "medidor", "ticket"] as FuelEvidenceKind[]) por[k] = "ok";
  } else {
    por[kind] = verdict;
  }
  const verdictGlobal = deriveGlobalVerdict(por);
  // tenant y revisor de la sesión real (no literales): trazabilidad correcta y
  // sin escritura cross-tenant si algún día hay un 2º tenant.
  const sess = window.__cloudSession;
  const tenantId = (sess && sess.tenantId) || "gpa";
  const revisadoPor = (sess && sess.email) || "ui";
  load.review = {
    ...review,
    porEvidencia: por,
    verdictGlobal,
    nota: nota ?? review.nota,
    revisadoPor,
    fuenteDeteccion: "manual",
  };
  void upsertValidacionCarga({
    tenantId,
    loadId,
    verdictGlobal,
    porEvidencia: por,
    nota: nota ?? review.nota,
    revisadoPor,
  }).catch((e) => {
    console.warn("[fuel] upsertValidacionCarga falló:", e);
    // Rollback del update optimista: si no se guardó, revierte el estado en UI.
    load.review = prevReview;
    renderCurrentDetail();
    renderCombustible();
    window.notify?.("No se pudo guardar la validación.", "error", 4000);
  });
  renderCurrentDetail();
  renderCombustible();
  // La fila validada pudo salir del filtro (p.ej. "Pendiente"); re-sincroniza el
  // orden de navegación del drawer con lo realmente visible en la tabla.
  syncDetailOrderFromDOM(loadId);
}

/** Re-sincroniza detailOrder/detailIndex con las filas visibles tras un re-render. */
function syncDetailOrderFromDOM(currentLoadId: string): void {
  const ids = Array.from(document.querySelectorAll("#fuel-tbody tr"))
    .map((tr) => (tr as HTMLElement).dataset.loadId)
    .filter((x): x is string => !!x);
  if (!ids.length) return;
  detailOrder = ids;
  const idx = ids.indexOf(currentLoadId);
  if (idx >= 0) detailIndex = idx;
  else if (detailIndex >= ids.length) detailIndex = ids.length - 1;
}

// Exponer al HTML/cloudHydrate.
window.renderCombustible = renderCombustible;
window.initRangoFuel = initRangoFuel;
window.updateFuelNavBadge = updateFuelNavBadge;
window.openFuelDetail = openFuelDetail;

// Montar listeners cuando el DOM esté listo.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountControls);
} else {
  mountControls();
}
