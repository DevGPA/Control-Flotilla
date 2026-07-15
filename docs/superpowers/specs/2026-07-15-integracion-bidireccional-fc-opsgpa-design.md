# Integración bidireccional GPA Fleet Command ↔ Operaciones-GPA — Diseño

- **Fecha:** 2026-07-15
- **Autor:** Navares (Tesorería GPA) + Claude Code
- **Estado:** Blueprint aprobado (arquitectura A + conflictos por propiedad-de-campo). Implementación del retorno FC→Ops = futura, coordinada con el dueño del repo Ops.
- **Alcance:** núcleo operativo + próximas entidades (Unit/vehículos, Combustible solicitud+carga, Checklist semanal+mensual, Validación, Anulación, Cumplimiento, Taller). Fuera de alcance detallado: usuarios, catálogos internos de Ops, `AuditEvent`, montacargas y las 27 plantillas dinámicas (contract-ready, se añaden como tipos nuevos cuando exista consumidor en FC).
- **Objetivo:** integración bidireccional robusta, sin duplicidades, con alta integridad, preparada para el crecimiento y para eliminar MoreApp como intermediario.

> **Nota de realidad:** la dirección **Ops → FC ya está VIVA en producción** (puente de eventos `gpa.ops.v1`, PUSH por DynamoDB Streams). Este documento (a) formaliza y documenta ese mapeo campo-a-campo, y (b) diseña a nivel spec la dirección de **retorno FC → Ops** (`gpa.fc.v1`), hoy diferida. No se rediseña lo que ya funciona; se completa el modelo.

---

## 0. Resumen ejecutivo

| Decisión                           | Resolución                                                                                                                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Topología**                      | Dos canales unidireccionales independientes, espejo uno del otro: `gpa.ops.v1` (Ops→FC, vivo) + `gpa.fc.v1` (FC→Ops, blueprint). "Bidireccional" **sin estado mutable compartido**.                      |
| **BDs**                            | Separadas. Nunca se comparte ni consolida tabla. Cero-copia de histórico.                                                                                                                                |
| **Llave de correlación de evento** | `registroId` de Ops ⇒ `eventoId = "OPS-<registroId>"` en FC.                                                                                                                                             |
| **Llave de unidad**                | **Número económico** (`economicoId`) para combustible y montacargas; **placas** para checklist. Se **congela `economico` en Ops** (server-side).                                                         |
| **Source of truth**                | Por **campo**, no por entidad. Ops = captura operativa; FC/Tesorería = veredicto de auditoría selectiva; FC-admin = campos que MoreApp/Ops no tocan (`productoToka`, `area`, `Anulacion`).               |
| **Conflictos**                     | Propiedad-por-campo (la mayoría no pueden ocurrir) → maestro-por-módulo para estados co-editables → `version`/`ts` de desempate → confirmación manual residual. Generaliza la regla _no-pisado_ ya viva. |
| **Modo de sync**                   | Dirigido por eventos (near-real-time) en ambos sentidos + reconciliador programado (backfill/diff) como red de seguridad. Nunca síncrono-bloqueante; batch solo para backfill/reconciliación.            |
| **Anti-eco**                       | Marcador `fuente`/`fuenteDeteccion`: ningún lado re-emite un cambio originado por el otro.                                                                                                               |

---

## 1. Análisis de los dos modelos de datos

### 1.1 Fleet Command (este repo — Amplify Gen 2 / DynamoDB / AppSync)

13 modelos con **claves naturales compuestas** (dedup nativa; el patrón upsert `create → catch ConditionalCheckFailed → update` da idempotencia). Cada entidad = columnas tipadas filtrables + blob `datos`/`resultados` JSON para no migrar schema por cada campo.

| Entidad            | Identificador (PK compuesta)                                | Índices secundarios          | Escritura                      | En alcance   |
| ------------------ | ----------------------------------------------------------- | ---------------------------- | ------------------------------ | ------------ |
| `Unit`             | `(tenantId, placa)`                                         | `byTenantAndSucursal`        | admin + IAM (webhook/receptor) | ✅ catálogo  |
| `CargaCombustible` | `(tenantId, economicoId, tipo, eventoId)`                   | sucursal, economicoId, fecha | admin + IAM                    | ✅           |
| `ValidacionCarga`  | `(tenantId, loadId)` `loadId="economicoId\|tipo\|eventoId"` | —                            | operativo/admin + IAM          | ✅           |
| `Semanal`          | `(tenantId, periodoId, unitUid)`                            | sucursal, unitUid            | admin + IAM                    | ✅           |
| `Checklist`        | `(tenantId, unitUid, fecha)`                                | —                            | admin + IAM                    | ✅ mensual   |
| `Periodo`          | `(tenantId, tipo, fechaInicio)`                             | —                            | operativo/admin + IAM          | ⚙ soporte    |
| `Anulacion`        | `(tenantId, refId)`                                         | `byTenantAndModulo`          | admin                          | ✅ (retorno) |
| `ComplianceDoc`    | `(tenantId, economicoId, docId)`                            | economicoId                  | operativo/admin                | ✅ próximo   |
| `Taller`           | `(tenantId, unitUid, fechaEntrada)`                         | —                            | operativo/admin + IAM          | ✅ (gap)     |
| `Nota`             | `(tenantId, unitUid, timestamp)`                            | —                            | operativo/admin                | ➖ FC-only   |
| `CheckDone`        | `(tenantId, unitUid, itemKey)`                              | —                            | operativo/admin                | ➖ FC-only   |
| `UserProfile`      | `(tenantId, cognitoSub)`                                    | —                            | admin + IAM                    | ➖ fuera     |
| `AuditEvent`       | `(tenantId, id)`                                            | —                            | IAM (admin-users)              | ➖ fuera     |

**Reglas de negocio / campos calculados clave en FC:**

