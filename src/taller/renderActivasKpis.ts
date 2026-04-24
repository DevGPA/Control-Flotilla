// renderActivasKpis — KPI bar + donut + alert strip de "Operaciones Activas".
// Reemplaza el bloque inline de `renderActivas()` del legado (HTML ~4712-4847).
// DOM-API puro. Lógica de cómputo expuesta por separado para tests.
//
// Tarjetas:
//   1. En Revisión (% de activos)
//   2. Mtto Correctivo — click aplica filtro tipo=Correctivo
//   3. Mtto Preventivo — click aplica filtro tipo=Preventivo
//   4. Urgentes (+7 días) — click ordena por urgencia si nUrg>0
//   5. Días Prom. Estancia (3-tier: real > estimado > rev)
//   6. Donut distribución + leyenda con hover interactivo
//
// Alert strip: aparece cuando hay unidades con >7 días activas.

import { ESTADOS_CERRADOS, type TallerEntry, type TallerFilter } from "./types";

export type ActivasKpisDeps = {
  entries: TallerEntry[];
  filter?: TallerFilter;
  today?: Date;
  /** Callback al click en tarjeta Correctivo o Preventivo. */
  onFilterTipo?: (tipo: "Correctivo" | "Preventivo") => void;
  /** Callback al click en tarjeta Urgentes (solo si nUrg>0). */
  onSortUrgencia?: () => void;
};

export type ActivasKpis = {
  nActAll: number;
  nFiltered: number;
  nRev: number;
  nSin: number;
  nCorr: number;
  nPrev: number;
  nUrg: number;
  promDiasComp: number | null;
  promDiasEst: number | null;
  promDiasRev: number | null;
  urgentEcos: string[];
};

function isClosed(e: TallerEntry): boolean {
  return ESTADOS_CERRADOS.includes(e.estado);
}

function daysBetween(a: string, b: string): number | null {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round((tb - ta) / 86400000);
}

