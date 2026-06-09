# Auditoria 2026-06-03 — detalle de 39 confirmados

## #4 [P2 | fixRisk:high | reach:true | high] data-cloud

**Migracion auto de taller en hydrate refetch-ea pero sigue sobre arrays mutados; orphan-detection por id fragil**

- **@** src/api/cloudHydrate.ts:195-246
- **Desc:** La auto-migracion detecta orphans comparando e.id contra cloudIds construido de `datos.id ?? t.folio` (lineas 198-203). En uploadTallerToCloud el folio se setea = e.id (batchUpload.ts:424) y datos=e (incluye id). Pero el composite key de Taller es (tenantId, unitUid, fechaEntrada); si dos entries locales distintos comparten unitUid+fechaEntrada (p.ej. mismo dia, misma unidad, dos reportes), el segundo upsert SOBREESCRIBE al primero en cloud. Tras el refetch (linea 238-240) ambos ids locales pueden mapear a un solo registro cloud, dejando uno como 'orphan' permanente que se re-migra (y re-sobreescribe) en cada hidratacion -> no idempotente.
- **Impacto:** Perdida silenciosa de un registro de taller cuando coinciden unidad+fechaEntrada, y migracion repetida en cada hydrate (escrituras redundantes a DynamoDB). Severidad P3 por requerir colision de fecha exacta.
- **Fix sugerido:** Incluir el id (o un discriminante) en el composite key de Taller, o detectar la colision de (unitUid, fechaEntrada) antes de subir y desambiguar la fechaEntrada; ademas marcar los entries ya migrados para no reintentar indefinidamente.

## #9 [P2 | fixRisk:low | reach:true | high] analyzer-state

**calcEstatusSemanal escala carrocería/llanta, contradiciendo la regla de 2 vitales usada en todo el resto del sistema**

- **@** src/analyzer/risk.ts:186
- **Desc:** La versión TS de calcEstatusSemanal arma `const risks = [aceiteRisk, radiadorRisk, carroceriaRisk, llantaRisk]` y hace `if (risks.includes("Urgente")) return "Urgente"; if (risks.includes("Revisar")) return "Revisar";` — es decir, carrocería y llanta SÍ escalan el estatus global. Esto contradice a TODAS las demás implementaciones del 'riesgo efectivo' de una unidad semanal: (a) el legado 'Control de flotilla.html:1563-1567' solo mira aceite/radiador; (b) el webhook 'amplify/functions/moreapp-webhook/handler.ts:366-370' computa y PERSISTE `risk` solo con aceite/radiador (2 args); (c) 'src/weekly/renderTableSemanales.ts:41-45' computeEffectiveRisk solo mira aceite/radiador; (d) el propio docstring del consumidor 'src/weekly/weeklyStore.ts:18-19' afirma 'Carrocería y llanta se ignoran por regla de negocio'. Como `weeklyStore.effRisk` (línea 21-29) llama a esta función con los 4 args, los KPIs (buildKpisFromEntries→effRisk) y la barra de períodos (renderPeriodoBar→effRisk) cuentan Urgente/Revisar de forma distinta a como la TABLA semanal filtra/muestra el estatus (computeEffectiveRisk) y distinto al `risk` ya guardado en el cloud.
- **Impacto:** Con el flag USE_NEW_WEEKLY activo: una unidad con aceite/radiador OK pero carrocería 'Golpe menor' (Revisar) o 'volcadura' (Urgente), o llanta 'ponchada' (Revisar), aparece como Revisar/Urgente en las TARJETAS KPI y en el conteo de la barra de período, pero la TABLA semanal (computeEffectiveRisk) la sigue mostrando OK y NO la incluye al hacer clic en el filtro 'Urgente'/'Revisar'. Resultado: el número de la tarjeta 'Urgente: N' no coincide con la cantidad de filas que aparecen al filtrar por Urgente — inconsistencia visible y desconcertante para el operador. Además el `risk` persistido por el webhook (2 vitales) ya no coincide con lo que la UI recomputa.
- **Fix sugerido:** Unificar a una sola regla (2 vitales). Cambiar calcEstatusSemanal para que solo considere aceite+radiador: `if (aceiteRisk==="Urgente"||radiadorRisk==="Urgente") return "Urgente"; if (aceiteRisk==="Revisar"||radiadorRisk==="Revisar") return "Revisar"; return "OK";` ignorando carroceriaRisk/llantaRisk (dejarlos como params informativos). Ajustar 'tests/risk.test.ts' (líneas 58-69) que actualmente afirman lo contrario. Idealmente eliminar la duplicación haciendo que renderTableSemanales.computeEffectiveRisk y weeklyStore.effRisk deleguen en la MISMA función calcEstatusSemanal para que filtro/KPIs/tabla/barra nunca puedan divergir.

## #15 [P2 | fixRisk:low | reach:false | high] main-table

**Lógica invertida en el shim: cuando filt() devuelve 0 resultados se descarta el filtro y se muestran TODAS las unidades**

- **@** src/main.ts:265
- **Desc:** renderTableShim hace: `rows = safeUnitArray(r, ...); if (rows.length === 0 && allUnits.length > 0) rows = allUnits;`. filt() (HTML:1656-1669) devuelve legítimamente [] cuando un filtro no matchea nada: búsqueda que no coincide (ej. eco '99999'), branch sin unidades (curB), chip Urgente/Revisar sin pendientes, curF='obs' sin observaciones, etc. En esos casos el shim trata el [] legítimo como si fuera un fallo y reemplaza el resultado por allUnits, mostrando la flota completa. Esto contradice directamente el render legado y el propio renderTableNew, que para units vacío muestran 'Sin resultados con los filtros actuales' (renderTable.ts:317-323). El contador rcnt (main.ts:275) además se calcula con rows.length DESPUÉS del override, por lo que mostrará '<total>/<total>' como si el filtro no estuviera aplicado.
- **Impacto:** Pérdida funcional del filtrado: el usuario filtra por sucursal/nivel/búsqueda, obtiene 0 coincidencias reales y en lugar del estado vacío correcto ve TODA la flota, dándole datos erróneos (unidades que NO cumplen el filtro). Especialmente grave con el filtro de sucursal y la búsqueda. Es una variante NUEVA (no cubierta en la auditoría previa) introducida en el shim, no en filt().
- **Fix sugerido:** Eliminar la línea `if (rows.length === 0 && allUnits.length > 0) rows = allUnits;`. El fallback a allUnits solo debe ocurrir cuando filt() LANZA (ya cubierto por el catch en main.ts:266-269), no cuando devuelve un array vacío válido. Un [] de filt() es un resultado legítimo y debe renderizarse como estado vacío.

## #20 [P2 | fixRisk:low | reach:false | high] detail-ui

**renderChecklist: el item completo es clickeable como toggle de 'done' (regresión vs legado) y sin accesibilidad de teclado**

- **@** src/ui/detail/renderChecklist.ts:247
- **Desc:** findingItem registra el click de toggle en TODO el elemento (el.addEventListener('click', () => onToggle(uid, f.text)), línea 247). En el legado solo el checkbox dedicado togglea done; el cuerpo del hallazgo dispara openMnPhotoForFinding (Control de flotilla.html:3276-3284). El nuevo render elimina esa distinción: cualquier clic en el texto marca/desmarca atendido. Además es un <div> con click sin role='button' ni tabindex, inalcanzable por teclado.
- **Impacto:** El usuario que intenta ver/abrir la foto del hallazgo (gesto del legado) marca accidentalmente el hallazgo como atendido, recalculando risk (recalcRisk) y propagando un CheckDone compartido erróneo a todos los usuarios del tenant. Pérdida silenciosa de estado correcto. Sin acceso por teclado para usuarios que no usan mouse.
- **Fix sugerido:** Replicar el modelo legado: un checkbox/zona explícita para toggle (con stopPropagation) y dejar el cuerpo para otra acción o no-op. Añadir role='button', tabindex=0 y handler keydown (Enter/Espacio) si el item es interactivo.

## #22 [P2 | fixRisk:low | reach:true | high] detail-ui

**renderService weeklyCrossRefCard: ordena por localeCompare de label de período, no por fecha real — 'última revisión' puede no ser la más reciente**

- **@** src/ui/detail/renderService.ts:135
- **Desc:** candidates.sort((a,b) => (b.\_periodo||'').localeCompare(a.\_periodo||'')) (línea 135) ordena descendente por el LABEL textual del período, asumiendo formato ISO-ordenable. Pero los labels de período provienen de WeeklyPeriodo.label (humano, p.ej. 'Semana 23' o '2026-06 Junio') y no necesariamente ordenan cronológicamente. Se ignora latest.fecha (que sí existe en la entry) para elegir la entrada más reciente.
- **Impacto:** La tarjeta 'Última revisión semanal' puede mostrar una entrada que NO es la más reciente cuando los labels no son lexicográficamente ordenables por fecha (p.ej. 'Semana 9' > 'Semana 10' por localeCompare). Datos de aceite/radiador mostrados desactualizados.
- **Fix sugerido:** Ordenar por la fecha real de la entry (e.fecha parseada a Date) en vez del label del período, o por periodo.id si éste es ISO-ordenable. Fallback a label solo si no hay fecha.

## #25 [P2 | fixRisk:low | reach:true | high] taller

**El KPI 'Dias Prom. real (finalizados)' ignora los filtros activos (sucursal/tipo/search)**

- **@** src/taller/renderActivasKpis.ts:110-115
- **Desc:** compArr (promedio real de finalizados) se construye iterando `for (const e of entries)` sobre TODAS las entradas crudas, sin pasar por matchesFilter ni por latestPerUnit. En cambio estArr y revArr (lineas 116-126) se construyen desde `filtered`, que si respeta el filtro. Como el display de 3-tier prioriza promDiasComp (renderActivasKpis.ts:493 `prom = kpis.promDiasComp ?? ...`), cuando hay finalizados el numero mostrado es el promedio GLOBAL, no el de la sucursal/tipo seleccionado.
- **Impacto:** Al filtrar por sucursal=MTY, la card 'Dias Prom. Estancia' sigue mostrando el promedio de TODA la flota finalizada (incluye GDL, CDMX, etc.), contradiciendo el resto de cards que si se filtran. El usuario de Tesoreria/Taller interpreta mal la metrica por sucursal. Ademas compArr cuenta por-visita (multiples cierres de la misma unidad) mientras estArr/revArr cuentan por-unidad-latest: bases poblacionales inconsistentes entre tiers.
- **Fix sugerido:** Construir compArr desde `filtered`-equivalente respetando matchesFilter, o desde un conjunto cerrado-filtrado coherente. P.ej.: `for (const e of entries) if (isClosed(e) && matchesFilter(e, filter) && e.fentrada && e.fsalidaReal) {...}`. Unificar la base poblacional de los 3 tiers (todas por-visita o todas por-unidad).

