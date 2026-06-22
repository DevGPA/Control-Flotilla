/**
 * Tabla de cargas/solicitudes de combustible. `filterAndSortFuel` es PURA (testeable);
 * `renderTableCombustible` construye el DOM con la API segura (createElement/textContent,
 * sin innerHTML con datos — regla anti-XSS del proyecto).
 */
import type { FuelEntry, FuelMetrics, FuelVerdictGlobal } from "./types";

export type FuelTipoFilter = "all" | "carga" | "solicitud";
export type FuelVerdictFilter = "all" | "ok" | "discrepancia" | "pendiente";
export type FuelSortCol =
  | "_idx"
  | "tipo"
  | "eco"
  | "plate"
  | "fecha"
  | "branch"
  | "driver"
  | "km"
  | "litros"
  | "monto"
  | "kmpl"
  | "verdict";

export type FuelTableFilter = {
  tipo: FuelTipoFilter;
  verdict: FuelVerdictFilter;
  sucursal: string; // "" = todas
  responsable: string; // "" = todos
  search: string;
  desde?: string; // ISO YYYY-MM-DD
  hasta?: string;
};

/** Veredicto efectivo de una entrada (pendiente si no hay revisión). */
export function verdictOf(e: FuelEntry): FuelVerdictGlobal {
  return e.review?.verdictGlobal ?? "pendiente";
}

function matchesSearch(e: FuelEntry, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  if (/^\d+$/.test(query)) {
    // Búsqueda numérica → ID de unidad (identidad principal): exacto o prefijo.
    return e.eco === query || e.eco.toLowerCase().includes(query);
  }
  return [e.eco, e.placa, e.responsable]
    .filter(Boolean)
    .some((s) => String(s).toLowerCase().includes(query));
}

/** Filtra + ordena. Pura. `kmplByLoad` aporta el km/l para ordenar/mostrar. */
export function filterAndSortFuel(
  entries: readonly FuelEntry[],
  filter: FuelTableFilter,
  sortCol: FuelSortCol,
  sortDir: 1 | -1,
  kmplByLoad?: Map<string, number | null>,
): FuelEntry[] {
  const out = entries.filter((e) => {
    if (filter.tipo !== "all" && e.tipo !== filter.tipo) return false;
    if (filter.verdict !== "all" && verdictOf(e) !== filter.verdict) return false;
    if (filter.sucursal && e.sucursal !== filter.sucursal) return false;
    if (filter.responsable && (e.responsable ?? "") !== filter.responsable) return false;
    if (filter.desde && e.fecha < filter.desde) return false;
    if (filter.hasta && e.fecha > filter.hasta) return false;
    return matchesSearch(e, filter.search);
  });

  const kmpl = (e: FuelEntry) => kmplByLoad?.get(e.loadId) ?? null;
  const cmpStr = (a?: string, b?: string) => String(a ?? "").localeCompare(String(b ?? ""));
  const cmpNum = (a: number | null | undefined, b: number | null | undefined) => {
    const av = a == null ? -Infinity : a;
    const bv = b == null ? -Infinity : b;
    return av - bv;
  };
  const VERDICT_RANK: Record<FuelVerdictGlobal, number> = { discrepancia: 3, pendiente: 2, ok: 1 };

  if (sortCol !== "_idx") {
    out.sort((a, b) => {
      let c = 0;
      switch (sortCol) {
        case "tipo":
          c = cmpStr(a.tipo, b.tipo);
          break;
        case "eco":
          c = cmpStr(a.eco, b.eco);
          break;
        case "plate":
          c = cmpStr(a.placa, b.placa);
          break;
        case "fecha":
          c = cmpStr(a.fechaHora ?? a.fecha, b.fechaHora ?? b.fecha);
          break;
        case "branch":
          c = cmpStr(a.sucursal, b.sucursal);
          break;
        case "driver":
          c = cmpStr(a.responsable, b.responsable);
          break;
        case "km":
          c = cmpNum(a.km, b.km);
          break;
        case "litros":
          c = cmpNum(a.litros, b.litros);
          break;
        case "monto":
          c = cmpNum(a.monto, b.monto);
          break;
        case "kmpl":
          c = cmpNum(kmpl(a), kmpl(b));
          break;
        case "verdict":
          c = VERDICT_RANK[verdictOf(a)] - VERDICT_RANK[verdictOf(b)];
          break;
      }
      return c * sortDir;
    });
  } else {
    // Default: más reciente primero.
    out.sort((a, b) => cmpStr(b.fechaHora ?? b.fecha, a.fechaHora ?? a.fecha));
  }
  return out;
}

// ───────────────────────── Render DOM ─────────────────────────

const PESO = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});
const NUM = new Intl.NumberFormat("es-MX");

