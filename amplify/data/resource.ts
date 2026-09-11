import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { adminUsers } from "../functions/admin-users/resource";
import { opsgpaReceptor } from "../functions/opsgpa-receptor/resource";
import { visionCombustible } from "../functions/vision-combustible/resource";
import { tallerPortal } from "../functions/taller-portal/resource";

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
        // Promovidos de `datos` a columnas (2026-09-08): los escribe el
        // PROVEEDOR desde la liga mientras Riesgos puede tener el registro
        // abierto. Como columnas, DynamoDB las actualiza independientes; dentro
        // del blob `datos` un escritor pisaría al otro sin aviso.
        // Estado real (A-13/R88): hoy SOLO se ESCRIBEN. El lado de LECTURA de la
        // app de escritorio (leer la columna y, si viene vacía, caer a
        // `datos.<campo>`) NO existe todavía — está en Plan 2.
        km: a.integer(),
        estadoOperativo: a.enum(["revisando", "reparando", "esperandoRefaccion", "lista"]),
        fsalidaEst: a.string(),
        /** Primera fecha prometida. Se escribe UNA sola vez: es contra esta que
         *  se mide el incumplimiento, así que el taller no la puede reescribir. */
        fsalidaEstCompromiso: a.string(),
        /** Interruptor de revocación de la liga del proveedor (Plan 1, Task 5):
         *  Task 11 la escribe al emitir cada liga y la sube para invalidar las
         *  ya emitidas. Columna real (no `datos`) A PROPÓSITO: `datos` se
         *  reemplaza completo en cada guardado de escritorio (upsertTaller,
         *  src/api/client.ts), así que vivir ahí la borraría en silencio y un
         *  token viejo volvería a valer sin que nadie lo note. Ausente hoy en
         *  toda fila existente — nada la escribe todavía (Task 11); el lado
         *  que la LEE (ligaRevocada, en taller-portal/validacion.ts) trata la
         *  ausencia como versión 1. */
        ligaVersion: a.integer(),
        /** Rastro de auditoría de la liga (Task 11, decisión 20 del spec):
         *  quién la generó/revocó y cuándo, para que una liga filtrada tenga
         *  un responsable identificable. Columnas reales, NO `datos`, por el
         *  MISMO motivo que `ligaVersion` de arriba: `datos` se reemplaza
         *  completo en cada guardado de escritorio (upsertTaller,
         *  src/api/client.ts), así que un rastro guardado ahí desaparecería
         *  en silencio con la siguiente edición del registro. Ausentes en
         *  toda fila existente — nada las escribe todavía (Task 11); el
         *  botón "Revocar liga" usa `ligaCreadaEn` para decidir si ya se
         *  generó una (visitas previas a esta feature: ausente ⇒ oculto). */
        ligaCreadaEn: a.string(),
        ligaCreadaPor: a.string(),
        ligaRevocadaEn: a.string(),
        ligaRevocadaPor: a.string(),
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

    /**
     * Una partida = un hallazgo cotizado por el proveedor: su evidencia, su
     * precio y su propia decisión de autorización.
     *
     * `visitaKey` = `${unitUid}|${fechaEntrada}` — empata con la llave natural
     * de `Taller` y con la que compone `tallerCloudKey()` en
     * src/api/batchUpload.ts.
     *
     * `descripcion` la escribe un TERCERO NO AUTENTICADO (el taller, desde la
     * liga). Nunca pintarla con innerHTML.
     */
    TallerPartida: a
      .model({
        tenantId: a.string().required(),
        visitaKey: a.string().required(),
        partidaId: a.string().required(),

        descripcion: a.string().required(),
        tipo: a.enum(["refaccion", "manoObra"]),
        /** Sin IVA. REQUERIDO (R92): con el campo nullable, cualquier escritor
         *  directo a AppSync creaba una partida sin precio y `autorizar`
         *  (src/taller/partidas.ts) firmaba $0 en silencio — exactamente la
         *  falla que este módulo existe para matar. Seguro de aplicar: cero
         *  partidas en PROD al momento del cambio. `autorizar` además lanza si
         *  el precio no es finito (fail-closed en la capa pura). */
        precio: a.float().required(),
        estado: a.enum([
          "borrador",
          "propuesta",
          "autorizada",
          "rechazada",
          "terminada",
          "cancelada",
        ]),
        motivoRechazo: a.string(),
        /** Solo cuando el motivo es "Otro". Es lo que dice qué opción falta
         *  en el menú (decisión 19 del spec). */
        motivoRechazoNota: a.string(),
        fotos: a.string().array(),
        evidenciaFinal: a.string().array(),
        /** Congelado en el momento de la firma: se autoriza un precio, no una idea. */
        precioAutorizado: a.float(),
        /** partidaId de la partida que se está recotizando (Plan 2). */
        recotizaDe: a.string(),
        /** Quién cotizó ESTA partida; puede diferir del proveedor de la visita. */
        proveedorNombre: a.string(),
        /** "liga:<hash8>" | "user:<sub>" */
        creadoPor: a.string(),
        creadoEn: a.string(),
        propuestoEn: a.string(),
        decididoEn: a.string(),
        decididoPor: a.string(),
        terminadoEn: a.string(),
        version: a.integer().default(1),
      })
      .identifier(["tenantId", "visitaKey", "partidaId"])
      .authorization((allow) => [
        // Lectura aislada por tenant (incluye viewer). Escritura operativo/admin;
        // el Lambda del portal escribe por IAM vía el grant de schema, abajo.
        // R92: `operativo` NO tiene `delete`. El ciclo de esta partida ya tiene
        // `cancelada` (anulación reversible) y el estándar del repo es
        // "anulación, nunca borrado" — el `delete` venía de copiar el
        // boilerplate de otros modelos y concedía borrado FÍSICO sobre la única
        // copia del dinero firmado.
        allow.groupDefinedIn("tenantId").to(["read"]),
        allow.group("operativo").to(["create", "update"]),
        allow.group("admin"),
      ])
      .secondaryIndexes((index) => [
        // Para contar lo pendiente de firma sin recorrer toda la tabla.
        index("tenantId").sortKeys(["estado"]).name("byTenantAndEstado"),
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
        // Perf F3-2 (2026-07-10): habilita Query por ventana de fechas (la tabla más
        // grande y la única que crece a diario ~1k/mes). El frontend hidrata solo la
        // ventana visible (default 3 meses) en vez de Scan del histórico completo.
        index("tenantId").sortKeys(["fecha"]).name("byTenantAndFecha"),
      ]),

    // Revisión humana de una carga (1 por carga). loadId = "economicoId|tipo|eventoId".
    // Separada de CargaCombustible: el webhook escribe los datos, el revisor escribe
    // aquí, sin que un upsert pise al otro. Espejo de CheckDone. Los campos *Detectado
    // los llena la Lambda de visión (Fase E); fuenteDeteccion distingue 'manual' | 'ia' | 'ops-gpa'.
    ValidacionCarga: a
      .model({
        tenantId: a.string().required(),
        loadId: a.string().required(),
        // 'ok' | 'discrepancia' | 'pendiente' | 'rechazada' (rechazo en origen Ops-GPA)
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
        fuenteDeteccion: a.string(), // 'manual' | 'ia' | 'ops-gpa'
        // Visión IA de tickets (Fase 1, 2026-08-20). La Lambda vision-combustible SOLO
        // escribe estos campos + los *Detectado de arriba — jamás verdictGlobal /
        // porEvidencia / fuenteDeteccion (la autoría de la lectura vive en tsVision).
        montoDetectado: a.float(),
        precioDetectado: a.float(),
        fechaDetectada: a.string(), // YYYY-MM-DD normalizada en código, no por el modelo
        tsVision: a.string(), // ISO del análisis — también es la llave de idempotencia
        modeloVision: a.string(), // model id de Bedrock que hizo la lectura
        visionDetalle: a.json(), // { ticket:{...}, bomba:{...}, tanqueAntes/Despues:{...} }
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

    // ── Accesorios de la unidad (2026-09-02) ───────────────────────────────
    // Cada CAMBIO de accesorio es un registro (hoy limpiabrisas y batería). El accesorio
    // "vigente" NO se persiste: se deriva del de fecha de compra más reciente, para que no
    // quede obsoleto con el tiempo (mismo criterio que el semáforo de ComplianceDoc).
    // Identidad (tenantId, economicoId, accesorioId) donde accesorioId es:
    //   batería      → "bateria#<numeroSerie normalizado>"  (la serie es la identidad física)
    //   limpiabrisas → "limpiabrisas#<fechaCompra>"          (no tiene serie)
    // Efecto: recapturar la misma batería hace upsert, no duplica.
    // `tipo` es string y no a.enum() a propósito: agregar llantas/frenos después es solo UI.
    Accesorio: a
      .model({
        tenantId: a.string().required(),
        economicoId: a.string().required(),
        accesorioId: a.string().required(),
        tipo: a.string().required(), // 'bateria' | 'limpiabrisas' — validado en cliente
        marca: a.string(),
        numeroSerie: a.string(), // solo batería
        fechaCompra: a.string(), // YYYY-MM-DD
        costo: a.float(),
        nota: a.string(),
        capturadoPor: a.string(), // correo de quien capturó (trazabilidad)
        ultimaActualizacion: a.string(),
        version: a.integer().default(1),
      })
      .identifier(["tenantId", "economicoId", "accesorioId"])
      .authorization((allow) => [
        // Lectura aislada por tenant (incluye viewer). Escritura operativo/admin: la captura
        // la hace Administración de Riesgos, que tiene rol operativo.
        // Deuda técnica: operativo/admin son grupos GLOBALES de escritura (no por-tenant);
        // inocuo con un solo tenant (gpa), revisar si se añade un 2º tenant.
        allow.groupDefinedIn("tenantId").to(["read"]),
        allow.group("operativo").to(["create", "update", "delete"]),
        allow.group("admin"),
      ])
      .secondaryIndexes((index) => [
        index("tenantId").sortKeys(["economicoId"]).name("byTenantAndUnit"),
      ]),

    // ── Configuración del tenant (2026-09-10) — el apagador del esquema híbrido ──
    // El esquema de partidas de Taller (ciclo de firma, Tasks 7-9) se prende para
    // TODA la flota y TODOS los talleres a la vez, sin piloto (decisión 21) — así
    // que el freno de mano no es opcional: si el primer día sale mal, esta fila es
    // la única forma de apagarlo sin volver a desplegar. UNA fila por tenant
    // (identifier = solo tenantId — no hay una segunda dimensión que componer).
    // Cualquier bandera futura del tenant vive aquí, no un modelo nuevo por bandera.
    // `esquemaHibridoActivo` (src/taller/partidas.ts) exige el booleano EXACTO:
    // fila ausente, campo ausente, o cualquier otro tipo, es apagado.
    AppConfig: a
      .model({
        tenantId: a.string().required(),
        /** El apagador (Task 10). Ver esquemaHibridoActivo en src/taller/partidas.ts. */
        tallerHibrido: a.boolean(),
        version: a.integer().default(1),
      })
      .identifier(["tenantId"])
      .authorization((allow) => [
        // Todo el tenant LEE el switch — cada cliente lo necesita para decidir qué
        // pintar. Escribe SOLO admin: un switch que cualquiera puede voltear no es
        // un freno de mano.
        allow.groupDefinedIn("tenantId").to(["read"]),
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

    // Bitacora de auditoria de acciones administrativas. La escriben SOLO Lambdas
    // (el cliente NO puede crear/editar); 'admin' solo LEE. Escritores hoy:
    //   - admin-users: id = ts + sufijo aleatorio, detalleCambios = diff JSON.
    //   - opsgpa-receptor: accion "opsgpa.reasignacion", id = refId de la Anulacion
    //     (idempotente). Deja consultable el par viejo<->sustituto para detectar
    //     anulaciones huerfanas por QUERY en vez de parsear el motivo.
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

    // ── Ciclo de firma del taller — liga del proveedor (Task 11, decisión 20) ──
    // La emisión NO vive en la Function URL pública del portal (taller-portal):
    // esa URL solo la protege la firma del token, así que una ruta de emisión
    // ahí dejaría a cualquiera en internet acuñar una liga para cualquier
    // unidad. Va por mutación de AppSync con permiso de grupo, mismo patrón
    // que adminCreateUser de arriba: AppSync valida el grupo ANTES de invocar
    // la Lambda.
    //
    // R84 — SOLO `admin` y `riesgos`. El spec §7.7 (decisión 20) es literal:
    // "El grupo `viewer` no puede, y `operativo` tampoco por sí solo… la
    // restricción se aplica en la UI Y en el Lambda". El plan de T11 lo
    // contradijo con una nota de deuda técnica; se cierra fail-closed.
    //
    // Task 14 — `riesgos` es la salida que esa misma nota anticipaba ("crear el
    // grupo `riesgos`"), y NO promover a Administración de Riesgos a `admin`
    // (eso le abriría todos los paneles de administración). Es una CREDENCIAL
    // ADICIONAL: la persona conserva su rol `operativo` y suma `riesgos`. La
    // credencial habilita exactamente estas dos mutaciones y nada más. El
    // Lambda repite el chequeo sobre `cognito:groups` (R91,
    // taller-portal/handler.ts) y la UI usa `needs-liga`.
    generarLigaTaller: a
      .mutation()
      .arguments({ unitUid: a.string().required(), fechaEntrada: a.string().required() })
      .returns(a.json())
      .handler(a.handler.function(tallerPortal))
      .authorization((allow) => [allow.groups(["admin", "riesgos"])]),

    /** Sube `ligaVersion` (columna real de Taller) — el único interruptor de
     *  revocación (ver ligaRevocada en taller-portal/validacion.ts): un token
     *  firmado con la versión anterior deja de servir de inmediato, sin
     *  necesidad de guardar el token mismo en la base. SOLO `admin` y `riesgos`
     *  (R84 + Task 14), mismo criterio que la emisión: quien puede abrir la
     *  puerta tiene que poder cerrarla. */
    revocarLigaTaller: a
      .mutation()
      .arguments({ unitUid: a.string().required(), fechaEntrada: a.string().required() })
      .returns(a.json())
      .handler(a.handler.function(tallerPortal))
      .authorization((allow) => [allow.groups(["admin", "riesgos"])]),
  })
  // Acceso IAM para Lambdas del backend. El grant resource es a nivel schema
  // (la API no lo soporta por-modelo). El webhook MoreApp fue retirado 2026-08-20
  // (baja de MoreApp; la ingesta vive en el receptor Ops-GPA).
  .authorization((allow) => [
    // admin-users escribe UserProfile/AuditEvent y lee UserProfile vía IAM.
    allow.resource(adminUsers).to(["query", "mutate"]),
    // opsgpa-receptor: puente Operaciones-GPA (gpa.ops.v1) — upserts idempotentes
    // en CargaCombustible/Unit/Semanal, mismo rol que la ingesta MoreApp.
    allow.resource(opsgpaReceptor).to(["query", "mutate"]),
    // vision-combustible: lee/escribe SOLO campos de visión de ValidacionCarga
    // (el grant es a nivel schema; la restricción por-campo la garantiza su handler).
    allow.resource(visionCombustible).to(["query", "mutate"]),
    // taller-portal: la liga del proveedor escribe TallerPartida y actualiza las
    // columnas de Taller que captura el taller. Mismo rol IAM que las otras ingestas.
    allow.resource(tallerPortal).to(["query", "mutate"]),
  ]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
