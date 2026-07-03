/**
 * Vista consolidada del módulo de Cumplimiento: UNA fila por UNIDAD (ComplianceResumenUnidad).
 * `filterAndSortCumplimiento` y `buildKpisCumplimiento` son PURAS (testeables); los renderers
 * usan la API DOM segura (createElement/textContent, sin innerHTML+datos — regla anti-XSS).
 * Mismo look que Combustible/Semanales (tarjetas .kc, pills sw-pill-*).
 */
import { engomadoDePlaca, diaHoyNoCirculaForanea } from "./complianceAnalysis";
import type {
  CapturaFields,
  ComplianceEntry,
  ComplianceEstado,
  ComplianceResumenUnidad,
  ComplianceTipoDoc,
} from "./types";

export type CumplimientoEstadoFilter = "all" | "vencido" | "porVencer" | "adeudo" | "conIssues";
export type CumplimientoSortCol =
  | "eco"
  | "placa"
  | "sucursal"
  | "estado"
  | "vencidos"
  | "porVencer"
  | "adeudos"
  | "monto";

export type CumplimientoTableFilter = {
  estado: CumplimientoEstadoFilter;
  sucursal: string; // "" = todas
  search: string;
};

const NUM = new Intl.NumberFormat("es-MX");
const PESO = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

/** Severidad para ordenar por estado (mayor = peor / primero con dir -1). */
const ESTADO_RANK: Record<ComplianceEstado, number> = {
  desconocido: 0,
  vigente: 1,
  porVencer: 2,
  adeudo: 3,
  vencido: 4,
};

/** ¿La unidad tiene algo accionable (vencido / por vencer / adeudo)? */
export function tieneIssue(u: ComplianceResumenUnidad): boolean {
  return u.vencidos > 0 || u.porVencer > 0 || u.adeudos > 0;
}

function matchesSearch(u: ComplianceResumenUnidad, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  // Multi-término "70 74 67" (espacios/comas) → empata ALGUNO (OR), como Combustible.
  const terms = query.split(/[\s,]+/).filter(Boolean);
  const match = (t: string) =>
    [u.eco, u.placa].filter(Boolean).some((s) => String(s).toLowerCase().includes(t));
  return terms.some(match);
}

/** Filtra + ordena las unidades. Pura. Desempate estable por eco. */
export function filterAndSortCumplimiento(
  unidades: readonly ComplianceResumenUnidad[],
  filter: CumplimientoTableFilter,
  sortCol: CumplimientoSortCol,
  sortDir: 1 | -1,
): ComplianceResumenUnidad[] {
  const out = unidades.filter((u) => {
    if (filter.sucursal && u.sucursal !== filter.sucursal) return false;
    switch (filter.estado) {
      case "vencido":
        if (u.vencidos === 0) return false;
        break;
      case "porVencer":
        if (u.porVencer === 0) return false;
        break;
      case "adeudo":
        if (u.adeudos === 0) return false;
        break;
      case "conIssues":
        if (!tieneIssue(u)) return false;
        break;
    }
    return matchesSearch(u, filter.search);
  });

  const cmpStr = (a?: string, b?: string) => String(a ?? "").localeCompare(String(b ?? ""));
  out.sort((a, b) => {
    let c = 0;
    switch (sortCol) {
      case "eco":
        c = cmpStr(a.eco, b.eco);
        break;
      case "placa":
        c = cmpStr(a.placa, b.placa);
        break;
      case "sucursal":
        c = cmpStr(a.sucursal, b.sucursal);
        break;
      case "estado":
        c = ESTADO_RANK[a.estado] - ESTADO_RANK[b.estado];
        break;
      case "vencidos":
        c = a.vencidos - b.vencidos;
        break;
      case "porVencer":
        c = a.porVencer - b.porVencer;
        break;
      case "adeudos":
        c = a.adeudos - b.adeudos;
        break;
      case "monto":
        c = a.montoAdeudo - b.montoAdeudo;
        break;
    }
    // Desempate determinista por eco (orden estable independiente de DynamoDB).
    return c !== 0 ? c * sortDir : cmpStr(a.eco, b.eco);
  });
  return out;
}

