/**
 * Tabla de cargas/solicitudes de combustible. `filterAndSortFuel` es PURA (testeable);
 * `renderTableCombustible` construye el DOM con la API segura (createElement/textContent,
 * sin innerHTML con datos — regla anti-XSS del proyecto).
 */
import type { FuelEntry, FuelMetrics, FuelVerdictGlobal } from "./types";
import { ecoKey } from "./tokaLayout";

/** Valor numérico de un nivel de tanque ("0.25(1/4)" → 0.25). NaN si no parsea. */
function nivelNum(s: string | undefined): number {
  const n = parseFloat(String(s ?? ""));
  return Number.isFinite(n) ? n : NaN;
}
/** Etiqueta legible de nivel de tanque (¼ ½ ¾ Lleno/Vacío). */
function nivelLabel(s: string | undefined): string {
  const n = nivelNum(s);
  if (!Number.isFinite(n)) return s ? String(s) : "—";
  if (n <= 0) return "Vacío";
  if (n >= 1) return "Lleno";
  if (Math.abs(n - 0.25) < 0.05) return "¼";
  if (Math.abs(n - 0.5) < 0.05) return "½";
  if (Math.abs(n - 0.75) < 0.05) return "¾";
  return `${Math.round(n * 100)}%`;
}

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
  // Multi-término: "70 74 67 55" (espacios o comas) → coincide si la fila empata ALGUNO
  // de los términos (OR). Con un solo término el comportamiento es el de siempre.
  const terms = query.split(/[\s,]+/).filter(Boolean);
  const matchTerm = (t: string): boolean => {
    if (/^\d+$/.test(t)) {
      // Término numérico → ID de unidad (identidad principal): exacto o prefijo.
      return e.eco === t || e.eco.toLowerCase().includes(t);
    }
    return [e.eco, e.placa, e.responsable]
      .filter(Boolean)
      .some((s) => String(s).toLowerCase().includes(t));
  };
  return terms.some(matchTerm);
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
  // En vista Solicitudes las columnas Litros/Monto/km-l muestran Nivel/Monto a cargar/Litros máx,
  // así que el orden de esas columnas usa el campo de solicitud correspondiente.
  const esSol = filter.tipo === "solicitud";

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
          c = esSol
            ? cmpNum(nivelNum(a.nivelAntes), nivelNum(b.nivelAntes))
            : cmpNum(a.litros, b.litros);
          break;
        case "monto":
          c = esSol ? cmpNum(a.montoEstimado, b.montoEstimado) : cmpNum(a.monto, b.monto);
          break;
        case "kmpl":
          c = esSol ? cmpNum(a.maxLitros, b.maxLitros) : cmpNum(kmpl(a), kmpl(b));
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
  /** economicoId (clave canónica) → submarca/marca del catálogo de Unidades (vista Solicitudes). */
  submarcaByEco?: ReadonlyMap<string, string>;
};

/** Renderiza las filas. Devuelve conteos. */
export function renderTableCombustible(deps: RenderTableCombustibleDeps): {
  total: number;
  filtered: number;
  empty: boolean;
} {
  const { tbody, entries, filter, sortCol, sortDir, metricsByLoad, submarcaByEco } = deps;
  const kmplByLoad = new Map<string, number | null>();
  if (metricsByLoad) for (const [id, m] of metricsByLoad) kmplByLoad.set(id, m.kmPorLitro);

  const rows = filterAndSortFuel(entries, filter, sortCol, sortDir, kmplByLoad);
  const order = rows.map((r) => r.loadId);

  // Vista Solicitudes: las columnas de carga (Litros/Monto/km-l) se reusan para datos de la
  // solicitud (Nivel antes→deseado / Monto a cargar / Litros máx). Encabezado adaptativo.
  const esSol = filter.tipo === "solicitud";
  if (deps.tableEl) {
    const setTh = (sort: string, txt: string) => {
      const th = deps.tableEl!.querySelector(`[data-sort="${sort}"]`);
      if (th) th.textContent = txt;
    };
    setTh("litros", esSol ? "Nivel (antes→deseado)" : "Litros");
    setTh("monto", esSol ? "Monto a cargar" : "Monto");
    setTh("kmpl", esSol ? "Litros máx." : "km/l");
  }

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
    const submarca = esSol ? submarcaByEco?.get(ecoKey(e.eco)) : undefined;
    const cells: (string | HTMLElement)[] = [
      String(i + 1),
      e.tipo === "carga" ? "Carga" : "Solicitud",
      submarca ? `${e.eco} · ${submarca}` : e.eco,
      e.placa ?? "—",
      e.fecha || "—",
      e.sucursal || "—",
      e.responsable || "—",
      e.km != null ? NUM.format(e.km) : "—",
      esSol
        ? `${nivelLabel(e.nivelAntes)} → ${nivelLabel(e.nivelDeseado)}`
        : e.litros != null
          ? `${NUM.format(Math.round(e.litros * 10) / 10)} L`
          : "—",
      esSol
        ? e.montoEstimado != null
          ? PESO.format(e.montoEstimado)
          : "—"
        : e.monto != null
          ? PESO.format(e.monto)
          : "—",
      esSol
        ? e.maxLitros != null
          ? `${NUM.format(Math.round(e.maxLitros))} L`
          : "—"
        : kmpl != null
          ? (Math.round(kmpl * 100) / 100).toFixed(2)
          : "—",
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
