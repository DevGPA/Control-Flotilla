// renderTable — tabla principal del tab "Inspecciones".
// Reemplaza la función `renderTable()` del legado (línea ~2195 de
// `Control de flotilla.html`). DOM-API puro: cero `innerHTML` (ESLint lo prohíbe
// vía no-restricted-syntax). Helpers `mkpill`, `fcell`, `tcell` retornan
// `HTMLElement` en vez de strings para componer con appendChild.
//
// Las inyecciones (checklistDB, hasZip, onSelect, isUnitEnTaller, parseSvcDate)
// entran como deps para mantener el módulo DOM-agnostic/testeable.

import { TCRIT, TWARN } from "../analyzer/constants";
import type { ChecklistDB, RiskLevel, Unit } from "../types";

export type RenderTableDeps = {
  units: Unit[];
  selectedUid?: string | null;
  checklistDB?: ChecklistDB;
  hasZip?: boolean;
  isUnitEnTaller?: (u: Unit) => boolean;
  parseSvcDate?: (s: string) => Date | null;
  onSelect?: (uid: string) => void;
  /** Fecha de referencia para alertas de servicio (default: hoy). */
  today?: Date;
  /** Umbrales de llantas (override para tests); defaults TCRIT/TWARN. */
  tcrit?: number;
  twarn?: number;
};

// ═══════════════════════════════════════════════════════════════
//  Helpers de celdas — retornan HTMLElement para composición DOM-safe
// ═══════════════════════════════════════════════════════════════

/** Crea un <i data-lucide="..."> (lucide.replace() lo hidrata al icono SVG). */
function lucideIcon(name: string, size = 10, extraStyle = ""): HTMLElement {
  const i = document.createElement("i");
  i.setAttribute("data-lucide", name);
  i.style.cssText = `width:${size}px;height:${size}px;vertical-align:-1px;${extraStyle}`;
  return i;
}

/** Genera el badge de riesgo. Las clases `pu/pr/pc/po` están en main.css. */
export function mkpill(r: RiskLevel): HTMLElement {
  const [cl, lb] =
    r === "Urgente" ? ["pu", "Urgente"] :
    r === "Revisar" ? ["pr", "Revisar"] :
    r === "Completar" ? ["pc", "Completar"] :
    ["po", "OK"];
  const span = document.createElement("span");
  span.className = `pill ${cl}`;
  const dot = document.createElement("span");
  dot.className = "pd";
  span.appendChild(dot);
  span.appendChild(document.createTextNode(lb));
  return span;
}

function dotRow(color: string, text: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "fcr";
  const dot = document.createElement("span");
  dot.style.cssText = `width:5px;height:5px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0`;
  const label = document.createElement("span");
  label.style.cssText = `color:${color};font-size:10px`;
  label.textContent = text;
  row.appendChild(dot);
  row.appendChild(label);
  return row;
}

/**
 * Resumen de hallazgos pendientes (findings no-done) por severidad.
 * Las cuentas se derivan de `u.F` descontando lo marcado como done en
 * `checklistDB[u.uid][finding.text].done`.
 */
export function fcell(u: Unit, checklistDB: ChecklistDB = {}): HTMLElement {
  const dm = checklistDB[u.uid] || {};
  const pending = u.F.filter((f) => !(dm[f.text] && dm[f.text].done));
  const a = pending.filter((f) => f.lv === "Urgente").length;
  const b = pending.filter((f) => f.lv === "Revisar").length;
  const c = pending.filter((f) => f.lv === "Completar").length;
  if (!a && !b && !c) {
    const empty = document.createElement("span");
    empty.style.cssText = "color:var(--G);font-size:10px";
    empty.textContent = "Ninguno";
    return empty;
  }
  const wrap = document.createElement("div");
  wrap.className = "fcw";
  if (a) wrap.appendChild(dotRow("var(--R)", `${a} urgente${a > 1 ? "s" : ""}`));
  if (b) wrap.appendChild(dotRow("var(--A)", `${b} revisar`));
  if (c) wrap.appendChild(dotRow("var(--B)", `${c} completar`));
  return wrap;
}

