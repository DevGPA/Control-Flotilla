// Tipos del módulo Taller — entries de unidades en taller, estados, costos.

export type TallerEstado =
  | "En Revisión"
  | "Reparando"
  | "Esperando Refacciones"
  | "Listo"
  | "Finalizado";

export const ESTADOS_ACTIVOS: TallerEstado[] = [
  "En Revisión",
  "Reparando",
  "Esperando Refacciones",
];

export const ESTADOS_CERRADOS: TallerEstado[] = ["Finalizado", "Listo"];

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
};

export type TallerFilter = {
  sucursal?: string; // "all" o nombre
  area?: string;
  tipo?: string;
  search?: string; // texto libre en eco/plate/tecnico/comentario
};
