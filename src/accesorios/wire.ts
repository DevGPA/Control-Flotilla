/**
 * Glue de la sub-pestaña "Accesorios" de Taller: monta las funciones globales que el HTML
 * y cloudHydrate invocan (window.renderAccesorios / openAccesorioHistorial /
 * openAccesorioCaptura), mantiene el estado de UI (filtros, orden, registro en edición) y
 * orquesta cálculo (accesoriosAnalysis) + render (renderAccesorios) + persistencia (client).
 *
 * Importado una vez desde src/main.ts. Aquí SOLO cableado de DOM: todo acceso va con guarda
 * porque los elementos pueden no existir todavía. Los listeners se enganchan con
 * addEventListener y NO con onclick inline, para no tocar los <script> del HTML (trampa CSP).
 */
import {
  buildKpisAccesorios,
  filterAndSortAccesorios,
  mergeConFlota,
  resumirPorUnidad,
  toAccesorioEntry,
  validarCaptura,
} from "./accesoriosAnalysis";
import { buildAccesorioDoc } from "./mapEntry";
import {
  populateSucursalSelect,
  renderHistorialUnidad,
  renderKpisAccesorios,
  renderTableAccesorios,
} from "./renderAccesorios";
import {
  TIPO_LABEL,
  type AccesorioEntry,
  type AccesorioTipo,
  type AccesorioUnidad,
  type AccesoriosFilter,
  type AccesoriosSortCol,
  type CapturaAccesorioFields,
  type SortDir,
  type UnidadCatalogo,
} from "./types";
import { deleteAccesorio, upsertAccesorio } from "../api/client";

declare global {
  interface Window {
    /** Registros de accesorios hidratados de la nube (los pobla cloudHydrate). */
    accesorioEntries?: AccesorioEntry[];
    /** Pinta la sub-pestaña. La llaman tlSwitch (HTML) y cloudHydrate. */
    renderAccesorios?: () => void;
    /** Abre el historial de accesorios de una unidad. */
    openAccesorioHistorial?: (eco: string) => void;
    /** Abre el formulario de captura (opcionalmente con la unidad precargada). */
    openAccesorioCaptura?: (eco?: string) => void;
  }
}

// ── Estado de UI ──────────────────────────────────────────────────────────────────
const filter: AccesoriosFilter = { vista: "all", sucursal: "", search: "" };
let sortCol: AccesoriosSortCol = "eco";
let sortDir: SortDir = 1;
let searchDebounce: ReturnType<typeof setTimeout> | null = null;
/** Unidad cuyo historial está abierto en el modal (para re-pintarlo tras guardar/borrar). */
let ecoAbierto: string | null = null;
/**
 * Registro que se está editando. Se guarda la llave ORIGINAL porque corregir la serie, la
 * fecha o la unidad CAMBIA la llave: hay que borrar la fila vieja o quedan dos (el mismo
 * problema que resolvió __cloudReplaceTaller en los ingresos de taller).
 */
let editando: { economicoId: string; accesorioId: string } | null = null;

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function hoyMexicoISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}

function tenantId(): string {
  return window.__cloudSession?.tenantId || "gpa";
}

function puedeEscribir(): boolean {
  return typeof window.canWrite !== "function" || window.canWrite();
}

// ── Cálculo ───────────────────────────────────────────────────────────────────────

/**
 * Catálogo de flota (legacy window.__fleetUnits) → forma mínima para el merge.
 * A diferencia de Cumplimiento, aquí SÍ entran los montacargas: no circulan en vía pública
 * (no tienen placas ni verificación), pero sí traen batería y se les cambia.
 */
function catalogoFlota(): UnidadCatalogo[] {
  const fleet = (window.__fleetUnits ?? []) as Array<{
    eco?: string;
    plate?: string;
    branch?: string;
  }>;
  const out: UnidadCatalogo[] = [];
  const vistos = new Set<string>();
  for (const u of fleet) {
    const eco = String(u.eco ?? "").trim();
    if (!eco || vistos.has(eco)) continue;
    vistos.add(eco);
    out.push({ eco, sucursal: u.branch, placa: u.plate });
  }
  return out;
}