// ───────────────────────── KPIs ─────────────────────────

export type CumplimientoKpiCard = {
  key: string;
  label: string;
  value: string;
  sub?: string;
  tone: "n" | "r" | "a" | "g"; // neutro / rojo / ámbar / verde
  filter?: CumplimientoEstadoFilter; // clic → filtro
};

/** KPIs de la flota (unidades ya scopeadas por sucursal). Pura. */
export function buildKpisCumplimiento(
  unidades: readonly ComplianceResumenUnidad[],
): CumplimientoKpiCard[] {
  const conVencidos = unidades.filter((u) => u.vencidos > 0).length;
  const conPorVencer = unidades.filter((u) => u.porVencer > 0).length;
  const conAdeudos = unidades.filter((u) => u.adeudos > 0).length;
  const montoTotal = unidades.reduce((a, u) => a + u.montoAdeudo, 0);
  const alDia = unidades.filter((u) => !tieneIssue(u) && u.estado !== "desconocido").length;
  const sinDatos = unidades.filter((u) => u.estado === "desconocido").length;
  return [
    { key: "unidades", label: "Unidades", value: NUM.format(unidades.length), tone: "n" },
    {
      key: "vencidos",
      label: "Con documentos vencidos",
      value: NUM.format(conVencidos),
      tone: conVencidos ? "r" : "g",
      filter: "vencido",
    },
    {
      key: "porVencer",
      label: "Por vencer (30 días)",
      value: NUM.format(conPorVencer),
      tone: conPorVencer ? "a" : "g",
      filter: "porVencer",
    },
    {
      key: "adeudos",
      label: "Con multas/adeudos",
      value: NUM.format(conAdeudos),
      tone: conAdeudos ? "r" : "g",
      filter: "adeudo",
    },
    {
      key: "monto",
      label: "Adeudo total",
      value: PESO.format(montoTotal),
      tone: montoTotal ? "a" : "g",
    },
    {
      key: "aldia",
      label: "Con expediente al día",
      value: NUM.format(alDia),
      sub: sinDatos ? `${NUM.format(sinDatos)} sin expediente` : undefined,
      tone: "g",
    },
  ];
}

// ───────────────────────── Render DOM ─────────────────────────

const ESTADO_PILL: Record<ComplianceEstado, { cls: string; txt: string }> = {
  vencido: { cls: "sw-pill-urg", txt: "Vencido" },
  adeudo: { cls: "sw-pill-urg", txt: "Adeudo" },
  porVencer: { cls: "sw-pill-rev", txt: "Por vencer" },
  vigente: { cls: "sw-pill-ok", txt: "Al día" },
  desconocido: { cls: "", txt: "Sin datos" },
};

function estadoPill(estado: ComplianceEstado): HTMLElement {
  const span = document.createElement("span");
  const p = ESTADO_PILL[estado];
  span.className = p.cls ? `sw-pill ${p.cls}` : "sw-pill";
  span.textContent = p.txt;
  return span;
}

const TONE_COLOR: Record<CumplimientoKpiCard["tone"], string> = {
  n: "var(--ac)",
  r: "var(--R)",
  a: "var(--A)",
  g: "var(--G)",
};

