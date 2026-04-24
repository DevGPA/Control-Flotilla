// renderKpisSemanales — 8 tarjetas KPI del módulo Semanales.
// Pure: buildKpisSemanales (reusa weeklyStore.buildKpisFromEntries + extras).
// DOM: renderKpisSemanales via createElement (XSS-safe).

import type { WeeklyPeriodo } from "./weeklyStore";
import { buildKpisFromEntries } from "./weeklyStore";

export type WeeklyKpiBucket = "all" | "Urgente" | "Revisar" | "OK" | "carroceria" | "llanta";

export type KpisSemanalesData = {
  total: number;
  urgente: number;
  revisar: number;
  ok: number;
  aceiteUrgente: number;
  aceiteRevisar: number;
  radiadorUrgente: number;
  radiadorRevisar: number;
  carroceriaUrgente: number;
  carroceriaRevisar: number;
  llantaRevisar: number;
  label: string;
};

export function buildKpisSemanales(periodo: WeeklyPeriodo | undefined): KpisSemanalesData | null {
  if (!periodo) return null;
  const base = buildKpisFromEntries(periodo.entries);
  return { ...base, label: periodo.label };
}

function pct(n: number, t: number): number {
  return t ? Math.round((n / t) * 100) : 0;
}

type CardOpts = {
  topColor: string;
  label: string;
  iconKey?: string;
  value: string | number;
  valueColor?: string;
  sub?: (HTMLElement | string)[];
  progressColor?: string;
  progressPct?: number;
  onClick?: () => void;
  title?: string;
};

function el(tag: string, className?: string, style?: string): HTMLElement {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (style) n.style.cssText = style;
  return n;
}

function icon(key: string, style: string): HTMLElement {
  const i = document.createElement("i");
  i.setAttribute("data-lucide", key);
  i.style.cssText = style;
  return i;
}

function buildCard(opts: CardOpts): HTMLElement {
  const card = el("div", opts.onClick ? "kc btn" : "kc");
  if (opts.title) card.title = opts.title;
  if (opts.onClick) card.addEventListener("click", opts.onClick);

  card.appendChild(el("div", "ktop", `background:${opts.topColor}`));

  const lbl = el("div", "klbl", "display:flex;align-items:center;gap:5px");
  if (opts.iconKey) lbl.appendChild(icon(opts.iconKey, "width:11px;height:11px"));
  lbl.appendChild(document.createTextNode(opts.label));
  card.appendChild(lbl);

  const val = el("div", "kval", opts.valueColor ? `color:${opts.valueColor}` : undefined);
  val.textContent = String(opts.value);
  card.appendChild(val);

  if (opts.sub && opts.sub.length) {
    const sub = el("div", "ksub");
    for (const s of opts.sub) {
      if (typeof s === "string") sub.appendChild(document.createTextNode(s));
      else sub.appendChild(s);
    }
    card.appendChild(sub);
  }

  if (opts.progressColor && opts.progressPct !== undefined) {
    card.appendChild(
      el("div", "kprog", `background:${opts.progressColor};width:${opts.progressPct}%`),
    );
  }
  return card;
}

export type RenderKpisSemanalesDeps = {
  container: HTMLElement;
  periodo: WeeklyPeriodo | undefined;
  onFilter: (bucket: WeeklyKpiBucket) => void;
};

