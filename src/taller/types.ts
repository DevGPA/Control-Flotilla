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

  /**
   * Kilometraje al INGRESO. Siempre se capturó (el formulario lo exige >0, campo
   * `tf-km`) y siempre viajó a la nube (`datos.km`, ver cloudHydrate:656) — pero el
   * tipo nunca lo declaró, así que el export de Excel no lo veía y el guard de
   * cobertura (que se construye desde este tipo) tampoco podía reclamarlo. 0 = registros
   * viejos sin captura.
   */
  km?: number | string;

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
  /**
   * R87 — el subtotal que Riesgos había tecleado ANTES de que la visita tuviera
   * partidas. Cuando aparecen partidas, el gasto deja de ser un número tecleado
   * y las tres llaves salen del payload (`sinGastoSiTienePartidas`); esto guarda
   * lo que había, una sola vez, para que el dato no se pierda. No es la fuente
   * de verdad de nada: el gasto de una visita con partidas es la suma de lo
   * firmado, siempre.
   */
  gastoCapturadoOriginal?: {
    gasto?: number;
    gastoRef?: number;
    gastoMO?: number;
    en: string;
  };

  // Texto libre
  tecnico?: string;
  /**
   * Número de pedido con el que se gestiona la compra/servicio en el ERP (Oracle
   * NetSuite). Referencia cruzada Taller ↔ ERP para conciliar el gasto; texto libre
   * porque el folio lo asigna el ERP, no esta app. Pedido por Navares 2026-08-14.
   */
  pedidoErp?: string;
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

/** Áreas operativas canónicas. Fuente de verdad: el catálogo de unidades
 *  (`#cf-area` en el monolito). Taller usaba MAYÚSCULAS SIN ACENTO, lo que
 *  hacía que el autocompletado dejara el select vacío en silencio. */
export const AREAS_CANONICAS = [
  "Logística",
  "Almacén",
  "Servicio Técnico",
  "Mantenimiento",
  "Administración",
] as const;

function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

const AREA_INDEX = new Map<string, string>(AREAS_CANONICAS.map((a) => [sinAcentos(a), a]));

/** Devuelve la grafía canónica del área, o "" si el valor no corresponde a
 *  ninguna de las cinco. Nunca inventa un área. */
export function normalizeArea(v: unknown): string {
  if (v === null || v === undefined) return "";
  return AREA_INDEX.get(sinAcentos(String(v))) ?? "";
}
