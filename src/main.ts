// main.ts — entry point Vite-served. Cargado por el legado via
// `<script type="module" src="/src/main.ts"></script>` (Vite lo resuelve en
// dev; para file:// no hace nada, el legado sigue usando su renderTable inline).
//
// Arquitectura:
//   1. `bindLegacyWindow()` espeja `window.units/selId/checklistDB/hasZip/zipImgs`
//      con el store `appStore`. Escrituras en cualquiera de los dos lados se
//      propagan. Esto permite coexistencia con el legado sin refactor grande.
//   2. Feature flags por funcionalidad. Default = OFF → comportamiento legado intacto.
//      - USE_NEW_RENDER: tabla Inspecciones via src/ui/renderTable
//      - USE_NEW_PDF:    exportPDF via src/pdf/unitReport
//      - USE_STORE:      log de cambios del store (debug)

// Cloud wire: configura Amplify Gen 2 SDK + expone window.__cloudSyncZip /
// __cloudLogin / __cloudFetchAll para que el HTML legado pueda sincronizar
// ZIP uploads a DynamoDB. Auth gating al boot — si no hay sesión, muestra
// modal bloqueante.
//
// Llamada explícita (no side-effect) — Vite producción tree-shakea
// side-effect-only imports cuando las assignments a window.* no son leídas
// desde otros módulos TS (el HTML legado inline las invoca pero el bundler
// no ve esos accesos).
import { setupCloud } from "./api/cloudWire";
setupCloud();

import { renderTable as renderTableNew } from "./ui/renderTable";
import { renderChecklist as renderChecklistNew } from "./ui/detail/renderChecklist";
import {
  renderNotes as renderNotesNew,
  type NotesDB,
  type NoteType,
} from "./ui/detail/renderNotes";
import { renderTires as renderTiresNew } from "./ui/detail/renderTires";
import { renderPhotoGallery, type ManualPhoto, type PhotoEntry } from "./ui/detail/photoGallery";
import { createLightbox, type LightboxApi } from "./ui/detail/lightbox";
import {
  renderActions as renderActionsNew,
  type ActionsDB,
  type ActionStatus,
} from "./ui/detail/renderActions";
import {
  renderService as renderServiceNew,
  type UnitSvc,
  type WeeklyPeriodo as WeeklyPeriodoSvc,
} from "./ui/detail/renderService";
import { buildUnitReport } from "./pdf/unitReport";
import { renderActivas as renderActivasNew } from "./taller/renderActivas";
import { renderActivasKpis as renderActivasKpisNew } from "./taller/renderActivasKpis";
import {
  renderHistorial as renderHistorialNew,
  type HistorialSortKey,
} from "./taller/renderHistorial";
import type { SortKey as TallerSortKey } from "./taller/tallerStore";
import type { TallerEntry } from "./taller/types";
import {
  renderTableSemanales as renderTableSemanalesNew,
  type WeeklyRiskFilter,
  type WeeklySortCol,
} from "./weekly/renderTableSemanales";
import { renderKpisSemanales as renderKpisSemanalesNew } from "./weekly/renderKpisSemanales";
import {
  renderPeriodoBar as renderPeriodoBarNew,
  renderWeeklyPeriodoBar as renderWeeklyPeriodoBarNew,
  type MonthlyPeriodo,
} from "./weekly/renderPeriodoBar";
import type { WeeklyPeriodo } from "./weekly/weeklyStore";
import { appStore, bindLegacyWindow } from "./state/appState";
import { type FilterState, onUrlStateChange, readUrlState, writeUrlState } from "./state/urlState";
import type { Unit, ChecklistDB } from "./types";

