// renderService — sub-tab "Servicio" del panel detalle (case "o" legado).
// Muestra: observaciones del responsable + historial de servicio + última
// revisión semanal (cross-reference) si hay datos.
// DOM-API puro, zero innerHTML.

import type { RiskLevel, Unit, WeeklyEntry } from "../../types";

/** Periodos semanales cargados en memoria (estructura del legado). */
export type WeeklyPeriodo = {
  id?: string;
  label: string;
  entries: (WeeklyEntry & { aceite?: string; radiador?: string })[];
};

export type UnitSvc = Unit & {
  lastSvc?: string;
  kmNextSvc?: number | string;
};

export type RenderServiceDeps = {
  unit: UnitSvc;
  /** Periodos semanales para cross-reference (opcional). */
  weeklyPeriodos?: WeeklyPeriodo[];
};

function riskColor(r?: RiskLevel): string {
  return r === "Urgente" ? "var(--R)" : r === "Revisar" ? "var(--A)" : "var(--G)";
}

function lucideIcon(name: string, size = 12): HTMLElement {
  const i = document.createElement("i");
  i.setAttribute("data-lucide", name);
  i.style.cssText = `width:${size}px;height:${size}px`;
  return i;
}

function obsSection(unit: UnitSvc): HTMLElement {
  const arr = unit.obsArr && unit.obsArr.length ? unit.obsArr : unit.obs ? [unit.obs] : [];
  const wrap = document.createElement("div");
  wrap.style.marginBottom = "12px";

  if (arr.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "color:var(--s3);font-size:11px;padding:12px 0;text-align:center";
    empty.textContent = "Sin observaciones registradas.";
    wrap.appendChild(empty);
    return wrap;
  }

  const title = document.createElement("div");
  title.className = "catttl";
  title.style.cssText = "display:flex;align-items:center;gap:6px";
  title.appendChild(lucideIcon("message-square", 12));
  title.appendChild(document.createTextNode(" Comentarios del responsable"));
  if (arr.length > 1) {
    const badge = document.createElement("span");
    badge.style.cssText =
      "font-size:9px;background:var(--Bd);color:var(--B);padding:1px 8px;border-radius:4px;font-weight:700";
    badge.textContent = String(arr.length);
    title.appendChild(document.createTextNode(" "));
    title.appendChild(badge);
  }
  wrap.appendChild(title);

  for (let i = 0; i < arr.length; i++) {
    const card = document.createElement("div");
    card.className = "obscard";
    if (arr.length > 1) {
      const hdr = document.createElement("div");
      hdr.className = "obscard-hdr";
      const n = document.createElement("span");
      n.className = "obscard-n";
      n.textContent = `Comentario ${i + 1} de ${arr.length}`;
      hdr.appendChild(n);
      card.appendChild(hdr);
    }
    const txt = document.createElement("div");
    txt.className = "obscard-txt";
    txt.textContent = arr[i] ?? "";
    card.appendChild(txt);
    wrap.appendChild(card);
  }

  return wrap;
}

function serviceCard(unit: UnitSvc): HTMLElement | null {
  if (!unit.lastSvc && !unit.nextSvc && !unit.kmNextSvc) return null;
  const card = document.createElement("div");
  card.className = "svccard";

  const title = document.createElement("div");
  title.className = "svcttl";
  title.textContent = "Historial de servicio";
  card.appendChild(title);

  const addRow = (label: string, value: string, valueColor?: string): void => {
    const row = document.createElement("div");
    row.className = "svcrow";
    const lbl = document.createElement("span");
    lbl.textContent = label;
    row.appendChild(lbl);
    const val = document.createElement("span");
    val.className = "svcval";
    if (valueColor) val.style.color = valueColor;
    val.textContent = value;
    row.appendChild(val);
    card.appendChild(row);
  };

  if (unit.lastSvc) addRow("Último servicio", unit.lastSvc);
  if (unit.nextSvc) addRow("Próximo servicio", unit.nextSvc, "var(--A)");
  if (unit.kmNextSvc !== undefined && unit.kmNextSvc !== "") {
    addRow("KM del próximo", `${Number(unit.kmNextSvc).toLocaleString("es-MX")} km`);
  }

  return card;
}

function weeklyCrossRefCard(unit: Unit, weeklyPeriodos: WeeklyPeriodo[]): HTMLElement | null {
  // Encuentra la última entrada semanal que referencia esta unidad
  const candidates = weeklyPeriodos.flatMap((p) =>
    p.entries
      .filter(
        (e) =>
          e.uid === unit.uid ||
          (e.eco && e.eco === unit.eco) ||
          (e.plate && unit.plate && e.plate === unit.plate),
      )
      .map((e) => ({ ...e, _periodo: p.label })),
  );
  if (candidates.length === 0) return null;

  // Sort descendente por label (periodos en formato ISO-ish suelen ordenar bien)
  candidates.sort((a, b) => (b._periodo || "").localeCompare(a._periodo || ""));
  const latest = candidates[0];
  if (!latest) return null;

  const card = document.createElement("div");
  card.className = "sw-svccard";

  const title = document.createElement("div");
  title.className = "sw-svccard-ttl";
  title.style.cssText = "display:flex;align-items:center;gap:6px";
  title.appendChild(lucideIcon("clipboard-list", 13));
  title.appendChild(document.createTextNode(` Última revisión semanal · ${latest._periodo}`));
  card.appendChild(title);

  const addSwRow = (label: string, value: string, valueColor?: string): void => {
    const row = document.createElement("div");
    row.className = "sw-svcrow";
    const lbl = document.createElement("span");
    lbl.textContent = label;
    row.appendChild(lbl);
    const val = document.createElement("span");
    val.className = "sw-svcval";
    if (valueColor) val.style.color = valueColor;
    val.textContent = value;
    row.appendChild(val);
    card.appendChild(row);
  };

  addSwRow("Fecha", latest.fecha || "—");
  addSwRow(
    "Aceite Motor",
    (latest as { aceite?: string }).aceite || latest.aceiteRisk || "—",
    riskColor(latest.aceiteRisk),
  );
  addSwRow(
    "Radiador",
    (latest as { radiador?: string }).radiador || latest.radiadorRisk || "—",
    riskColor(latest.radiadorRisk),
  );

  return card;
}

// ═══════════════════════════════════════════════════════════════
//  renderService — entry point
// ═══════════════════════════════════════════════════════════════

export function renderService(container: HTMLElement, deps: RenderServiceDeps): void {
  const { unit, weeklyPeriodos = [] } = deps;
  container.replaceChildren();

  container.appendChild(obsSection(unit));

  const svcCard = serviceCard(unit);
  if (svcCard) container.appendChild(svcCard);

  const weekly = weeklyCrossRefCard(unit, weeklyPeriodos);
  if (weekly) container.appendChild(weekly);
}
