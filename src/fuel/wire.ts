/**
 * Glue del módulo de combustible: monta las funciones globales que el HTML y
 * cloudHydrate invocan (window.renderCombustible / initRangoFuel / updateFuelNavBadge
 * / openFuelDetail), mantiene el estado de UI (filtros, orden, rango) y orquesta
 * el cálculo (métricas/baseline/anomalías) + render (KPIs + tabla).
 *
 * Importado una vez desde src/main.ts. Toda la lógica pesada vive en módulos puros
 * (fuelAnalysis, renderTableCombustible, renderKpis); aquí solo cableado de DOM.
 */
import type {
  FuelEntry,
  FuelMetrics,
  FuelEvidenceKind,
  FuelVerdict,
  FleetBaseline,
  FuelFinding,
} from "./types";
import {
  computeFuelMetrics,
  buildFleetBaseline,
  detectFuelAnomalies,
  computeRecorridos,
  groupFindingsByLoad,
  matchesFlag,
  type RecorridoInfo,
} from "./fuelAnalysis";
import {
  renderTableCombustible,
  filterAndSortFuel,
  populateFuelSelects,
  displayVerdictOf,
  type FuelTableFilter,
  type FuelSortCol,
  type FuelTipoFilter,
  type FuelVerdictFilter,
} from "./renderTableCombustible";
import { buildKpisFuel, renderKpisFuel } from "./renderKpis";
import { renderDetalleCarga, deriveGlobalVerdict } from "./renderDetalleCarga";
import {
  rankUnitsByDeviation,
  rankUnitsBySubmarca,
  duracionPorResponsable,
  splitRanking,
  aggByGroup,
  aggByMonth,
} from "./fuelAggregates";
import { buildTokaLayout, tokaLayoutToAoa, ecoKey, type TokaSkipMotivo } from "./tokaLayout";
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
  flag: "",
  area: "",
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

// Cache email→nombre del validador (de la lista de Usuarios). Se llena SIN bloquear el render:
// la tabla pinta el email y, cuando llega la lista, re-pinta con el nombre real.
const _nombrePorEmail = new Map<string, string>();
let _nombresPedidos = false;
function cargarNombresValidadores(): void {
  if (_nombresPedidos) return;
  _nombresPedidos = true;
  window.__admin
    ?.listUsers()
    .then((r) => {
      const data = (r && r.ok && Array.isArray(r.data) ? r.data : []) as Array<{
        email?: string;
        nombre?: string;
      }>;
      let added = 0;
      for (const u of data)
        if (u.email && u.nombre) {
          _nombrePorEmail.set(u.email.toLowerCase(), u.nombre);
          added++;
        }
      if (added) renderCombustible(); // re-pinta para enriquecer email→nombre
    })
    .catch(() => {
      /* sin permisos (no admin) → se queda el handle del correo */
    });
}
/** Nombre legible del validador: mapa de Usuarios → nombre; si no, handle del correo; vacío/"ui" → "—". */
function nombreValidador(email: string | null | undefined): string {
  const e = (email ?? "").trim();
  if (!e || e === "ui") return "—";
  return _nombrePorEmail.get(e.toLowerCase()) ?? e.split("@")[0]!;
}

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/** Aplica el lock por sucursal (no-op para admin/"Todas"). */
function scoped(): FuelEntry[] {
  const all = window.fuelEntries ?? [];
  return typeof window.scopeBySucursal === "function" ? window.scopeBySucursal(all) : all;
}

type FuelCtx = {
  filtered: FuelEntry[];
  filteredMetrics: FuelMetrics[];
  baseline: FleetBaseline;
  anomalies: FuelFinding[];
  metricsByLoad: Map<string, FuelMetrics>;
  recorridosByLoad: Map<string, RecorridoInfo>;
  /** loadId → anomalías detectadas (chips de la tabla + filtro por alerta). */
  findingsByLoad: Map<string, FuelFinding[]>;
};
let lastCtx: FuelCtx | null = null;

