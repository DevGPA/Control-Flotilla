// renderTable — tabla principal del tab "Inspecciones".
// Reemplaza la función `renderTable()` del legado (línea ~2195 de
// `Control de flotilla.html`). DOM-API first, sin innerHTML con input de
// usuario. Helpers `mkpill`, `fcell`, `tcell` exportados para reuso.
//
// Las inyecciones (checklistDB, hasZip, onSelect, isUnitEnTaller, parseSvcDate)
// entran como deps para mantener el módulo DOM-agnostic/testeable.

import { TCRIT, TWARN } from "../analyzer/constants";
import { escHtml } from "../dom/safeHTML";
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
//  Helpers de celdas — exportados para reuso y tests aislados
// ═══════════════════════════════════════════════════════════════

/** Genera el badge de riesgo. Las clases `pu/pr/pc/po` están en main.css. */
export function mkpill(r: RiskLevel): string {
  const [cl, lb] =
    r === "Urgente" ? ["pu", "Urgente"] :
    r === "Revisar" ? ["pr", "Revisar"] :
    r === "Completar" ? ["pc", "Completar"] :
    ["po", "OK"];
  return `<span class="pill ${cl}"><span class="pd"></span>${lb}</span>`;
}

/**
 * Resumen de hallazgos pendientes (findings no-done) por severidad.
 * Las cuentas se derivan de `u.F` descontando lo marcado como done en
 * `checklistDB[u.uid][finding.text].done`.
 */
export function fcell(u: Unit, checklistDB: ChecklistDB = {}): string {
  const dm = checklistDB[u.uid] || {};
  const pending = u.F.filter((f) => !(dm[f.text] && dm[f.text].done));
  const a = pending.filter((f) => f.lv === "Urgente").length;
  const b = pending.filter((f) => f.lv === "Revisar").length;
  const c = pending.filter((f) => f.lv === "Completar").length;
  if (!a && !b && !c) return `<span style="color:var(--G);font-size:10px">Ninguno</span>`;
  const rows: string[] = [];
  if (a) rows.push(dotRow("var(--R)", `${a} urgente${a > 1 ? "s" : ""}`));
  if (b) rows.push(dotRow("var(--A)", `${b} revisar`));
  if (c) rows.push(dotRow("var(--B)", `${c} completar`));
  return `<div class="fcw">${rows.join("")}</div>`;
}

function dotRow(color: string, text: string): string {
  // escHtml no necesario aquí: `color` es enum interno, `text` viene de counts.
  return `<div class="fcr"><span style="width:5px;height:5px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0"></span><span style="color:${color};font-size:10px">${text}</span></div>`;
}

/** Indicador visual de llanta con TACO mínimo. */
export function tcell(minT: number | null, tcrit = TCRIT, twarn = TWARN): string {
  if (minT === null || !Number.isFinite(minT)) {
    return `<span style="color:var(--s3);font-size:10px">—</span>`;
  }
  const pct = Math.min((minT / 10) * 100, 100);
  const color = minT <= tcrit ? "var(--R)" : minT <= twarn ? "var(--A)" : "var(--G)";
  return `<div class="tmw"><div class="tmb" style="width:50px"><div class="tmb" style="width:${pct}%;background:${color}"></div></div><div class="tml" style="color:${color}">${Number(minT)}mm</div></div>`;
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
      cam.innerHTML = '<i data-lucide="camera" style="width:10px;height:10px;vertical-align:-1px"></i>';
      plate.appendChild(cam);
    }
    if (enTaller) {
      const badge = document.createElement("span");
      badge.className = "taller-badge-row";
      badge.innerHTML = '<i data-lucide="wrench" style="width:9px;height:9px;vertical-align:-1px"></i> TALLER';
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
    pillCell.innerHTML = mkpill(u.risk);
    tr.appendChild(pillCell);

    // ── 5. Findings (counts aggregated, safe)
    const fCell = document.createElement("div");
    fCell.className = "tc";
    fCell.innerHTML = fcell(u, checklistDB);
    tr.appendChild(fCell);

    // ── 6. Observations (user text — use textContent, never innerHTML)
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

    // ── 7. Tires (computed string — safe)
    const tireCell = document.createElement("div");
    tireCell.className = "tc";
    tireCell.innerHTML = tcell(u.minT, tcrit, twarn);
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
        const alert = document.createElement("div");
        alert.style.cssText = "font-size:8px;margin-top:2px;font-weight:700";
        if (sd < today0) {
          alert.style.color = "#EF4444";
          alert.innerHTML = '<i data-lucide="alert-triangle" style="width:10px;height:10px;vertical-align:-2px"></i> Svc vencido';
        } else if (sd <= d30) {
          alert.style.color = "#F59E0B";
          alert.innerHTML = '<i data-lucide="clock" style="width:10px;height:10px;vertical-align:-2px"></i> Svc próximo';
        }
        if (alert.textContent) kmCell.appendChild(alert);
      }
    }
    tr.appendChild(kmCell);

    frag.appendChild(tr);
  });

  container.appendChild(frag);
}

/** Util: crea celda con textContent seguro. */
function appendTextCell(tr: HTMLElement, text: string, className = "tc"): void {
  const td = document.createElement("div");
  td.className = className;
  td.textContent = text;
  tr.appendChild(td);
}

// Evita warning "escHtml imported but unused" — reservado para extensiones.
void escHtml;