declare global {
  interface Window {
    units?: Unit[];
    selId?: string | null;
    checklistDB?: ChecklistDB;
    hasZip?: boolean;
    isUnitEnTaller?: (u: Unit) => boolean;
    parseSvcDate?: (s: string) => Date | null;
    selUnit?: (uid: string) => void;
    /** override del legado — si feature flag activa. */
    renderTable?: () => void;
    exportPDF?: () => void | Promise<void>;
    renderChecklist?: (u: Unit, body: HTMLElement) => void;
    renderNotes?: (u: Unit, body: HTMLElement) => void;
    renderActionsTab?: (u: Unit, body: HTMLElement) => void;
    renderService?: (u: Unit, body: HTMLElement) => void;
    renderPhotos?: (u: Unit, body: HTMLElement) => void;
    imgUrl?: (fname: string) => string | null;
    manualPhotoUrl?: (data: Uint8Array | string, cacheKey: string) => string;
    manualPhotosDB?: Record<string, ManualPhoto[]>;
    addManualPhoto?: (uid: string) => void;
    deleteManualPhoto?: (uid: string, photoId: string) => void;
    lazyObserver?: IntersectionObserver;
    __lightbox?: LightboxApi;
    toggleCheckItem?: (uid: string, text: string) => void;
    addNote?: (uid: string) => void;
    deleteNote?: (uid: string, noteId: string) => void;
    addAction?: (uid: string, findingText: string) => void;
    updateActionStatus?: (uid: string, actionId: string, newStatus: string) => void;
    deleteAction?: (uid: string, actionId: string) => void;
    notesDB?: NotesDB;
    actionsDB?: ActionsDB;
    saveNotes?: (uid: string) => Promise<void>;
    saveActions?: (uid: string) => Promise<void>;
    renderDet?: () => void;
    filt?: () => Unit[];
    /** toast helpers expuestos por el legado — usados por módulos TS. */
    notify?: (msg: string, kind?: string, ms?: number) => void;
    notifyUndo?: (msg: string, onCommit: () => void, ms?: number, onUndo?: () => void) => void;
    runSafe?: <T>(label: string, fn: () => T | Promise<T>) => Promise<T | undefined>;
    __rawAlert?: typeof window.alert;
    /** flag interno para detectar si el module-script se cargó. */
    __newRenderAvailable?: boolean;
    /** store expuesto en dev para inspección via devtools. */
    __appStore?: typeof appStore;
    /** sync manual de URL state desde el legado. */
    __syncUrlState?: (patch: Partial<FilterState>) => void;
    /** setters del legado — usados por el sync de URL state. */
    setTab?: (id: string) => void;
    setF?: (id: string) => void;
    setBranch?: (id: string) => void;
    setSearch?: (q: string) => void;
    setPeriodo?: (p: string) => void;
    /** Taller legacy state + callbacks — leídos por el shim. */
    tallerEntries?: TallerEntry[];
    tlSubView?: "activas" | "historial";
    tlSortCol?: string | null;
    tlSortDir?: 1 | -1;
    tlSort?: (col: string) => void;
    tlSortByUrgencia?: () => void;
    openTallerModal?: (id?: string) => void;
    finalizarUnidad?: (id: string) => void;
    openHistorialModal?: (unitKey: string) => void;
    renderTaller?: () => void;
    renderActivas?: () => void;
    renderHistorial?: () => void;
    reingresoDesdeHistorial?: (unitKey: string) => void;
    refreshIcons?: () => void;
    /** Weekly (Semanales) legacy state + callbacks — leídos por el shim. */
    weeklyPeriodos?: WeeklyPeriodo[];
    activeWeeklyPeriodoId?: string | null;
    weeklyHasZip?: boolean;
    swCurF?: WeeklyRiskFilter;
    swSortCol?: WeeklySortCol;
    swSortDir?: 1 | -1;
    swSort?: (col: WeeklySortCol) => void;
    swSetF?: (bucket: WeeklyRiskFilter) => void;
    switchWeeklyPeriodo?: (id: string) => void;
    deleteWeeklyPeriodo?: (id: string) => void;
    openSwPhotos?: (uid: string) => void;
    enviarATallerDesdeInspeccion?: (uid: string) => void;
    renderSemanales?: () => void;
    renderTableSemanales?: () => void;
    buildKPIsSemanales?: () => void;
    renderWeeklyPeriodoBar?: () => void;
    /** Monthly período bar legacy state + callbacks. */
    periodos?: MonthlyPeriodo[];
    activePeriodoId?: string | null;
    switchPeriodo?: (id: string) => void;
    deletePeriodo?: (id: string) => void;
    renderPeriodoBar?: () => void;
    /** Dashboard charts — ECharts wrappers. */
    renderDonutChart?: (
      el: HTMLElement,
      segments: import("./dashboard/charts").DonutSegment[],
      handlers?: { onSegmentClick?: (key: string) => void },
    ) => unknown;
    renderBranchesChart?: (
      el: HTMLElement,
      data: import("./dashboard/charts").BranchStat[],
      handlers?: { onBranchClick?: (branch: string) => void },
    ) => unknown;
    renderCategoriesChart?: (
      el: HTMLElement,
      data: import("./dashboard/charts").CategoryStat[],
    ) => unknown;
    renderTrendChart?: (
      el: HTMLElement,
      data: import("./dashboard/charts").PeriodTrend[],
    ) => unknown;
    renderTallerHeatmapChart?: (
      el: HTMLElement,
      data: import("./dashboard/charts").DayCount[],
    ) => unknown;
    renderKmScatterChart?: (
      el: HTMLElement,
      data: import("./dashboard/charts").KmScatterPoint[],
    ) => unknown;
  }
}

