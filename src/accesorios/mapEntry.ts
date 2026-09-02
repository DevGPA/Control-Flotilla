/**
 * Mapeo nube ↔ front del módulo de Accesorios:
 *   - AccesorioRow[] (filas crudas de DynamoDB, opcionales posiblemente null) → AccesorioEntry[]
 *   - campos del formulario → AccesorioDoc a persistir (con su llave natural)
 * PURO y testeable sin DOM ni Amplify, igual que src/compliance/mapEntry.ts.
 */
import { buildAccesorioId, normalizaSerie, toAccesorioEntry } from "./accesoriosAnalysis";
import {
  esAccesorioTipo,
  type AccesorioDoc,
  type AccesorioEntry,
  type AccesorioTipo,
  type CapturaAccesorioFields,
} from "./types";

/** Fila cruda de DynamoDB (modelo `Accesorio`); los opcionales pueden venir null. */
export type AccesorioRow = {
  tenantId?: string | null;
  economicoId?: string | null;
  accesorioId?: string | null;
  tipo?: string | null;
  marca?: string | null;
  numeroSerie?: string | null;
  fechaCompra?: string | null;
  costo?: number | null;
  nota?: string | null;
  capturadoPor?: string | null;
  ultimaActualizacion?: string | null;
};

/** Datos de la unidad para resolver sucursal/placa por economicoId. */
export type UnitInfo = { sucursal?: string; placa?: string };

/**
 * Fila cruda → AccesorioDoc. null si le falta identidad mínima o si el tipo no es uno que
 * este front sepa pintar (una versión futura del esquema podría traer otros accesorios).
 * El `trim` del económico es indispensable: sin él un "  78  " no empata el catálogo de
 * flota y la unidad aparece como "sin accesorios".
 */
function rowToDoc(r: AccesorioRow): AccesorioDoc | null {
  const tenantId = String(r.tenantId ?? "").trim();
  const economicoId = String(r.economicoId ?? "").trim();
  const accesorioId = String(r.accesorioId ?? "").trim();
  const tipo = String(r.tipo ?? "").trim();
  if (!tenantId || !economicoId || !accesorioId || !esAccesorioTipo(tipo)) return null;
  const doc: AccesorioDoc = { tenantId, economicoId, accesorioId, tipo: tipo as AccesorioTipo };
  if (r.marca) doc.marca = r.marca;
  if (r.numeroSerie) doc.numeroSerie = r.numeroSerie;
  if (r.fechaCompra) doc.fechaCompra = r.fechaCompra;
  if (r.costo != null && r.costo >= 0) doc.costo = r.costo; // descarta costos negativos corruptos
  if (r.nota) doc.nota = r.nota;
  if (r.capturadoPor) doc.capturadoPor = r.capturadoPor;
  if (r.ultimaActualizacion) doc.ultimaActualizacion = r.ultimaActualizacion;
  return doc;
}

/**
 * Construye los AccesorioEntry del front a partir de las filas crudas y "hoy" (YYYY-MM-DD).
 * Con `unitsByEco` adjunta sucursal/placa por economicoId (el caller arma el Map, para no
 * acoplar esto a window ni a un tipo concreto de unidad).
 */
export function buildAccesorioEntries(
  rows: readonly AccesorioRow[],
  hoy: string,
  opts?: { unitsByEco?: ReadonlyMap<string, UnitInfo> },
): AccesorioEntry[] {
  const out: AccesorioEntry[] = [];
  for (const r of rows) {
    const doc = rowToDoc(r);
    if (!doc) continue;
    out.push(toAccesorioEntry(doc, hoy, opts?.unitsByEco?.get(doc.economicoId)));
  }
  return out;
}

/**
 * Campos del formulario → AccesorioDoc a persistir. PURO (`now` en ISO se inyecta).
 * La llave la arma buildAccesorioId: batería por número de serie, limpiabrisas por fecha de
 * compra → recapturar lo mismo ACTUALIZA en vez de duplicar.
 * El número de serie solo se guarda en batería (el limpiabrisas no tiene).
 * Un costo de 0 SÍ se guarda: es un accesorio cambiado en garantía, no un dato ausente.
 */
export function buildAccesorioDoc(
  tenantId: string,
  fields: CapturaAccesorioFields,
  now: string,
  capturadoPor?: string,
): AccesorioDoc {
  const serie = fields.tipo === "bateria" ? normalizaSerie(fields.numeroSerie) : "";
  const fechaCompra = String(fields.fechaCompra ?? "").trim();
  const doc: AccesorioDoc = {
    tenantId: tenantId.trim(),
    economicoId: String(fields.economicoId ?? "").trim(),
    accesorioId: buildAccesorioId(fields.tipo, { numeroSerie: serie, fechaCompra }),
    tipo: fields.tipo,
    ultimaActualizacion: now,
  };
  const marca = String(fields.marca ?? "").trim();
  if (marca) doc.marca = marca;
  if (serie) doc.numeroSerie = serie;
  if (fechaCompra) doc.fechaCompra = fechaCompra;
  if (fields.costo != null && fields.costo >= 0) doc.costo = fields.costo;
  const nota = String(fields.nota ?? "").trim();
  if (nota) doc.nota = nota;
  if (capturadoPor?.trim()) doc.capturadoPor = capturadoPor.trim();
  return doc;
}