## #27 [P2 | fixRisk:low | reach:true | high] taller

**Cerradas sin fentrada se filtran como dentro del rango (desde/hasta no las excluyen)**

- **@** src/taller/renderHistorial.ts:136
- **Desc:** Los filtros de rango usan `if (filter.desde && e.fentrada && e.fentrada < filter.desde) continue;` y el analogo para hasta. El `&& e.fentrada` hace que una entrada cerrada SIN fentrada nunca cumpla la condicion de exclusion, por lo que se cuenta como si estuviera dentro de cualquier rango.
- **Impacto:** Al filtrar 'periodo filtrado', unidades cerradas sin fecha de entrada (datos legacy o importes Excel con columna de fecha vacia, ver Control de flotilla.html:6633 fmtDate puede devolver vacio) se cuelan en los totales de gasto y conteo del periodo. La metrica 'Gasto Total (periodo)' incluye gastos de visitas sin fecha que el usuario creia haber excluido.
- **Fix sugerido:** Tratar la ausencia de fentrada como fuera de rango cuando hay filtro activo: `if ((filter.desde || filter.hasta) && !e.fentrada) continue;` antes de las comparaciones, o `if (filter.desde && (!e.fentrada || e.fentrada < filter.desde)) continue;`.

## #29 [P2 | fixRisk:low | reach:true | high] taller

**latestClosed puede no ser el cierre mas reciente cuando una entrada activa tiene updatedAt mayor**

- **@** src/taller/renderHistorial.ts:148-161
- **Desc:** row.latestClosed se inicializa con la PRIMERA entrada de la unidad (linea 124, puede ser activa). En el loop solo se actualiza para entradas cerradas (linea 148) comparando updatedAt. Si la entrada activa inicial tiene updatedAt mayor que todas las cerradas, ninguna cerrada lo desplaza. El fix post-loop (158-161) detecta que latestClosed sigue no-cerrado y lo reemplaza por `r.entries.find(isClosed)` = la PRIMERA cerrada en orden de insercion, no la de updatedAt mas reciente.
- **Impacto:** La fila del historial (placas, modelo, sucursal, fentrada, fsalidaReal, tipo pill que se muestran via lc=latestClosed) puede reflejar un cierre ANTIGUO en vez del ultimo, cuando la unidad esta actualmente activa con updatedAt reciente. Datos de salida/fechas mostrados pueden corresponder a la visita equivocada.
- **Fix sugerido:** Inicializar latestClosed en null/undefined y solo asignarlo dentro del bloque de cerradas eligiendo siempre el mayor updatedAt: `if (!row.latestClosed || (e.updatedAt??'') > (row.latestClosed.updatedAt??'')) row.latestClosed = e;` sin el sesgo del init activo, y eliminar el parche post-loop (o que el parche escoja el de mayor updatedAt entre las cerradas, no el primero).

## #0 [P2 | fixRisk:medium | reach:true | high] data-cloud

**Filtro Desde/Hasta y \_\_inspMin/MaxDate rotos para checklists con fecha DD/MM/YYYY (vista cloud queda vacia)**

- **@** src/api/cloudHydrate.ts:368-391
- **Desc:** El path principal **cloudSyncUnits -> uploadUnitsToCloud (batchUpload.ts:220) guarda `fecha = String(u.fecha).trim()` RAW, y el legacy produce u.fecha en formato DD/MM/YYYY (fDate en 'Control de flotilla.html:1370-1376' y toLocaleDateString('es-MX') en 1373/2150-2151). En cloudHydrate: monthOf() acepta DMY (linea 90-91) por lo que la fila NO se descarta y entra a inspections; pero luego (a) fechas = inspections.map(i=>fecha.slice(0,10)) -> '15/05/2026' y se hace `.sort()` lexicografico, dejando **inspMinDate/\_\_inspMaxDate incorrectos; y (b) applyDateRange compara `f >= from && f <= to` con from/to en ISO (el <input type=date> emite '2026-05-01'). '15/05/2026' >= '2026-05-01' es siempre false ('1' < '2').
- **Impacto:** En cualquier tenant cuyos checklists se subieron por el path uploadUnitsToCloud (DMY), al usar el control Desde/Hasta TODAS las filas se filtran -> tabla vacia, KPIs en 0. Ademas \_\_inspMaxDate mal calculado puede hacer que el mes default (linea 375-376 maxMonth) no sea el mas reciente. Convive con checklists subidos por uploadZipToCloud (ISO via split(/[ T]/)), produciendo orden y rangos inconsistentes en el mismo tenant.
- **Fix sugerido:** Normalizar la fecha a ISO YYYY-MM-DD en la frontera de escritura (batchUpload.uploadUnitsToCloud, antes del upsertChecklist) reutilizando la logica de monthOf/parse DMY->ISO, o normalizar en hydrate al construir inspections (convertir DMY a ISO antes de slice/sort/compare). Toda comparacion de rango y el composite key de Checklist deben usar ISO consistente.

## #2 [P2 | fixRisk:medium | reach:true | high] data-cloud

**Cloud 'fuente de verdad' no reconcilia desmarcados: deleteCheckDone de otro usuario no quita el done local**

- **@** src/api/cloudHydrate.ts:489-497
- **Desc:** La fusion de CheckDones solo AGREGA dones (linea 490 `if (cd.done === false) continue;`) y nunca elimina completaciones locales ausentes/borradas en el cloud. \_\_cloudSetCheck con done=false hace deleteCheckDone (cloudWire.ts:319-321), por lo que un desmarcado NO produce un registro done=false sino la AUSENCIA del registro. El merge no tiene pase de reconciliacion que recorra el checklistDB local y elimine los items cuyo CheckDone ya no existe en el cloud.
- **Impacto:** Contradice el contrato 'el cloud es la fuente de verdad' (comentario linea 485). Usuario A desmarca un hallazgo (borra el CheckDone en cloud); usuario B, que lo tenia done en su IndexedDB/checklistDB, NUNCA lo ve volver a pendiente al hidratar. Estado divergente persistente multi-usuario; los KPIs/risk de B siguen contando el hallazgo como atendido.
- **Fix sugerido:** Tratar el set de CheckDones del cloud como autoritativo: construir el cdb desde cero a partir de los CheckDones cloud para los uids presentes (o un set de claves esperadas), eliminando del checklistDB local los items que ya no existan en cloud. Alternativamente persistir done=false en cloud y respetarlo en el merge.

## #5 [P2 | fixRisk:medium | reach:true | high] backend-webhook

**processSemanal lee el dataName equivocado para la llanta de refacción → llantaRisk siempre "OK"**

- **@** amplify/functions/moreapp-webhook/handler.ts:596
- **Desc:** En processSemanal se lee `const llanta = pickStr(answers.llantaDeRefaccionFuncional);`. El dataName real de MoreApp para ese campo es `cuentaConLlantaDeRefaccin` (así está mapeado en FIELD_MAP línea 64: `cuentaConLlantaDeRefaccin: "Cuenta con llanta de Refacción?"`). No existe ningún dataName `llantaDeRefaccionFuncional` en el payload de MoreApp (ese string es el nombre de COLUMNA legacy del Excel, no el dataName del form). Por lo tanto `answers.llantaDeRefaccionFuncional` es siempre `undefined`.
- **Impacto:** `llanta` queda siempre `""`. `normTireRisk("")` retorna `"OK"` (línea 324: `if (!v) return "OK"`). Resultado: en TODOS los reportes semanales ingeridos por webhook/backfill, `llantaRisk` se persiste como "OK" y `llanta` como cadena vacía, sin importar el estado real de la refacción. Es pérdida silenciosa de una señal de riesgo: una unidad sin refacción funcional nunca se marca como tal en el modelo Semanal. No hay error ni excepción; el dato simplemente se pierde.
- **Fix sugerido:** Cambiar la lectura por el dataName real y aplicar la misma semántica de gating que el mensual: `const llanta = pickStr(answers.cuentaConLlantaDeRefaccin);`. Idealmente confirmar el dataName exacto con el endpoint `?sample=1&form=<SEMANAL_FORM_ID>` antes de fijarlo, y considerar reusar la lógica `tieneRefaccion` de analyzeRow para coherencia con el mensual.

## #11 [P2 | fixRisk:medium | reach:true | high] analyzer-state

**Gating de refacción y llantas internas usa comparación estricta `!== "no"`: negativos compuestos ('No cuenta', 'No tiene', 'Ninguna') se tratan como 'tiene'**

- **@** src/analyzer/analyzeRow.ts:42
- **Desc:** `const tieneRefaccion = String(refRaw).trim().toLowerCase() !== "no";` solo detecta el literal exacto 'no'. Cualquier respuesta negativa con texto adicional — 'No cuenta', 'No tiene', 'Ninguna', 'Sin refacción' — produce `tieneRefaccion = true`, por lo que NO se genera el finding 'Sin llanta de refacción funcional' (línea 43-46) ni se hace bump('Revisar'), y además NO se saltea el TACO de refacción (línea 59). El mismo patrón estricto está en el gating de llantas internas (líneas 49-56). Contrasta con normTireRisk en risk.ts:166 que sí maneja `v.startsWith("no ")`.
- **Impacto:** Una unidad que reporta 'No cuenta con refacción' (o cualquier negativa que no sea exactamente 'No') NO se marca como sin refacción → el operador no ve la alerta de refacción faltante. Subnotificación de un hallazgo de seguridad/operación. El impacto real depende de cuán estandarizada esté la captura en MoreApp (típicamente 'Sí'/'No', lo que acota la frecuencia), por eso P3.
- **Fix sugerido:** Normalizar la negación igual que normTireRisk: `const v = String(refRaw).trim().toLowerCase(); const tieneRefaccion = !(v === "no" || v.startsWith("no ") || v.includes("sin refacc") || v === "ninguna" || v === "ninguno");` Aplicar la misma lógica al gating de llanta piloto/copiloto interna (líneas 49-56).

## #12 [P2 | fixRisk:medium | reach:true | medium] analyzer-state

**Dos implementaciones duplicadas y divergentes de 'riesgo efectivo' + dos filtros semanales distintos (misma raíz que P1, riesgo de regresión futura)**

