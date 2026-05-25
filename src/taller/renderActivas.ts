// renderActivas — tab "Operaciones Activas" del módulo Taller.
// Reemplaza la parte tabla + encabezados + contador de `renderActivas()` del
// legado (línea ~4670). KPI bar + donut + alert strip quedan en el legado
// hasta migración posterior (ver ROADMAP P4 Fase 3).
//
// DOM-API puro (sin innerHTML con input de usuario). Lógica de negocio
// delegada a tallerStore (filtrado, ordenamiento, días). El llamador
// provee callbacks para abrir modal, finalizar, abrir historial, sort.

import {
  diasEnTaller,
  filterActivas,
  groupByUnit,
  isClosed,
  matchesSearch,
  type SortKey,
} from "./tallerStore";
import type { TallerEntry, TallerFilter } from "./types";

export type RenderActivasDeps = {
  /** Todas las entradas del taller (activas + cerradas). */
  entries: TallerEntry[];
  /** Filtros opcionales (sucursal/area/tipo/search). */
  filter?: TallerFilter;
  /** Columna de ordenamiento activa. `null` = orden default por urgencia. */
  sortCol?: SortKey | null;
  /** 1 asc, -1 desc. */
  sortDir?: 1 | -1;
  /** Fecha de referencia para días en taller (inyectable para tests). */
  today?: Date;
  /** Callback al click en una fila (abrir modal edit). */
  onOpen?: (id: string) => void;
  /** Callback al click en "✓ Salida". */
  onFinalize?: (id: string) => void;
  /** Callback al click en "🗑 Borrar". */
  onDelete?: (id: string) => void;
  /** Callback al click en badge de historial (>1 visita). */
  onOpenHist?: (unitKey: string) => void;
  /** Callback al click en un header sorteable. */
  onSort?: (col: SortKey) => void;
};

export type ActivasSummary = {
  /** Filas visibles después de filtros. */
  visibles: number;
  /** Total de unidades activas (sin filtrar). */
  totalActivas: number;
  /** Unidades con >7 días de estancia. */
  urgentes: number;
};

const COLS: Array<{ lbl: string; key: SortKey | null }> = [
  { lbl: "No. Unidad", key: "eco" },
  { lbl: "Placas", key: null }, // plate no está en SortKey pero sí se usa — ver nota abajo
  { lbl: "Sucursal", key: "sucursal" },
  { lbl: "Área", key: null },
  { lbl: "Tipo", key: null },
  { lbl: "F. Entrada", key: "fentrada" },
  { lbl: "Días", key: "dias" },
  { lbl: "F. Salida Est.", key: null },
  { lbl: "Técnico", key: null },
  { lbl: "Observaciones", key: null },
  { lbl: "", key: null },
];