- `tenantId` = grupo Cognito del usuario (multi-tenant; hoy un solo tenant `gpa`).
- Combustible: identidad por `economicoId` (estable ante cambios de placa/errores). `eventoId = meta.serialNumber` (MoreApp) u `OPS-<id>` (Ops) → dedup.
- **km/l**: campo calculado aguas abajo desde `litrosCargados` + `kmCapturado` + `seLlenoTanque` (motor `fuel/`). El invariante que distingue solicitud (estimado) de carga (medición real) es crítico.
- Riesgo de inspección: `analyzeRow`/`risk.ts` derivan `findings`/`tires`/`max` (semanal: solo aceite y radiador votan el estatus — regla A1).
- `ValidacionCarga` separada de `CargaCombustible` a propósito: el ingest escribe los datos, el revisor escribe el veredicto; ningún upsert pisa al otro.
- `Anulacion`: tombstone **lógico reversible** (nunca borrado físico); excluye el registro de KPIs en la hidratación. Restaurar = marca `restauradaPor/Ts` (historial bidireccional).
- `productoToka`, `area`: campos **admin-only** de FC; el webhook/receptor NUNCA los escriben → sobreviven re-ingestas.

### 1.2 Operaciones-GPA (repo `DevGPA/Eco-Admin` — single-table `gpa_operaciones_prod`)

Tabla única (Lambda py3.13 + HTTP API + Cognito propio + S3 evidencias). Campos de negocio **planos** en el top-level del item; evidencias = claves S3 (`SOL|CL|MC|FRM/<uuid32>.<ext>`). GSI `tipo-fecha-idx` para query por tipo.

| Entidad Ops                          | Discriminador                              | Identidad natural                         | En alcance                       |
| ------------------------------------ | ------------------------------------------ | ----------------------------------------- | -------------------------------- |
| `SOL` (solicitud de combustible)     | `tipo_reg="SOL"`, sin `formato`            | `id` (registroId), unidad por `economico` | ✅                               |
| `SOL` (reporte de carga)             | `tipo_reg="SOL"` + **`formato="reporte"`** | `id`, unidad por `economico`              | ✅                               |
| `CL` semanal                         | `tipo_reg="CL"`, `tipo="semanal"`          | `id`, unidad por `placas`                 | ✅                               |
| `CL` mensual                         | `tipo_reg="CL"`, `tipo="mensual"`          | `id`, unidad por `placas`                 | ✅                               |
| `CAT#VEHICLE`                        | catálogo de vehículos                      | `economico`                               | ✅ catálogo                      |
| `MC` montacargas                     | `tipo_reg="MC"`                            | `economico` (series como placas)          | ➖ contract-ready                |
| Documentación (fechas estructuradas) | plantilla dinámica                         | por unidad                                | ✅ próximo (forma por confirmar) |
| usuarios / catálogos internos        | —                                          | —                                         | ➖ fuera                         |

**Envelope canónico `gpa.ops.v1`** (lo emite el publisher; el receptor de FC hace la operación inversa `toOpsRecord` para reusar los adaptadores):

```
{ version, contrato:"gpa.ops.v1", tipo:"SOL"|"CL", subtipo:"semanal"|"mensual"|null,
  evento:"creacion"|"cambio_estado", registroId, folio:"OPS-<id>", fechaISO,
  sucursal, unidad:{vehicleId, economico, placas},
  responsable:{nombre, userId, accountId}, status,
  answers:{...campos de negocio, incluye formato}, evidencias:[{campo,key}],
  firma, bucketOrigen, emitidoEn }
```

**Reglas de negocio / particularidades de Ops:**

- Nivel de tanque como **fracción 0..1** (`tankBefore`/`tankAfter`), no etiqueta de texto.
- Solicitud y reporte comparten `tipo_reg="SOL"`; **el único discriminador fiable es `formato="reporte"`** (sin él se pierde el km/l — es EL invariante del contrato).
- `lleno` llega como `"Si"/"No"` (frontend) o booleano (golden).
- CL: respuestas del checklist anidadas en `answers` (itemId → valor; items de foto = claves S3).
- Mensual: ~40 itemIds; documentación con fechas estructuradas (ventaja sobre MoreApp para Cumplimiento sin OCR).
- `cambio_estado` re-envía la **imagen completa** (re-upsert idempotente; no emite `estadoAnterior`).
- **`economico` es EDITABLE en Ops** hoy → ⚠ es la clave estable de FC (ver §2 y §8).

### 1.3 Similitudes, diferencias, incompatibilidades

| Dimensión            | Fleet Command                            | Operaciones-GPA                | Tratamiento                                                                      |
| -------------------- | ---------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| Modelo físico        | Multi-tabla tipada + blob JSON           | Single-table, campos planos    | Adaptadores puros traducen; envelope aplana/desaplana                            |
| Solicitud vs carga   | Dos `tipo` distintos                     | Ambos `tipo_reg="SOL"`         | Discriminar por `formato="reporte"`                                              |
| Nivel de tanque      | Etiqueta `"50%"`                         | Fracción `0.5`                 | `nivelLabel(frac)` → `"50%"`; crudo se preserva en `datos.tankBefore/After`      |
| Semana               | `periodoId` = ISO week                   | Fecha cruda                    | `isoWeekId(fecha)`                                                               |
| Riesgo inspección    | Derivado (`analyzeRow`)                  | Respuestas crudas              | El motor de FC entiende el vocabulario de Ops SIN traducción (salvo "Sin Nivel") |
| Evidencias           | `photos[{group,col,fname}]` en bucket FC | claves S3 en bucket Ops        | Copia S3→S3, nombre determinístico **lowercase**                                 |
| Validación           | `ValidacionCarga` separada               | `status` en el propio registro | Aprobación en origen → `ValidacionCarga`; veredicto humano FC = retorno          |
| Anulación            | `Anulacion` (tombstone lógico)           | (no existe)                    | **Gap** — objetivo del retorno `gpa.fc.v1`                                       |
| Taller/mantenimiento | `Taller`                                 | (no existe hoy)                | **Gap** — sin fuente Ops                                                         |
| Cumplimiento         | `ComplianceDoc` (datos crudos)           | Documentación con fechas       | Forward futuro; forma exacta por confirmar                                       |
| Multi-tenant         | `tenantId` (grupo Cognito)               | Cognito propio, sin tenant     | Receptor fija `tenantId="gpa"`                                                   |

---

## 2. Identificadores

**Decisión: dos llaves, cada una para su nivel.**