const VERDICT_PILL: Record<FuelVerdictGlobal, { cls: string; txt: string }> = {
  ok: { cls: "sw-pill-ok", txt: "Validado" },
  discrepancia: { cls: "sw-pill-urg", txt: "Discrepancia" },
  pendiente: { cls: "sw-pill-rev", txt: "Pendiente" },
};

export type RenderTableCombustibleDeps = {
  tbody: HTMLElement;
  countEl?: HTMLElement | null;
  emptyEl?: HTMLElement | null;
  tableEl?: HTMLElement | null;
  entries: readonly FuelEntry[]; // ya scopeadas por sucursal
  filter: FuelTableFilter;
  sortCol: FuelSortCol;
  sortDir: 1 | -1;
  metricsByLoad?: Map<string, FuelMetrics>;
  onRowClick?: (loadId: string, visibleOrder: string[]) => void;
};

/** Renderiza las filas. Devuelve conteos. */
export function renderTableCombustible(deps: RenderTableCombustibleDeps): {
  total: number;
  filtered: number;
  empty: boolean;
} {
  const { tbody, entries, filter, sortCol, sortDir, metricsByLoad } = deps;
  const kmplByLoad = new Map<string, number | null>();
  if (metricsByLoad) for (const [id, m] of metricsByLoad) kmplByLoad.set(id, m.kmPorLitro);

  const rows = filterAndSortFuel(entries, filter, sortCol, sortDir, kmplByLoad);
  const order = rows.map((r) => r.loadId);

  tbody.replaceChildren();
  for (let i = 0; i < rows.length; i++) {
    const e = rows[i]!;
    const v = verdictOf(e);
    const tr = document.createElement("tr");
    tr.dataset.loadId = e.loadId;
    if (v === "discrepancia") tr.classList.add("sw-urg");
    else if (v === "pendiente") tr.classList.add("sw-rev");
    tr.tabIndex = 0;

    const kmpl = kmplByLoad.get(e.loadId);
    const cells: (string | HTMLElement)[] = [
      String(i + 1),
      e.tipo === "carga" ? "Carga" : "Solicitud",
      e.eco,
      e.placa ?? "—",
      e.fecha || "—",
      e.sucursal || "—",
      e.responsable || "—",
      e.km != null ? NUM.format(e.km) : "—",
      e.litros != null ? `${NUM.format(Math.round(e.litros * 10) / 10)} L` : "—",
      e.monto != null ? PESO.format(e.monto) : "—",
      kmpl != null ? (Math.round(kmpl * 100) / 100).toFixed(2) : "—",
      pill(v),
      e.photos.length ? `📷 ${e.photos.length}` : "—",
    ];
    for (const c of cells) {
      const td = document.createElement("td");
      if (typeof c === "string") td.textContent = c;
      else td.appendChild(c);
      tr.appendChild(td);
    }
    if (deps.onRowClick) {
      const handler = () => deps.onRowClick!(e.loadId, order);
      tr.addEventListener("click", handler);
      tr.addEventListener("keydown", (ev) => {
        if ((ev as KeyboardEvent).key === "Enter") handler();
      });
    }
    tbody.appendChild(tr);
  }

  if (deps.countEl) deps.countEl.textContent = `${rows.length} de ${entries.length}`;
  const empty = rows.length === 0;
  if (deps.emptyEl) deps.emptyEl.style.display = empty ? "" : "none";
  if (deps.tableEl) deps.tableEl.style.display = empty ? "none" : "";
  return { total: entries.length, filtered: rows.length, empty };
}

function pill(v: FuelVerdictGlobal): HTMLElement {
  const span = document.createElement("span");
  const p = VERDICT_PILL[v];
  span.className = `sw-pill ${p.cls}`;
  span.textContent = p.txt;
  return span;
}

/** Llena los <select> de sucursal y responsable con los valores únicos presentes. */
export function populateFuelSelects(
  selSucursal: HTMLSelectElement | null,
  selResponsable: HTMLSelectElement | null,
  entries: readonly FuelEntry[],
): void {
  const fill = (sel: HTMLSelectElement | null, values: string[], label: string) => {
    if (!sel) return;
    const prev = sel.value;
    sel.replaceChildren();
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = label;
    sel.appendChild(opt0);
    for (const v of values) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    }
    if (values.includes(prev)) sel.value = prev;
  };
  const sucs = [...new Set(entries.map((e) => e.sucursal).filter(Boolean))].sort();
  const resp = [...new Set(entries.map((e) => e.responsable ?? "").filter(Boolean))].sort();
  fill(selSucursal, sucs, "Todas las sucursales");
  fill(selResponsable, resp, "Todos los responsables");
}