function fmtDate(d?: string): string {
  if (!d) return "—";
  // "YYYY-MM-DD..." → "DD/MM/YYYY"
  const parts = d.slice(0, 10).split("-");
  if (parts.length !== 3) return d;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/** Latest-per-unit con conteo total de visitas. */
export function latestActivasPerUnit(
  entries: TallerEntry[],
): { latest: TallerEntry; key: string; count: number }[] {
  const groups = groupByUnit(entries);
  const out: { latest: TallerEntry; key: string; count: number }[] = [];
  for (const [key, arr] of groups.entries()) {
    // arr ya está ordenado desc por fentrada; la "latest" real usa updatedAt
    // (más preciso: reorden por updatedAt). Parseamos a timestamp para evitar
    // dependencia del formato exacto del string ISO.
    const ts = (s?: string): number => {
      if (!s) return 0;
      const t = Date.parse(s);
      return Number.isFinite(t) ? t : 0;
    };
    const latest = arr.reduce((a, b) => (ts(b.updatedAt) > ts(a.updatedAt) ? b : a));
    if (isClosed(latest)) continue;
    out.push({ latest, key, count: arr.length });
  }
  return out;
}

/** Aplica filtros sobre el latest y ordena. */
function filterAndSort(
  latestList: { latest: TallerEntry; key: string; count: number }[],
  filter: TallerFilter,
  sortCol: SortKey | null,
  sortDir: 1 | -1,
  today: Date,
): { latest: TallerEntry; key: string; count: number }[] {
  const filtered = latestList.filter(({ latest: e }) => {
    if (filter.sucursal && filter.sucursal !== "all" && e.sucursal !== filter.sucursal) return false;
    if (filter.area && filter.area !== "all" && e.area !== filter.area) return false;
    if (filter.tipo && filter.tipo !== "all" && e.tipo !== filter.tipo) return false;
    if (filter.search && !matchesSearch(e, filter.search)) return false;
    return true;
  });

  return filtered.sort((a, b) => {
    if (sortCol) {
      const vA = sortCol === "dias" ? (diasEnTaller(a.latest, today) ?? -1) : String(a.latest[sortCol as keyof TallerEntry] ?? "");
      const vB = sortCol === "dias" ? (diasEnTaller(b.latest, today) ?? -1) : String(b.latest[sortCol as keyof TallerEntry] ?? "");
      if (typeof vA === "number" && typeof vB === "number") {
        if (vA !== vB) return (vA - vB) * sortDir;
      } else {
        const cmp = String(vA).localeCompare(String(vB), undefined, { numeric: true, sensitivity: "base" });
        if (cmp !== 0) return cmp * sortDir;
      }
    }
    // Tie-break: días desc (sin fecha al final)
    const dA = diasEnTaller(a.latest, today) ?? -999;
    const dB = diasEnTaller(b.latest, today) ?? -999;
    return dB - dA;
  });
}

function diasColorScheme(dias: number): { color: string; bg: string } {
  if (dias > 7) return { color: "var(--R)", bg: "var(--Rd)" };
  if (dias > 3) return { color: "var(--A)", bg: "var(--Ad)" };
  return { color: "var(--G)", bg: "var(--Gd)" };
}

function rowBgStyle(dias: number | null): string {
  if (dias == null) return "";
  if (dias > 7) return "background:var(--Rd)";
  if (dias > 3) return "background:var(--Ad)";
  return "";
}

function buildThead(
  thead: HTMLElement,
  sortCol: SortKey | null,
  sortDir: 1 | -1,
  onSort?: (col: SortKey) => void,
): void {
  const tr = document.createElement("tr");
  for (const c of COLS) {
    const th = document.createElement("th");
    th.textContent = c.lbl;
    if (c.key && onSort) {
      th.style.cssText = "cursor:pointer;user-select:none";
      if (sortCol === c.key) th.style.color = "var(--ac)";
      const arrow = sortCol === c.key ? (sortDir === 1 ? " ▲" : " ▼") : "";
      if (arrow) th.textContent = c.lbl + arrow;
      const key = c.key;
      th.addEventListener("click", () => onSort(key));
    }
    tr.appendChild(th);
  }
  thead.replaceChildren(tr);
}

function buildRow(
  item: { latest: TallerEntry; key: string; count: number },
  today: Date,
  onOpen?: (id: string) => void,
  onFinalize?: (id: string) => void,
  onOpenHist?: (unitKey: string) => void,
  onDelete?: (id: string) => void,
): HTMLElement {
  const e = item.latest;
  const dias = diasEnTaller(e, today);
  const tr = document.createElement("tr");
  tr.style.cssText = `${rowBgStyle(dias)};cursor:pointer`;
  tr.title = "Clic para editar";
  if (onOpen) tr.addEventListener("click", () => onOpen(e.id));

  // No. Unidad + hist badge
  // Lookup economicoId desde window.units por placa (cloud-hydrated MoreApp Excel).
  // Fallback al campo `eco` del entry (lo que el user tipeó en el form).
  const tdEco = document.createElement("td");
  tdEco.style.cssText = "font-weight:700;color:var(--w1)";
  const winUnits = (window as { units?: Array<{ plate?: string; eco?: string }> }).units ?? [];
  const matchUnit = winUnits.find((u) => u.plate && e.plate && u.plate === e.plate);
  const displayEco = matchUnit?.eco || e.eco || "—";
  tdEco.textContent = displayEco;
  if (item.count > 1) {
    const badge = document.createElement("span");
    badge.className = "tl-hist-badge";
    badge.title = `${item.count} ingresos previos`;
    badge.textContent = `${item.count}×`;
    badge.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onOpenHist?.(item.key);
    });
    tdEco.appendChild(badge);
  }
  tr.appendChild(tdEco);

  // Placas
  const tdPlate = document.createElement("td");
  tdPlate.style.cssText = "font-weight:600;color:var(--ac)";
  tdPlate.textContent = e.plate || "—";
  tr.appendChild(tdPlate);

  // Sucursal
  const tdSuc = document.createElement("td");
  tdSuc.style.cssText = "font-size:10px;color:var(--s2)";
  tdSuc.textContent = e.sucursal || "—";
  tr.appendChild(tdSuc);

  // Área
  const tdArea = document.createElement("td");
  tdArea.style.cssText = "font-size:10px;color:var(--s2)";
  tdArea.textContent = e.area || "—";
  tr.appendChild(tdArea);

  // Tipo
  const tdTipo = document.createElement("td");
  if (e.tipo) {
    const pill = document.createElement("span");
    pill.className = `tl-tipo ${e.tipo === "Correctivo" ? "correctivo" : e.tipo === "Preventivo" ? "preventivo" : ""}`;
    pill.textContent = e.tipo;
    tdTipo.appendChild(pill);
  } else {
    tdTipo.textContent = "—";
  }
  tr.appendChild(tdTipo);

  // F. Entrada
  const tdEnt = document.createElement("td");
  tdEnt.textContent = fmtDate(e.fentrada);
  tr.appendChild(tdEnt);

  // Días
  const tdDias = document.createElement("td");
  tdDias.style.textAlign = "center";
  if (dias != null) {
    const { color, bg } = diasColorScheme(dias);
    const tag = document.createElement("span");
    tag.className = "tl-dias-tag";
    tag.style.cssText = `background:${bg};color:${color}`;
    tag.textContent = `${dias}d`;
    tdDias.appendChild(tag);
  } else {
    tdDias.textContent = "—";
  }
  tr.appendChild(tdDias);

  // F. Salida Est.
  const tdSal = document.createElement("td");
  tdSal.textContent = fmtDate(e.fsalidaEst);
  tr.appendChild(tdSal);

  // Técnico
  const tdTec = document.createElement("td");
  tdTec.style.cssText = "font-size:10px;color:var(--s1)";
  tdTec.textContent = e.tecnico || "—";
  tr.appendChild(tdTec);

  // Observaciones (comentario || refacciones)
  const tdObs = document.createElement("td");
  tdObs.style.cssText = "max-width:200px;color:var(--s1);font-size:10px;white-space:normal";
  tdObs.textContent = e.comentario || e.refacciones || "";
  tr.appendChild(tdObs);

  // Botón finalizar + delete (stopPropagation para no abrir modal)
  const tdBtn = document.createElement("td");
  tdBtn.style.cssText = "display:flex;gap:4px;align-items:center";
  tdBtn.addEventListener("click", (ev) => ev.stopPropagation());
  if (onFinalize) {
    const btn = document.createElement("button");
    btn.className = "tl-fin-btn";
    btn.title = "Marcar como Finalizado";
    btn.textContent = "✓ Salida";
    btn.addEventListener("click", () => onFinalize(e.id));
    tdBtn.appendChild(btn);
  }
  if (onDelete) {
    const del = document.createElement("button");
    del.className = "tl-del-btn";
    del.title = "Borrar registro";
    del.textContent = "🗑";
    del.style.cssText =
      "padding:3px 8px;border:1px solid var(--R);color:var(--R);background:transparent;border-radius:5px;font-size:11px;cursor:pointer";
    del.addEventListener("click", () => onDelete(e.id));
    tdBtn.appendChild(del);
  }
  tr.appendChild(tdBtn);

  return tr;
}

