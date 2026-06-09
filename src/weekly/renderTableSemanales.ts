// renderTableSemanales — tabla de reportes semanales.
// Pure: computeEffectiveRisk + filterAndSortWeekly.
// DOM: renderTableSemanales via createElement (XSS-safe).

import type { RiskLevel, WeeklyEntry } from "../types";
import type { WeeklyPeriodo } from "./weeklyStore";
import { uniqueWeeklySucursales } from "./weeklyStore";

export type WeeklyRiskFilter = "all" | "Urgente" | "Revisar" | "OK" | "carroceria" | "llanta";

export type WeeklySortCol =
  | "_idx"
  | "eco"
  | "plate"
  | "km"
  | "branch"
  | "aceiteRisk"
  | "radiadorRisk"
  | "carroceriaRisk"
  | "llantaRisk"
  | "risk"
  | "responsable"
  | "fecha";

export type WeeklyTableFilter = {
  riskFilter: WeeklyRiskFilter;
  sucursal: string;
  search: string;
};

/**
 * Estado global efectivo — SOLO sistemas vitales (aceite + radiador).
 * Carroceria y llanta son observaciones informativas, no votan aqui.
 */
export function computeEffectiveRisk(entry: WeeklyEntry): RiskLevel {
  if (entry.aceiteRisk === "Urgente" || entry.radiadorRisk === "Urgente") return "Urgente";
  if (entry.aceiteRisk === "Revisar" || entry.radiadorRisk === "Revisar") return "Revisar";
  return "OK";
}

const RISK_ORDER: Record<string, number> = { Urgente: 2, Revisar: 1, OK: 0 };

export function filterAndSortWeekly(
  entries: WeeklyEntry[],
  filter: WeeklyTableFilter,
  sortCol: WeeklySortCol,
  sortDir: 1 | -1,
): WeeklyEntry[] {
  const rows = entries.filter((e) => {
    // carroceriaRisk/llantaRisk son opcionales: un undefined se pinta como
    // "Sin daños"/"Con refacción" (= OK) en la celda y NO cuenta en el KPI.
    // Tratar undefined igual que "OK" evita que el filtro deje pasar filas que
    // la propia tabla muestra como OK (descuadre tarjeta vs filas).
    if (filter.riskFilter === "carroceria" && (!e.carroceriaRisk || e.carroceriaRisk === "OK"))
      return false;
    if (filter.riskFilter === "llanta" && (!e.llantaRisk || e.llantaRisk === "OK")) return false;
    if (
      filter.riskFilter !== "all" &&
      filter.riskFilter !== "carroceria" &&
      filter.riskFilter !== "llanta" &&
      computeEffectiveRisk(e) !== filter.riskFilter
    )
      return false;
    if (filter.sucursal !== "all" && e.branch !== filter.sucursal) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      return [e.eco, e.plate, e.brand, e.branch, e.responsable].some((v) =>
        String(v || "")
          .toLowerCase()
          .includes(q),
      );
    }
    return true;
  });

  rows.sort((a, b) => {
    if (sortCol === "risk") {
      const ra = computeEffectiveRisk(a);
      const rb = computeEffectiveRisk(b);
      return ((RISK_ORDER[rb] || 0) - (RISK_ORDER[ra] || 0)) * sortDir;
    }
    if (sortCol === "aceiteRisk" || sortCol === "radiadorRisk") {
      const ra = String(a[sortCol] || "");
      const rb = String(b[sortCol] || "");
      return ((RISK_ORDER[rb] || 0) - (RISK_ORDER[ra] || 0)) * sortDir;
    }
    return (
      String(a[sortCol as keyof WeeklyEntry] ?? "").localeCompare(
        String(b[sortCol as keyof WeeklyEntry] ?? ""),
        undefined,
        { numeric: true, sensitivity: "base" },
      ) * sortDir
    );
  });

  return rows;
}

// ═══════════════════════════════════════════════════════════════
//  DOM rendering
// ═══════════════════════════════════════════════════════════════

const SORT_COLS: WeeklySortCol[] = [
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
];

const HEADERS = [
  "#",
  "No. Unidad / ECO",
  "Placas",
  "KM",
  "Sucursal",
  "Aceite Motor",
  "Radiador",
  "Carrocería",
  "Llanta Ref.",
  "Estado",
  "Responsable",
  "Fecha",
];

export type RenderTableSemanalesDeps = {
  tbody: HTMLElement;
  theadRow: HTMLElement | null;
  table: HTMLElement | null;
  empty: HTMLElement | null;
  rcnt: HTMLElement | null;
  selSuc: HTMLSelectElement | null;
  periodo: WeeklyPeriodo | undefined;
  filter: WeeklyTableFilter;
  sortCol: WeeklySortCol;
  sortDir: 1 | -1;
  hasZipPhotos: boolean;
  onPhotos: (uid: string) => void;
  onEnviarATaller: (uid: string) => void;
  onSort: (col: WeeklySortCol) => void;
};

