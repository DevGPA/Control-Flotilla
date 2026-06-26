/**
 * Glue del módulo de Cumplimiento: monta las funciones globales que el HTML y cloudHydrate
 * invocan (window.renderCumplimiento / updateCumplimientoNavBadge / openComplianceDetail),
 * mantiene el estado de UI (filtros, orden) y orquesta el cálculo (resumen por unidad,
 * merge con el catálogo de flota, scope por sucursal) + render (KPIs + tabla).
 *
 * Importado una vez desde src/main.ts. La lógica pesada vive en módulos puros
 * (complianceAnalysis, renderCumplimiento); aquí solo cableado de DOM. Todo el acceso al
 * DOM va con guardas: la vista #view-cumplimiento puede no existir todavía.
 */
import {
  resumirFlota,
  mergeFlotaConCatalogo,
  toComplianceEntry,
  type UnidadCatalogo,
} from "./complianceAnalysis";
import { buildComplianceDoc } from "./mapEntry";
import {
  renderTableCumplimiento,
  renderKpisCumplimiento,
  buildKpisCumplimiento,
  populateCumplimientoSelects,
  renderExpedienteUnidad,
  renderCapturaForm,
  tieneIssue,
  type CumplimientoTableFilter,
  type CumplimientoSortCol,
  type CumplimientoEstadoFilter,
} from "./renderCumplimiento";
import { upsertComplianceDoc, deleteComplianceDoc } from "../api/client";
import type { CapturaFields, ComplianceEntry, ComplianceResumenUnidad } from "./types";

/** Descriptor de alerta para el panel de Inspecciones (lo consume buildAlertsSummary). */
type ComplianceAlert = {
  sev: string;
  icon: string;
  count: number;
  short: string;
  detail: string;
  view: string;
};

declare global {
  interface Window {
    complianceEntries?: ComplianceEntry[];
    renderCumplimiento?: () => void;
    updateCumplimientoNavBadge?: () => void;
    openComplianceDetail?: (eco: string) => void;
    /** Pestaña "Cumplimiento" del panel #det: pinta el expediente de la unidad. */
    renderComplianceTab?: (eco: string, placa: string | undefined, container: HTMLElement) => void;
    /** Alertas de cumplimiento para el panel de Inspecciones (buildAlertsSummary). */
    complianceAlerts?: () => ComplianceAlert[];
  }
}

// ── Estado de UI (módulo) ──────────────────────────────
const filter: CumplimientoTableFilter = { estado: "all", sucursal: "", search: "" };
let sortCol: CumplimientoSortCol = "estado";
let sortDir: 1 | -1 = -1; // peor estado primero
let searchDebounce: ReturnType<typeof setTimeout> | null = null;

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/**
 * Catálogo de flota (legacy window.__fleetUnits) → forma mínima para el merge.
 * EXCLUYE montacargas (Gas LP): no circulan en vía pública → no tienen placas, verificación,
 * tenencia ni multas. Mismo criterio `!u.esMontacargas` que Inspecciones/FLOTA.
 */
function catalogoFlota(): UnidadCatalogo[] {
  const fleet = (window.__fleetUnits ?? []) as Array<{
    eco?: string;
    plate?: string;
    branch?: string;
    esMontacargas?: boolean;
  }>;
  const out: UnidadCatalogo[] = [];
  for (const u of fleet) {
    if (u.esMontacargas) continue;
    const eco = String(u.eco ?? "").trim();
    if (eco) out.push({ eco, sucursal: u.branch, placa: u.plate });
  }
  return out;
}

/**
 * Resúmenes por unidad para la vista: docs → resumen, fusionado con la flota COMPLETA
 * (unidades sin docs = 'desconocido') y scopeado por sucursal (no-op admin/"Todas").
 */
function computeResumenes(): ComplianceResumenUnidad[] {
  const entries = window.complianceEntries ?? [];
  const merged = mergeFlotaConCatalogo(resumirFlota(entries), catalogoFlota());
  if (typeof window.scopeBySucursal !== "function") return merged;
  // Las unidades SIN sucursal (huérfanas: docs cuyo eco no está en el catálogo) NO deben
  // caer del scope: un documento accionable sin contexto de sucursal debe verse igual
  // aunque el usuario esté fijado a una sucursal. Scopeamos solo las que SÍ traen sucursal.
  const conSucursal = merged.filter((u) => u.sucursal);
  const sinSucursal = merged.filter((u) => !u.sucursal);
  return [...window.scopeBySucursal(conSucursal), ...sinSucursal];
}

