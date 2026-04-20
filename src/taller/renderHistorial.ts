// renderHistorial — sub-tab "Historial" del módulo Taller.
// Reemplaza la función `renderHistorial()` del legado (línea ~4913 en HTML).
// DOM-API puro (no innerHTML con user input). Lógica de agrupado + totales
// vive aquí (específica al historial); reutiliza helpers genéricos de
// tallerStore cuando aplica.
//
// Capacidades:
//   - Agrupa entries por unitKey — 1 fila por unidad con ≥1 ingreso cerrado
//   - Filtros: sucursal, tipo mantenimiento (Correctivo/Preventivo/sin/all),
//     búsqueda libre eco/plate/brand, rango de fechas sobre fentrada cerrada
//   - Sort: eco, plate, brand, sucursal, fentrada, fsalidaReal (tie-break
//     por updatedAt del último cerrado desc)
//   - KPI bar: gasto total, promedio por visita, visitas, unidades, Top5
//   - Callbacks: onOpen(unitKey), onReingreso(unitKey), onSort(col)

import { ESTADOS_CERRADOS } from "./types";
import type { TallerEntry } from "./types";

export type HistorialSortKey = "eco" | "plate" | "brand" | "sucursal" | "fentrada" | "fsalidaReal";

export type HistorialFilter = {
  sucursal?: string; // "all" o nombre
  tipo?: string; // "all" | "Correctivo" | "Preventivo" | "sin"
  search?: string;
  /** ISO "YYYY-MM-DD" inclusivo. */
  desde?: string;
  hasta?: string;
};

export type RenderHistorialDeps = {
  entries: TallerEntry[];
  filter?: HistorialFilter;
  sortCol?: HistorialSortKey | null;
  sortDir?: 1 | -1;
  /** KPI bar container. Opcional: si no se pasa, no se renderiza. */
  kpiBar?: HTMLElement | null;
  onOpen?: (unitKey: string) => void;
  onReingreso?: (unitKey: string) => void;
  onSort?: (col: HistorialSortKey) => void;
};

export type HistorialRow = {
  unitKey: string;
  entries: TallerEntry[];
  latestClosed: TallerEntry;
  latest: TallerEntry;
  closedCount: number;
  totalGasto: number;
  totalGastoRef: number;
  totalGastoMO: number;
};

export type HistorialSummary = {
  visibles: number;
  totalGasto: number;
  totalVisitas: number;
};

const COLS: Array<{ lbl: string; key: HistorialSortKey | null; w: string }> = [
  { lbl: "Unidad",       key: "eco",         w: "70px" },
  { lbl: "Placas",       key: "plate",       w: "110px" },
  { lbl: "Modelo",       key: "brand",       w: "auto" },
  { lbl: "Sucursal",     key: "sucursal",    w: "auto" },
  { lbl: "Visitas",      key: null,          w: "110px" },
  { lbl: "Últ. Ingreso", key: "fentrada",    w: "100px" },
  { lbl: "F. Salida",    key: "fsalidaReal", w: "100px" },
  { lbl: "Días",         key: null,          w: "60px" },
  { lbl: "Gasto",        key: null,          w: "100px" },
];

