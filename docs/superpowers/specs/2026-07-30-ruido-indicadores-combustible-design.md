# Meta y diseño — Bajarle el ruido a los indicadores de Combustible

**Fecha:** 2026-07-30 · **Autor:** sesión Claude + Navares · **Estado:** diseño para aprobación
**Alcance elegido:** tablero accionable **+** limpieza dirigida de datos (decisión de Navares, 2026-07-30)

> ⚠️ **Corrección del 30-jul (post-implementación).** La primera versión de este spec definía la tasa
> de comprobación como `cargas de vehículos / solicitudes de vehículos`, y de ahí salió el **42.5 %**.
> Esa fórmula estaba mal: numerador y denominador eran poblaciones distintas, así que con el filtro
> "Solo solicitudes" el indicador pintaba **0.0 %** y en algunas ventanas podía pasar de 100 %. El bug
> vivía también en el script de auditoría, por eso el 42.5 % "cuadraba". La fórmula correcta se mide
> sobre **una sola población** —los ciclos cerrados de vehículos, con el numerador como subconjunto del
> denominador— y da **41.3 %**. El conteo de solicitudes sin comprobante (**1,912**) y su monto
> ($1,799,011) **no cambiaron**: solo cambió el denominador.
>
> Todos los números de este documento se midieron contra **producción** el 30-jul-2026 corriendo los
> módulos reales del app (`buildFuelEntries` → `computeFuelMetrics` → `detectFuelAnomalies` →
> `buildKpisFuel`) sobre el rango 01-ene-2026 → 30-jul-2026, sin lock de sucursal.
> Herramienta: `tests/fixtures/audit-kpis.ts` (ruta gitignoreada).
> Reproducir: `node_modules/.bin/tsx tests/fixtures/audit-kpis.ts 2026-01-01 2026-07-30`

---

## 1. La meta

**Que el tablero de Combustible responda "¿qué tengo que hacer hoy?" en vez de "¿qué hay en la base
de datos?".**

Concretamente, al terminar:

1. **Todo indicador que muestre un número en rojo o ámbar se puede vaciar con trabajo humano.**
   Si un número no puede llegar a cero, no es un indicador: es contexto, y va a otro lado.
2. **Un error se cuenta una vez.** Hoy un solo dedazo de odómetro enciende hasta cuatro alarmas.
3. **Lo estructural deja de compartir espacio con lo accionable.** Un montacargas sin km/l y una
   carga con odómetro mal capturado no pueden verse igual.
4. **Las colas vivas quedan en cero** y con dueño: 15 rechazadas sin triage, 44 pendientes,
   9 discrepancias, 32 errores de captura.

### Cómo se mide el éxito

| Métrica | Hoy | Objetivo |
|---|---|---|
| **Registros mostrados como alarma que no son trabajo** | **5,884** | **0** |
| **Suma de la bandeja de trabajo**, contando cada error **una sola vez** y solo lo que Tesorería puede resolver | **80** | **≤ 30** (solo lo de la semana en curso) |
| Chips que no se pueden vaciar nunca | 3 de 7 | **0** |
| Cobertura de km/l (cargas con rendimiento) | 59.9 % | **≥ 70 %** |
| Anomalías "Urgente" | 22 (≈14 causas reales) | **≤ 5** |
| Alarmas por error de captura | hasta 4 | **1** |

Los 8,097 no aparecen como una sola meta porque no son una sola cosa: **5,884 deben desaparecer del
tablero** (no son trabajo), **102 deben vaciarse con trabajo** y **179 anomalías blandas son una cola
permanente de revisión** que no debe vivir como alarma (§3, capa 3).

La bandeja de **80** = 32 errores de captura + 15 rechazadas + **22** por revisar que son de Tesorería
+ 9 discrepancias + **2** urgentes que no son captura (posible fuga del eco 73 y económico equivocado).
El tablero de hoy muestra **122** para el mismo trabajo, por dos razones: cuenta los dedazos de
odómetro **dos veces** (en "Sin rendimiento" y en "Anomalías: Urgente"), y mete en la cola de Tesorería
**20 registros que en realidad esperan a Ops** (§2.5-2).

---

## 2. El diagnóstico: dónde está el ruido

