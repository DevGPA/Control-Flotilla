import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

/**
 * Schema replica 1:1 las 6 entidades de shared/types/entities.ts.
 *
 * Multi-tenancy: campo `tenantId` = nombre del Cognito group del usuario.
 * Cada record solo es visible/editable por miembros del group correspondiente.
 * Group 'admin' tiene acceso cross-tenant.
 *
 * Identificadores: AppSync genera UUID por default (campo `id`).
 * Para dedup natural-key (placa, unitUid+fecha, etc.) se agregará un custom
 * resolver en fase futura. Por ahora confiamos en que el cliente verifique
 * antes de crear.
 *
 * Secondary indexes: queries por tenant + sort key alterno (placa, sucursal,
 * fechaEntrada, etc.) — reemplaza los GSIs del CDK single-table anterior.
 */
const schema = a.schema({
  Unit: a
    .model({
      tenantId: a.string().required(),
      placa: a.string().required(),
      marca: a.string(),
      modelo: a.string(),
      anio: a.integer(),
      sucursal: a.string(),
      vin: a.string(),
      version: a.integer().default(1),
    })
    .authorization((allow) => [
      allow.groupsDefinedIn("tenantId"),
      allow.group("admin"),
    ])
    .secondaryIndexes((index) => [
      index("tenantId").sortKeys(["placa"]).name("byTenantAndPlaca"),
      index("tenantId").sortKeys(["sucursal"]).name("byTenantAndSucursal"),
    ]),

  Taller: a
    .model({
      tenantId: a.string().required(),
      unitUid: a.string().required(),
      fechaEntrada: a.string().required(),
      fechaSalida: a.string(),
      folio: a.string(),
      motivo: a.string().required(),
      estatus: a.enum(["abierto", "cerrado"]),
      version: a.integer().default(1),
    })
    .authorization((allow) => [
      allow.groupsDefinedIn("tenantId"),
      allow.group("admin"),
    ])
    .secondaryIndexes((index) => [
      index("tenantId").sortKeys(["unitUid", "fechaEntrada"]).name("byTenantUnitFecha"),
    ]),

  Nota: a
    .model({
      tenantId: a.string().required(),
      unitUid: a.string().required(),
      autorId: a.string().required(),
      texto: a.string().required(),
      timestamp: a.string().required(),
    })
    .authorization((allow) => [
      allow.groupsDefinedIn("tenantId"),
      allow.group("admin"),
    ])
    .secondaryIndexes((index) => [
      index("tenantId").sortKeys(["unitUid", "timestamp"]).name("byTenantUnitTimestamp"),
    ]),

  Checklist: a
    .model({
      tenantId: a.string().required(),
      unitUid: a.string().required(),
      fecha: a.string().required(),
      tipoInspeccion: a.string().required(),
      resultados: a.json(),
      responsable: a.string(),
      version: a.integer().default(1),
    })
    .authorization((allow) => [
      allow.groupsDefinedIn("tenantId"),
      allow.group("admin"),
    ])
    .secondaryIndexes((index) => [
      index("tenantId").sortKeys(["unitUid", "fecha"]).name("byTenantUnitFecha"),
    ]),

  Periodo: a
    .model({
      tenantId: a.string().required(),
      tipo: a.enum(["semanal", "mensual", "inspeccion"]),
      fechaInicio: a.string().required(),
      fechaFin: a.string().required(),
      estatus: a.enum(["abierto", "cerrado"]),
      version: a.integer().default(1),
    })
    .authorization((allow) => [
      allow.groupsDefinedIn("tenantId"),
      allow.group("admin"),
    ])
    .secondaryIndexes((index) => [
      index("tenantId").sortKeys(["fechaInicio"]).name("byTenantFechaInicio"),
    ]),

  Semanal: a
    .model({
      tenantId: a.string().required(),
      periodoId: a.string().required(),
      sucursal: a.string().required(),
      unitUid: a.string().required(),
      datos: a.json(),
      version: a.integer().default(1),
    })
    .authorization((allow) => [
      allow.groupsDefinedIn("tenantId"),
      allow.group("admin"),
    ])
    .secondaryIndexes((index) => [
      index("tenantId").sortKeys(["periodoId", "sucursal"]).name("byTenantPeriodoSucursal"),
      index("tenantId").sortKeys(["unitUid"]).name("byTenantUnit"),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
