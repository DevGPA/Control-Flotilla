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

import { renderTable as renderTableNew } from "./ui/renderTable";
import { renderChecklist as renderChecklistNew } from "./ui/detail/renderChecklist";
import { renderNotes as renderNotesNew, type NotesDB, type NoteType } from "./ui/detail/renderNotes";
import { buildUnitReport } from "./pdf/unitReport";
import { appStore, bindLegacyWindow } from "./state/appState";
import {
  type FilterState,
  onUrlStateChange,
  readUrlState,
  writeUrlState,
} from "./state/urlState";
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
    toggleCheckItem?: (uid: string, text: string) => void;
    addNote?: (uid: string) => void;
    deleteNote?: (uid: string, noteId: string) => void;
    notesDB?: NotesDB;
    saveNotes?: (uid: string) => Promise<void>;
    renderDet?: () => void;
    filt?: () => Unit[];
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
  }
}

window.__newRenderAvailable = true;
window.__appStore = appStore;

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

// ─── Feature flag: render-table (P2.2c) ────────────────────────────────
if (readFlag("USE_NEW_RENDER")) {
  const legacyRenderTable = window.renderTable;

  window.renderTable = function renderTableShim() {
    const tbody = document.getElementById("tbody");
    if (!tbody) return;
    // window.filt() es el filtro legado; si no existe, usa units del store.
    const rows = window.filt ? window.filt() : appStore.get("units");
    const totalUnits = appStore.get("units").length;
    const rcnt = document.getElementById("rcnt");
    if (rcnt) rcnt.textContent = `${rows.length}/${totalUnits}`;
    try {
      renderTableNew(tbody, {
        units: rows,
        selectedUid: appStore.get("selectedUid"),
        checklistDB: appStore.get("checklistDB"),
        hasZip: appStore.get("hasZip"),
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
    const units = appStore.get("units");
    const selId = appStore.get("selectedUid");
    const unit = units.find((u) => u.uid === selId);
    if (!unit) {
      alert("Selecciona una unidad primero.");
      return;
    }
    try {
      const doc = buildUnitReport(unit, {
        checklistDB: appStore.get("checklistDB"),
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

  console.info(
    "[control-flotilla] USE_NEW_DETAIL activo — sub-tabs Checklist + Notas usan src/ui/detail/. " +
      "Desactiva con: localStorage.removeItem('USE_NEW_DETAIL')",
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
