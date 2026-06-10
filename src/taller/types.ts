// Tipos del módulo Taller — entries de unidades en taller, estados, costos.

export type TallerEstado =
  | "En Diagnóstico"
  | "En Reparación"
  | "Cotización"
  | "Por recuperar"
  | "Finalizado";

export const ESTADOS_ACTIVOS: TallerEstado[] = [
  "En Diagnóstico",
  "En Reparación",
  "Cotización",
  "Por recuperar",
];

export const ESTADOS_CERRADOS: TallerEstado[] = ["Finalizado"];

/** Mapeo de estados legacy → nuevos. Aplicar al cargar entries viejas. */
export const ESTADO_MIGRATION: Record<string, TallerEstado> = {
  "En Revisión": "En Diagnóstico",
  Reparando: "En Reparación",
  "Esperando Refacciones": "Cotización",
  Listo: "Por recuperar",
};

/** Normaliza estado al schema actual. Pasa-through si ya es nuevo. */
export function migrateEstado(s: unknown): TallerEstado {
  const str = String(s ?? "");
  if (ESTADOS_ACTIVOS.includes(str as TallerEstado)) return str as TallerEstado;
  if (ESTADOS_CERRADOS.includes(str as TallerEstado)) return str as TallerEstado;
  return ESTADO_MIGRATION[str] ?? "En Diagnóstico";
}

export type TallerEntry = {
  id: string;
  unitKey?: string; // usado para agrupar historial por unidad (eco o plate)
  eco?: string;
  plate?: string;
  brand?: string;
  sucursal?: string;
  area?: string;
  tipo?: string; // "Preventivo", "Correctivo", "Accidente", etc.
  estado: TallerEstado;

  // Fechas (ISO string "YYYY-MM-DD" usualmente)
  freporte?: string;
  fentrada?: string;
  fsalidaEst?: string;
  fsalidaReal?: string;
  fcierre?: string;

  // Costos
  gastoRef?: number;
  gastoMO?: number;
  /** Campo legacy para entries previas al desglose Ref+MO. */
  gasto?: number;

  // Texto libre
  tecnico?: string;
  refacciones?: string;
  comentario?: string;

  // Meta
  createdAt?: string;
  updatedAt?: string;
  /** Fase C2: marcado al hidratar del cloud. La auto-migración NO re-sube
   *  entries con esta marca (guarda anti-resurrección cuando otro usuario
   *  borra el registro). Persiste al IndexedDB local. */
  _cloud?: boolean;
};

export type TallerFilter = {
  sucursal?: string; // "all" o nombre
  area?: string;
  tipo?: string;
  search?: string; // texto libre en eco/plate/tecnico/comentario
};