1. **Llave de unidad (correlación de entidad):** **número económico** (`economico` ↔ `economicoId`) para combustible y montacargas; **placas** para checklist/semanal.
   - Por qué económico y no placas/VIN: las placas cambian (re-emplacado, errores de captura); el VIN suele faltar. El económico es el identificador operativo estable que ya usa Tesorería y el layout Toka.
   - Por qué checklist por placas: es la identidad que el flujo de inspección de FC ya usa (`Unit.placa` como `unitUid`); económico se guarda como atributo.
   - Montacargas SIEMPRE por económico (R01-R06 traen números de serie en el campo placas).
2. **Llave de evento (correlación de registro):** `registroId` de Ops ⇒ `eventoId = "OPS-<registroId>"` en FC.
   - Por qué el `registroId` de Ops (un id interno estable) y no un UUID nuevo ni las placas: es único, inmutable y ya lo genera Ops; el prefijo `OPS-` evita colisión con los folios `serialNumber` de MoreApp durante la coexistencia.
   - `loadId = "economicoId|tipo|eventoId"` liga `ValidacionCarga`/`Anulacion` a su carga sin duplicar la carga.

**Alternativas evaluadas y descartadas como llave primaria de correlación:** UUID nuevo por FC (rompe idempotencia con re-entregas), placas (mutables), VIN (incompleto), folio MoreApp (desaparece al cutover), id de MoreApp (se decomisa).

**Acción dura requerida:** **congelar `economico` en Ops** (server-side, no editable) e invertir la política a `sucursal` editable-admin. Sin esto, un cambio de económico en Ops crea un registro huérfano en FC (ver §8).

---

## 3. Modelo de gobierno — Source of Truth por entidad y dirección

| Entidad / campo                                                                      | Maestro (SoT)                                    | Modifica     | Solo lee                       | Momento de sync                   | Conflicto                    |
| ------------------------------------------------------------------------------------ | ------------------------------------------------ | ------------ | ------------------------------ | --------------------------------- | ---------------------------- |
| Captura combustible (km, litros, monto, nivel, fotos, responsable)                   | **Ops** (post-cutover) / MoreApp hoy             | Ops          | FC                             | evento `creacion`/`cambio_estado` | maestro (Ops)                |
| Aprobación en origen (`status` Aprobada/Rechazada)                                   | **Ops**                                          | Ops          | FC (siembra `ValidacionCarga`) | `cambio_estado`                   | maestro (Ops)                |
| **Veredicto final de tesorería** (`ValidacionCarga` con `fuenteDeteccion≠"ops-gpa"`) | **FC**                                           | FC/Tesorería | Ops (retorno)                  | al confirmar en FC                | **FC (no-pisado)**           |
| **Anulación** (`Anulacion`)                                                          | **FC**                                           | FC-admin     | Ops (retorno)                  | al anular/restaurar en FC         | FC                           |
| Catálogo unidad — `placa/marca/sucursal/economico`                                   | **Ops CAT#VEHICLE** (post-cutover) / MoreApp hoy | Ops          | FC                             | evento catálogo                   | maestro (Ops)                |
| Catálogo unidad — `productoToka`, `area`                                             | **FC-admin**                                     | FC-admin     | —                              | —                                 | FC (Ops/webhook no lo tocan) |
| Inspección semanal/mensual + riesgo derivado                                         | **Ops** (captura)                                | Ops          | FC (deriva riesgo)             | evento `creacion`                 | maestro (Ops)                |
| Cumplimiento (`ComplianceDoc`)                                                       | **Ops** (documentación con fechas) — futuro      | Ops          | FC                             | forward futuro                    | maestro (Ops)                |
| Taller / mantenimiento                                                               | **FC** (no hay fuente Ops)                       | FC           | —                              | —                                 | FC-only                      |

Principio rector: **cada campo tiene exactamente un maestro; el otro sistema lo trata como solo-lectura para ese campo.** Así la mayoría de conflictos son estructuralmente imposibles.

---

## 4. Matriz de mapeo de campos

Convenciones: **Dir.** `→` = Ops→FC (vivo) · `←` = FC→Ops (retorno, blueprint) · `⇄` = ambos con propiedad por campo. **Ob.** = obligatorio. Transformaciones referencian funciones reales (`src/opsgpa/*`, `src/fuel/parse`).

### 4.1 `SOL` (solicitud) → `CargaCombustible` (tipo=solicitud) — `mapSolicitud`

| Campo Ops                                                           | Tipo       | Campo FC         | Tipo  | Transformación                                         | Ob.    | Dir. | Regla / Observación                       |
| ------------------------------------------------------------------- | ---------- | ---------------- | ----- | ------------------------------------------------------ | ------ | ---- | ----------------------------------------- |
| `economico`                                                         | str        | `economicoId`    | str   | `String().trim()`                                      | **Sí** | →    | Sin económico ⇒ error "no mapeable" (422) |
| `id`                                                                | str        | `eventoId`       | str   | `"OPS-"+id`                                            | **Sí** | →    | Llave de evento                           |
| —                                                                   | —          | `tipo`           | str   | constante `"solicitud"`                                | **Sí** | →    | Discriminador FC                          |
| `placas`                                                            | str        | `placa`          | str   | `String()`                                             | No     | →    | Atributo, no llave (combustible)          |
| `sucursal`                                                          | str        | `sucursal`       | str   | `normSucursal()`                                       | **Sí** | →    | Crudo en `datos.sucursalRaw`              |
| `fecha` (ISO)                                                       | str        | `fecha`          | str   | `split(/[ T]/)[0]` (YYYY-MM-DD)                        | **Sí** | →    | `fechaHora` conserva el ISO completo      |
| `tanque`                                                            | num        | `tanque`         | str   | `String()`                                             | No     | →    |                                           |
| `km`                                                                | num\|str   | `kmCapturado`    | int   | `parseKm()`                                            | No     | →    | Insumo km/l                               |
| `tankBefore`                                                        | float 0..1 | `nivelAntes`     | str   | `nivelLabel()` → `"NN%"`                               | No     | →    | Crudo en `datos.tankBefore`               |
| `tankAfter`                                                         | float 0..1 | `nivelDeseado`   | str   | `nivelLabel()`                                         | No     | →    | Crudo en `datos.tankAfter`                |
| `monto`                                                             | num        | `montoEstimado`  | float | `parseNum()`                                           | No     | →    | Estimado (solicitud)                      |
| `litros`                                                            | num        | `maxLitros`      | float | `parseNum()`                                           | No     | →    | Máx estimado                              |
| `responsable`                                                       | str        | `responsable`    | str   | `.trim()`                                              | No     | →    |                                           |
| `producto`,`combustible`,`precio`,`obs`,`mail`,`necesidad`,`status` | varios     | `datos.*`        | json  | serializado + `fuente:"ops-gpa"`, `opsId`, `opsStatus` | —      | →    | Trazabilidad                              |
| `photo`,`firma`                                                     | key S3     | `datos.photos[]` | json  | copia S3→S3 + `nombreEvidencia` (lowercase)            | No     | →    | `{group,col,fname}`                       |