export function renderKpisSemanales(deps: RenderKpisSemanalesDeps): KpisSemanalesData | null {
  const { container, periodo, onFilter } = deps;
  container.textContent = "";
  const k = buildKpisSemanales(periodo);
  if (!k) return null;

  const row = el("div", "kpi-row", "padding:10px 16px 6px");

  row.appendChild(
    buildCard({
      topColor: "var(--B)",
      label: "Total Revisadas",
      value: k.total,
      valueColor: "var(--w1)",
      sub: [k.label],
      onClick: () => onFilter("all"),
    }),
  );

  row.appendChild(
    buildCard({
      topColor: "var(--R)",
      iconKey: "zap",
      label: "Atención Urgente",
      value: k.urgente,
      valueColor: "var(--R)",
      sub: [`${pct(k.urgente, k.total)}% · requieren acción inmediata`],
      progressColor: "var(--R)",
      progressPct: pct(k.urgente, k.total),
      onClick: () => onFilter("Urgente"),
    }),
  );

  row.appendChild(
    buildCard({
      topColor: "var(--A)",
      iconKey: "alert-triangle",
      label: "Preventivo",
      value: k.revisar,
      valueColor: "var(--A)",
      sub: [`${pct(k.revisar, k.total)}% · programar mantenimiento`],
      progressColor: "var(--A)",
      progressPct: pct(k.revisar, k.total),
      onClick: () => onFilter("Revisar"),
    }),
  );

  const operativas = k.ok + k.revisar;
  row.appendChild(
    buildCard({
      topColor: "var(--G)",
      iconKey: "check-circle-2",
      label: "Operativas",
      value: operativas,
      valueColor: "var(--G)",
      sub: [`${pct(operativas, k.total)}% de la flota`],
      progressColor: "var(--G)",
      progressPct: pct(operativas, k.total),
      onClick: () => onFilter("all"),
      title: "Unidades que siguen operando (OK + Revisar). Solo Urgente queda fuera.",
    }),
  );

  const bodySum = k.carroceriaUrgente + k.carroceriaRevisar;
  const bodyColor = k.carroceriaUrgente
    ? "var(--R)"
    : k.carroceriaRevisar
      ? "var(--A)"
      : "var(--G)";
  const bodySubParts: (HTMLElement | string)[] = [];
  if (k.carroceriaUrgente) {
    bodySubParts.push(icon("zap", "width:9px;height:9px;vertical-align:-1px"));
    bodySubParts.push(` ${k.carroceriaUrgente} grave `);
  }
  if (k.carroceriaRevisar) {
    bodySubParts.push(icon("alert-triangle", "width:9px;height:9px;vertical-align:-1px"));
    bodySubParts.push(` ${k.carroceriaRevisar} leve`);
  }
  if (!bodySum) bodySubParts.push("Sin daños");
  row.appendChild(
    buildCard({
      topColor: "var(--A)",
      iconKey: "car",
      label: "Carrocería",
      value: bodySum || "0",
      valueColor: bodyColor,
      sub: bodySubParts,
      title: "Filtrar por daños en carrocería",
      onClick: () => onFilter("carroceria"),
    }),
  );

  const tireColor = k.llantaRevisar ? "var(--A)" : "var(--G)";
  const tireSubParts: (HTMLElement | string)[] = [];
  if (k.llantaRevisar) {
    tireSubParts.push(icon("alert-triangle", "width:9px;height:9px;vertical-align:-1px"));
    tireSubParts.push(` ${k.llantaRevisar} sin refacción func.`);
  } else {
    tireSubParts.push("Todas funcionales");
  }
  row.appendChild(
    buildCard({
      topColor: "var(--B)",
      iconKey: "wrench",
      label: "Llanta Ref.",
      value: k.llantaRevisar || "0",
      valueColor: tireColor,
      sub: tireSubParts,
      progressColor: "var(--A)",
      progressPct: pct(k.llantaRevisar, k.total),
      title: "Filtrar por llanta de refacción",
      onClick: () => onFilter("llanta"),
    }),
  );

  const aceColor = k.aceiteUrgente ? "var(--R)" : k.aceiteRevisar ? "var(--A)" : "var(--G)";
  const aceSubParts: (HTMLElement | string)[] = [];
  if (k.aceiteUrgente) {
    aceSubParts.push(icon("zap", "width:9px;height:9px;vertical-align:-1px"));
    aceSubParts.push(` ${k.aceiteUrgente} crítico `);
  }
  if (k.aceiteRevisar) {
    aceSubParts.push(icon("alert-triangle", "width:9px;height:9px;vertical-align:-1px"));
    aceSubParts.push(` ${k.aceiteRevisar} bajo`);
  }
  if (!k.aceiteUrgente && !k.aceiteRevisar) aceSubParts.push("Sin alertas");
  row.appendChild(
    buildCard({
      topColor: "var(--ac)",
      label: "Aceite Motor",
      value: k.aceiteUrgente || k.aceiteRevisar || "0",
      valueColor: aceColor,
      sub: aceSubParts,
    }),
  );

  const radColor = k.radiadorUrgente ? "var(--R)" : k.radiadorRevisar ? "var(--A)" : "var(--G)";
  const radSubParts: (HTMLElement | string)[] = [];
  if (k.radiadorUrgente) {
    radSubParts.push(icon("zap", "width:9px;height:9px;vertical-align:-1px"));
    radSubParts.push(` ${k.radiadorUrgente} crítico `);
  }
  if (k.radiadorRevisar) {
    radSubParts.push(icon("alert-triangle", "width:9px;height:9px;vertical-align:-1px"));
    radSubParts.push(` ${k.radiadorRevisar} bajo`);
  }
  if (!k.radiadorUrgente && !k.radiadorRevisar) radSubParts.push("Sin alertas");
  row.appendChild(
    buildCard({
      topColor: "var(--ac)",
      iconKey: "droplet",
      label: "Radiador",
      value: k.radiadorUrgente || k.radiadorRevisar || "0",
      valueColor: radColor,
      sub: radSubParts,
    }),
  );

  container.appendChild(row);
  return k;
}
