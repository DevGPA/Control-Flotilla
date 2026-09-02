/**
 * Lógica PURA del módulo de Accesorios (sin DOM, sin Amplify) — testeable en vitest, igual
 * que src/compliance/complianceAnalysis.ts. Es la única fuente de verdad de:
 *   - la LLAVE de cada registro (de ella depende que recapturar no duplique),
 *   - qué accesorio está vigente en cada unidad (se DERIVA, no se guarda),
 *   - la antigüedad en meses (informativa: no hay umbral ni semáforo, por decisión de negocio).
 * `hoy` se INYECTA como parámetro (YYYY-MM-DD); aquí nunca se llama new Date().
 */
import {
  esAccesorioTipo,
  type AccesorioDoc,
  type AccesorioEntry,
  type AccesorioTipo,
  type AccesorioUnidad,
  type AccesoriosFilter,
  type AccesoriosSortCol,
  type CapturaAccesorioFields,
  type KpisAccesorios,
  type SortDir,
  type UnidadCatalogo,
} from "./types";

const ISO_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Normaliza el número de serie: mayúsculas, sin espacios y SIN "#".
 * El "#" separa tipo de identidad en accesorioId; una serie que lo contenga partiría la
 * llave y dejaría dos filas para la misma batería.
 */
export function normalizaSerie(s?: string | null): string {
  return String(s ?? "")
    .replace(/[\s#]/g, "")
    .toUpperCase();
}

/**
 * Llave natural del registro. Batería → su número de serie (identidad física real);
 * limpiabrisas → la fecha de compra (no tiene serie). "" si no hay identidad posible.
 * Consecuencia aceptada: dos limpiabrisas comprados el mismo día para la misma unidad son
 * UN registro (se entiende como el juego).
 */
export function buildAccesorioId(
  tipo: AccesorioTipo,
  campos: { numeroSerie?: string | null; fechaCompra?: string | null; marca?: string | null },
): string {
  const fecha = String(campos.fechaCompra ?? "").trim();
  if (tipo === "bateria") {
    const serie = normalizaSerie(campos.numeroSerie);
    if (serie) return `bateria#${serie}`;
    return fecha ? `bateria#${fecha}` : "";
  }
  if (tipo === "limpiabrisas") return fecha ? `limpiabrisas#${fecha}` : "";
  return "";
}

/** Meses CUMPLIDOS entre dos fechas YYYY-MM-DD. null si falta o es inválida; nunca negativo. */
export function mesesDesde(fechaCompra: string | undefined | null, hoy: string): number | null {
  const c = ISO_DIA.exec(String(fechaCompra ?? ""));
  const h = ISO_DIA.exec(String(hoy ?? ""));
  if (!c || !h) return null;
  let meses = (Number(h[1]) - Number(c[1])) * 12 + (Number(h[2]) - Number(c[2]));
  if (Number(h[3]) < Number(c[3])) meses--;
  return Math.max(0, meses);
}

/**
 * Valida los campos del formulario. Devuelve los mensajes a mostrar (vacío = todo bien).
 * Marca y fecha de compra son obligatorias en AMBOS accesorios; el número de serie solo en
 * la batería. La fecha de compra es obligatoria además por diseño: forma parte de la llave
 * del limpiabrisas, sin ella el registro no tiene identidad.
 */
export function validarCaptura(fields: CapturaAccesorioFields, hoy?: string): string[] {
  const errores: string[] = [];
  if (!String(fields.economicoId ?? "").trim())
    errores.push("Indica el número de unidad (económico).");
  if (!esAccesorioTipo(fields.tipo)) errores.push("Tipo de accesorio no reconocido.");
  if (!String(fields.marca ?? "").trim()) errores.push("La marca es obligatoria.");

  const fecha = String(fields.fechaCompra ?? "").trim();
  if (!fecha) errores.push("La fecha de compra es obligatoria.");
  else if (!ISO_DIA.test(fecha))
    errores.push("La fecha de compra debe ser una fecha válida (año-mes-día).");
  else if (hoy && fecha > hoy) errores.push("La fecha de compra no puede ser futura.");

  if (fields.tipo === "bateria" && !normalizaSerie(fields.numeroSerie))
    errores.push("El número de serie es obligatorio en la batería.");

  if (fields.costo != null && fields.costo < 0) errores.push("El costo no puede ser negativo.");
  return errores;
}

/** Normaliza un AccesorioDoc a AccesorioEntry (antigüedad derivada + datos de la unidad). */
export function toAccesorioEntry(
  doc: AccesorioDoc,
  hoy: string,
  info?: { placa?: string; sucursal?: string },
): AccesorioEntry {
  const entry: AccesorioEntry = { ...doc, antiguedadMeses: mesesDesde(doc.fechaCompra, hoy) };
  if (info?.placa) entry.placa = info.placa;
  if (info?.sucursal) entry.sucursal = info.sucursal;
  return entry;
}

/**
 * ¿`a` es más reciente que `b`? Manda la fecha de compra; un registro SIN fecha nunca
 * desplaza a uno que la tiene, y el empate se rompe por la última actualización (quien
 * capturó después gana).
 */
function esMasReciente(a: AccesorioEntry, b: AccesorioEntry): boolean {
  const fa = a.fechaCompra ?? "";
  const fb = b.fechaCompra ?? "";
  if (fa !== fb) return fa > fb;
  return (a.ultimaActualizacion ?? "") > (b.ultimaActualizacion ?? "");
}

/**
 * Agrupa los registros por unidad: vigente por tipo, historial descendente, gasto acumulado.
 * El orden de salida es el de primera aparición (el orden final lo decide filterAndSort).
 */
export function resumirPorUnidad(entries: readonly AccesorioEntry[]): AccesorioUnidad[] {
  const porEco = new Map<string, AccesorioUnidad>();
  for (const e of entries) {
    let u = porEco.get(e.economicoId);
    if (!u) {
      u = {
        economicoId: e.economicoId,
        vigentes: {},
        historial: [],
        cambios: 0,
        gastoTotal: 0,
      };
      porEco.set(e.economicoId, u);
    }
    u.historial.push(e);
    u.cambios++;
    u.gastoTotal += e.costo ?? 0;
    if (!u.placa && e.placa) u.placa = e.placa;
    if (!u.sucursal && e.sucursal) u.sucursal = e.sucursal;
    const vigente = u.vigentes[e.tipo];
    if (!vigente || esMasReciente(e, vigente)) u.vigentes[e.tipo] = e;
  }
  for (const u of porEco.values()) {
    u.historial.sort((a, b) => (esMasReciente(a, b) ? -1 : 1));
  }
  return [...porEco.values()];
}

/**
 * Fusiona el resumen con el catálogo de flota para que aparezcan también las unidades SIN
 * accesorios capturados (si no, "¿a quién le falta?" no se puede responder). Las unidades
 * con registros pero fuera del catálogo NO se pierden.
 */
export function mergeConFlota(
  resumen: readonly AccesorioUnidad[],
  catalogo: readonly UnidadCatalogo[],
): AccesorioUnidad[] {
  const porEco = new Map(resumen.map((u) => [u.economicoId, u]));
  const out: AccesorioUnidad[] = [];
  const vistos = new Set<string>();
  for (const c of catalogo) {
    const eco = String(c.eco ?? "").trim();
    if (!eco || vistos.has(eco)) continue;
    vistos.add(eco);
    const u = porEco.get(eco);
    if (u) out.push({ ...u, placa: u.placa ?? c.placa, sucursal: u.sucursal ?? c.sucursal });
    else
      out.push({
        economicoId: eco,
        placa: c.placa,
        sucursal: c.sucursal,
        vigentes: {},
        historial: [],
        cambios: 0,
        gastoTotal: 0,
      });
  }
  for (const u of resumen) if (!vistos.has(u.economicoId)) out.push(u);
  return out;
}

/** Normaliza para búsqueda: sin acentos, minúsculas. */
function norm(s?: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * ¿La unidad empata la búsqueda libre? Igual criterio que Taller (tallerStore.matchesSearch):
 * una consulta de solo dígitos es económico EXACTO — si no, buscar "9" traería 9, 19, 90 y 104.
 */
function matchesSearch(u: AccesorioUnidad, query: string): boolean {
  const q = norm(query).trim();
  if (!q) return true;
  if (/^\d+$/.test(q)) return norm(u.economicoId) === q;
  const campos = [u.economicoId, u.placa, u.sucursal];
  for (const e of u.historial) campos.push(e.marca, e.numeroSerie);
  return campos.some((f) => norm(f).includes(q));
}

function pasaVista(u: AccesorioUnidad, vista: AccesoriosFilter["vista"]): boolean {
  switch (vista) {
    case "conRegistro":
      return u.cambios > 0;
    case "sinBateria":
      return !u.vigentes.bateria;
    case "sinLimpiabrisas":
      return !u.vigentes.limpiabrisas;
    default:
      return true;
  }
}

/** Comparador de económicos: numérico cuando ambos lo son ("9" antes que "104"). */
function cmpEco(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b, "es", { numeric: true });
}

/** Filtra y ordena las filas de la tabla. PURO: no muta el arreglo recibido. */
export function filterAndSortAccesorios(
  unidades: readonly AccesorioUnidad[],
  filter: AccesoriosFilter,
  sortCol: AccesoriosSortCol = "eco",
  dir: SortDir = 1,
): AccesorioUnidad[] {
  const suc = String(filter.sucursal ?? "").trim();
  const out = unidades.filter(
    (u) =>
      pasaVista(u, filter.vista) &&
      (!suc || u.sucursal === suc) &&
      matchesSearch(u, filter.search ?? ""),
  );

  /** Valor de orden; null = "sin dato", siempre al final sin importar la dirección. */
  const valor = (u: AccesorioUnidad): string | number | null => {
    switch (sortCol) {
      case "placa":
        return u.placa ?? null;
      case "sucursal":
        return u.sucursal ?? null;
      case "bateria":
        return u.vigentes.bateria?.antiguedadMeses ?? null;
      case "limpiabrisas":
        return u.vigentes.limpiabrisas?.antiguedadMeses ?? null;
      case "cambios":
        return u.cambios;
      case "gasto":
        return u.gastoTotal;
      default:
        return null; // "eco" se compara aparte (numérico)
    }
  };

  return [...out].sort((a, b) => {
    if (sortCol === "eco") return cmpEco(a.economicoId, b.economicoId) * dir;
    const va = valor(a);
    const vb = valor(b);
    if (va == null && vb == null) return cmpEco(a.economicoId, b.economicoId);
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "number" && typeof vb === "number") {
      if (va !== vb) return (va - vb) * dir;
    } else {
      const c = String(va).localeCompare(String(vb), "es");
      if (c !== 0) return c * dir;
    }
    return cmpEco(a.economicoId, b.economicoId);
  });
}

/** Totales para las tarjetas de arriba. Se calculan sobre las unidades YA filtradas. */
export function buildKpisAccesorios(unidades: readonly AccesorioUnidad[]): KpisAccesorios {
  const k: KpisAccesorios = {
    unidades: unidades.length,
    conBateria: 0,
    conLimpiabrisas: 0,
    sinRegistro: 0,
    cambios: 0,
    gastoTotal: 0,
  };
  for (const u of unidades) {
    if (u.vigentes.bateria) k.conBateria++;
    if (u.vigentes.limpiabrisas) k.conLimpiabrisas++;
    if (u.cambios === 0) k.sinRegistro++;
    k.cambios += u.cambios;
    k.gastoTotal += u.gastoTotal;
  }
  return k;
}
