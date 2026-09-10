// Lógica pura de partidas de taller: qué se puede hacer con cada una y cuánto
// suma una visita. Sin DOM, sin red — el monolito la consume.

import type { TallerEstado } from "./types";

export type PartidaEstado =
  | "borrador"
  | "propuesta"
  | "autorizada"
  | "rechazada"
  | "terminada"
  | "cancelada";

export type PartidaTipo = "refaccion" | "manoObra";

export type EstadoOperativo = "revisando" | "reparando" | "esperandoRefaccion" | "lista";

export type Partida = {
  partidaId: string;
  visitaKey: string;
  /** La escribe un tercero NO autenticado. Nunca pintarla con innerHTML. */
  descripcion: string;
  tipo?: PartidaTipo;
  /** Sin IVA. */
  precio?: number;
  estado: PartidaEstado;
  motivoRechazo?: string;
  motivoRechazoNota?: string;
  fotos: string[];
  /** Congelado al firmar. */
  precioAutorizado?: number;
  recotizaDe?: string;
  proveedorNombre?: string;
  creadoPor?: string;
  creadoEn?: string;
  propuestoEn?: string;
  decididoEn?: string;
  decididoPor?: string;
  terminadoEn?: string;
};

/** Menú CERRADO. Un campo libre no se llena: en combustible, 0 de 6 rechazos
 *  traían motivo escrito. El orden es el que ve el usuario. */
export const MOTIVOS_RECHAZO = [
  "No es necesario ahora",
  "Precio alto — recotizar",
  "Se repara en otro lado",
  "No corresponde a esta unidad",
  "Otro",
] as const;

/** Una partida enviada se congela: si el proveedor pudiera cambiar el precio
 *  después de la firma, la autorización no valdría nada. */
export function esEditablePorProveedor(p: Partida): boolean {
  return p.estado === "borrador";
}

export function puedeCancelar(p: Partida, actor: "proveedor" | "riesgos"): boolean {
  if (p.estado === "cancelada" || p.estado === "terminada") return false;
  if (actor === "proveedor") return p.estado === "borrador" || p.estado === "propuesta";
  return true;
}

export function autorizar(p: Partida, quien: string, cuando: string): Partida {
  if (p.estado !== "propuesta") {
    throw new Error(`No se puede autorizar una partida en estado "${p.estado}"`);
  }
  return {
    ...p,
    estado: "autorizada",
    // Se autoriza un PRECIO: queda congelado aquí.
    precioAutorizado: p.precio ?? 0,
    decididoPor: quien,
    decididoEn: cuando,
  };
}

export function rechazar(
  p: Partida,
  motivo: string,
  nota: string | undefined,
  quien: string,
  cuando: string,
): Partida {
  if (p.estado !== "propuesta") {
    throw new Error(`No se puede rechazar una partida en estado "${p.estado}"`);
  }
  if (!(MOTIVOS_RECHAZO as readonly string[]).includes(motivo)) {
    throw new Error(`Motivo de rechazo no válido: "${motivo}"`);
  }
  const limpia = (nota ?? "").trim();
  if (motivo === "Otro" && !limpia) {
    throw new Error('El motivo "Otro" exige una nota');
  }
  return {
    ...p,
    estado: "rechazada",
    motivoRechazo: motivo,
    motivoRechazoNota: motivo === "Otro" ? limpia : undefined,
    decididoPor: quien,
    decididoEn: cuando,
  };
}

export type TotalesVisita = {
  cotizado: number;
  autorizado: number;
  rechazado: number;
  gastoRef: number;
  gastoMO: number;
};

/** El gasto de la visita NO se captura: es la suma de lo firmado. Y de aquí
 *  sale el desglose Ref/MO que hoy el Excel reporta en $0 en el 100%. */
export function totalesVisita(ps: Partida[]): TotalesVisita {
  const t: TotalesVisita = { cotizado: 0, autorizado: 0, rechazado: 0, gastoRef: 0, gastoMO: 0 };
  for (const p of ps) {
    if (p.estado === "borrador" || p.estado === "cancelada") continue;
    const cotizado = p.precio ?? 0;
    t.cotizado += cotizado;
    if (p.estado === "rechazada") {
      t.rechazado += cotizado;
      continue;
    }
    if (p.estado === "autorizada" || p.estado === "terminada") {
      const firmado = p.precioAutorizado ?? 0;
      t.autorizado += firmado;
      if (p.tipo === "manoObra") t.gastoMO += firmado;
      else t.gastoRef += firmado;
    }
  }
  return t;
}

/**
 * Las partidas de una visita que esperan TU firma. Única definición del
 * predicado "esperando firma" — `pendientesDeFirma` es su `.length` y
 * `filasBandeja` (src/api/tallerPartidas.ts) la usa directo para pintar,
 * en vez de reimplementar `estado === "propuesta"` a mano. El día que
 * "esperando firma" gane un segundo estado (recotización, una segunda
 * instancia de firma), este es el único lugar que cambia.
 */
export function partidasPendientesDeFirma(ps: Partida[]): Partida[] {
  return ps.filter((p) => p.estado === "propuesta");
}

export function pendientesDeFirma(ps: Partida[]): number {
  return partidasPendientesDeFirma(ps).length;
}

/**
 * Cuánto sigue esperando FIRMA (fix ronda 2, Important 2). Reusa
 * `partidasPendientesDeFirma` — nunca reimplementa `estado === "propuesta"` — y suma
 * `precio` (lo COTIZADO, nunca `precioAutorizado`: una partida "propuesta" no tiene
 * precio autorizado todavía).
 *
 * Deliberadamente NO es un residuo (`totalesVisita(ps).cotizado - .autorizado -
 * .rechazado`): ese cálculo solo cuadra hoy porque `autorizar()` congela
 * `precioAutorizado = p.precio` — el día que se autorice a un precio NEGOCIADO distinto
 * (la razón de ser de `precioAutorizado` como campo aparte de `precio`), o llegue una
 * `terminada` sin `precioAutorizado`, el residuo se desalinea y sobre-reporta "esperando
 * firma" sobre partidas que ya se decidieron.
 */
