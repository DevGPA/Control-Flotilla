/**
 * Seguimiento del proveedor — capa PURA (sin DOM, sin red).
 *
 * Todo lo que calcula sale de columnas que el portal y el resolver YA escriben:
 * este módulo no inventa datos ni hace aritmética de dinero (para eso está
 * gastoDerivado en ./partidas). Ver la spec
 * docs/superpowers/specs/2026-09-15-taller-seguimiento-proveedor-design.md
 */
import type { TallerEntry } from "./types";

/** Debe coincidir con VIGENCIA_LIGA_MS del portal (taller-portal/token.ts).
 *  El frontend no puede importar del backend, así que se duplica y una prueba
 *  compara ambos valores: si alguien cambia uno, la prueba cae. */
export const VIGENCIA_LIGA_DIAS = 90;

const DIA_MS = 24 * 60 * 60 * 1000;

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
  return {
    kind: "activa",
    diasRestantes: Math.ceil((vence - ahora) / DIA_MS),
    venceEn,
    emitidaEn,
    emitidaPor,
  };
}

export type PromesaTaller =
  | { kind: "sin-promesa" }
  | { kind: "vigente"; fecha: string; diasRestantes: number; compromisoOriginal?: string }
  | { kind: "vencida"; fecha: string; diasVencida: number; compromisoOriginal?: string };

/** Una visita cerrada ya no debe nada: su promesa no vence. */
function visitaCerrada(e: Partial<TallerEntry>): boolean {
  if ((e.fsalidaReal ?? "").trim()) return true;
  return e.estado === "Finalizado";
}

export function promesaTaller(e: Partial<TallerEntry>, hoyISO: string): PromesaTaller {
  const fecha = (e.fsalidaEstTaller ?? "").trim().slice(0, 10);
  if (!fecha) return { kind: "sin-promesa" };

  const original = (e.fsalidaEstCompromiso ?? "").trim().slice(0, 10);
  const compromisoOriginal = original && original !== fecha ? original : undefined;

  // Comparación por fecha CIVIL: sin horas ni husos, que es como el taller la
  // captura y como Riesgos la lee.
  const hoy = Date.parse(`${hoyISO.slice(0, 10)}T00:00:00Z`);
  const prometida = Date.parse(`${fecha}T00:00:00Z`);
  if (!Number.isFinite(hoy) || !Number.isFinite(prometida)) return { kind: "sin-promesa" };

  const dias = Math.round((prometida - hoy) / DIA_MS);
  if (dias < 0 && !visitaCerrada(e)) {
    return { kind: "vencida", fecha, diasVencida: -dias, compromisoOriginal };
  }
  return { kind: "vigente", fecha, diasRestantes: Math.max(dias, 0), compromisoOriginal };
}