export function renderKpisCumplimiento(
  container: HTMLElement,
  cards: CumplimientoKpiCard[],
  onFilter?: (f: NonNullable<CumplimientoKpiCard["filter"]>) => void,
): void {
  container.replaceChildren();
  const row = document.createElement("div");
  row.className = "kpi-row";
  container.appendChild(row);
  for (const c of cards) {
    const kc = document.createElement("div");
    kc.className = "kc";
    if (c.filter && onFilter) {
      const f = c.filter;
      kc.style.cursor = "pointer";
      kc.tabIndex = 0;
      // A11y: es un control interactivo — role + Enter/Espacio (WCAG 4.1.2)
      kc.setAttribute("role", "button");
      kc.setAttribute("aria-label", `Filtrar por ${c.label}`);
      const h = () => onFilter(f);
      kc.addEventListener("click", h);
      kc.addEventListener("keydown", (ev) => {
        const k = (ev as KeyboardEvent).key;
        if (k === "Enter" || k === " ") {
          ev.preventDefault();
          h();
        }
      });
    }
    const ktop = document.createElement("div");
    ktop.className = "ktop";
    ktop.style.background = TONE_COLOR[c.tone];
    kc.appendChild(ktop);

    const klbl = document.createElement("div");
    klbl.className = "klbl";
    klbl.textContent = c.label;
    kc.appendChild(klbl);

    const kval = document.createElement("div");
    kval.className = "kval";
    kval.style.color = TONE_COLOR[c.tone];
    kval.textContent = c.value;
    kc.appendChild(kval);

    if (c.sub) {
      const ksub = document.createElement("div");
      ksub.className = "ksub";
      ksub.textContent = c.sub;
      kc.appendChild(ksub);
    }
    row.appendChild(kc);
  }
}

export type RenderCumplimientoDeps = {
  tbody: HTMLElement;
  countEl?: HTMLElement | null;
  emptyEl?: HTMLElement | null;
  tableEl?: HTMLElement | null;
  unidades: readonly ComplianceResumenUnidad[]; // ya scopeadas por sucursal
  filter: CumplimientoTableFilter;
  sortCol: CumplimientoSortCol;
  sortDir: 1 | -1;
  onRowClick?: (eco: string) => void;
};

/** Renderiza la tabla consolidada (una fila por unidad). Devuelve conteos. */
export function renderTableCumplimiento(deps: RenderCumplimientoDeps): {
  total: number;
  filtered: number;
  empty: boolean;
} {
  const { tbody, unidades, filter, sortCol, sortDir } = deps;
  const rows = filterAndSortCumplimiento(unidades, filter, sortCol, sortDir);

  tbody.replaceChildren();
  for (let i = 0; i < rows.length; i++) {
    const u = rows[i]!;
    const tr = document.createElement("tr");
    tr.dataset.eco = u.eco;
    if (u.estado === "vencido" || u.estado === "adeudo") tr.classList.add("sw-urg");
    else if (u.estado === "porVencer") tr.classList.add("sw-rev");
    tr.tabIndex = 0;

    const cells: (string | HTMLElement)[] = [
      String(i + 1),
      u.eco,
      u.placa ?? "—",
      u.sucursal ?? "—",
      estadoPill(u.estado),
      u.vencidos ? NUM.format(u.vencidos) : "—",
      u.porVencer ? NUM.format(u.porVencer) : "—",
      u.adeudos ? NUM.format(u.adeudos) : "—",
      u.montoAdeudo ? PESO.format(u.montoAdeudo) : "—",
      NUM.format(u.docs.length),
    ];
    for (const c of cells) {
      const td = document.createElement("td");
      if (typeof c === "string") td.textContent = c;
      else td.appendChild(c);
      tr.appendChild(td);
    }
    if (deps.onRowClick) {
      const handler = () => deps.onRowClick!(u.eco);
      tr.addEventListener("click", handler);
      tr.addEventListener("keydown", (ev) => {
        const k = (ev as KeyboardEvent).key;
        if (k === "Enter" || k === " ") {
          ev.preventDefault(); // Espacio no debe scrollear
          handler();
        }
      });
    }
    tbody.appendChild(tr);
  }

  if (deps.countEl) deps.countEl.textContent = `${rows.length} de ${unidades.length}`;
  const empty = rows.length === 0;
  if (deps.emptyEl) deps.emptyEl.style.display = empty ? "" : "none";
  if (deps.tableEl) deps.tableEl.style.display = empty ? "none" : "";
  return { total: unidades.length, filtered: rows.length, empty };
}

/** Llena el <select> de sucursal con los valores únicos presentes. */
export function populateCumplimientoSelects(
  selSucursal: HTMLSelectElement | null,
  unidades: readonly ComplianceResumenUnidad[],
): void {
  if (!selSucursal) return;
  const prev = selSucursal.value;
  selSucursal.replaceChildren();
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Todas las sucursales";
  selSucursal.appendChild(opt0);
  const sucs = [...new Set(unidades.map((u) => u.sucursal ?? "").filter(Boolean))].sort();
  for (const s of sucs) {
    const o = document.createElement("option");
    o.value = s;
    o.textContent = s;
    selSucursal.appendChild(o);
  }
  if (sucs.includes(prev)) selSucursal.value = prev;
}

