/**
 * Mapeo nube → front del módulo de Cumplimiento: ComplianceDocRow[] (filas crudas de
 * DynamoDB, campos opcionales posiblemente null) → ComplianceEntry[] con estado derivado.
 * PURO y testeable sin DOM ni Amplify, igual que src/fuel/mapEntry.ts.
 *
 * Resuelve opcionalmente sucursal/placa por economicoId desde un lookup del catálogo de
 * unidades (para el scope por sucursal y el render), sin acoplarse a window ni a un tipo
 * concreto de unidad — el caller arma el Map.
 */
import { toComplianceEntry } from "./complianceAnalysis";
import type {
  CapturaFields,
  ComplianceDoc,
  ComplianceEntry,
  ComplianceFuente,
  ComplianceJurisdiccion,
  ComplianceTipoDoc,
} from "./types";

/** Fila cruda de DynamoDB (modelo ComplianceDoc); los opcionales pueden venir null. */
export type ComplianceDocRow = {
  tenantId?: string | null;
  economicoId?: string | null;
  docId?: string | null;
  tipoDoc?: string | null;
  jurisdiccion?: string | null;
  fechaVencimiento?: string | null;
  fechaEmision?: string | null;
  referencia?: string | null;
  monto?: number | null;
  fuente?: string | null;
  evidenciaFname?: string | null;
  operador?: string | null;
  nota?: string | null;
  ultimaActualizacion?: string | null;
};

/** Datos de la unidad para resolver sucursal/placa por economicoId. */
export type UnitInfo = { sucursal?: string; placa?: string };

/** Convierte una fila cruda a ComplianceDoc; null si le falta identidad mínima. */
function rowToDoc(r: ComplianceDocRow): ComplianceDoc | null {
  // Normaliza la identidad (trim) — consistente con cómo se construye unitsByEco y
  // catalogoFlota; sin esto un economicoId con espacios ("  78  ") no empata el lookup.
  const tenantId = String(r.tenantId ?? "").trim();
  const economicoId = String(r.economicoId ?? "").trim();
  const docId = String(r.docId ?? "").trim();
  const tipoDoc = String(r.tipoDoc ?? "").trim();
  if (!tenantId || !economicoId || !docId || !tipoDoc) return null;
  const doc: ComplianceDoc = {
    tenantId,
    economicoId,
    docId,
    tipoDoc: tipoDoc as ComplianceTipoDoc,
  };
  if (r.jurisdiccion) doc.jurisdiccion = r.jurisdiccion as ComplianceJurisdiccion;
  if (r.fechaVencimiento) doc.fechaVencimiento = r.fechaVencimiento;
  if (r.fechaEmision) doc.fechaEmision = r.fechaEmision;
  if (r.referencia) doc.referencia = r.referencia;
  if (r.monto != null && r.monto >= 0) doc.monto = r.monto; // descarta montos negativos corruptos
  if (r.fuente) doc.fuente = r.fuente as ComplianceFuente;
  if (r.evidenciaFname) doc.evidenciaFname = r.evidenciaFname;
  if (r.operador) doc.operador = r.operador;
  if (r.nota) doc.nota = r.nota;
  if (r.ultimaActualizacion) doc.ultimaActualizacion = r.ultimaActualizacion;
  return doc;
}

/**
 * Construye los ComplianceEntry del front a partir de las filas crudas y "hoy" (YYYY-MM-DD).
 * Descarta filas sin identidad mínima (tenant/eco/docId/tipoDoc). Si se pasa `unitsByEco`,
 * adjunta sucursal/placa por economicoId.
 */
export function buildComplianceEntries(
  rows: ComplianceDocRow[],
  hoy: string,
  opts?: { unitsByEco?: Map<string, UnitInfo>; diasPorVencer?: number },
): ComplianceEntry[] {
  const out: ComplianceEntry[] = [];
  for (const r of rows) {
    const doc = rowToDoc(r);
    if (!doc) continue;
    const entry = toComplianceEntry(doc, hoy, opts?.diasPorVencer);
    const info = opts?.unitsByEco?.get(doc.economicoId);
    if (info) {
      if (info.sucursal) entry.sucursal = info.sucursal;
      if (info.placa) entry.placa = info.placa;
    }
    out.push(entry);
  }
  return out;
}

/**
 * Construye el ComplianceDoc a persistir desde los campos del formulario de captura. PURO.
 * docId: singletons → tipoDoc (1 por unidad por dimensión → re-alta = edición);
 * multas → "multa#<jurisdiccion>#<referencia|now>" (varias por unidad). `now` se inyecta
 * (ISO) para no depender de Date.now() aquí. Descarta montos negativos.
 */
export function buildComplianceDoc(
  tenantId: string,
  economicoId: string,
  fields: CapturaFields,
  now: string,
): ComplianceDoc {
  const jur = fields.jurisdiccion?.trim() || undefined;
  const ref = fields.referencia?.trim() || undefined;
  const docId =
    fields.tipoDoc === "multa" ? `multa#${jur ?? "otra"}#${ref ?? now}` : fields.tipoDoc;
  const doc: ComplianceDoc = {
    tenantId: tenantId.trim(),
    economicoId: economicoId.trim(),
    docId,
    tipoDoc: fields.tipoDoc,
    fuente: "manual",
    ultimaActualizacion: now,
  };
  if (jur) doc.jurisdiccion = jur as ComplianceJurisdiccion;
  if (fields.fechaVencimiento) doc.fechaVencimiento = fields.fechaVencimiento;
  if (fields.fechaEmision) doc.fechaEmision = fields.fechaEmision;
  if (ref) doc.referencia = ref;
  if (fields.monto != null && fields.monto >= 0) doc.monto = fields.monto;
  if (fields.nota?.trim()) doc.nota = fields.nota.trim();
  if (fields.operador?.trim()) doc.operador = fields.operador.trim();
  return doc;
}