function fmtDate(d?: string): string {
  if (!d) return "—";
  const parts = d.slice(0, 10).split("-");
  if (parts.length !== 3) return d;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function fmtMXN(n: number): string {
  if (!n || n <= 0) return "$0";
  return "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function isClosed(e: TallerEntry): boolean {
  return ESTADOS_CERRADOS.includes(e.estado);
}

function norm(s?: string): string {
  return (s ?? "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function matchesQuery(lc: TallerEntry, q: string): boolean {
  if (!q) return true;
  const qn = norm(q);
  return [lc.eco, lc.plate, lc.brand].some((f) => norm(f).includes(qn));
}

function tipoMatch(e: TallerEntry, filt: string | undefined): boolean {
  if (!filt || filt === "all") return true;
  if (filt === "sin") return !e.tipo;
  return e.tipo === filt;
}

/**
 * Agrupa entries por unitKey y computa agregados por unidad.
 * Solo aplica filtros de fecha y tipo sobre entries *cerradas* (para el conteo
 * y totales). Devuelve únicamente unidades con ≥1 ingreso cerrado después de
 * aplicar esos filtros.
 */
export function buildHistorialRows(
  entries: TallerEntry[],
  filter: HistorialFilter = {},
): HistorialRow[] {
  const map = new Map<string, HistorialRow>();
  for (const e of entries) {
    const key = e.unitKey || e.id;
    let row = map.get(key);
    if (!row) {
      row = {
        unitKey: key,
        entries: [],
        latestClosed: e,
        latest: e,
        closedCount: 0,
        totalGasto: 0,
        totalGastoRef: 0,
        totalGastoMO: 0,
      };
      map.set(key, row);
    }
    row.entries.push(e);
    if ((e.updatedAt ?? "") > (row.latest.updatedAt ?? "")) row.latest = e;

    if (!isClosed(e)) continue;

    // Filtros de fecha sobre fentrada del cerrado
    if (filter.desde && e.fentrada && e.fentrada < filter.desde) continue;
    if (filter.hasta && e.fentrada && e.fentrada > filter.hasta) continue;
    // Filtro tipo mantenimiento
    if (!tipoMatch(e, filter.tipo)) continue;

    row.closedCount++;
    const gRef = e.gastoRef ?? 0;
    const gMO = e.gastoMO ?? 0;
    const gTot = gRef + gMO > 0 ? gRef + gMO : e.gasto ?? 0;
    row.totalGasto += gTot;
    row.totalGastoRef += gRef;
    row.totalGastoMO += gMO;
    if (!row.latestClosed || (e.updatedAt ?? "") > (row.latestClosed.updatedAt ?? "")) {
      row.latestClosed = e;
    }
  }

  const rows: HistorialRow[] = [];
  for (const r of map.values()) {
    if (r.closedCount === 0) continue;
    // latestClosed podría quedar con el entry inicial (no cerrado) si no se
    // actualizó — reemplaza por el primer cerrado encontrado en entries
    if (!isClosed(r.latestClosed)) {
      const anyClosed = r.entries.find(isClosed);
      if (anyClosed) r.latestClosed = anyClosed;
    }
    rows.push(r);
  }
  return rows;
}

export function filterAndSortHistorial(
  rows: HistorialRow[],
  filter: HistorialFilter,
  sortCol: HistorialSortKey | null,
  sortDir: 1 | -1,
): HistorialRow[] {
  const filtered = rows.filter((r) => {
    const lc = r.latestClosed;
    if (filter.sucursal && filter.sucursal !== "all" && lc.sucursal !== filter.sucursal) return false;
    if (filter.search && !matchesQuery(lc, filter.search)) return false;
    return true;
  });

  return filtered.sort((a, b) => {
    if (sortCol) {
      const va = String(a.latestClosed[sortCol as keyof TallerEntry] ?? "");
      const vb = String(b.latestClosed[sortCol as keyof TallerEntry] ?? "");
      const cmp = va.localeCompare(vb, undefined, { numeric: true, sensitivity: "base" });
      if (cmp !== 0) return cmp * sortDir;
    }
    // Tie-break: updatedAt del cerrado desc
    const uA = a.latestClosed.updatedAt ?? "";
    const uB = b.latestClosed.updatedAt ?? "";
    return uB.localeCompare(uA);
  });
}

// ═══════════════════════════════════════════════════════════════
//  Renderizado DOM
// ═══════════════════════════════════════════════════════════════

function buildThead(
  thead: HTMLElement,
  sortCol: HistorialSortKey | null,
  sortDir: 1 | -1,
  onSort?: (c: HistorialSortKey) => void,
): void {
  const tr = document.createElement("tr");
  for (const c of COLS) {
    const th = document.createElement("th");
    if (c.w && c.w !== "auto") th.style.width = c.w;
    if (c.key && onSort) {
      th.style.cursor = "pointer";
      th.style.userSelect = "none";
      const active = sortCol === c.key;
      if (active) th.style.color = "var(--ac)";
      const arrow = active ? (sortDir === 1 ? " ▲" : " ▼") : "";
      th.textContent = c.lbl + arrow;
      const key = c.key;
      th.addEventListener("click", () => onSort(key));
    } else {
      th.textContent = c.lbl;
    }
    tr.appendChild(th);
  }
  thead.replaceChildren(tr);
}

function buildEmptyRow(q: string, desde: string, hasta: string): HTMLElement {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = COLS.length;
  td.className = "tl-empty";
  if (q) {
    td.appendChild(document.createTextNode("Sin resultados para «"));
    const b = document.createElement("b");
    b.textContent = q;
    td.appendChild(b);
    td.appendChild(document.createTextNode("»."));
  } else if (desde || hasta) {
    td.textContent = "Sin registros en el período seleccionado.";
  } else {
    td.textContent = "Sin unidades finalizadas aún.";
  }
  td.appendChild(document.createElement("br"));
  const hint = document.createElement("span");
  hint.style.fontSize = "10px";
  hint.textContent = "Las unidades aparecen aquí cuando se marca un ingreso como Finalizado en Operaciones Activas.";
  td.appendChild(hint);
  tr.appendChild(td);
  return tr;
}

function buildDataRow(
  row: HistorialRow,
  onOpen?: (unitKey: string) => void,
  onReingreso?: (unitKey: string) => void,
): HTMLElement {
  const lc = row.latestClosed;
  const tr = document.createElement("tr");
  tr.style.cursor = "pointer";
  tr.title = "Clic para ver expediente completo";
  if (onOpen) tr.addEventListener("click", () => onOpen(row.unitKey));

  // Unidad + EN TALLER tag
  const tdEco = document.createElement("td");
  tdEco.style.fontWeight = "700";
  tdEco.style.color = "var(--w1)";
  tdEco.appendChild(document.createTextNode(lc.eco || "—"));
  const isActive = !isClosed(row.latest);
  if (isActive) {
    const tag = document.createElement("span");
    tag.style.cssText = "font-size:8px;font-weight:700;color:var(--A);background:var(--Ad);padding:1px 5px;border-radius:3px;margin-left:4px";
    tag.textContent = "EN TALLER";
    tdEco.appendChild(tag);
  }
  tr.appendChild(tdEco);

  // Placas
  const tdPlate = document.createElement("td");
  tdPlate.style.fontWeight = "600";
  tdPlate.style.color = "var(--ac)";
  tdPlate.textContent = lc.plate || "—";
  tr.appendChild(tdPlate);

  // Modelo
  const tdBrand = document.createElement("td");
  tdBrand.style.color = "var(--s1)";
  tdBrand.textContent = lc.brand || "—";
  tr.appendChild(tdBrand);

  // Sucursal
  const tdSuc = document.createElement("td");
  tdSuc.style.cssText = "font-size:10px;color:var(--s2)";
  tdSuc.textContent = lc.sucursal || "—";
  tr.appendChild(tdSuc);

  // Visitas + reingreso btn + tipo mix
  const tdVis = document.createElement("td");
  tdVis.style.cssText = "text-align:center;white-space:nowrap;vertical-align:top";
  const visWrap = document.createElement("div");
  visWrap.style.cssText = "display:inline-flex;align-items:center;gap:3px";
  const visBadge = document.createElement("span");
  visBadge.className = "tl-hist-badge";
  visBadge.style.cursor = "default";
  visBadge.textContent = String(row.entries.length);
  visWrap.appendChild(visBadge);
  const reBtn = document.createElement("button");
  reBtn.className = "tl-reing-btn";
  reBtn.style.padding = "2px 5px";
  reBtn.title = "Nuevo ingreso al taller";
  reBtn.textContent = "↩";
  reBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    onReingreso?.(row.unitKey);
  });
  visWrap.appendChild(reBtn);
  tdVis.appendChild(visWrap);
  // Tipo mix C/P
  const nCor = row.entries.filter((x) => x.tipo === "Correctivo").length;
  const nPrev = row.entries.filter((x) => x.tipo === "Preventivo").length;
  if (nCor || nPrev) {
    const mix = document.createElement("div");
    mix.style.cssText = "font-size:8px;margin-top:2px;white-space:nowrap;line-height:1.1";
    if (nCor) {
      const cSpan = document.createElement("span");
      cSpan.style.cssText = "color:#B91C1C;font-weight:700";
      cSpan.title = `${nCor} correctivo${nCor !== 1 ? "s" : ""}`;
      cSpan.textContent = `${nCor}C`;
      mix.appendChild(cSpan);
    }
    if (nCor && nPrev) {
      const sep = document.createElement("span");
      sep.style.cssText = "color:var(--s3);margin:0 3px";
      sep.textContent = "·";
      mix.appendChild(sep);
    }
    if (nPrev) {
      const pSpan = document.createElement("span");
      pSpan.style.cssText = "color:#5B21B6;font-weight:700";
      pSpan.title = `${nPrev} preventivo${nPrev !== 1 ? "s" : ""}`;
      pSpan.textContent = `${nPrev}P`;
      mix.appendChild(pSpan);
    }
    tdVis.appendChild(mix);
  }
  tr.appendChild(tdVis);

  // Últ. ingreso
  const tdFent = document.createElement("td");
  tdFent.style.verticalAlign = "top";
  tdFent.textContent = fmtDate(lc.fentrada);
  tr.appendChild(tdFent);

  // F. salida + tipoPill
  const tdFsal = document.createElement("td");
  tdFsal.style.verticalAlign = "top";
  tdFsal.appendChild(document.createTextNode(fmtDate(lc.fsalidaReal)));
  if (lc.tipo) {
    const wrap = document.createElement("div");
    wrap.style.marginTop = "2px";
    const pill = document.createElement("span");
    pill.className = `tl-tipo ${lc.tipo === "Correctivo" ? "correctivo" : lc.tipo === "Preventivo" ? "preventivo" : ""}`;
    pill.style.cssText = "font-size:8px;padding:1px 5px";
    pill.textContent = lc.tipo;
    wrap.appendChild(pill);
    tdFsal.appendChild(wrap);
  }
  tr.appendChild(tdFsal);

  // Días (entre fentrada y fsalidaReal del cerrado)
  const tdDias = document.createElement("td");
  tdDias.style.cssText = "text-align:center;color:var(--s2);vertical-align:top";
  let dias: number | null = null;
  if (lc.fentrada && lc.fsalidaReal) {
    const diff = new Date(lc.fsalidaReal).getTime() - new Date(lc.fentrada).getTime();
    if (!Number.isNaN(diff)) dias = Math.max(0, Math.round(diff / 86400000));
  }
  tdDias.textContent = dias != null ? `${dias}d` : "—";
  tr.appendChild(tdDias);

  // Gasto + breakdown
  const tdG = document.createElement("td");
  tdG.style.cssText = "font-weight:600;color:var(--G);vertical-align:top";
  tdG.textContent = row.totalGasto > 0 ? fmtMXN(row.totalGasto) : "—";
  if (row.totalGastoRef || row.totalGastoMO) {
    const bd = document.createElement("div");
    bd.style.cssText = "font-size:8px;color:var(--s2);margin-top:1px";
    bd.textContent = `Ref: ${fmtMXN(row.totalGastoRef)} · M.O.: ${fmtMXN(row.totalGastoMO)}`;
    tdG.appendChild(bd);
  }
  tr.appendChild(tdG);

  return tr;
}

