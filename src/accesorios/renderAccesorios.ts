/**
 * Vista de la sub-pestaña "Accesorios" de Taller: UNA fila por unidad con la batería y el
 * limpiabrisas vigentes, y un modal con el historial de cambios de la unidad.
 *
 * Todo el DOM se construye con createElement/textContent — NUNCA innerHTML con datos
 * (regla anti-XSS del proyecto; el guard es `npm run audit:xss`). Mismo look que las otras
 * dos pestañas de Taller: clases .tl-table / .hist-kpi-bar ya definidas en main.css.
 * La lógica de cálculo vive en accesoriosAnalysis.ts (pura y probada aparte).
 */
import { TIPO_LABEL, type AccesorioEntry, type AccesorioTipo } from "./types";
import type { AccesorioUnidad, AccesoriosSortCol, KpisAccesorios, SortDir } from "./types";

const COLS: Array<{ lbl: string; key: AccesoriosSortCol | null; title?: string }> = [
  { lbl: "Unidad", key: "eco" },
  { lbl: "Placas", key: "placa" },
  { lbl: "Sucursal", key: "sucursal" },
  { lbl: "Batería", key: "bateria", title: "Ordena por antigüedad de la batería" },
  { lbl: "Limpiabrisas", key: "limpiabrisas", title: "Ordena por antigüedad del limpiabrisas" },
  { lbl: "Cambios", key: "cambios", title: "Accesorios capturados en la unidad" },
  { lbl: "Gasto", key: "gasto", title: "Suma de lo capturado en accesorios" },
];

const PESO = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

export function fmtMXN(n: number): string {
  return n > 0 ? PESO.format(n) : "$0";
}

/** dd/mm/aaaa a partir de YYYY-MM-DD. "—" si no hay fecha. */
export function fmtFecha(d?: string): string {
  if (!d) return "—";
  const p = d.slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d;
}

/** Antigüedad en lenguaje humano: "3 meses", "1 año 2 meses". "—" si no hay fecha. */
export function fmtAntiguedad(meses: number | null): string {
  if (meses == null) return "—";
  if (meses === 0) return "este mes";
  if (meses < 12) return `${meses} ${meses === 1 ? "mes" : "meses"}`;
  const años = Math.floor(meses / 12);
  const resto = meses % 12;
  const parteAños = `${años} ${años === 1 ? "año" : "años"}`;
  return resto ? `${parteAños} ${resto} ${resto === 1 ? "mes" : "meses"}` : parteAños;
}

// ── KPIs ──────────────────────────────────────────────────────────────────────────

function kstat(val: string, lbl: string, color?: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "hist-kstat";
  const v = document.createElement("div");
  v.className = "hist-kstat-val";
  if (color) v.style.color = color;
  v.textContent = val;
  const l = document.createElement("div");
  l.className = "hist-kstat-lbl";
  l.textContent = lbl;
  wrap.append(v, l);
  return wrap;
}

/** Tarjetas de arriba. Sin semáforos: son conteos, no juicios. */
export function renderKpisAccesorios(container: HTMLElement, k: KpisAccesorios): void {
  container.textContent = "";
  container.className = "hist-kpi-bar";
  container.append(
    kstat(String(k.unidades), "Unidades"),
    kstat(String(k.conBateria), "Con batería", "var(--G)"),
    kstat(String(k.conLimpiabrisas), "Con limpiabrisas", "var(--G)"),
    kstat(String(k.sinRegistro), "Sin registro", k.sinRegistro ? "var(--A)" : undefined),
    kstat(String(k.cambios), "Cambios capturados"),
    kstat(fmtMXN(k.gastoTotal), "Gasto en accesorios"),
  );
}

// ── Tabla ─────────────────────────────────────────────────────────────────────────

function celdaAccesorio(e: AccesorioEntry | undefined, tipo: AccesorioTipo): HTMLElement {
  const td = document.createElement("td");
  if (!e) {
    td.style.color = "var(--s3)";
    td.textContent = "Sin registro";
    td.title = `No hay ${TIPO_LABEL[tipo].toLowerCase()} capturado en esta unidad`;
    return td;
  }
  const marca = document.createElement("div");
  marca.style.cssText = "font-weight:600;color:var(--w1)";
  marca.textContent = e.marca || "Sin marca";
  td.appendChild(marca);

  const detalle = document.createElement("div");
  detalle.style.cssText = "font-size:9.5px;color:var(--s2);margin-top:1px";
  const partes: string[] = [];
  if (e.numeroSerie) partes.push(`Serie ${e.numeroSerie}`);
  partes.push(fmtAntiguedad(e.antiguedadMeses));
  detalle.textContent = partes.join(" · ");
  detalle.title = `Comprado el ${fmtFecha(e.fechaCompra)}`;
  td.appendChild(detalle);
  return td;
}