### 4.2 `SOL` (formato=reporte) → `CargaCombustible` (tipo=carga) — `mapCarga`

Igual que 4.1 salvo la medición **real** (insumos del motor km/l):

| Campo Ops                                        | Tipo            | Campo FC                 | Tipo  | Transformación                   | Ob.    | Dir. | Regla / Observación                             |
| ------------------------------------------------ | --------------- | ------------------------ | ----- | -------------------------------- | ------ | ---- | ----------------------------------------------- |
| `formato="reporte"`                              | str             | (discrimina)             | —     | `esReporteDeCarga()`             | **Sí** | →    | **Invariante**: sin él se pierde el km/l fiable |
| —                                                | —               | `tipo`                   | str   | constante `"carga"`              | **Sí** | →    |                                                 |
| `litros`                                         | num             | `litrosCargados`         | float | `parseNum()`                     | **Sí** | →    | Insumo km/l                                     |
| `precioLitro`                                    | num             | `precioPorLitro`         | float | `parseNum()`                     | No     | →    |                                                 |
| `monto`                                          | num             | `montoTotal`             | float | `parseNum()`                     | No     | →    | Monto real (⚠ dispersión Toka)                  |
| `lleno`                                          | bool\|"Si"/"No" | `seLlenoTanque`          | str   | bool→`"Si"/"No"`; string directo | No     | →    | El motor km/l compara `=== "Si"`                |
| `km`                                             | num\|str        | `kmCapturado`            | int   | `parseKm()`                      | No     | →    |                                                 |
| `areaResponsable`                                | str             | `datos.areaResponsable`  | json  | —                                | No     | →    | Gasto por área                                  |
| `ubicacion{lat,lng}`                             | obj             | `datos.ubicacionDeCarga` | json  | —                                | No     | →    | GPS de la carga                                 |
| `fotoAntes/Despues/Bomba/Ticket/Persona`,`firma` | key S3          | `datos.photos[]`         | json  | copia S3→S3 (5 fotos + firma)    | No     | →    |                                                 |

### 4.3 `CL` semanal → `Unit` + `Semanal` — `mapSemanal`

| Campo Ops                                       | Tipo     | Campo FC                           | Tipo | Transformación                                                   | Ob.    | Dir. | Regla / Observación                              |
| ----------------------------------------------- | -------- | ---------------------------------- | ---- | ---------------------------------------------------------------- | ------ | ---- | ------------------------------------------------ |
| `placas`                                        | str      | `Unit.placa` / `Semanal.unitUid`   | str  | `.trim()`                                                        | **Sí** | →    | Sin placas ⇒ error (422)                         |
| `economico`                                     | str      | `Unit.economicoId`                 | str  | omite si `==placa`                                               | No     | →    |                                                  |
| `subMarca`                                      | str      | `Unit.marca`                       | str  | —                                                                | No     | →    |                                                  |
| `sucursal`                                      | str      | `Unit.sucursal`/`Semanal.sucursal` | str  | —                                                                | No     | →    |                                                  |
| `fecha`                                         | str      | `Semanal.periodoId`                | str  | `isoWeekId()` → `YYYY-Www`                                       | **Sí** | →    | Llave de período                                 |
| `answers.aceite/radiador/carroceria/llanta_ref` | str      | `datos.*Risk` + `risk`             | json | `normFluidRisk/normBodyRisk/normTireRisk` + `calcEstatusSemanal` | —      | →    | **Solo aceite y radiador votan el estatus (A1)** |
| `km`                                            | num\|str | `datos.km`                         | json | `String()`                                                       | No     | →    |                                                  |
| `fotoKm` + `answers.*` foto + `firma`           | key S3   | `datos.photos[]`                   | json | copia S3→S3                                                      | No     | →    |                                                  |
| `id`                                            | str      | `datos.moreappId`                  | json | `"OPS-"+id`                                                      | —      | →    | Folio visible                                    |

### 4.4 `CL` mensual → `Unit` + `Checklist` — `mapMensual`

Construye una fila con los **nombres de columna del Excel MoreApp** (contrato de `analyzeRow`) desde ~40 itemIds (`MENSUAL_COL`), corre `analyzeRow`, y upsertea. Extracto representativo:

| itemId Ops                                                                        | Columna analyzeRow (FC)    | Vocabulario                                   | Transformación                                            |
| --------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| `taco_pd … taco_ref`                                                              | `Nivel TACO de llanta …`   | 1-10 (mm)                                     | directo                                                   |
| `pt_int`,`ct_int`,`refacc`                                                        | `¿Cuenta con …?`           | Si/No                                         | gating de internas/refacción                              |
| `carroceria`,`luces_d`,`espejos`,`cristales`,`molduras`,`tapon`                   | exterior/luces             | Si/No                                         | `isBinFail` directo                                       |
| `claxon`,`limpiaparab`,`tacometro`,`retrovisor`,`cinturones`,`asientos`,`tapetes` | interior                   | Si/No                                         | directo                                                   |
| `gato`,`llave_cruz`,`triangulo`,`cables`                                          | herramientas               | Si/No                                         | directo                                                   |
| `tarj_circ`,`poliza`,`refrendo`,`verif`,`licencia`,`calcomonia`                   | documentación              | DOC_OPTS ("Si vigente"/"Vencido"/"No cuenta") | directo (**feed a Cumplimiento**)                         |
| `liq_frenos`,`aceite_motor`,`radiador`,`aceite_dir`                               | fluidos (cofre)            | NIVEL_OPTS                                    | **"Sin Nivel"→"Sin nivel (bajo)"** (única traducción)     |
| `km_sig_serv`,`fecha_sig_serv`                                                    | mantenimiento predictivo   | fecha/num                                     | directo → `datos.nextSvc`/`kmNextSvc`                     |
| `f_*` (34 fotos)                                                                  | `MENSUAL_FOTO_LBL`         | key S3                                        | copia S3→S3, agrupadas por sección                        |
| `golpes` (damage_list)                                                            | "Foto daño"                | array                                         | `fotosDeGolpes()`                                         |
| —                                                                                 | `Checklist.tipoInspeccion` | —                                             | constante `"mensual"`                                     |
| —                                                                                 | `Checklist.resultados`     | json                                          | `{findings,tires,max,risk,minT,validationErrors,obs,...}` |

