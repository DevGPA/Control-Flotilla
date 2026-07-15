# Análisis de brechas y modelo de datos unificado GPA Fleet Command ↔ Operaciones-GPA

- **Fecha:** 2026-07-15
- **Autor:** Navares (Tesorería GPA) + Claude Code
- **Complementa:** [2026-07-15-integracion-bidireccional-fc-opsgpa-design.md](2026-07-15-integracion-bidireccional-fc-opsgpa-design.md) (el mapeo y la arquitectura). Este documento responde a otra pregunta: **qué le FALTA a cada sistema** y cómo se ve un **modelo de datos unificado**.
- **Objetivo:** no solo mapear campos existentes, sino detectar oportunidades de enriquecer AMBOS proyectos y definir un modelo consistente y escalable.

> **"Modelo unificado" = modelo LÓGICO/canónico compartido, NO una BD física fusionada.** Las BDs separadas son restricción dura del proyecto. El puente ya demuestra que dos esquemas físicos distintos pueden compartir un contrato canónico; lo que falta es formalizar ese canon (catálogos, identidad y presencia simétrica de campos).

---

## 0. Cómo se produjo este análisis (y por qué es confiable)

Se ejecutó un análisis multi-agente sobre el código real: **4 lentes** (Ops-carece / FC-carece / entidades / catálogos) → **verificación adversarial** de cada brecha abriendo los archivos citados → **crítico de completitud** sobre la unión.

- **43 brechas confirmadas + 8 del crítico = 51.** Cada una anclada a `archivo:línea` o a un golden fixture.
- **0 falsos positivos.** La verificación **ajustó 3** hallazgos (no los descartó): recalibró el impacto de `productoToka` (alto→medio, porque el override de FC ya absorbe la dispersión), marcó `damage_list` como brecha _condicional_ (la forma real no está en ningún fixture), y corrigió el ejemplo de `NIVEL_OPTS` (el fluido que diverge es aceite de motor, no radiador).
- Insumo (~965k tokens, 190 lecturas de archivos): trazable en el transcript del workflow.

**El patrón más importante que emergió:** muchas "brechas de FC" no son datos ausentes, sino datos que **Ops ya envía y FC entierra en JSON o descarta al hidratar**. Son las oportunidades de enriquecimiento más baratas: el dato ya cruza el puente, solo falta promoverlo a columna y leerlo.

---

## 1. Lo que le falta a **Operaciones-GPA** (FC lo tiene)

| Brecha                                      | FC hoy                                                                                 | Ops hoy                                                                                   | Imp.     | Qué añadir en Ops                                                                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Anulación / baja lógica reversible**      | Entidad `Anulacion` (tombstone, `refId`, restauración con rastro)                      | AUSENTE — un registro erróneo queda vivo y contamina KPIs                                 | **Alto** | Campos namespaced de FC (`anulado`/`anuladoMotivo`/`anuladoPor`/`anuladoTs`) recibidos por `gpa.fc.v1`; nunca borrado físico |
| **Discriminador solicitud/carga explícito** | `tipo` ∈ {solicitud, carga} es parte de la PK                                          | Ambos son `tipo_reg="SOL"`; solo los distingue `formato="reporte"` enterrado en `answers` | **Alto** | Campo tipado `tipo_captura` de primer nivel (no un flag opcional en answers)                                                 |
| **Veredicto separable del dato**            | `ValidacionCarga` aparte (regla _no-pisado_: un re-ingest no pisa el veredicto humano) | `status` mezclado en el registro; `cambio_estado` reenvía imagen completa y sobreescribe  | **Alto** | Separar el veredicto de auditoría del `status` de captura (campo namespaced)                                                 |
| **Versionado optimista por registro**       | `version:int` en casi todas las entidades                                              | AUSENTE por item (el único `version` es el del contrato)                                  | Medio    | Contador `version`/`rev` por item (concurrencia + desempate de conflictos)                                                   |
| **Taller / mantenimiento**                  | Entidad `Taller` (folio, motivo, estatus, gastos, técnico, refacciones)                | AUSENTE — sin módulo de mantenimiento                                                     | Medio    | Plantilla/`tipo_reg` de mantenimiento si se quiere captura en origen                                                         |
| **Nota / bitácora por unidad**              | Entidad `Nota` (texto libre acumulable, autor+timestamp)                               | Solo `obs` por evento                                                                     | Bajo     | Opcional; bitácora colaborativa por unidad                                                                                   |
| **CheckDone (hallazgo atendido)**           | Estado compartido "atendido" por hallazgo                                              | AUSENTE                                                                                   | Bajo     | Opcional; seguimiento colaborativo post-captura                                                                              |
| **Multi-tenant / org**                      | `tenantId` requerido + autorización por grupo                                          | Cognito propio sin tenant (mono-org)                                                      | Bajo     | Solo si a futuro se separa GPA/TISA                                                                                          |