export type RenderTablaDeps = {
  thead: HTMLElement;
  tbody: HTMLElement;
  unidades: readonly AccesorioUnidad[];
  sortCol: AccesoriosSortCol;
  sortDir: SortDir;
  /** Texto buscado, solo para el mensaje de vacío. */
  search?: string;
  onSort?: (col: AccesoriosSortCol) => void;
  onOpen?: (economicoId: string) => void;
};

function buildHead(deps: RenderTablaDeps): void {
  const tr = document.createElement("tr");
  for (const c of COLS) {
    const th = document.createElement("th");
    th.textContent = c.lbl;
    if (c.title) th.title = c.title;
    if (c.key) {
      th.style.cursor = "pointer";
      if (c.key === deps.sortCol) {
        const flecha = document.createElement("span");
        flecha.style.marginLeft = "3px";
        flecha.textContent = deps.sortDir === 1 ? "▲" : "▼";
        th.appendChild(flecha);
      }
      const key = c.key;
      th.addEventListener("click", () => deps.onSort?.(key));
    }
    tr.appendChild(th);
  }
  deps.thead.textContent = "";
  deps.thead.appendChild(tr);
}

function filaVacia(search?: string): HTMLElement {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = COLS.length;
  td.style.cssText = "padding:22px 8px;text-align:center;color:var(--s2)";
  if (search) {
    td.appendChild(document.createTextNode("Sin resultados para «"));
    const b = document.createElement("b");
    b.textContent = search;
    td.appendChild(b);
    td.appendChild(document.createTextNode("»."));
  } else {
    td.textContent = "Sin unidades en el filtro.";
    td.appendChild(document.createElement("br"));
    const hint = document.createElement("span");
    hint.style.fontSize = "10px";
    hint.textContent = 'Captura un cambio con el botón "Nuevo accesorio".';
    td.appendChild(hint);
  }
  tr.appendChild(td);
  return tr;
}

function buildFila(u: AccesorioUnidad, onOpen?: (eco: string) => void): HTMLElement {
  const tr = document.createElement("tr");
  tr.title = "Clic para ver el historial de accesorios de la unidad";
  if (onOpen) tr.addEventListener("click", () => onOpen(u.economicoId));

  const tdEco = document.createElement("td");
  tdEco.style.cssText = "font-weight:700;color:var(--w1)";
  tdEco.textContent = u.economicoId || "—";
  tr.appendChild(tdEco);

  const tdPlaca = document.createElement("td");
  tdPlaca.style.cssText = "font-weight:600;color:var(--ac)";
  tdPlaca.textContent = u.placa || "—";
  tr.appendChild(tdPlaca);

  const tdSuc = document.createElement("td");
  tdSuc.style.cssText = "font-size:10px;color:var(--s2)";
  tdSuc.textContent = u.sucursal || "—";
  tr.appendChild(tdSuc);

  tr.appendChild(celdaAccesorio(u.vigentes.bateria, "bateria"));
  tr.appendChild(celdaAccesorio(u.vigentes.limpiabrisas, "limpiabrisas"));

  const tdCambios = document.createElement("td");
  tdCambios.style.cssText = "text-align:center;color:var(--s1)";
  tdCambios.textContent = String(u.cambios);
  tr.appendChild(tdCambios);

  const tdGasto = document.createElement("td");
  tdGasto.style.cssText = "font-weight:600;color:var(--G)";
  tdGasto.textContent = u.gastoTotal > 0 ? fmtMXN(u.gastoTotal) : "—";
  tr.appendChild(tdGasto);
  return tr;
}

export function renderTableAccesorios(deps: RenderTablaDeps): void {
  buildHead(deps);
  deps.tbody.textContent = "";
  if (!deps.unidades.length) {
    deps.tbody.appendChild(filaVacia(deps.search));
    return;
  }
  const frag = document.createDocumentFragment();
  for (const u of deps.unidades) frag.appendChild(buildFila(u, deps.onOpen));
  deps.tbody.appendChild(frag);
}

// ── Historial por unidad (cuerpo del modal) ───────────────────────────────────────

const HIST_COLS = ["Accesorio", "Marca", "Serie", "Compra", "Antigüedad", "Costo", ""];

export type RenderHistorialDeps = {
  unidad: AccesorioUnidad;
  puedeEscribir: boolean;
  onEditar?: (entry: AccesorioEntry) => void;
  onBorrar?: (entry: AccesorioEntry) => void;
};

