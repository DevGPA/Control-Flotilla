import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { moreappWebhook } from "../functions/moreapp-webhook/resource";
import { adminUsers } from "../functions/admin-users/resource";

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
      .authorization((allow) => [
        // Lectura aislada por tenant (incluye viewer). Escritura SOLO operativo/admin
        // (viewer = solo lectura, incidente permisos 2026-06-18). El webhook (IAM)
        // conserva escritura vía el grant a nivel de schema, más abajo.
        // Deuda técnica: operativo/admin son grupos GLOBALES de escritura (no por-tenant);
        // inocuo con un solo tenant (gpa), revisar si se añade un 2º tenant.
        allow.groupDefinedIn("tenantId").to(["read"]),
        allow.group("operativo").to(["create", "update", "delete"]),
        allow.group("admin"),
      ])
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
      .authorization((allow) => [
        // Lectura aislada por tenant (incluye viewer). Escritura SOLO operativo/admin
        // (viewer = solo lectura, incidente permisos 2026-06-18). El webhook (IAM)
        // conserva escritura vía el grant a nivel de schema, más abajo.
        // Deuda técnica: operativo/admin son grupos GLOBALES de escritura (no por-tenant);
        // inocuo con un solo tenant (gpa), revisar si se añade un 2º tenant.
        allow.groupDefinedIn("tenantId").to(["read"]),
        allow.group("operativo").to(["create", "update", "delete"]),
        allow.group("admin"),
      ]),

    Nota: a
      .model({
        tenantId: a.string().required(),
        unitUid: a.string().required(),
        autorId: a.string().required(),
        texto: a.string().required(),
        timestamp: a.string().required(),
      })
      .identifier(["tenantId", "unitUid", "timestamp"])
      .authorization((allow) => [
        // Lectura aislada por tenant (incluye viewer). Escritura SOLO operativo/admin
        // (viewer = solo lectura, incidente permisos 2026-06-18). El webhook (IAM)
        // conserva escritura vía el grant a nivel de schema, más abajo.
        // Deuda técnica: operativo/admin son grupos GLOBALES de escritura (no por-tenant);
        // inocuo con un solo tenant (gpa), revisar si se añade un 2º tenant.
        allow.groupDefinedIn("tenantId").to(["read"]),
        allow.group("operativo").to(["create", "update", "delete"]),
        allow.group("admin"),
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
      .identifier(["tenantId", "unitUid", "fecha"])
      .authorization((allow) => [
        // Lectura aislada por tenant (incluye viewer). Escritura SOLO operativo/admin
        // (viewer = solo lectura, incidente permisos 2026-06-18). El webhook (IAM)
        // conserva escritura vía el grant a nivel de schema, más abajo.
        // Deuda técnica: operativo/admin son grupos GLOBALES de escritura (no por-tenant);
        // inocuo con un solo tenant (gpa), revisar si se añade un 2º tenant.
        allow.groupDefinedIn("tenantId").to(["read"]),
        allow.group("operativo").to(["create", "update", "delete"]),
        allow.group("admin"),
      ]),

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
      .authorization((allow) => [
        // Lectura aislada por tenant (incluye viewer). Escritura SOLO operativo/admin
        // (viewer = solo lectura, incidente permisos 2026-06-18). El webhook (IAM)
        // conserva escritura vía el grant a nivel de schema, más abajo.
        // Deuda técnica: operativo/admin son grupos GLOBALES de escritura (no por-tenant);
        // inocuo con un solo tenant (gpa), revisar si se añade un 2º tenant.
        allow.groupDefinedIn("tenantId").to(["read"]),
        allow.group("operativo").to(["create", "update", "delete"]),
        allow.group("admin"),
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
      .identifier(["tenantId", "periodoId", "unitUid"])
      .authorization((allow) => [
        // Lectura aislada por tenant (incluye viewer). Escritura SOLO operativo/admin
        // (viewer = solo lectura, incidente permisos 2026-06-18). El webhook (IAM)
        // conserva escritura vía el grant a nivel de schema, más abajo.
        // Deuda técnica: operativo/admin son grupos GLOBALES de escritura (no por-tenant);
        // inocuo con un solo tenant (gpa), revisar si se añade un 2º tenant.
        allow.groupDefinedIn("tenantId").to(["read"]),
        allow.group("operativo").to(["create", "update", "delete"]),
        allow.group("admin"),
      ])
      .secondaryIndexes((index) => [
        index("tenantId").sortKeys(["sucursal"]).name("byTenantAndSucursal"),
        index("tenantId").sortKeys(["unitUid"]).name("byTenantAndUnit"),
      ]),

    // Completación de hallazgos del checklist, COMPARTIDA entre usuarios del tenant.
    // Antes el "atendido/done" vivía solo en IndexedDB local → no se veía multi-user.
    // 1 record por (unidad, itemKey=texto del hallazgo). Marcar = upsert; desmarcar = delete.
    CheckDone: a
      .model({
        tenantId: a.string().required(),
        unitUid: a.string().required(),
        itemKey: a.string().required(),
        done: a.boolean().default(true),
        por: a.string(),
        ts: a.string(),
      })
      .identifier(["tenantId", "unitUid", "itemKey"])
      .authorization((allow) => [
        // Lectura aislada por tenant (incluye viewer). Escritura SOLO operativo/admin
        // (viewer = solo lectura, incidente permisos 2026-06-18). El webhook (IAM)
        // conserva escritura vía el grant a nivel de schema, más abajo.
        // Deuda técnica: operativo/admin son grupos GLOBALES de escritura (no por-tenant);
        // inocuo con un solo tenant (gpa), revisar si se añade un 2º tenant.
        allow.groupDefinedIn("tenantId").to(["read"]),
        allow.group("operativo").to(["create", "update", "delete"]),
        allow.group("admin"),
      ]),

    // ── Modulo de Administracion de Usuarios (2026-06-12) ──────────────────
    // Espejo local del usuario Cognito para listados eficientes y soft-delete.
    // Identidad = (tenantId, cognitoSub) — sub inmutable de Cognito.
    // Lo escribe SOLO la Lambda admin-users (allow.resource); 'admin' CRUD;
    // los demas miembros del tenant pueden LEER (la lista; viewer filtra en UI).
    UserProfile: a
      .model({
        tenantId: a.string().required(),
        cognitoSub: a.string().required(),
        email: a.string().required(),
        nombre: a.string(),
        telefono: a.string(),
        sucursal: a.string(),
        rol: a.string(), // 'admin' | 'operativo' | 'viewer'
        estatus: a.enum(["activo", "desactivado", "eliminado"]),
        createdAt: a.string(),
        updatedAt: a.string(),
      })
      .identifier(["tenantId", "cognitoSub"])
      .authorization((allow) => [
        allow.group("admin"),
        allow.groupDefinedIn("tenantId").to(["read"]),
      ]),

    // Bitacora de auditoria de acciones administrativas. La escribe SOLO la
    // Lambda admin-users (el cliente NO puede crear/editar); 'admin' solo LEE.
    // id = ts + sufijo aleatorio (lo genera la Lambda). detalleCambios = diff JSON.
    AuditEvent: a
      .model({
        tenantId: a.string().required(),
        id: a.string().required(),
        actor: a.string().required(),
        accion: a.string().required(),
        targetUser: a.string(),
        detalleCambios: a.json(),
        ip: a.string(),
        timestamp: a.string().required(),
      })
      .identifier(["tenantId", "id"])
      .authorization((allow) => [allow.group("admin").to(["read"])]),

    // ── Custom operations del módulo de Administración de Usuarios ──────────
    // PRIMER uso de a.mutation/a.query en el proyecto. Cada una está restringida
    // a allow.group("admin"): AppSync valida la membresía ANTES de invocar la
    // Lambda (el "middleware de permisos" lo da la plataforma). Retornan a.json()
    // con la forma { ok, message?, error?, data? }.
    adminCreateUser: a
      .mutation()
      .arguments({
        email: a.string().required(),
        nombre: a.string().required(),
        telefono: a.string(),
        rol: a.string().required(),
        sucursal: a.string(),
      })
      .returns(a.json())
      .handler(a.handler.function(adminUsers))
      .authorization((allow) => [allow.group("admin")]),

    adminUpdateUser: a
      .mutation()
      .arguments({
        cognitoSub: a.string().required(),
        nombre: a.string(),
        telefono: a.string(),
        sucursal: a.string(),
      })
      .returns(a.json())
      .handler(a.handler.function(adminUsers))
      .authorization((allow) => [allow.group("admin")]),

    adminSetEnabled: a
      .mutation()
      .arguments({ cognitoSub: a.string().required(), enabled: a.boolean().required() })
      .returns(a.json())
      .handler(a.handler.function(adminUsers))
      .authorization((allow) => [allow.group("admin")]),

    adminDeleteUser: a
      .mutation()
      .arguments({ cognitoSub: a.string().required() })
      .returns(a.json())
      .handler(a.handler.function(adminUsers))
      .authorization((allow) => [allow.group("admin")]),

    adminResetPassword: a
      .mutation()
      .arguments({ cognitoSub: a.string().required() })
      .returns(a.json())
      .handler(a.handler.function(adminUsers))
      .authorization((allow) => [allow.group("admin")]),

    adminSetRole: a
      .mutation()
      .arguments({ cognitoSub: a.string().required(), rol: a.string().required() })
      .returns(a.json())
      .handler(a.handler.function(adminUsers))
      .authorization((allow) => [allow.group("admin")]),

    adminListUsers: a
      .query()
      .returns(a.json())
      .handler(a.handler.function(adminUsers))
      .authorization((allow) => [allow.group("admin")]),
  })
  // Acceso IAM para el Lambda moreapp-webhook (FASE 2): ingiere envíos de MoreApp
  // y escribe Unit/Checklist (mensual) + Unit/Semanal (semanal). El grant resource
  // es a nivel schema (la API no lo soporta por-modelo).
  .authorization((allow) => [
    allow.resource(moreappWebhook).to(["query", "mutate"]),
    // admin-users escribe UserProfile/AuditEvent y lee UserProfile vía IAM.
    allow.resource(adminUsers).to(["query", "mutate"]),
  ]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