window.__newRenderAvailable = true;
window.__appStore = appStore;

// Expose ECharts-backed dashboard widgets al legacy (buildKPIs / buildAnalytics).
import("./dashboard/charts").then(
  ({
    renderDonut,
    renderBranchesBar,
    renderCategoriesBar,
    renderTrendLine,
    renderTallerHeatmap,
    renderKmScatter,
  }) => {
    window.renderDonutChart = renderDonut;
    window.renderBranchesChart = renderBranchesBar;
    window.renderCategoriesChart = renderCategoriesBar;
    window.renderTrendChart = renderTrendLine;
    window.renderTallerHeatmapChart = renderTallerHeatmap;
    window.renderKmScatterChart = renderKmScatter;
  },
);

// Bridge bidireccional window.* ↔ appStore. Siempre activo para que los
// módulos nuevos puedan leer del store, y el legado siga escribiendo como
// siempre a window.*.
bindLegacyWindow();

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/**
 * Type guard mínimo para arrays de Unit leídos desde window.*.
 * No valida shape completo (overhead alto en flotillas grandes); solo verifica
 * que es array y que el primer elemento tiene los campos críticos. Si el legado
 * corrompe la estructura, devolvemos array vacío + warning en lugar de propagar
 * datos malformados aguas abajo.
 */
function safeUnitArray(value: unknown, label: string): Unit[] {
  if (!Array.isArray(value)) {
    if (value !== undefined && value !== null) {
      console.warn(`[main] ${label}: esperado Unit[], recibido`, typeof value);
    }
    return [];
  }
  if (value.length === 0) return value as Unit[];
  const first = value[0] as Partial<Unit> | undefined;
  if (!first || typeof first !== "object" || typeof first.uid !== "string") {
    console.warn(`[main] ${label}: shape de Unit inválido en [0]`, first);
    return [];
  }
  return value as Unit[];
}

// ─── Feature flag: render-table (P2.2c) ────────────────────────────────
if (readFlag("USE_NEW_RENDER")) {
  const legacyRenderTable = window.renderTable;

  window.renderTable = function renderTableShim() {
    const tbody = document.getElementById("tbody");
    if (!tbody) return;
    // Leer via window.* fuerza al bridge legado (getter HTML) a sincronizar el store.
    const allUnits = safeUnitArray(window.units, "window.units (renderTable)");
    let rows: Unit[];
    if (window.filt) {
      try {
        const r = window.filt();
        rows = safeUnitArray(r, "window.filt() result");
        if (rows.length === 0 && allUnits.length > 0) rows = allUnits;
      } catch (err) {
        console.warn("[renderTable] window.filt() lanzó, fallback a allUnits:", err);
        rows = allUnits;
      }
    } else {
      rows = allUnits;
    }
    const totalUnits = allUnits.length;
    const rcnt = document.getElementById("rcnt");
    if (rcnt) rcnt.textContent = `${rows.length}/${totalUnits}`;
    try {
      renderTableNew(tbody, {
        units: rows,
        selectedUid: appStore.get("selectedUid"),
        checklistDB: (window.checklistDB ?? appStore.get("checklistDB")) as ChecklistDB,
        hasZip: (window.hasZip ?? appStore.get("hasZip")) as boolean,
        isUnitEnTaller: window.isUnitEnTaller,
        parseSvcDate: window.parseSvcDate,
        onSelect: window.selUnit,
      });
    } catch (err) {
      console.error("[renderTable/new] falló, fallback a legado:", err);
      if (legacyRenderTable) legacyRenderTable.call(window);
    }
  };

  console.info(
    "[control-flotilla] USE_NEW_RENDER activo — tabla Inspecciones usa src/ui/renderTable.ts. " +
      "Desactiva con: localStorage.removeItem('USE_NEW_RENDER')",
  );
}

