/**
 * Tabla de cargas/solicitudes de combustible. `filterAndSortFuel` es PURA (testeable);
 * `renderTableCombustible` construye el DOM con la API segura (createElement/textContent,
 * sin innerHTML con datos — regla anti-XSS del proyecto).
 */
import type { FuelEntry, FuelMetrics, FuelVerdictGlobal, MotivoSinKmpl } from "./types";
import type { RecorridoInfo } from "./fuelAnalysis";
import { MOTIVO_SIN_KMPL_CORTO, MOTIVO_SIN_KMPL_LABEL } from "./fuelAnalysis";
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
export type FuelVerdictFilter = "all" | "ok" | "discrepancia" | "pendiente" | "historico";
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

/**
 * Fecha de corte del control de validación (YYYY-MM-DD, INCLUSIVA): las cargas con
 * `fecha >= FUEL_VALIDACION_DESDE` entran al flujo de validación normal; las anteriores
 * son HISTÓRICO (backfill migrado que nadie va a revisar a mano de forma retroactiva).
 * Mover la fecha hacia atrás "revela" más histórico como pendiente; ponerla en el pasado
 * lejano desactiva el concepto de histórico. Reversible y sin tocar datos (estado derivado).
 */
export const FUEL_VALIDACION_DESDE = "2026-06-01";

/** Veredicto MOSTRADO: añade "historico" al veredicto persistido (derivado, nunca se guarda). */
export type FuelDisplayVerdict = FuelVerdictGlobal | "historico";

/** ¿La carga es anterior al corte del control? (solo por fecha; no mira la validación). */
export function esHistorico(e: FuelEntry, desde: string = FUEL_VALIDACION_DESDE): boolean {
  return (e.fecha || "") < desde;
}

/**
 * Veredicto para mostrar/contar. "historico" SOLO reemplaza a "pendiente" en cargas previas
 * al corte: una validación real ya hecha (ok/discrepancia) se RESPETA aunque sea vieja — no
 * borramos el trabajo del revisor ni ocultamos una discrepancia auténtica del histórico.
 */
