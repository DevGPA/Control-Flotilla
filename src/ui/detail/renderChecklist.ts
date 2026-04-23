// renderChecklist — sub-tab "Hallazgos" del panel detalle.
// Reemplaza `renderChecklist(u, body)` del legado (línea ~2467 de
// `Control de flotilla.html`). DOM-API puro (cero innerHTML).
//
// Responsabilidades:
//   1. Empty state (unidad sin findings)
//   2. Diff vs período anterior (nuevos/resueltos/empeorados/mejorados)
//   3. Progress bar (atendidos vs total)
//   4. Summary chips por severidad
//   5. Grid agrupado por categoría (Llantas/Fluidos/Documentos/Checklist)
//   6. Toggle done via onClick → onToggle callback

import { CATI } from "../../analyzer/constants";
import type { ChecklistDB, Finding, RiskLevel, Unit } from "../../types";

export type ChecklistItemDiff = {
  item: string;
  lv?: RiskLevel;
  from?: RiskLevel;
  to?: RiskLevel;
};

export type PeriodDiff = {
  newFails: ChecklistItemDiff[];
  resolved: ChecklistItemDiff[];
  worsened: ChecklistItemDiff[];
  improved: ChecklistItemDiff[];
  label: string;
};

export type RenderChecklistDeps = {
  unit: Unit;
  checklistDB?: ChecklistDB;
  /** Diff computado externamente (opcional) para mostrar cambios vs periodo anterior. */
  diff?: PeriodDiff | null;
  /** Callback al hacer click en un finding para togglear su estado done. */
  onToggle?: (uid: string, findingText: string) => void;
};

const RISK_ORDER: Record<RiskLevel, number> = { OK: 0, Completar: 1, Revisar: 2, Urgente: 3 };

/**
 * Computa diff entre la unidad actual y el mismo uid en un período previo.
 * Exportado para reuso desde tests y desde el caller que tenga periodos cargados.
 */
export function computeDiff(
  currentFindings: Finding[],
  previousFindings: Finding[],
  label: string,
): PeriodDiff {
  const curMap = new Map(currentFindings.map((f) => [f.text, f.lv]));
  const prevMap = new Map(previousFindings.map((f) => [f.text, f.lv]));
  const all = new Set([...curMap.keys(), ...prevMap.keys()]);
  const diff: PeriodDiff = { newFails: [], resolved: [], worsened: [], improved: [], label };

  for (const item of all) {
    const cur = curMap.get(item);
    const prev = prevMap.get(item);
    if (cur && !prev) {
      diff.newFails.push({ item, lv: cur });
    } else if (!cur && prev) {
      diff.resolved.push({ item, lv: prev });
    } else if (cur && prev && cur !== prev) {
      // RISK_ORDER es Record<RiskLevel, number> exhaustivo — lookup siempre definido.
      // Sin `?? 0` defensivo: dejar que TS detecte si alguien rompe el invariante.
      if (RISK_ORDER[cur] > RISK_ORDER[prev]) {
        diff.worsened.push({ item, from: prev, to: cur });
      } else {
        diff.improved.push({ item, from: prev, to: cur });
      }
    }
  }
  return diff;
}

// ═══════════════════════════════════════════════════════════════
//  Helpers DOM
// ═══════════════════════════════════════════════════════════════

function lucideIcon(name: string, size = 11): HTMLElement {
  const i = document.createElement("i");
  i.setAttribute("data-lucide", name);
  i.style.cssText = `width:${size}px;height:${size}px;vertical-align:-2px`;
  return i;
}

function emptyState(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.cssText = "text-align:center;padding:36px;color:var(--G)";
  const icon = document.createElement("div");
  icon.style.cssText = "font-size:30px;margin-bottom:8px";
  icon.textContent = "✓";
  const msg = document.createElement("div");
  msg.style.cssText = "font-size:12px;font-weight:500";
  msg.textContent = "Sin hallazgos — todo en orden";
  wrap.appendChild(icon);
  wrap.appendChild(msg);
  return wrap;
}

