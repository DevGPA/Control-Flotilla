/**
 * Reglas de la LIGA del proveedor — capa PURA y módulo HOJA (solo importa tipos).
 *
 * Vive aparte de ./seguimiento a propósito: seguimiento importa de ../api/tallerPartidas,
 * que importa de ../api/batchUpload, y batchUpload necesita `revocacionPorCierre` para
 * revocar en el mismo upsert que cierra la visita (decisión 2). Si estas reglas vivieran
 * en seguimiento, batchUpload → seguimiento → tallerPartidas → batchUpload sería un ciclo.
 * seguimiento re-exporta todo esto: sus importadores no cambian.
 * Spec: docs/superpowers/specs/2026-09-22-taller-liga-cierre-y-llave-design.md §4.2/§4.5
 */
import type { TallerEntry } from "./types";

/** Debe coincidir con VIGENCIA_LIGA_MS del portal (taller-portal/token.ts).
 *  El frontend no puede importar del backend, así que se duplica y una prueba
 *  compara ambos valores: si alguien cambia uno, la prueba cae. */
export const VIGENCIA_LIGA_DIAS = 90;

export const DIA_MS = 24 * 60 * 60 * 1000;

export type EstadoLiga =
  | { kind: "sin-liga" }
  | {
      kind: "activa";
      diasRestantes: number;
      venceEn: string;
      emitidaEn: string;
      emitidaPor: string;
    }
  | { kind: "vencida"; vencioEn: string; emitidaEn: string; emitidaPor: string }
  /** Liga vigente (emitida, no revocada, no vencida) en una visita YA CERRADA: el portal la
   *  rechaza y el siguiente guardado la revoca (revocacionPorCierre). Solo la alcanzan las
   *  visitas cerradas ANTES de que el cierre revocara. */
  | { kind: "cerrada"; emitidaEn: string; emitidaPor: string }
  | { kind: "revocada"; revocadaEn: string; revocadaPor: string };

export function estadoLiga(e: Partial<TallerEntry>, ahoraISO: string): EstadoLiga {
  const emitidaEn = (e.ligaCreadaEn ?? "").trim();
  if (!emitidaEn) return { kind: "sin-liga" };

  const revocadaEn = (e.ligaRevocadaEn ?? "").trim();
  // Una revocación solo cuenta si es POSTERIOR a la emisión vigente: emitir
  // limpia esas columnas, pero una fila vieja puede traer ambas.
  if (revocadaEn && Date.parse(revocadaEn) >= Date.parse(emitidaEn)) {
    return { kind: "revocada", revocadaEn, revocadaPor: (e.ligaRevocadaPor ?? "").trim() };
  }

  const emitidaPor = (e.ligaCreadaPor ?? "").trim();
  const vence = Date.parse(emitidaEn) + VIGENCIA_LIGA_DIAS * DIA_MS;
  const ahora = Date.parse(ahoraISO);
  if (!Number.isFinite(vence) || !Number.isFinite(ahora)) return { kind: "sin-liga" };

  const venceEn = new Date(vence).toISOString();
  if (ahora >= vence) return { kind: "vencida", vencioEn: venceEn, emitidaEn, emitidaPor };
  if (visitaCerrada(e)) return { kind: "cerrada", emitidaEn, emitidaPor };
  return {
    kind: "activa",
    diasRestantes: Math.ceil((vence - ahora) / DIA_MS),
    venceEn,
    emitidaEn,
    emitidaPor,
  };
}

/** Una visita cerrada ya no debe nada: su promesa no vence. */
export function visitaCerrada(e: Partial<TallerEntry>): boolean {
  if ((e.fsalidaReal ?? "").trim()) return true;
  return e.estado === "Finalizado";
}

/**
 * Decisión 2 (spec §4.2): al CERRAR una visita cuya liga sigue vigente, el MISMO guardado la
 * revoca — no una segunda llamada que pueda fallar ni un permiso que 3 de 4 operativos no
 * tienen (`revocarLigaTaller` es admin/riesgos). Reabrir no la resucita.
 * Devuelve los tres campos a incluir en el upsert, o null si no hay nada que revocar.
 * `(e.ligaVersion ?? 1) + 1` es la MISMA regla que `revocarLiga` en el portal.
 */
export function revocacionPorCierre(
  e: Partial<TallerEntry>,
  ahoraISO: string,
  quien: string,
): { ligaVersion: number; ligaRevocadaEn: string; ligaRevocadaPor: string } | null {
  // "cerrada" = liga vigente en visita cerrada: exactamente el caso a revocar.
  if (estadoLiga(e, ahoraISO).kind !== "cerrada") return null;
  return {
    ligaVersion: (e.ligaVersion ?? 1) + 1,
    ligaRevocadaEn: ahoraISO,
    ligaRevocadaPor: `cierre:${(quien ?? "").trim() || "desconocido"}`,
  };
}