- **@** src/weekly/weeklyStore.ts:21
- **Desc:** Coexisten dos definiciones del estatus efectivo semanal que NO coinciden: weeklyStore.effRisk (línea 21, vía calcEstatusSemanal 4-arg → incluye carrocería/llanta) y renderTableSemanales.computeEffectiveRisk (línea 41, solo aceite/radiador). Además hay dos filtros semanales divergentes: weeklyStore.applyWeeklyFilters (línea 131, búsqueda numérica = eco EXACTO, usa effRisk) vs renderTableSemanales.filterAndSortWeekly (línea 49, búsqueda substring sobre eco/plate/brand/branch/responsable, usa computeEffectiveRisk). Cada render usa una u otra, por lo que el mismo dato produce conteos/orden/resultados de búsqueda distintos según el componente.
- **Impacto:** Además de la inconsistencia KPI-vs-tabla descrita en P1, el comportamiento de búsqueda difiere entre vistas: en la tabla, teclear '200' hace match por substring en cualquier campo; en applyWeeklyFilters, '200' exige eco EXACTAMENTE '200'. Un mantenedor que corrija una de las dos funciones dejará la otra desincronizada, perpetuando bugs de conteo. Riesgo de correctness latente y alto costo de mantenimiento.
- **Fix sugerido:** Consolidar en una sola fuente: exportar calcEstatusSemanal corregido (2 vitales, ver P1) y hacer que TANTO weeklyStore.effRisk COMO renderTableSemanales.computeEffectiveRisk lo invoquen (eliminar computeEffectiveRisk o reimplementarlo como wrapper). Unificar también la semántica de búsqueda (decidir substring vs eco-exacto) en una única función de filtro reutilizada por tabla y KPIs.

## #31 [P2 | fixRisk:medium | reach:true | high] weekly

**Incoherencia de riesgo efectivo entre KPIs/chips (effRisk) y tabla/filtro (computeEffectiveRisk): conteos que no cuadran**

- **@** src/weekly/renderTableSemanales.ts:41
- **Desc:** Existen DOS funciones de 'riesgo efectivo' con reglas distintas. effRisk() en weeklyStore.ts:21-29 llama calcEstatusSemanal(aceite, radiador, carroceria, llanta) que escala los 4 vitales (risk.ts:180-190: si CUALQUIERA es Urgente -> Urgente; si CUALQUIERA es Revisar -> Revisar). En cambio computeEffectiveRisk() en renderTableSemanales.ts:41-45 SOLO mira aceite+radiador e ignora carroceria+llanta. effRisk es la base de los KPIs (renderKpisSemanales.ts:90 via buildKpisFromEntries -> weeklyStore.ts:90) y del badge de urgentes en los chips semanales (renderPeriodoBar.ts:172). computeEffectiveRisk es la base de las filas de la tabla, su clase de color, el badge 'Estado' y el FILTRO por riesgo (renderTableSemanales.ts:62,77,340,380). Por tanto una unidad con aceite=OK, radiador=OK, carroceria=Urgente (p.ej. 'volcadura', risk.ts:99-116) cuenta como Urgente en el KPI/chip pero como OK en la tabla.
- **Impacto:** El usuario hace clic en la tarjeta 'Atención Urgente' (que dice, p.ej., 5) y la tabla filtrada por 'Urgente' muestra menos filas (p.ej. 3) porque las urgencias por carroceria/llanta no escalan en computeEffectiveRisk. Conteos de KPI y badges de chips no cuadran con las filas; una unidad volcada aparece como 'Operativa' verde en la columna Estado. Riesgo operativo real para GPA: una unidad fuera de servicio se reporta como operativa.
- **Fix sugerido:** Unificar a UNA sola fuente de verdad. Eliminar computeEffectiveRisk y usar effRisk/calcEstatusSemanal en renderTableSemanales (importar desde weeklyStore), o viceversa, segun la regla de negocio deseada. Si la tabla debe escalar los 4 vitales como los KPIs, reemplazar computeEffectiveRisk(e) por effRisk(e) en lineas 62, 77, 340 y 380. Documentar la regla unica en un solo lugar.

## #1 [P3 | fixRisk:low | reach:false | high] data-cloud

**urlCache de fotos sin clave de tenant: cache hit devuelve URL firmada de otro tenant antes de verificar pertenencia**

- **@** src/api/photoFetch.ts:73-77
- **Desc:** getCloudPhotoUrl cachea por `key = filename.toLowerCase()` SIN prefijo de tenant (urlCache, linea 13). En linea 75 el cache-hit (`return cached.url`) ocurre ANTES del guard `if (!hasCloudPhoto(tenantId, key)) return null` (linea 77). hasCloudPhoto si esta indexado por tenant, pero nunca se llega a evaluar en un hit. clearPhotoCache() existe (linea 144) pero NO se invoca en ningun lado: logout() (auth.ts:72-74) solo hace signOut(), y \_\_cloudPhotoUrlMap (cloudHydrate.ts:439) tampoco se limpia.
- **Impacto:** Tras logout/login como un tenant distinto en el mismo navegador, si dos tenants tienen una foto con el MISMO filename (los nombres de MoreApp suelen ser secuenciales/poco unicos), el segundo tenant recibe la URL firmada que apunta a photos/{tenantA}/foto.jpg (firmada bajo el path y credenciales del tenant A). Fuga de imagen entre tenants y, en general, datos obsoletos servidos sin re-verificar pertenencia.
- **Fix sugerido:** Incluir tenantId en la clave de urlCache (`${tenantId}/${filename}`) y de **cloudPhotoUrlMap, y/o llamar clearPhotoCache() (mas limpiar window.**cloudPhotoUrlMap) en logout() y al detectar cambio de tenantId en setupCloud. Como minimo, mover el guard hasCloudPhoto ARRIBA del cache-hit.

## #3 [P3 | fixRisk:low | reach:true | medium] data-cloud

**Hidrataciones concurrentes (sync fire-and-forget + auto-refresh) sin lock comun mutan window.units / \_\_cloudPhotoUrlMap**