function diffSection(diff: PeriodDiff): HTMLElement | null {
  if (
    !diff.newFails.length &&
    !diff.resolved.length &&
    !diff.worsened.length &&
    !diff.improved.length
  ) {
    return null;
  }
  const wrap = document.createElement("div");
  wrap.style.cssText =
    "margin-bottom:12px;padding:10px 12px;background:var(--bg2);border-radius:8px;border:1px solid var(--ln)";

  const title = document.createElement("div");
  title.style.cssText =
    "font-size:10px;font-weight:700;color:var(--s1);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px";
  title.textContent = `Cambios vs ${diff.label}`;
  wrap.appendChild(title);

  const makeRow = (
    marker: string,
    markerColor: string,
    text: string,
    extraText?: string,
    extraColor?: string,
  ): HTMLElement => {
    const row = document.createElement("div");
    row.style.cssText = "font-size:10px;margin-bottom:2px";
    const markerSpan = document.createElement("span");
    markerSpan.style.color = markerColor;
    markerSpan.textContent = marker;
    const textSpan = document.createElement("span");
    textSpan.style.cssText = "color:var(--w2);margin-left:4px";
    textSpan.textContent = text;
    row.appendChild(markerSpan);
    row.appendChild(textSpan);
    if (extraText) {
      const extra = document.createElement("span");
      extra.style.cssText = `font-size:9px;color:${extraColor ?? "var(--s2)"};margin-left:4px`;
      extra.textContent = extraText;
      row.appendChild(extra);
    }
    return row;
  };

  for (const f of diff.newFails) {
    const color = f.lv === "Urgente" ? "var(--R)" : "var(--A)";
    wrap.appendChild(makeRow("▼ Nuevo:", "var(--R)", f.item, `(${f.lv})`, color));
  }
  for (const f of diff.resolved) {
    wrap.appendChild(makeRow("▲ Resuelto:", "var(--G)", f.item));
  }
  for (const f of diff.worsened) {
    wrap.appendChild(makeRow("↓ Empeorado:", "var(--R)", f.item, `${f.from} → ${f.to}`));
  }
  for (const f of diff.improved) {
    wrap.appendChild(makeRow("↑ Mejorado:", "var(--G)", f.item, `${f.from} → ${f.to}`));
  }
  return wrap;
}

function progressBar(done: number, total: number): HTMLElement {
  const pct = total ? Math.round((done / total) * 100) : 100;
  const color = pct >= 100 ? "var(--G)" : pct >= 50 ? "var(--A)" : "var(--R)";
  const wrap = document.createElement("div");
  wrap.className = "ck-progress";
  const bar = document.createElement("div");
  bar.className = "ck-prog-bar";
  const fill = document.createElement("div");
  fill.className = "ck-prog-fill";
  fill.style.cssText = `width:${pct}%;background:${color}`;
  bar.appendChild(fill);
  const txt = document.createElement("span");
  txt.className = "ck-prog-txt";
  txt.style.color = color;
  txt.textContent = `${done} de ${total} atendidos`;
  wrap.appendChild(bar);
  wrap.appendChild(txt);
  return wrap;
}

function chipSpan(text: string, color: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "ck-chip";
  span.style.color = color;
  const dot = document.createElement("span");
  dot.className = "ck-chip-dot";
  dot.style.background = color;
  span.appendChild(dot);
  span.appendChild(document.createTextNode(text));
  return span;
}

function summaryLine(
  counts: { urg: number; rev: number; comp: number; done: number },
  total: number,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "ck-inline-summary";
  const chips: HTMLElement[] = [];
  if (counts.urg) chips.push(chipSpan(`${counts.urg} Urgente`, "var(--R)"));
  if (counts.rev) chips.push(chipSpan(`${counts.rev} Revisar`, "var(--A)"));
  if (counts.comp) chips.push(chipSpan(`${counts.comp} Completar`, "var(--B)"));
  if (counts.done) chips.push(chipSpan(`${counts.done} Atendido`, "var(--G)"));
  chips.forEach((c, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "ck-sep";
      sep.textContent = "·";
      wrap.appendChild(sep);
    }
    wrap.appendChild(c);
  });
  const totalSpan = document.createElement("span");
  totalSpan.className = "ck-total";
  totalSpan.textContent = `${total} total`;
  wrap.appendChild(totalSpan);
  return wrap;
}

function categoryOrder(): Record<string, number> {
  const ord = ["Llantas", "Fluidos", "Documentos", "Checklist"];
  const m: Record<string, number> = {};
  ord.forEach((c, i) => (m[c] = i));
  return m;
}