## 2. Lo que **Ops ya envía y FC entierra o descarta** — enriquecimiento barato de FC

> Estos son los de mayor ROI: el dato **ya cruza el puente**. La acción es promoverlo a columna tipada y/o leerlo al hidratar. No depende del dueño de Ops.

| Brecha                                                | Estado en FC                                                                                                                                                     | Ops lo manda en                         | Imp.     | Qué hacer en FC                                                                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| **`areaResponsable`** (área que solicitó la carga)    | Escrito en `datos.areaResponsable` y **0 lectores** (grep) — se descarta silenciosamente                                                                         | `answers` del reporte                   | Medio    | Leerlo en `mapCargaToFuelEntry`; promover a columna `areaCarga`; contrastar vs `Unit.area`                             |
| **Capacidad de tanque** _(crítico)_                   | Solo columna de `CargaCombustible` **per-registro**; `Unit` NO la tiene → si una captura la trae mal, degrada `tanque-95` y la clase Ligero/Pesado               | `answers.tanque`                        | **Alto** | Promover `capacidadTanque` a columna **admin-only de `Unit`** (como productoToka); leer vía join, fallback al registro |
| **Taxonomía de evidencia** _(crítico)_                | `fotoAntes`/`fotoDespues` (= el medidor) no matchean `medidor`/`odometro` → caen a "unidad"; la validación por-evidencia y la visión IA quedan ciegas al medidor | etiquetas de foto                       | **Alto** | Alinear vocabulario: `fotoAntes/Despues`→`medidor`; o extender `evidenceKindOf`                                        |
| **Identidad/fecha del APROBADOR** _(crítico)_         | `mapValidacion` consume `autorizadoPor`/`fechaAut` pero son **campos fantasma** — el evento nunca los envía → `revisadoPor`="ops-gpa" y `ts`=fecha de creación   | (no viajan)                             | **Alto** | Requiere que Ops los emita en `cambio_estado` (ver §1); sin ellos no hay "quién/cuándo aprobó"                         |
| **DOC_OPTS del mensual → Cumplimiento**               | Los 6 docs entran solo como findings en `Checklist.resultados` JSON; `ComplianceDoc` se captura a mano y **no recibe nada**                                      | `answers` del mensual                   | **Alto** | Upsert idempotente de `ComplianceDoc` (estado) tras `mapMensual`, sin pisar la captura manual con fecha                |
| **km del checklist** _(crítico)_                      | En `datos`/`resultados` JSON; ni `Checklist` ni `Semanal` tienen columna km                                                                                      | `answers.km`                            | Medio    | Promover `kmCapturado` a columna → traza de odómetro unificada (combustible+inspecciones)                              |
| **Próximo servicio** (`km_sig_serv`/`fecha_sig_serv`) | En `resultados` JSON; no consultable a nivel flota                                                                                                               | `answers` del mensual                   | Medio    | Promover `kmProximoServicio`/`fechaProximoServicio` a columnas; sembrar alerta/Cumplimiento                            |
| **GPS de la carga** (`lat`/`lng`)                     | En `datos.ubicacionDeCarga`, solo para pintar en Maps; sin columna                                                                                               | `answers.ubicacion`                     | Medio    | Promover `gpsLat`/`gpsLng` → verificar por query que la carga fue en gasolinera (geofence)                             |
| **`vehicleId` de Ops**                                | Ningún mapper lo persiste; FC solo guarda económico+placa                                                                                                        | envelope `unidad.vehicleId`             | Medio    | Conservarlo (llave estable de reconciliación cuando económico/placa cambien)                                           |
| **`responsable.userId`/`accountId`**                  | Solo el nombre; en checklist se pierde hasta el correo; sin llave a `UserProfile`                                                                                | envelope `responsable`                  | Medio    | Persistir `responsableUserId`/`Email`; resolver `accountId`→`UserProfile.email`                                        |
| **`necesidad`** (motivo/ruta)                         | Tipado como `number` pero el dato real es texto ("Ruta local"); `num()` lo descarta                                                                              | `answers.necesidad`                     | Medio    | Separar `motivoSolicitud` (string) de la fracción; alinear el tipo del contrato                                        |
| **Hora local / huso** _(crítico)_                     | Solo el sello UTC del servidor; cerca de medianoche una carga cae en el día UTC equivocado y el orden km/l se puede invertir (flota multi-sucursal)              | `fechaISO` UTC                          | Medio    | Propagar hora local u offset por sucursal; catálogo sucursal→huso                                                      |
| **Estado aprobación del checklist** _(crítico)_       | Para combustible hay `ValidacionCarga`; para checklist el estado se entierra como `opsStatus` en JSON                                                            | `status` del CL                         | Medio    | Exponer `estatusAprobacion` como columna filtrable de `Checklist`/`Semanal`                                            |
| **`producto`/`combustible` por evento**               | En `datos`; derivan tipoUnidad/esMontacargas pero no son columnas                                                                                                | `answers`                               | Bajo     | Promover `producto` a columna (ya es la fuente de esMontacargas/Toka)                                                  |
| **`precioCatalogo`**                                  | En `datos` (mientras `precioPorLitro` sí es columna)                                                                                                             | `answers.precio`                        | Bajo     | Promover a columna → alertar sobreprecio en bomba por query                                                            |
| **Nivel de tanque (fracción)**                        | Degradado a etiqueta "NN%" redondeada; la fracción cruda en `datos` nadie la lee                                                                                 | `answers.tankBefore/After` (0..1)       | Bajo     | Persistir la fracción → estimar litros faltantes con precisión                                                         |
| **`emailNotificar`** _(crítico)_                      | El export aún lo muestra pero Ops nunca lo llena → siempre vacío                                                                                                 | (sin fuente)                            | Bajo     | Definir destinatario en Ops, o retirar la columna                                                                      |
| **`damage_list`/golpes** _(confirmado)_               | Solo se conserva la key de foto; el `desc` del daño se descarta — **verificado en prod (2026-07-13)**                                                            | `answers.golpes` = array `{foto, desc}` | Bajo     | Preservar el `desc` del daño (hoy `fotosDeGolpes` solo guarda la foto)                                                 |

