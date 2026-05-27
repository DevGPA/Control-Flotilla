import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { moreappWebhook } from "../functions/moreapp-webhook/resource";

/**
 * Schema replica 1:1 las 6 entidades de shared/types/entities.ts.
 *
 * Multi-tenancy: campo `tenantId` = nombre del Cognito group del usuario.
 * Cada record solo es visible/editable por miembros del group correspondiente.
 * Group 'admin' tiene acceso cross-tenant.
 *
 * Composite identifiers (natural keys) garantizan dedup nativa de DynamoDB:
 * - Unit: (tenantId, placa) — 1 unidad por placa por tenant.
 * - Taller: (tenantId, unitUid, fechaEntrada) — 1 ingreso por unidad/fecha.
 * - Nota: (tenantId, unitUid, timestamp) — 1 nota por timestamp exacto.
 * - Checklist: (tenantId, unitUid, fecha) — 1 inspección por día por unidad.
 * - Periodo: (tenantId, tipo, fechaInicio) — 1 período por (tipo, inicio).
 * - Semanal: (tenantId, periodoId, unitUid) — 1 reporte semanal por (período, unidad).
 *
 * El cliente upsert pattern (create → catch conflict → update) usa estos
 * identifiers para idempotencia: re-subir un ZIP no crea duplicados.
 *
 * Secondary indexes solo se mantienen cuando aportan acceso alterno (sucursal,
 * etc.). Los GSIs redundantes con el composite PK fueron removidos.
 */
const schema = a
  .schema({
    Unit: a
      .model({
        tenantId: a.string().required(),
        placa: a.string().required(),
        economicoId: a.string(),
        marca: a.string(),
        modelo: a.string(),
        anio: a.integer(),
        sucursal: a.string(),
        vin: a.string(),
        version: a.integer().default(1),
      })
      .identifier(["tenantId", "placa"])
      .authorization((allow) => [allow.groupDefinedIn("tenantId"), allow.group("admin")])
      .secondaryIndexes((index) => [
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
        // Datos legacy completos (id, unitKey, eco, plate, brand, area, tipo,
        // freporte, fsalidaEst, fsalidaReal, km, gasto*, tecnico, refacciones,
        // comentario, updatedAt). JSON arbitrary para no migrar schema en cada cambio.
        datos: a.json(),
        version: a.integer().default(1),
      })
      .identifier(["tenantId", "unitUid", "fechaEntrada"])
      .authorization((allow) => [allow.groupDefinedIn("tenantId"), allow.group("admin")]),

    Nota: a
      .model({
        tenantId: a.string().required(),
        unitUid: a.string().required(),
        autorId: a.string().required(),
        texto: a.string().required(),
        timestamp: a.string().required(),
      })
      .identifier(["tenantId", "unitUid", "timestamp"])
      .authorization((allow) => [allow.groupDefinedIn("tenantId"), allow.group("admin")]),

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
      .identifier(["tenantId", "unitUid", "fecha"])
      .authorization((allow) => [allow.groupDefinedIn("tenantId"), allow.group("admin")]),

    Periodo: a
      .model({
        tenantId: a.string().required(),
        // tipo: 'semanal' | 'mensual' | 'inspeccion' — validado en cliente.
        // No usamos a.enum() porque Amplify Gen 2 no permite enum en identifier.
        tipo: a.string().required(),
        fechaInicio: a.string().required(),
        fechaFin: a.string().required(),
        estatus: a.enum(["abierto", "cerrado"]),
        version: a.integer().default(1),
      })
      .identifier(["tenantId", "tipo", "fechaInicio"])
      .authorization((allow) => [allow.groupDefinedIn("tenantId"), allow.group("admin")]),

    Semanal: a
      .model({
        tenantId: a.string().required(),
        periodoId: a.string().required(),
        sucursal: a.string().required(),
        unitUid: a.string().required(),
        datos: a.json(),
        version: a.integer().default(1),
      })
      .identifier(["tenantId", "periodoId", "unitUid"])
      .authorization((allow) => [allow.groupDefinedIn("tenantId"), allow.group("admin")])
      .secondaryIndexes((index) => [
        index("tenantId").sortKeys(["sucursal"]).name("byTenantAndSucursal"),
        index("tenantId").sortKeys(["unitUid"]).name("byTenantAndUnit"),
      ]),
  })
  // Acceso IAM para el Lambda moreapp-webhook (FASE 2): ingiere envíos de MoreApp
  // y escribe Unit/Checklist (mensual) + Unit/Semanal (semanal). El grant resource
  // es a nivel schema (la API no lo soporta por-modelo).
  .authorization((allow) => [allow.resource(moreappWebhook).to(["query", "mutate"])]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
