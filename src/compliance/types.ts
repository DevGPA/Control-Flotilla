/**
 * Módulo de Cumplimiento Vehicular (2026-06-26).
 *
 * Expediente por unidad de obligaciones documentales/fiscales y multas:
 * verificación, tenencia, refrendo, seguro, tarjeta de circulación, licencias de
 * operadores y multas de tránsito. Meta: ver en un solo lugar, por unidad, todo lo
 * pendiente o por vencer — sin entrar portal por portal ni unidad por unidad.
 *
 * Capa de TIPOS — contrato entre la nube (ComplianceDoc) y el front (ComplianceEntry),
 * mismo patrón de 5 capas que el módulo de Combustible (src/fuel/).
 * IDENTIDAD POR economicoId (igual que CargaCombustible), no por placa.
 */

/** Dimensión de cumplimiento (qué tipo de obligación/documento es). */
export type ComplianceTipoDoc =
  | "verificacion" // verificación de emisiones (Jalisco / Megalópolis)
  | "tenencia" // impuesto sobre tenencia (donde aplica: Edomex, etc.)
  | "refrendo" // refrendo / derecho de control vehicular anual
  | "seguro" // póliza de seguro de daños a terceros
  | "tarjetaCirculacion" // tarjeta de circulación
  | "licencia" // licencia del OPERADOR (no de la unidad; ver `operador`)
  | "multa"; // infracción / adeudo de tránsito (puede haber varias por unidad)

/** Jurisdicción de la obligación/multa. `federal` = REPUVE/SAT; resto = estatal/municipal. */
export type ComplianceJurisdiccion =
  | "jalisco"
  | "cdmx"
  | "edomex"
  | "nuevoleon"
  | "federal"
  | "otra";

/** Origen del dato (cómo se pobló). Hoy todo `manual`; amis/repuve cuando se automatice. */
export type ComplianceFuente = "manual" | "amis" | "repuve" | "portal";

/**
 * Estado de cumplimiento (semáforo). Severidad ascendente en COMPLIANCE_SEVERIDAD:
 * desconocido < vigente < porVencer < adeudo < vencido (los dos últimos = rojo en UI).
 * - documentos con fecha: vigente | porVencer | vencido | desconocido (sin fecha)
 * - multas: adeudo (pendiente) | vigente (saldada / sin adeudo)
 */
export type ComplianceEstado = "vigente" | "porVencer" | "vencido" | "adeudo" | "desconocido";

/**
 * Documento de cumplimiento tal como vive en DynamoDB (modelo ComplianceDoc).
 * Identidad compuesta (tenantId, economicoId, docId):
 *  - singletons (verificacion/seguro/tarjetaCirculacion/refrendo/tenencia/licencia):
 *    docId === tipoDoc → 1 por unidad por dimensión (upsert idempotente).
 *  - multas: docId = "multa#<jurisdiccion>#<folio>" → varias por unidad.
 * Se guardan los DATOS CRUDOS (fechaVencimiento, monto…); el `estado` NO se persiste,
 * se DERIVA al leer con complianceStatus() para que no quede obsoleto con el tiempo.
 */
export type ComplianceDoc = {
  tenantId: string;
  economicoId: string; // identidad de la unidad
  docId: string;
  tipoDoc: ComplianceTipoDoc;
  jurisdiccion?: ComplianceJurisdiccion;
  fechaVencimiento?: string; // YYYY-MM-DD
  fechaEmision?: string; // YYYY-MM-DD
  referencia?: string; // nº de póliza / folio / línea de captura
  monto?: number; // adeudo (multas / tenencia / refrendo)
  fuente?: ComplianceFuente;
  /** Foto/escaneo del documento. URL firmada por demanda (como las fotos de combustible). */
  evidenciaFname?: string;
  operador?: string; // titular de la licencia (tipoDoc === 'licencia')
  nota?: string;
  ultimaActualizacion?: string; // ISO ts de la última edición/consulta
};

/**
 * Documento de cumplimiento normalizado para el front (mapeado en cloudHydrate).
 * Añade `estado` y `diasParaVencer` DERIVADOS respecto a "hoy".
 */
export type ComplianceEntry = ComplianceDoc & {
  estado: ComplianceEstado;
  /** Días para el vencimiento (negativo = ya vencido). null si no aplica/sin fecha. */
  diasParaVencer: number | null;
  /** Sucursal de la unidad, resuelta del catálogo (para scope por sucursal y display). */
  sucursal?: string;
  /** Placa de la unidad, resuelta del catálogo (para display y helpers de placa). */
  placa?: string;
};

/** Resumen de cumplimiento de UNA unidad (lo que pinta el semáforo de la flota). */
export type ComplianceResumenUnidad = {
  eco: string;
  estado: ComplianceEstado; // peor estado entre sus documentos
  vencidos: number; // documentos vencidos
  porVencer: number; // documentos por vencer (dentro de la ventana)
  adeudos: number; // nº de multas/adeudos pendientes
  montoAdeudo: number; // suma de los adeudos pendientes
  sucursal?: string; // de la unidad (derivada de sus docs; para scope/render)
  placa?: string; // de la unidad (derivada de sus docs; para render/helpers de placa)
  docs: ComplianceEntry[]; // expediente completo de la unidad
};

/** Campos del formulario de alta/edición de un documento de cumplimiento (captura manual). */
export type CapturaFields = {
  tipoDoc: ComplianceTipoDoc;
  jurisdiccion?: string;
  fechaVencimiento?: string;
  fechaEmision?: string;
  referencia?: string;
  monto?: number;
  nota?: string;
  operador?: string;
};
