/**
 * Shared entity types between backend Lambdas and frontend api-client.
 * Source of truth for DDB single-table schema.
 *
 * Dedup contract:
 *   - Every entity has a deterministic `id` derived from its natural key.
 *   - Same natural key → same id → same DDB PK+SK → no duplicates.
 *   - `version` field used for optimistic locking on updates.
 */

export type EntityType = "UNIT" | "TALLER" | "NOTA" | "CHECKLIST" | "PERIODO" | "SEMANAL";

export interface EntityBase {
  id: string;
  tenantId: string;
  type: EntityType;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface Unit extends EntityBase {
  type: "UNIT";
  placa: string;
  marca?: string;
  modelo?: string;
  anio?: number;
  sucursal?: string;
  vin?: string;
}

export interface TallerRecord extends EntityBase {
  type: "TALLER";
  unitUid: string;
  fechaEntrada: string;
  fechaSalida?: string;
  folio?: string;
  motivo: string;
  estatus: "abierto" | "cerrado";
}

export interface Nota extends EntityBase {
  type: "NOTA";
  unitUid: string;
  autorId: string;
  texto: string;
  timestamp: string;
}

export interface ChecklistRecord extends EntityBase {
  type: "CHECKLIST";
  unitUid: string;
  fecha: string;
  tipoInspeccion: string;
  resultados: Record<string, unknown>;
  responsable?: string;
}

export interface Periodo extends EntityBase {
  type: "PERIODO";
  tipo: "semanal" | "mensual" | "inspeccion";
  fechaInicio: string;
  fechaFin: string;
  estatus: "abierto" | "cerrado";
}

export interface Semanal extends EntityBase {
  type: "SEMANAL";
  periodoId: string;
  sucursal: string;
  unitUid: string;
  datos: Record<string, unknown>;
}

export type Entity = Unit | TallerRecord | Nota | ChecklistRecord | Periodo | Semanal;