## 3. Capacidades **Ops-only** (asimetrías de plataforma)

| Capacidad                                        | Ops                                                   | FC                                                                                                     | Nota                                                             |
| ------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| **CAT#VEHICLE** — catálogo de vehículos dedicado | Entidad propia, identidad por económico               | `Unit` se puebla **oportunísticamente** como efecto colateral de la ingesta; sin adaptador de catálogo | Añadir adaptador `CAT#VEHICLE→Unit`; Ops = maestro post-cutover  |
| **Montacargas (MC)** como entidad/checklist      | `tipo_reg="MC"` con plantilla propia (series R01-R06) | Solo flag derivado `esMontacargas` (por "Gas LP"); excluidos de km/l                                   | Contract-ready; añadir cuando exista consumidor (km = horómetro) |
| **Plantillas dinámicas** (27, prefijo FRM)       | Single-table admite formularios nuevos sin migración  | 13 modelos tipados fijos                                                                               | Diferido por diseño; tipos nuevos del contrato bajo demanda      |

## 4. Catálogos y enums divergentes (a homologar en el modelo unificado)

| Catálogo/enum           | FC                                                                                                                                                   | Ops                                                                                                           | Imp.     | Homologación                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| **sucursal**            | `SUCURSAL_CANON` (7 valores) solo en FC; `normSucursal` cae al crudo si no matchea                                                                   | string libre ("Guadalajara"; nada impide "GDL")                                                               | Medio    | Catálogo compartido propiedad de Ops; FC valida solo como defensa                       |
| **área**                | `AREAS_FLOTILLA` (4) en `Unit.area`                                                                                                                  | `areaResponsable` libre = "MANTENIMIENTO" (fuera del catálogo) + semántica distinta (per-carga vs per-unidad) | **Alto** | Catálogo compartido; decidir autoridad del "gasto por área"; ¿añadir Mantenimiento?     |
| **producto Toka**       | 4 valores grafía EASYGAS; `normalizeTokaProducto` colapsa lo viejo                                                                                   | "TOKA COMBUSTIBLE MAGNA CHIP" (grafía vieja)                                                                  | Medio    | Homologar grafía EASYGAS en CAT#VEHICLE; FC-admin conserva override                     |
| **fuelType**            | Derivado por substring de `producto` (frágil; montacargas Gas LP mandan combustible="Gasolina")                                                      | `combustible` grueso + `producto` fino, ambos libres                                                          | Medio    | Enum tipado {Magna, Premium, Diesel, GasLP} emitido explícito por unidad                |
| **status aprobación**   | `verdictGlobal` {ok, discrepancia, pendiente}; mapeo por prefijo tolerante a género                                                                  | `status` libre e **inconsistente**: SOL "Aprobada" (fem), CL "Aprobado" (masc)                                | Medio    | Enum compartido {Pendiente, Aprobada, Rechazada}, un solo género                        |
| **DOC_OPTS documentos** | Dos vocabularios sin homologar: checklist (Si vigente/Vencido/No cuenta) vs `ComplianceEstado`                                                       | Mensual mezcla DOC_OPTS con "Si/No" plano en refrendo/calcomonia                                              | Medio    | Homologar tri-estado ↔ ComplianceEstado; uniformar Ops a DOC_OPTS                       |
| **NIVEL_OPTS fluidos**  | Severidad por **substring** ("bajo"), distinta según formulario: aceite de motor = Revisar (semanal) vs Urgente (mensual); `liq_frenos` solo mensual | {Sin Nivel, Muy Bajo, Bajo, Nivel Óptimo}                                                                     | Medio    | Enum compartido + **mapa de severidad único y explícito** por itemId (no por substring) |
| **TACO**                | 1-10 interpretado como mm por heurística + umbrales 3.99/6.99 (solo en código)                                                                       | enteros 1-10 = mm directos                                                                                    | Bajo     | Fijar "TACO 1-10 = mm" + umbrales como constante de contrato                            |
| **tipo checklist**      | `Periodo.tipo` {semanal, mensual, inspeccion}; `tipoInspeccion` siempre "mensual"                                                                    | subtipo {semanal, mensual}                                                                                    | Bajo     | Enum compartido {semanal, mensual}; documentar/retirar 'inspeccion' legacy              |

