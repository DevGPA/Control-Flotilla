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
 * Enumera toda clave S3 de evidencia en un registro plano — MISMO recorrido y MISMA
 * grafía de `campo` que el publisher del puente (verificada contra sobres reales de
 * ops-capture/, 2026-08-14): dict → "a.b", arreglo → "a[0]", objeto en arreglo →
 * "a[0].foto". Clonarla exacta importa porque `nombreEvidencia(campo, key)` deriva el
 * fname: otra grafía produciría un segundo objeto en S3 y una referencia distinta a la
 * que el camino en vivo ya escribió.
 *
 * Antes solo se recorrían strings top-level y `answers.*` planos: el arreglo `fotos` de
 * las solicitudes y los `golpes` [{foto,desc}] del checklist quedaban FUERA — el backfill
 * no los copiaba y estampaba la key cruda de Ops como fname (imagen rota en el drawer).
 * Dedup por key: una foto repetida en dos campos se copia una sola vez (primera gana).
 */
export function extraerEvidencias(
  plano: Record<string, unknown>,
): Array<{ campo: string; key: string }> {
  const out: Array<{ campo: string; key: string }> = [];
  const vistas = new Set<string>();
  const truncadas: string[] = [];
  const recorrer = (v: unknown, ruta: string, prof: number): void => {
    if (esKeyEvidencia(v)) {
      if (!vistas.has(v)) {
        vistas.add(v);
        out.push({ campo: ruta, key: v });
      }
      return;
    }
    if (v === null || typeof v !== "object") return;
    if (prof >= 6) {
      // Nunca cortar EN SILENCIO: una key fuera del recorrido reproduce el bug del
      // fname crudo. El aviso es la señal para subir el tope si Ops anida más.
      truncadas.push(ruta);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((el, i) => recorrer(el, `${ruta}[${i}]`, prof + 1));
      return;
    }
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      recorrer(val, ruta ? `${ruta}.${k}` : k, prof + 1);
    }
  };
  recorrer(plano, "", 0);
  if (truncadas.length) {
    console.warn(JSON.stringify({ evt: "evidencias_prof_max", rutas: truncadas.slice(0, 5) }));
  }
  return out;
}

/**
 * Colapsa evidencias con la MISMA key (primera gana, orden estable). El receptor copia
 * las evidencias EN PARALELO y resuelve key→fname con un Map: sin dedup, una key
 * duplicada en dos campos se copiaba dos veces y `fnames.set` se quedaba con el fname
 * del que TERMINARA último — referencia no determinística entre re-entregas. Mismo
 * criterio que extraerEvidencias (el enumerador del backfill), para que ambos caminos
 * elijan la misma referencia.
 */
export function dedupEvidencias(
  evidencias: Array<{ campo: string; key: string }>,
): Array<{ campo: string; key: string }> {
  const vistas = new Set<string>();
  return evidencias.filter(({ key }) => !vistas.has(key) && (vistas.add(key), true));
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
 * Folio de la SOLICITUD de origen de un reporte de carga, en la convención de FC.
 *
 * Ops implementó el vínculo 1-a-1 el 2026-07-28 y manda DOS campos — el más cómodo es el
 * equivocado:
 *   solicitudId    = "08f0553fee77"       ← el id crudo, este sirve
 *   folioSolicitud = "SOL-08F0553FEE77"   ← NO usar tal cual
 *
 * ⚠️ `folioSolicitud` incumple la convención de FC por partida doble: prefijo `SOL-` en vez
 * de `OPS-`, y MAYÚSCULAS. Verificado contra producción: `OPS-08f0553fee77` existe;
 * `OPS-08F0553FEE77` y `SOL-08F0553FEE77` no. Usarlo directo no encuentra nada y **no
 * levanta ningún error** — por eso siempre se deriva del id.
 *
 * El `solicitudId` se usa VERBATIM (es el mismo id con el que `mapSolicitud` compuso el
 * eventoId de la solicitud). Solo el respaldo desde `folioSolicitud` normaliza caja, porque
 * ahí sabemos que Ops la altera.
 */
export function folioSolicitudOrigen(ops: Record<string, unknown>): string | undefined {
  const crudo = String(ops.solicitudId ?? "").trim();
  if (crudo) return opsEventoId(crudo);
  const desdeFolio = String(ops.folioSolicitud ?? "")
    .trim()
    .replace(/^SOL-/i, "")
    .toLowerCase();
  return desdeFolio ? opsEventoId(desdeFolio) : undefined;
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
 * Devuelve una COPIA del input sin las claves indicadas (no muta el original).
 * Se usa en el upsert idempotente para el path de UPDATE: campos que se escriben
 * SOLO al crear y no deben pisarse en registros existentes (p.ej. `sucursal` en Unit
 * — el admin de FC manda; ver 2026-07-17 "sucursal editable-admin").
 */
export function inputSinCampos(
  input: Record<string, unknown>,
  campos: readonly string[],
): Record<string, unknown> {
  if (!campos.length) return { ...input };
  const out = { ...input };
  for (const k of campos) delete out[k];
  return out;
}

// Vocabulario de áreas (decisión 2026-07-17 "área automática desde Ops"): se adoptan
// las 5 de Ops. El catálogo CAT#VEHICLE de Operaciones-GPA guarda `responsable` en
// MAYÚSCULAS sin acentos; FC lo muestra en grafía bonita. Fuente ÚNICA del área: el
// catálogo (la areaResponsable por-carga viene vacía ~80% → no sirve para mantener).
const AREA_OPS: Record<string, string> = {
  LOGISTICA: "Logística",
  ALMACEN: "Almacén",
  "SERVICIO TECNICO": "Servicio Técnico",
  MANTENIMIENTO: "Mantenimiento",
  ADMINISTRACION: "Administración",
};

/** Normaliza `CAT#VEHICLE.responsable` (Ops) a la grafía de FC; "" si es desconocida. */
export function normalizarArea(responsable: unknown): string {
  return (
    AREA_OPS[
      String(responsable ?? "")
        .trim()
        .toUpperCase()
    ] ?? ""
  );
}

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
