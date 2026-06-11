# Auditoría incremental Control-Flotilla — 2026-06-10

**Resumen ejecutivo para Dirección General**
Fecha de la auditoría: 2026-06-10 · Cuarta pasada · Versión en producción: AWS Amplify Hosting (jobs #83–#88)

---

## Contexto: qué es esta auditoría y qué cambió desde el 04-06

Control-Flotilla es la aplicación de inspección y control de la flota vehicular de GPA: captura inspecciones mensuales y semanales por unidad, calcula el riesgo de cada vehículo (Urgente / Revisar / Operativa), gestiona los ingresos a taller con su costo, y produce los reportes que consumen Operaciones y Tesorería. Hoy opera en modo **nube multiusuario** (varios inspectores y oficinas escribiendo contra una base común en AWS), no solo como archivo local.

La **auditoría base del 2026-06-04** detectó 16 defectos de máxima gravedad (P1) además de un conjunto amplio de hallazgos de segundo y tercer orden. Entre el 06 y el 10 de junio se corrigieron y desplegaron esos arreglos (jobs Amplify #83 a #88), incluyendo dos fases nuevas de funcionalidad multiusuario: **Fase C1** (sincronización de hallazgos atendidos entre usuarios) y **Fase C2** (sincronización de registros de taller con claves estables).

Esta cuarta pasada hace tres cosas: (1) **verifica** si los 16 P1 quedaron realmente corregidos; (2) busca **defectos nuevos**, sobre todo en el código recién desplegado (C1, C2, arranque PWA, replica del webhook); y (3) evalúa los **vacíos de alto valor** que separan a la aplicación de poder reemplazar definitivamente al sistema anterior (el "cutover").

**Lectura rápida de la salud:** el código desplegado es de buena calidad técnica (compila limpio, 581 pruebas en verde, 0 vulnerabilidades de runtime). La corrección de los 16 P1 fue mayormente exitosa. Sin embargo, **las nuevas funciones multiusuario reabrieron riesgos de pérdida silenciosa de datos** y hay **una réplica del cálculo de riesgo en el servidor (webhook) que no recibió un arreglo que sí se aplicó en el resto** — clasificada P1 nueva.

---

## A. Estado de los hallazgos previos

### Conteo global por status (80 hallazgos previos verificados)

| Status    | 16 P1 base | Otros previos (64) | Total  |
| --------- | :--------: | :----------------: | :----: |
| FIXED     |     15     |         21         |   36   |
| PARTIAL   |     1      |         5          |   6    |
| OPEN      |     0      |         36         |   36   |
| UNKNOWN   |     0      |         2          |   2    |
| **Total** |   **16**   |       **64**       | **80** |

> Los 2 UNKNOWN son los hallazgos sobre Docker/nginx, **excluidos del alcance** porque la producción actual es Amplify, no contenedores: no representan riesgo vivo. Los 36 OPEN se concentran en P2/P3 (defectos de bajo a medio impacto, en su mayoría de consistencia visual o de casos borde, ninguno crítico).

### Detalle de los 16 P1 de la base 2026-06-04

| ID    | Hallazgo (resumen)                                                       | Status      |
| ----- | ------------------------------------------------------------------------ | ----------- |
| P1-01 | persistState borraba todas las fotos manuales al cargar el Excel mensual | FIXED       |
| P1-02 | Variante del anterior (caller rutinario)                                 | FIXED       |
| P1-03 | "sin fuga" clasificado como Urgente                                      | **PARTIAL** |
| P1-04 | Fecha serial de Excel desfasada un día en Semanales                      | FIXED       |
| P1-05 | Llave de checklist embebía el valor de mm de la llanta                   | FIXED       |
| P1-06 | El PDF de flota se caía siempre (color sin definir)                      | FIXED       |
| P1-07 | Filtro de rango semanal descartaba todas las entradas                    | FIXED       |
| P1-08 | Variante del filtro de rango (XLSX manual)                               | FIXED       |
| P1-09 | Excel de taller exportaba Gasto Total = 0                                | FIXED       |
| P1-10 | Editar fecha/placa de taller creaba duplicado fantasma en la nube        | FIXED       |
| P1-11 | fechaEntrada de taller caía a updatedAt → registro nuevo en cada edición | FIXED       |
| P1-12 | Desmarcar un hallazgo se perdía y "resucitaba" para todos                | FIXED       |
| P1-13 | Llave de hallazgo inconsistente entre el camino local y el de la nube    | FIXED       |
| P1-14 | Variante del anterior                                                    | FIXED       |
| P1-15 | Llave de checklist con mm → completaciones huérfanas al re-inspeccionar  | FIXED       |
| P1-16 | Hallazgos binarios usaban la etiqueta como llave                         | FIXED       |

**15 de 16 P1 quedaron corregidos y verificados.** El único PARTIAL es **P1-03**: el arreglo de "sin fuga" se aplicó al motor del navegador y al módulo TypeScript, **pero no a la copia del cálculo que vive en el webhook del servidor** (el que ingiere las inspecciones enviadas desde la app móvil MoreApp). Esa omisión es la base del nuevo hallazgo P1 **N-WH-01** (sección B).

---

## B. Hallazgos nuevos priorizados

Se confirmaron **28 hallazgos nuevos** (cada uno verificado por revisión cruzada): **1 P1, 14 P2 y 13 P3**. Tres sospechas adicionales se descartaron por no reproducir.

### P1 — 1 hallazgo (crítico)

| ID          | Hallazgo                                                                                                                                                                                                                            | Impacto operativo                                                                                                                                                                                                                                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **N-WH-01** | El arreglo de "sin fuga" (P1-03) **no se aplicó a la réplica del cálculo de riesgo en el webhook del servidor**. El webhook sigue evaluando "Urgente" antes que "OK", de modo que "sin fuga" / "no hay fuga" devuelven **Urgente**. | Una unidad **sana** ingerida por la app móvil aparece como **Urgente** para todos los usuarios: distorsiona el tablero, los KPIs y el botón "Enviar a Taller". Lo grave es que Dirección cree que ya está corregido (porque el arreglo se desplegó en otras dos capas). Requiere reordenar el bloque y **re-procesar (backfill) las semanales ya ingeridas**. |

### P2 — 14 hallazgos (alto). Los más relevantes:

| ID                                   | Hallazgo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Impacto operativo                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **N-LP-01**                          | Borrar un período semanal **no lo elimina de la nube**: reaparece en ≤4 min (al refrescar) en todos los usuarios.                                                                                                                                                                                                                                                                                                                                                                        | Corregir una semana mal cargada es **imposible** desde la interfaz en modo nube.                                                        |
| **N-LP-04 / N-WH-01** (relacionados) | Una misma inspección cargada por Excel manual (fecha "02/06/2026") y por el webhook (fecha "2026-06-02") crea **dos filas** porque el formato de fecha difiere.                                                                                                                                                                                                                                                                                                                          | La unidad aparece **duplicada** en tabla y KPIs; flota inflada y porcentaje de urgentes distorsionado.                                  |
| **N-API-01**                         | Si la sesión arranca sin red (o con usuario mal configurado), la capa nube queda **muerta toda la sesión**: ni carga datos ni se recupera al volver la red.                                                                                                                                                                                                                                                                                                                              | La PWA de campo queda **sin datos** hasta recargar manualmente; usuario sin `tenantId` entra en un callejón sin salida sin diagnóstico. |
| Otros P2                             | N-C2-01/02/03/05 (taller: el borrado de otro usuario se deshace solo; la guarda anti-resurrección no se persiste; migración que oculta registros con error de subida; segundo ingreso del día pisa al primero). N-LR-01/02 (al cambiar el rango de fechas, riesgos sin recalcular y el auto-refresco **resetea el rango que eligió el usuario** cada 4 min). N-PWA-01 (un despliegue recarga la pestaña y **pierde lo que el usuario estaba capturando**). N-LP-02/03, N-C1-01, N-WH-02. | Riesgo recurrente de **pérdida silenciosa de datos** o de conteos contradictorios entre operadores.                                     |

### P3 — 13 hallazgos (bajo–medio)

Casos borde de consistencia: corte temporal por día/zona horaria que muestra atendido un hallazgo re-reportado al día siguiente (N-C1-01/N-LR-04); fan-out de marcas que no cubre meses fuera del rango activo; el PDF lista hallazgos ya atendidos como pendientes (N-LR-05); doble subida de fotos semanales (N-LP-05); LIST completo de S3 en cada refresco por una foto huérfana (N-API-02). Ninguno es bloqueante por sí solo.

> **Nota honesta:** la sección de hallazgos nuevos **P1 NO está vacía** — hay exactamente **1 (N-WH-01)**, y es importante porque revierte parte del beneficio del arreglo P1-03 ya desplegado. Es el único defecto nuevo de gravedad crítica; el resto del trabajo reciente no introdujo nuevos críticos.

---

## C. Top 5 vacíos (gaps) de alto valor

De 41 vacíos catalogados, 11 bloquean el cutover. Los 5 de mayor valor:

| #   | Gap                                                                                                                                                                                                                                                                                   | Categoría         | Impacto | Esfuerzo | ¿Bloquea cutover? |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------- | -------- | :---------------: |
| 1   | **No existe cola de escritura offline persistente** — toda escritura a la nube es "dispara y olvida" en memoria. Es la raíz de la pérdida silenciosa de marcas, registros de taller y fotos cuando hay un corte de red.                                                               | Técnico           | Alto    | ~24 h    |      **Sí**       |
| 2   | **El plan de cutover es técnicamente inviable hoy**: la capa nube viva está acoplada al monolito HTML por decenas de enganches `window.*`. Archivar el HTML rompería el sync multiusuario en producción. El "matar el legado" del M4 2026-09-01 no es alcanzable sin re-arquitectura. | Técnico           | Alto    | ~40 h    |      **Sí**       |
| 3   | **Reportes en PDF no migrados / sin fotos fiables**: la sección Registro Fotográfico, las Notas de seguimiento y el **PDF ejecutivo de toda la flota** no existen en la capa nueva; en modo nube el PDF sale con casillas vacías. Es la evidencia que Dirección y Tesorería consumen. | Operativo/Técnico | Alto    | ~46 h    |      **Sí**       |
| 4   | **Fixtures E2E inexistentes + CI apagado por billing**: la suite de regresión automática no corre en clon limpio ni en integración continua. No se puede **certificar paridad** automáticamente antes de un cutover que toca reportes financieros.                                    | Técnico           | Alto    | ~6 h     |      **Sí**       |
| 5   | **Sin analítica de costo de taller por sucursal ni tendencia mensual**: Tesorería no puede responder "cuánto gastó MTY vs GDL este trimestre" sin tabular a mano. El dato existe; falta la agregación.                                                                                | Operativo         | Alto    | ~14 h    |        No         |

> Los 3 documentos de planeación (ROADMAP / CUTOVER_PLAN / FEATURE_PARITY) están **desactualizados ~50 días** y no contemplan la capa nube, que es lo único en producción. Cualquier decisión de fecha de cutover se tomaría hoy sobre información falsa.

---

## D. Alertas de lógica de negocio (solo inconsistencias confirmadas)

Se confirmaron **13 inconsistencias** entre los dos motores de cálculo que conviven (el del navegador y el de TypeScript/servidor). Las de mayor impacto para una decisión de Tesorería ("¿mandar la unidad a taller?"):

1. **Aceite de motor bajo:** el motor del navegador lo marca **Urgente** (no operativa); el de la nube lo marca solo **Revisar**. La misma unidad sale en estados distintos según qué motor la procese.
2. **Servicio vencido:** escala a **Urgente** en la nube pero **no escala** en el navegador (la tabla que ve Tesorería puede mostrarla "OK").
3. **Sin llanta de refacción:** **Completar** en el navegador, **Revisar** en la nube.
4. **7 ítems de carrocería/checklist** (golpes, molduras, tacómetro, espejo, luces, asientos, tapetes): **Revisar** en el navegador, **Completar** en la nube.
5. **Webhook "sin fuga" → Urgente** (mismo origen que N-WH-01).
6. **Costos de taller:** dos vistas reportan **$0 de gasto** cuando deberían usar el desglose — el "Gasto acumulado activas" del resumen ejecutivo (L4330) y el "Gasto Total" del expediente por unidad (L6900). Tesorería ve $0 aunque haya cientos de miles capturados.
7. **Sincronización de hallazgos atendidos:** el sello de tiempo lo pone el **reloj del cliente** (sin autoridad de servidor). Con relojes desincronizados, un desmarcado real-posterior puede **perder** contra un marcado más viejo, mostrando "atendido" algo que sigue pendiente; agravado por el corte temporal por día y por un registro `dirty` que nunca se limpia.

> **Confirmación positiva:** la exclusividad de los 4 niveles de riesgo, los normalizadores de campo (fluidos/carrocería/llantas), el algoritmo de semana ISO y el cálculo de días en taller **son consistentes**. Las inconsistencias se concentran en la **divergencia entre los dos motores de riesgo** y en **dos sumas de costo de taller**.

---

## Veredicto final de salud del sistema

**Calidad de código: buena.** Compila limpio, 581 pruebas en verde, 0 vulnerabilidades de runtime, CSP sincronizada. La remediación de los 16 P1 fue exitosa (15 FIXED, 1 PARTIAL).

**Riesgo operativo vivo: moderado-alto y concentrado.** El problema dominante no es la calidad del código nuevo sino su **arquitectura de sincronización**: toda escritura a la nube es "dispara y olvida", sin cola offline ni reintento, en una operación de campo con red intermitente. Esto produce **pérdida silenciosa de datos** (marcas, registros de taller, períodos semanales borrados que resucitan) que socava la confianza en los reportes. A esto se suma **1 P1 nuevo (N-WH-01)** que hace que unidades sanas se vean Urgentes, y **13 inconsistencias de motor de riesgo** que pueden dar veredictos opuestos sobre la misma unidad.

**Listo para producción diaria: sí, con vigilancia.** La app es usable y los datos locales se preservan. **No lista para el cutover formal** (apagar el sistema anterior): el plan de cutover está desactualizado y es inviable técnicamente hoy, faltan los reportes PDF clave, y no hay red de regresión automática.

**Prioridades inmediatas:** (1) corregir N-WH-01 y re-procesar las semanales; (2) **unificar los dos motores de riesgo** (eliminar las 13 inconsistencias); (3) construir la **cola de escritura offline persistente**; (4) reescribir los documentos de cutover sobre la arquitectura nube real.