// ───────────────────────── Expediente por unidad (pestaña en #det) ─────────────────────────

const TIPO_LABEL: Record<ComplianceTipoDoc, string> = {
  verificacion: "Verificación",
  tenencia: "Tenencia",
  refrendo: "Refrendo",
  seguro: "Seguro",
  tarjetaCirculacion: "Tarjeta de circulación",
  licencia: "Licencia operador",
  multa: "Multa",
};

const DIA_LABEL: Record<string, string> = {
  lunes: "Lunes",
  martes: "Martes",
  miercoles: "Miércoles",
  jueves: "Jueves",
  viernes: "Viernes",
};

/** Texto de la columna meta del expediente (vencimiento o monto/referencia). */
function expedienteMeta(d: ComplianceEntry): string {
  if (d.tipoDoc === "multa") {
    return d.monto != null ? PESO.format(d.monto) : (d.referencia ?? "adeudo");
  }
  if (d.fechaVencimiento) {
    const dias = d.diasParaVencer;
    if (dias == null) return `vence ${d.fechaVencimiento}`;
    if (dias < 0) return `venció hace ${Math.abs(dias)} d`;
    return `vence en ${dias} d`;
  }
  return "sin fecha";
}

/**
 * Expediente de cumplimiento de UNA unidad — para la pestaña "Cumplimiento" del panel #det.
 * DOM-safe (createElement/textContent). Incluye la info DERIVADA de la placa (engomado de
 * verificación + día de Hoy No Circula foránea), que no requiere consultar ningún portal.
 */
export function renderExpedienteUnidad(
  container: HTMLElement,
  _eco: string,
  placa: string | undefined,
  entries: readonly ComplianceEntry[],
  opts?: { onDelete?: (docId: string) => void },
): void {
  container.replaceChildren();

  const engomado = engomadoDePlaca(placa);
  const diaHnc = diaHoyNoCirculaForanea(placa);
  if (engomado || diaHnc) {
    const info = document.createElement("div");
    info.className = "cmp-info-banner";
    const parts: string[] = [];
    if (engomado) parts.push(`Engomado ${engomado} (verificación por terminación de placa)`);
    if (diaHnc) parts.push(`Hoy No Circula foránea: ${DIA_LABEL[diaHnc] ?? diaHnc}`);
    info.textContent = parts.join(" · ");
    container.appendChild(info);
  }

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "cmp-empty";
    empty.textContent = "Sin documentos de cumplimiento capturados para esta unidad.";
    container.appendChild(empty);
    return;
  }

  const orden: Record<ComplianceEstado, number> = {
    vencido: 0,
    adeudo: 1,
    porVencer: 2,
    desconocido: 3,
    vigente: 4,
  };
  const docs = [...entries].sort((a, b) => orden[a.estado] - orden[b.estado]);
  for (const d of docs) {
    const row = document.createElement("div");
    row.className = "cmp-doc-row";

    const tipo = document.createElement("span");
    tipo.className = "cmp-doc-tipo";
    tipo.textContent = TIPO_LABEL[d.tipoDoc] ?? d.tipoDoc;
    row.appendChild(tipo);

    row.appendChild(estadoPill(d.estado));

    const meta = document.createElement("span");
    meta.className = "cmp-doc-meta";
    meta.textContent = expedienteMeta(d);
    row.appendChild(meta);

    if (opts?.onDelete) {
      const onDelete = opts.onDelete;
      const docId = d.docId;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "needs-write cmp-doc-del";
      del.textContent = "✕";
      del.title = "Eliminar documento";
      del.setAttribute("aria-label", `Eliminar ${TIPO_LABEL[d.tipoDoc] ?? d.tipoDoc}`);
      del.addEventListener("click", () => onDelete(docId));
      row.appendChild(del);
    }

    container.appendChild(row);
  }
}

