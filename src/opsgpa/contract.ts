/**
 * Contrato de conexión Operaciones-GPA → GPA Fleet Command (v1).
 *
 * Contexto: Operaciones-GPA reemplaza a MoreApp como fuente de captura. Este módulo
 * NO modifica Operaciones-GPA: define el contrato de los registros que Fleet Command
 * LEE (solo-lectura) de la tabla single-table `gpa_operaciones_*` y traduce a los
 * MISMOS upserts idempotentes que hoy produce el webhook de MoreApp.
 *
 * Reglas de oro del contrato:
 *  - Un registro de Ops se identifica en Fleet Command con `eventoId = "OPS-<id>"` para
 *    convivir con el histórico de MoreApp sin colisión de folios.
 *  - Se marca `fuente: "ops-gpa"` en `datos` → trazable y separable en cualquier momento.
 *  - La identidad de unidad viaja completa (vehicleId + economico + placas) para que el
 *    receptor resuelva contra el catálogo conciliado con reglas explícitas.
 *
 * Estructura verificada contra registros REALES de `gpa_operaciones_prod` (2026-07-09):
 * los campos de negocio están PLANOS en el top-level del item (no anidados en `datos`),
 * y las evidencias son claves S3 ("SOL/<uuid>.jpg") del bucket de evidencias de Ops.
 */

export const OPS_SOURCE = "ops-gpa" as const;
export const OPS_EVENT_PREFIX = "OPS-";
export const OPS_TENANT_ID = "gpa";

/** Clave S3 de evidencia en el bucket de Operaciones-GPA (espejo del _KEY_RE de su API). */
export const KEY_EVIDENCIA_RE = /^(SOL|CL|MC|FRM)\/[0-9a-f]{32}\.(jpg|png|webp)$/;

export const esKeyEvidencia = (v: unknown): v is string =>
  typeof v === "string" && KEY_EVIDENCIA_RE.test(v);

/**
 * Enumera toda clave S3 de evidencia en un registro plano (campos top-level y
 * `answers.*`) — mismo recorrido que hace el publisher del puente.
 */
export function extraerEvidencias(
  plano: Record<string, unknown>,
): Array<{ campo: string; key: string }> {
  const out: Array<{ campo: string; key: string }> = [];
  for (const [k, v] of Object.entries(plano)) {
    if (esKeyEvidencia(v)) out.push({ campo: k, key: v });
    else if (k === "answers" && v && typeof v === "object" && !Array.isArray(v)) {
      for (const [ak, av] of Object.entries(v as Record<string, unknown>)) {
        if (esKeyEvidencia(av)) out.push({ campo: `answers.${ak}`, key: av });
      }
    }
  }
  return out;
}

/** Quita las claves de infraestructura de un item crudo de la tabla de Ops. */
export function stripInfra(item: Record<string, unknown>): Record<string, unknown> {
  const INFRA = new Set(["PK", "SK", "GSI1PK", "GSI1SK", "GSI2PK", "GSI2SK", "GSI3PK", "GSI3SK"]);
  return Object.fromEntries(Object.entries(item).filter(([k]) => !INFRA.has(k)));
}

/** eventoId canónico en Fleet Command para un registro de Operaciones-GPA. */
export function opsEventoId(opsId: string): string {
  return `${OPS_EVENT_PREFIX}${String(opsId).trim()}`;
}

/**
 * Registro SOL (solicitud de combustible) tal como se PERSISTE en Operaciones-GPA.
 * Campos de negocio planos; claves S3 en `photo`/`firma`.
 */
export interface OpsSolRecord {
  tipo_reg: "SOL";
  id: string;
  fecha: string; // ISO UTC con offset (sello del servidor)
  sucursal?: string;
  status?: string;
  vehicleId?: string;
  economico?: string;
  placas?: string;
  subMarca?: string;
  combustible?: string;
  producto?: string;
  precio?: number;
  tanque?: number;
  km?: number | string;
  tankBefore?: number; // fracción 0..1 (nivel del tanque antes)
  tankAfter?: number; // fracción 0..1 (nivel deseado/después)
  litros?: number;
  monto?: number;
  necesidad?: number;
  responsable?: string;
  userId?: string | number;
  mail?: string;
  obs?: string;
  photo?: string; // key S3 "SOL/<uuid>.jpg"
  firma?: string; // key S3 "SOL/<uuid>.png"
  [k: string]: unknown;
}

/**
 * Registro de "reporte de carga" de Operaciones-GPA. OJO: se PERSISTE con `tipo_reg="SOL"`
 * igual que la solicitud (ambos van a POST /combustible), pero el frontend marca
 * `formato: "reporte"` y trae medición REAL (litros/precioLitro/monto), `lleno` (=¿se llenó
 * el tanque?) y 5 fotos. Discriminador: `formato === "reporte"` (ver `esReporteDeCarga`).
 * Mapea a `CargaCombustible` con `tipo: "carga"` en Fleet Command.
 */