/** Todas las unidades con su rollup (sin filtros de UI ni scope de sucursal). */
function unidadesFlota(): AccesorioUnidad[] {
  const entries = window.accesorioEntries ?? [];
  return mergeConFlota(resumirPorUnidad(entries), catalogoFlota());
}

/** Unidades para la vista: las de la flota, scopeadas por la sucursal del usuario. */
function unidadesVisibles(): AccesorioUnidad[] {
  const todas = unidadesFlota();
  if (typeof window.scopeBySucursal !== "function") return todas;
  // Las unidades sin sucursal (registros cuyo eco no está en el catálogo) no deben caer del
  // scope: son justamente las que hay que revisar.
  const conSucursal = todas.filter((u) => u.sucursal);
  const sinSucursal = todas.filter((u) => !u.sucursal);
  return [...window.scopeBySucursal(conSucursal), ...sinSucursal];
}

// ── Render ────────────────────────────────────────────────────────────────────────

function renderAccesorios(): void {
  const tbody = $("acc-tbody");
  const thead = $("acc-thead");
  if (!tbody || !thead) return; // la vista aún no está montada en el HTML
  // No reconstruir si la vista no está activa (mismo criterio de rendimiento que
  // Cumplimiento: tlSwitch re-invoca al entrar a la pestaña).
  if (document.body.dataset.view !== "taller") return;

  const unidades = unidadesVisibles();
  const filtradas = filterAndSortAccesorios(unidades, filter, sortCol, sortDir);

  const kpis = $("acc-kpis");
  if (kpis) renderKpisAccesorios(kpis, buildKpisAccesorios(filtradas));

  const selSuc = $("acc-sucursal");
  if (selSuc instanceof HTMLSelectElement) populateSucursalSelect(selSuc, unidades);

  renderTableAccesorios({
    thead,
    tbody,
    unidades: filtradas,
    sortCol,
    sortDir,
    search: filter.search,
    onSort: (col) => {
      if (sortCol === col) sortDir = sortDir === 1 ? -1 : 1;
      else {
        sortCol = col;
        // Texto asciende (A→Z); números descienden (lo más antiguo / más caro primero).
        sortDir = col === "eco" || col === "placa" || col === "sucursal" ? 1 : -1;
      }
      renderAccesorios();
    },
    onOpen: (eco) => openAccesorioHistorial(eco),
  });

  const count = $("acc-count");
  if (count)
    count.textContent = `${filtradas.length} ${filtradas.length === 1 ? "unidad" : "unidades"}`;
}

/** Re-pinta la tabla y, si está abierto, el historial de la unidad. */
function reRender(): void {
  renderAccesorios();
  if (ecoAbierto) pintarHistorial(ecoAbierto);
}

// ── Historial por unidad (modal) ──────────────────────────────────────────────────

function pintarHistorial(eco: string): void {
  const body = $("acc-modal-body");
  if (!body) return;
  const unidad = unidadesFlota().find((u) => u.economicoId === eco);
  const title = $("acc-modal-title");
  if (title)
    title.textContent = `Accesorios · Unidad ${eco}${unidad?.placa ? ` · ${unidad.placa}` : ""}`;
  if (!unidad) {
    body.textContent = "";
    return;
  }
  renderHistorialUnidad(body, {
    unidad,
    puedeEscribir: puedeEscribir(),
    onEditar: (entry) => openAccesorioCaptura(entry.economicoId, entry),
    onBorrar: (entry) => borrar(entry),
  });
}

function openAccesorioHistorial(eco: string): void {
  const modal = $("acc-modal");
  if (!modal) return;
  ecoAbierto = eco;
  pintarHistorial(eco);
  modal.style.display = "flex";
  const w = window as unknown as { __wireOverlayTrap?: (id: string) => void };
  w.__wireOverlayTrap?.("acc-modal");
  const btn = $("acc-modal-new");
  if (btn) setTimeout(() => btn.focus(), 30);
}

