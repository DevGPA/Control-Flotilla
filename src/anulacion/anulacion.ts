/**
 * Lógica PURA de anulación admin de registros (tombstone lógico reversible).
 * Sin DOM ni Amplify → testeable con vitest.
 *
 * El refId codifica el módulo + la identidad NATURAL del registro base, de modo
 * que la anulación sobreviva a cualquier re-ingest del webhook o backfill:
 *   combustible|<economicoId>|<tipo>|<eventoId>   (= "combustible|" + loadId)
 *   checklist|<unitUid>|<fecha>                   (identidad de Checklist)
 *   semanal|<periodoId>|<unitUid>                 (identidad de Semanal)
 *   taller|<unitUid>|<fechaEntrada>               (identidad de Taller = tallerCloudKey)
 */

export type AnulacionModulo = "combustible" | "checklist" | "semanal" | "taller";

/** Fila de Anulacion tal como viene del cloud (tipos laxos para testear sin Amplify). */
export interface AnulacionRow {
  refId: string;
  modulo?: string | null;
  motivo?: string | null;
  anuladoPor?: string | null;
  ts?: string | null;
  restauradaPor?: string | null;
  restauradaTs?: string | null;
}

/** Info de anulación que viaja pegada a un registro en el front. */
export type AnulacionInfo = {
  motivo: string;
  anuladoPor: string;
  ts: string;
};

export function refIdCombustible(loadId: string): string {
  return `combustible|${loadId}`;
}

export function refIdChecklist(unitUid: string, fecha: string): string {
  return `checklist|${unitUid}|${fecha}`;
}

export function refIdSemanal(periodoId: string, unitUid: string): string {
  return `semanal|${periodoId}|${unitUid}`;
}

/**
 * Identidad natural de un registro de Taller = su clave cloud (`tallerCloudKey` en
 * batchUpload.ts): unitUid = plate||eco||unitKey||id · fechaEntrada = fentrada||freporte||
 * `sin-fecha:<id>`. Los llamadores DEBEN componer con esa misma regla — el monolito lo hace
 * vía `window.__tallerRefId` (que llama a tallerCloudKey de verdad) y la hidratación con
 * los campos de clave de la propia fila cloud, así que no hay una segunda implementación
 * del criterio que pueda divergir.
 */
export function refIdTaller(unitUid: string, fechaEntrada: string): string {
  return `taller|${unitUid}|${fechaEntrada}`;
}

/** Módulo de un refId ("combustible|..." → "combustible"). "" si no parsea. */
export function moduloDeRefId(refId: string): string {
  return refId.split("|")[0] ?? "";
}

/**
 * ¿La anulación APLICA? (activa = sin restaurar). Restaurar no borra la fila —
 * la marca con restauradaTs para conservar el historial bidireccional.
 */
export function esAnulacionActiva(a: Pick<AnulacionRow, "restauradaTs">): boolean {
  return !a.restauradaTs;
}

/**
 * Mapa refId → info de las anulaciones ACTIVAS (las restauradas no excluyen nada).
 * Es el índice que la hidratación consulta para excluir/etiquetar registros.
 */
export function buildAnuladasActivas(rows: readonly AnulacionRow[]): Map<string, AnulacionInfo> {
  const m = new Map<string, AnulacionInfo>();
  for (const a of rows) {
    if (!a.refId || !esAnulacionActiva(a)) continue;
    m.set(a.refId, {
      motivo: a.motivo ?? "",
      anuladoPor: a.anuladoPor ?? "",
      ts: a.ts ?? "",
    });
  }
  return m;
}

/**
 * Predicados de exclusión de checklist/semanal.
 *
 * Viven aquí y no inline en la hidratación por una razón concreta: el `refId` lo componen
 * DOS lados (quien anula y quien hidrata), y si divergen la anulación se guarda pero no
 * excluye nada — falla EN SILENCIO. Teniendo un solo predicado, las pruebas ejercitan el
 * mismo código que corre en producción en vez de una copia del criterio.
 *
 * (Combustible no necesita predicado: `buildFuelEntries` ya etiqueta con `refIdCombustible`
 * y la exclusión la decide el consumidor — `wire.scoped()`.)
 */
export function esChecklistAnulado(
  row: { unitUid?: unknown; fecha?: unknown },
  anuladas: ReadonlyMap<string, AnulacionInfo>,
): boolean {
  return anuladas.has(refIdChecklist(String(row.unitUid ?? ""), String(row.fecha ?? "")));
}

export function esSemanalAnulado(
  row: { periodoId?: unknown; unitUid?: unknown },
  anuladas: ReadonlyMap<string, AnulacionInfo>,
): boolean {
  return anuladas.has(refIdSemanal(String(row.periodoId ?? ""), String(row.unitUid ?? "")));
}

/** La fila cloud de Taller trae su clave (unitUid, fechaEntrada) — se compone directo. */
export function esTallerAnulado(
  row: { unitUid?: unknown; fechaEntrada?: unknown },
  anuladas: ReadonlyMap<string, AnulacionInfo>,
): boolean {
  return anuladas.has(refIdTaller(String(row.unitUid ?? ""), String(row.fechaEntrada ?? "")));
}
