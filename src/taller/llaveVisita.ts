/**
 * Regla PURA (sin DOM, sin red): ¿la identidad de una visita de Taller —
 * unidad + fecha de atención, la llave real del registro (`tallerCloudKey`)—
 * ya la usa otra visita?
 *
 * Por qué existe: la llave del modelo `Taller` es `unitUid|fechaEntrada`. Un
 * alta con la misma llave que una visita existente hace UPSERT sobre el mismo
 * registro: los `datos` anteriores desaparecen sin aviso, y la nueva hereda la
 * anulación (tombstone por la misma llave), la liga y las partidas de la vieja.
 * Incidente real 2026-09-22 (unidades de prueba 06/70). El arreglo de fondo es
 * una identidad sin fecha (frente #11); esta guarda cierra la puerta hoy.
 *
 * Ver spec docs/superpowers/specs/2026-09-22-taller-liga-cierre-y-llave-design.md §4.1
 */
import { refIdTaller } from "../anulacion/anulacion";

export type LlaveVisita = { id?: string; unitUid: string; fechaEntrada: string };

export type LlaveEnUso =
  | { kind: "libre" }
  /** Otra visita VISIBLE ya tiene esa llave. */
  | { kind: "vigente"; id: string; fentrada: string }
  /** Una visita ANULADA tiene esa llave: el alta heredaría su tombstone. */
  | { kind: "anulada"; fentrada: string; anuladaEn?: string };

export function llaveEnUso(
  candidata: LlaveVisita,
  vigentes: readonly LlaveVisita[],
  /** window.__anuladasActivas: refId → info (solo anulaciones ACTIVAS). */
  anuladas: ReadonlyMap<string, { ts?: string }>,
): LlaveEnUso {
  const vigente = vigentes.find(
    (v) =>
      v.unitUid === candidata.unitUid &&
      v.fechaEntrada === candidata.fechaEntrada &&
      // Editar la propia visita sin mover su llave no es una colisión.
      !(candidata.id && v.id === candidata.id),
  );
  if (vigente)
    return { kind: "vigente", id: String(vigente.id ?? ""), fentrada: vigente.fechaEntrada };

  const info = anuladas.get(refIdTaller(candidata.unitUid, candidata.fechaEntrada));
  if (info) return { kind: "anulada", fentrada: candidata.fechaEntrada, anuladaEn: info.ts };

  return { kind: "libre" };
}