function onKpiFilter(f: CumplimientoEstadoFilter): void {
  filter.estado = f;
  const sel = $("cmp-estado") as HTMLSelectElement | null;
  if (sel) sel.value = f;
  renderCumplimiento();
}

function renderCumplimiento(): void {
  const tbody = $("cmp-tbody");
  if (!tbody) return; // la vista aún no está montada en el HTML
  const unidades = computeResumenes();

  const kpisEl = $("cmp-kpis");
  if (kpisEl) renderKpisCumplimiento(kpisEl, buildKpisCumplimiento(unidades), onKpiFilter);

  populateCumplimientoSelects($("cmp-sucursal") as HTMLSelectElement | null, unidades);

  renderTableCumplimiento({
    tbody,
    countEl: $("cmp-count"),
    emptyEl: $("cmp-empty"),
    tableEl: $("cmp-table"),
    unidades,
    filter,
    sortCol,
    sortDir,
    onRowClick: (eco) => window.openComplianceDetail?.(eco),
  });
}

/** Badge del nav: nº de unidades con algo accionable (vencido/por vencer/adeudo). */
function updateCumplimientoNavBadge(): void {
  const badge = $("cmp-nav-badge");
  if (!badge) return;
  const n = computeResumenes().filter(tieneIssue).length;
  badge.textContent = n ? String(n) : "";
  badge.style.display = n ? "" : "none";
}

function openComplianceDetail(eco: string): void {
  // Clic en una fila de la vista consolidada: abre el expediente de la unidad en un MODAL
  // dentro de la propia vista de Cumplimiento (reusa renderComplianceTab: expediente +
  // captura). No salta a Inspecciones (el #det de Inspecciones usa uid sintético distinto).
  const body = $("cmp-det-body");
  const modal = $("cmp-modal");
  if (!body || !modal) return;
  const entry = (window.complianceEntries ?? []).find((e) => e.economicoId === eco);
  const placa = entry?.placa;
  const title = $("cmp-modal-title");
  if (title) title.textContent = `Cumplimiento · ${eco}${placa ? ` · ${placa}` : ""}`;
  renderComplianceTab(eco, placa, body);
  modal.style.display = "flex";
}

function hoyMexicoISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}

function puedeEscribir(): boolean {
  return typeof window.canWrite !== "function" || window.canWrite();
}

function sucursalDeCatalogo(eco: string): string | undefined {
  const fleet = (window.__fleetUnits ?? []) as Array<{ eco?: string; branch?: string }>;
  return fleet.find((u) => String(u.eco ?? "").trim() === eco)?.branch;
}

/**
 * Pestaña "Cumplimiento" del panel #det: expediente de la unidad + (si hay permiso de
 * escritura) el formulario de captura. El alta/edición/borrado actualiza optimistamente
 * window.complianceEntries, re-renderiza y persiste con rollback si la nube falla.
 */
function renderComplianceTab(eco: string, placa: string | undefined, container: HTMLElement): void {
  container.replaceChildren();
  const entries = (window.complianceEntries ?? []).filter((e) => e.economicoId === eco);
  const editable = puedeEscribir();

  const display = document.createElement("div");
  renderExpedienteUnidad(
    display,
    eco,
    placa,
    entries,
    editable ? { onDelete: (docId) => eliminarDoc(eco, placa, container, docId) } : undefined,
  );
  container.appendChild(display);

  if (editable) {
    const formWrap = document.createElement("div");
    formWrap.className = "needs-write";
    renderCapturaForm(formWrap, (fields) => guardarDoc(eco, placa, container, fields));
    container.appendChild(formWrap);
  }
}

function reRenderTab(eco: string, placa: string | undefined, container: HTMLElement): void {
  renderComplianceTab(eco, placa, container);
  if (typeof window.renderCumplimiento === "function") window.renderCumplimiento();
  updateCumplimientoNavBadge();
}

/** Cambio optimista sobre window.complianceEntries + re-render + persistencia con rollback. */
function aplicar(
  next: ComplianceEntry[],
  prev: ComplianceEntry[],
  persist: () => Promise<unknown>,
  errMsg: string,
  eco: string,
  placa: string | undefined,
  container: HTMLElement,
): void {
  window.complianceEntries = next;
  reRenderTab(eco, placa, container);
  persist().catch((e) => {
    console.warn("[cumplimiento] persistencia falló:", e);
    window.complianceEntries = prev;
    reRenderTab(eco, placa, container);
    if (typeof window.notify === "function") window.notify(errMsg, "error", 4000);
  });
}

