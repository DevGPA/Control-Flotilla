/**
 * Registro como ficha — capa PURA (sin DOM, sin red). Spec 2026-09-30 §4.2.
 *
 * Todo sale de columnas que ya existen y de las reglas que ya usan la tabla y el
 * registro (promesaTaller, diasVencida, gastoDerivado, distintivoProveedor). El
 * monolito (`_fichaPintar`) solo traduce este objeto a nodos.
 */
import type { TallerEntry, TallerEstado } from "./types";
import type { Partida } from "./partidas";
import { gastoDerivado, gastoTotalDe, montoPendienteDeFirma } from "./partidas";
import { DIA_MS, estadoLiga, visitaCerrada } from "./liga";
import { distintivoProveedor, promesaTaller, resumenPartidas } from "./seguimiento";
import { diasVencida } from "./tallerStore";

export type EstadoCosto =
  | { kind: "partidas"; autorizado: number; pendiente: number }
  | { kind: "capturado"; monto: number; verificando: boolean }
  | { kind: "sin-datos" };

export type SenalSalida =
  | { kind: "promesa-vencida"; dias: number }
  | { kind: "estimada-vencida"; dias: number }
  | { kind: "despues-de-estimada"; dias: number }
  | { kind: "ninguna" };

export type FichaRegistro = {
  estadoGpa: string;
  tipo: string;
  esperandoFirma: boolean;
  dias: {
    n: number;
    cerrada: boolean;
    inicio: string | null;
    fin: string | null;
    tono: "normal" | "ambar" | "rojo";
  };
  salida: {
    estimadaGpa: string | null;
    prometida: string | null;
    compromisoOriginal: string | null;
    senal: SenalSalida;
  };
  costo: EstadoCosto;
  tallerNombre: string | null;
};

const dia = (s: unknown): string | null => {
  const v = String(s ?? "")
    .trim()
    .slice(0, 10);
  return v ? v : null;
};

/**
 * La MISMA cuenta que la tabla de Operaciones Activas (`Date.now() - new Date(fentrada)`,
 * medianoche UTC). Decisión 25: la ficha no puede contradecir a la tabla que Navares ya lee.
 * El Excel (`diasEnTaller`, medianoche local) difiere 1 día entre 06:00 y 12:00 en México
 * y queda anotado como defecto previo (spec §3).
 */
export function diasEnTallerTabla(fentrada: string, finMs: number): number {
  const ini = Date.parse(String(fentrada ?? "").slice(0, 10));
  if (!Number.isFinite(ini) || !Number.isFinite(finMs)) return 0;
  return Math.max(0, Math.round((finMs - ini) / DIA_MS));
}

/** Días de calendario entre dos fechas `AAAA-MM-DD`, sin huso. `null` si alguna no es fecha. */
export function diferenciaDiasCiviles(desde: string, hasta: string): number | null {
  const a = Date.parse(`${String(desde ?? "").slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(hasta ?? "").slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DIA_MS);
}

export function fichaRegistro(
  e: Partial<TallerEntry>,
  ps: readonly Partida[],
  opts: { ahora: string; hibrido: boolean | undefined; confiables: boolean },
): FichaRegistro {
  const ahoraMs = Date.parse(opts.ahora);
  const hoyISO = opts.ahora.slice(0, 10);
  const lista = Array.from(ps);

  // ── Días
  const cerrada = visitaCerrada(e);
  const inicio = dia(e.fentrada);
  const fin = cerrada ? dia(e.fsalidaReal) : null;
  const finMs = fin ? Date.parse(fin) : ahoraMs;
  const n = inicio ? diasEnTallerTabla(inicio, finMs) : 0;
  const tono = cerrada ? "normal" : n > 7 ? "rojo" : n > 3 ? "ambar" : "normal";

  // ── Salida: una sola señal, por prioridad (§4.2). El "hoy" de la promesa es el mismo
  //    que usa la tabla (__promesaTaller: fecha UTC del instante).
  const prom = promesaTaller(e, hoyISO);
  const estimadaGpa = dia(e.fsalidaEst);
  const prometida = prom.kind === "sin-promesa" ? null : prom.fecha;
  const compromisoOriginal =
    prom.kind !== "sin-promesa" && prom.compromisoOriginal ? prom.compromisoOriginal : null;
  let senal: SenalSalida = { kind: "ninguna" };
  if (prom.kind === "vencida") {
    senal = { kind: "promesa-vencida", dias: prom.diasVencida };
  } else {
    const vencida = diasVencida(
      {
        estado: (e.estado ?? "En Diagnóstico") as TallerEstado,
        fsalidaEst: e.fsalidaEst,
        fsalidaReal: e.fsalidaReal,
      },
      new Date(ahoraMs),
    );
    if (vencida != null) {
      senal = { kind: "estimada-vencida", dias: vencida };
    } else if (estimadaGpa && prometida) {
      const d = diferenciaDiasCiviles(estimadaGpa, prometida);
      if (d != null && d > 0) senal = { kind: "despues-de-estimada", dias: d };
    }
  }

  // ── Costo: la misma fuente que #tf-gasto (gastoDerivado / montoPendienteDeFirma, §2 #19)
  const capturado = gastoTotalDe(e);
  let costo: EstadoCosto;
  if (opts.hibrido === true) {
    if (!opts.confiables) costo = { kind: "sin-datos" };
    else if (lista.length) {
      costo = {
        kind: "partidas",
        autorizado: gastoDerivado(e, lista).gasto,
        pendiente: montoPendienteDeFirma(lista),
      };
    } else costo = { kind: "capturado", monto: capturado, verificando: false };
  } else if (opts.hibrido === false) {
    costo = { kind: "capturado", monto: capturado, verificando: false };
  } else {
    costo = { kind: "capturado", monto: capturado, verificando: true };
  }

  // ── "Esperando firma" solo si es la señal que pinta la lista (§2 #14): misma función.
  const dist = distintivoProveedor(estadoLiga(e, opts.ahora), prom, resumenPartidas(lista));
  const esperandoFirma =
    opts.hibrido === true && opts.confiables && dist.kind === "esperando-firma";

  const tecnico = String(e.tecnico ?? "").trim();
  return {
    estadoGpa: String(e.estado ?? ""),
    tipo: String(e.tipo ?? ""),
    esperandoFirma,
    dias: { n, cerrada, inicio, fin, tono },
    salida: { estimadaGpa, prometida, compromisoOriginal, senal },
    costo,
    tallerNombre: tecnico || null,
  };
}