/**
 * Contexto FILTRADO único que alimenta KPIs, tabla y dashboard de forma consistente.
 * El km/l se calcula sobre el histórico COMPLETO scopeado (el delta de odómetro usa
 * la carga anterior aunque caiga fuera del filtro) y luego se SELECCIONA el subconjunto
 * que pasa TODOS los filtros (lock sucursal + tipo + validación + sucursal-dropdown +
 * responsable + búsqueda + período) — los MISMOS que la tabla. Antes KPIs/gráficas
 * usaban solo período y los rankings el histórico total → no respetaban los filtros.
 */
function computeCtx(): FuelCtx {
  const all = scoped();
  const allMetrics = computeFuelMetrics(all);
  const metricsByLoad = new Map<string, FuelMetrics>(allMetrics.map((m) => [m.loadId, m]));
  // FASE 1 — sin el filtro de alerta: las anomalías se detectan sobre el set filtrado por
  // los demás criterios (el filtro por alerta NECESITA las anomalías → se aplica después).
  const preFiltered = filterAndSortFuel(all, { ...filter, flag: "" }, "_idx", -1);
  const preIds = new Set(preFiltered.map((e) => e.loadId));
  const preMetrics = allMetrics.filter((m) => preIds.has(m.loadId));
  const baseline = buildFleetBaseline(preMetrics, preFiltered);
  const anomaliesPre = detectFuelAnomalies(preMetrics, baseline);
  const findingsByLoad = groupFindingsByLoad(anomaliesPre);
  // FASE 2 — aplica el filtro por alerta (subconjunto consistente para KPIs/tabla/dashboard).
  const filtered = filter.flag
    ? preFiltered.filter((e) => matchesFlag(findingsByLoad.get(e.loadId), filter.flag))
    : preFiltered;
  const ids = filter.flag ? new Set(filtered.map((e) => e.loadId)) : preIds;
  const filteredMetrics = filter.flag ? preMetrics.filter((m) => ids.has(m.loadId)) : preMetrics;
  const anomalies = filter.flag
    ? anomaliesPre.filter((f) => f.loadId && ids.has(f.loadId))
    : anomaliesPre;
  // Recorrido por ciclo sobre el histórico COMPLETO scopeado (la "siguiente solicitud" puede
  // caer fuera del filtro); la tabla/KPI consultan por loadId los registros filtrados.
  const recorridosByLoad = computeRecorridos(all);
  const ctx: FuelCtx = {
    filtered,
    filteredMetrics,
    baseline,
    anomalies,
    metricsByLoad,
    recorridosByLoad,
    findingsByLoad,
  };
  lastCtx = ctx;
  lastMetricsByLoad = metricsByLoad;
  return ctx;
}

