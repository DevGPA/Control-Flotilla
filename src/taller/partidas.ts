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