export type TableSemanalesSummary = {
  total: number;
  filtered: number;
  empty: boolean;
};

function pill(
  risk: RiskLevel | undefined,
  label: string,
  iconKey: "zap" | "alert-triangle" | "check",
): HTMLElement {
  const cls =
    risk === "Urgente" ? "sw-pill-urg" : risk === "Revisar" ? "sw-pill-rev" : "sw-pill-ok";
  const span = document.createElement("span");
  span.className = `sw-pill ${cls}`;
  const i = document.createElement("i");
  i.setAttribute("data-lucide", iconKey);
  i.style.cssText = "width:10px;height:10px;vertical-align:-1px";
  span.appendChild(i);
  span.appendChild(document.createTextNode(" " + label));
  return span;
}

function riskPill(risk: RiskLevel | undefined, label: string): HTMLElement {
  const key: "zap" | "alert-triangle" | "check" =
    risk === "Urgente" ? "zap" : risk === "Revisar" ? "alert-triangle" : "check";
  return pill(risk, label, key);
}

function carroceriaCell(entry: WeeklyEntry): HTMLElement {
  if (!entry.carroceriaRisk || entry.carroceriaRisk === "OK") {
    const s = document.createElement("span");
    s.className = "sw-pill sw-pill-ok";
    s.textContent = "✓ Sin daños";
    return s;
  }
  if (entry.carroceriaRisk === "Urgente") {
    return riskPill("Urgente", entry.carroceria || "Daño grave");
  }
  const s = document.createElement("span");
  s.className = "sw-pill sw-pill-info";
  s.textContent = "● " + (entry.carroceria || "Con daños");
  return s;
}

function llantaCell(entry: WeeklyEntry): HTMLElement {
  if (!entry.llantaRisk || entry.llantaRisk === "OK") {
    const s = document.createElement("span");
    s.className = "sw-pill sw-pill-ok";
    s.textContent = "✓ Con refacción";
    return s;
  }
  const s = document.createElement("span");
  s.className = "sw-pill sw-pill-note";
  s.textContent = "◌ Completar refacción";
  return s;
}

function formatKm(km: WeeklyEntry["km"]): string {
  if (km === undefined || km === null || km === "") return "—";
  const n = Number(String(km).replace(/[^0-9.]/g, ""));
  if (!isFinite(n)) return "—";
  return n.toLocaleString("es-MX") + " km";
}

function camIcon(entry: WeeklyEntry, hasZipPhotos: boolean): HTMLElement | null {
  const photoCount = entry.photos?.length ?? 0;
  if (!photoCount) return null;
  const wrap = document.createElement("span");
  if (hasZipPhotos) {
    wrap.style.cssText =
      "margin-left:5px;font-size:9px;color:var(--O);opacity:.8;display:inline-flex;align-items:center;gap:2px";
    wrap.title = `${photoCount} foto${photoCount !== 1 ? "s" : ""}`;
    const i = document.createElement("i");
    i.setAttribute("data-lucide", "camera");
    i.style.cssText = "width:10px;height:10px";
    wrap.appendChild(i);
    wrap.appendChild(document.createTextNode(String(photoCount)));
  } else {
    wrap.style.cssText = "margin-left:5px;font-size:8px;color:var(--s3)";
    wrap.title = "Carga el ZIP para ver fotos";
    const i = document.createElement("i");
    i.setAttribute("data-lucide", "camera");
    i.style.cssText = "width:10px;height:10px;vertical-align:-1px";
    wrap.appendChild(i);
  }
  return wrap;
}

function tallerBtn(uid: string, onClick: (uid: string) => void): HTMLElement {
  const btn = document.createElement("button");
  btn.className = "sw-btn-taller";
  btn.title = "Abrir formulario de ingreso al taller";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "10");
  svg.setAttribute("height", "10");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.5");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
  );
  svg.appendChild(path);
  btn.appendChild(svg);
  btn.appendChild(document.createTextNode(" Enviar a Taller"));
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    onClick(uid);
  });
  return btn;
}

function td(content?: string | HTMLElement, style?: string): HTMLTableCellElement {
  const cell = document.createElement("td");
  if (style) cell.style.cssText = style;
  if (content === undefined) return cell;
  if (typeof content === "string") cell.textContent = content;
  else cell.appendChild(content);
  return cell;
}

export function populateSucursalSelect(
  selSuc: HTMLSelectElement | null,
  periodo: WeeklyPeriodo | undefined,
): void {
  if (!selSuc || !periodo) return;
  const sucs = uniqueWeeklySucursales(periodo.entries);
  const cur = selSuc.value;
  selSuc.textContent = "";
  const optAll = document.createElement("option");
  optAll.value = "all";
  optAll.textContent = "Todas las sucursales";
  selSuc.appendChild(optAll);
  for (const s of sucs) {
    const o = document.createElement("option");
    o.value = s;
    o.textContent = s;
    selSuc.appendChild(o);
  }
  if (cur && Array.from(selSuc.options).some((o) => o.value === cur)) {
    selSuc.value = cur;
  }
}