El tablero muestra **8,097 unidades de alarma**. De eso, **~100 son acciones duras** que alguien
puede ejecutar. Relación señal/acción: **1.2 %**.

### 2.1 Los tres cubos

| Cubo | Registros | % | Qué es |
|---|---|---|---|
| **No es trabajo** | **5,884** | **73 %** | Histórico 4,261 + huecos estructurales de km/l 603 + montacargas 1,020 |
| **Un problema sistémico** | **1,912** | 24 % | Solicitudes de vehículos sin reporte de carga ($1,799,011). No son 1,912 tareas: es **una política que falta** |
| **Trabajo real** | **301** | 3.7 % | 32 errores de captura · 15 rechazadas · 44 pendientes · 9 discrepancias · 201 anomalías (≈14 causas urgentes + 179 revisiones blandas) |

### 2.2 Chip por chip (medido)

| Chip | Valor | Señal | Ruido | Veredicto |
|---|---|---|---|---|
| Sin rendimiento | 635 | **32** | 603 | **95 % ruido.** Estructural: 343 suman a ventana · 157 montacargas · 41 1ª carga · 35 llenado partido · 27 sin lleno previo |
| Discrepancias | 9 | 9 | 0 | Limpio. 2 con dinero ($1,952). Sin movimiento desde el 21-jul |
| Rechazadas sin triage | 15 | 15 | 0 | Limpio y **urgente**: 3 cargas con dinero, **$5,945** |
| Pendientes de revisar | 44 | 44 | 0 | Limpio pero **mezcla urgencias**: 21 llegaron ayer, 23 llevan >7 días |
| Histórico | 4,261 | **0** | 4,261 | **100 % ruido por diseño.** 70 % del universo. $1,313,729. Nadie lo validará jamás |
| Solicitudes sin carga | 2,932 | 1,912 | 1,020 | **35 % ruido.** Los 1,020 son montacargas Gas LP que no emiten reporte de carga |
| Anomalías | 201 | ≈193 | ≥8 dobles | 22 urgentes − 8 parejas salto→retroceso ⇒ **≈14 causas reales**, de las cuales **12 son dedazos** ya contados en "Sin rendimiento" |

### 2.3 El hallazgo que ordena todo el plan: un error, cuatro alarmas

Un dedazo de odómetro (el chofer teclea un dígito extra) produce:

1. `Sin rendimiento` — la carga del dedazo no puede calcular km/l ("salto de odómetro")
2. `Sin rendimiento` **otra vez** — la carga *siguiente*, que es correcta, parece "odómetro retrocede"
3. `Anomalías: salto de odómetro`
4. `Anomalías: odómetro retrocede` (severidad **Urgente**)

Parejas verificadas en producción: eco 12 (885,415 → 88,745), eco 66 (902,200 → 90,613),
eco 72 (503,327 → 50,473), eco 75, 81, 87, 90. Más lecturas truncadas obvias: eco 73 con **km 90**,
eco 90 con 1,258, eco 89 con 2,018.

**Corregir 32 capturas apaga ~60 alarmas.** Es la palanca más corta del plan.

### 2.4 La herramienta ya existe y no se está usando

`kmDetectado` permite corregir el odómetro leyéndolo de la foto **sin tocar el dato de origen**:

- UI: [renderDetalleCarga.ts:469-498](../../../src/fuel/renderDetalleCarga.ts#L469-L498) — input en el detalle de la carga
- Persistencia: [wire.ts:983-1014](../../../src/fuel/wire.ts#L983-L1014) — `ValidacionCarga.kmDetectado`, fuente `manual`
- Consumo: [fuelAnalysis.ts:196-202](../../../src/fuel/fuelAnalysis.ts#L196-L202) — `computeFuelMetrics` lo prefiere como odómetro efectivo

El comentario del propio motor cita el caso *"eco 86 2026-07-13: capturaron 1,682 en vez de ~16,8xx"*
— que es **una de las 9 discrepancias vivas**. La capacidad está construida, probada y desplegada.

> **Consecuencia de diseño: la limpieza de los 32 odómetros NO requiere código.** Es trabajo
> operativo con una herramienta existente, auditable (`revisadoPor` + `fuenteDeteccion: manual`) y
> reversible (borrar el valor quita la corrección).

### 2.5 Alineación con Operaciones-GPA — cuatro verificaciones que corrigieron el plan

Los datos se derivan de Ops, así que cada cambio se validó contra **cómo opera Ops**, no solo contra
lo que FC muestra. Cuatro preguntas, cuatro respuestas medidas:

**(1) ¿Corregir el odómetro en FC choca con el puente? NO — y revela algo mejor.**
Los **32 errores de captura son 100 % de la era MoreApp** (`datos.fuente` ≠ `ops-gpa` en los 32).
Riesgo de colisión con el puente: **0 registros**. Ninguno espera un veredicto de Ops.
Dato indicativo (no concluyente): con ~94 cargas de Ops en el histórico y una tasa de dedazo del
2.1 % en MoreApp, lo esperado serían ~2 casos de Ops y hay **0** — consistente con que **el aprobador
de Ops revisa la foto antes de aprobar y el error se corrige en la fuente**.
⇒ **Consecuencia: "Errores de captura" NO debe ser un chip permanente.** Es una **deuda finita** de una
fuente que se está apagando (MoreApp sin registros nuevos desde el 22-jul). Debe ser un contador de
limpieza que llega a cero y desaparece, no un KPI de operación.

**(2) ¿De quién es la cola de "Pendientes de revisar"? Está partida en dos, y una no es tuya.**

| Origen | # | Significa | ¿Puede actuar Tesorería? |
|---|---|---|---|
| MoreApp | 22 | Nadie las ha validado y **nadie más lo hará** (fuente apagada) | **Sí — es tu cola** |
| Ops, `opsStatus: Pendiente` | 20 | **Ops todavía no las aprueba.** Aprobar en Ops *es* validar (decisión 2026-07-10) | **No — es cola de Ops** |

Evidencia en vivo: entre dos corridas de la auditoría el mismo día, **3 pendientes de Ops
desaparecieron solas** porque Ops las aprobó (42 en vez de 44).
⇒ **Dos consecuencias.** Primera: el eje correcto para partir el chip es **el origen**, no la
antigüedad (C5 estaba mal). Segunda, y es una **regla de seguridad**:

> 🔴 **Nunca validar a mano un registro cuyo `opsStatus` siga en `Pendiente`.** La validación manual
> escribe `fuenteDeteccion: "manual"`, y la **regla de no-pisado** del receptor
> ([handler.ts:188](../../../amplify/functions/opsgpa-receptor/handler.ts#L188)) hace que el puente
> **jamás** vuelva a tocar ese veredicto. El registro quedaría congelado y la aprobación de Ops nunca
> entraría. Aplica igual a `kmDetectado`: [handleKmDetectado](../../../src/fuel/wire.ts#L988) también
> estampa `manual`.

**(3) ¿Ops recaptura después de rechazar? SÍ — y el triage ya funciona.**
Caso verificado: eco 86, 27-jul. Ops rechazó el reporte `OPS-16118c9d44db` ($594.71) y **aprobó una
recaptura el mismo día** (`OPS-6cdbbf470f16`, mismo monto). FC recibió **ambos**.
Y el flujo diseñado el 21-jul **operó correctamente en producción**: auxiliar2 anuló el rechazado el
28-jul con el motivo pre-llenado *"Rechazada en Operaciones-GPA — registro inválido"*, así que el gasto
**no se está contando doble**.
⇒ **Consecuencia:** el triage no se puede decidir mirando solo el registro rechazado. Si existe una
recaptura aprobada del mismo gasto y se marca el rechazado como "gasto real", **se duplica el dinero**.
El chip y el detalle deben advertir *"existe una recaptura aprobada"*. 1 de 7 rechazados en Ops tiene
recaptura hoy.

**(4) ¿Cuál es el error que SÍ se va a repetir? Económico equivocado, no odómetro.**
De las 18 anulaciones de combustible en producción: **6 "duplicado"** de solicitudes, **4 "reasignada a
otra unidad"**, **3 "unidad/económico equivocado"**, 2 "mal registrado". Cuatro las hizo Navares el
17-jul a mano.
⇒ **Dos consecuencias.** El chip permanente que falta no es "errores de captura" sino
**"reasignaciones y duplicados por resolver"** — el error propio del modelo de Ops, ya con maquinaria
(lote 1 del puente) pero sin indicador. Y las **solicitudes duplicadas inflan directamente
"Solicitudes sin carga"**: una solicitud duplicada cierra el ciclo de la anterior sin carga de por
medio, que es exactamente el patrón que el indicador cuenta como incumplimiento.

**(5) ¿Ops permite editar un reporte ya aprobado? SÍ — el odómetro, y ya pasó 3 veces.**

Ops tiene un campo **`kmForzadoPor`**: un override del odómetro con rastro de autor. Usado en
**3 registros, los 3 con status `Aprobada`**, todos por `administracion@gpa.com.mx` (eco 32 km 124,879 ·
eco 75 km 77,641 · eco 06 km 205,365). **Las 3 ediciones llegaron a FC** y el valor coincide exacto,
así que el puente sí propaga las correcciones post-aprobación.

Lo que NO existe en Ops: cualquier campo de modificación (`updatedAt`, `version`, `modificadoPor`). El
campo `_auditoria` **no es un historial** — es telemetría de captura (geo, `inicioLlenado`/`finLlenado`,
duración, IP, user-agent) y solo está en 93 de 395 registros. **No hay forma de saber, desde los datos,
si un registro aprobado fue editado en otros campos.** Solo el odómetro deja rastro.

⇒ **Tres consecuencias, y una obliga a rediseñar el candado C5b:**

> 🔴 **R10 — divergencia silenciosa del odómetro.** FC **no lee `kmForzadoPor`** (verificado: cero
> referencias en `src/` y `amplify/`), así que un km forzado por Administración llega a FC
> indistinguible de uno capturado por el chofer. Y peor: si Tesorería ya había corregido ese registro
> con `kmDetectado`, la corrección **oficial y posterior de Ops pisa `kmCapturado` pero `kmDetectado`
> sigue ganando** en `computeFuelMetrics` — FC calcularía el km/l con el valor viejo de Tesorería,
> ignorando la corrección de la fuente, **y nadie lo vería**.

Por eso **C5b se amplía**: para registros de origen Ops la corrección de odómetro **se pide a Ops**, no
se hace en FC. Ops es la fuente de verdad y ya tiene el mecanismo con autoría. Costo operativo hoy:
**cero**, porque los 32 errores son 100 % de MoreApp (§2.5-1).

**Hallazgo colateral: el puente pierde eventos.** Comparando los 395 registros de Ops contra FC campo
por campo encontré **un rechazo que FC nunca recibió**: `OPS-4c814d9b6a9d` está `Rechazada` en Ops y
`Pendiente` en FC. Es decir, **"Rechazadas sin triage" sub-reporta**: hay rechazos invisibles para
Tesorería. Se atiende con C12.

**Nota menor de fidelidad:** 95 de las 97 divergencias Ops↔FC son **redondeo del odómetro** (Ops guarda
`2588.2`, FC guarda `2588`). Irrelevante en vehículos; en montacargas, cuyo horómetro avanza en
décimas, puede afectar deltas pequeños. No se corrige en esta meta; queda anotado.

### 2.6 Nota de método: el tablero que viste era del 21-jul

Los chips del screenshot (606 / 9 / 2 / 24 / 4,261 / 2,808 / 188) corresponden al dataset del
**21-jul**, no al de hoy. Reconstruí ese día y calzan 5 de 7 exactos (las dos diferencias son cargas
capturadas con retraso). Efecto secundario relevante: **una pestaña PWA vieja puede tener a Tesorería
tomando decisiones sobre datos de hace nueve días.** Se atiende en C9.

---

## 3. El diseño: tres capas en vez de once tarjetas iguales

Hoy hay **11 tarjetas visualmente idénticas** donde conviven "Gasto $1.8M", "Histórico 4,261" y
"Discrepancias 9". El rediseño las separa por **qué se hace con ellas**:

### Capa 1 — Bandeja de trabajo (accionable, vaciable, con antigüedad y $)

| Chip | Hoy | Después |
|---|---|---|
| **Triage de rechazadas** | 15 · "decidir: no contar o gasto real" | 15 · **$5,945 en 3 cargas** · la más vieja **8 días** |
| **Por revisar** | 44 (mezclados) | **22 "tu cola"** (MoreApp) · los **20 "esperando a Ops"** salen a la capa 2 en tono neutro |
| **Discrepancias** | 9 | 9 · **$1,952** · ordenadas por dinero |
| **Errores de captura** | *(no existe)* | **32** · odómetro corregible desde la foto |
| **Urgentes reales** | dentro de "Anomalías 201" | **2** · lo que no es captura: posible fuga (eco 73) y económico equivocado |

Regla de la capa: **cada chip debe poder llegar a cero**, y **cada error aparece en un solo chip** —
un dedazo de odómetro es un "error de captura", no también un "urgente".

### Capa 2 — Salud (tasas, no conteos)

| Chip | Después |
|---|---|
| **Esperando a Ops** | **20** registros con `opsStatus: Pendiente` · tono neutro, sin acción de Tesorería. Mide la latencia del aprobador de Ops, y se vacía solo (§2.5-2) |
| **Tasa de comprobación** | **41.3 %** de los ciclos cerrados de vehículos terminan en reporte de carga (1,347 de 3,259) · **1,912** sin comprobante · $1,799,011 |
| **Cobertura de km/l** | **59.9 %** (950 de 1,585 cargas) · desglose estructural en tooltip |
| **Rendimiento flota** | 5.76 km/l ponderado *(sin cambio)* |
| **Gasto · Litros · Cargas** | $1,882,743 · 75,887 L · 1,585 *(sin cambio)* |

Un porcentaje no genera ansiedad de "pendiente" y sí sirve para comparar meses. Los 2,932 y los 635
se convierten en **denominadores**, no en alarmas.

### Capa 3 — Contexto y archivo (fuera de los chips)

- **Histórico (4,261)**: baja a línea de contexto bajo los KPIs — *"4,261 registros previos al
  1-jun-2026 no entran al control de validación · ver"* — con el filtro `historico` que **ya existe**
  en la tabla. Cero cambios de datos, cero borrado.
- **Huecos estructurales de km/l (603)**: viven en el tooltip de "Cobertura de km/l".
- **Montacargas (1,020 solicitudes · $368,054 · 9 unidades)**: chip propio, tono neutro. **No
  desaparecen** — se dejan de mezclar con vehículos.

---

## 4. Los cambios, uno por uno

### Código (C)

| # | Cambio | Dónde | Efecto en el ruido |
|---|---|---|---|
| **C1** | "Sin rendimiento 635" → **"Errores de captura 32"**. El `value` pasa a contar solo `MOTIVO_SIN_KMPL_ACCIONABLE`; el resto se va a "Cobertura de km/l". **Es un contador de limpieza temporal** (§2.5-1): cuando llegue a 0 el chip se oculta solo, como ya hacen "Histórico" y "Rechazadas" | [renderKpis.ts:107-119](../../../src/fuel/renderKpis.ts#L107-L119) | **−603** |
| **C2** | "Histórico 4,261" deja de ser chip → línea de contexto + filtro existente | `renderKpis.ts:148-161` + contenedor de KPIs | **−4,261** |
| **C3** | "Solicitudes sin carga" excluye montacargas (`esMontacargas`, ya derivado) y se presenta como **tasa de comprobación**. **Añadido tras §2.5-4:** las solicitudes duplicadas inflan este indicador (una duplicada cierra el ciclo de la anterior sin carga) ⇒ el ciclo debe **ignorar solicitudes consecutivas del mismo eco el mismo día**. Cuando el backfill del enlace `solicitudFolio` esté hecho, la métrica migra del heurístico temporal al **vínculo explícito de Ops** | `renderKpis.ts:39-47, 162-172` + `fuelAnalysis.computeRecorridos` | **−1,020** y deja de sobre-contar |
| **C4** | Triage de rechazadas: añadir **$ y antigüedad** al `sub`, y **marcar si existe una recaptura aprobada** del mismo gasto (§2.5-3) — sin eso, marcar "gasto real" puede duplicar dinero | `renderKpis.ts:128-140` + `renderDetalleCarga.ts` | 0 (evita doble conteo) |
| **C5** | **Corregido tras §2.5-2.** "Pendientes" se parte por **origen**, no por antigüedad: **"Tu cola" (22, MoreApp)** vs **"Esperando a Ops" (20)**, esta última en tono neutro y **sin botón de validar**. La antigüedad va como sub-línea dentro de cada bucket. ⚠️ El bucket "esperando a Ops" se define por **negación**: todo registro de origen Ops cuyo status **no sea final** (`Aprobada`/`Rechazada`) — así entran `Pendiente`, **`Por corregir`** (`esStatusPorCorregir`, hoy sin casos vivos pero desplegado) y cualquier status futuro que Ops invente. Definirlo por lista blanca (`=== "Pendiente"`) dejaría los `Por corregir` **fuera de los dos buckets** | `renderKpis.ts:141-147` | **−20 de la bandeja** (no son trabajo de Tesorería) |
| **C5b** | **Bloqueo de seguridad, ampliado tras §2.5-5.** Dos reglas: (a) deshabilitar la validación manual cuando `opsStatus === "Pendiente"` — congelaría un veredicto que Ops aún debe mandar; (b) deshabilitar `kmDetectado` en **todo** registro de origen Ops y remitir la corrección a Ops (`kmForzadoPor`), que es la fuente de verdad y sí deja autoría. Ambas con tooltip que explique por qué. Costo operativo hoy: cero (los 32 son de MoreApp) | `renderDetalleCarga.ts` + `wire.ts:988` | previene corrupción y divergencia silenciosa |
| **C6** | Discrepancias: mostrar **$** y ordenar por dinero | `renderKpis.ts:121-127` | 0 (mejora priorización) |
| **C7** | **Dedup de causa raíz** en anomalías: `salto de odómetro` en la carga N + `odómetro retrocede` en la N+1 del mismo eco ⇒ **un** hallazgo "km mal capturado" con dos cargas de evidencia | [fuelAnalysis.ts:861+](../../../src/fuel/fuelAnalysis.ts#L861) | **22 urgentes → ≈14** |
| **C8** | Partir el chip "Anomalías 201": **urgentes que no son captura** van a la bandeja (2); las **179 blandas** salen de los chips y viven como cola de revisión en la tabla, con el filtro por alerta que ya existe (`matchesFlag`) | `renderKpis.ts:173-180` | **−179 como alarma** |
| **C9** | Reordenar las tarjetas en las tres capas (bandeja / salud / contexto), con jerarquía visual distinta por capa | `renderKpis.ts:191-246` + `main.css` | cualitativo |
| **C10** | Aviso de datos viejos: si la última hidratación tiene **más de 60 minutos**, banda visible con la hora del último refresco | `cloudHydrate.ts` / `wire.ts` | evita decidir con datos de hace 9 días |
| **C12** | **Detector de deriva Ops↔FC** (§2.5-5): comparar periódicamente `status` de Ops contra `datos.opsStatus` de FC y reportar los que no cuadren. Hoy hay **1** (`OPS-4c814d9b6a9d`: Rechazada en Ops, Pendiente en FC), lo que significa que "Rechazadas sin triage" **sub-reporta**. Sin esto, un rechazo perdido es invisible para siempre | script de auditoría (ya existe la base en `audit-kpis.ts`) | cierra el sub-conteo |
| **C11** | **El único indicador NUEVO que el modelo de Ops justifica** (§2.5-4): **"Duplicados sospechosos"** — solicitudes del mismo económico el mismo día. Es la falla que se repite (6 de 18 anulaciones) y la que ensucia la tasa de comprobación. Accionable: anular la copia | `fuelAnalysis.ts` (detector) + `renderKpis.ts` | +chip vaciable, −ruido en C3 |

**Ruido apagado por código: 5,884 registros que dejan de contarse como alarma (73 % del total), más
179 anomalías blandas que dejan de vivir como chip (C8).**
C1–C3 son los tres que mueven la aguja y son los más baratos: son cambios de *qué se cuenta*, no de
cómo se calcula. El motor y los predicados ya existen (`MOTIVO_SIN_KMPL_ACCIONABLE`, `esMontacargas`,
filtro `historico`, `matchesFlag`). **Ningún cambio toca el cálculo de km/l, el gasto ni el dataset.**

### Limpieza operativa (L) — sin desplegar nada

| # | Trabajo | Volumen | Herramienta |
|---|---|---|---|
| **L1** | Triage de las **3 rechazadas con dinero** — eco 32 $2,945 (22-jul), eco 46 $2,500 (23-jul), eco 74 $500 (22-jul) | 3 decisiones · $5,945 | Detalle de carga → *No contar* / *Validar* |
| **L2** | Cerrar las **2 discrepancias con dinero** — eco 86 $952 (13-jul, el caso del odómetro 1,682), eco 65 $1,000 (27-jun) | 2 | `kmDetectado` + veredicto |
| **L3** | Corregir los **32 odómetros** desde la foto | 32 · apaga ~60 alarmas | `kmDetectado` (§2.4) |
| **L4** | Revisar las pendientes de **MoreApp** (22). 🔴 **Verificar el origen antes de validar** — un registro de Ops en `Pendiente` NO se toca (§2.5-2) | 22 | Flujo normal de validación |
| **L4b** | Las **20 pendientes de Ops** no se trabajan: se **empujan a Ops** para que las apruebe. Es una métrica de latencia del aprobador, no una cola de Tesorería | 0 (seguimiento) | Comunicación con Ops |
| **L5** | Triage de las 12 rechazadas de $0. Antes de marcar cualquiera como "gasto real", comprobar si hay **recaptura aprobada** (§2.5-3) | 12 | Flujo normal |
| **L6** | **eco 73, 8-abr: posible fuga** (4.76 km/l vs 8.26 histórico). El único urgente que **no** es captura | 1 | Revisión física de la unidad |
| **L7** | **eco 45 ↔ 19**: carga de $2,299.99 sin registro vivo + económico fantasma | 1 | Decisión pendiente (handoff 29-jul) |
| **L8** | Catálogo `Unit`: eco **43, 49, 52** sin `marca`/`sucursal`; **19** y **R04** no existen | 5 | Panel de admin |

### Decisión de negocio que falta (D)

**D1 — Política de comprobación de consumo.** El 57.5 % de las solicitudes de vehículos
($1,799,011) nunca produce reporte de carga. Ningún cambio de UI arregla eso: o se exige el reporte,
o se acepta que la comprobación llega por Toka. Está atado a la conciliación Toka, parqueada en
[2026-07-27-diagnostico-toka-reporte-consumos.md](2026-07-27-diagnostico-toka-reporte-consumos.md).
**Esta meta lo mide y lo expone; no lo resuelve.**

---

## 5. Orden de ejecución y por qué

| Fase | Qué | Por qué en ese orden |
|---|---|---|
| **0 — Hoy, sin código** | L1 + L2 (5 decisiones, **$7,897**) + el rechazo perdido `OPS-4c814d9b6a9d`, comprobando recaptura antes de cada "gasto real" | Es dinero esperando decisión desde hace 8 días y no depende de nada. **La deriva Ops↔FC ya se midió a mano hoy: exactamente 1 registro**, así que el triage se puede decidir con la lista completa. C12 **formaliza** esa medición como script recurrente y se mueve a la fase 1 — su respuesta de hoy ya la tenemos |
| **1 — Código, alto impacto** | C1 + C2 + C3 + **C5b** | Apaga **5,884** (73 % del ruido) con cambios de *qué se cuenta*. **C5b sube a la fase 1**: es el único cambio que previene corrupción de datos, y la fase 3 no puede empezar sin él |
| **2 — Código, afinado** | C4 + C5 + C6 + C8 + C9 | Convierte la bandeja en algo priorizable por dinero y antigüedad, separa lo que espera a Ops, y saca las 179 anomalías blandas de los chips |
| **3 — Operativa continua** | L3 + L4 + L5 + L8 | Con el tablero ya limpio, el avance se ve; hoy se perdería entre 8,097 |
| **4 — Código, causa raíz** | C7 + C10 | El dedup de anomalías necesita que L3 haya validado el patrón contra casos reales |
| **5 — Producto** | D1 + L6 + L7 | Decisiones que requieren criterio de Tesorería/Operaciones |

**La fase 1 es la que hay que hacer bien.** Si solo se hiciera esa, el tablero pasa de 8,097 a 2,213
alarmas y ya distingue trabajo de archivo.

---

## 6. Riesgos y cómo se contienen

| # | Riesgo | Contención |
|---|---|---|
| R1 | Sacar el histórico de los chips se lee como "esconder datos" | No se borra ni se filtra nada: el filtro `historico` **ya existe** y la línea de contexto lo enlaza. Estado derivado, reversible moviendo `FUEL_VALIDACION_DESDE` |
| R2 | Excluir montacargas puede tapar abuso real en Gas LP | Chip propio en tono neutro, con su monto ($368,054). Se dejan de mezclar, no de ver |
| R3 | `kmDetectado` es un juicio humano sobre una foto; mal hecho corrompe el km/l | Queda auditado (`revisadoPor`, `fuenteDeteccion: manual`) y es reversible. No toca `kmCapturado` |
| R4 | El dedup de anomalías (C7) podría ocultar un retroceso legítimo (cambio de odómetro o de motor) | Solo colapsa cuando la pareja es **consecutiva en la misma unidad** y el salto previo explica el retroceso. Cualquier retroceso aislado sigue siendo hallazgo propio |
| R5 | Al bajar los números, algo real se vuelve invisible | Ningún registro sale del dataset. Todos los cambios son de **presentación y agrupación**; la tabla sigue mostrando todo |
| R6 | Varias sesiones comparten el worktree | Stagear solo rutas propias, verificar rama antes de commitear |
| **R7** | 🔴 **Validar a mano un registro que Ops aún no ha resuelto lo congela**: `fuenteDeteccion: "manual"` activa el no-pisado y el veredicto de Ops nunca entra | C5b lo bloquea en la UI. Mientras no exista ese bloqueo, la regla es operativa: **verificar `opsStatus` antes de tocar cualquier registro** (§2.5-2) |
| **R8** | Marcar una rechazada como "gasto real" cuando existe una **recaptura aprobada** duplica el dinero | C4 muestra el aviso. Verificado: 1 de 7 rechazados de Ops tiene recaptura (eco 86) |
| **R10** | 🔴 **Divergencia silenciosa del odómetro**: una corrección de Tesorería (`kmDetectado`) sigue ganando sobre una corrección **posterior y oficial** de Ops (`kmForzadoPor`), que sí llega a FC pero solo pisa `kmCapturado` | C5b(b) lo previene canalizando la corrección a Ops. Verificado: 3 km forzados en Ops, los 3 propagados correctamente, ninguno con `kmDetectado` encima — el conflicto **aún no ha ocurrido** |
| **R11** | **El puente pierde eventos**: 1 rechazo de Ops nunca llegó a FC, así que el chip de triage sub-reporta | C12 lo detecta. No se puede prevenir desde FC: requiere reentrega desde Ops o el backfill |
| **R9** | Los números de este spec son una **foto en vivo** y se mueven en horas (pendientes 44 → 42 el mismo día, porque Ops aprobó 3) | Re-correr `audit-kpis.ts` antes de cada fase; los criterios de aceptación son **relativos** (que el ruido desaparezca, que los totales no cambien), no valores absolutos |

---

## 7. Verificación

1. **Tests unitarios de `buildKpisFuel`** para cada chip redefinido: entradas sintéticas con mezcla de
   motivos accionables/estructurales, montacargas/vehículos, histórico/vigente. `renderKpis.ts` es
   puro por diseño — es directamente testeable.
2. **Test de C7** con la pareja real (salto 885,415 → retroceso 88,745 del eco 12): debe producir
   **un** hallazgo, no dos. Y un retroceso aislado debe seguir produciendo el suyo.
3. **Re-correr la auditoría** antes y después: `tests/fixtures/audit-kpis.ts`. Criterio de aceptación
   doble: (a) los 5,884 registros estructurales/históricos **ya no aparecen como alarma**, y (b)
   **ningún total del universo cambia** — 6,111 registros · 1,585 cargas · $1,882,743 · 5.76 km/l ·
   75,887 L. Si un total se mueve, el cambio dejó de ser de presentación y hay que revertirlo.
4. **Suite completa + typecheck** en verde antes de desplegar (referencia: 190/190 archivos propios;
   los 14 fallos fantasma son specs de Playwright de worktrees hermanos).

---

## 8. Fuera de alcance

- Conciliación Toka (D1 solo se mide y se expone).
- OCR/visión para leer el odómetro automáticamente — `kmDetectado` es manual y con eso basta hoy.
- Tocar el motor de ventanas de km/l: los 343 "suman a ventana" son **correctos**, solo están mal
  presentados.
- Rediseño visual del módulo más allá de la jerarquía de las tres capas (el programa UX vive aparte).
- Backfill o borrado de los 4,261 del histórico: son evidencia y se quedan.