function buildEmptyRow(): HTMLElement {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = COLS.length;
  td.className = "tl-empty";
  td.appendChild(document.createTextNode("Sin unidades activas en taller."));
  td.appendChild(document.createElement("br"));
  const hint = document.createElement("span");
  hint.style.fontSize = "10px";
  hint.textContent = "Registra un nuevo ingreso o revisa el Historial / Expedientes.";
  td.appendChild(hint);
  tr.appendChild(td);
  return tr;
}

// ═══════════════════════════════════════════════════════════════════════
//  renderActivas — entry point
// ═══════════════════════════════════════════════════════════════════════

export function renderActivas(
  tbody: HTMLElement,
  thead: HTMLElement | null,
  rcnt: HTMLElement | null,
  deps: RenderActivasDeps,
): ActivasSummary {
  const {
    entries,
    filter = {},
    sortCol = null,
    sortDir = -1,
    today = new Date(),
    onOpen,
    onFinalize,
    onDelete,
    onOpenHist,
    onSort,
  } = deps;

  const latestList = latestActivasPerUnit(entries);
  const totalActivas = latestList.length;

  const sorted = filterAndSort(latestList, filter, sortCol, sortDir, today);

  const urgentes = sorted.filter(({ latest }) => {
    const d = diasEnTaller(latest, today);
    return d != null && d > 7;
  }).length;

  // Thead
  if (thead) buildThead(thead, sortCol, sortDir, onSort);

  // Tbody
  tbody.replaceChildren();
  if (!sorted.length) {
    tbody.appendChild(buildEmptyRow());
  } else {
    for (const item of sorted) {
      tbody.appendChild(buildRow(item, today, onOpen, onFinalize, onOpenHist, onDelete));
    }
  }

  // Rcnt
  if (rcnt) {
    rcnt.textContent =
      sorted.length === totalActivas
        ? `${totalActivas} unidad${totalActivas !== 1 ? "es" : ""} activa${totalActivas !== 1 ? "s" : ""}`
        : `${sorted.length} de ${totalActivas} (filtrado)`;
  }

  return { visibles: sorted.length, totalActivas, urgentes };
}

/** Suma de entradas activas filtradas (útil para badges externos). */
export function countActivasFiltered(entries: TallerEntry[], filter: TallerFilter = {}): number {
  const latestList = latestActivasPerUnit(entries);
  return latestList.filter(({ latest: e }) => {
    if (filter.sucursal && filter.sucursal !== "all" && e.sucursal !== filter.sucursal) return false;
    if (filter.area && filter.area !== "all" && e.area !== filter.area) return false;
    if (filter.tipo && filter.tipo !== "all" && e.tipo !== filter.tipo) return false;
    if (filter.search && !matchesSearch(e, filter.search)) return false;
    return true;
  }).length;
}

/** Helper: determina si una entry es "urgente" (>7 días). */
export function isUrgente(entry: TallerEntry, today: Date = new Date()): boolean {
  if (isClosed(entry)) return false;
  const d = diasEnTaller(entry, today);
  return d != null && d > 7;
}

/** Helper: cuenta activas filtradas usando el módulo. Expuesto para consistencia con filterActivas. */
export { filterActivas };