function renderThead(
  row: HTMLElement,
  sortCol: WeeklySortCol,
  sortDir: 1 | -1,
  onSort: (col: WeeklySortCol) => void,
): void {
  row.textContent = "";
  SORT_COLS.forEach((k, i) => {
    const th = document.createElement("th");
    const active = sortCol === k;
    const arrow = active ? (sortDir === 1 ? " ▲" : " ▼") : "";
    th.textContent = HEADERS[i] + arrow;
    if (active) th.style.color = "var(--ac)";
    th.style.cursor = "pointer";
    th.addEventListener("click", () => onSort(k));
    row.appendChild(th);
  });
  const thAction = document.createElement("th");
  thAction.textContent = "Acción";
  thAction.style.cursor = "default";
  row.appendChild(thAction);
}

export function renderTableSemanales(deps: RenderTableSemanalesDeps): TableSemanalesSummary {
  const { tbody, theadRow, table, empty, rcnt, selSuc, periodo, filter } = deps;

  populateSucursalSelect(selSuc, periodo);

  if (!periodo || !periodo.entries.length) {
    if (empty) empty.style.display = "block";
    if (table) table.style.display = "none";
    if (rcnt) rcnt.textContent = "";
    tbody.textContent = "";
    return { total: 0, filtered: 0, empty: true };
  }

  const rows = filterAndSortWeekly(periodo.entries, filter, deps.sortCol, deps.sortDir);

  if (theadRow) renderThead(theadRow, deps.sortCol, deps.sortDir, deps.onSort);
  if (empty) empty.style.display = "none";
  if (table) table.style.display = "";

  tbody.textContent = "";
  rows.forEach((e, i) => {
    const effectiveRisk = computeEffectiveRisk(e);
    const rowCls =
      effectiveRisk === "Urgente" ? "sw-urg" : effectiveRisk === "Revisar" ? "sw-rev" : "";

    const tr = document.createElement("tr");
    if (rowCls) tr.className = rowCls;
    const photoCount = e.photos?.length ?? 0;
    const canClickPhotos = deps.hasZipPhotos && photoCount > 0;
    if (canClickPhotos) {
      tr.style.cursor = "pointer";
      tr.addEventListener("click", () => deps.onPhotos(e.uid));
    }

    tr.appendChild(td(String(i + 1), "color:var(--s3);font-size:10px"));

    const ecoCell = td(undefined, "font-weight:700;color:var(--w1);font-family:var(--fm)");
    ecoCell.appendChild(document.createTextNode(e.eco || "—"));
    const cam = camIcon(e, deps.hasZipPhotos);
    if (cam) ecoCell.appendChild(cam);
    tr.appendChild(ecoCell);

    tr.appendChild(td(e.plate || "—", "font-weight:600;color:var(--ac);font-family:var(--fm)"));

    const kmCell = td(formatKm(e.km));
    kmCell.className = "sw-km";
    tr.appendChild(kmCell);

    tr.appendChild(td(e.branch || "—", "font-size:10px;color:var(--s2)"));
    tr.appendChild(td(riskPill(e.aceiteRisk, e.aceite || e.aceiteRisk || "OK")));
    tr.appendChild(td(riskPill(e.radiadorRisk, e.radiador || e.radiadorRisk || "OK")));
    tr.appendChild(td(carroceriaCell(e)));
    tr.appendChild(td(llantaCell(e)));
    const estadoLabel =
      effectiveRisk === "OK"
        ? "Operativa"
        : effectiveRisk === "Revisar"
          ? "Operativa · Revisar"
          : "Urgente";
    tr.appendChild(td(riskPill(effectiveRisk, estadoLabel)));

    const respSpan = document.createElement("span");
    respSpan.className = "sw-resp";
    respSpan.title = e.responsable || "";
    respSpan.textContent = e.responsable || "—";
    tr.appendChild(td(respSpan));

    tr.appendChild(td(e.fecha || "—", "font-size:10px;color:var(--s2)"));

    const actionCell = document.createElement("td");
    if (effectiveRisk === "Urgente") actionCell.appendChild(tallerBtn(e.uid, deps.onEnviarATaller));
    tr.appendChild(actionCell);

    tbody.appendChild(tr);
  });

  if (rcnt) {
    rcnt.textContent =
      rows.length === periodo.entries.length
        ? `${rows.length} unidad${rows.length !== 1 ? "es" : ""}`
        : `${rows.length} de ${periodo.entries.length}`;
  }

  return { total: periodo.entries.length, filtered: rows.length, empty: false };
}