export function displayVerdictOf(
  e: FuelEntry,
  desde: string = FUEL_VALIDACION_DESDE,
): FuelDisplayVerdict {
  const v = verdictOf(e);
  return v === "pendiente" && esHistorico(e, desde) ? "historico" : v;
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

/** Filtra + ordena. Pura. `kmplByLoad` aporta el km/l y `recorridosByLoad` el recorrido. */
export function filterAndSortFuel(
  entries: readonly FuelEntry[],
  filter: FuelTableFilter,
  sortCol: FuelSortCol,
  sortDir: 1 | -1,
  kmplByLoad?: Map<string, number | null>,
  recorridosByLoad?: ReadonlyMap<string, RecorridoInfo>,
): FuelEntry[] {
  const out = entries.filter((e) => {
    if (filter.tipo !== "all" && e.tipo !== filter.tipo) return false;
    if (filter.verdict !== "all" && displayVerdictOf(e) !== filter.verdict) return false;
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
  const VERDICT_RANK: Record<FuelDisplayVerdict, number> = {
    discrepancia: 3,
    pendiente: 2,
    ok: 1,
    historico: 0,
  };
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
          c = esSol
            ? cmpNum(recorridosByLoad?.get(a.loadId)?.km, recorridosByLoad?.get(b.loadId)?.km)
            : cmpNum(kmpl(a), kmpl(b));
          break;
        case "verdict":
          c = VERDICT_RANK[displayVerdictOf(a)] - VERDICT_RANK[displayVerdictOf(b)];
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

const VERDICT_PILL: Record<FuelDisplayVerdict, { cls: string; txt: string }> = {
  ok: { cls: "sw-pill-ok", txt: "Validado" },
  discrepancia: { cls: "sw-pill-urg", txt: "Discrepancia" },
  pendiente: { cls: "sw-pill-rev", txt: "Pendiente" },
  historico: { cls: "sw-pill-hist", txt: "Histórico" },
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
  /** loadId → recorrido del ciclo (vista Solicitudes). */
  recorridosByLoad?: ReadonlyMap<string, RecorridoInfo>;
  /** email del validador → nombre legible (para la celda de Validación). */
  nombreValidador?: (email?: string | null) => string;
};

/** ISO ("2026-06-25T...") → "25/06/26". "" si no hay fecha. */
function fechaCorta(iso: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]!.slice(2)}` : "";
}

/** Etiqueta del recorrido del ciclo (vista Solicitudes): "800 km ✓/⚠" o "—". */
function recLabel(rec: RecorridoInfo | undefined): string {
  if (!rec || rec.km == null) return "—";
  return `${NUM.format(rec.km)} km ${rec.viaCarga ? "✓" : "⚠"}`;
}

/** Celda km/l: el número, o "—" con el MOTIVO debajo (chip gris) cuando no hay rendimiento. */
function kmplCell(kmpl: number | null | undefined, motivo?: MotivoSinKmpl): string | HTMLElement {
  if (kmpl != null) return (Math.round(kmpl * 100) / 100).toFixed(2);
  if (!motivo) return "—";
  const wrap = document.createElement("div");
  wrap.className = "fuel-kmpl-none";
  const dash = document.createElement("span");
  dash.textContent = "—";
  const tag = document.createElement("small");
  tag.className = "fuel-kmpl-motivo";
  tag.textContent = MOTIVO_SIN_KMPL_CORTO[motivo];
  tag.title = MOTIVO_SIN_KMPL_LABEL[motivo]; // explicación completa al pasar el cursor
  wrap.appendChild(dash);
  wrap.appendChild(tag);
  return wrap;
}

/** Celda de Validación: semáforo + (si hay) "{nombre} · {fecha}" en línea chica. */
function verdictCell(
  e: FuelEntry,
  v: FuelDisplayVerdict,
  nombreFn?: (email?: string | null) => string,
): HTMLElement {
  const rev = e.review?.revisadoPor;
  if (!rev || rev === "ui") return pill(v);
  const wrap = document.createElement("div");
  wrap.className = "sw-valcell";
  wrap.appendChild(pill(v));
  const sub = document.createElement("small");
  sub.className = "sw-valby";
  const nombre = nombreFn ? nombreFn(rev) : (rev.split("@")[0] ?? rev);
  const fecha = fechaCorta(e.review?.ts);
  sub.textContent = fecha ? `${nombre} · ${fecha}` : nombre;
  wrap.appendChild(sub);
  return wrap;
}

/** Renderiza las filas. Devuelve conteos. */
export function renderTableCombustible(deps: RenderTableCombustibleDeps): {
  total: number;
  filtered: number;
  empty: boolean;
} {
  const { tbody, entries, filter, sortCol, sortDir, metricsByLoad, submarcaByEco } = deps;
  const recorridosByLoad = deps.recorridosByLoad;
  const nombreValidador = deps.nombreValidador;
  const kmplByLoad = new Map<string, number | null>();
  if (metricsByLoad) for (const [id, m] of metricsByLoad) kmplByLoad.set(id, m.kmPorLitro);

  const rows = filterAndSortFuel(entries, filter, sortCol, sortDir, kmplByLoad, recorridosByLoad);
  const order = rows.map((r) => r.loadId);

  // Vista Solicitudes: las columnas de carga (Litros/Monto/km-l) se reusan para datos de la
  // solicitud (Nivel antes→deseado / Monto a cargar / Recorrido del ciclo). Encabezado adaptativo.
  const esSol = filter.tipo === "solicitud";
  if (deps.tableEl) {
    const setTh = (sort: string, txt: string) => {
      const th = deps.tableEl!.querySelector(`[data-sort="${sort}"]`);
      if (th) th.textContent = txt;
    };
    setTh("litros", esSol ? "Nivel (antes→deseado)" : "Litros");
    setTh("monto", esSol ? "Monto a cargar" : "Monto");
    setTh("kmpl", esSol ? "Recorrido" : "km/l");
  }

  tbody.replaceChildren();
  for (let i = 0; i < rows.length; i++) {
    const e = rows[i]!;
    const v = displayVerdictOf(e);
    const tr = document.createElement("tr");
    tr.dataset.loadId = e.loadId;
    if (v === "discrepancia") tr.classList.add("sw-urg");
    else if (v === "pendiente") tr.classList.add("sw-rev");
    // "historico" no resalta la fila: estado neutro, fuera del radar de control.
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
        ? recLabel(recorridosByLoad?.get(e.loadId))
        : kmplCell(kmpl, metricsByLoad?.get(e.loadId)?.motivoSinKmpl),
      verdictCell(e, v, nombreValidador),
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

function pill(v: FuelDisplayVerdict): HTMLElement {
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