function renderCombustible(): void {
  const tbody = $("fuel-tbody");
  if (!tbody) return; // vista no montada aún
  const all = scoped();
  const ctx = computeCtx();
  cargarNombresValidadores(); // no bloquea; re-pinta al llegar la lista

  const kpisEl = $("fuel-kpis");
  if (kpisEl)
    renderKpisFuel(
      kpisEl,
      buildKpisFuel(
        ctx.filtered,
        ctx.filteredMetrics,
        ctx.baseline,
        ctx.anomalies,
        ctx.recorridosByLoad,
      ),
      (f) => {
        if (f === "discrepancia") setVerdictFilter("discrepancia");
        else if (f === "pendiente") setVerdictFilter("pendiente");
        else if (f === "historico") setVerdictFilter("historico");
        // La KPI "Anomalías" filtra por alerta detectada (antes caía en "pendiente").
        else if (f === "anomalia") setFlagFilter("any");
      },
    );

  // Los selects se pueblan del set COMPLETO (no del filtrado) para no perder opciones.
  populateFuelSelects(
    $("fuel-filt-suc") as HTMLSelectElement | null,
    $("fuel-filt-resp") as HTMLSelectElement | null,
    all,
  );

  // La submarca ya viaja en cada FuelEntry (join por economicoId en cloudHydrate).
  renderTableCombustible({
    tbody,
    countEl: $("fuel-rcnt"),
    emptyEl: $("fuel-empty"),
    tableEl: $("fuel-table"),
    entries: all,
    filter,
    sortCol,
    sortDir,
    metricsByLoad: ctx.metricsByLoad,
    recorridosByLoad: ctx.recorridosByLoad,
    findingsByLoad: ctx.findingsByLoad,
    nombreValidador,
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

// Submarca seleccionada en el comparativo por tipo de unidad ("" = la de más unidades).
let dashSubmarca = "";

/** Render del dashboard ejecutivo (carga echarts dinámicamente al primer uso). */
async function renderFuelDash(): Promise<void> {
  const dash = $("fuel-dash");
  if (!dash) return;
  // MISMO contexto filtrado que los KPIs/tabla (rankings, consumos y tendencia
  // respetan TODOS los filtros, no solo el período). Reutiliza el último cómputo.
  const ctx = lastCtx ?? computeCtx();
  // Ranking por desviación vs el MISMO tipo de unidad (no km/l absoluto): así un diésel
  // pesado no cae siempre en "peores" por física. mejores/peores disjuntos (splitRanking).
  const ranks = rankUnitsByDeviation(ctx.baseline);
  const { mejores, peores } = splitRanking(ranks, 10);

  // Comparativo por submarca (obs. 1 auditoría): submarca y última sucursal conocida
  // por unidad, del MISMO set filtrado (respeta período/sucursal/etc.).
  const submarcaDe = new Map<string, string>();
  const sucursalDe = new Map<string, string>();
  for (const e of ctx.filtered) {
    if (e.submarca && !submarcaDe.has(e.eco)) submarcaDe.set(e.eco, e.submarca);
    if (e.sucursal) sucursalDe.set(e.eco, e.sucursal); // filtered viene DESC → la 1ª es la última
  }
  const porSubmarca = rankUnitsBySubmarca(ctx.baseline, submarcaDe, sucursalDe);
  // Selector: submarcas ordenadas por nº de unidades (la más poblada primero = default).
  const submarcas = [...porSubmarca.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([label]) => label);
  const sel = $("fuel-dash-tipo-unidad") as HTMLSelectElement | null;
  if (sel) {
    const prev = dashSubmarca || submarcas[0] || "";
    sel.replaceChildren();
    for (const s of submarcas) {
      const o = document.createElement("option");
      o.value = s;
      o.textContent = `${s} (${porSubmarca.get(s)!.length})`;
      sel.appendChild(o);
    }
    if (submarcas.includes(prev)) sel.value = prev;
    dashSubmarca = sel.value;
  }
  const tipoSeleccionado = dashSubmarca || submarcas[0] || "";

  const data = {
    peores,
    mejores,
    porSucursal: aggByGroup(ctx.filtered, (e) => e.sucursal),
    porResponsable: aggByGroup(ctx.filtered, (e) => e.responsable ?? "").slice(0, 12),
    porTipo: aggByGroup(ctx.filtered, (e) => e.tipoUnidad ?? e.combustible ?? "(sin tipo)"),
    meses: aggByMonth(ctx.filtered),
    unidadesDeTipo: porSubmarca.get(tipoSeleccionado) ?? [],
    tcaptura: duracionPorResponsable(ctx.filtered).slice(0, 12),
    porArea: aggByGroup(ctx.filtered, (e) => e.area ?? "(sin área)"),
  };
  const els = {
    peores: $("fchart-peores"),
    mejores: $("fchart-mejores"),
    sucursal: $("fchart-sucursal"),
    responsable: $("fchart-responsable"),
    tipo: $("fchart-tipo"),
    tendencia: $("fchart-tendencia"),
    tipoUnidad: $("fchart-tipo-unidad"),
    tcaptura: $("fchart-tcaptura"),
    area: $("fchart-area"),
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

function setFlagFilter(flag: string): void {
  filter.flag = flag;
  syncFilterControls();
  renderCombustible();
}

const TOKA_SKIP_LABEL: Record<TokaSkipMotivo, string> = {
  "monto-cero": "sin monto a cargar",
  "producto-ausente": "sin producto",
  "producto-desconocido": "producto fuera de catálogo Toka",
};

/**
 * Genera y descarga el "Layout de carga masiva para Toka" con las unidades del filtro
 * actual (una fila por unidad; MONTO DESEADO = Σ del "monto a cargar" de sus solicitudes).
 * xlsx se carga dinámicamente (fuera del bundle principal). Reporta incluidas/omitidas.
 */
type OverrideResult = { map: Map<string, string>; failed: boolean; conflicts: string[] };

/**
 * Override economicoId→productoToka del catálogo de Unidades (admin), normalizado con
 * `ecoKey` para que case con el eco de las cargas ("06"↔"6"). Si dos unidades comparten
 * económico con productos distintos NO se inventa un ganador: se omite ese override (manda
 * MoreApp validado) y se reporta como conflicto. `failed` distingue "catálogo vacío legítimo"
 * de "no se pudo leer" (sin sesión/red) para que el export no aplique overrides en silencio.
 */
async function fetchProductoOverride(): Promise<OverrideResult> {
  const map = new Map<string, string>();
  if (!window.__units) return { map, failed: true, conflicts: [] };
  try {
    const units = (await window.__units.list()) ?? [];
    const conflicts = new Set<string>();
    for (const u of units) {
      const key = ecoKey(u.economicoId);
      const prod = (u.productoToka ?? "").trim();
      if (!key || !prod) continue;
      const prev = map.get(key);
      if (prev && prev !== prod) conflicts.add(key);
      else if (!conflicts.has(key)) map.set(key, prod);
    }
    for (const k of conflicts) map.delete(k); // económico duplicado → no se aplica ninguno
    return { map, failed: false, conflicts: [...conflicts] };
  } catch (e) {
    console.warn("[fuel] no se pudo leer el catálogo de unidades:", e);
    return { map: new Map(), failed: true, conflicts: [] };
  }
}

async function exportTokaLayout(): Promise<void> {
  const ctx = computeCtx();
  const override = await fetchProductoOverride();
  const result = buildTokaLayout(ctx.filtered, { productoOverride: override.map });
  if (result.rows.length === 0) {
    const motivo = result.totalUnidades
      ? "ninguna unidad del filtro tiene monto a cargar (>0). Revisa que el filtro incluya solicitudes."
      : "no hay registros en el filtro actual.";
    window.notify?.(`No se generó el layout Toka: ${motivo}`, "warn", 6000);
    return;
  }
  try {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(tokaLayoutToAoa(result));
    ws["!cols"] = [{ wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 32 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, "Hoja1");
    const fecha = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `layout_carga_toka_${fecha}.xlsx`);
  } catch (e) {
    console.warn("[fuel] no se pudo generar el layout Toka:", e);
    window.notify?.("No se pudo generar el archivo Toka. Intenta de nuevo.", "err", 6000);
    return;
  }

  // Fallo al leer el catálogo: aviso DEDICADO (no silencioso) — el layout salió con el
  // producto de MoreApp y los overrides Toka NO se aplicaron.
  if (override.failed)
    window.notify?.(
      "No se pudo leer el catálogo de Unidades: el layout usa el producto de MoreApp y los overrides Toka NO se aplicaron. Verifica tu sesión y reintenta.",
      "warn",
      8000,
    );

  // Resumen de incluidas / omitidas / advertencias (nada silencioso).
  const partes = [
    `${result.rows.length} unidad${result.rows.length === 1 ? "" : "es"} incluida${result.rows.length === 1 ? "" : "s"}`,
  ];
  if (result.skipped.length) {
    const porMotivo = new Map<TokaSkipMotivo, number>();
    for (const s of result.skipped) porMotivo.set(s.motivo, (porMotivo.get(s.motivo) ?? 0) + 1);
    const detalle = [...porMotivo].map(([m, n]) => `${n} ${TOKA_SKIP_LABEL[m]}`).join(", ");
    partes.push(
      `${result.skipped.length} omitida${result.skipped.length === 1 ? "" : "s"} (${detalle})`,
    );
  }
  if (override.conflicts.length)
    partes.push(
      `${override.conflicts.length} económico${override.conflicts.length === 1 ? "" : "s"} duplicado${override.conflicts.length === 1 ? "" : "s"} en catálogo (override ignorado: ${override.conflicts.join(", ")})`,
    );
  if (result.warnings.length)
    partes.push(`${result.warnings.length} advertencia${result.warnings.length === 1 ? "" : "s"}`);
  const limpio =
    result.skipped.length === 0 && result.warnings.length === 0 && override.conflicts.length === 0;
  window.notify?.(`Layout Toka: ${partes.join(" · ")}.`, limpio ? "ok" : "warn", 7000);
}

/** Sincroniza los controles del DOM con el estado del filtro (idempotente). */
function syncFilterControls(): void {
  const vSel = $("fuel-filt-verdict") as HTMLSelectElement | null;
  if (vSel) vSel.value = filter.verdict;
  const tSel = $("fuel-filt-tipo") as HTMLSelectElement | null;
  if (tSel) tSel.value = filter.tipo;
  const fSel = $("fuel-filt-flag") as HTMLSelectElement | null;
  if (fSel) fSel.value = filter.flag;
  const aSel = $("fuel-filt-area") as HTMLSelectElement | null;
  if (aSel) aSel.value = filter.area;
}

function updateFuelNavBadge(): void {
  const badge = $("fuel-nav-badge");
  if (!badge) return;
  const pend = scoped().filter((e) => {
    const v = displayVerdictOf(e);
    return v === "pendiente" || v === "discrepancia";
  }).length;
  badge.textContent = pend > 99 ? "99+" : pend > 0 ? String(pend) : "";
  badge.style.display = pend > 0 ? "" : "none";
}

/** Inicializa el rango de fechas a partir de los datos (default: últimos 3 meses). */
function initRangoFuel(): void {
  const dEl = $("fuel-rango-desde") as HTMLInputElement | null;
  const hEl = $("fuel-rango-hasta") as HTMLInputElement | null;
  // Preservar la selección del usuario: si los inputs YA tienen rango, sincroniza el
  // filtro desde ellos y NO resetea al default. El auto-refresh (poll 4min / focus)
  // re-llama initRango* en cada re-hidratación y antes borraba la fecha elegida
  // ("se cambia sola"). El default solo se calcula en la 1ª inicialización (inputs vacíos).
  if (dEl && hEl && dEl.value && hEl.value) {
    filter.desde = dEl.value;
    filter.hasta = hEl.value;
    return;
  }
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
  ($("fuel-filt-flag") as HTMLSelectElement | null)?.addEventListener("change", (e) => {
    filter.flag = (e.target as HTMLSelectElement).value;
    renderCombustible();
  });
  ($("fuel-filt-area") as HTMLSelectElement | null)?.addEventListener("change", (e) => {
    filter.area = (e.target as HTMLSelectElement).value;
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
  // Selector de submarca del comparativo por tipo de unidad.
  ($("fuel-dash-tipo-unidad") as HTMLSelectElement | null)?.addEventListener("change", (e) => {
    dashSubmarca = (e.target as HTMLSelectElement).value;
    void renderFuelDash();
  });
  // Descargar layout de carga masiva Toka (respeta los filtros activos).
  $("fuel-export-toka")?.addEventListener("click", () => void exportTokaLayout());
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
    statUnidad: lastCtx?.baseline.porUnidad.get(load.eco),
    statTipo: lastCtx?.baseline.porTipo.get(lastCtx.baseline.tipoDe.get(load.eco) ?? "(sin tipo)"),
    recorrido: lastCtx?.recorridosByLoad.get(loadId),
    nombreValidador,
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
  const revisadoPor = (sess && sess.email) || ""; // email real; vacío → la UI muestra "—"
  const ts = new Date().toISOString(); // cuándo se validó (antes no se guardaba)
  load.review = {
    ...review,
    porEvidencia: por,
    verdictGlobal,
    nota: nota ?? review.nota,
    revisadoPor,
    ts,
    fuenteDeteccion: "manual",
  };
  void upsertValidacionCarga({
    tenantId,
    loadId,
    verdictGlobal,
    porEvidencia: por,
    nota: nota ?? review.nota,
    revisadoPor,
    ts,
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