// ─── Feature flag: PDF export (P2.2d) ──────────────────────────────────
if (readFlag("USE_NEW_PDF")) {
  const legacyExportPDF = window.exportPDF;

  window.exportPDF = async function exportPDFShim() {
    // Leer via window.* fuerza al bridge legado (getter closure) a sincronizar
    // el store. appStore.get() directo puede estar stale si el legado mutó la
    // closure sin que nadie haya leído window.* desde entonces.
    const units = safeUnitArray(window.units ?? appStore.get("units"), "exportPDF units");
    const selId = (window.selId ?? appStore.get("selectedUid")) as string | null;
    const unit = units.find((u) => u.uid === selId);
    if (!unit) {
      alert("Selecciona una unidad primero.");
      return;
    }
    try {
      const doc = buildUnitReport(unit, {
        checklistDB: (window.checklistDB ?? appStore.get("checklistDB")) as ChecklistDB,
        generatedAt: new Date(),
      });
      const filename = `reporte_${unit.eco || unit.plate || unit.uid}_${new Date().toISOString().slice(0, 10)}.pdf`;
      doc.save(filename);
    } catch (err) {
      console.error("[exportPDF/new] falló, fallback a legado:", err);
      if (legacyExportPDF) await legacyExportPDF.call(window);
    }
  };

  console.info(
    "[control-flotilla] USE_NEW_PDF activo — exportPDF usa src/pdf/unitReport.ts. " +
      "Desactiva con: localStorage.removeItem('USE_NEW_PDF')",
  );
}