function cerrarHistorial(): void {
  ecoAbierto = null;
  const modal = $("acc-modal");
  if (modal) modal.style.display = "none";
}

// ── Formulario de captura ─────────────────────────────────────────────────────────

function input(id: string): HTMLInputElement | null {
  const el = $(id);
  return el instanceof HTMLInputElement ? el : null;
}

function poblarDatalistUnidades(): void {
  const list = $("af-eco-list");
  if (!list) return;
  list.textContent = "";
  for (const u of catalogoFlota()) {
    const opt = document.createElement("option");
    opt.value = u.eco;
    const detalle = [u.placa, u.sucursal].filter(Boolean).join(" · ");
    if (detalle) opt.label = detalle;
    list.appendChild(opt);
  }
}

/** Muestra el campo de serie solo en batería (el limpiabrisas no tiene). */
function toggleSerie(): void {
  const tipo = ($("af-tipo") as HTMLSelectElement | null)?.value;
  const wrap = $("af-serie-wrap");
  if (wrap) wrap.style.display = tipo === "bateria" ? "" : "none";
}

function mostrarErrores(errores: string[]): void {
  const box = $("acc-form-err");
  if (!box) return;
  box.textContent = "";
  box.style.display = errores.length ? "" : "none";
  for (const e of errores) {
    const li = document.createElement("div");
    li.textContent = `• ${e}`;
    box.appendChild(li);
  }
}

function openAccesorioCaptura(eco?: string, entry?: AccesorioEntry): void {
  if (!puedeEscribir()) {
    window.notify?.("Tu cuenta es de solo lectura: no puedes capturar accesorios.", "warn", 4000);
    return;
  }
  const modal = $("acc-form-modal");
  if (!modal) return;
  poblarDatalistUnidades();
  editando = entry ? { economicoId: entry.economicoId, accesorioId: entry.accesorioId } : null;

  const selTipo = $("af-tipo") as HTMLSelectElement | null;
  if (input("af-eco")) input("af-eco")!.value = entry?.economicoId ?? eco ?? "";
  if (selTipo) selTipo.value = entry?.tipo ?? "bateria";
  if (input("af-marca")) input("af-marca")!.value = entry?.marca ?? "";
  if (input("af-serie")) input("af-serie")!.value = entry?.numeroSerie ?? "";
  if (input("af-fcompra")) input("af-fcompra")!.value = entry?.fechaCompra ?? "";
  if (input("af-costo")) input("af-costo")!.value = entry?.costo != null ? String(entry.costo) : "";
  if (input("af-nota")) input("af-nota")!.value = entry?.nota ?? "";
  // La fecha de compra no puede ser futura: el propio control lo impide.
  if (input("af-fcompra")) input("af-fcompra")!.max = hoyMexicoISO();

  const title = $("acc-form-title");
  if (title)
    title.textContent = entry
      ? `Editar ${TIPO_LABEL[entry.tipo].toLowerCase()} · Unidad ${entry.economicoId}`
      : "Nuevo accesorio";
  toggleSerie();
  mostrarErrores([]);
  modal.style.display = "flex";
  const w = window as unknown as { __wireOverlayTrap?: (id: string) => void };
  w.__wireOverlayTrap?.("acc-form-modal");
  setTimeout(() => input("af-eco")?.focus(), 30);
}

function cerrarCaptura(): void {
  editando = null;
  const modal = $("acc-form-modal");
  if (modal) modal.style.display = "none";
}