- **@** src/api/cloudWire.ts:172-174
- **Desc:** **cloudSyncUnits/**cloudSyncSemanales/**cloudSyncTaller disparan `void hydrateFromCloud(...)` fire-and-forget (cloudWire.ts:172, 193, 213) y **cloudSyncPhotos hace `await hydrateFromCloud` (cloudWire.ts:284). El guard `running` solo existe dentro de setupAutoRefresh.refresh (cloudWire.ts:406) y NO protege estas invocaciones. Por tanto pueden correr 2+ hydrateFromCloud simultaneos.
- **Impacto:** Dos hydrateFromCloud concurrentes mutan estado compartido sin sincronizacion: window.units, window.**inspections, window.**fleetUnits, window.checklistDB y especialmente existingMap=window.**cloudPhotoUrlMap (cloudHydrate.ts:439-483, lecturas/escrituras intercaladas con awaits de red). El interleaving puede dejar window.units de una corrida y **cloudPhotoUrlMap a medio poblar de otra, produciendo fotos 'No disponible' o conteos KPI transitorios incorrectos; en el peor caso un render con units de un periodo y checklistDB de otro.
- **Fix sugerido:** Serializar hydrateFromCloud con un mutex/promesa-singleton a nivel modulo (p.ej. una variable `inFlight: Promise|null` que se reusa) compartida entre el auto-refresh y todas las invocaciones de cloudWire, en vez de un flag local solo del auto-refresh.

## #10 [P3 | fixRisk:low | reach:false | medium] analyzer-state

**Round-trip asimétrico de urlState: writeUrlState borra valores vacíos/sentinela, así que un filtro 'limpiado' no se puede distinguir de uno 'ausente' al re-aplicar**

- **@** src/state/urlState.ts:28
- **Desc:** writeUrlState borra de la URL cualquier clave con `v == null || v === "" || (k==="filter"&&v==="all") || (k==="branch"&&v==="all")`. Por tanto, tras escribir `{ search: "" }` o `{ filter: "all" }`, readUrlState ya NO devuelve esa clave (queda undefined). El consumidor 'src/main.ts:776-783 applyToLegacy' solo re-aplica branch/filter cuando son truthy (`if (s.filter && window.setF)`, `if (s.branch && window.setBranch)`) y search con `if (s.search !== undefined)`. Como al limpiar el filtro la clave desaparece de la URL, en una navegación back/forward (popstate→onUrlStateChange→applyToLegacy) NO se emite la orden de limpiar: el legado conserva el último valor aplicado.
- **Impacto:** Deep-linking/back-forward inconsistente: el usuario filtra branch='Norte', luego lo pone en 'Todas' (se borra de la URL), navega atrás/adelante; al volver a un estado SIN branch en la URL, el legado mantiene 'Norte' porque applyToLegacy nunca recibe la señal de reset. Igual con filter='all' y con search vaciada. El estado visible diverge del estado representado en la URL — la URL deja de ser fuente de verdad.
- **Fix sugerido:** Hacer el reset explícito: en applyToLegacy aplicar SIEMPRE los valores canónicos cuando la clave esté ausente (p.ej. `window.setBranch?.(s.branch ?? 'all')`, `window.setF?.(s.filter ?? 'all')`, `window.setSearch?.(s.search ?? '')`). Esto requiere coordinación con main.ts, pero la causa raíz está en que urlState colapsa 'ausente' y 'limpiado' al mismo estado; documentarlo y exponer una lista de defaults canónicos (DEFAULTS: {filter:'all', branch:'all', search:''}) que readUrlState/applyToLegacy usen para rehidratar.

## #14 [P3 | fixRisk:low | reach:false | high] main-table

**Fuga de listeners + ResizeObservers: createVirtualTable crea un Controller que renderTable descarta, y el shim re-renderiza decenas de veces sobre el mismo #tbody**

- **@** src/ui/renderTable.ts:352
- **Desc:** En modo virtualizado (units.length >= 200), renderTable() invoca createVirtualTable<Unit>({...}) pero IGNORA el Controller devuelto (no lo guarda ni llama a .destroy()). Cada invocación de createVirtualTable añade un nuevo listener 'scroll' sobre el container (virtualTable.ts:63) y un nuevo ResizeObserver que observa el container (virtualTable.ts:65-66). El container es siempre el MISMO elemento #tbody (main.ts:256 lo obtiene por getElementById en cada render; renderTable.ts:315 hace replaceChildren del CONTENIDO pero NO reemplaza el elemento #tbody en sí, por lo que los listeners adheridos al container persisten). El legado llama a renderTable() en cada interacción: selUnit (HTML:3048), setB/setSrch (HTML:3664-3665), búsqueda debounced (HTML:1633), toggle de check (HTML:3339), import/recalc (HTML:1070,1079,2040,2338,4963). En una flota grande (>=200 unidades, que es exactamente el caso donde la virtualización se activa), tras N interacciones hay N scroll-listeners y N ResizeObservers vivos sobre #tbody, todos ejecutando render() en cada scroll/resize.
- **Impacto:** Degradación progresiva de rendimiento y fuga de memoria en flotillas grandes (el peor caso: justo cuando la virtualización debería ayudar). Cada scroll dispara N callbacks render() acumulados; cada uno hace replaceChildren del viewport, generando jank creciente y consumo de CPU/RAM que crece linealmente con el número de filtros/selecciones del usuario en la sesión. Los ResizeObservers viejos siguen referenciando containers y closures (rows arrays previos), impidiendo GC.
- **Fix sugerido:** renderTable debe mantener el Controller asociado al container y destruirlo antes de recrear, o reutilizarlo vía setRows. Ej.: guardar el controller en un WeakMap<HTMLElement, Controller> keyed por container; al re-renderizar en modo virtual, si existe controller previo para ese container llamar controller.setRows(units) (que ya re-renderiza, virtualTable.ts:68-73) en lugar de crear uno nuevo; al salir de modo virtual o cambiar de modo, llamar controller.destroy() y removerlo del mapa. Como mínimo, llamar a un destroy() del controller previo antes de createVirtualTable.

## #16 [P3 | fixRisk:low | reach:false | high] main-table

**tcell: minT negativo produce barra con width negativo y color verde incorrecto (sin clamp inferior)**

- **@** src/ui/renderTable.ts:120
- **Desc:** `const pct = Math.min((minT / 10) * 100, 100);` aplica clamp SUPERIOR (max 100) pero no inferior. Si minT es negativo (dato corrupto del Excel/MoreApp, o un cálculo de minT que produjo un valor < 0), pct resulta negativo y `fill.style.cssText = width:${pct}%` queda con un porcentaje negativo (CSS lo trata como 0/invalid, pero es indeseable). Más importante: el color en línea 121 usa `minT <= tcrit ? var(--R) : minT <= twarn ? var(--A) : var(--G)`. Esa cadena es correcta para negativos (minT<=tcrit → rojo), así que el color sí cae en rojo; el problema concreto es el pct negativo y que el guard de validez solo cubre null/!Number.isFinite (línea 114) pero no rangos absurdos. El label `${Number(minT)}mm` mostrará p.ej. '-3mm'.
- **Impacto:** Renderizado visual incorrecto de la barra de TACO de llanta ante datos negativos/corruptos (barra vacía con label negativo). Bajo impacto porque minT negativo es improbable, pero es un edge case de datos no validado. Severidad reducida por baja probabilidad.
- **Fix sugerido:** Clamp en ambos extremos: `const pct = Math.max(0, Math.min((minT / 10) * 100, 100));`. Opcionalmente tratar minT < 0 como dato inválido y mostrar el placeholder '—' igual que para null/no-finito.

## #17 [P3 | fixRisk:low | reach:false | high] detail-ui

**Fallback eager de imágenes ZIP asigna img.src = entry.fname (nombre crudo) ignorando resolveZipUrl — imágenes rotas sin IntersectionObserver**

- **@** src/ui/detail/photoGallery.ts:195
- **Desc:** renderPhotoGallery recibe resolveZipUrl (main.ts:415 lo pasa como imgUrl(fname)) pero buildZipThumb nunca lo recibe ni lo usa. En el camino lazy (con observer) la URL real la resuelve el lazyObserver legado vía imgUrl(fname). Pero en el fallback sin observer (photoGallery.ts:192-197) hace img.src = entry.fname directamente, asignando el nombre de archivo del ZIP como URL. resolveZipUrl queda muerto (línea 359 `void resolveZipUrl`).
- **Impacto:** Si el caller no inyecta lazyObserver (IntersectionObserver no soportado, o se invoca renderPhotoGallery fuera del shim que pasa window.lazyObserver), todas las miniaturas de ZIP intentan cargar 'foto123.jpg' como ruta relativa, fallan y disparan el onerror -> 'No disponible'. Galería vacía aunque las fotos existan.
- **Fix sugerido:** En buildZipThumb aceptar resolveZipUrl y, en la rama else (sin observer), usar `const u = resolveZipUrl?.(entry.fname); if (u) { img.src = u; img.style.opacity='1'; }`. Propagar resolveZipUrl desde renderPhotoGallery a buildZipThumb (actualmente ignorado).

## #18 [P3 | fixRisk:low | reach:true | high] detail-ui

**lazyObserver compartido nunca se desconecta al re-render del panel: acumula referencias a <img> ya removidos del DOM (fuga + observaciones muertas)**

- **@** src/ui/detail/photoGallery.ts:191
- **Desc:** El render legado hace lazyObserver.disconnect() antes de re-observar (Control de flotilla.html:3549). La nueva renderPhotoGallery hace container.replaceChildren() (línea 265) pero solo observa los nuevos <img> (línea 191) sin desconectar los anteriores. Como el observer es un singleton compartido (window.lazyObserver) entre el legado y el nuevo render, cada apertura/cierre del panel de detalle, cambio de unidad o auto-refresh acumula targets observados que ya fueron reemplazados.
- **Impacto:** Fuga de memoria progresiva: el IntersectionObserver retiene <img> desconectados del DOM impidiendo su GC. Tras muchas aperturas del detalle (uso normal de una jornada), crece el set de observados. Además, el onerror reemplaza el <img> por un div (línea 188 img.replaceWith) dejando un nodo observado huérfano que nunca dispara unobserve.
- **Fix sugerido:** Antes de re-poblar la galería, desconectar/limpiar los <img> previos del container del observer: iterar `container.querySelectorAll('img.lazy-img').forEach(i => lazyObserver.unobserve(i))` antes de replaceChildren, o exponer un disconnect coordinado. Alternativamente que renderPhotoGallery use su propio observer con ciclo de vida ligado al render.

## #19 [P3 | fixRisk:low | reach:true | high] detail-ui

**Lightbox cachea item.url permanentemente; URLs S3 firmadas expiran -> imagen rota al volver a una foto ya vista**

- **@** src/ui/detail/lightbox.ts:108
- **Desc:** update() hace `if (!item.url && item.fname && resolveUrl) item.url = resolveUrl(item.fname)` (líneas 107-109). Una vez resuelta, la URL se memoiza en el objeto item del array compartido. Las fotos del cloud usan URLs S3 firmadas con expiración (photoFetch). Si el usuario mantiene la galería abierta más allá del TTL de la firma y navega prev/next de vuelta a una foto ya vista, se reutiliza la URL firmada cacheada (posiblemente expirada) sin re-resolver.
- **Impacto:** Imagen rota (403 de S3) en el lightbox al navegar de vuelta a fotos vistas tras varios minutos, sin auto-sanado (el onerror de auto-refirma del legado vive en las miniaturas, no en el <img> del lightbox que no tiene handler de error).
- **Fix sugerido:** No memoizar item.url cuando proviene de resolveUrl, o re-resolver siempre en update() para items con fname (descartar cache). Añadir un onerror en el <img> del lightbox que invoque resolveUrl(item.fname) con force para auto-sanar, como hace photoImgErr en miniaturas.

## #21 [P3 | fixRisk:low | reach:false | high] detail-ui

**renderChecklist: prevFMap es código muerto/stub que sugiere intención no implementada de resaltar cambios de severidad**

- **@** src/ui/detail/renderChecklist.ts:319
- **Desc:** Se construye prevFMap llenándolo solo con diff.newFails y un comentario `// stub` (líneas 319-322), pero prevFMap nunca se consulta: el resaltado se decide vía wasInPrev() (que solo mira newFails) y changedRisk() (que mira worsened/improved). El comentario 'Technically, we only need to know if finding was in prev' delata lógica a medio migrar respecto al legado, que sí usa prevFMap[f.text].lv para detectar cambios.
- **Impacto:** Bajo en correctitud (el highlight de worsened/improved sí funciona vía changedRisk), pero prevFMap es engañoso/muerto y un futuro cambio podría confiar en él esperando que esté completo. Riesgo de mantenimiento, no de runtime.
- **Fix sugerido:** Eliminar prevFMap (código muerto) o completarlo y usarlo de forma consistente. Mantener solo wasInPrev/changedRisk si esa es la fuente de verdad del resaltado.

## #23 [P3 | fixRisk:low | reach:false | high] detail-ui

**renderTires: barra de llanta puede tener ancho negativo y mm negativos pasan como válidos (Number.isFinite no filtra valores absurdos)**

- **@** src/ui/detail/renderTires.ts:15
- **Desc:** tireRow calcula pct = Math.min((valueMm/10)\*100, 100) (línea 15) sin clamp inferior. Si valueMm es negativo (dato corrupto del Excel/MoreApp), pct es negativo y fill.style.width = `${pct}%` produce un ancho inválido (se renderiza como 0 pero el status/valor muestran '-3mm'). renderTires solo filtra con Number.isFinite(value) (línea 137), que acepta negativos y NaN-coerced no, pero sí 0 y negativos.
- **Impacto:** Bajo: medición de llanta negativa (entrada errónea) se renderiza como 'CRÍTICO' '-3mm' con barra colapsada; no rompe, pero muestra un dato sin sentido al usuario y al alertBox (Taco mínimo: -3mm).
- **Fix sugerido:** Clampear pct con Math.max(0, ...) y descartar/normalizar lecturas <0 (tratar como dato faltante o 0). Validar rango razonable (0..20mm) antes de renderizar.

## #24 [P3 | fixRisk:low | reach:true | high] taller

**El donut de distribución y la card 'En Revisión' siempre muestran 100% / 0 (nSin muerto, nRev == nActAll)**

- **@** src/taller/renderActivasKpis.ts:96-97
- **Desc:** computeActivasKpis define nRev = latestAll.filter(e => !isClosed(e)).length, que es EXACTAMENTE el mismo predicado que activosAll (linea 91), por lo que nRev === nActAll siempre. Y nSin = latestAll.filter(e => !e.estado).length, pero `estado` es un campo OBLIGATORIO de TallerEntry (types.ts:44 `estado: TallerEstado`) y en el hydrate cloud siempre se normaliza con migrateEstado() que nunca devuelve vacio (cloudHydrate.ts:254, types.ts:28-33 default 'En Diagnostico'). Por tanto !e.estado es siempre false y nSin === 0 de forma permanente.
- **Impacto:** El donut (buildDonut/buildDonutCard) solo recibe el segmento 'rev' con valor = total y 'sin' = 0; el filtro present = entries.filter(v>0) deja un unico segmento, revPct = round(nRev/nActAll\*100) = 100% SIEMPRE, y la leyenda 'Sin Reg.' siempre muestra 0. La visualizacion es informacion muerta: nunca segmenta nada util. El hover interactivo sobre 'sin' tampoco aplica (segmento no se dibuja). La card 1 'En Revision' duplica el total de activos sin aportar.
- **Fix sugerido:** Redefinir la semantica del donut para que segmente por algo real (p.ej. nDiag vs nRepar vs nCotiz vs nRecup, o Correctivo vs Preventivo vs Sin tipo). Si 'Sin Reg.' debia contar unidades sin TIPO, usar `!e.tipo` en vez de `!e.estado`. Y nRev debe medir un subconjunto distinto de nActAll (p.ej. solo estado 'En Diagnostico') para que el split tenga sentido.

## #26 [P3 | fixRisk:low | reach:true | high] taller

**El badge de visitas y la mezcla C/P del historial ignoran los filtros de fecha/tipo, contradiciendo el conteo del periodo**

- **@** src/taller/renderHistorial.ts:305
- **Desc:** En buildDataRow el badge de visitas usa `row.entries.length` (linea 305) y la mezcla nCor/nPrev usa `row.entries.filter(...)` (lineas 319-320), que incluyen TODAS las entradas de la unidad (activas + cerradas, sin aplicar desde/hasta/tipo). Pero closedCount, totalGasto y el KPI 'Visitas (periodo)' (renderHistorial.ts:410 reduce de r.closedCount) usan SOLO las cerradas que pasaron los filtros de fecha/tipo aplicados en buildHistorialRows (lineas 136-139).
- **Impacto:** Con un rango de fechas o filtro de tipo activo, una unidad puede mostrar el badge '5' (todas sus visitas historicas) mientras la barra KPI dice 'Visitas (periodo): 2' y los totales de gasto solo suman 2 visitas. El usuario ve numeros incoherentes en la misma vista: la fila promete 5 visitas pero el gasto y el periodo reflejan 2.
- **Fix sugerido:** Mostrar en el badge el conteo coherente con el periodo: usar row.closedCount (o row.entries filtradas por el mismo criterio) cuando hay filtros activos, y calcular nCor/nPrev sobre las cerradas filtradas. Alternativamente exponer ambos numeros con tooltip ('2 en periodo / 5 totales').

## #28 [P3 | fixRisk:low | reach:false | medium] taller

**Comparacion de rango por string falla en el borde cuando fentrada trae timestamp ISO completo**

- **@** src/taller/renderHistorial.ts:136-137
- **Desc:** El filtro compara strings: `e.fentrada > filter.hasta`. filter.hasta es 'YYYY-MM-DD' pero e.fentrada puede venir como ISO completo. En el hydrate, fentrada = String(datos.fentrada ?? t.fechaEntrada) (cloudHydrate.ts:266) y t.fechaEntrada en el upload puede ser e.updatedAt o new Date().toISOString() (batchUpload.ts:410), es decir 'YYYY-MM-DDThh:mm:ssZ'. Entonces '2026-04-15T10:00:00Z' > '2026-04-15' es TRUE.
- **Impacto:** Una unidad que ingreso el ultimo dia del rango (hasta = ese dia) se EXCLUYE incorrectamente porque su fentrada lleva la hora. Perdida silenciosa de la visita del dia-borde en el periodo. Simetricamente con `desde` no afecta (un timestamp del mismo dia es >= 'YYYY-MM-DD' string), pero el borde superior si pierde datos.
- **Fix sugerido:** Normalizar a fecha-solo antes de comparar: `const fe = (e.fentrada||'').slice(0,10);` y comparar fe contra filter.desde/hasta. Asi '2026-04-30' <= '2026-04-30' incluye el borde.

## #30 [P3 | fixRisk:low | reach:true | medium] taller

**Gastos negativos se renderizan como $0 ocultando datos (fmtMXN)**

- **@** src/taller/renderHistorial.ts:78-81
- **Desc:** fmtMXN hace `if (!n || n <= 0) return '$0'`. Cualquier valor negativo (ajuste/credito/nota de cargo negativa, o un gasto cargado por error con signo) se muestra como $0 en la columna Gasto, en el breakdown Ref/MO y en el Top5.
- **Impacto:** Si un gasto agregado resulta negativo (p.ej. correccion contable), la UI lo enmascara como $0 en vez de mostrar el valor real, ocultando una posible anomalia de datos al area de Tesoreria. Tambien afecta el promedio por visita que si suma el negativo (totalGasto/totalVisitas) pero se muestra distinto al detalle.
- **Fix sugerido:** Separar 'sin dato' (0) de 'negativo': `if (n === 0) return '$0';` y formatear negativos con signo: `return (n<0?'-$':'$') + Math.abs(n).toLocaleString('es-MX',...)`. Decidir politica de signo con Tesoreria.

## #32 [P3 | fixRisk:low | reach:true | high] weekly

**Filtro 'carroceria'/'llanta' deja pasar filas con riesgo undefined que se pintan como 'Sin daños'/'Con refacción'**

- **@** src/weekly/renderTableSemanales.ts:56
- **Desc:** En filterAndSortWeekly el filtro de carroceria excluye solo cuando carroceriaRisk === 'OK' (linea 56) y el de llanta solo cuando llantaRisk === 'OK' (linea 57). Pero carroceriaRisk y llantaRisk son opcionales (types.ts:35-36, WeeklyEntry los marca '?'). Una entry con carroceriaRisk === undefined NO es === 'OK', por lo que PASA el filtro 'carroceria'. Sin embargo carroceriaCell (linea 178-179) trata !entry.carroceriaRisk || === 'OK' como 'Sin daños' (verde). Mismo desfase en llantaCell (linea 194-195) que pinta undefined como 'Con refacción'.
- **Impacto:** Al filtrar por la tarjeta 'Carrocería' (o 'Llanta Ref.') aparecen filas que la propia tabla muestra como 'Sin daños' / 'Con refacción'. El conteo de la tarjeta (que usa k.carroceriaUrgente+k.carroceriaRevisar, solo cuenta valores != undefined/OK) no cuadra con las filas mostradas: la tarjeta dice N pero la tabla filtrada muestra N + (entries con riesgo undefined).
- **Fix sugerido:** Cambiar las guardas a tratar undefined como OK: linea 56 'if (filter.riskFilter === "carroceria" && (!e.carroceriaRisk || e.carroceriaRisk === "OK")) return false;' y linea 57 analogamente para llanta. Asi se alinean con carroceriaCell/llantaCell y con el conteo de KPI.

## #33 [P3 | fixRisk:low | reach:true | high] charts-pdf-io

**Heatmap del taller: rango del calendario usa UTC (toISOString) mientras los datos usan fecha local → última columna/ingresos recientes en celda equivocada o recortados**

- **@** src/dashboard/charts.ts:524-527
- **Desc:** buildHeatmapOption construye el rango del calendario con `const today = new Date(); start.setDate(start.getDate()-89); fmt = d => d.toISOString().slice(0,10)`. toISOString() convierte a UTC. En México (UTC-6), cualquier ejecución después de las 18:00 hora local produce un string de fecha que es el DÍA SIGUIENTE. En cambio, los datos `d.date` que llegan se construyen como YYYY-MM-DD en hora LOCAL (Control de flotilla.html:2680-2695 usa today0.setHours(0,0,0,0), cutoff local, e iso a partir de DD/MM/YYYY o slice(0,10)). Por tanto el `range` del calendario y las llaves de los datos quedan desfasados un día respecto a la lógica que generó los counts.
- **Impacto:** Por las tardes (hora MX), el calendario muestra como último día 'mañana' y el ingreso de HOY puede caer en la columna anterior o quedar fuera del rango [start, today] del calendario, mostrándose vacío. El heatmap miente sobre el día real de ingreso a taller. No crashea; es corrupción visual de datos dependiente de la hora del día.
- **Fix sugerido:** Formatear con componentes locales en lugar de UTC, igual que el HTML: `const fmt = (d:Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;`. Así el range del calendario coincide con las llaves YYYY-MM-DD locales de los datos.

## #34 [P3 | fixRisk:low | reach:false | high] charts-pdf-io

**loadZip descomprime en RAM cada XLSX adicional y luego descarta los bytes — viola el diseño anti-OOM y desperdicia CPU/memoria**

- **@** src/io/zipLoader.ts:54-63
- **Desc:** El bloque `if (isImg || isXlsx) { const bytes = await getBytes(); ... }` llama getBytes() (que hace inflate completo del archivo en memoria) para TODA entrada xlsx, pero solo conserva el PRIMER xlsx: `else if (isXlsx && !xlsxBox.ref)`. A partir del segundo xlsx, `getBytes()` ya se ejecutó (inflado completo), el `bytes` resultante no entra a ninguna rama y se descarta, y ni siquiera se hace push a `entries`. El comentario del archivo afirma 'Ahora usa streaming internamente para evitar OOM', pero un ZIP con varios xlsx grandes los infla todos a RAM solo para tirarlos.
- **Impacto:** Un ZIP que contenga 2+ xlsx grandes (export accidental, plantilla + datos, hojas múltiples como archivos) descomprime megabytes innecesarios por cada uno, pudiendo causar el OOM que el módulo dice evitar; además el segundo+ xlsx no aparece en `entries`, dejando el log incompleto.
- **Fix sugerido:** Mover la llamada a getBytes() dentro de cada rama: para imágenes y para `isXlsx && !xlsxBox.ref` llamar getBytes(); para xlsx subsecuentes, hacer solo `entries.push({name, kind:'xlsx', size:0})` SIN getBytes(). Ej.: `if (isImg) { const bytes = await getBytes(); ... } else if (isXlsx) { if (!xlsxBox.ref) { const bytes = await getBytes(); xlsxBox.ref = {...}; entries.push({...,size:bytes.length}); } else { entries.push({name:entryName, kind:'xlsx', size:0}); } }`.

## #35 [P3 | fixRisk:low | reach:false | medium] charts-pdf-io

**Imágenes del ZIP indexadas solo por basename — fotos con mismo nombre en distintas carpetas se sobrescriben y se pierden antes de subir a S3**

- **@** src/io/zipLoader.ts:57-58
- **Desc:** `const key = (entryName.split('/').pop() ?? entryName).toLowerCase().trim(); if (key) images[key] = bytes;`. La llave del map `images` es solo el nombre base en minúsculas, descartando el path. Dos entradas con el mismo basename en carpetas distintas (p.ej. `unidad-A/frente.jpg` y `unidad-B/frente.jpg`, o exports de MoreApp que reusan nombres de campo) se colapsan en una sola llave y la segunda sobrescribe a la primera. Luego uploadPhotosToS3 (src/api/photoUpload.ts:73) itera Object.keys(images), por lo que solo sube la que sobrevivió.
- **Impacto:** Pérdida silenciosa de fotos al importar ZIP multi-unidad o con subcarpetas que repiten nombres de archivo. imageCount refleja el conteo deduplicado, así que ni siquiera se nota el faltante. Afecta la evidencia fotográfica de inspecciones.
- **Fix sugerido:** Si el lookup downstream usa basename, al detectar colisión preservar ambas (p.ej. prefijar con el path o un sufijo `_2`) o usar el path completo normalizado como llave. Mínimo: emitir console.warn cuando `images[key]` ya existe para no perder datos en silencio.

## #36 [P3 | fixRisk:low | reach:true | high] charts-pdf-io

**PDF: kilometraje no numérico propaga 'NaN km' al reporte**

- **@** src/pdf/unitReport.ts:75-79
- **Desc:** La fila de Kilometraje hace `unit.km !== undefined && unit.km !== '' ? `${Number(unit.km).toLocaleString('es-MX')} km` : '—'`. `Unit.km` es `number | string` (types.ts:67). Si km es un string no numérico ('N/A', 'sin dato', '12,345' con coma, 'aprox 50k'), `Number(km)` da NaN y `NaN.toLocaleString('es-MX')` produce 'NaN', imprimiendo 'NaN km' en el reporte ejecutivo.
- **Impacto:** El PDF que se entrega/descarga muestra 'NaN km' en vez de un guion, dañando la presentación ante dirección. No crashea.
- **Fix sugerido:** Validar finitud: `const kmNum = Number(unit.km); ... unit.km !== undefined && unit.km !== '' && Number.isFinite(kmNum) ? `${kmNum.toLocaleString('es-MX')} km` : '—'`.

## #37 [P3 | fixRisk:low | reach:false | high] charts-pdf-io

**ZIP reader no maneja ZIP64 — csize/usize/offset uint32 fallan en archivos o offsets >4GB (sentinela 0xFFFFFFFF)**

- **@** src/io/zipReader.ts:65-67, 82, 86, 104
- **Desc:** El central directory se lee con campos uint32: cdSize/cdOffset (líneas 66-67), csize (82) y lhOff (86). Cuando un campo excede 0xFFFFFFFF, el formato ZIP64 lo marca como 0xFFFFFFFF y guarda el valor real en el 'extra field' ZIP64, que este lector ignora (subarray de filename solo, sin parsear extras). cdOffset/csize=0xFFFFFFFF llevarían a slices con offsets absurdos y a 'EOCD no encontrado' o 'LH inválido'.
- **Impacto:** ZIPs muy grandes (>4GB) o con offset de central directory >4GB (caso del comentario que menciona archivos >100MB y streaming) fallan a parsear. Es un edge case en este dominio (fotos de flota), por eso severidad baja, pero el módulo se vende explícitamente para archivos grandes.
- **Fix sugerido:** Detectar EOCD64 locator (firma 0x07064b50) antes del EOCD y, cuando un campo sea 0xFFFFFFFF/0xFFFF, leer el valor real del ZIP64 extra field. Si no se quiere soportar ZIP64, al menos detectar el sentinela y lanzar un error claro ('ZIP64 no soportado').

## #38 [P3 | fixRisk:low | reach:true | high] charts-pdf-io

**Charts ocultados (display:none) al quedar sin datos no se disponen → observers (ResizeObserver/MutationObserver) siguen vivos**

- **@** src/dashboard/charts.ts:80-90 (patrón repetido en todos los render\*)
- **Desc:** Cada render\* registra un ResizeObserver y un MutationObserver (vía onThemeChange) y solo los limpia cuando se llama chart.dispose(). El caller (Control de flotilla.html ~2654/2707/2733) cuando un gráfico pasa a estado 'vacío' hace `el.style.display='none'` PERO no llama dispose ni vuelve a invocar el render (que sí dispondría vía getInstanceByDom). La instancia ECharts queda viva con sus dos observers. Al alternar tema, el MutationObserver dispara setOption sobre un chart en display:none.
- **Impacto:** Fuga acotada (los contenedores son estáticos por id, así que un re-render posterior sí limpia) pero mientras el card está oculto se hace trabajo inútil en cada toggle de tema y resize. No crashea. Severidad baja.
- **Fix sugerido:** El caller debe disponer la instancia al ocultar (`echarts.getInstanceByDom(el)?.dispose()`), o exponer un cleanup. Alternativamente, en onThemeChange/ResizeObserver verificar `if (chart.isDisposed?.() || !container.isConnected) return;` antes de setOption/resize.

## #6 [P3 | fixRisk:medium | reach:true | high] backend-webhook

**analyzeRow usa fecha local mientras la fecha del Checklist se trunca en UTC → cálculo de servicio próximo/vencido y día del checklist desfasados cerca de medianoche**

- **@** amplify/functions/moreapp-webhook/handler.ts:495
- **Desc:** El Lambda corre en UTC. En processMensual la fecha del Checklist se deriva con `fechaRaw.split(/[ T]/)[0]` y, si falta, `new Date().toISOString().split("T")[0]` (UTC). Pero analyzeRow (líneas 143-164) compara la 'Fecha estimada del siguiente servicio' contra `new Date()` con `setHours(0,0,0,0)` (hora LOCAL del runtime) y `parseSvcDate` construye Date con componentes locales. En Lambda local≈UTC, pero la fecha de captura de MoreApp viene en hora de México (UTC-6). Una inspección capturada el 31-ene 22:00 hora MX llega como dateAndTime local MX; el fallback de fecha (cuando dateAndTime falta) usa el día UTC, que ya es 1-feb. Además el cómputo de 'Servicio próximo (N días)' usa el reloj UTC del Lambda como 'hoy', no la zona del usuario.
- **Impacto:** Inconsistencia de fechas: (a) el campo `fecha` que forma parte de la llave compuesta (tenantId, unitUid, fecha) puede caer en el día equivocado cuando dateAndTime falta y la captura fue después de las 18:00 hora MX, generando un Checklist con día corrido y rompiendo la dedup esperada por día; (b) el conteo de días para 'Servicio próximo/VENCIDO' se calcula contra medianoche UTC, no contra el día del usuario, produciendo off-by-one en el umbral de 30 días / vencido cerca del cambio de día.
- **Fix sugerido:** Normalizar todo el manejo de fechas a la zona de operación (America/Mexico_City) o, como mínimo, documentar y fijar una sola zona. Para `fecha` preferir siempre la fecha contenida en `answers.dateAndTime` (que ya viene en hora local del form) y evitar el fallback a UTC `toISOString`; si dateAndTime falta, derivar el día desde `info.date`/meta con conversión explícita de zona. En analyzeRow, calcular 'hoy' en la misma zona que la fecha de captura.

## #7 [P3 | fixRisk:medium | reach:true | high] backend-webhook

**El payload crudo se escribe en S3 con clave Date.now() en cada POST → colisión/sobrescritura entre reintentos o envíos concurrentes**

- **@** amplify/functions/moreapp-webhook/handler.ts:937
- **Desc:** `const auditKey = "${PREFIX}${Date.now()}.json"`. La clave de auditoría usa sólo el timestamp en milisegundos. Dos POST que lleguen en el mismo milisegundo (reintento de MoreApp tras timeout, o dos forms distintos enviados a la vez) generan la misma key y el segundo PutObject sobrescribe al primero. El propósito de este S3 es auditoría/forense del crudo.
- **Impacto:** Pérdida de trazabilidad: un envío crudo puede ser pisado por otro con el mismo ms, dejando la auditoría incompleta. No afecta la ingesta a DynamoDB (esa va por llave natural), pero sí el objetivo declarado de 'guardar el JSON crudo para inspección'. Probabilidad baja pero real bajo reintentos/concurrencia.
- **Fix sugerido:** Hacer la key única: incluir un sufijo aleatorio o el request id, p.ej. `${PREFIX}${Date.now()}-${event.requestContext?.requestId ?? crypto.randomUUID()}.json`, o incluir formId/serialNumber en la clave.

## #8 [P3 | fixRisk:medium | reach:false | high] backend-webhook

**El crudo se escribe en S3 (con headers completos) antes de validar la firma HMAC; sólo el token en query lo protege**

- **@** amplify/functions/moreapp-webhook/handler.ts:938
- **Desc:** En la rama POST, el PutObject de auditoría (líneas 938-949) ocurre ANTES de `verifySignature` (línea 951). Si bien el token de query ya se validó al inicio del handler (línea 696), el cuerpo se persiste en S3 incluyendo `event.headers` completos antes de cualquier verificación de integridad/firma. Hoy el secret de firma está vacío (verifySignature retorna true), pero al activarlo, todo request con token válido pero firma inválida igual deja escrito en S3 el crudo + headers.
- **Impacto:** Un atacante que obtenga el token (está hardcodeado en resource.ts:20, en texto plano en el repo y en la URL del webhook) puede escribir objetos arbitrarios en moreapp-capture/ sin pasar firma, y persistir headers que podrían contener datos sensibles. Amplificación de almacenamiento / posible vector de costo. Severidad acotada porque requiere conocer el token, pero el token es de bajo secreto y versionado en git.
- **Fix sugerido:** Mover la verificación de firma (verifySignature) ANTES del PutObject de auditoría, o sólo auditar tras validar firma. Adicionalmente, no persistir `event.headers` íntegros (filtrar Authorization/cookies) y rotar el token fuera del control de versiones (env/secret en vez de literal en resource.ts).

## #13 [P3 | fixRisk:medium | reach:false | high] analyzer-state

**parseSvcDate no maneja Date ni serial Excel: fallback de fecha de servicio se desactiva silenciosamente cuando la celda llega como número/Date**

- **@** src/analyzer/analyzeRow.ts:18
- **Desc:** parseSvcDate solo reconoce strings 'DD/MM/YYYY' o 'YYYY-MM-DD'. ExcelRow está tipado como `Record<string, string|number|Date|undefined>` (types.ts:20). El loader principal usa `cellDates:false` + `raw:true` (Control de flotilla.html:2082, 2242), por lo que una celda de fecha real de Excel llega como serial numérico (p.ej. 46000) y `String(46000)` no matchea ningún regex → null. Si en el futuro algún cargador usa cellDates:true (como el de líneas 6565) o la celda es un Date, `String(date)` ('Wed Jun 03 2026...') tampoco matchea → null. El fallback de servicio por fecha (líneas 143-164) simplemente no dispara, sin log ni aviso.
- **Impacto:** Cuando no hay datos de km (hasKmData=false) y la fecha de próximo servicio viene como serial/Date en lugar de string, la unidad nunca recibe el finding de 'Servicio VENCIDO'/'Servicio próximo' por fecha → un servicio vencido pasa desapercibido. Limitado hoy porque el path principal usa raw:true/cellDates:false (serial), pero el serial numérico SÍ ocurre y rompe el parseo. Coincide con el legado (mismo gap), por eso P3.
- **Fix sugerido:** Manejar Date y serial Excel en parseSvcDate: si `s instanceof Date && !isNaN(s.getTime())` devolver new Date(s); si `typeof s === 'number'` (o String(s) es todo dígitos) convertir el serial Excel a Date (`new Date(Date.UTC(1899,11,30)+serial*86400000)`). Alternativamente, garantizar que el loader normalice esta columna a string ISO antes de analyzeRow y loguear cuando una fecha esperada no parsea.

# REFUTADOS (20)

- (data-cloud) Completaciones CheckDone del cloud se borran por race con loadAllChecklist() (checklistDB={}) @ src/api/cloudHydrate.ts:487-497
  - why: REFUTO el hallazgo tal como está descrito (impacto + repro). El código real:

1. loadAllChecklist() (Control de flotilla.html:3294-3300) sí hace hard reset `checklistDB={}` y repuebla solo desde IndexedDB. Confirmado.
2. hydrateFromCloud NO resetea checklistDB: lee window.checklistDB vía el bridge (

- (data-cloud) upsertCheckDone: spread de input puede sobreescribir el default done:true con undefined @ src/api/client.ts:373
  - why: El mecanismo JS descrito es técnicamente cierto pero NO constituye una falla presente en el código actual; es solo latente/hipotético, lo cual el propio hallazgo admite ("Latente", "el unico caller actual siempre manda done:true").

Evidencia leída:

- client.ts:373 — `const payload = { done: true, .
- (data-cloud) getSession nunca expone groups: AuthSession.groups siempre [] aunque la UI/logica pueda depender de roles @ src/api/auth.ts:101-110
  - why: El hecho factual es exacto: src/api/auth.ts:109 devuelve `groups: []` hardcodeado, y el comentario en lineas 101-104 reconoce que los groups reales viven en el JWT (cognito:groups) y requeririan fetchAuthSession(). Sin embargo, bajo la lente CORRECCION (¿hay una falla logica REAL que produzca compor
- (backend-webhook) verifySignature parsea el header partiendo por '=' sin límite → valor v1 truncado si contiene '=' (y frágil ante params nuevos) @ amplify/functions/moreapp-webhook/handler.ts:119
  - why: El parser citado existe textualmente en handler.ts:118-125 y el mecanismo abstracto que describe el hallazgo es correcto: para un segmento como `v1=AAA=BBB`, `.split("=")` (sin límite) produce `["v1","AAA","BBB"]` y `Object.fromEntries` toma solo entry[0]/entry[1] → `{v1:"AAA"}`, descartando `=BBB`.
- (backend-webhook) runBackfill/runBackfillSemanal: el slice no cruza el límite de página → puede reportar done=true prematuramente y omitir submissions @ amplify/functions/moreapp-webhook/handler.ts:434
  - why: Verifiqué handler.ts:416-453 (runBackfill) y :654-691 (runBackfillSemanal). El código es tal como describe el hallazgo: page=floor(cursor/50), within=cursor%50, trae UNA página vía fetchFormPage (submissions/filter/${page}), slice(within, within+count), nextCursor=cursor+slice.length, y done = slice
- (backend-webhook) moreappId del webhook depende de envelope.meta.serialNumber, pero en el webhook real meta puede no estar bajo body.data @ amplify/functions/moreapp-webhook/handler.ts:469
  - why: REFUTADO. El hallazgo supone que en el webhook `meta`/`id` podrían vivir al nivel raíz del body (hermanos de `data`), dejando `envelope.meta`/`envelope.id` undefined cuando `envelope = body.data` (handler.ts:963). El propio código del webhook desmiente esa hipótesis: tras `envelope = body.data` (lín
- (analyzer-state) validationErrors 'Datos de llantas incompletos' puede ser falso positivo en vehículos sin llantas internas/refacción (gateadas fuera del conteo) @ src/analyzer/analyzeRow.ts:177
  - why: REFUTADO. Leí el código real en src/analyzer/analyzeRow.ts (líneas 58-76, 167, 177-179) y src/analyzer/constants.ts (TC, líneas 3-11).

Mecánica real: `tv = Object.values(T)` y `T[n]` solo se asigna cuando la lectura TACO es un número válido (`!isNaN(raw)`, línea 63). Por tanto `tv.length` NO cuenta

- (main-table) renderTableShim pasa selectedUid desde appStore mientras filt/units se leen de window.\* — posible selección desincronizada en el primer render del store @ src/main.ts:279
  - why: REFUTADO. La falla descrita no está presente; el mecanismo alegado se apoya en una distinción entre rutas de código que NO existe en el fuente, y la traza de repro es inválida.

1. Premisa central falsa. El hallazgo afirma que el flujo NORMAL queda sincronizado porque selUnit asigna selId "vía la cl

- (main-table) virtualTable: ResizeObserver dispara schedule() pero render() corta por (first===start && last===end), dejando el viewport sin re-medir tras cambio de ancho @ src/ui/virtualTable.ts:42
  - why: REFUTADO. El hallazgo mezcla dos cosas: (1) admite que el early-return de render() ante cambios de ANCHO es "correcto para el contenido" (no es bug), y (2) pivota al supuesto bug real: que las filas pueden ser más altas que rowHeight (60px) por contenido variable, desalineando sizer/translateY. Esa
- (detail-ui) checklistDB/CheckDone keyed by inconsistent uid entre vista de inspección (plate\_\_fecha) y vista de flota/fallback (placa) — completaciones invisibles cruzadas @ src/api/cloudHydrate.ts:350
  - why: REFUTADO. La falla descrita (misma unidad vista una vez como 'placa' y otra como 'placa\_\_fecha', con completaciones invisibles cruzadas) no es alcanzable en el código actual porque el flujo interactivo de checklist está atado por completo a window.units, que tiene UNA sola convención de uid por sesi
- (detail-ui) renderNotes: setTimeout(focus, 50) no cancelado roba el foco tras re-render/auto-refresh y puede operar sobre nodo desmontado @ src/ui/detail/renderNotes.ts:195
  - why: El timer literal existe (src/ui/detail/renderNotes.ts:195-197: `setTimeout(() => container.querySelector("#note-input")?.focus(), 50)` sin guardar/cancelar). Pero el MECANISMO de fallo descrito NO está presente:

1. "Auto-refresh de cloud cada 60s/4min re-renderiza y roba el foco": REFUTADO. El únic

- (detail-ui) renderNotes: ID duplicado #note-input / #note-type al coexistir con el form legado del mismo panel @ src/ui/detail/renderNotes.ts:77
  - why: REFUTADO. El hallazgo presupone que el textarea nuevo (renderNotes.ts:77, id="note-input") y el textarea legado (Control de flotilla.html:3771, mismo id) COEXISTEN como nodos vivos durante la transición del feature flag, provocando que document.getElementById('note-input') del addNote legado (HTML:3
- (detail-ui) authModal: handleSubmit/submit2 no capturan rechazos de login()/confirmNewPassword() — botón queda en 'Verificando...' deshabilitado si la promesa rechaza @ src/ui/authModal.ts:245
  - why: El hallazgo se REFUTA. Su premisa central — que login()/confirmNewPassword() pueden lanzar/rechazar (error de red, Cognito caído, configureAmplify no listo) — es falsa contra el código actual.

En src/api/auth.ts, ambas funciones envuelven TODO su cuerpo en try/catch que NUNCA re-lanza:

- login() (l
- (taller) Llave de agrupacion por unidad inconsistente entre renderActivas y renderActivasKpis/renderHistorial @ src/taller/tallerStore.ts:106
  - why: La divergencia de FÓRMULA de llave existe en el código actual y la confirmo: groupByUnit (tallerStore.ts:106) usa `e.unitKey || e.eco || e.plate || e.id`, mientras latestPerUnit (renderActivasKpis.ts:78) y buildHistorialRows (renderHistorial.ts:115) usan `e.unitKey || e.id`. Estas solo difieren cuan
- (taller) Default `today` distinto entre modulos puede producir conteos de dias/urgentes divergentes en el mismo render @ src/taller/renderActivasKpis.ts:103
  - why: Refuto la falla TAL COMO SE DESCRIBE. Verifiqué las dos rutas de cálculo:

- KPI: renderActivasKpis.ts:45-50 `daysBetween` = `Math.round((tb - ta) / 86400000)` sin clamp, con `tb = new Date(today.toISOString()).getTime()`. Usado para urgentes en línea 101-105 con umbral `d > 7`.
- Tabla: tallerStore
- (weekly) riskPill/pill mapea RiskLevel 'Completar' al estilo e icono de OK (check verde) silenciosamente @ src/weekly/renderTableSemanales.ts:161
  - why: REFUTO el hallazgo tal como esta formulado. La descripcion del codigo es literalmente correcta a nivel sintactico, pero el mecanismo de fallo y el impacto alegado son incorrectos/inalcanzables en los flujos de datos reales.

Verificacion linea por linea:

- Cierto que RiskLevel admite 4 valores (src/
- (weekly) Tarjeta 'Operativas' = ok + revisar puede superar el total y dar pct >100% / etiqueta engañosa @ src/weekly/renderKpisSemanales.ts:148
  - why: REFUTADO. El propio hallazgo admite que el codigo es correcto HOY ("lo cual es consistente HOY", "Hoy correcto") y plantea el problema como riesgo de mantenibilidad/regresion hipotetica, no como un fallo logico presente. El estandar de verificacion exige senalar la linea exacta equivocada y el mecan
- (weekly) KPI label usa periodo.label sin fallback; periodos cloud sin label muestran 'undefined' @ src/weekly/renderKpisSemanales.ts:28
  - why: REFUTADO. El hallazgo alega que un WeeklyPeriodo puede hidratarse con label undefined/vacío, pero ningún camino real de construcción lo produce.

Caminos reales que pueblan window.weeklyPeriodos (leído por activeWeeklyPeriodo() en main.ts:645-648, que alimenta renderKpisSemanales en main.ts:696-700)

- (charts-pdf-io) renderKmScatter lanza TypeError si llega un risk fuera del enum (índice undefined en byRisk) @ src/dashboard/charts.ts:628-630
  - why: Refuto como bug activo; es a lo sumo un hardening latente sin trigger en el codigo actual.

CONFIRMADO del mecanismo: en src/dashboard/charts.ts el objeto byRisk (lineas 622-627) solo define las llaves Urgente/Revisar/Completar/OK, y el bucle de las lineas 628-630 hace `byRisk[d.risk].points.push([d

- (charts-pdf-io) loadExcel: headers duplicados se pierden en el parseo a objetos (SheetJS dedup con sufijo) → columnas repetidas no llegan a analyzeRow @ src/io/excelLoader.ts:67-71
  - why: El mecanismo técnico de bajo nivel es correcto: en excelLoader.ts:67 `headers` se arma de la fila cruda (puede tener duplicados) y en la línea 71 `sheet_to_json` keyea objetos por header, deduplicando llaves repetidas con sufijos (\_1, \_2). Pero el IMPACTO alegado (pérdida silenciosa de datos que "ll

# GAPS (completeness critic)

- LEGACY HTML NO AUDITADO (el gap mas grande): 'Control de flotilla.html' tiene 7177 lineas con ~6300 de JS inline (lineas 10-784 + 784-7175) que SON el motor de produccion real (parseo XLSX/ZIP inline, inflate RFC1951 propio, doExcel/doArchivoSemanal, renderTable, renderTaller, weeklyPeriodos, toggleCheckItem, dbPut/openDB IndexedDB, recalcRisk, buildKPIs, buildAnalytics, exportPDF). Los modulos src/\*.ts que audito el cluster son solo un SHIM parcial montado encima via feature-flags (USE_NEW_DETAIL/USE_NEW_PDF) y bindLegacyWindow. La logica que de verdad corre para la mayoria de usuarios (sin flags) vive en el HTML y quedo sin revisar.
- src/state/store.ts + src/state/appState.ts (bridge legacy<->store) NO leidos por el cluster: el getter trap de bindLegacyWindow llama appStore.set() DURANTE una lectura de window.units, y set() emite sincronicamente a subscribers; un subscriber que re-lea window.units reentra el trap -> riesgo de reentrancy/recursion y notificaciones stale. Ademas el bridge admite que ignora mutaciones in-place (push) -> divergencia store vs window cuando el legacy hace units.push().
- src/api/auth.ts NO leido: getSession() siempre devuelve groups:[] (comentario dice que no los lee) y captura TODO en catch->null, ocultando el error 'Usuario sin custom:tenantId'; cualquier fallo transitorio de red en fetchUserAttributes degrada a 'no logueado' en vez de reintentar.
- src/api/batchUpload.ts y src/api/photoUpload.ts NO leidos por el cluster: contienen la derivacion de periodoId por regex de filename, sanitizacion JSON-roundtrip, y buildPhotoPath con lowercasing de basename — ninguno cubierto.
- src/api/client.ts (capa CRUD/upsert + listAll paginado) NO leida en detalle: patron create->catch conditional->update (TOCTOU multiusuario) sin auditar para CheckDone/Unit/Checklist.
- Concurrencia multiusuario del nuevo modelo CheckDone solo parcialmente cubierta: falta el path de ESCRITURA (cloudWire \_\_cloudSetCheck fire-and-forget sin rollback, upsertCheckDone create/update race) y el de LISTADO (listCheckDone hace Scan filtrado sin indice).
- Clase de bug ZONA HORARIA/LOCALE en el legacy NO buscada: conversiones de serial Excel (fechaRaw-25569)\*86400000 con new Date()+toLocaleDateString (HTML linea 2150) y new Date(iso+'T00:00:00') (HTML 2693) son TZ-local -> desfase de 1 dia en UTC-6 cerca de medianoche/DST; getISOWeek (HTML 1577) usa fecha local.
- Clase de bug ACCESIBILIDAD (a11y) apenas tocada: botones con solo glifo '✕' sin aria-label (renderNotes.ts del/note, renderActions.ts), indicadores de estado por SOLO color (renderActions STATUS_COLORS, chips Urgente/Revisar), toggle de checklist clickeable sin rol/teclado (ya notado para renderChecklist pero el patron se repite). No se ejecuto la skill 'audit' de a11y.
- PWA / service-worker stale cache NO auditado: vite.config usa VitePWA registerType:'autoUpdate' con workbox.globPatterns que PRECACHEA 'Control de flotilla.html' (el app real). index.html redirige via <meta http-equiv refresh> al HTML cacheado; combinado con Cache-Control immutable 1y en nginx (assets con hash) PERO el HTML legacy NO lleva hash en su nombre -> riesgo de servir app vieja tras deploy. nginx tiene regla no-cache solo para sw.js/service-worker.js, no para el .html de entrada.
- CSP NO auditada a fondo: el meta CSP del HTML (linea 8) y el header nginx usan 4 hashes sha256 de scripts inline; cualquier edit a un <script> inline rompe la CSP en prod (script bloqueado) — y hay script-src-attr 'unsafe-inline' (handlers inline permitidos) + style-src 'unsafe-inline' (394 estilos) que debilitan la politica. No se verifico que los hashes correspondan al HTML actual ni se corrio scripts/compute-csp-hashes.mjs.
- Cuotas/limites S3 y DynamoDB NO evaluados: photoUpload sube en batches de 8 sin backoff/retry ante throttling S3; listCheckDone/listUnits paginan limit 1000 (RCU). Sin manejo de 429/ProvisionedThroughputExceeded.
- Manejo OFFLINE NO auditado: la app es PWA pero el path cloud (getSession/listX) no degrada a modo offline coherente; toggleCheckItem persiste local pero la cola de sync a la nube no se reintenta al volver online (solo un catch+notify).
- io/inflate.ts (TS) y io/excelLoader.ts NO cubiertos por el cluster io: excelLoader usa cellDates:false (fuerza seriales que parseSvcDate no maneja) y hay DOS inflate (uno inline en HTML 56-784, otro en src/io/inflate.ts) — riesgo de divergencia.
- TEST COVERAGE gap estructural: vitest coverage incluye solo src/\*\* y EXCLUYE main.ts; el HTML legacy (motor real) tiene 0 cobertura unitaria; los E2E Playwright usan ?e2e=1 que BYPASSEA auth/cloud, asi que el path multiusuario/CheckDone/hydrate nunca se prueba end-to-end. CI ademas esta DESACTIVADO (billing) y depende de husky pre-push local.
- amplify/data/resource.ts: CheckDone NO tiene secondaryIndexes ni GSI por unitUid -> listCheckDone(tenantId) es un Scan con filter; ademas itemKey == texto completo del hallazgo (clave fragil ante cambios de texto/locale). No auditado.
- Rutas de ejecucion no exploradas: doble entry de Vite (index.html stub + 'Control de flotilla.html'); el flujo file:// (la app declara soporte file:// en el onerror del module script y en el inflate puro) vs servido por nginx; y el path donde USE*NEW*\* flags estan APAGADOS (default) que usa 100% legacy.

## Bugs sospechados (no verificados)

- Control de flotilla.html:2179-2184 (doArchivoSemanal): periodoId se deriva SOLO de entries[0].fecha. Si la primera fila trae fecha en formato no-DD/MM/YYYY (p.ej. serial Excel que cayo a String(fechaRaw).substring(0,10)='2026-05-01' ISO, o vacia '—'), el regex mDMY no matchea y periodoRef cae a new Date() = HOY -> TODO el periodo semanal se asigna a la semana ISO actual en vez de la real. Mezcla de formatos de fecha en un mismo archivo corrompe el periodoId.
- Control de flotilla.html:2184 vs src/api/batchUpload.ts:147-148,246-247: Mismatch de zero-padding del periodoId entre fuentes: el legacy genera `${year}-W${String(week).padStart(2,'0')}` (p.ej. 2026-W09) mientras batchUpload lo extrae del filename con regex (\d{4}-W\d{1,2}) SIN re-padear (2026-W9). El mismo periodo semanal se almacena/consulta bajo dos claves distintas (W09 vs W9) -> Semanal cloud y vista local quedan en periodos separados; weeklyPeriodos.sort por localeCompare (linea 2192) tambien desordena W9 vs W10.
- Control de flotilla.html:2150 (conversion serial Excel): new Date((fechaRaw-25569)\*86400000) interpreta el epoch en ms UTC pero luego .toLocaleDateString('es-MX') lo formatea en hora LOCAL (UTC-6 en Mexico). Un serial que representa medianoche de un dia se renderiza como el dia ANTERIOR a las 18:00 local -> fecha de inspeccion semanal desfasada un dia. Mismo patron TZ-local en getISOWeek (1577) y new Date(iso+'T00:00:00') en heatmap legacy (2693).
- src/api/cloudWire.ts:303-322 (**cloudSetCheck) + Control de flotilla.html:3317-3340 (toggleCheckItem): Escritura de CheckDone es fire-and-forget sin rollback: toggleCheckItem ya mutó checklistDB local + dbPut + recalcRisk antes de que el upsert/delete a la nube se resuelva. Si **cloudSetCheck rechaza (red/throttle/permiso), solo hay console.warn+notify; el estado local queda divergente del cloud y de los demas usuarios indefinidamente, sin cola de reintento al reconectar. Ademas upsertCheckDone (client.ts:371) usa create->catch conditional->update: dos usuarios marcando el MISMO item concurrentemente entran en TOCTOU last-write-wins.
- src/state/appState.ts:85-99 (bindLegacyWindow get trap): El getter sintetico llama appStore.set(stateKey, val) DENTRO de la lectura de window.units cuando detecta cambio, y Store.set emite sincronamente a subscribers (store.ts:43-48,93-101). Cualquier subscriber que lea window.units en su callback reentra el getter -> set -> emit, arriesgando recursion/reentrancy y notificaciones con estado a medio-actualizar. El bridge tambien declara que NO observa mutaciones in-place (units.push), por lo que store y window divergen si el legacy muta en sitio.
- src/api/client.ts:397-408 (listCheckDone) y amplify/data/resource.ts:120-130: CheckDone no define secondaryIndexes; listCheckDone consulta con filter:{tenantId:{eq}} que en DynamoDB es un Scan filtrado (no Query por indice) — escala mal y consume RCU sobre filas de otros tenants. Combinado con itemKey = texto literal del hallazgo como parte del identifier, cualquier cambio de redaccion del checklist huerfaniza los CheckDone (quedan marcados items con texto viejo que ya no existe).
