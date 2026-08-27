// Unidades vs inspecciones — dedupe del rango de Inspecciones.
//
// `window.units` (el rango Desde/Hasta) trae UNA FILA POR INSPECCIÓN (uid
// sintético `placa__fecha`): la misma unidad aparece N veces si tuvo N
// checklists en el rango. Eso es correcto para la tabla y sus chips (filtran
// filas), pero las hero cards que dicen "Unidades" (llanta crítica, servicio)
// deben contar unidades — con rango >1 mes inflaban en silencio.
//
// Criterio: la ÚLTIMA inspección por unidad dentro del rango (estado más
// reciente conocido), espejo de getSwUnitsInRange() de Semanales ("para que
// los conteos representen unidades, no inspecciones").

import { plateOf, isoDayOf } from "../analyzer/findingKey";

declare global {
  interface Window {
    /** Namespace para el legado (buildKPIs/_fleetSource/updateRangoCount). */
    __inspUnidades?: {
      latestPorUnidad: typeof latestPorUnidad;
      rangoCountLabel: typeof rangoCountLabel;
    };
  }
}

type RowKey = { plate?: string; uid?: string };
type RowFecha = RowKey & { fecha?: string };

/** Identidad de unidad de una fila de inspección: placa, o la placa del uid sintético. */
export function plateKey(u: RowKey): string {
  return u.plate || plateOf(u.uid) || String(u.uid ?? "");
}

/**
 * Reduce filas de inspección a una por unidad: la de fecha más reciente
 * (empate: conserva la primera vista, igual que Semanales). No muta el input.
 * No confía en el orden del arreglo — compara fechas explícitamente.
 */
export function latestPorUnidad<T extends RowFecha>(rows: readonly T[]): T[] {
  const porUnidad = new Map<string, T>();
  for (const r of rows) {
    const key = plateKey(r);
    const previa = porUnidad.get(key);
    if (!previa || isoDayOf(r.fecha) > isoDayOf(previa.fecha)) porUnidad.set(key, r);
  }
  return [...porUnidad.values()];
}

/**
 * Etiqueta del contador de la barra de rango. Cuando el rango cruza más de
 * un mes y hay unidades repetidas, transparenta la diferencia:
 * "34 inspecciones · 28 unidades". Si coinciden, solo "28 inspecciones".
 */
export function rangoCountLabel(rows: readonly RowFecha[]): string {
  const n = rows.length;
  const insp = n === 1 ? "1 inspección" : `${n} inspecciones`;
  const unidades = new Set(rows.map(plateKey)).size;
  if (unidades === n) return insp;
  const uds = unidades === 1 ? "1 unidad" : `${unidades} unidades`;
  return `${insp} · ${uds}`;
}