---

## 5. ✅ Semáforo semanal — RESUELTO (2026-07-15, verificado contra producción)

Consultados **3 registros semanales reales** de `gpa_operaciones_prod` (2026-07-13; Cabos, Monterrey, Guadalajara, lectura read-only). Los tres traen, **planos dentro de `answers`**:

```
aceite: "Nivel Optimo"      radiador: "Nivel Optimo"
carroceria: "Con raspaduras/golpes"      llanta_ref: "Si"
```

**Las 4 llaves que lee `mapSemanal` coinciden con el dato real**, incluida `aceite` — el punto que estaba abierto. El aceite **sí se captura y se llama exactamente `aceite`** ([mapChecklist.ts:87](../../../src/opsgpa/mapChecklist.ts#L87)) → `mapSemanal` lo lee bien → **el semáforo semanal es correcto. No hay bug.** La alarma venía enteramente del **golden fabricado** (`cl-semanal-creacion.json`), que anidaba las respuestas en `answers.answers` con nombres inventados (`nivelAceite`, `llantas`) — una forma que **no existe en producción** (los datos reales son planos).

**Limpieza pendiente (ya NO es riesgo de correctitud; ambas del lado FC, sin depender de nadie):**

1. **Regenerar `cl-semanal-creacion.json`** desde un registro real — hoy tiene la estructura equivocada. Ya conocemos la forma real, así que se puede hacer de inmediato.
2. **Añadir una aserción de riesgo** a [opsgpa-golden-contract.test.ts:54-63](../../../tests/opsgpa-golden-contract.test.ts#L54-L63): hoy no verifica ningún `risk`, así que un cambio de llaves pasaría inadvertido (el unitario `opsgpa-mapChecklist.test.ts` sí lo cubre con un registro real).

**Refinamientos verificados de paso (mismos 3 registros reales):**

- `golpes` **sí trae descriptor**: array de `{foto, desc}` con `desc` = "Golpe"/"Abolladura"/"Rayon"/"Despintado" → la brecha "metadato de daño que FC descarta" (§2) queda **confirmada** (no condicional): `fotosDeGolpes` extrae solo la foto y tira el `desc`.
- `fecha` llega con offset **`-06:00` fijo** (America/Mexico_City), **incluso en Cabos** (real -07:00) y aplicaría igual a Cancún (-05:00) → confirma la brecha del huso (§2): el sello no refleja el huso real de la sucursal.

---

## 6. Modelo de datos unificado (canónico)

Tres capas. La física sigue separada; lo que se unifica es el **canon lógico**.

### Capa 1 — Catálogos canónicos compartidos

| Catálogo                    | Valores                                                                  | Dueño propuesto                             |
| --------------------------- | ------------------------------------------------------------------------ | ------------------------------------------- |
| sucursal                    | Cabos, Cancún, Cedis, Ciudad de México, Guadalajara, Monterrey, Vallarta | Ops (CAT#VEHICLE); FC valida                |
| fuelType                    | Magna, Premium, Diesel, GasLP                                            | Ops (explícito por unidad)                  |
| productoToka                | 4× grafía EASYGAS                                                        | FC-admin (override); Ops homologa grafía    |
| área                        | Logística, Almacén, Postventa, Administración (+¿Mantenimiento?)         | Compartido; decidir per-unidad vs per-carga |
| status                      | Pendiente, Aprobada, Rechazada (género único)                            | Ops                                         |
| NIVEL_OPTS                  | Sin Nivel, Muy Bajo, Bajo, Nivel Óptimo + mapa de severidad único        | Compartido (motor FC)                       |
| DOC_OPTS ↔ ComplianceEstado | Si vigente/Vencido/No cuenta ↔ vigente/porVencer/vencido/…               | Compartido                                  |
| TACO                        | 1-10 = mm; crít ≤3.99 / warn ≤6.99                                       | Compartido (constante de contrato)          |
| tipoChecklist               | semanal, mensual                                                         | Compartido                                  |

### Capa 2 — Identidad canónica

- **Unidad:** económico (**congelar en Ops**) + `vehicleId` como llave de reconciliación (persistir en FC).
- **Evento:** `registroId` → `OPS-<id>`.
- **Responsable (capturista):** nombre + userId + accountId(correo) → ligar a `UserProfile`.
- **Aprobador (revisor):** `autorizadoPor` + `fechaAut` — **Ops debe empezar a emitirlos** (hoy son campos fantasma).
- **Versión:** `version`/`rev` por registro en ambos lados (concurrencia + desempate).

### Capa 3 — Presencia simétrica de campos de primer nivel

Promover de JSON a columna en el lado que los consulta:

- **Unidad (catálogo):** `capacidadTanque`, `productoToka`, `area`, `fuelType`, `vin`, `modelo`, `anio`.
- **Carga:** `gpsLat/gpsLng`, `producto`, `precioCatalogo`, `areaCarga`, nivel-fracción.
- **Checklist:** `kmCapturado`, `kmProximoServicio`, `fechaProximoServicio`, `estatusAprobacion`.
- **Evidencia:** taxonomía compartida {medidor, odómetro, ticket, bomba, firma, unidad}.

### Evolución del contrato (`gpa.ops.v2` / `gpa.fc.v1`)

- Añadir al envelope: **aprobador** (autorizadoPor/fechaAut), **hora local/huso**, `version` por registro, persistir el `vehicleId` que ya viaja.
- Namespaced FC-en-Ops: `anulado*`, `veredictoTesoreria*`.
- Golden compartidos versionados; CI que truena en ambos lados si el canon diverge.

---

## 7. Priorización (por dueño y ROI)

### P0 — Nuestro lado (FC), barato, sin dependencia externa

El dato ya llega; solo promover/leer.

1. **Verificar la contradicción de itemIds del semanal** (§5) — posible falso-OK. _Correctitud, no enriquecimiento._
2. `areaResponsable` (0 lectores hoy) → leer + columna `areaCarga`.
3. **`capacidadTanque` como atributo de `Unit`** → arregla `tanque-95` y clase Ligero/Pesado.
4. **Taxonomía de evidencia** (`fotoAntes/Despues`→medidor) → desbloquea validación por-evidencia + visión IA.
5. Feed de `ComplianceDoc` desde DOC_OPTS del mensual (semáforo automático).
6. Promover `km`, próximo servicio, GPS, `vehicleId`, `producto/precioCatalogo` a columnas.

### P0/P1 — Requiere al dueño de Eco-Admin

7. **Congelar `economico`** server-side (ya en el spec de integración).
8. Emitir **aprobador** (`autorizadoPor`/`fechaAut`) y **hora local/huso** en `cambio_estado`.
9. Uniformar `status` (género) y DOC_OPTS (refrendo/calcomonia hoy usan "Si/No").
10. `tipo_captura` explícito (solicitud/carga) en vez del flag `formato`.

### P1 — Compartido (homologación de catálogos)

11. sucursal, fuelType, área, NIVEL_OPTS (severidad única), TACO como constantes de contrato.

### P2 — Estructural / diferido

12. `version`/`rev` por registro en Ops; Anulación namespaced (ya en `gpa.fc.v1`); veredicto separable en Ops; MC; plantillas dinámicas.

---

## 8. Recomendaciones

1. **Empezar por P0 de nuestro lado**: son mejoras internas de FC que no dependen de nadie y varias arreglan pérdidas silenciosas de datos que Ops ya paga por capturar.
2. **Verificar el semáforo semanal (§5) primero** — es lo único que puede estar dando resultados incorrectos hoy.
3. **Empaquetar los P0/P1 de Ops en el mismo brief** que congelar económico y los campos namespaced de `gpa.fc.v1` — un solo ciclo de coordinación con el dueño de Eco-Admin.
4. **Formalizar los catálogos de la Capa 1 como módulo compartido** (contrato) antes del cutover: es la base de la consistencia y evita la deriva de grafías/enums que hoy FC parchea con normalizadores.
5. Tratar el modelo unificado como **canon lógico versionado** (`gpa.*.v2`), no como fusión de BDs.

---

## Apéndice — Trazabilidad

Análisis multi-agente verificado adversarialmente (43 brechas + 8 del crítico; 0 falsos positivos; 3 ajustadas). Cada brecha del resultado del workflow incluye su `evidence` (archivo:línea/golden) y su `note` de verificación. Los archivos fuente auditados: `amplify/data/resource.ts` (13 entidades), todo `src/opsgpa/`, `src/fuel/` (mapEntry, fuelAnalysis, parse, tokaLayout), `src/analyzer/` (analyzeRow, risk, constants), `src/compliance/`, `src/taller/`, `amplify/functions/moreapp-webhook/handler.ts`, y los golden de `tests/opsgpa-golden/`.