function norm(s?: string): string {
  return (s ?? "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function matchesFilter(e: TallerEntry, f: TallerFilter): boolean {
  if (f.sucursal && f.sucursal !== "all" && e.sucursal !== f.sucursal) return false;
  if (f.area && f.area !== "all" && e.area !== f.area) return false;
  if (f.tipo && f.tipo !== "all" && e.tipo !== f.tipo) return false;
  if (f.search) {
    const q = norm(f.search);
    const hit = [e.eco, e.plate, e.tecnico, e.brand, e.comentario, e.refacciones].some((x) => norm(x).includes(q));
    if (!hit) return false;
  }
  return true;
}

/** Toma latest-per-unitKey basado en updatedAt. */
function latestPerUnit(entries: TallerEntry[]): TallerEntry[] {
  const map = new Map<string, TallerEntry>();
  for (const e of entries) {
    const key = e.unitKey || e.id;
    const cur = map.get(key);
    if (!cur || (e.updatedAt ?? "") > (cur.updatedAt ?? "")) map.set(key, e);
  }
  return [...map.values()];
}

export function computeActivasKpis(
  entries: TallerEntry[],
  filter: TallerFilter = {},
  today: Date = new Date(),
): ActivasKpis {
  const latestAll = latestPerUnit(entries);
  const activosAll = latestAll.filter((e) => !isClosed(e));
  const filtered = activosAll.filter((e) => matchesFilter(e, filter));

  const nActAll = activosAll.length;
  const nFiltered = filtered.length;
  const nRev = latestAll.filter((e) => e.estado === "En Revisión").length;
  const nSin = latestAll.filter((e) => !e.estado).length;
  const nCorr = filtered.filter((e) => e.tipo === "Correctivo").length;
  const nPrev = filtered.filter((e) => e.tipo === "Preventivo").length;

  const urgent: TallerEntry[] = filtered.filter((e) => {
    if (!e.fentrada || isClosed(e)) return false;
    const d = daysBetween(e.fentrada, today.toISOString());
    return d != null && d > 7;
  });
  const nUrg = urgent.length;
  const urgentEcos = urgent.map((e) => e.eco || e.plate || e.id);

  // Días promedio — 3 tiers
  const compArr: number[] = [];
  for (const e of entries) {
    if (!isClosed(e) || !e.fentrada || !e.fsalidaReal) continue;
    const d = daysBetween(e.fentrada, e.fsalidaReal);
    if (d != null && d >= 0) compArr.push(d);
  }
  const estArr: number[] = [];
  const revArr: number[] = [];
  for (const e of filtered) {
    if (e.estado !== "En Revisión" || !e.fentrada) continue;
    if (e.fsalidaEst) {
      const d = daysBetween(e.fentrada, e.fsalidaEst);
      if (d != null && d >= 0) estArr.push(d);
    }
    const dR = daysBetween(e.fentrada, today.toISOString());
    if (dR != null && dR >= 0) revArr.push(dR);
  }
  const avg = (arr: number[]): number | null =>
    arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

  return {
    nActAll,
    nFiltered,
    nRev,
    nSin,
    nCorr,
    nPrev,
    nUrg,
    promDiasComp: avg(compArr),
    promDiasEst: avg(estArr),
    promDiasRev: avg(revArr),
    urgentEcos,
  };
}

// ═══════════════════════════════════════════════════════════════
//  DOM builders
// ═══════════════════════════════════════════════════════════════

function lucide(name: string, size = 11): HTMLElement {
  const i = document.createElement("i");
  i.setAttribute("data-lucide", name);
  i.style.cssText = `width:${size}px;height:${size}px`;
  return i;
}

function buildLbl(icon: string, text: string): HTMLElement {
  const d = document.createElement("div");
  d.className = "klbl";
  d.style.cssText = "display:flex;align-items:center;gap:5px";
  d.appendChild(lucide(icon));
  d.appendChild(document.createTextNode(" " + text));
  return d;
}

function buildStatCard(opts: {
  color: string;
  iconName: string;
  label: string;
  value: string;
  sub: string;
  pct?: number;
  extraStyle?: string;
  onClick?: () => void;
  title?: string;
}): HTMLElement {
  const card = document.createElement("div");
  card.className = "kc";
  if (opts.onClick) card.style.cursor = "pointer";
  if (opts.extraStyle) card.style.cssText += opts.extraStyle;
  if (opts.title) card.title = opts.title;
  if (opts.onClick) card.addEventListener("click", opts.onClick);

  const top = document.createElement("div");
  top.className = "ktop";
  top.style.background = opts.color;
  card.appendChild(top);

  card.appendChild(buildLbl(opts.iconName, opts.label));

  const val = document.createElement("div");
  val.className = "kval";
  val.style.color = opts.color;
  val.textContent = opts.value;
  card.appendChild(val);

  const sub = document.createElement("div");
  sub.className = "ksub";
  sub.textContent = opts.sub;
  card.appendChild(sub);

  if (opts.pct != null) {
    const prog = document.createElement("div");
    prog.className = "kprog";
    prog.style.cssText = `background:${opts.color};width:${opts.pct}%`;
    card.appendChild(prog);
  }
  return card;
}

function buildDonut(kpis: ActivasKpis): {
  wrap: HTMLElement;
  pct: HTMLElement;
  tag: HTMLElement;
  segments: HTMLElement[];
} {
  const dR = 26;
  const dcx = 32;
  const dcy = 32;
  const dsw = 8;
  const dcirc = 2 * Math.PI * dR;
  const t = Math.max(kpis.nActAll, 1);
  const revPct = kpis.nActAll ? Math.round((kpis.nRev / kpis.nActAll) * 100) : 0;

  const entries: Array<[string, number, string]> = [
    ["rev", kpis.nRev, "var(--A)"],
    ["sin", kpis.nSin, "var(--s3)"],
  ];
  const present = entries.filter(([, v]) => v > 0);
  const gap = present.length > 1 ? dcirc * 0.012 : 0;

  const wrap = document.createElement("div");
  wrap.className = "dwrap";
  wrap.id = "tl-dwrap";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("dsvg");
  svg.setAttribute("width", "66");
  svg.setAttribute("height", "66");
  svg.setAttribute("viewBox", "0 0 64 64");

  const bg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  bg.setAttribute("cx", String(dcx));
  bg.setAttribute("cy", String(dcy));
  bg.setAttribute("r", String(dR));
  bg.setAttribute("fill", "none");
  bg.setAttribute("stroke", "var(--bg4)");
  bg.setAttribute("stroke-width", String(dsw));
  svg.appendChild(bg);

  const segmentEls: HTMLElement[] = [];
  let doff = 0;
  for (const [k, v, c] of present) {
    const raw = (v / t) * dcirc;
    const d = Math.max(raw - gap, dcirc * 0.005);
    const g = dcirc - d;
    const seg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    seg.setAttribute("data-k", k);
    seg.setAttribute("cx", String(dcx));
    seg.setAttribute("cy", String(dcy));
    seg.setAttribute("r", String(dR));
    seg.setAttribute("fill", "none");
    seg.setAttribute("stroke", c);
    seg.setAttribute("stroke-width", String(dsw));
    seg.setAttribute("stroke-linecap", "round");
    seg.setAttribute("stroke-dasharray", `${d.toFixed(2)} ${g.toFixed(2)}`);
    seg.setAttribute("stroke-dashoffset", (-doff).toFixed(2));
    svg.appendChild(seg);
    segmentEls.push(seg as unknown as HTMLElement);
    doff += d + gap;
  }
  wrap.appendChild(svg);

  const mid = document.createElement("div");
  mid.className = "dmid";
  const tag = document.createElement("div");
  tag.className = "dtag";
  tag.style.cssText = "color:var(--A);background:var(--Ad)";
  tag.textContent = "ACTIVOS";
  const pct = document.createElement("div");
  pct.className = "dpct";
  pct.style.color = "var(--A)";
  pct.textContent = `${revPct}%`;
  mid.appendChild(tag);
  mid.appendChild(pct);
  wrap.appendChild(mid);

  return { wrap, pct, tag, segments: segmentEls };
}

function buildDonutCard(kpis: ActivasKpis): HTMLElement {
  const card = document.createElement("div");
  card.className = "kc kc-donut";

  const top = document.createElement("div");
  top.className = "ktop";
  top.style.background = "var(--ac)";
  card.appendChild(top);

  const { wrap, pct, tag, segments } = buildDonut(kpis);
  card.appendChild(wrap);

  const side = document.createElement("div");
  side.style.cssText = "display:flex;flex-direction:column;gap:4px;min-width:0";
  side.appendChild(buildLbl("pie-chart", "Distribución"));

  const leg = document.createElement("div");
  leg.className = "dleg";
  leg.id = "tl-dleg";
  const legendEntries: Array<[string, string, string, number]> = [
    ["rev", "var(--A)", "En Revisión", kpis.nRev],
    ["sin", "var(--s3)", "Sin Reg.", kpis.nSin],
  ];
  const legendItemEls: HTMLElement[] = [];
  for (const [k, c, l, n] of legendEntries) {
    const item = document.createElement("div");
    item.className = "dleg-i";
    item.dataset.k = k;
    const lbl = document.createElement("span");
    lbl.className = "dleg-lbl";
    const sq = document.createElement("span");
    sq.className = "dleg-sq";
    sq.style.background = c;
    lbl.appendChild(sq);
    lbl.appendChild(document.createTextNode(l));
    const num = document.createElement("span");
    num.className = "dleg-num";
    num.style.color = c;
    num.textContent = String(n);
    item.appendChild(lbl);
    item.appendChild(num);
    leg.appendChild(item);
    legendItemEls.push(item);
  }
  side.appendChild(leg);
  card.appendChild(side);

  wireDonutHover(kpis, { pct, tag, segments, legendItems: legendItemEls });
  return card;
}

function wireDonutHover(
  kpis: ActivasKpis,
  parts: {
    pct: HTMLElement;
    tag: HTMLElement;
    segments: HTMLElement[];
    legendItems: HTMLElement[];
  },
): void {
  const pctOf = (n: number): number => (kpis.nActAll ? Math.round((n / kpis.nActAll) * 100) : 0);
  const map: Record<string, { pct: number; label: string; color: string; bg: string }> = {
    rev: { pct: pctOf(kpis.nRev), label: "EN REVISIÓN", color: "var(--A)", bg: "var(--Ad)" },
    sin: { pct: pctOf(kpis.nSin), label: "SIN REG.",    color: "var(--s3)", bg: "var(--bg3)" },
  };
  const defPct = { txt: parts.pct.textContent ?? "", color: parts.pct.style.color };
  const defTag = { txt: parts.tag.textContent ?? "", color: parts.tag.style.color, bg: parts.tag.style.background };

  const enter = (k: string) => {
    for (const el of parts.legendItems) if (el.dataset.k !== k) el.classList.add("dim");
    for (const el of parts.segments) if ((el as unknown as SVGElement).getAttribute("data-k") !== k) el.classList.add("dim");
    const h = map[k];
    if (!h) return;
    parts.pct.textContent = h.pct + "%";
    parts.pct.style.color = h.color;
    parts.tag.textContent = h.label;
    parts.tag.style.color = h.color;
    parts.tag.style.background = h.bg;
  };
  const leave = () => {
    for (const el of parts.legendItems) el.classList.remove("dim");
    for (const el of parts.segments) el.classList.remove("dim");
    parts.pct.textContent = defPct.txt;
    parts.pct.style.color = defPct.color;
    parts.tag.textContent = defTag.txt;
    parts.tag.style.color = defTag.color;
    parts.tag.style.background = defTag.bg;
  };
  for (const el of parts.legendItems) {
    const k = el.dataset.k;
    if (!k) continue;
    el.addEventListener("mouseenter", () => enter(k));
    el.addEventListener("mouseleave", leave);
  }
  for (const el of parts.segments) {
    const k = (el as unknown as SVGElement).getAttribute("data-k");
    if (!k) continue;
    el.style.cursor = "pointer";
    el.addEventListener("mouseenter", () => enter(k));
    el.addEventListener("mouseleave", leave);
  }
}

function buildAlertStrip(urgentEcos: string[]): HTMLElement | null {
  if (!urgentEcos.length) return null;
  const strip = document.createElement("div");
  strip.style.cssText =
    "padding:6px 16px;font-size:11px;background:linear-gradient(90deg,var(--Ad),var(--bg2));border-bottom:1px solid var(--Al);color:var(--s1)";
  const head = document.createElement("span");
  head.style.cssText = "color:var(--A);display:inline-flex;align-items:center;gap:4px";
  head.appendChild(lucide("alert-triangle", 11));
  const lead = urgentEcos.length > 1
    ? ` ${urgentEcos.length} unidades llevan más de 7 días sin salir:`
    : ` ${urgentEcos.length} unidad lleva más de 7 días sin salir:`;
  head.appendChild(document.createTextNode(lead));
  strip.appendChild(head);
  strip.appendChild(document.createTextNode(" "));
  const b = document.createElement("b");
  const first5 = urgentEcos.slice(0, 5).join(", ");
  b.textContent = urgentEcos.length > 5 ? `${first5} y ${urgentEcos.length - 5} más...` : first5;
  strip.appendChild(b);
  return strip;
}

// ═══════════════════════════════════════════════════════════════
//  renderActivasKpis — entry point
// ═══════════════════════════════════════════════════════════════

export function renderActivasKpis(container: HTMLElement, deps: ActivasKpisDeps): ActivasKpis {
  const { entries, filter = {}, today = new Date(), onFilterTipo, onSortUrgencia } = deps;
  const kpis = computeActivasKpis(entries, filter, today);
  container.replaceChildren();

  const wrap = document.createElement("div");
  wrap.style.cssText = "padding:14px 16px 6px;background:var(--bg2);border-bottom:1px solid var(--ln)";

  const row = document.createElement("div");
  row.className = "kpi-row";

  const pct = (n: number): number => (kpis.nActAll ? Math.round((n / kpis.nActAll) * 100) : 0);

  // 1. En Revisión
  row.appendChild(buildStatCard({
    color: "var(--A)",
    iconName: "search",
    label: "En Revisión",
    value: String(kpis.nRev),
    sub: `${pct(kpis.nRev)}% de activos`,
    pct: pct(kpis.nRev),
  }));

  // 2. Correctivo
  row.appendChild(buildStatCard({
    color: "var(--R)",
    iconName: "wrench",
    label: "Mtto Correctivo",
    value: String(kpis.nCorr),
    sub: `${pct(kpis.nCorr)}% de activos`,
    pct: pct(kpis.nCorr),
    onClick: () => onFilterTipo?.("Correctivo"),
  }));

  // 3. Preventivo
  row.appendChild(buildStatCard({
    color: "var(--B)",
    iconName: "shield-check",
    label: "Mtto Preventivo",
    value: String(kpis.nPrev),
    sub: `${pct(kpis.nPrev)}% de activos`,
    pct: pct(kpis.nPrev),
    onClick: () => onFilterTipo?.("Preventivo"),
  }));

  // 4. Urgentes
  const urgActive = kpis.nUrg > 0;
  row.appendChild(buildStatCard({
    color: urgActive ? "var(--R)" : "var(--s3)",
    iconName: "alert-triangle",
    label: "Urgentes (+7 días)",
    value: String(kpis.nUrg),
    sub: urgActive ? `${pct(kpis.nUrg)}% de activos` : "Sin alertas activas",
    pct: urgActive ? pct(kpis.nUrg) : 0,
    extraStyle: urgActive ? "border:1px solid var(--Al)" : "",
    onClick: urgActive ? () => onSortUrgencia?.() : undefined,
    title: urgActive ? "Click para ordenar por días" : "Sin alertas activas",
  }));

  // 5. Días Prom Estancia (3-tier)
  const prom = kpis.promDiasComp ?? kpis.promDiasEst ?? kpis.promDiasRev;
  const promSub = kpis.promDiasComp != null
    ? "Prom. real (finalizados)"
    : kpis.promDiasEst != null
    ? "Prom. estimado"
    : "Días activos en taller";
  row.appendChild(buildStatCard({
    color: "var(--ac)",
    iconName: "clock",
    label: "Días Prom. Estancia",
    value: prom != null ? `${prom}d` : "—",
    sub: promSub,
  }));

  // 6. Donut
  row.appendChild(buildDonutCard(kpis));

  wrap.appendChild(row);
  container.appendChild(wrap);

  const alert = buildAlertStrip(kpis.urgentEcos);
  if (alert) container.appendChild(alert);

  return kpis;
}