function leerFormulario(): CapturaAccesorioFields {
  const tipoRaw = ($("af-tipo") as HTMLSelectElement | null)?.value ?? "";
  const costoRaw = input("af-costo")?.value ?? "";
  return {
    economicoId: input("af-eco")?.value.trim() ?? "",
    tipo: tipoRaw as AccesorioTipo,
    marca: input("af-marca")?.value.trim() ?? "",
    numeroSerie: input("af-serie")?.value.trim() ?? "",
    fechaCompra: input("af-fcompra")?.value.trim() ?? "",
    costo: costoRaw === "" ? null : Number(costoRaw),
    nota: input("af-nota")?.value.trim() ?? "",
  };
}

// ── Persistencia (optimista, con rollback) ────────────────────────────────────────

/**
 * Aplica el cambio a window.accesorioEntries, re-pinta y persiste. Si la nube falla,
 * restaura el estado anterior y avisa — así la UI nunca miente sobre lo que quedó guardado.
 */
function aplicar(
  next: AccesorioEntry[],
  prev: AccesorioEntry[],
  persist: () => Promise<unknown>,
  errMsg: string,
): void {
  window.accesorioEntries = next;
  reRender();
  persist().catch((e) => {
    console.warn("[accesorios] persistencia falló:", e);
    window.accesorioEntries = prev;
    reRender();
    window.notify?.(errMsg, "error", 5000);
  });
}

function guardar(): void {
  if (!puedeEscribir()) {
    window.notify?.("Tu cuenta es de solo lectura: no puedes capturar accesorios.", "warn", 4000);
    return;
  }
  const fields = leerFormulario();
  const errores = validarCaptura(fields, hoyMexicoISO());
  if (errores.length) {
    mostrarErrores(errores);
    return;
  }
  const doc = buildAccesorioDoc(
    tenantId(),
    fields,
    new Date().toISOString(),
    window.__cloudSession?.email || undefined,
  );
  const prev = window.accesorioEntries ?? [];
  const unidad = unidadesFlota().find((u) => u.economicoId === doc.economicoId);
  const entry = toAccesorioEntry(doc, hoyMexicoISO(), {
    placa: unidad?.placa,
    sucursal: unidad?.sucursal,
  });
  const original = editando;
  // Fuera la fila con la MISMA llave (re-captura = corrección) y, si se editó, la original
  // (cambiar serie/fecha/unidad genera una llave nueva).
  const next = prev.filter(
    (e) =>
      !(e.economicoId === doc.economicoId && e.accesorioId === doc.accesorioId) &&
      !(
        original &&
        e.economicoId === original.economicoId &&
        e.accesorioId === original.accesorioId
      ),
  );
  next.push(entry);

  const cambioDeLlave =
    original &&
    (original.economicoId !== doc.economicoId || original.accesorioId !== doc.accesorioId);

  cerrarCaptura();
  aplicar(
    next,
    prev,
    async () => {
      await upsertAccesorio(doc);
      // El borrado de la fila vieja va DESPUÉS del alta: si falla el alta, no se pierde nada.
      if (cambioDeLlave && original)
        await deleteAccesorio({
          tenantId: tenantId(),
          economicoId: original.economicoId,
          accesorioId: original.accesorioId,
        });
    },
    "No se pudo guardar el accesorio. Revisa tu conexión e inténtalo de nuevo.",
  );
  const guardado = doc.tipo === "bateria" ? "guardada" : "guardado";
  window.notify?.(
    `${TIPO_LABEL[doc.tipo]} de la unidad ${doc.economicoId} ${guardado}.`,
    "ok",
    3000,
  );
}

function borrar(entry: AccesorioEntry): void {
  if (!puedeEscribir()) {
    window.notify?.("Tu cuenta es de solo lectura: no puedes borrar accesorios.", "warn", 4000);
    return;
  }
  const que = `${TIPO_LABEL[entry.tipo]}${entry.marca ? ` ${entry.marca}` : ""}`;
  if (
    !confirm(
      `¿Borrar el registro de ${que} de la unidad ${entry.economicoId}?\n\nEsta acción no se puede deshacer.`,
    )
  )
    return;
  const prev = window.accesorioEntries ?? [];
  const next = prev.filter(
    (e) => !(e.economicoId === entry.economicoId && e.accesorioId === entry.accesorioId),
  );
  aplicar(
    next,
    prev,
    () =>
      deleteAccesorio({
        tenantId: tenantId(),
        economicoId: entry.economicoId,
        accesorioId: entry.accesorioId,
      }),
    "No se pudo borrar el accesorio.",
  );
}