/** Indicador visual de llanta con TACO mínimo. */
export function tcell(minT: number | null, tcrit = TCRIT, twarn = TWARN): HTMLElement {
  if (minT === null || !Number.isFinite(minT)) {
    const placeholder = document.createElement("span");
    placeholder.style.cssText = "color:var(--s3);font-size:10px";
    placeholder.textContent = "—";
    return placeholder;
  }
  const pct = Math.min((minT / 10) * 100, 100);
  const color = minT <= tcrit ? "var(--R)" : minT <= twarn ? "var(--A)" : "var(--G)";
  const wrap = document.createElement("div");
  wrap.className = "tmw";
  const bar = document.createElement("div");
  bar.className = "tmb";
  bar.style.width = "50px";
  const fill = document.createElement("div");
  fill.className = "tmb";
  fill.style.cssText = `width:${pct}%;background:${color}`;
  bar.appendChild(fill);
  const label = document.createElement("div");
  label.className = "tml";
  label.style.color = color;
  label.textContent = `${Number(minT)}mm`;
  wrap.appendChild(bar);
  wrap.appendChild(label);
  return wrap;
}

// ═══════════════════════════════════════════════════════════════
//  renderTable — entry point
// ═══════════════════════════════════════════════════════════════

/** Renderiza la tabla de inspecciones en el container dado. */
export function renderTable(container: HTMLElement, deps: RenderTableDeps): void {
  const {
    units,
    selectedUid = null,
    checklistDB = {},
    hasZip = false,
    isUnitEnTaller = () => false,
    parseSvcDate,
    onSelect,
    today: todayRef = new Date(),
    tcrit = TCRIT,
    twarn = TWARN,
  } = deps;

  // Reset container
  container.replaceChildren();

  if (units.length === 0) {
    const empty = document.createElement("div");
    empty.className = "nores";
    empty.textContent = "Sin resultados con los filtros actuales.";
    container.appendChild(empty);
    return;
  }

  const today0 = new Date(todayRef);
  today0.setHours(0, 0, 0, 0);
  const d30 = new Date(today0);
  d30.setDate(d30.getDate() + 30);

  const frag = document.createDocumentFragment();

  units.forEach((u, i) => {
    const enTaller = isUnitEnTaller(u);
    const riskClass = u.risk === "Urgente" ? "ru" : u.risk === "Revisar" ? "rr" : "ro";
    const tr = document.createElement("div");
    tr.className = `tr ${riskClass}${selectedUid === u.uid ? " sel" : ""}`;
    tr.style.animationDelay = `${Math.min(i * 12, 260)}ms`;
    if (enTaller) tr.style.outline = "1.5px solid #c4b5fd";
    if (onSelect) tr.addEventListener("click", () => onSelect(u.uid));

    // ── 1. Índice
    appendTextCell(tr, String(i + 1), "tc tn");

    // ── 2. Eco / Placas
    const idCell = document.createElement("div");
    idCell.className = "tc";
    const plate = document.createElement("div");
    plate.className = "tplate";
    plate.textContent = u.eco || u.plate || "—";
    if (hasZip && u.photos && u.photos.length > 0) {
      const cam = document.createElement("span");
      cam.style.cssText = "margin-left:5px;font-size:9px;color:var(--O);opacity:.75";
      cam.appendChild(lucideIcon("camera", 10));
      plate.appendChild(cam);
    }
    if (enTaller) {
      const badge = document.createElement("span");
      badge.className = "taller-badge-row";
      badge.appendChild(lucideIcon("wrench", 9));
      badge.appendChild(document.createTextNode(" TALLER"));
      plate.appendChild(badge);
    }
    idCell.appendChild(plate);
    if (u.eco && u.plate) {
      const sub = document.createElement("div");
      sub.style.cssText = "font-size:9px;color:var(--s2);font-family:var(--fm);margin-top:2px;letter-spacing:.3px";
      sub.textContent = u.plate;
      idCell.appendChild(sub);
    }
    tr.appendChild(idCell);

    // ── 3. Unidad / Inspector
    const uiCell = document.createElement("div");
    uiCell.className = "tc";
    const brand = document.createElement("div");
    brand.className = "tbr";
    brand.textContent = u.brand || "—";
    const insp = document.createElement("div");
    insp.className = "tinsp";
    insp.textContent = u.insp || "—";
    uiCell.appendChild(brand);
    uiCell.appendChild(insp);
    tr.appendChild(uiCell);

    // ── 4. Risk pill
    const pillCell = document.createElement("div");
    pillCell.className = "tc";
    pillCell.appendChild(mkpill(u.risk));
    tr.appendChild(pillCell);

    // ── 5. Findings summary
    const fCellEl = document.createElement("div");
    fCellEl.className = "tc";
    fCellEl.appendChild(fcell(u, checklistDB));
    tr.appendChild(fCellEl);

    // ── 6. Observations (user text — always textContent)
    const obsCell = document.createElement("div");
    obsCell.className = "tc";
    if (u.obs) {
      const cmt = document.createElement("div");
      cmt.className = "tcmt";
      const arr = u.obsArr && u.obsArr.length ? u.obsArr : [u.obs];
      if (arr.length > 1) {
        const countBadge = document.createElement("span");
        countBadge.style.cssText = "font-size:8px;color:var(--B);font-weight:700;background:rgba(77,158,255,.15);padding:1px 6px;border-radius:3px;margin-right:6px";
        countBadge.textContent = String(arr.length);
        cmt.appendChild(countBadge);
      }
      cmt.appendChild(document.createTextNode(arr[0]));
      obsCell.appendChild(cmt);
    } else {
      const empty = document.createElement("span");
      empty.className = "tcmt-empty";
      empty.textContent = "—";
      obsCell.appendChild(empty);
    }
    tr.appendChild(obsCell);

    // ── 7. Tires
    const tireCell = document.createElement("div");
    tireCell.className = "tc";
    tireCell.appendChild(tcell(u.minT, tcrit, twarn));
    tr.appendChild(tireCell);

    // ── 8. KM / Fecha / Service alert
    const kmCell = document.createElement("div");
    kmCell.className = "tc";
    const km = document.createElement("div");
    km.className = "tkm";
    km.textContent = u.km !== undefined && u.km !== "" ? `${Number(u.km).toLocaleString("es-MX")}km` : "—";
    kmCell.appendChild(km);
    const dt = document.createElement("div");
    dt.className = "tdt";
    dt.textContent = u.fecha || "—";
    kmCell.appendChild(dt);
    if (u.nextSvc && u.nextSvc !== "—" && parseSvcDate) {
      const sd = parseSvcDate(u.nextSvc);
      if (sd) {
        const alertEl = svcAlertEl(sd, today0, d30);
        if (alertEl) kmCell.appendChild(alertEl);
      }
    }
    tr.appendChild(kmCell);

    frag.appendChild(tr);
  });

  container.appendChild(frag);
}

/** Crea el badge de alerta de servicio (vencido/próximo) o null si no aplica. */
function svcAlertEl(serviceDate: Date, today0: Date, d30: Date): HTMLElement | null {
  const el = document.createElement("div");
  el.style.cssText = "font-size:8px;margin-top:2px;font-weight:700";
  if (serviceDate < today0) {
    el.style.color = "#EF4444";
    el.appendChild(lucideIcon("alert-triangle", 10, "vertical-align:-2px;"));
    el.appendChild(document.createTextNode(" Svc vencido"));
    return el;
  }
  if (serviceDate <= d30) {
    el.style.color = "#F59E0B";
    el.appendChild(lucideIcon("clock", 10, "vertical-align:-2px;"));
    el.appendChild(document.createTextNode(" Svc próximo"));
    return el;
  }
  return null;
}

/** Util: crea celda con textContent seguro. */
function appendTextCell(tr: HTMLElement, text: string, className = "tc"): void {
  const td = document.createElement("div");
  td.className = className;
  td.textContent = text;
  tr.appendChild(td);
}