export interface OpsCargaRecord {
  tipo_reg: "SOL";
  formato: "reporte";
  id: string;
  fecha: string;
  sucursal?: string;
  status?: string;
  vehicleId?: string;
  economico?: string;
  placas?: string;
  subMarca?: string;
  areaResponsable?: string;
  combustible?: string;
  producto?: string;
  precio?: number;
  tanque?: number;
  km?: number | string;
  lleno?: string | boolean; // "Si"/"No" (frontend) o booleano (golden) → seLlenoTanque
  litros?: number; // litros REALES cargados
  precioLitro?: number;
  monto?: number;
  ubicacion?: unknown;
  responsable?: string;
  userId?: string | number;
  mail?: string;
  obs?: string;
  fotoAntes?: string; // claves S3 "SOL/<uuid>.jpg"
  fotoDespues?: string;
  fotoBomba?: string;
  fotoTicket?: string;
  fotoPersona?: string;
  firma?: string;
  [k: string]: unknown;
}

/**
 * ¿Este registro de combustible es un "reporte de carga" (→ FC tipo=carga)?
 * Si no, es una solicitud (→ FC tipo=solicitud). En Operaciones-GPA ambos comparten
 * `tipo_reg="SOL"`; la única señal fiable es `formato`.
 */
export function esReporteDeCarga(rec: Record<string, unknown>): boolean {
  return String(rec?.formato ?? "").toLowerCase() === "reporte";
}

/**
 * Registro CL (checklist de reparto) de Operaciones-GPA. Las respuestas del checklist
 * viven en `answers` (itemId → valor; los items de foto son claves S3 "CL/<uuid>.jpg").
 */
export interface OpsClRecord {
  tipo_reg: "CL";
  id: string;
  fecha: string;
  tipo?: "semanal" | "mensual";
  sucursal?: string;
  status?: string;
  vehicleId?: string;
  economico?: string;
  placas?: string;
  subMarca?: string;
  km?: number | string;
  responsable?: string;
  userId?: string | number;
  obs?: string;
  fotoKm?: string; // key S3
  firma?: string; // key S3
  answers?: Record<string, unknown>;
  [k: string]: unknown;
}

/** Evidencia lista para Fleet Command: mismo shape que `datos.photos` del webhook actual. */
export interface FcPhotoRef {
  group: string;
  col: string;
  fname: string;
}

/**
 * Resolver de evidencias: recibe la key S3 de Ops y devuelve el nombre de archivo FINAL
 * en el bucket de Fleet Command (tras copiar S3→S3). Inyectable → el mapper es PURO y
 * testeable sin red ni AWS.
 */
export type EvidenceResolver = (opsKey: string) => string;

/**
 * Nombre determinístico de una evidencia en el bucket de FC (patrón hermano de moreapp_*).
 * Identidad por módulo: combustible → economico; checklist → placas.
 *
 * SIEMPRE minúsculas (fix 2026-07-14): TODO el pipeline de fotos del front normaliza el
 * fname con .toLowerCase() antes de firmar la URL (photoFetch/cloudHydrate/imgUrl legacy)
 * y S3 es case-sensitive — un nombre con mayúsculas (campo "fotoAntes", placas "PR3430A")
 * producía objetos inalcanzables: la app firmaba "...fotoantes.webp", el objeto real era
 * "...fotoAntes.webp" → 403 → imagen rota (reporte del usuario con eco 19, 2026-07-14).
 * La firma ("firma", ya lowercase) era la única visible. El backfill re-copia y
 * re-referencia solo (idempotente por HeadObject al nombre nuevo).
 */
export function nombreEvidencia(
  tipo: string,
  unidad: { economico?: string | null; placas?: string | null },
  campo: string,
  key: string,
): string {
  const idUnidad =
    tipo === "SOL" ? String(unidad?.economico ?? "sin-eco") : String(unidad?.placas ?? "sin-placa");
  const m = /\/([0-9a-f]{32})\.(jpg|png|webp)$/.exec(key);
  const uuid8 = (m?.[1] ?? "00000000").slice(0, 8);
  const ext = m?.[2] ?? "jpg";
  const campoSafe = campo.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  return `opsgpa_${idUnidad}_${uuid8}_${campoSafe}.${ext}`.toLowerCase();
}

/** Input idempotente para `CargaCombustible.create/update` (subset que usa el ingest). */
export interface CargaCombustibleInput {
  tenantId: string;
  economicoId: string;
  tipo: "solicitud" | "carga";
  eventoId: string;
  placa?: string;
  sucursal: string;
  tanque?: string;
  fecha: string;
  fechaHora?: string;
  responsable?: string;
  kmCapturado?: number;
  // Campos de SOLICITUD (estimados)
  nivelAntes?: string;
  nivelDeseado?: string;
  montoEstimado?: number;
  maxLitros?: number;
  // Campos de CARGA (medición real; insumos del motor km/l)
  litrosCargados?: number;
  precioPorLitro?: number;
  montoTotal?: number;
  seLlenoTanque?: string;
  datos: string; // JSON serializado
}
