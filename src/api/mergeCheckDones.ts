// mergeCheckDones — fusión PURA de los registros CheckDone cloud en checklistDB.
//
// Fase C1 (audit 2026-06-04): reemplaza el merge solo-aditivo de cloudHydrate.
// - unitUid cloud = PLACA (registros nuevos) o `placa__fecha` (legacy) → plateOf.
// - FAN-OUT: cada CheckDone se aplica a TODAS las filas de inspección de esa
//   placa (la marca es del problema físico de la unidad; el corte temporal de
//   isFindingDone decide por-fila si aplica).
// - TOMBSTONES: done:false se ESCRIBE como {done:false, ts} — no se borra la
//   entry (perder el ts rompería el LWW del dual-read frente a alias legacy).
//   Así el desmarcado de un usuario se propaga a los demás.
// - dirty-skip: un toggle local más reciente que el registro cloud no se pisa
//   (race hydrate-en-vuelo vs toggle).
// Pura: no toca window ni IndexedDB; devuelve los uids modificados para que el
// caller persista (dbPut) y re-renderice.

import { plateOf, type DoneEntry, type DoneMap } from "../analyzer/findingKey";

export type CheckDoneRow = {
  unitUid?: string | null;
  itemKey?: string | null;
  done?: boolean | null;
  ts?: string | null;
  por?: string | null;
};

export type RowRef = { uid: string; plate?: string | null };

export function mergeCheckDones(opts: {
  checkDones: CheckDoneRow[];
  rows: RowRef[];
  cdb: Record<string, DoneMap>;
  dirty?: Record<string, string>;
}): { cdb: Record<string, DoneMap>; modifiedUids: string[] } {
  const { checkDones, rows, cdb, dirty = {} } = opts;

  const byPlate = new Map<string, string[]>();
  for (const r of rows) {
    const p = String(r.plate ?? plateOf(r.uid) ?? "").trim();
    if (!p || p === "SIN_ID") continue;
    const arr = byPlate.get(p) ?? [];
    arr.push(r.uid);
    byPlate.set(p, arr);
  }

  const modified = new Set<string>();
  for (const cd of checkDones) {
    const key = cd.itemKey ?? "";
    const rawUid = String(cd.unitUid ?? "");
    if (!key || !rawUid) continue;
    const plate = plateOf(rawUid).trim();
    if (!plate || plate === "SIN_ID") continue;

    const cdTs = cd.ts ?? "";
    const dirtyTs = dirty[`${plate} ${key}`];
    if (dirtyTs && dirtyTs > cdTs) continue; // el toggle local es más nuevo

    const entry: DoneEntry = {
      done: cd.done !== false,
      ts: cd.ts ?? undefined,
      by: cd.por ?? undefined,
    };
    // Fan-out a todas las filas de la placa + el uid crudo del registro
    // (cubre filas legacy `placa__fecha` que no estén en rows).
    const uids = new Set<string>([...(byPlate.get(plate) ?? []), rawUid]);
    for (const uid of uids) {
      const m = (cdb[uid] ??= {});
      const prev = m[key];
      if (prev && (prev.ts ?? "") > cdTs) continue; // LWW dentro de la misma key
      m[key] = entry;
      modified.add(uid);
    }
  }
  return { cdb, modifiedUids: [...modified] };
}