function renderKpiBar(
  kpiBar: HTMLElement,
  rows: HistorialRow[],
): void {
  kpiBar.replaceChildren();
  if (!rows.length) {
    kpiBar.style.display = "none";
    return;
  }
  kpiBar.style.display = "";

  const totalGasto = rows.reduce((s, r) => s + r.totalGasto, 0);
  const totalRef = rows.reduce((s, r) => s + r.totalGastoRef, 0);
  const totalMO = rows.reduce((s, r) => s + r.totalGastoMO, 0);
  const totalVisitas = rows.reduce((s, r) => s + r.closedCount, 0);
  const prom = totalVisitas ? totalGasto / totalVisitas : 0;
  void totalRef; void totalMO; // reservado para futuros KPIs

  const mkStat = (val: string, lbl: string, color: string, center = false): HTMLElement => {
    const st = document.createElement("div");
    st.className = "hist-kstat";
    if (center) st.style.textAlign = "center";
    const v = document.createElement("div");
    v.className = "hist-kstat-val";
    v.style.color = color;
    v.textContent = val;
    const l = document.createElement("div");
    l.className = "hist-kstat-lbl";
    l.textContent = lbl;
    st.appendChild(v);
    st.appendChild(l);
    return st;
  };

  kpiBar.appendChild(mkStat(fmtMXN(totalGasto), "Gasto Total", "var(--G)"));
  kpiBar.appendChild(mkStat(fmtMXN(prom), "Prom. por Visita", "var(--A)"));
  kpiBar.appendChild(mkStat(String(totalVisitas), "Visitas (período)", "var(--w1)", true));
  kpiBar.appendChild(mkStat(String(rows.length), "Unidades", "var(--w1)", true));

  // Top5 ranking
  const rankWrap = document.createElement("div");
  rankWrap.className = "hist-rank-wrap";
  const ttl = document.createElement("div");
  ttl.className = "hist-rank-ttl";
  ttl.textContent = "Top Gasto por Unidad";
  rankWrap.appendChild(ttl);
  const list = document.createElement("div");
  list.className = "hist-rank-list";
  const top5 = [...rows].sort((a, b) => b.totalGasto - a.totalGasto).slice(0, 5);
  const maxG = top5[0]?.totalGasto || 1;
  if (!top5.length) {
    const empty = document.createElement("div");
    empty.style.cssText = "font-size:10px;color:var(--s2)";
    empty.textContent = "Sin datos";
    list.appendChild(empty);
  } else {
    for (const r of top5) {
      const item = document.createElement("div");
      item.className = "hist-rank-item";
      const eco = document.createElement("span");
      eco.className = "hist-rank-eco";
      eco.textContent = r.latestClosed.eco || "—";
      const amt = document.createElement("span");
      amt.className = "hist-rank-amt";
      amt.textContent = fmtMXN(r.totalGasto);
      const track = document.createElement("div");
      track.className = "hist-rank-track";
      const bar = document.createElement("div");
      bar.className = "hist-rank-bar";
      bar.style.width = `${Math.round((r.totalGasto / maxG) * 100)}%`;
      track.appendChild(bar);
      item.appendChild(eco);
      item.appendChild(amt);
      item.appendChild(track);
      list.appendChild(item);
    }
  }
  rankWrap.appendChild(list);
  kpiBar.appendChild(rankWrap);
}

