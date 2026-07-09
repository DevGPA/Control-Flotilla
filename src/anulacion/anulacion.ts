/**
 * Lógica PURA de anulación admin de registros (tombstone lógico reversible).
 * Sin DOM ni Amplify → testeable con vitest.
 *
 * El refId codifica el módulo + la identidad NATURAL del registro base, de modo
 * que la anulación sobreviva a cualquier re-ingest del webhook o backfill:
 *   combustible|<economicoId>|<tipo>|<eventoId>   (= "combustible|" + loadId)
 *   checklist|<unitUid>|<fecha>                   (identidad de Checklist)
 *   semanal|<periodoId>|<unitUid>                 (identidad de Semanal)
 */

export type AnulacionModulo = "combustible" | "checklist" | "semanal";

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