> Items sin equivalente en el motor (`diablito`, `extinguidor`, `liq_limpiaparab`) se **omiten del riesgo a propósito**.

### 4.5 Aprobación en origen → `ValidacionCarga` — `mapValidacion` (⇄)

| Campo Ops                                            | Campo FC                       | Transformación          | Dir.  | Regla                                   |
| ---------------------------------------------------- | ------------------------------ | ----------------------- | ----- | --------------------------------------- |
| `status` "Aproba\*"                                  | `verdictGlobal="ok"`           | `startsWith("aproba")`  | →     | Aprobación en origen                    |
| `status` "Rechaza\*"                                 | `verdictGlobal="discrepancia"` | `startsWith("rechaza")` | →     | + nota                                  |
| `status` "Pendiente"                                 | (no escribe)                   | `null`                  | →     | Queda pendiente hasta `cambio_estado`   |
| `autorizadoPor`                                      | `revisadoPor`                  | `"<quien> · ops-gpa"`   | →     |                                         |
| —                                                    | `fuenteDeteccion="ops-gpa"`    | constante               | →     | **Llave del no-pisado**                 |
| **Veredicto humano FC** (`fuenteDeteccion="manual"`) | → Ops `veredictoTesoreria`     | `gpa.fc.v1` (§5.2)      | **←** | **Retorno**: FC tiene la última palabra |

### 4.6 Retorno FC→Ops — `Anulacion` (←, blueprint)

| Campo FC                     | Campo Ops (nuevo, namespaced) | Transformación                | Regla                         |
| ---------------------------- | ----------------------------- | ----------------------------- | ----------------------------- |
| `Anulacion.refId`            | (resuelve `registroId`)       | strip prefijo módulo + `OPS-` | Localiza el SOL/CL            |
| `modulo`                     | —                             | ruteo                         | combustible/checklist/semanal |
| `motivo`                     | `anuladoMotivo`               | —                             |                               |
| `anuladoPor`                 | `anuladoPor`                  | `"<quien> · fleet-command"`   | Anti-eco                      |
| `ts`                         | `anuladoTs`                   | ISO                           |                               |
| `restauradaPor/Ts` presentes | `anulado=false`               | —                             | Restauración suave propaga    |

### 4.7 Cumplimiento (`ComplianceDoc`) — forward futuro

Ops mensual ya trae el **estado** de documentos (DOC_OPTS). Para poblar `ComplianceDoc` con `fechaVencimiento` real se requiere que Ops exponga **fechas estructuradas** (su ventaja declarada "sin OCR"); la forma exacta del registro/plantilla de documentación de Ops **está por confirmar** con el dueño del repo. Mapeo objetivo: `tipoDoc` (verificacion/tenencia/refrendo/seguro/tarjetaCirculacion/licencia) ← plantilla Ops; `fechaVencimiento/Emision`, `referencia`, `monto` ← campos de la plantilla; `fuente="ops-gpa"`. **No inventar campos** hasta ver el contrato real.

### 4.8 Gaps sin fuente

- **`Taller` (mantenimiento):** FC-only; Ops no tiene módulo de mantenimiento hoy. Si Ops añade uno, se incorpora como **tipo nuevo del contrato** (`tipo_reg` nuevo) con su adaptador.
- **`Nota`, `CheckDone`, `Periodo` (creación), `UserProfile`, `AuditEvent`:** FC-only / fuera de alcance.

---

## 5. Arquitectura de sincronización bidireccional

### 5.1 Diagrama de flujo

```
        ┌──────────────────────── OPERACIONES-GPA (Eco-Admin) ────────────────────────┐
        │  DynamoDB gpa_operaciones_prod (SOL/CL/CAT/MC)   S3 evidencias (SOL|CL/..)  │
        │        │ Streams NEW_AND_OLD_IMAGES                     │                     │
        │        ▼  (filtros SOL#/CL#, bisect, 10 retry)          │                     │
        │  Lambda publisher  gpa-ops-bridge-prod                  │                     │
        │        │ construir_evento → gpa.ops.v1                  │                     │
        │        │ POST firmado (X-GPA-Timestamp/Firma HMAC)      │                     │
        └────────┼───────────────────────────────────────────────┼─────────────────────┘
                 │  (DLQ 14d + alarma silencio EMF)               │ lectura S3 (GetObject)
   ══════════════▼═══════════════════════════════════════════════▼════════════ gpa.ops.v1 (VIVO)
        ┌────────▼───────────────────────────────────────────────▼─────────────────────┐
        │  Lambda receptor FC (Function URL dedicada)                                    │
        │   verificar firma → validar contrato → archivar crudo (ops-capture/)          │
        │   → copiar evidencias S3→S3 (idempotente, lowercase) → toOpsRecord            │
        │   → adaptadores puros (mapSolicitud/mapCarga/mapChecklist/mapValidacion)      │
        │   → upsert idempotente (create→update) eventoId="OPS-<id>" fuente="ops-gpa"   │
        │          │                                                                     │
        │          ▼   CargaCombustible · ValidacionCarga · Unit · Semanal · Checklist  │
        │   ┌──────────────────────── GPA FLEET COMMAND ────────────────────────────┐   │
        │   │  admin/tesorería: veredicto humano (ValidacionCarga fuente=manual),    │   │
        │   │                    Anulacion (tombstone)                               │   │
        │   │        │ Streams sobre ValidacionCarga/Anulacion                       │   │
        │   │        ▼  publisher FC → gpa.fc.v1 → POST firmado (anti-eco por fuente)│   │
        │   └────────┼───────────────────────────────────────────────────────────────┘  │
        └────────────┼──────────────────────────────────────────────────────────────────┘
   ══════════════════▼══════════════════════════════════════════════ gpa.fc.v1 (BLUEPRINT)
        ┌────────────▼──────────────────────────────────────────────────────────────────┐
        │  Lambda receptor OPS (NUEVA — la construye el dueño de Eco-Admin)              │
        │   verificar firma → validar → escribe SOLO campos namespaced propios de FC:   │
        │   veredictoTesoreria / veredictoNota / anulado / anuladoMotivo …              │
        │   (nunca toca campos de captura; Ops los trata como read-only-from-FC)        │
        └───────────────────────────────────────────────────────────────────────────────┘

   Red de seguridad (ambas direcciones): reconciliador programado (backfill/diff) idempotente.
```

