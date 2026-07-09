# Plan: Anulación admin de registros (Lote E) — Inspecciones, Semanales y Combustible

> Estado: **EJECUTADO 2026-07-09** — E1 (541d7e4), E2 (f355b34), E3 (324981e) en main.
> Prueba de supervivencia post-deploy: anulación directa en Dynamo + re-backfill de la
> carga → el registro base se reescribió y la anulación quedó intacta (luego se limpió).
> Pendiente de validar con sesión real: que un usuario operativo reciba Unauthorized al
> intentar escribir Anulacion/CargaCombustible/Checklist/Semanal (regla declarativa AppSync).
> Contexto: petición del usuario tras el programa de auditoría 2026-07 (lotes A-D).

## Contexto y decisión

Se requiere que un **Administrador** pueda retirar registros capturados por error para que
no contaminen KPIs, rendimientos, alertas ni reportes — sin perder trazabilidad de auditoría.

**Decisión de arquitectura (analizada 2026-07-09):** anulación lógica reversible (tombstone)
en un **modelo dedicado admin-only**, NUNCA borrado físico. Razones:

- El borrado físico no sobrevive: la ingesta es upsert idempotente (webhook + backfill
  recrean el registro). Una "lista negra" en la Lambda sería una anulación lógica mal ubicada.
- DynamoDB no tiene cascada: borrar dejaría huérfanos (ValidacionCarga, fotos S3, payload crudo).
- Los indicadores se computan en el front en cada hidratación → excluir en el choke point
  correcto recalcula TODO automáticamente (sin agregados materializados que invalidar).
- MoreApp NO permite borrar submissions por API (solo plataforma, irreversible). No se toca
  el origen: es el respaldo de auditoría externo, y la migración a Operaciones-GPA lo volverá
  irrelevante.
- Patrón probado en el repo: overlay separado con la identidad natural del registro
  (ValidacionCarga, CheckDone) — el webhook nunca lo pisa.

**Alcance de módulos:** Inspecciones (Checklist), Semanales (Semanal), Combustible
(CargaCombustible). **Taller y Cumplimiento quedan FUERA**: son expedientes vivos con
edición/borrado propios (openTallerModal/deleteTallerEntry; guardarDoc/deleteComplianceDoc).

---

## Modelo de datos

`amplify/data/resource.ts` — modelo nuevo:

```ts
// Anulación admin de un registro de evento (tombstone lógico reversible).
// El registro base NUNCA se borra ni se modifica; esta fila lo excluye de KPIs/
// cálculos/vistas. Sobrevive re-ingests del webhook (modelo separado, patrón
// ValidacionCarga/CheckDone). Restaurar NO borra la fila: la marca restaurada
// (historial completo de anulaciones y restauraciones para auditoría).
Anulacion: a.model({
  tenantId: a.string().required(),
  // "combustible|<economicoId>|<tipo>|<eventoId>"  (= "combustible|" + loadId)
  // "checklist|<unitUid>|<fecha>"                  (identidad de Checklist)
  // "semanal|<periodoId>|<unitUid>"                (identidad de Semanal)
  refId: a.string().required(),
  modulo: a.string().required(),   // 'combustible' | 'checklist' | 'semanal'
  motivo: a.string().required(),   // obligatorio — validado en cliente y en UI
  anuladoPor: a.string().required(),
  ts: a.string().required(),       // ISO
  // Restauración (soft): si tiene valor, la anulación YA NO aplica pero queda el rastro.
  restauradaPor: a.string(),
  restauradaTs: a.string(),
  version: a.integer().default(1),
})
.identifier(["tenantId", "refId"])
.authorization((allow) => [
  allow.groupDefinedIn("tenantId").to(["read"]), // todos ven qué está anulado (badge/motivo)
  allow.group("admin"),                          // SOLO admin escribe — primer modelo así
])
.secondaryIndexes((index) => [index("tenantId").sortKeys(["modulo"]).name("byTenantAndModulo")]),
```

Reglas semánticas:

- **Anulación activa** = fila existente con `restauradaTs` vacío. Restaurar = update con
  `restauradaPor/restauradaTs` (NO delete → historial bidireccional para el auditor).
- Re-anular tras restaurar = update que limpia `restauradaPor/Ts` y actualiza motivo/anuladoPor/ts.
- La fila de anulación ES la bitácora (quién/cuándo/por qué/qué registro). No se necesita log aparte.
- El webhook NO se toca: la ingesta sigue fluyendo; la exclusión es en lectura.

**Hardening de permisos (mismo lote):** quitar `create/update/delete` del grupo `operativo`
en `CargaCombustible`, `Checklist` y `Semanal` (dejar solo lectura por tenant + IAM del
webhook + admin). Hoy operativo puede borrarlos por API sin que exista UI para ello.
⚠️ GATE antes de aplicar: grep de escrituras cliente a esos 3 modelos fuera de flujos admin
(la carga legacy Excel ya es admin-only; las validaciones van a ValidacionCarga; CheckDone
es aparte). Si aparece un flujo operativo legítimo, se documenta y se excluye del hardening.

## API cliente

- `src/api/client.ts`: `listAnulaciones(tenantId)`, `upsertAnulacion(input)`,
  `restaurarAnulacion(refId, por)` (update con restauradaPor/Ts).
- `src/api/cloudWire.ts`: `window.__anulaciones = { list, anular, restaurar }` inyectando
  tenantId de sesión (patrón `__units`).