function guardarDoc(
  eco: string,
  placa: string | undefined,
  container: HTMLElement,
  fields: CapturaFields,
): void {
  const tenantId = window.__cloudSession?.tenantId || "gpa";
  const now = new Date().toISOString();
  const doc = buildComplianceDoc(tenantId, eco, fields, now);
  const entry = toComplianceEntry(doc, hoyMexicoISO());
  const prev = window.complianceEntries ?? [];
  const sucursal =
    prev.find((e) => e.economicoId === eco && e.sucursal)?.sucursal ?? sucursalDeCatalogo(eco);
  if (sucursal) entry.sucursal = sucursal;
  if (placa) entry.placa = placa;
  const next = prev.filter((e) => !(e.economicoId === doc.economicoId && e.docId === doc.docId));
  next.push(entry);
  aplicar(
    next,
    prev,
    () => upsertComplianceDoc(doc),
    "No se pudo guardar el documento.",
    eco,
    placa,
    container,
  );
}

function eliminarDoc(
  eco: string,
  placa: string | undefined,
  container: HTMLElement,
  docId: string,
): void {
  const tenantId = window.__cloudSession?.tenantId || "gpa";
  const prev = window.complianceEntries ?? [];
  const next = prev.filter((e) => !(e.economicoId === eco && e.docId === docId));
  aplicar(
    next,
    prev,
    () => deleteComplianceDoc({ tenantId, economicoId: eco, docId }),
    "No se pudo eliminar el documento.",
    eco,
    placa,
    container,
  );
}

/** Alertas de cumplimiento (vencidos / por vencer / adeudos) para el panel de Inspecciones. */
function complianceAlerts(): ComplianceAlert[] {
  const unidades = computeResumenes();
  const out: ComplianceAlert[] = [];
  const lista = (arr: ComplianceResumenUnidad[]) =>
    arr
      .slice(0, 8)
      .map((u) => u.eco)
      .join(", ") + (arr.length > 8 ? ` y ${arr.length - 8} más` : "");
  const venc = unidades.filter((u) => u.vencidos > 0);
  const porV = unidades.filter((u) => u.porVencer > 0);
  const adeu = unidades.filter((u) => u.adeudos > 0);
  if (venc.length)
    out.push({
      sev: "r",
      icon: "shield-alert",
      count: venc.length,
      short: "Doc vencido",
      detail: lista(venc),
      view: "cumplimiento",
    });
  if (porV.length)
    out.push({
      sev: "a",
      icon: "shield",
      count: porV.length,
      short: "Doc por vencer",
      detail: lista(porV),
      view: "cumplimiento",
    });
  if (adeu.length)
    out.push({
      sev: "r",
      icon: "badge-dollar-sign",
      count: adeu.length,
      short: "Multas/adeudos",
      detail: lista(adeu),
      view: "cumplimiento",
    });
  return out;
}

// ── Montaje de controles ───────────────────────────────
function mountControls(): void {
  const search = $("cmp-search") as HTMLInputElement | null;
  if (search) {
    search.addEventListener("input", () => {
      if (searchDebounce) clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        filter.search = search.value;
        renderCumplimiento();
      }, 200);
    });
  }

  const selSuc = $("cmp-sucursal") as HTMLSelectElement | null;
  if (selSuc) {
    selSuc.addEventListener("change", () => {
      filter.sucursal = selSuc.value;
      renderCumplimiento();
    });
  }

  const selEstado = $("cmp-estado") as HTMLSelectElement | null;
  if (selEstado) {
    selEstado.addEventListener("change", () => {
      filter.estado = selEstado.value as CumplimientoEstadoFilter;
      renderCumplimiento();
    });
  }

  // Orden por encabezado (th[data-sort]).
  const table = $("cmp-table");
  if (table) {
    table.querySelectorAll<HTMLElement>("[data-sort]").forEach((th) => {
      th.style.cursor = "pointer";
      th.addEventListener("click", () => {
        const col = th.dataset.sort as CumplimientoSortCol | undefined;
        if (!col) return;
        if (sortCol === col) sortDir = sortDir === 1 ? -1 : 1;
        else {
          sortCol = col;
          sortDir = col === "eco" || col === "placa" || col === "sucursal" ? 1 : -1;
        }
        renderCumplimiento();
      });
    });
  }
}

// Exponer al HTML/cloudHydrate.
window.renderCumplimiento = renderCumplimiento;
window.updateCumplimientoNavBadge = updateCumplimientoNavBadge;
window.openComplianceDetail = openComplianceDetail;
window.renderComplianceTab = renderComplianceTab;
window.complianceAlerts = complianceAlerts;

// Montar listeners cuando el DOM esté listo.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountControls);
} else {
  mountControls();
}