### 5.2 Contrato de retorno `gpa.fc.v1` (nuevo — espejo de `gpa.ops.v1`)

```
{ version:1, contrato:"gpa.fc.v1", tipo:"VALIDACION"|"ANULACION",
  evento:"upsert", registroId:"<id de Ops>", folio:"OPS-<id>", fechaISO,
  origen:"fleet-command",
  payload:{
    // VALIDACION:  veredicto, nota, revisadoPor        (solo si fuenteDeteccion="manual")
    // ANULACION:   anulado:true|false, motivo, por      (false = restauración suave)
  } }
```

- **Firma:** idéntico esquema HMAC (`X-GPA-Timestamp` + `X-GPA-Firma` = `HMAC_SHA256(secret, ts.body)` hex, anti-replay ±300s, fail-closed). **Secreto distinto** al del forward.
- **Anti-eco:** FC **solo emite** validaciones con `fuenteDeteccion="manual"` (nunca las que sembró la aprobación de Ops) y anulaciones nacidas en FC. Ops escribe esos campos en un **espacio de nombres propio de FC** que jamás re-emite por `gpa.ops.v1`. → no hay ping-pong.
- **Idempotencia:** el receptor de Ops hace upsert por `registroId` + campo; re-entrega = no-op.
- **Golden compartidos:** `Operaciones-GPA/tests/golden/fc/` ≡ `tests/fcops-golden/` en FC; CI de ambos lados truena si el contrato diverge (misma disciplina que hoy).

---

## 6. Reglas de sincronización

| Operación                | Ops→FC                                                                | FC→Ops                                                         | Regla                                                             |
| ------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Alta**                 | `evento:"creacion"` → upsert (create→update)                          | `gpa.fc.v1` solo para veredicto/anulación (no alta de captura) | Idempotente por llave natural                                     |
| **Modificación**         | `evento:"cambio_estado"` re-envía imagen completa → re-upsert         | upsert campo namespaced                                        | Nunca `estadoAnterior`; imagen completa                           |
| **Eliminación lógica**   | (Ops no anula hoy)                                                    | `ANULACION anulado:true` → Ops marca `anulado`                 | Tombstone; excluye de KPIs                                        |
| **Restauración**         | —                                                                     | `ANULACION anulado:false` (`restauradaPor`)                    | Propaga la reversión                                              |
| **Eliminación física**   | **PROHIBIDA** en ambos lados                                          | —                                                              | Nunca borrado físico; export a Glacier antes de decomiso          |
| **Cambio de estatus**    | `status` → `ValidacionCarga` (aprobación en origen)                   | veredicto humano FC → Ops (no-pisado)                          | Maestro-por-módulo                                                |
| **Fotos / evidencias**   | copia S3→S3 idempotente (HeadObject), `nombreEvidencia` **lowercase** | no se devuelven evidencias                                     | S3 case-sensitive; fnames siempre minúsculas                      |
| **Firma manuscrita**     | key S3 aparte de `answers` → `datos.photos`                           | —                                                              |                                                                   |
| **Vehículos (catálogo)** | `Unit` upsert desde checklist/CAT; `productoToka`/`area` intactos     | —                                                              | Ops = catálogo maestro post-cutover; FC-admin conserva sus campos |
| **Solicitudes**          | `SOL` → `CargaCombustible` tipo=solicitud                             | —                                                              |                                                                   |
| **Cargas**               | `SOL formato=reporte` → tipo=carga                                    | —                                                              | Discriminador `formato`                                           |
| **Inspecciones**         | `CL` semanal/mensual → Semanal/Checklist + Unit                       | —                                                              | Riesgo derivado por FC                                            |
| **Mantenimientos**       | (sin fuente)                                                          | —                                                              | Gap                                                               |
| **Usuarios**             | fuera de alcance                                                      | fuera de alcance                                               | Cognito separado por sistema                                      |
| **Catálogos**            | reconciliación (49/50 limpia); correcciones parqueadas                | —                                                              | Ver §8                                                            |

---

## 7. Resolución de conflictos

**Estrategia adoptada: propiedad-por-campo + híbrido** (justificación: es la que respeta "BDs separadas" y ya está probada en producción vía la regla _no-pisado_).

1. **Propiedad por campo (defensa primaria).** Cada campo tiene un único maestro (§3). El otro sistema lo trata como solo-lectura → la inmensa mayoría de "conflictos" no pueden materializarse. Ejemplo: FC nunca escribe `km`/`litros` en Ops; Ops nunca escribe `veredictoTesoreria`/`anulado`.
2. **Maestro-por-módulo (estados co-editables).** El único estado genuinamente compartido es el ciclo de revisión de una carga: **Ops** posee la aprobación-en-origen; **FC/Tesorería** posee el veredicto final de auditoría selectiva. Regla _no-pisado_: si existe un veredicto con `fuenteDeteccion≠"ops-gpa"`, el puente de Ops **jamás lo sobreescribe**.
3. **`version`/`ts` como desempate.** Cada entidad FC ya lleva `version:int`; los eventos llevan `fechaISO`/`ts`. Concurrencia optimista; ante dos escrituras del **mismo** maestro, gana la de `ts` mayor.
4. **Confirmación manual (residual).** Caso irreconciliable (p.ej. FC anula una carga que Ops re-aprueba con datos nuevos) → se encola para un admin en una vista de conflictos, no se resuelve en automático.

**Por qué no "última modificación gana" puro:** una re-captura operativa en Ops podría pisar el veredicto humano de Tesorería — inaceptable. **Por qué no "maestro absoluto por entidad":** obligaría a duplicar campos que hoy conviven sanamente en la misma carga (captura de Ops + veredicto de FC).

---

## 8. Calidad de datos y homologación