// ─── Feature flag: panel detalle Checklist (P4 fase 2) ────────────────
if (readFlag("USE_NEW_DETAIL")) {
  const legacyRenderChecklist = window.renderChecklist;

  window.renderChecklist = function renderChecklistShim(u: Unit, body: HTMLElement) {
    try {
      renderChecklistNew(body, {
        unit: u,
        checklistDB: appStore.get("checklistDB"),
        onToggle: window.toggleCheckItem,
      });
    } catch (err) {
      console.error("[renderChecklist/new] falló, fallback a legado:", err);
      if (legacyRenderChecklist) legacyRenderChecklist(u, body);
    }
  };

  const legacyRenderNotes = window.renderNotes;
  window.renderNotes = function renderNotesShim(u: Unit, body: HTMLElement) {
    try {
      renderNotesNew(body, {
        unit: u,
        notesDB: window.notesDB,
        onAdd: (uid, text, type) => {
          // Emula la lógica de addNote() del legado: inserta + persiste + re-render
          const db = window.notesDB ?? {};
          if (!db[uid]) db[uid] = [];
          db[uid].push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            text,
            type: type as NoteType,
            ts: new Date().toISOString(),
          });
          window.notesDB = db;
          window.saveNotes?.(uid).then(() => window.renderDet?.());
        },
        onDelete: (uid, noteId) => {
          const db = window.notesDB ?? {};
          if (!db[uid]) return;
          db[uid] = db[uid].filter((n) => n.id !== noteId);
          window.notesDB = db;
          window.saveNotes?.(uid).then(() => window.renderDet?.());
        },
      });
    } catch (err) {
      console.error("[renderNotes/new] falló, fallback a legado:", err);
      if (legacyRenderNotes) legacyRenderNotes(u, body);
    }
  };

  const legacyRenderActions = window.renderActionsTab;
  window.renderActionsTab = function renderActionsShim(u: Unit, body: HTMLElement) {
    try {
      renderActionsNew(body, {
        unit: u,
        actionsDB: window.actionsDB,
        onAdd: (uid) => window.addAction?.(uid, ""),
        onUpdateStatus: (uid, actionId, newStatus) =>
          window.updateActionStatus?.(uid, actionId, newStatus as ActionStatus),
        onDelete: (uid, actionId) => window.deleteAction?.(uid, actionId),
      });
    } catch (err) {
      console.error("[renderActionsTab/new] falló, fallback a legado:", err);
      if (legacyRenderActions) legacyRenderActions(u, body);
    }
  };

  // ── Lightbox singleton (compartido) ─────────────────────────
  // Usa el imgUrl del legado para lazy-resolve de fotos del ZIP.
  const lightbox = createLightbox({
    resolveUrl: (fname) => window.imgUrl?.(fname) ?? null,
  });
  window.__lightbox = lightbox;

  const legacyRenderPhotos = window.renderPhotos;
  window.renderPhotos = function renderPhotosShim(u: Unit, body: HTMLElement) {
    try {
      const manualPhotos = (window.manualPhotosDB?.[u.uid] ?? []) as ManualPhoto[];
      renderPhotoGallery(body, {
        unit: u as Unit & { photos?: PhotoEntry[] },
        manualPhotos,
        hasZip: Boolean(appStore.get("hasZip")),
        lightbox,
        resolveZipUrl: (fname) => window.imgUrl?.(fname) ?? null,
        resolveManualUrl: (p) => (window.manualPhotoUrl ? window.manualPhotoUrl(p.data, p.id) : ""),
        lazyObserver: window.lazyObserver,
        onAddManualPhoto: (uid) => window.addManualPhoto?.(uid),
        onDeleteManualPhoto: (uid, pid) => window.deleteManualPhoto?.(uid, pid),
      });
    } catch (err) {
      console.error("[renderPhotos/new] falló, fallback a legado:", err);
      if (legacyRenderPhotos) legacyRenderPhotos(u, body);
    }
  };

  const legacyRenderService = window.renderService;
  window.renderService = function renderServiceShim(u: Unit, body: HTMLElement) {
    try {
      const wp = window.weeklyPeriodos;
      const weeklyPeriodos = Array.isArray(wp) ? (wp as unknown as WeeklyPeriodoSvc[]) : [];
      renderServiceNew(body, {
        unit: u as UnitSvc,
        weeklyPeriodos,
      });
    } catch (err) {
      console.error("[renderService/new] falló, fallback a legado:", err);
      if (legacyRenderService) legacyRenderService(u, body);
    }
  };

  // Tires NO es función separada en legado — es inline en renderDetBody.
  // Exponemos como función por si se quiere wire directo. El legado switch
  // sigue usando su inline render; para activar el nuestro requiere refactor
  // del renderDetBody (futuro — por ahora renderTires está listo para usar).
  (window as unknown as { renderTires?: (u: Unit, body: HTMLElement) => void }).renderTires =
    function (u: Unit, body: HTMLElement) {
      renderTiresNew(body, { unit: u });
    };

  console.info(
    "[control-flotilla] USE_NEW_DETAIL activo — sub-tabs Checklist + Notas + Acciones + Tires + Fotos + Servicio usan src/ui/detail/. " +
      "Lightbox global en window.__lightbox. Desactiva con: localStorage.removeItem('USE_NEW_DETAIL')",
  );
}

