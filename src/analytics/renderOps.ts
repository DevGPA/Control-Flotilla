// Tablero operativo de Análisis — capa de RENDER (DOM via createElement, XSS-safe).
//
// Pinta las filas que produce opsTablero.ts. Cero cálculo aquí (patrón
// fleetMap: el criterio vive en la capa pura; esto solo pinta). El caller
// (buildAnalytics en el legado) resuelve contenedores y callbacks.

import type { SucursalOps, RadarOps, Reincidente, CostoUnidad } from "./opsTablero";

const PESO = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function emptyMsg(doc: Document, texto: string): HTMLElement {
  return el(doc, "div", "ops-empty", texto);
}

// ── Sucursales: cobertura y riesgo ───────────────────────────────────────────

export function renderSucursalesOps(
  container: HTMLElement,
  rows: ReadonlyArray<SucursalOps>,
  onBranchClick?: (sucursal: string) => void,
): void {
  const doc = container.ownerDocument;
  if (!rows.length) {
    container.replaceChildren(emptyMsg(doc, "Sin catálogo de flota para calcular cobertura."));
    return;
  }
  const table = el(doc, "table", "ops-table");
  const thead = el(doc, "thead");
  const trh = el(doc, "tr");
  for (const h of ["Sucursal", "Cobertura del ciclo", "Urgente", "A revisar"]) {
    trh.appendChild(el(doc, "th", undefined, h));
  }
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = el(doc, "tbody");
  for (const r of rows) {
    const tr = el(doc, "tr");
    if (onBranchClick) {
      tr.classList.add("ops-row-click");
      tr.title = `Ver las inspecciones de ${r.sucursal}`;
      tr.addEventListener("click", () => onBranchClick(r.sucursal));
    }
    tr.appendChild(el(doc, "td", "ops-suc", r.sucursal));
    // Cobertura: mini-barra + "18/22 · 82%"
    const tdCob = el(doc, "td", "ops-cob");
    const bar = el(doc, "div", "ops-bar");
    const fill = el(doc, "span", "ops-bar-fill");
    fill.style.width = `${Math.max(0, Math.min(100, r.pct))}%`;
    fill.dataset.nivel = r.pct >= 90 ? "ok" : r.pct >= 70 ? "warn" : "bad";
    bar.appendChild(fill);
    tdCob.appendChild(bar);
    tdCob.appendChild(el(doc, "span", "ops-cob-txt", `${r.conCheck}/${r.total} · ${r.pct}%`));
    tr.appendChild(tdCob);
    const tdU = el(doc, "td", "ops-num", r.urgentes ? String(r.urgentes) : "—");
    if (r.urgentes) tdU.dataset.sev = "bad";
    tr.appendChild(tdU);
    const tdR = el(doc, "td", "ops-num", r.revisar ? String(r.revisar) : "—");
    if (r.revisar) tdR.dataset.sev = "warn";
    tr.appendChild(tdR);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.replaceChildren(table);
}

// ── Radar de vencimientos ────────────────────────────────────────────────────

export function renderRadar(container: HTMLElement, radar: RadarOps): void {
  const doc = container.ownerDocument;
  if (!radar.items.length) {
    container.replaceChildren(
      emptyMsg(doc, "Sin vencimientos a la vista: servicios y documentos al corriente. ✓"),
    );
    return;
  }
  const frag = doc.createDocumentFragment();
  const head = el(doc, "div", "ops-radar-head");
  const chipV = el(
    doc,
    "span",
    "ops-chip",
    `${radar.vencidos} vencido${radar.vencidos !== 1 ? "s" : ""}`,
  );
  chipV.dataset.sev = "bad";
  const chipP = el(doc, "span", "ops-chip", `${radar.proximos} por vencer`);
  chipP.dataset.sev = "warn";
  head.append(chipV, chipP);
  frag.appendChild(head);
  const list = el(doc, "div", "ops-radar-list");
  for (const it of radar.items) {
    const row = el(doc, "div", "ops-radar-item");
    row.dataset.sev = it.severidad === "vencido" ? "bad" : "warn";
    row.appendChild(el(doc, "span", "ops-radar-eco", it.eco));
    row.appendChild(el(doc, "span", "ops-radar-que", it.que));
    row.appendChild(el(doc, "span", "ops-radar-det", it.detalle));
    row.appendChild(el(doc, "span", "ops-radar-suc", it.sucursal));
    list.appendChild(row);
  }
  frag.appendChild(list);
  container.replaceChildren(frag);
}

// ── Unidades reincidentes ────────────────────────────────────────────────────

export function renderReincidentes(
  container: HTMLElement,
  rows: ReadonlyArray<Reincidente>,
  onUnitClick?: (r: Reincidente) => void,
): void {
  const doc = container.ownerDocument;
  if (!rows.length) {
    container.replaceChildren(
      emptyMsg(doc, "Ninguna unidad reincidente en la ventana de 6 meses. ✓"),
    );
    return;
  }
  const table = el(doc, "table", "ops-table");
  const thead = el(doc, "thead");
  const trh = el(doc, "tr");
  for (const h of [
    "ECO",
    "Sucursal",
    "Meses c/ urgente",
    "Visitas a taller",
    "Gasto taller (6m)",
    "Último estado",
  ]) {
    trh.appendChild(el(doc, "th", undefined, h));
  }
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = el(doc, "tbody");
  for (const r of rows) {
    const tr = el(doc, "tr");
    // Clic solo cuando hay expediente de taller real que abrir (tallerKey).
    if (onUnitClick && r.tallerKey) {
      tr.classList.add("ops-row-click");
      tr.title = `Ver el expediente de taller de ${r.eco}`;
      tr.addEventListener("click", () => onUnitClick(r));
    }
    tr.appendChild(el(doc, "td", "ops-suc", r.eco));
    tr.appendChild(el(doc, "td", undefined, r.sucursal));
    const tdM = el(doc, "td", "ops-num", r.mesesUrgente ? String(r.mesesUrgente) : "—");
    if (r.mesesUrgente >= 2) tdM.dataset.sev = "bad";
    tr.appendChild(tdM);
    tr.appendChild(el(doc, "td", "ops-num", r.visitasTaller ? String(r.visitasTaller) : "—"));
    tr.appendChild(el(doc, "td", "ops-num", r.gastoTaller ? PESO.format(r.gastoTaller) : "—"));
    const tdE = el(doc, "td", undefined, r.ultimoRiesgo);
    if (r.ultimoRiesgo === "Urgente") tdE.dataset.sev = "bad";
    else if (r.ultimoRiesgo === "Revisar") tdE.dataset.sev = "warn";
    tr.appendChild(tdE);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.replaceChildren(table);
}

// ── Costo por unidad (reparar vs reemplazar) ─────────────────────────────────

export function renderCostoUnidad(
  container: HTMLElement,
  rows: ReadonlyArray<CostoUnidad>,
  onUnitClick?: (r: CostoUnidad) => void,
): void {
  const doc = container.ownerDocument;
  if (!rows.length) {
    container.replaceChildren(
      emptyMsg(doc, "Sin gasto de taller registrado en los últimos 12 meses."),
    );
    return;
  }
  const table = el(doc, "table", "ops-table");
  const thead = el(doc, "thead");
  const trh = el(doc, "tr");
  for (const h of ["ECO", "Unidad", "Sucursal", "Visitas", "Gasto 12m"]) {
    trh.appendChild(el(doc, "th", undefined, h));
  }
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = el(doc, "tbody");
  for (const r of rows) {
    const tr = el(doc, "tr");
    if (onUnitClick && r.tallerKey) {
      tr.classList.add("ops-row-click");
      tr.title = `Ver el expediente de taller de ${r.eco}`;
      tr.addEventListener("click", () => onUnitClick(r));
    }
    tr.appendChild(el(doc, "td", "ops-suc", r.eco));
    tr.appendChild(el(doc, "td", undefined, r.unidad));
    tr.appendChild(el(doc, "td", undefined, r.sucursal));
    tr.appendChild(el(doc, "td", "ops-num", String(r.visitas)));
    const tdG = el(doc, "td", "ops-num", PESO.format(r.gasto));
    tdG.dataset.sev = "bad";
    tr.appendChild(tdG);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.replaceChildren(table);
}