| Problema                          | Diagnóstico                                                                                                                                                                                    | Estrategia                                                                                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Doble captura MoreApp↔OPS**     | Durante la coexistencia, la misma carga entra por MoreApp _y_ por OPS (mismo eco+día) → el layout Toka **suma ambas** (riesgo de dispersar doble; eco 32 el 13-jul: $2,423 + $2,514 = $4,937). | Regla anti-duplicado por `(economico, día, tipo, ~monto)`: preferir la captura **OPS** (validada en origen), auto-anular/suprimir la gemela MoreApp; o encolar para admin. **Bloqueante antes de dispersar.** |
| **Casi-duplicados dentro de Ops** | Misma carga capturada 2× con ~1 min de diferencia (eco 52: $319×2; eco 49: $176×2).                                                                                                            | Ventana de near-dedup por `(economico, día, monto)` con umbral de minutos; marca sospechoso.                                                                                                                  |
| **`economico` editable en Ops**   | ⚠ es la clave estable de FC; editarlo huérfana el registro FC.                                                                                                                                 | **Congelar `economico` server-side**; invertir a `sucursal` editable-admin.                                                                                                                                   |
| **Nulos / faltantes**             | Sin económico ⇒ combustible no mapeable (422); sin placas ⇒ checklist no mapeable (422).                                                                                                       | Rechazo explícito visible en DLQ (nunca silencioso); reconciliación de económicos no catalogados.                                                                                                             |
| **Diferencias de formato**        | Nivel fracción vs etiqueta; fecha ISO vs YYYY-MM-DD; `lleno` bool vs "Si/No"; grafía Toka (EASYGAS vs TOKA).                                                                                   | Normalizadores puros (`nivelLabel`, `parseKm`, `normSucursal`, `normalizeTokaProducto` colapsa por tipo).                                                                                                     |
| **Catálogos distintos**           | Reconciliación 2026-07-09: **49/50 limpia**, 0 conflictos de llaves. Errores de `productoToka` estaban en **FC**, no en Ops.                                                                   | Correcciones admin parqueadas (eco 92 alta; FC 10→MAGNA, 89/90/92→DIESEL); Ops = catálogo maestro post-cutover.                                                                                               |
| **Registros huérfanos**           | Captura con económico/placa ausente en catálogo.                                                                                                                                               | Semanal/mensual **crean** `Unit` desde la inspección; combustible exige económico → cola de económicos no resueltos.                                                                                          |
| **Datos históricos**              | Cero-copia; MoreApp sigue en paralelo.                                                                                                                                                         | Export integral de MoreApp a **Glacier ANTES** de cancelar; nunca borrado físico.                                                                                                                             |

---

## 9. Rendimiento y modo de sincronización

| Factor              | Valor                                                                                        | Implicación                                                   |
| ------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Volumen             | ~1k cargas/mes + puñado de checklists; retorno aún menor                                     | Bajo; no requiere batching salvo backfill                     |
| Frecuencia          | por evento (segundos tras la captura)                                                        | Near-real-time nativo con Streams                             |
| Recursos            | Lambda + Streams + S3 copy; pantalla en vivo por AppSync (debounce 2.5s, poll 4min respaldo) | Costo marginal por evento                                     |
| Tiempo de respuesta | POST firmado + copia de evidencias en **paralelo** (F3-7)                                    | Latencia = evidencia más lenta, no la suma                    |
| Escalabilidad       | GSI `byTenantAndFecha`; front hidrata solo ventana visible (3 meses)                         | La tabla que crece (combustible) ya está indexada por ventana |

**Decisión: dirigido por eventos (near-real-time) en ambos sentidos + reconciliador programado como red de seguridad.** No síncrono-bloqueante (perdería DLQ/retry). Batch/colas **solo** para backfill inicial y barridos de reconciliación. On-demand disponible para el piloto en sombra.

---

## 10. Auditoría

Requisito del goal: registrar fecha/hora, usuario, sistema origen/destino, acción, campo, valor anterior/nuevo, resultado y errores. Estado actual + propuesta:

| Necesidad                          | Hoy                                        | Propuesta                                                                                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Evento crudo re-procesable         | `ops-capture/<ts>-<folio>.json` en S3      | mantener; añadir `fc-capture/` para `gpa.fc.v1`                                                                                                                                                                                      |
| Fallos                             | DLQ 14d + alarma silencio EMF + CloudWatch | mantener                                                                                                                                                                                                                             |
| **Registro estructurado por sync** | disperso en logs                           | **`SyncLog`** (modelo FC o EMF estructurado): `{ts, direccion, contrato+version, folio/registroId, entidadDestino, accion(create/update/skip-nopisado/reject), resultado(200/422/500), diff:{campo:{antes,despues}}, actor, error?}` |
| Antes/después por campo            | no                                         | el upsert ya distingue create vs update (ConditionalCheckFailed) → capturar diff compacto de campos cambiados                                                                                                                        |
| Usuario                            | `responsable`/`revisadoPor`/`anuladoPor`   | propagar `origen`/`fuente` en cada log                                                                                                                                                                                               |

Se prefiere `SyncLog` ligero (append-only) frente a un sistema de auditoría pesado: cubre el requisito sin infra nueva.

---

## 11. Validaciones (pipeline previo a escribir)

Orden de guardas (fail-closed; la mayoría ya viven en el receptor):

1. **Firma:** HMAC + anti-replay ±300s sobre cuerpo crudo → 401.
2. **Contrato:** `validarEvento` (contrato conocido, evento válido, tipo implementado, `registroId`/`folio` OK, `answers` presente, **unidad con al menos una llave**) → 422.
3. **Tipos y formato:** fecha ISO parseable, montos numéricos (`parseNum`), km (`parseKm`), enums de estatus/tipo tolerantes a variantes de género.
4. **Campos obligatorios:** económico (combustible) / placas (checklist) → 422 "no mapeable".
5. **Integridad referencial / existencia:** económico/placa resolubles contra catálogo; validación FC→Ops localiza el `registroId` destino.
6. **Reglas de negocio:** discriminador `formato="reporte"`; montacargas por económico; no-pisado de veredicto humano; anti-eco por `fuente`.
7. **Catálogos válidos:** producto Toka colapsado por tipo (`normalizeTokaProducto`); sucursal normalizada.