// ═══════════════════════════════════════════════════════════════
//  renderHistorial — entry point
// ═══════════════════════════════════════════════════════════════

export function renderHistorial(
  tbody: HTMLElement,
  thead: HTMLElement | null,
  rcnt: HTMLElement | null,
  deps: RenderHistorialDeps,
): HistorialSummary {
  const {
    entries,
    filter = {},
    sortCol = null,
    sortDir = -1,
    kpiBar = null,
    onOpen,
    onReingreso,
    onSort,
  } = deps;

  const allRows = buildHistorialRows(entries, filter);
  const rows = filterAndSortHistorial(allRows, filter, sortCol, sortDir);

  if (thead) buildThead(thead, sortCol, sortDir, onSort);

  if (rcnt) {
    const tags: string[] = [];
    if (filter.desde || filter.hasta) tags.push("período filtrado");
    if (filter.tipo && filter.tipo !== "all") {
      tags.push(filter.tipo === "sin" ? "sin tipo" : filter.tipo.toLowerCase());
    }
    rcnt.textContent =
      `${rows.length} unidad${rows.length !== 1 ? "es" : ""} · ${tags.length ? tags.join(" · ") : "todos los registros"}`;
  }

  if (kpiBar) renderKpiBar(kpiBar, rows);

  tbody.replaceChildren();
  if (!rows.length) {
    tbody.appendChild(buildEmptyRow(filter.search ?? "", filter.desde ?? "", filter.hasta ?? ""));
  } else {
    for (const r of rows) {
      tbody.appendChild(buildDataRow(r, onOpen, onReingreso));
    }
  }

  const totalGasto = rows.reduce((s, r) => s + r.totalGasto, 0);
  const totalVisitas = rows.reduce((s, r) => s + r.closedCount, 0);
  return { visibles: rows.length, totalGasto, totalVisitas };
}
