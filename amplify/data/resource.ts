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
        // Producto Toka asociado a la unidad (catálogo editable por el admin). Es la
        // fuente de verdad del producto para el layout de carga masiva Toka: tiene
        // prioridad sobre el eco.PRODUCTO de MoreApp, que puede quedar desactualizado
        // cuando una unidad migra de tarjeta (p.ej. de TOKA COMBUSTIBLE a EASYGAS).
        productoToka: a.string(),
        // Área operativa de la unidad (indicador de gasto por área — auditoría 2026-07).
        // Valores canónicos: Logística | Almacén | Postventa | Administración (select fijo
        // en el panel admin; validación en cliente). El webhook NUNCA la escribe, así que
        // la asignación del admin sobrevive re-ingestas (el upsert solo pisa campos presentes).
        area: a.string(),
        version: a.integer().default(1),
      })
      .identifier(["tenantId", "placa"])
      .authorization((allow) => [
        // Catálogo ADMINISTRATIVO (2026-06-23): lectura aislada por tenant (incluye viewer);
        // ESCRITURA SOLO admin — el Producto Toka que manda en el layout de carga masiva lo
        // gestiona el admin, y operativo ya NO debe alterarlo por AppSync. El webhook (IAM)
        // conserva escritura vía el grant a nivel de schema (allow.resource), más abajo, así
        // que la ingesta de MoreApp NO se ve afectada. Nota: la carga legacy de unidades por
        // Excel/ZIP queda restringida a admin (los datos hoy llegan por webhook).
        allow.groupDefinedIn("tenantId").to(["read"]),
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
        // Lectura aislada por tenant (incluye viewer). Escritura SOLO admin
        // (hardening 2026-07-09: operativo ya no escribe — los checklists entran
        // por el webhook/IAM y la carga legacy Excel es un flujo admin; ningún
        // flujo operativo del cliente escribía este modelo, verificado por grep).
        // Deuda técnica: admin es grupo GLOBAL de escritura (no por-tenant);
        // inocuo con un solo tenant (gpa), revisar si se añade un 2º tenant.
        allow.groupDefinedIn("tenantId").to(["read"]),
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
        // Lectura aislada por tenant (incluye viewer). Escritura SOLO admin
        // (hardening 2026-07-09: operativo ya no escribe — los semanales entran
        // por el webhook/IAM y la carga legacy Excel es un flujo admin; ningún
        // flujo operativo del cliente escribía este modelo, verificado por grep).
        allow.groupDefinedIn("tenantId").to(["read"]),
        allow.group("admin"),
      ])
      .secondaryIndexes((index) => [
        index("tenantId").sortKeys(["sucursal"]).name("byTenantAndSucursal"),
        index("tenantId").sortKeys(["unitUid"]).name("byTenantAndUnit"),
      ]),

    // ── Módulo de Cargas de Combustible (2026-06-22) ───────────────────────
    // Ingiere los 2 formularios de MoreApp: "Solicitud Gasolina ROF v2" y
    // "Carga Gasolina ROF v2". UN modelo discriminado por `tipo`, igual patrón
    // que Semanal/Taller (columnas tipadas filtrables + blob `datos` JSON).
    // IDENTIDAD POR ID DE UNIDAD (economicoId), no por placa: el ID es estable
    // ante cambios de placa/errores de captura (decisión de producto 2026-06-22).
    // `eventoId` = meta.serialNumber (folio MoreApp) → dedup nativa / idempotencia.
    // La revisión humana vive en ValidacionCarga (separada) para que un
    // re-ingest/re-backfill del webhook NUNCA pise el veredicto del revisor.
    CargaCombustible: a
      .model({
        tenantId: a.string().required(),
        economicoId: a.string().required(),
        // 'solicitud' | 'carga' — string, no enum (Gen 2 no permite enum en identifier, ver Periodo.tipo).
        tipo: a.string().required(),
        eventoId: a.string().required(),
        placa: a.string(),
        sucursal: a.string().required(),
        tanque: a.string(),
        fecha: a.string().required(), // YYYY-MM-DD
        fechaHora: a.string(),
        responsable: a.string(),
        kmCapturado: a.integer(),
        // Solicitud (lo planeado/estimado)
        nivelAntes: a.string(),
        nivelDeseado: a.string(),
        montoEstimado: a.float(),
        maxLitros: a.float(),
        // Carga (lo real)
        litrosCargados: a.float(),
        precioPorLitro: a.float(),
        montoTotal: a.float(),
        seLlenoTanque: a.string(),
        // photos[] ({group,col,fname}), ubicacionDeCarga, producto/combustible/precio,
        // porcentaje/precioEstimado/observaciones/email, moreappFormId/FormVersionId,
        // sucursalRaw, economicoIdFaltante? — JSON arbitrary para no migrar schema.
        datos: a.json(),
        version: a.integer().default(1),
      })
      .identifier(["tenantId", "economicoId", "tipo", "eventoId"])
      .authorization((allow) => [
        // Lectura aislada por tenant (incluye viewer). Escritura SOLO admin
        // (hardening 2026-07-09: operativo ya no escribe — las cargas entran por el
        // webhook/IAM; ningún flujo del cliente escribía este modelo. La validación
        // humana del operativo vive en ValidacionCarga, que conserva su permiso).
        allow.groupDefinedIn("tenantId").to(["read"]),
        allow.group("admin"),
      ])
      .secondaryIndexes((index) => [
        index("tenantId").sortKeys(["sucursal"]).name("byTenantAndSucursal"),
        index("tenantId").sortKeys(["economicoId"]).name("byTenantAndUnit"),
      ]),

    // Revisión humana de una carga (1 por carga). loadId = "economicoId|tipo|eventoId".
    // Separada de CargaCombustible: el webhook escribe los datos, el revisor escribe
    // aquí, sin que un upsert pise al otro. Espejo de CheckDone. Los campos *Detectado
    // los llena la Lambda de visión (Fase E); fuenteDeteccion distingue manual vs ia.
    ValidacionCarga: a
      .model({
        tenantId: a.string().required(),
        loadId: a.string().required(),
        // 'ok' | 'discrepancia' | 'pendiente'
        verdictGlobal: a.string(),
        porEvidencia: a.json(), // { odometro:'ok', medidor:'discrepancia', ... }
        revisadoPor: a.string(),
        nota: a.string(),
        ts: a.string(),
        // Lectura IA (Fase E) — asesora, el humano confirma.
        kmDetectado: a.integer(),
        nivelDetectado: a.string(),
        litrosDetectado: a.float(),
        confianzaVision: a.float(),
        fuenteDeteccion: a.string(), // 'manual' | 'ia'
        version: a.integer().default(1),
      })
      .identifier(["tenantId", "loadId"])
      .authorization((allow) => [
        allow.groupDefinedIn("tenantId").to(["read"]),
        allow.group("operativo").to(["create", "update", "delete"]),
        allow.group("admin"),
      ]),

    // ── Anulación admin de registros (2026-07-09) ───────────────────────────
    // Tombstone LÓGICO reversible para registros de evento capturados por error
    // (Inspecciones/Semanales/Combustible). El registro base NUNCA se borra ni se
    // modifica: esta fila lo excluye de KPIs/cálculos/vistas en la hidratación.
    // Modelo separado con la identidad natural del registro (patrón ValidacionCarga/
    // CheckDone) → sobrevive re-ingests del webhook y backfills. Restaurar NO borra
    // la fila: la marca con restauradaPor/Ts (historial bidireccional de auditoría).
    // ESCRITURA SOLO admin — AppSync valida el grupo en el servidor, no la UI.
    Anulacion: a
      .model({
        tenantId: a.string().required(),
        // "combustible|<economicoId>|<tipo>|<eventoId>" (= "combustible|" + loadId)
        // "checklist|<unitUid>|<fecha>"   (identidad de Checklist)
        // "semanal|<periodoId>|<unitUid>" (identidad de Semanal)
        refId: a.string().required(),
        modulo: a.string().required(), // 'combustible' | 'checklist' | 'semanal' — validado en cliente
        motivo: a.string().required(),
        anuladoPor: a.string().required(),
        ts: a.string().required(), // ISO
        // Restauración suave: con valor, la anulación YA NO aplica pero queda el rastro.
        restauradaPor: a.string(),
        restauradaTs: a.string(),
        version: a.integer().default(1),
      })
      .identifier(["tenantId", "refId"])
      .authorization((allow) => [
        // Todos los del tenant LEEN (badge/motivo visibles); escribe SOLO admin.
        allow.groupDefinedIn("tenantId").to(["read"]),
        allow.group("admin"),
      ])
      .secondaryIndexes((index) => [
        index("tenantId").sortKeys(["modulo"]).name("byTenantAndModulo"),
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

    // ── Módulo de Cumplimiento Vehicular (2026-06-26) ──────────────────────
    // Expediente por unidad de obligaciones (verificación, tenencia, refrendo,
    // seguro, tarjeta de circulación, licencias de operadores) y multas.
    // IDENTIDAD POR economicoId (igual que CargaCombustible). `docId` distingue:
    //   singletons → docId = tipoDoc (1 por unidad por dimensión, upsert idempotente)
    //   multas     → docId = "multa#<jurisdiccion>#<folio>" (varias por unidad)
    // Se guardan datos CRUDOS (fechaVencimiento, monto…); el estado vencido/por-vencer
    // se DERIVA en el front (complianceStatus) para no quedar obsoleto con el tiempo.
    // Captura manual hoy (operativo/admin); `fuente` será 'amis'/'repuve' al automatizar.
    ComplianceDoc: a
      .model({
        tenantId: a.string().required(),
        economicoId: a.string().required(),
        docId: a.string().required(),
        // ComplianceTipoDoc: 'verificacion'|'tenencia'|'refrendo'|'seguro'|
        // 'tarjetaCirculacion'|'licencia'|'multa'. String (no enum) → extensible sin migración.
        tipoDoc: a.string().required(),
        jurisdiccion: a.string(), // 'jalisco'|'cdmx'|'edomex'|'nuevoleon'|'federal'|'otra'
        fechaVencimiento: a.string(), // YYYY-MM-DD
        fechaEmision: a.string(), // YYYY-MM-DD
        referencia: a.string(), // nº de póliza / folio / línea de captura
        monto: a.float(), // adeudo (multas / tenencia / refrendo)
        fuente: a.string(), // 'manual' | 'amis' | 'repuve' | 'portal'
        evidenciaFname: a.string(), // foto/escaneo (URL firmada por demanda)
        operador: a.string(), // titular de la licencia (tipoDoc === 'licencia')
        nota: a.string(),
        ultimaActualizacion: a.string(),
        version: a.integer().default(1),
      })
      .identifier(["tenantId", "economicoId", "docId"])
      .authorization((allow) => [
        // Lectura aislada por tenant (incluye viewer). Escritura SOLO operativo/admin.
        // Deuda técnica: operativo/admin son grupos GLOBALES de escritura (no por-tenant);
        // inocuo con un solo tenant (gpa), revisar si se añade un 2º tenant.
        allow.groupDefinedIn("tenantId").to(["read"]),
        allow.group("operativo").to(["create", "update", "delete"]),
        allow.group("admin"),
      ])
      .secondaryIndexes((index) => [
        index("tenantId").sortKeys(["economicoId"]).name("byTenantAndUnit"),
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
        modulos: a.string(), // CSV de módulos permitidos (espejo de custom:modulos). Vacío = todos.
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
        modulos: a.string(), // CSV de módulos permitidos (vacío = todos)
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
        modulos: a.string(),
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