- `src/api/auth.ts` ya tiene `isAdmin()`; falta exponerlo al HTML inline:
  `window.esAdmin = () => sessionGroups().includes("admin")` junto a `canWrite` (HTML ~L2438)
  - clase `body.is-admin` en `__onCloudSession` y CSS `body:not(.is-admin) .needs-admin{display:none}`
    (análogo al `.needs-write` de viewer, HTML ~L2468).

## Exclusión por módulo (choke points verificados)

La hidratación baja `Anulacion` junto a los demás modelos (`cloudHydrate.ts` L221-256) y
construye `anuladasActivas: Map<refId, Anulacion>` (filtrando restauradas).

1. **Combustible** — `FuelEntry.anulada?: { motivo, por, ts }` (tag en `buildFuelEntries`,
   4º parámetro opcional, mismo patrón del join de submarca/área). En `wire.ts::scoped()`
   se parten los sets: el flujo normal (KPIs, métricas, anomalías, dashboard, tabla, badge
   nav, export Toka) usa SOLO no-anuladas → **el km/l de la carga siguiente se re-ancla solo**
   y los rankings/gasto se corrigen sin recálculo manual. Ver anuladas: opción "Anuladas (N)"
   en `#fuel-filt-verdict` → la tabla muestra solo anuladas con pill gris "Anulada" +
   motivo/quién/cuándo en la celda Validación (tooltip). Drawer: badge + botón "Restaurar" (admin).
2. **Inspecciones** — filtrar Checklists anulados en `cloudHydrate.ts` ANTES de construir
   `inspections` (L473-481), `latestByUnit`/`__fleetUnits` (L487-492) y `window.units`.
   Con eso `buildKPIs` (HTML L3224), `buildAnalytics` (L3407), `buildAlertsSummary` (L3564),
   `renderTable` (L3811) y `recalcAllRisks` (L4257) se corrigen solos. Si el checklist anulado
   era el último de la unidad, la flota toma el anterior automáticamente.
3. **Semanales** — filtrar al construir `weeklyPeriodos` (`cloudHydrate.ts` L388-418).
   `getSwEntriesInRange` (HTML L7202) y KPIs/badges semanales se corrigen solos.

## UI de anulación (solo admin, `.needs-admin`)

- **Botón "Anular registro"** en el detalle de cada módulo:
  - Combustible: drawer `#fuel-det` (junto a los controles de validación, `src/fuel/renderDetalleCarga.ts` / `wire.ts`).
  - Inspección: header del drawer `#det` en `renderDet()` (HTML L3987-4001, junto a `#dmeta`).
  - Semanal: template del cuerpo en `selSwUnit()` (HTML L7593-7616, junto a photoBtn/tallerBtn).
- **Flujo:** clic → modal `#anular-modal` (uno solo, compartido): muestra identificación del
  registro, **motivo obligatorio** (textarea), y confirmación escribiendo el económico/placa
  (mismo patrón de confirmación fuerte que usa MoreApp). Sin motivo no hay botón activo.
  No existe "eliminación permanente" en ningún flujo → no se necesita doble escalación.
- **Panel "Registros anulados"** (`#anulados-modal`, botón discreto `.needs-admin` en la barra
  de cada módulo): lista de anulaciones del módulo (activas e historial), con registro,
  motivo, quién/cuándo y botón **Restaurar** (confirmación simple). Resuelve visibilidad y
  reversión uniforme en los 3 módulos sin reconstruir las vistas legacy.

## Verificación (gates y pruebas)

- Unitarios (vitest, patrón puro): construcción/parseo de `refId` por módulo; filtro de
  anuladas activas vs restauradas; combustible: carga anulada fuera de metrics/KPIs/anomalías
  y km/l de la siguiente re-anclado; llenado partido con transacción anulada; inspecciones:
  `latestByUnit` salta el anulado; semanal: fuera de KPIs del período.
- Runtime (Playwright + chrome del sistema, patrón de los lotes A-D): anular desde cada
  drawer → desaparece de tabla/KPIs; panel anulados → restaurar → reaparece; usuario
  no-admin no ve botones; llamada directa al API como operativo → rechazada por AppSync.
- Deploy: schema primero (aditivo), luego front; `csp:sync` OBLIGATORIO (se toca JS inline
  de los drawers de Inspecciones/Semanales y helpers de sesión). Push `--no-verify`.
- Post-deploy: anular un registro de prueba real, correr `?backfill=1&count=3` del rango que
  lo contiene y verificar que la anulación SOBREVIVE al re-ingest; restaurarlo.

## Lotes de ejecución

| Lote | Contenido                                                                                                  | Riesgo                               |
| ---- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| E1   | Modelo `Anulacion` + client/cloudWire + `esAdmin()`/`.needs-admin` + hardening permisos (con gate de grep) | Schema aditivo; hardening reversible |
| E2   | Combustible completo (tag, exclusión, filtro "Anuladas", botón drawer, panel anulados)                     | Front-only                           |
| E3   | Inspecciones + Semanales (filtros en hydrate, botones en `#det`/`selSwUnit`, csp:sync)                     | Toca inline JS → csp:sync            |

## Fuera de alcance (explícito)

- Borrado físico en nuestra base (rechazado por re-sync + huérfanos + auditoría).
- Borrar/modificar en MoreApp (sin API de delete; plataforma manual e irreversible; origen
  = respaldo de auditoría; migración futura a Operaciones-GPA).
- Borrado de fotos S3 de registros anulados (evidencia; si el almacenamiento pesara,
  resolver con lifecycle policy, no por registro).
- Taller y Cumplimiento (ciclo de vida propio ya existente).