// ── Listeners ─────────────────────────────────────────────────────────────────────

function mountControls(): void {
  const selVista = $("acc-vista");
  if (selVista instanceof HTMLSelectElement)
    selVista.addEventListener("change", () => {
      filter.vista = selVista.value as AccesoriosFilter["vista"];
      renderAccesorios();
    });

  const selSuc = $("acc-sucursal");
  if (selSuc instanceof HTMLSelectElement)
    selSuc.addEventListener("change", () => {
      filter.sucursal = selSuc.value;
      renderAccesorios();
    });

  const search = input("acc-search");
  if (search)
    search.addEventListener("input", () => {
      if (searchDebounce) clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        filter.search = search.value;
        renderAccesorios();
      }, 180);
    });

  $("acc-clear")?.addEventListener("click", () => {
    filter.vista = "all";
    filter.sucursal = "";
    filter.search = "";
    if (selVista instanceof HTMLSelectElement) selVista.value = "all";
    if (selSuc instanceof HTMLSelectElement) selSuc.value = "";
    if (search) search.value = "";
    renderAccesorios();
  });

  $("acc-new")?.addEventListener("click", () => openAccesorioCaptura());
  $("acc-modal-new")?.addEventListener("click", () => {
    if (ecoAbierto) openAccesorioCaptura(ecoAbierto);
  });
  $("acc-modal-close")?.addEventListener("click", cerrarHistorial);
  $("acc-modal")?.addEventListener("click", (ev) => {
    if (ev.target === $("acc-modal")) cerrarHistorial();
  });
  $("acc-form-cancel")?.addEventListener("click", cerrarCaptura);
  $("acc-form-close")?.addEventListener("click", cerrarCaptura);
  $("acc-form-save")?.addEventListener("click", guardar);
  $("acc-form-modal")?.addEventListener("click", (ev) => {
    if (ev.target === $("acc-form-modal")) cerrarCaptura();
  });
  $("af-tipo")?.addEventListener("change", toggleSerie);

  // Exportar a Excel: exceljs se carga on-demand (chunk aparte, patrón de rendimiento).
  const btnExport = $("acc-export");
  if (btnExport instanceof HTMLButtonElement)
    btnExport.addEventListener("click", async () => {
      const unidades = filterAndSortAccesorios(unidadesVisibles(), filter, sortCol, sortDir);
      if (!unidades.length) {
        window.notify?.("No hay unidades que exportar con los filtros actuales.", "info", 3000);
        return;
      }
      const previo = btnExport.textContent;
      btnExport.disabled = true;
      btnExport.textContent = "Generando…";
      try {
        const { downloadAccesoriosXlsx } = await import("./accesoriosExcel");
        const hoy = hoyMexicoISO();
        await downloadAccesoriosXlsx(
          unidades,
          { hoy, exportadoEl: new Date(), sucursal: filter.sucursal || undefined },
          `Accesorios-GPA-${hoy}.xlsx`,
        );
      } catch (e) {
        console.warn("[accesorios] export falló:", e);
        window.notify?.("No se pudo generar el Excel.", "error", 4000);
      } finally {
        btnExport.disabled = false;
        btnExport.textContent = previo ?? "Exportar Excel";
      }
    });
}

// Exponer al HTML (tlSwitch) y a cloudHydrate.
window.renderAccesorios = renderAccesorios;
window.openAccesorioHistorial = openAccesorioHistorial;
window.openAccesorioCaptura = openAccesorioCaptura;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountControls);
} else {
  mountControls();
}