// ─── Feature flag: Taller Activas + Historial (P4 fase 3) ────────────
if (readFlag("USE_NEW_TALLER")) {
  const legacyRenderActivas = window.renderActivas;
  const legacyRenderHistorial = window.renderHistorial;
  const SORT_KEYS: Set<string> = new Set([
    "fentrada",
    "dias",
    "gasto",
    "eco",
    "estado",
    "sucursal",
  ]);
  const HIST_SORT_KEYS: Set<string> = new Set([
    "eco",
    "plate",
    "brand",
    "sucursal",
    "fentrada",
    "fsalidaReal",
  ]);

  function readFilterFromDom(): {
    sucursal?: string;
    area?: string;
    tipo?: string;
    search?: string;
  } {
    const g = (id: string): string =>
      (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "all";
    return {
      sucursal: g("tl-filt-suc"),
      area: g("tl-filt-area"),
      tipo: g("tl-filt-tipo"),
      search:
        (document.getElementById("tl-filt-q") as HTMLInputElement | null)?.value?.trim() ?? "",
    };
  }

  function readHistFilterFromDom(): {
    sucursal?: string;
    tipo?: string;
    search?: string;
    desde?: string;
    hasta?: string;
  } {
    const g = (id: string): string =>
      (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
    return {
      sucursal: g("tl-hist-suc") || "all",
      tipo: g("tl-hist-tipo") || "all",
      search:
        (document.getElementById("tl-hist-q") as HTMLInputElement | null)?.value?.trim() ?? "",
      desde: g("tl-hist-desde"),
      hasta: g("tl-hist-hasta"),
    };
  }

  function populateHistSucursalSelect(entries: TallerEntry[]): void {
    const sel = document.getElementById("tl-hist-suc") as HTMLSelectElement | null;
    if (!sel || sel.options.length > 1) return;
    const current = sel.value || "all";
    const sucs = [
      ...new Set(entries.map((e) => e.sucursal).filter((s): s is string => !!s)),
    ].sort();
    sel.replaceChildren();
    const optAll = document.createElement("option");
    optAll.value = "all";
    optAll.textContent = "Todas las sucursales";
    sel.appendChild(optAll);
    for (const s of sucs) {
      const o = document.createElement("option");
      o.value = s;
      o.textContent = s;
      if (s === current) o.selected = true;
      sel.appendChild(o);
    }
  }

  window.renderActivas = function renderActivasShim() {
    // Solo corremos cuando la sub-vista activa es "activas"; historial tiene su propio shim.
    if (window.tlSubView && window.tlSubView !== "activas") {
      legacyRenderActivas?.();
      return;
    }
    const tbody = document.getElementById("tl-tbody");
    const thead = document.querySelector("#tl-thead tr") as HTMLElement | null;
    const rcnt = document.getElementById("tl-rcnt");
    if (!tbody) {
      legacyRenderActivas?.();
      return;
    }
    try {
      const entries = window.tallerEntries ?? [];
      const filter = readFilterFromDom();
      const rawSort = window.tlSortCol ?? null;
      const sortCol = rawSort && SORT_KEYS.has(rawSort) ? (rawSort as TallerSortKey) : null;

      // KPI bar + donut + alert strip
      const kpis = document.getElementById("tl-kpis");
      if (kpis) {
        renderActivasKpisNew(kpis, {
          entries,
          filter,
          onFilterTipo: (tipo) => {
            const sel = document.getElementById("tl-filt-tipo") as HTMLSelectElement | null;
            if (sel) sel.value = tipo;
            window.renderTaller?.();
          },
          onSortUrgencia: () => window.tlSortByUrgencia?.(),
        });
        window.refreshIcons?.();
      }

      renderActivasNew(tbody, thead, rcnt, {
        entries,
        filter,
        sortCol,
        sortDir: window.tlSortDir ?? -1,
        onOpen: (id) => window.openTallerModal?.(id),
        onFinalize: (id) => window.finalizarUnidad?.(id),
        onOpenHist: (key) => window.openHistorialModal?.(key),
        onSort: (col) => window.tlSort?.(col),
      });
    } catch (err) {
      console.error("[renderActivas/new] falló, fallback a legado:", err);
      legacyRenderActivas?.();
    }
  };

  window.renderHistorial = function renderHistorialShim() {
    const tbody = document.getElementById("tl-tbody");
    const thead = document.querySelector("#tl-thead tr") as HTMLElement | null;
    const rcnt = document.getElementById("tl-hist-rcnt");
    const kpiBar = document.getElementById("hist-kpi-bar");
    if (!tbody) {
      legacyRenderHistorial?.();
      return;
    }
    try {
      const entries = window.tallerEntries ?? [];
      populateHistSucursalSelect(entries);
      const rawSort = window.tlSortCol ?? null;
      const sortCol = rawSort && HIST_SORT_KEYS.has(rawSort) ? (rawSort as HistorialSortKey) : null;
      renderHistorialNew(tbody, thead, rcnt, {
        entries,
        filter: readHistFilterFromDom(),
        sortCol,
        sortDir: window.tlSortDir ?? -1,
        kpiBar,
        onOpen: (key) => window.openHistorialModal?.(key),
        onReingreso: (key) => window.reingresoDesdeHistorial?.(key),
        onSort: (col) => window.tlSort?.(col),
      });
    } catch (err) {
      console.error("[renderHistorial/new] falló, fallback a legado:", err);
      legacyRenderHistorial?.();
    }
  };

  console.info(
    "[control-flotilla] USE_NEW_TALLER activo — Activas e Historial usan src/taller/*.ts. " +
      "Desactiva con: localStorage.removeItem('USE_NEW_TALLER')",
  );
}

// ─── Feature flag: Semanales + Períodos (P4 fase 4) ──────────────────
if (readFlag("USE_NEW_WEEKLY")) {
  const legacyRenderTableSemanales = window.renderTableSemanales;
  const legacyBuildKPIsSemanales = window.buildKPIsSemanales;
  const legacyRenderWeeklyPeriodoBar = window.renderWeeklyPeriodoBar;
  const legacyRenderPeriodoBar = window.renderPeriodoBar;

  const WEEKLY_SORT_KEYS: Set<string> = new Set([
    "_idx",
    "eco",
    "plate",
    "km",
    "branch",
    "aceiteRisk",
    "radiadorRisk",
    "carroceriaRisk",
    "llantaRisk",
    "risk",
    "responsable",
    "fecha",
  ]);

  function activeWeeklyPeriodo(): WeeklyPeriodo | undefined {
    const list = window.weeklyPeriodos ?? [];
    const id = window.activeWeeklyPeriodoId;
    return list.find((p) => p.id === id);
  }

  window.renderTableSemanales = function renderTableSemanalesShim() {
    const tbody = document.getElementById("sw-tbody");
    if (!tbody) {
      legacyRenderTableSemanales?.();
      return;
    }
    try {
      const rawSort = window.swSortCol ?? "risk";
      const sortCol = (WEEKLY_SORT_KEYS.has(rawSort) ? rawSort : "risk") as WeeklySortCol;
      const searchEl = document.getElementById("sw-srch") as HTMLInputElement | null;
      renderTableSemanalesNew({
        tbody,
        theadRow: document.getElementById("sw-thead-row"),
        table: document.getElementById("sw-table"),
        empty: document.getElementById("sw-empty"),
        rcnt: document.getElementById("sw-rcnt"),
        selSuc: document.getElementById("sw-filt-suc") as HTMLSelectElement | null,
        periodo: activeWeeklyPeriodo(),
        filter: {
          riskFilter: window.swCurF ?? "all",
          sucursal:
            (document.getElementById("sw-filt-suc") as HTMLSelectElement | null)?.value ?? "all",
          search: searchEl?.value?.trim() ?? "",
        },
        sortCol,
        sortDir: window.swSortDir ?? -1,
        hasZipPhotos: Boolean(window.weeklyHasZip),
        onPhotos: (uid) => window.openSwPhotos?.(uid),
        onEnviarATaller: (uid) => window.enviarATallerDesdeInspeccion?.(uid),
        onSort: (col) => window.swSort?.(col),
      });
      window.refreshIcons?.();
    } catch (err) {
      console.error("[renderTableSemanales/new] falló, fallback a legado:", err);
      legacyRenderTableSemanales?.();
    }
  };

  window.buildKPIsSemanales = function buildKPIsSemanalesShim() {
    const container = document.getElementById("sw-kpis");
    if (!container) {
      legacyBuildKPIsSemanales?.();
      return;
    }
    try {
      renderKpisSemanalesNew({
        container,
        periodo: activeWeeklyPeriodo(),
        onFilter: (bucket) => window.swSetF?.(bucket),
      });
      window.refreshIcons?.();
    } catch (err) {
      console.error("[buildKPIsSemanales/new] falló, fallback a legado:", err);
      legacyBuildKPIsSemanales?.();
    }
  };

  window.renderWeeklyPeriodoBar = function renderWeeklyPeriodoBarShim() {
    const chips = document.getElementById("sw-periodo-chips");
    if (!chips) {
      legacyRenderWeeklyPeriodoBar?.();
      return;
    }
    try {
      renderWeeklyPeriodoBarNew({
        chips,
        periodos: window.weeklyPeriodos ?? [],
        activeId: window.activeWeeklyPeriodoId ?? null,
        onSwitch: (id) => window.switchWeeklyPeriodo?.(id),
        onDelete: (id) => window.deleteWeeklyPeriodo?.(id),
      });
      window.refreshIcons?.();
    } catch (err) {
      console.error("[renderWeeklyPeriodoBar/new] falló, fallback a legado:", err);
      legacyRenderWeeklyPeriodoBar?.();
    }
  };

  window.renderPeriodoBar = function renderPeriodoBarShim() {
    const bar = document.getElementById("periodo-bar");
    const chips = document.getElementById("periodo-chips");
    if (!bar || !chips) {
      legacyRenderPeriodoBar?.();
      return;
    }
    try {
      renderPeriodoBarNew({
        bar,
        chips,
        btnTendencias: document.getElementById("btn-tendencias"),
        periodos: window.periodos ?? [],
        activeId: window.activePeriodoId ?? null,
        onSwitch: (id) => window.switchPeriodo?.(id),
        onDelete: (id) => window.deletePeriodo?.(id),
      });
      window.refreshIcons?.();
    } catch (err) {
      console.error("[renderPeriodoBar/new] falló, fallback a legado:", err);
      legacyRenderPeriodoBar?.();
    }
  };

  console.info(
    "[control-flotilla] USE_NEW_WEEKLY activo — Semanales (tabla, KPIs, chips) + Períodos mensuales usan src/weekly/*.ts. " +
      "Desactiva con: localStorage.removeItem('USE_NEW_WEEKLY')",
  );
}

// ─── Debug flag: log cambios del store ─────────────────────────────────
if (readFlag("USE_STORE_LOG")) {
  appStore.subscribe((state, prev) => {
    const changed = (Object.keys(state) as Array<keyof typeof state>).filter(
      (k) => state[k] !== prev[k],
    );
    console.info("[appStore] change:", changed, { next: state, prev });
  });
  console.info("[control-flotilla] USE_STORE_LOG activo — cambios impresos en console.");
}

// ─── Feature flag: URL deep-linking (P3.2) ─────────────────────────────
if (readFlag("USE_URL_STATE")) {
  /**
   * Aplica state de URL → setters del legado. Si un setter no existe (tab
   * recién cargada sin UI), simplemente se ignora esa clave.
   */
  function applyToLegacy(s: FilterState): void {
    if (s.tab && window.setTab) window.setTab(s.tab);
    if (s.filter && window.setF) window.setF(s.filter);
    if (s.branch && window.setBranch) window.setBranch(s.branch);
    if (s.search !== undefined && window.setSearch) window.setSearch(s.search);
    if (s.unit && window.selUnit) window.selUnit(s.unit);
    if (s.periodo && window.setPeriodo) window.setPeriodo(s.periodo);
  }

  // Al cargar: lee la URL y aplica filtros al legado (si los setters están listos)
  const initialState = readUrlState();
  // Delay mínimo para que el legado defina setTab/setF/etc.
  if (Object.keys(initialState).length > 0) {
    queueMicrotask(() => applyToLegacy(initialState));
  }

  // Popstate (back/forward): re-aplica
  onUrlStateChange(applyToLegacy);

  // Helper expuesto: el legado puede llamar window.__syncUrlState({...}) cuando
  // cambia un filtro para que la URL lo refleje.
  window.__syncUrlState = (patch) => writeUrlState(patch);

  console.info(
    "[control-flotilla] USE_URL_STATE activo — filtros sincronizan con URL. " +
      "Usa window.__syncUrlState({tab, filter, branch, search}) para escribir.",
  );
}