const JUR_OPCIONES: Array<{ value: string; label: string }> = [
  { value: "", label: "Jurisdicción…" },
  { value: "jalisco", label: "Jalisco" },
  { value: "cdmx", label: "CDMX" },
  { value: "edomex", label: "Edomex" },
  { value: "nuevoleon", label: "Nuevo León" },
  { value: "federal", label: "Federal" },
  { value: "otra", label: "Otra" },
];

// Estilos en clases .cmp-* / .field-input (main.css) — UX 2026-07 Lote 2.

/**
 * Formulario compacto de alta/edición de un documento (captura manual). DOM-safe.
 * Llama `onSave(fields)` al guardar; NO toca la API (eso lo hace el wire). Para los tipos
 * singleton (no-multa), re-guardar el mismo tipo edita (mismo docId). Valida que se capture
 * al menos una fecha, un monto o una referencia.
 */
export function renderCapturaForm(
  container: HTMLElement,
  onSave: (fields: CapturaFields) => void,
): void {
  const wrap = document.createElement("div");
  wrap.className = "cmp-form";

  const titulo = document.createElement("div");
  titulo.className = "cmp-form-title";
  titulo.textContent = "Agregar / actualizar documento";
  wrap.appendChild(titulo);

  const selTipo = document.createElement("select");
  selTipo.className = "field-input";
  selTipo.setAttribute("aria-label", "Tipo de documento");
  for (const k of Object.keys(TIPO_LABEL) as ComplianceTipoDoc[]) {
    const o = document.createElement("option");
    o.value = k;
    o.textContent = TIPO_LABEL[k];
    selTipo.appendChild(o);
  }
  wrap.appendChild(selTipo);

  const selJur = document.createElement("select");
  selJur.className = "field-input";
  selJur.setAttribute("aria-label", "Jurisdicción");
  for (const j of JUR_OPCIONES) {
    const o = document.createElement("option");
    o.value = j.value;
    o.textContent = j.label;
    selJur.appendChild(o);
  }
  wrap.appendChild(selJur);

  const inFecha = document.createElement("input");
  inFecha.type = "date";
  inFecha.className = "field-input";
  inFecha.title = "Fecha de vencimiento";
  inFecha.setAttribute("aria-label", "Fecha de vencimiento");
  wrap.appendChild(inFecha);

  const inRef = document.createElement("input");
  inRef.type = "text";
  inRef.placeholder = "Referencia / folio";
  inRef.className = "field-input cmp-input-ref";
  inRef.setAttribute("aria-label", "Referencia o folio");
  wrap.appendChild(inRef);

  const inMonto = document.createElement("input");
  inMonto.type = "number";
  inMonto.min = "0";
  inMonto.placeholder = "Monto $";
  inMonto.className = "field-input cmp-input-monto";
  inMonto.setAttribute("aria-label", "Monto del adeudo");
  wrap.appendChild(inMonto);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Guardar";
  btn.className = "cmp-btn-save";
  wrap.appendChild(btn);

  const err = document.createElement("span");
  err.className = "cmp-form-err";
  err.style.display = "none"; // se muestra con style.display="" al validar
  wrap.appendChild(err);

  btn.addEventListener("click", () => {
    const montoNum = inMonto.value ? Number(inMonto.value) : undefined;
    const fields: CapturaFields = {
      tipoDoc: selTipo.value as ComplianceTipoDoc,
      jurisdiccion: selJur.value || undefined,
      fechaVencimiento: inFecha.value || undefined,
      referencia: inRef.value.trim() || undefined,
      monto: montoNum != null && Number.isFinite(montoNum) ? montoNum : undefined,
    };
    if (!fields.fechaVencimiento && fields.monto == null && !fields.referencia) {
      err.textContent = "Captura al menos una fecha de vencimiento, un monto o una referencia.";
      err.style.display = "";
      return;
    }
    err.style.display = "none";
    onSave(fields);
    inFecha.value = "";
    inRef.value = "";
    inMonto.value = "";
  });

  container.appendChild(wrap);
}
