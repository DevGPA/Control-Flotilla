/**
 * Módulo de Accesorios (2026-09-02) — sub-pestaña de Taller.
 *
 * Control de los accesorios que se le cambian a una unidad: hoy limpiabrisas y batería.
 * Cada CAMBIO es un registro con su fecha de compra; el accesorio "vigente" NO se persiste,
 * se deriva del más reciente (así no queda obsoleto con el tiempo, igual que el semáforo de
 * Cumplimiento). Eso es lo que permite ver qué tan vieja está una batería y cuánto duró la
 * anterior.
 *
 * Capa de TIPOS — contrato entre la nube (modelo `Accesorio`) y el front. Mismo patrón de
 * capas que src/compliance/ y src/fuel/.
 * IDENTIDAD POR economicoId (igual que Combustible y Cumplimiento), NO por placa: el
 * reemplacamiento 2025-26 cambió placas y habría roto el enlace.
 */

/** Tipo de accesorio. En la nube viaja como string libre → agregar uno no migra el esquema. */
export type AccesorioTipo = "bateria" | "limpiabrisas";

export const ACCESORIO_TIPOS: readonly AccesorioTipo[] = ["bateria", "limpiabrisas"];

export const TIPO_LABEL: Record<AccesorioTipo, string> = {
  bateria: "Batería",
  limpiabrisas: "Limpiabrisas",
};

/** ¿El tipo que llegó de la nube es uno que este front sabe pintar? */
export function esAccesorioTipo(v: unknown): v is AccesorioTipo {
  return ACCESORIO_TIPOS.includes(String(v ?? "").trim() as AccesorioTipo);
}

/**
 * Registro tal como vive en DynamoDB (modelo `Accesorio`).
 * Identidad compuesta (tenantId, economicoId, accesorioId), donde accesorioId es:
 *   - batería      → "bateria#<numeroSerie normalizado>"  (la serie ES la identidad)
 *   - limpiabrisas → "limpiabrisas#<fechaCompra>"          (no tiene serie)
 * Efecto: recapturar la MISMA batería actualiza la fila en vez de duplicarla.
 */
export type AccesorioDoc = {
  tenantId: string;
  economicoId: string;
  accesorioId: string;
  tipo: AccesorioTipo;
  marca?: string;
  numeroSerie?: string; // solo batería
  fechaCompra?: string; // YYYY-MM-DD
  costo?: number;
  nota?: string;
  capturadoPor?: string; // correo de quien capturó (trazabilidad)
  ultimaActualizacion?: string; // ISO
};

/** Registro enriquecido para el front: + datos de la unidad y antigüedad derivada. */
export type AccesorioEntry = AccesorioDoc & {
  placa?: string;
  sucursal?: string;
  /** Meses cumplidos desde la fecha de compra. null si no hay fecha. Informativo: sin umbral. */
  antiguedadMeses: number | null;
};

/** Lo que trae HOY una unidad + su historial de cambios. Una fila de la tabla. */
export type AccesorioUnidad = {
  economicoId: string;
  placa?: string;
  sucursal?: string;
  /** Accesorio vigente por tipo (el de fecha de compra más reciente). */
  vigentes: Partial<Record<AccesorioTipo, AccesorioEntry>>;
  /** Todos los registros de la unidad, del más reciente al más viejo. */
  historial: AccesorioEntry[];
  cambios: number;
  gastoTotal: number;
};

/**
 * Datos mínimos de una unidad del catálogo de flota, para incluir en la tabla a las que
 * NO tienen accesorios capturados (la pregunta operativa "¿a quién le falta?").
 * Misma forma que `UnidadCatalogo` de Cumplimiento; se declara aquí para no acoplar
 * dos módulos independientes por un alias de tres campos.
 */
export type UnidadCatalogo = { eco: string; sucursal?: string; placa?: string };

/** Campos del formulario de captura. */
export type CapturaAccesorioFields = {
  economicoId: string;
  tipo: AccesorioTipo;
  marca: string;
  numeroSerie?: string;
  fechaCompra: string;
  costo?: number | null;
  nota?: string;
};

/** Qué unidades muestra la tabla. Responde "¿a quién le falta capturar?". */
export type AccesoriosVista = "all" | "conRegistro" | "sinBateria" | "sinLimpiabrisas";

export type AccesoriosFilter = {
  vista: AccesoriosVista;
  sucursal: string; // "" = todas
  search: string;
};

export type AccesoriosSortCol =
  | "eco"
  | "placa"
  | "sucursal"
  | "bateria"
  | "limpiabrisas"
  | "cambios"
  | "gasto";

/** 1 = ascendente, -1 = descendente. */
export type SortDir = 1 | -1;

export type KpisAccesorios = {
  unidades: number;
  conBateria: number;
  conLimpiabrisas: number;
  sinRegistro: number;
  cambios: number;
  gastoTotal: number;
};