/** Pinta el historial completo de una unidad dentro del contenedor dado. */
export function renderHistorialUnidad(container: HTMLElement, deps: RenderHistorialDeps): void {
  const { unidad } = deps;
  container.textContent = "";

  const resumen = document.createElement("div");
  resumen.style.cssText = "font-size:11px;color:var(--s2);margin-bottom:8px";
  resumen.textContent =
    `${unidad.cambios} ${unidad.cambios === 1 ? "accesorio capturado" : "accesorios capturados"}` +
    ` · ${fmtMXN(unidad.gastoTotal)} en total`;
  container.appendChild(resumen);

  if (!unidad.historial.length) {
    const vacio = document.createElement("div");
    vacio.style.cssText = "padding:14px 0;color:var(--s2);font-size:11px";
    vacio.textContent = "Esta unidad todavía no tiene accesorios capturados.";
    container.appendChild(vacio);
    return;
  }

  const table = document.createElement("table");
  table.className = "tl-table";
  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  for (const c of HIST_COLS) {
    const th = document.createElement("th");
    th.textContent = c;
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const e of unidad.historial) {
    const tr = document.createElement("tr");
    tr.style.cursor = "default";

    const tdTipo = document.createElement("td");
    tdTipo.style.cssText = "font-weight:600;color:var(--w1)";
    tdTipo.textContent = TIPO_LABEL[e.tipo];
    const esVigente = unidad.vigentes[e.tipo]?.accesorioId === e.accesorioId;
    if (esVigente) {
      const tag = document.createElement("span");
      tag.style.cssText =
        "font-size:8px;font-weight:700;color:var(--G);background:var(--Gd);padding:1px 5px;border-radius:3px;margin-left:4px";
      tag.textContent = "VIGENTE";
      tag.title = "Es el más reciente de su tipo en esta unidad";
      tdTipo.appendChild(tag);
    }
    tr.appendChild(tdTipo);

    const tdMarca = document.createElement("td");
    tdMarca.textContent = e.marca || "—";
    tr.appendChild(tdMarca);

    const tdSerie = document.createElement("td");
    tdSerie.style.cssText = "font-family:monospace;font-size:10px";
    tdSerie.textContent = e.numeroSerie || "—";
    tr.appendChild(tdSerie);

    const tdFecha = document.createElement("td");
    tdFecha.textContent = fmtFecha(e.fechaCompra);
    tr.appendChild(tdFecha);

    const tdAnt = document.createElement("td");
    tdAnt.style.color = "var(--s2)";
    tdAnt.textContent = fmtAntiguedad(e.antiguedadMeses);
    tr.appendChild(tdAnt);

    const tdCosto = document.createElement("td");
    tdCosto.style.cssText = "font-weight:600;color:var(--G)";
    tdCosto.textContent = e.costo != null ? fmtMXN(e.costo) : "—";
    tr.appendChild(tdCosto);

    const tdAcc = document.createElement("td");
    tdAcc.style.cssText = "white-space:nowrap;text-align:right";
    if (deps.puedeEscribir) {
      const bEd = document.createElement("button");
      bEd.className = "needs-write";
      bEd.style.cssText =
        "border:1px solid var(--ln);background:var(--bg2);color:var(--s1);border-radius:5px;padding:2px 7px;font-size:10px;cursor:pointer";
      bEd.textContent = "Editar";
      bEd.title = "Corregir marca, serie, fecha o costo";
      bEd.addEventListener("click", (ev) => {
        ev.stopPropagation();
        deps.onEditar?.(e);
      });
      const bDel = document.createElement("button");
      bDel.className = "needs-write";
      bDel.style.cssText =
        "border:1px solid var(--ln);background:var(--bg2);color:var(--R);border-radius:5px;padding:2px 7px;font-size:10px;cursor:pointer;margin-left:4px";
      bDel.textContent = "Borrar";
      bDel.addEventListener("click", (ev) => {
        ev.stopPropagation();
        deps.onBorrar?.(e);
      });
      tdAcc.append(bEd, bDel);
    }
    tr.appendChild(tdAcc);

    if (e.nota) {
      tbody.appendChild(tr);
      const trNota = document.createElement("tr");
      const tdNota = document.createElement("td");
      tdNota.colSpan = HIST_COLS.length;
      tdNota.style.cssText = "font-size:10px;color:var(--s2);padding-top:0";
      tdNota.textContent = `Nota: ${e.nota}`;
      trNota.appendChild(tdNota);
      tbody.appendChild(trNota);
      continue;
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

/** Rellena un <select> de sucursales con las presentes en las unidades. */
export function populateSucursalSelect(
  select: HTMLSelectElement,
  unidades: readonly AccesorioUnidad[],
): void {
  const previo = select.value;
  const sucursales = [...new Set(unidades.map((u) => u.sucursal).filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b), "es"),
  );
  select.textContent = "";
  const todas = document.createElement("option");
  todas.value = "";
  todas.textContent = "Todas las sucursales";
  select.appendChild(todas);
  for (const s of sucursales) {
    const opt = document.createElement("option");
    opt.value = String(s);
    opt.textContent = String(s);
    select.appendChild(opt);
  }
  if (previo && sucursales.includes(previo)) select.value = previo;
}