export function montoPendienteDeFirma(ps: Partida[]): number {
  return partidasPendientesDeFirma(ps).reduce((s, p) => s + (p.precio ?? 0), 0);
}

export type GastoDerivado = {
  gasto: number;
  gastoRef: number;
  gastoMO: number;
  cotizado: number;
  rechazado: number;
};

/**
 * Gasto total de un entry — LA fórmula (Task 9, fix ronda 2, Important 3). Vive aquí, junto a
 * `gastoDerivado`, porque las dos comparten la MISMA regla para "sin partidas": el desglose
 * (Ref+MO) manda si es `> 0`; `gasto` (legado) es el respaldo de los registros anteriores al
 * desglose — sin él el total salía en $0 (auditoría 2026-06-04). ANTES `gastoDerivado(e, [])`
 * tenía su PROPIA respuesta (`entry.gasto ?? ref+mo`, el legado ganando siempre) — para
 * `{gasto: 9999, gastoRef: 100, gastoMO: 50}` esta función daba 150 y la otra 9999: dos
 * derivaciones del mismo dato. `gastoDerivado` ahora llama a ÉSTA para su rama sin partidas.
 *
 * Re-exportada desde `./exportExcel` (fix ronda 1) para no romper los imports existentes —
 * moverla aquí evita el ciclo `partidas.ts` → `exportExcel.ts` → `partidas.ts` que se hubiera
 * creado si `gastoDerivado` (aquí) llamara a una función que vive en `exportExcel.ts`.
 *
 * Con `ps` no vacío, el resultado sale de `gastoDerivado` (la suma de lo FIRMADO). Sin `ps`
 * (ausente o `[]`) el comportamiento es el de siempre: todo consumidor que aún no le pasa las
 * partidas de la visita no pierde nada ni cambia de resultado. Esta es la ÚNICA función que
 * cualquier consumidor de "cuánto costó esta visita" debe llamar — nunca sumar
 * `gastoRef`/`gastoMO`/`gasto` por su cuenta.
 */
export function gastoTotalDe(
  e: { gasto?: number; gastoRef?: number; gastoMO?: number },
  ps?: Partida[],
): number {
  if (ps && ps.length) return gastoDerivado(e, ps).gasto;
  const desglose = (e.gastoRef ?? 0) + (e.gastoMO ?? 0);
  return desglose > 0 ? desglose : (e.gasto ?? 0);
}

/**
 * El gasto de una visita con partidas es la suma de lo FIRMADO — nunca un
 * número tecleado. Si el proveedor tecleara un subtotal y además precios por
 * partida, van a discrepar y no habría forma de saber cuál es verdad.
 *
 * Las visitas históricas (sin partidas) conservan lo que se capturó a mano —
 * vía `gastoTotalDe`, la MISMA regla que usa el Excel (fix ronda 2, Important
 * 3: antes esta rama reimplementaba su propia fórmula, que discrepaba de
 * `gastoTotalDe` cuando el legado y el desglose venían ambos poblados).
 */
export function gastoDerivado(
  entry: { gasto?: number; gastoRef?: number; gastoMO?: number },
  ps: Partida[],
): GastoDerivado {
  if (!ps.length) {
    return {
      gasto: gastoTotalDe(entry),
      gastoRef: entry.gastoRef ?? 0,
      gastoMO: entry.gastoMO ?? 0,
      cotizado: 0,
      rechazado: 0,
    };
  }
  const t = totalesVisita(ps);
  return {
    gasto: t.autorizado,
    gastoRef: t.gastoRef,
    gastoMO: t.gastoMO,
    cotizado: t.cotizado,
    rechazado: t.rechazado,
  };
}

const OPERATIVO_A_ESTADO: Record<EstadoOperativo, TallerEstado> = {
  revisando: "En Diagnóstico",
  reparando: "En Reparación",
  esperandoRefaccion: "En Reparación",
  lista: "Por recuperar",
};

/**
 * El `estado` que pinta la tabla y alimenta los filtros se COMPONE, para que no
 * pueda mentir: si hay partidas esperando firma es "Cotización" (eso es lo
 * urgente para Riesgos y el taller no lo puede apagar); si no, refleja lo que
 * el taller declaró estar haciendo. "Finalizado" gana sobre todo — el cierre
 * del gasto no lo firma el proveedor.
 */
export function estadoCompuesto(
  visita: { estado: TallerEstado; estadoOperativo?: EstadoOperativo },
  ps: Partida[],
): TallerEstado {
  if (visita.estado === "Finalizado") return "Finalizado";
  if (pendientesDeFirma(ps) > 0) return "Cotización";
  if (visita.estadoOperativo) return OPERATIVO_A_ESTADO[visita.estadoOperativo];
  return visita.estado;
}

/**
 * Task 10 (el apagador) — el esquema se prende para toda la flota y todos los
 * talleres a la vez, sin piloto (decisión 21): el freno de mano no es opcional.
 * Lee `AppConfig.tallerHibrido` (amplify/data/resource.ts) ya parseado por
 * `cloudHydrate.ts`. Apagado por omisión, y solo el booleano exacto lo prende:
 * una config corrupta o ausente NO debe encender el esquema en toda la flota.
 */
export function esquemaHibridoActivo(config: unknown): boolean {
  if (!config || typeof config !== "object") return false;
  return (config as Record<string, unknown>).tallerHibrido === true;
}