Errores de **negocio** → 422 (reintentable, visible en DLQ); errores de **infraestructura** → 500.

---

## 12. Riesgos identificados

| #   | Riesgo                                                          | Prob.            | Impacto  | Mitigación                                                                 |
| --- | --------------------------------------------------------------- | ---------------- | -------- | -------------------------------------------------------------------------- |
| R1  | **Doble dispersión Toka** (doble captura MoreApp↔OPS)           | Alta (observado) | Alto ($) | Regla anti-duplicado bloqueante antes de dispersar (§8)                    |
| R2  | `economico` editado en Ops huérfana registros FC                | Media            | Alto     | Congelar `economico` server-side                                           |
| R3  | Dependencia organizacional: `Eminav-117` sin write en Eco-Admin | Alta             | Medio    | El retorno lo construye el dueño de Ops; contrato+golden entregados listos |
| R4  | Ping-pong FC↔Ops                                                | Baja             | Alto     | Anti-eco por `fuente`/`fuenteDeteccion` + campos namespaced                |
| R5  | Divergencia de contrato entre repos                             | Media            | Alto     | Golden compartidos + CI que truena en ambos lados                          |
| R6  | Reporte de carga real aún no validado contra el adaptador       | Media            | Medio    | Re-validar `mapCarga` contra el primer reporte real; golden pendiente      |
| R7  | Cumplimiento sin forma confirmada en Ops                        | Media            | Medio    | No implementar hasta ver el contrato de documentación de Ops               |
| R8  | Cancelar MoreApp sin export verificado                          | Baja             | Crítico  | Export a Glacier verificado ANTES de decomiso; nunca borrado físico        |
| R9  | Token legacy webhook MoreApp hardcodeado                        | Media            | Medio    | Rotar (housekeeping de seguridad)                                          |

---

## 13. Recomendaciones de arquitectura y simplificación

**Arquitectura:**

1. Mantener **dos canales unidireccionales simétricos** (no fusionar en un bus). Simetría = una sola mentalidad para operar/depurar.
2. **Contrato versionado + golden compartidos** como frontera dura entre repos (ya probado).
3. **Idempotencia por llave natural + upsert create→update** en ambos receptores.
4. **Reconciliador programado** en ambas direcciones como red de seguridad (ya existe backfill para el forward; replicar para el retorno).
5. **Anti-eco explícito** (`fuente`) y **campos namespaced de FC en Ops** para el retorno.

**Oportunidades de simplificación del modelo:**

- **Unificar la resolución de identidad** en un helper compartido (económico vs placas por módulo) para que forward y retorno usen la misma lógica.
- **Consolidar el marcador de origen**: hoy conviven `fuente:"ops-gpa"` (en `datos`) y `fuenteDeteccion:"ops-gpa"` (en `ValidacionCarga`). Documentar como **un solo concepto** ("sistema originador") con dos ubicaciones por razones de esquema.
- **`ValidacionCarga` como patrón general de "veredicto externo"**: su diseño (registro separado + no-pisado) es el molde para cualquier futuro estado co-editable → reutilizar, no reinventar.
- **Retirar GSIs redundantes** con la PK compuesta (ya hecho en parte) para bajar costo de escritura.
- **Tras el cutover:** eliminar la ruta de ingesta de MoreApp y el token legacy → menos superficie de código y seguridad.

---

## 14. Roadmap de implementación (para el retorno; el forward ya está vivo)

1. **Fase R0 — Documentación (este spec).** Congelar el contrato `gpa.fc.v1` + golden; alinear con el dueño de Eco-Admin los campos namespaced en Ops. **No toca código.**
2. **Fase R1 — Publisher FC.** Streams sobre `ValidacionCarga`/`Anulacion` → publisher `gpa.fc.v1` en **modo espera** (URL vacía), anti-eco por `fuente`. Golden + tests.
3. **Fase R2 — Receptor Ops (dueño del repo).** Lambda receptora + campos namespaced + validación de firma. Golden compartidos verdes en su CI.
4. **Fase R3 — Activación coordinada.** Secreto nuevo en SSM; backfill de veredictos/anulaciones existentes (dryRun primero); prueba e2e (anular en FC → ver `anulado` en Ops).
5. **Fase R4 — Reconciliador de retorno + vista de conflictos** (confirmación manual residual).
6. **Transversal — Calidad:** regla anti-duplicado MoreApp↔OPS (R1) y congelar `economico` (R2) **antes** de escalar el piloto.

---

## Apéndice A — Piezas físicas vivas (forward)

> Los identificadores físicos (ARNs de Lambda, nombres de bucket, ruta del secreto SSM,
> cuenta AWS) **no se documentan aquí a propósito**: viven en `HANDOFF-MIGRACION-OPSGPA-2026-07.md`
> (local, no commiteado), consistente con la convención del proyecto para no filtrar infra en git.

Componentes lógicos (nombres físicos → ver handoff local):

- **Publisher** (stack SAM en Ops) + **DLQ** (14d) + **alarma de silencio** (EMF `GPA/Bridge·EnviosExitosos`).
- **Receptor FC** (Lambda con Function URL dedicada) + **secreto compartido** en SSM SecureString.
- **Bucket FC** (fotos `photos/gpa/opsgpa_*`, crudo `ops-capture/`) — copia S3→S3 desde el bucket de evidencias de Ops.
- **Tabla Ops** `gpa_operaciones_prod` (GSI `tipo-fecha-idx`, solo-lectura desde FC).
- **Código FC:** `src/opsgpa/` (contract, evento, mapSolicitud, mapCarga, mapChecklist, mapValidacion, backfill) + `amplify/functions/opsgpa-receptor/handler.ts`.

## Apéndice B — Glosario de transformaciones

`nivelLabel(frac)` fracción→"NN%" · `parseKm/parseNum` normalización numérica · `normSucursal` sucursal canónica · `isoWeekId` fecha→YYYY-Www · `analyzeRow` fila→riesgo/hallazgos/llantas · `normFluidRisk/normBodyRisk/normTireRisk/calcEstatusSemanal` motores de riesgo · `nombreEvidencia` key S3→fname determinístico lowercase · `esReporteDeCarga` discriminador solicitud/carga · `loadIdOf` `economicoId|tipo|eventoId` · `normalizeTokaProducto` colapsa grafía Toka por tipo.