function findingItem(
  f: Finding,
  uid: string,
  isDone: boolean,
  highlightChange: boolean,
  onToggle?: (uid: string, text: string) => void,
): HTMLElement {
  const el = document.createElement("div");
  const cls = isDone
    ? "ck-done"
    : f.lv === "Urgente"
      ? "ck-fail-u"
      : f.lv === "Completar"
        ? "ck-fail-c"
        : "ck-fail-r";
  el.className = `ck-item ${cls}${isDone ? "" : " ck-actionable"}`;
  if (highlightChange) el.style.boxShadow = "inset 0 0 0 1.5px var(--O)";

  if (onToggle) {
    el.addEventListener("click", () => onToggle(uid, f.text));
  }

  const iconSpan = document.createElement("span");
  iconSpan.className = "ck-icon";
  const color = isDone
    ? "var(--G)"
    : f.lv === "Urgente"
      ? "var(--R)"
      : f.lv === "Completar"
        ? "var(--B)"
        : "var(--A)";
  iconSpan.style.color = color;
  if (isDone) {
    iconSpan.textContent = "✓";
  } else {
    const iconName = f.lv === "Urgente" ? "x" : f.lv === "Completar" ? "plus" : "alert-triangle";
    iconSpan.appendChild(lucideIcon(iconName));
  }
  el.appendChild(iconSpan);

  const textSpan = document.createElement("span");
  textSpan.textContent = f.text;
  el.appendChild(textSpan);
  return el;
}

// ═══════════════════════════════════════════════════════════════
//  renderChecklist — entry point
// ═══════════════════════════════════════════════════════════════

export function renderChecklist(container: HTMLElement, deps: RenderChecklistDeps): void {
  const { unit, checklistDB = {}, diff = null, onToggle } = deps;
  container.replaceChildren();

  if (unit.F.length === 0) {
    container.appendChild(emptyState());
    return;
  }

  const doneMap = checklistDB[unit.uid] ?? {};
  const counts = { urg: 0, rev: 0, comp: 0, done: 0 };
  for (const f of unit.F) {
    if (doneMap[f.text]?.done) counts.done++;
    else if (f.lv === "Urgente") counts.urg++;
    else if (f.lv === "Completar") counts.comp++;
    else counts.rev++;
  }
  const pendingTotal = counts.urg + counts.rev + counts.comp;

  // Summary + progress
  container.appendChild(summaryLine(counts, unit.F.length));
  container.appendChild(progressBar(counts.done, pendingTotal + counts.done));

  // Diff section (opcional)
  if (diff) {
    const diffEl = diffSection(diff);
    if (diffEl) container.appendChild(diffEl);
  }

  // Grouping by category
  const groups: Record<string, Finding[]> = {};
  for (const f of unit.F) {
    (groups[f.cat] = groups[f.cat] ?? []).push(f);
  }
  const ord = categoryOrder();
  const cats = Object.keys(groups).sort((a, b) => (ord[a] ?? 99) - (ord[b] ?? 99));

  const catsWrap = document.createElement("div");
  catsWrap.className = "ck-cats";

  // Build prev finding map for highlight
  const prevFMap = new Map<string, RiskLevel>();
  if (diff) {
    for (const f of diff.newFails) if (f.lv) prevFMap.set(f.item, f.lv); // stub
    // Technically, we only need to know if finding was in prev. We'll rely on diff categories.
  }
  const wasInPrev = (text: string): boolean => {
    if (!diff) return true; // sin diff, nunca highlight como nuevo
    // Si está en newFails, es NUEVO → no estaba en prev
    if (diff.newFails.some((d) => d.item === text)) return false;
    return true;
  };
  const changedRisk = (text: string): boolean => {
    if (!diff) return false;
    return diff.worsened.some((d) => d.item === text) || diff.improved.some((d) => d.item === text);
  };

  for (const cat of cats) {
    const findings = groups[cat] ?? [];
    const catWrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "ck-cat-ttl";
    const icon = CATI[cat as keyof typeof CATI] || "•";
    title.appendChild(document.createTextNode(`${icon} ${cat} `));
    const count = document.createElement("span");
    count.style.cssText = "font-size:9px;font-weight:600;color:var(--s2);font-style:normal";
    count.textContent = String(findings.length);
    title.appendChild(count);
    catWrap.appendChild(title);

    // Sort within category: Urgente → Revisar → Completar
    const sorted = [
      ...findings.filter((f) => f.lv === "Urgente"),
      ...findings.filter((f) => f.lv === "Revisar"),
      ...findings.filter((f) => f.lv === "Completar"),
    ];

    const grid = document.createElement("div");
    grid.className = "ck-grid";
    for (const f of sorted) {
      const isDone = Boolean(doneMap[f.text]?.done);
      const isNewItem = !wasInPrev(f.text);
      const isChanged = changedRisk(f.text);
      grid.appendChild(findingItem(f, unit.uid, isDone, isNewItem || isChanged, onToggle));
    }
    catWrap.appendChild(grid);
    catsWrap.appendChild(catWrap);
  }
  container.appendChild(catsWrap);
}
