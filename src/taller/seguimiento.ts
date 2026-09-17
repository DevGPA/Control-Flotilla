/**
 * Seguimiento del proveedor — capa PURA (sin DOM, sin red).
 *
 * Todo lo que calcula sale de columnas que el portal y el resolver YA escriben:
 * este módulo no inventa datos ni hace aritmética de dinero (para eso está
 * gastoDerivado en ./partidas). Ver la spec
 * docs/superpowers/specs/2026-09-15-taller-seguimiento-proveedor-design.md
 */
import type { TallerEntry } from "./types";
import type { Partida } from "./partidas";
import { visitaKeyDe } from "../api/tallerPartidas";
import type { LegacyTallerEntry } from "../api/batchUpload";

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

export type ResumenPartidas = {
  pendientes: { n: number; monto: number };
  autorizadas: { n: number; monto: number };
  rechazadas: { n: number; monto: number };
  /** Capturadas por el taller y AÚN NO enviadas: informativo, no accionable. */
  borradoresTaller: number;
};

const finito = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function resumenPartidas(ps: readonly Partida[]): ResumenPartidas {
  const r: ResumenPartidas = {
    pendientes: { n: 0, monto: 0 },
    autorizadas: { n: 0, monto: 0 },
    rechazadas: { n: 0, monto: 0 },
    borradoresTaller: 0,
  };
  for (const p of ps) {
    if (p.estado === "propuesta") {
      r.pendientes.n++;
      r.pendientes.monto += finito(p.precio);
    } else if (p.estado === "autorizada" || p.estado === "terminada") {
      r.autorizadas.n++;
      // El monto autorizado sale de precioAutorizado, que es lo que congela
      // `autorizar` — la MISMA base que usa gastoDerivado. Una prueba lo exige.
      // `terminada` es una autorizada que ya se cerró: cuenta igual hacia el
      // dinero. Espejo de totalesVisita (src/taller/partidas.ts:144) — si esas
      // dos ramas se separan, nace una segunda fórmula del gasto.
      r.autorizadas.monto += finito(p.precioAutorizado);
    } else if (p.estado === "rechazada") {
      r.rechazadas.n++;
      r.rechazadas.monto += finito(p.precio);
    } else if (p.estado === "borrador" && String(p.creadoPor ?? "").startsWith("liga:")) {
      r.borradoresTaller++;
    }
  }
  return r;
}

export type Distintivo =
  | { kind: "promesa-vencida"; dias: number }
  | { kind: "esperando-firma"; n: number }
  | { kind: "liga-activa"; dias: number }
  | { kind: "liga-revocada" }
  | { kind: "sin-liga" };

/** Una sola señal por visita, la más urgente. El orden es la decisión de
 *  producto (spec §6.2) y no depende de quién llame. */
export function distintivoProveedor(
  liga: EstadoLiga,
  promesa: PromesaTaller,
  resumen: ResumenPartidas,
): Distintivo {
  if (promesa.kind === "vencida") return { kind: "promesa-vencida", dias: promesa.diasVencida };
  if (resumen.pendientes.n > 0) return { kind: "esperando-firma", n: resumen.pendientes.n };
  if (liga.kind === "activa") return { kind: "liga-activa", dias: liga.diasRestantes };
  if (liga.kind === "revocada") return { kind: "liga-revocada" };
  // Una liga vencida ya no sirve para nada: se lee igual que no tenerla.
  return { kind: "sin-liga" };
}

export function etiquetaDistintivo(d: Distintivo): string {
  switch (d.kind) {
    case "promesa-vencida":
      return `Promesa vencida · ${d.dias}d`;
    case "esperando-firma":
      return `Esperando firma · ${d.n}`;
    case "liga-activa":
      return `Liga activa · ${d.dias}d`;
    case "liga-revocada":
      return "Liga revocada";
    default:
      return "Sin liga";
  }
}

/** Prioridad para ordenar la tabla por urgencia (spec §6.2): el mismo orden
 *  que decide `distintivoProveedor`. 0 = más urgente. */
export function prioridadDistintivo(d: Distintivo): number {
  switch (d.kind) {
    case "promesa-vencida":
      return 0;
    case "esperando-firma":
      return 1;
    case "liga-activa":
      return 2;
    case "liga-revocada":
      return 3;
    default:
      return 4;
  }
}

export type FilaPendiente = {
  entry: TallerEntry;
  visitaKey: string;
  n: number;
  monto: number;
  /** `propuestoEn` de la pendiente más antigua: lo que más ha esperado. */
  masAntigua?: string;
  distintivo: Distintivo;
};

export function filasPendientes(
  entries: readonly TallerEntry[],
  porVisita: ReadonlyMap<string, Partida[]>,
  ahoraISO: string,
): FilaPendiente[] {
  const hoy = ahoraISO.slice(0, 10);
  const filas: FilaPendiente[] = [];
  for (const entry of entries) {
    // `visitaKeyDe` pide LegacyTallerEntry. La ÚNICA diferencia con TallerEntry es
    // `km` (aquí `number | string`, allá `number`), y la llave nunca lo lee: usa
    // plate/eco/unitKey/id/fentrada/freporte (tallerCloudKey, batchUpload.ts:425).
    // Se pasa el entry COMPLETO a propósito — si mañana la llave leyera otro campo,
    // aquí ya viaja — y con el tipo concreto, no `any`, para que un cambio de firma
    // sí lo atrape el compilador.
    const visitaKey = visitaKeyDe(entry as unknown as LegacyTallerEntry);
    const ps = porVisita.get(visitaKey) ?? [];
    const resumen = resumenPartidas(ps);
    if (resumen.pendientes.n === 0) continue;
    const esperas = ps
      .filter((p) => p.estado === "propuesta" && p.propuestoEn)
      .map((p) => String(p.propuestoEn))
      .sort();
    filas.push({
      entry,
      visitaKey,
      n: resumen.pendientes.n,
      monto: resumen.pendientes.monto,
      masAntigua: esperas[0],
      distintivo: distintivoProveedor(
        estadoLiga(entry, ahoraISO),
        promesaTaller(entry, hoy),
        resumen,
      ),
    });
  }
  // La que más ha esperado, arriba. Sin `propuestoEn` va al final.
  return filas.sort((a, b) => (a.masAntigua ?? "9999").localeCompare(b.masAntigua ?? "9999"));
}
