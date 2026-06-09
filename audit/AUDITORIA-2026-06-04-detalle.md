# Auditoria 2026-06-04 — detalle de hallazgos (legacy + write-path)

Tercera pasada multi-agente: 14 clusters del monolito legacy `Control de flotilla.html` + 4 del write-path multiusuario (CheckDone / batchUpload / cloudWire / client.ts / data model). Verificacion adversarial de doble lente (correccion + alcance/liveness) por hallazgo, mas un critico de completitud. Resultado: 60 confirmados (0 P0, 14 P1, 29 P2, 17 P3), 16 refutados, 2 inciertos.

Convencion de cabecera: `### [Pn][LIVE|flag|latente] N. Titulo`.

---

## Confirmados

### [P1][LIVE] 1. persistState() borra todas las fotos manuales del store "images" al actualizar el Excel mensual

**Modulo/Archivo:** `Control de flotilla.html:989-992` (persistState); `3425-3431` (addManualPhoto); `3348-3373` (loadManualPhotos)
**Descripcion:** El store IndexedDB `images` guarda fotos del ZIP (key=archivo, value=Uint8Array) y fotos manuales (key `manual_*`, value `{uid,label,data}`). `persistState` hace `imgStore.clear()` y solo re-escribe `Object.keys(zipImgs)`, que en un flujo fresco/en-sesion NO contiene las `manual_*`.
**Impacto:** Perdida silenciosa de evidencia fotografica subida manualmente al actualizar el Excel/ZIP mensual sin pasar antes por restoreState en esa carga. Sin aviso al usuario.
**Causa raiz:** `persistState` asume que `images` solo contiene fotos del ZIP; el `clear()` es indiscriminado y comparte store con las manuales.
**Evidencia:** `imgStore.clear(); for(const k of keys){ imgStore.put(zipImgs[k], k); }` con `keys=Object.keys(zipImgs)` (L974).
**Fix sugerido:** Borrar solo keys NO-`manual_` (cursor), o re-persistir `manualPhotosDB` tras el clear, o store separado `manualImages`.
**Verificacion:** `addManualPhoto` (L3392-3433) escribe `manual_*` directo al store y solo hace push a `manualPhotosDB` en RAM, nunca a `zipImgs`. `restoreState` (L1040-1042) vuelca todas las keys a `zipImgs`, pero en el flujo en-sesion (subir manual → actualizar Excel sin reload) `zipImgs` nunca contiene `manual_` → el clear las elimina. P1 (no P0) porque requiere ese orden concreto y un reload+restore intermedio las rescata.

### [P1][LIVE] 2. persistState borra TODAS las fotos manuales del IndexedDB en cada carga de Excel

**Modulo/Archivo:** `Control de flotilla.html:971-1018` (clear en 989); colisiona con `3425-3431` y `3348-3373`
**Descripcion:** Misma raiz que el #1, encuadrada sobre el caller rutinario: `persistState` se invoca al final de CADA carga/actualizacion de Excel (L2343). La galeria sigue mostrando las fotos desde `manualPhotosDB` en RAM (enmascara el bug) pero al recargar `loadManualPhotos` lee el store vaciado.
**Impacto:** Perdida total e irrecuperable de fotos manuales (son locales, no se sincronizan a la nube) en el flujo normal mensual.
**Causa raiz:** `imgStore.clear()` no preserva ni reescribe los registros `manual_`.
**Evidencia:** `imgStore.clear(); for(const k of keys){ imgStore.put(zipImgs[k], k); }` (L989-992); `tx.objectStore("images").put(entry,id)` con `id="manual_"+...` (L3425-3431).
**Fix sugerido:** Cursor selectivo que omita `manual_`, o reescribir los `manual_` tras el clear, o object store separado.
**Verificacion:** `loadWB` (caller) llama `persistState(fname)` (L2343) en ambas rutas (Excel-solo y ZIP+Excel); en ninguna `zipImgs` contiene `manual_`. El unico `.clear()` sobre `images` es `persistState`; los otros operan sobre stores distintos. Clasificado P1 (no P0) porque requiere haber usado la feature de fotos manuales y la sesion en curso no se ve afectada (RAM) hasta el reload.

### [P1][LIVE] 3. normFluidRisk clasifica "sin fuga" / "no hay fuga" como Urgente

**Modulo/Archivo:** `Control de flotilla.html:1438-1462`
**Descripcion:** La lista URG contiene la subcadena suelta `"fuga"` y se evalua con `v.includes(kw)` ANTES del whitelist OK. Frases negativas/positivas ("sin fuga", "no hay fuga", "no presenta fuga", "sin fugas") hacen match en URG y retornan "Urgente" aunque esten en OK.
**Impacto:** Una unidad sana (aceite/radiador sin fuga) se marca Urgente/inmovilizante; aceite y radiador son los unicos sistemas vitales que votan `calcEstatusSemanal`, asi que el estatus global pasa a URGENTE → boton "Enviar a Taller", KPIs y `__cloudSyncSemanales` espurios.
**Causa raiz:** Orden de evaluacion invertido respecto a `normBodyRisk` (que evalua OK antes que URG).
**Evidencia:** `if(URG.some(kw => v.includes(kw))) return "Urgente";` (L1448, con `"fuga"` en URG) corre antes de `if(OK.some(...)) return "OK";` (L1458, con "sin fuga"/"no hay fuga").
**Fix sugerido:** Evaluar OK antes que URG (como `normBodyRisk`), o quitar `"fuga"` generico dejando solo "con fuga"/"fuga de aceite".
**Verificacion:** Reproducido empiricamente: las 6 frases de no-fuga devuelven "Urgente". El bug esta replicado identico en `src/analyzer/risk.ts` y el webhook `handler.ts`. El propio whitelist contiene esas frases → el formulario/inspectores SI las usan. P1 (no P0): resultado incorrecto silencioso, sin crash ni perdida de datos.

### [P1][LIVE] 4. Fecha serial de Excel en Semanales se desfasa un dia (UTC) vs fDate

**Modulo/Archivo:** `Control de flotilla.html:1370-1376` (fDate correcto) vs `2146-2184` (path semanal)
**Descripcion:** `fDate` usa `XLSX.SSF.parse_date_code` (componentes de calendario sin TZ). El path semanal (L2150) hace `new Date((fechaRaw-25569)*86400000).toLocaleDateString("es-MX")`, que construye medianoche UTC y la renderiza en hora local; en UTC-6 cae el dia anterior.
**Impacto:** (1) fecha mostrada un dia antes; (2) ese `fechaStr` alimenta `periodoRef`→`getISOWeek`→`periodoId`, asi que en frontera de semana la inspeccion se archiva en la semana ISO equivocada (llave de `weeklyPeriodos`, sync cloud y filtro de rango).
**Causa raiz:** Aritmetica de epoch UTC + formateo local en lugar de reutilizar `fDate`/`parse_date_code`.
**Evidencia:** `if(typeof fechaRaw==="number") fechaStr=new Date((fechaRaw-25569)*86400000).toLocaleDateString("es-MX");` (L2150).
**Fix sugerido:** Reemplazar L2150 por `fDate(fechaRaw)`.
**Verificacion:** Las 3 rutas leen con `cellDates:false` + `raw:true`, asi que las fechas llegan como serial y el path se ejecuta. Repro Node: serial 45810 → '1/6/2025' en UTC-6 vs '02/06/2025' con parse_date_code. Afecta a todas las sucursales GPA (husos negativos). P1.

### [P1][LIVE] 5. Llave de checklist (CheckDone) embebe el valor mm de la llanta

**Modulo/Archivo:** `Control de flotilla.html:1355-1356` (texto) y `1654-1655` (\_hasPending usa f.text como llave)
**Descripcion:** Los hallazgos de Llantas usan `${n}: ${v}mm — desgaste critico/revisar` como `f.text`, que es la llave de `checklistDB` y de CheckDone cloud. A diferencia de Checklist/Fluidos (texto estable), cambia con la lectura mm.
**Impacto:** Marcar atendido "3mm" y luego subir un Excel con 2mm/3.5mm genera otra llave; el flag `done` ya no coincide y el hallazgo reaparece como pendiente, reactivando chip Urgente/Revisar. El CheckDone viejo queda huerfano en DynamoDB.
**Causa raiz:** El texto display (con dato variable) actua como llave estable.
**Evidencia:** `F.push({cat:"Llantas",text:`${n}: ${v}mm — desgaste crítico`,lv:"Urgente"})` (L1355); `const _hasPending=(u,lv)=>{const dm=checklistDB[u.uid]||{};return u.F.some(f=>f.lv===lv&&!(dm[f.text]&&dm[f.text].done))}` (L1654).
**Fix sugerido:** Llave estable independiente del valor (`Llanta:${n}`); mostrar mm solo como display; reconciliar/podar huerfanos en hydrate.
**Verificacion:** Cadena completa verificada (toggleCheckItem → __cloudSetCheck → upsertCheckDone → cloudHydrate). `hydrateFromCloud` solo agrega CheckDone, no poda huerfanos. P1: probabilidad alta (las lecturas mm derivan entre reportes), no causa crash ni perdida del dato fuente.

### [P1][LIVE] 6. exportFleetPDF se cae SIEMPRE: la paleta C no define C.O y setTextColor(undefined) lanza

**Modulo/Archivo:** `Control de flotilla.html:4290-4296,4357,4364,4366,...4586`
**Descripcion:** La paleta local de `exportFleetPDF` omite `O` y todas las tintes (`Rl/Rd/Al/Ad/Bd/...`) que el cuerpo usa. La 6a tarjeta KPI ("LLANTAS CRIT.") usa `C.O`=undefined; el helper `txt` llama `doc.setTextColor(undefined)` → jsPDF entra a la rama gris y ejecuta `f3(NaN)` → throw.
**Impacto:** El "Reporte ejecutivo de flotilla" no genera NINGUN PDF para ningun usuario con >=1 unidad; falla en silencio (no hay try/catch, el async aborta antes de `doc.save`).
**Causa raiz:** `exportFleetPDF` se derivo de `exportPDF` pero su paleta omitio las tintes; el cuerpo si las usa.
**Evidencia:** `C={ R:..., A:..., G:..., B:..., ... }` sin `O` (L4290-4296); `{label:"LLANTAS CRIT.", val:nCT, color:C.O, ...}` (L4357); `txt(String(kd.val),...,kd.color,...)` con `kd.color=undefined` → throw.
**Fix sugerido:** Copiar el bloque de tintes de `exportPDF` (L3968-3973) y agregar `O:"#EA580C"` y `Al:"#FDE68A"`.
**Verificacion:** El crash real es en el helper `txt` (setTextColor sin guard), no en `rect` (que protege con `if(fill)`); verificado en el bundle vendido jsPDF 4.2.1 (`f2/f3` lanza ante NaN). El boton es `display:flex` siempre que `total>0`. P1 (no P0): funcionalidad importante totalmente rota, sin perdida/corrupcion de datos y el export por unidad sigue funcionando.

### [P1][LIVE] 7. Filtro de rango semanal descarta TODAS las entries cuando la fecha es DMY vs rango ISO

**Modulo/Archivo:** `Control de flotilla.html:2148-2154,4773,5488-5490`
**Descripcion:** `e.fecha` puede quedar como `'28/5/2026'` (DMY, desde serial/Date via `toLocaleDateString`), pero `getSwEntriesInRange` compara `String(e.fecha).slice(0,10)` lexicograficamente contra `swRangeFrom/swRangeTo` (ISO de inputs date). `'28/...' > '2026...'` → excluida.
**Impacto:** Con un Excel de fechas tipo-fecha (caso comun MoreApp), Semanales aparece vacio: KPIs en blanco, tabla vacia, badge 0 urgentes pese a haber datos. Afecta tambien a usuarios hidratados desde la nube.
**Causa raiz:** `e.fecha` no se normaliza a ISO al parsear, pero el filtro asume ISO.
**Evidencia:** `if(typeof fechaRaw==="number") fechaStr=new Date(...).toLocaleDateString("es-MX");` (L2150-2152); `const f=String(e.fecha||"").slice(0,10); if(!f||f<swRangeFrom||f>swRangeTo) continue;` (L5488-5490).
**Fix sugerido:** Normalizar a ISO al parsear y/o aplicar el helper `isoDay` (ya existe en cloudHydrate, usado en el filtro mensual) dentro de `getSwEntriesInRange` y en `cloudHydrate L315`.
**Verificacion:** Repro Node confirma `inRange('28/5/2026','2026-05-01','2026-05-31')===false`. El chokepoint alimenta KPIs/tabla/badge/fleet-modal/openSwPhotos. La asimetria (mensual usa `isoDay`, semanal no) confirma que el fix no se replico. P1: vista completa vacia silenciosamente con datos presentes.

### [P1][LIVE] 8. getSwEntriesInRange compara DD/MM/YYYY contra rango ISO (XLSX manual)

**Modulo/Archivo:** `Control de flotilla.html:5484-5496` (raiz en 2146-2153 y 5311-5331)
**Descripcion:** Misma clase que el #7, encuadrada sobre la via primaria XLSX manual: `loadWBSemanal` produce `fecha` DMY desde serial Excel, `getSwEntriesInRange` compara lexicograficamente contra el rango ISO por defecto (ultimos 30 dias).
**Impacto:** Tabla Semanales, KPIs y conteo "Sin check" muestran datos incompletos/vacios para periodos cargados por XLSX; las entries DMY se suben verbatim a la nube envenenando la hidratacion.
**Causa raiz:** Inconsistencia de formato: parser genera DMY, filtro asume ISO.
**Evidencia:** `if(!f || f < swRangeFrom || f > swRangeTo) continue;` (L5489-5490) con `f` DMY y rango `from.toISOString().slice(0,10)` (L5320-5322).
**Fix sugerido:** Almacenar `fechaStr` en ISO en `loadWBSemanal`, o `isoDay(e.fecha)` en `getSwEntriesInRange`.
**Verificacion:** Confirmado byte a byte. `faltanS` (Sin check) deriva del mismo set (infla faltantes). El path webhook no sufre (ISO via `split(/[ T]/)`), pero el XLSX manual es la via primaria del legacy. P1.

### [P1][LIVE] 9. exportTallerActivasExcel exporta Gasto Total = 0

**Modulo/Archivo:** `Control de flotilla.html:6499,6505-6507`
**Descripcion:** El export de Activas calcula `gTotal=(e.gastoRef||0)+(e.gastoMO||0)` y emite las 3 columnas de gasto, pero el formulario siempre escribe `gastoRef:0`/`gastoMO:0` y guarda el monto en `e.gasto`. No hay fallback a `e.gasto` (que SI tiene Historial).
**Impacto:** Para toda entrada del formulario (caso normal), Gasto Ref/M.O./Total salen en $0 en el reporte que se usa para tesoreria. Perdida silenciosa del dato economico en el export.
**Causa raiz:** La columna no replica el fallback a `e.gasto` de Historial; la separacion Ref/M.O. nunca se cablea desde el formulario.
**Evidencia:** `const gTotal=(e.gastoRef||0)+(e.gastoMO||0);` vs el correcto en `exportTallerHistorialExcel L6548`.
**Fix sugerido:** `const gTotal=(e.gastoRef||0)+(e.gastoMO||0)>0 ? ... : (e.gasto||0);`.
**Verificacion:** No existe input `tf-gastoRef/tf-gastoMO`; `calcTotalGasto` ni siquiera esta definida (no-op). `cloudHydrate` preserva los valores tal cual (Ref/MO=0). `docs/FEATURE_PARITY.md` marca la funcion como gap (legacy es lo vivo). P1 (e.gasto se preserva en el origen, solo afecta el export).

### [P1][LIVE] 10. Editar Fecha de Entrada (o placa/eco) de un registro de taller crea un duplicado fantasma en cloud

**Modulo/Archivo:** `Control de flotilla.html:7058-7070` + `batchUpload.ts:408-427` + `client.ts:128-151`
**Descripcion:** La PK compuesta del Taller es `(tenantId, unitUid, fechaEntrada)` con `unitUid=plate||eco||...` y `fechaEntrada=e.fentrada`, ambos editables. Al corregir la fecha (o placa/eco) de un registro ya sincronizado, `upsertTaller` escribe una fila NUEVA y nunca borra la vieja; el path de edicion no llama `deleteTaller`.
**Impacto:** El expediente muestra una visita duplicada; conteo de ingresos y gasto acumulado inflados para todos tras la re-hidratacion (que reconstruye `tallerEntries` 1:1 sin dedupe).
**Causa raiz:** Composite key con campo mutable + edicion que solo hace upsert de la clave nueva.
**Evidencia:** `if(idx>=0) tallerEntries[idx]=entry;` (L7059-7060) seguido de `window.__cloudSyncTaller([entry])` (L7068); `unitUid=e.plate||...; fechaEntrada=e.fentrada` (batchUpload 409-410).
**Fix sugerido:** Llamar `__cloudDeleteTaller(srcEntry)` con la clave vieja antes del upsert, o anclar la PK a `e.id` inmutable.
**Verificacion:** `srcEntry` ya esta capturado (L7017) pero solo se usa para unitKey/reingreso. `cloudHydrate` mapea cada fila 1:1 sin dedupe por id → ambas afloran. P1: corrupcion multiusuario silenciosa, probabilidad media (requiere editar fecha/placa/eco de un registro ya subido).

### [P1][LIVE] 11. Taller: fechaEntrada cae a updatedAt → cada edicion/finalizacion crea un registro cloud NUEVO

**Modulo/Archivo:** `src/api/batchUpload.ts:410,418-427`
**Descripcion:** `fechaEntrada = e.fentrada || e.freporte || e.updatedAt || now`. Cuando ambas fechas estan vacias (campos opcionales; solo `tipo`+`km` son obligatorios), el key cae a `updatedAt`, que se regenera en CADA save/finalize → key distinta por guardado.
**Impacto:** Proliferacion de registros Taller + huerfanos permanentes; la unidad aparece Activa y Finalizada a la vez para todos los usuarios.
**Causa raiz:** Usar `updatedAt` (mutado en cada save) como fallback de un componente del composite key.
**Evidencia:** `const fechaEntrada = e.fentrada || e.freporte || e.updatedAt || new Date().toISOString();`; `updatedAt: new Date().toISOString()` regenerado en HTML:7040 y 6886.
**Fix sugerido:** Derivar `fechaEntrada` de un valor inmutable (`e.id` `tl_<ts>`) o incluir `e.id` en el identifier de Taller.
**Verificacion:** Distinto del #10 (alli dos entries colisionan → perdida; aqui un entry cuya key muta → duplicacion). Condicional: solo cuando ambas fechas vacias; la ruta de reingreso pre-rellena hoy, la de alta manual no. P1 por impacto alto × probabilidad alta-condicional.

### [P1][LIVE] 12. Desmarcado de un hallazgo se pierde y "resucita" en todos los usuarios si deleteCheckDone falla

**Modulo/Archivo:** `cloudWire.ts:303-322` + `Control de flotilla.html:3324-3337` + `cloudHydrate.ts:502-512`
**Descripcion:** El desmarcado local es sincrono + `__cloudSetCheck(...,false)` fire-and-forget. Si `deleteCheckDone` falla (offline/red/throttle/auth), el `.catch` solo loguea/notifica; el CheckDone sigue `done:true` en la nube y el merge aditivo lo re-agrega en la siguiente hidratacion.
**Impacto:** El desmarcado desaparece y el hallazgo vuelve a verse "atendido" de forma persistente para toda la flota — un hallazgo Urgente reabierto puede ocultarse como resuelto.
**Causa raiz:** Escritura fire-and-forget sin reintento/rollback + merge solo-aditivo que ignora ausencias.
**Evidencia:** `else { await deleteCheckDone({...}); }` (cloudWire 319-321); `if (cd.done === false) continue; (cdb[uid] ??= {})[key] = { done: true, ... }` (cloudHydrate 504-509).
**Fix sugerido:** Tombstones `done:false` que el merge respete, o cola de reintento con backoff; mientras tanto no re-agregar dones con desmarcado local pendiente.
**Verificacion:** `deleteCheckDone` (client.ts 387-395) usa `throwOnErrors` → el fallo llega al catch. No existe outbox/cola en `src`. Corroborado por la propia auditoria 2026-06-03 (#2). P1: condicional a fallo de sync, pero impacto alto sobre seguridad operativa compartida.

### [P1][LIVE] 13. unitUid de CheckDone inconsistente entre el path ZIP (placa) y el path cloud (placa\_\_fecha)

**Modulo/Archivo:** `src/api/client.ts:371-385` + caller HTML `3317-3337` + `cloudHydrate.ts:363,506-509`
**Descripcion:** `toggleCheckItem` persiste CheckDone con `unitUid=units[i].uid`, pero ese uid es `plate` en sesion ZIP (HTML 2156/2266) y `plate__fecha` en sesion cloud (cloudHydrate 363). El identifier `(tenantId,unitUid,itemKey)` produce llaves distintas; una completacion creada en un path nunca coincide en el otro.
**Impacto:** Las completaciones compartidas no cruzan entre modos ZIP↔cloud; `deleteCheckDone` desde un path no borra el record del otro; quedan huerfanos bajo dos esquemas.
**Causa raiz:** `unitUid` tomado del uid efimero/derivado, no estable entre paths.
**Evidencia:** ZIP `const uid = plate||eco||"SIN_ID";` (L2156); cloud `row.uid = ${row.plate ?? c.unitUid}__${fecha};` (cloudHydrate 363); merge `(cdb[cd.unitUid] ??= {})[key]` (506-509).
**Fix sugerido:** Normalizar `unitUid` a placa cruda en el write-path (derivar de `units.find(uid).plate`) y en el merge.
**Verificacion:** Cloud↔cloud SI comparten (ambos placa\_\_fecha); el bug se materializa en el CRUCE (subir ZIP con sesion + vista cloud). `mergeUnitWithChecklist` fallback genera un tercer formato (placa sin sufijo), agravando. P1.

### [P1][LIVE] 14. unitUid de CheckDone difiere entre ZIP local (plate) y cloud (plate\_\_fecha)

**Modulo/Archivo:** `Control de flotilla.html:2266` (uid local) vs `src/api/cloudHydrate.ts:363,391`
**Descripcion:** Variante del #13 con evidencia complementaria: el checkbox usa siempre `u.uid` (HTML 3276 `data-arg1="${escAttr(u.uid)}"`), que es `plate` en local y `plate__fecha` en cloud; el merge-back keyea por `cd.unitUid` literal sin reconciliar.
**Impacto:** Las dos representaciones de la misma unidad fisica producen claves de completacion que jamas coinciden → rompe "completaciones compartidas" (commit 0e10efb) cuando los modos difieren.
**Causa raiz:** uid de display (plate**fecha) usado tambien como `unitUid` de persistencia.
**Evidencia:** `const uid=plate||eco||"SIN_ID";` (2266) vs `row.uid = ${row.plate ?? c.unitUid}**${fecha};`(363); merge`const uid = cd.unitUid; (cdb[uid] ??= {})[key]=...`(506-509).
**Fix sugerido:** Resolver el uid de display por separado del`unitUid`de persistencia, derivando este de placa/eco normalizada.
**Verificacion:** TODOS los lookups en HTML son`checklistDB[u.uid]`. CheckDone se persiste pero no se pierde; el defecto es de reconciliacion cruzada entre paths. P1.

### [P1][LIVE] 15. itemKey de CheckDone es el texto display con mm embebido → completaciones huerfanas al re-inspeccionar

**Modulo/Archivo:** `Control de flotilla.html:1355-1356,3276,3271`
**Descripcion:** El `itemKey` (parte de la PK de CheckDone) es `f.text`, que para llantas embebe el valor TACO y el nivel critico/revisar. Al cambiar `v` o cruzar umbral, el itemKey cambia y la completacion previa se huerfaniza.
**Impacto:** Multiusuario: las completaciones "desaparecen" tras cada carga semanal del mismo vehiculo; `recalcRisk` re-escala a Urgente/Revisar y el operador re-trabaja items ya atendidos. Huerfanos acumulados inflan el Scan de `listCheckDone`.
**Causa raiz:** `itemKey` = string de presentacion con dato volatil en vez de id canonico estable.
**Evidencia:** `text:`${n}: ${v}mm — desgaste crítico`` (1355); `done=doneMap[f.text]&&doneMap[f.text].done` (3271); `data-arg2="${escAttr(f.text)}"` (3276).
**Fix sugerido:** Slug canonico (`llanta:Piloto Delantera`) en CheckDone y `checklistDB`; mm/nivel solo display; backfill/migracion.
**Verificacion:** `amplify/data/resource.ts:124,129`confirma`itemKey` como parte de la PK. Probabilidad ALTA en la clase mas critica (desgaste monotono cruza umbrales semana a semana). El propio repo lo reconoce como deuda diferida. P1.

### [P1][LIVE] 16. BIN findings usan la etiqueta display BIN_LABELS como itemKey

**Modulo/Archivo:** `Control de flotilla.html:1360,1294-1301`
**Descripcion:** Para hallazgos binarios, `f.text = BIN_LABELS[c]||c` (etiqueta de presentacion editable). El identifier de CheckDone es `(tenantId,unitUid,itemKey)` con match por string exacto en hydrate.
**Impacto:** Reeditar la redaccion de una etiqueta (acento, traduccion, reescritura) huerfaniza TODAS las completaciones previas de ese item en todos los vehiculos del tenant; el fallback `||c` agrega una segunda via.
**Causa raiz:** Acoplamiento entre la capa de presentacion (BIN_LABELS, localizable) y la clave de persistencia.
**Evidencia:** `if(isBinFail(row[c])){F.push({cat:"Checklist",text:BIN_LABELS[c]||c,lv:r});esc(r)}` (1360); BIN_LABELS editable (1294-1297).
**Fix sugerido:** Usar la columna Excel `c`/slug como itemKey y reservar BIN_LABELS solo para `f.text` de display (campo `f.key` separado).
**Verificacion:** Cadena completa verificada hasta `cloudHydrate.ts:507-509`. El comentario L1292-1293 confirma que las etiquetas estan pensadas para iterarse (mantenimiento esperado). P1: perdida silenciosa de datos compartidos tenant-wide disparada por una operacion de UI aparentemente inocua.

### [P2][LIVE] 17. \_restoreStateImpl: rama else deja units inconsistente con activePeriodoId (backfill)

**Modulo/Archivo:** `Control de flotilla.html:1074-1084`
**Descripcion:** Si `periodos.length && !activePeriodoId` y no hay `savedPid` valido, el else solo asigna `activePeriodoId=periodos[last].id` sin reasignar `units` ni re-renderizar. `periodos[last]` es el id mas alto (cronologico), pero `units` queda como el blob de la sesion (ultimo Excel persistido).
**Impacto:** El chip del periodo activo no corresponde a los datos mostrados (KPIs/tabla/sucursales del mes equivocado) cuando hubo backfill.
**Causa raiz:** El else fija el id sin sincronizar `units` ni re-renderizar.
**Evidencia:** Rama `else { activePeriodoId = periodos[periodos.length-1].id; }` sin `units = ...; recalcAllRisks(); buildKPIs(); ...`.
**Fix sugerido:** Replicar `switchPeriodo` en el else; opcionalmente `await` el `dbPut` de L5088.
**Verificacion:** El else se alcanza con DB de version previa, `dbPut` fallido en confirmPeriodo, o periodo activo borrado. La rama `if` y `switchPeriodo` si sincronizan `units`. Autocorregible al hacer click en un chip. P2: probabilidad baja, recuperable.

### [P2][LIVE] 18. addManualPhoto no espera la confirmacion de la transaccion IDB

**Modulo/Archivo:** `Control de flotilla.html:3416-3432`
**Descripcion:** Tras `put(entry,id)` se hace `manualPhotosDB[uid].push(...)` y `accepted++` sincronamente, sin esperar `tx.oncomplete`. Si la tx aborta (QuotaExceededError), los handlers solo notifican; la foto queda contada como aceptada pero no persiste.
**Impacto:** Perdida silenciosa de fotos manuales bajo presion de cuota, con falso positivo ("aceptada") al usuario; desaparece al recargar.
**Causa raiz:** Contabilizacion optimista antes del await; manejo de error por-transaccion global sin revertir el estado en memoria.
**Evidencia:** `tx.objectStore("images").put(entry,id); manualPhotosDB[uid].push({...}); accepted++;`.
**Fix sugerido:** Envolver cada put en una promesa que resuelva en `tx.oncomplete`; solo entonces `accepted++`/push; reportar la foto como rechazada en fallo.
**Verificacion:** `dbPut` (L928-935) ya tiene el patron correcto que `addManualPhoto` omite. Hasta 20×10MB por operacion hace la cuota plausible en tablets de campo. P2: impacto de datos × probabilidad baja-moderada; en abort hay toast (no 100% silencioso) pero conviven con el conteo "X aceptadas".

### [P2][LIVE] 19. loadWBSemanal: serial Excel con epoch UTC renderizado local → off-by-one

**Modulo/Archivo:** `Control de flotilla.html:2150,2146,2180-2184,2197-2198`
**Descripcion:** Mismo defecto que el #4, calificado por probabilidad: el corrimiento solo ocurre cuando la fraccion horaria del serial cae en 00:00-05:59 local (capturas de madrugada) o el serial es fecha-pura. El error de semana ISO ademas requiere frontera lunes→domingo.
**Impacto:** Fecha mostrada un dia antes y, en casos limite, `periodoId` mal-bucketeado persistido a IndexedDB y DynamoDB multiusuario.
**Causa raiz:** Conversion a instante UTC + formateo local en lugar de `parse_date_code`.
**Evidencia:** L2150 (epoch UTC) vs L1372 (fDate correcto).
**Fix sugerido:** Alinear con `fDate`/`XLSX.SSF.parse_date_code`.
**Verificacion:** Corre sin feature-flag desde 3 handlers; serial llega como number por `cellDates:false`+`raw:true`. Repro Node confirma el shift y la propagacion al periodoId. P2 (no P1) por intermitencia segun el componente horario.

### [P2][LIVE] 20. doZip: fallos parciales de descompresion se tragan con solo console.warn; estado asignado antes del parseo async

**Modulo/Archivo:** `Control de flotilla.html:1961-1983,1986-1987,2018-2063`
**Descripcion:** Cada error de inflate por entrada se captura con `console.warn` y continua; el unico guard de fallo total es `found===0 && xls.length===0`. Si una imagen descomprime y el resto falla, el set de fotos es parcial sin aviso. Ademas `zipImgs/hasZip` se asignan ANTES de `loadWB` (async, sin await/.catch).
**Impacto:** Carga parcial silenciosa de fotos; estado `zipImgs/hasZip` inconsistente para la siguiente carga si el parseo del Excel embebido rechaza.
**Causa raiz:** Manejo de errores por-archivo demasiado permisivo + asignacion de estado global antes de un parseo que puede rechazar.
**Evidencia:** `}catch(e){ console.warn("[ZIP] Error en archivo:", fname, e.message); }` (1981-1983); `zipImgs = imgs; hasZip = true; ... loadWB(wb, xls[0].name);` (2022/2025).
**Fix sugerido:** Contador de fallos con aviso (healthLog/notify); asignar `zipImgs/hasZip` solo tras parseo exitoso o revertir en fallo.
**Verificacion:** El mecanismo del catch externo es inexacto (loadWB async sin await produce promesa rechazada, no excepcion sincrona; el handler global de unhandledrejection si avisa), pero el defecto principal (fallos parciales tragados + estado inconsistente) es real. P2: no hay perdida total (guard de 0 archivos), disparo requiere ZIP corrupto/parcial.

### [P2][LIVE] 21. Serial Excel → Date off-by-one en TZ negativa (loader semanal)

**Modulo/Archivo:** `Control de flotilla.html:2150`
**Descripcion:** Variante puntual del off-by-one en L2150 (medianoche UTC renderizada en UTC-6 → dia anterior). El loader mensual `fDate` no sufre porque usa `parse_date_code`.
**Impacto:** Fecha semanal mostrada un dia antes; en lunes (frontera ISO) el `periodoId` entero queda en la semana previa, etiquetando el reporte mal en local, IndexedDB y DynamoDB.
**Causa raiz:** Aritmetica de epoch UTC + `toLocaleDateString` en lugar de `parse_date_code`.
**Evidencia:** `if(typeof fechaRaw==="number") fechaStr=new Date((fechaRaw-25569)*86400000).toLocaleDateString("es-MX");`.
**Fix sugerido:** `XLSX.SSF.parse_date_code(fechaRaw)` o `new Date(y,m-1,d)` con componentes locales.
**Verificacion:** Repro confirma serial 45809 → '5/31/2025' vs '6/1/2025'. Solo se materializa cuando la hora local cae 00:00-05:59 o el serial es fecha-pura. P2.

### [P2][LIVE] 22. periodoId cae a la semana ISO de HOY cuando la fecha llega como cadena ISO

**Modulo/Archivo:** `Control de flotilla.html:2152,2180-2184`
**Descripcion:** El regex de periodo solo acepta DMY (`^(\d{1,2})\/(\d{1,2})\/(\d{4})$`). Cuando `'Fecha y Hora'` es cadena ISO, `substring(0,10)` da `'2026-06-04'` (guiones) que no matchea → `periodoRef` queda en `new Date()` (HOY) → semana ISO de la importacion.
**Impacto:** Reportes de semanas pasadas etiquetados con la semana actual; el dedup por id deja de funcionar (re-subir crea periodos DUPLICADOS en local, IDB y DynamoDB); `periodInRange` muestra datos en la semana equivocada.
**Causa raiz:** El parser inline solo contempla DMY; el fallback usa HOY silenciosamente.
**Evidencia:** `const mDMY = String(firstFecha).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if(mDMY) periodoRef = ...; const periodoId = `${year}-W${...}`;`.
**Fix sugerido:** Aceptar ISO (reutilizar `parseSvcDate`, que ya lo soporta) o avisar si no parsea ninguna fecha.
**Verificacion:** Confirmado; el formato ISO con `T`/espacio ES un formato real en el sistema (uploadZipToCloud usa `split(/[ T]/)`). Las entries conservan su `fecha` real (vistas que ordenan por `e.fecha` siguen bien); el dano es a la agrupacion/dedup. P2: condicionado al formato de exportacion de la celda.

### [P2][LIVE] 23. Panel de Alertas queda obsoleto tras cambiar de periodo

**Modulo/Archivo:** `Control de flotilla.html:4952-4965,2743`
**Descripcion:** `switchPeriodo` reasigna `units`, recalcula riesgos y refresca KPIs/tabla/sucursales pero NO llama `buildAlertsSummary()`. `showView('inspecciones')` tampoco lo refresca.
**Impacto:** El banner de alertas (servicio vencido/proximo, urgentes, llantas criticas, +7d taller, pendientes) muestra datos del periodo ANTERIOR; induce decisiones sobre el mes equivocado hasta recargar.
**Causa raiz:** El refresco parcial omite `buildAlertsSummary`, que solo corre en carga inicial/restore.
**Evidencia:** `function switchPeriodo(id){ ... units = p.units; recalcAllRisks(); ... buildKPIs(); buildBranches(); renderTable(); renderPeriodoBar(); }` (falta `buildAlertsSummary()`).
**Fix sugerido:** Añadir `buildAlertsSummary()` al final de `switchPeriodo` (y opcionalmente en la rama `isInsp` de `showView`).
**Verificacion:** `buildAlertsSummary` solo se invoca en L1068/2040/2338. Acotado al flujo local multi-mes (cloud no puebla `periodos`). P2: inconsistencia visible detectable, autocorrige al recargar.

### [P2][LIVE] 24. Alerta "Pendientes" (Completar) dispara setF('Completar') que no existe como filtro

**Modulo/Archivo:** `Control de flotilla.html:2791-2795,1656-1669,3657-3663,378-386`
**Descripcion:** El chip #5 usa `action:'Completar'` → `setF('Completar')`. `filt()` no tiene caso `curF==="Completar"` (solo taller/svcvencido/obs/Urgente/Revisar) y no existe `btn-Completar`.
**Impacto:** Al hacer click la tabla muestra la flota completa sin filtrar y `setF` no resalta ningun chip (borra el resaltado previo). UX engañosa de un control frecuente.
**Causa raiz:** Accion de alerta apunta a un valor de filtro nunca implementado.
**Evidencia:** `alerts.push({...,short:"Pendientes",action:"Completar"})` (2792-2795); `filt()` sin `if(curF==="Completar")`.
**Fix sugerido:** Agregar el gate `if(curF==="Completar" && !_hasPending(u,"Completar")) return false;` (y opcionalmente el chip `btn-Completar`).
**Verificacion:** Grep confirma 0 ocurrencias de `curF==="Completar"`. El helper `_hasPending` ya soporta "Completar" pero no se invoca para ese caso. Los items "Completar" son rutinarios (gato, triangulo, licencia, poliza...). P2: resultado incorrecto silencioso de alta frecuencia, recuperable.

### [P2][LIVE] 25. Alerta "Pendientes" cuenta hallazgos ya atendidos (ignora checklistDB)

**Modulo/Archivo:** `Control de flotilla.html:2791-2795,2610-2620`
**Descripcion:** El conteo usa `u.F.some(f=>f.lv==="Completar")` sin descontar atendidos en `checklistDB`, a diferencia de `catMap`, chips KPI y `fcell` que si lo descuentan.
**Impacto:** El numero "Pendientes" del banner no cuadra con analytics/chips/tabla; sobre-reporta unidades cuyo "Completar" ya esta atendido.
**Causa raiz:** El filtro de la alerta no aplica la capa checklistDB.
**Evidencia:** `const completar=units.filter(u=>u.F.some(f=>f.lv==="Completar"));` sin `!(dm[f.text]&&dm[f.text].done)`.
**Fix sugerido:** `const completar=units.filter(u=>_hasPending(u,"Completar"));`.
**Verificacion:** Confirmado contra `_hasPending` (L1654), KPIs (L2508) y catMap (L2613). P2: inconsistencia de conteo, sin crash ni perdida de datos.

### [P2][LIVE] 26. Tres definiciones distintas de "servicio" conviven (card/chip/alertas)

**Modulo/Archivo:** `Control de flotilla.html:2453-2466,2493,2512-2519,1660,2752-2761,5355-5362`
**Descripcion:** La card hero y el modal usan `svcStatus` (prioriza km; si hay km validos NUNCA mira la fecha). El chip "Svc ≤30d", el filtro `svcvencido` y las alertas usan SOLO `parseSvcDate(nextSvc)<=d30`.
**Impacto:** Conteos contradictorios en la misma pantalla; click en card vs chip abre sets distintos; una unidad vencida por km puede quedar fuera del chip/filtro que el operador usa para actuar.
**Causa raiz:** `svcStatus` introdujo prioridad por km solo en card/modal; chip/filtro/alertas quedaron con logica solo-fecha.
**Evidencia:** card `const ss=svcStatus(x)`; chip/filtro `const sd=parseSvcDate(x.nextSvc); if(sd && sd<=d30)`; svcStatus `if(kmAx>0&&kmNx>0){ if(kmDiff<=0) return "vencido"; if(kmDiff<=1000) return "proximo"; return "ok"; }`.
**Fix sugerido:** Unificar chip/filtro/alertas a `svcStatus(u)!=="ok"`, o documentar/renombrar la diferencia.
**Verificacion:** Confirmado; los comentarios del propio codigo presumen que "cuadra con el numero de la card", evidenciando que el drift no es intencional. Probabilidad alta (km y fecha coexisten en el export). P2.

### [P2][LIVE] 27. En restore, buildAlertsSummary corre ANTES de loadAllChecklist/recalcAllRisks

**Modulo/Archivo:** `Control de flotilla.html:1068-1070,2763-2768`
**Descripcion:** En el restore, `buildAlertsSummary()` se llama en L1068 antes de `await loadAllChecklist()` (L1069) y `recalcAllRisks()` (L1070). El chip "Urgente" usa `u.risk` aun sin descontar los atendidos; tras L1070 `recalcAllRisks` corrige `u.risk` pero no se vuelve a llamar `buildAlertsSummary`.
**Impacto:** El banner puede mostrar mas unidades "Urgente" y mayor conteo que las realmente pendientes, hasta recargar.
**Causa raiz:** Orden de llamadas: alertas construidas sin la capa checklistDB; el recalculo posterior no re-dispara alertas.
**Evidencia:** `... renderTable(); buildAlertsSummary(); await ... loadAllChecklist() ...; recalcAllRisks(); buildKPIs(); renderTable();` (sin `buildAlertsSummary()`).
**Fix sugerido:** Mover/duplicar `buildAlertsSummary()` despues de `recalcAllRisks()`.
**Verificacion:** `checklistDB` puede haber cambiado (multiusuario), asi que `recalcAllRisks` puede bajar `u.risk` de Urgente a Revisar/OK. Solo el banner queda inconsistente (tabla/KPIs si se corrigen). P2: sobreconteo de presentacion, alta frecuencia, recuperable.

### [P2][LIVE] 28. renderService ordena la "ultima revision semanal" por el LABEL en vez del id ISO

**Modulo/Archivo:** `Control de flotilla.html:3152-3155`
**Descripcion:** Se aplanan las entries de `weeklyPeriodos` con `_periodo:p.label` y se ordena descendente por `localeCompare(_periodo)`. El label es "Semana N, AAAA" (sin padding de semana, año al final), cuyo orden lexicografico no es cronologico.
**Impacto:** "Semana 9, 2026" gana a "Semana 10/22, 2026" (porque '9'>'1'/'2'), y "Semana 52, 2025" gana a "Semana 3, 2026" → la tarjeta "Ultima revision semanal" muestra datos del periodo equivocado.
**Causa raiz:** Se ordena por el label legible en vez del id ISO `AAAA-Www` (con padding); las entries no arrastran el id.
**Evidencia:** `.flatMap(p=>p.entries.map(e=>({...e,_periodo:p.label}))).filter(...).sort((a,b)=>(b._periodo||"").localeCompare(a._periodo||""))[0]`.
**Fix sugerido:** Adjuntar `_pid:p.id` y ordenar por el; o recorrer `weeklyPeriodos` (ya ordenado asc por id) de atras hacia adelante.
**Verificacion:** Repro Node confirma la eleccion incorrecta. Existe una reescritura TS (`renderService.ts`) que lo arregla pero esta tras `USE_NEW_DETAIL` (apagado por defecto). Probabilidad alta (backfill desde ene-2026 acumula W01..W22+). P2: acotado a una tarjeta de cross-referencia de solo lectura.

### [P2][LIVE] 29. Pestaña Llantas muestra "Taco minimo: 0mm — Reemplazo urgente" falso

**Modulo/Archivo:** `Control de flotilla.html:3107-3126`
**Descripcion:** El early-return es `if(!entries.length && u.hasRefaccion!==false)`. Una unidad con `hasRefaccion===false` y sin ningun taco numerico (`T={}`, `minT=null`) no retorna; el bloque de alerta evalua `null<=TCRIT` (true) y `Number(null)=0`.
**Impacto:** Falsa alerta critica "0mm — Reemplazo urgente" para una unidad sin lecturas de taco.
**Causa raiz:** El bloque de alerta no contempla `minT===null`; la comparacion `null<=TCRIT` colapsa a 0.
**Evidencia:** `const ac=u.minT<=TCRIT?...; ...Taco mínimo: <b>${Number(u.minT)}mm</b> — ${at}`.
**Fix sugerido:** Envolver la alerta en `if(u.minT!==null){...}` (como `tcell` L2861 y el PDF L4090).
**Verificacion:** Confirmado; el resto del codigo (KPI, alerts, modal, PDF) si guarda contra null, asi que el bug esta contenido en esta pestaña y es inconsistente con la propia tabla (que muestra "—"). Patron de datos real (motos/remolques + refaccion "No"). P2: frecuencia moderada-baja, sin propagarse a agregados.

### [P2][LIVE] 30. Race loadAllChecklist (reset checklistDB={}) vs merge de CheckDones cloud

**Modulo/Archivo:** `Control de flotilla.html:3294-3300` vs `cloudHydrate.ts:500-512`
**Descripcion:** `loadAllChecklist` hace `checklistDB={}` y repuebla SOLO desde el store local (toggles propios). Las completaciones compartidas de otros usuarios viven solo en memoria via el merge cloud. Ambos arranques corren concurrentes en boot; si el reset gana la carrera, las completaciones ajenas se borran del estado visible.
**Impacto:** Inconsistencia multiusuario transitoria: unidades vistas como pendientes/Urgente (riesgo/KPIs inflados) aunque otro usuario ya las atendio; auto-sana en el siguiente poll.
**Causa raiz:** Dos fuentes de verdad sin coordinacion; `loadAllChecklist` resetea sin re-fusionar el cloud.
**Evidencia:** `const all=await dbGetAll("checklist"); checklistDB={}; all.forEach(...)` vs `(cdb[uid] ??= {})[key] = {...}; window.checklistDB = cdb;`.
**Fix sugerido:** Re-disparar el merge cloud tras repoblar desde IDB, o mergear las llaves locales sobre el estado existente en vez de reemplazar.
**Verificacion:** El bridge (HTML 7129) hace `window.checklistDB` un proxy sobre la misma variable que ambos tocan. `restoreState` (DOMContentLoaded) y la hidratacion cloud (IIFE cloudWire) son cadenas async independientes sin mutex. P2: transitorio, auto-sana, probabilidad moderada.

### [P2][LIVE] 31. Divergencia de namespace de llaves CheckDone ZIP (plate) vs cloud (plate\_\_fecha)

**Modulo/Archivo:** `Control de flotilla.html:2266,3276,3317-3330` + `cloudHydrate.ts:363,425,507`
**Descripcion:** Manifestacion legacy concreta del #13/#14: en modo ZIP los units usan `uid=plate`; en cloud `uid=plate__fecha`. Las completaciones no cruzan entre namespaces y el merge no reconcilia.
**Impacto:** Completaciones invisibles entre modos durante el cutover; dos esquemas de clave irreconciliables en la tabla; `recalcRisk`/KPIs divergen segun el modo del usuario.
**Causa raiz:** uid de unidad no estable entre path de escritura legacy y path de hidratacion cloud.
**Evidencia:** `const uid=plate||eco||"SIN_ID";` (2266) vs `row.uid = ${row.plate ?? c.unitUid}__${fecha};` (363); `data-arg1="${escAttr(u.uid)}"` (3276).
**Fix sugerido:** Llave canonica unica para CheckDone (siempre plate o siempre plate**fechaISO), normalizada en ambos extremos.
**Verificacion:** Una sesion offline sin login no escribe CheckDone (`**cloudSetCheck`retorna sin sesion); el esquema`plate` se escribe en ventanas transitorias de un usuario logueado (restore antes del hydrate, tras subir ZIP). P2: gobernado por ventana temporal, sin borrado destructivo.

### [P2][LIVE] 32. Fotos de unidad no se embeben en el PDF cloud (imgUrl devuelve URL remota S3)

**Modulo/Archivo:** `Control de flotilla.html:4130-4156,2391-2395`
**Descripcion:** `exportPDF` mapea `u.photos` a `imgUrl(p.fname)` y hace `doc.addImage(p.url,...)`. En cloud, `imgUrl` devuelve la URL firmada de S3 (string remoto, no data-URI). `jsPDF.addImage` con string no-base64 hace `loadFile(url, true)` = XHR SINCRONO.
**Impacto:** Sin CORS del bucket: addImage lanza → catch → placeholder "Sin imagen" (PDF sin fotos). Con CORS: XHR sincrono bloquea el hilo por foto (congela la pestaña).
**Causa raiz:** `exportPDF` asume datos embebibles (data-URI/blob local); el modelo cloud entrega URLs firmadas remotas.
**Evidencia:** `const photosWithUrl=u.photos.map(p=>({...p,url:imgUrl(p.fname)})); ... doc.addImage(p.url,"JPEG",...,"FAST");`.
**Fix sugerido:** Pre-cargar cada foto cloud a dataURL (fetch→blob→FileReader o Image+canvas) antes de `addImage`; reutilizar blob local si existe en `zipImgs`.
**Verificacion:** jsPDF realmente vendido es 4.2.1 (no 2.5.1 del comentario); el comportamiento de loadFile sincrono es identico. El catch protege el PDF (no aborta), por lo que el peor caso es PDF degradado o freeze, no crash. P2: export manual por unidad, sin perdida de datos.

### [P2][LIVE] 33. Filtro de rango del Historial cuela registros cerrados SIN fentrada

**Modulo/Archivo:** `Control de flotilla.html:6326-6339`
**Descripcion:** El filtro de periodo usa `if(desde && e.fentrada && e.fentrada < desde) return;`. El guard `&& e.fentrada` hace que un registro cerrado con `fentrada` vacia pase ambas comprobaciones por cortocircuito y se cuente siempre.
**Impacto:** Con desde/hasta activos, Gasto Total, Prom. por Visita, Visitas, Unidades y Top 5 incluyen registros sin fecha que deberian quedar fuera del rango; el reporte financiero del periodo es incorrecto.
**Causa raiz:** El guard invierte la semantica: una entrada sin fecha deberia EXCLUIRSE de un periodo acotado, no incluirse.
**Evidencia:** `if(desde && e.fentrada && e.fentrada < desde) return; if(hasta && e.fentrada && e.fentrada > hasta) return;`.
**Fix sugerido:** `if((desde||hasta) && !e.fentrada) return;` antes de las comparaciones.
**Verificacion:** `fentrada` no es obligatorio (solo tipo/km) y la importacion Excel deja `fentrada:''` si falta la columna "atencion"; `mapEstado` puede marcar "Finalizado" igual. P2: condicionado a usar el filtro de periodo + existir registros cerrados sin fecha.

### [P2][LIVE] 34. Desglose Ref/M.O. del Historial no cuadra con el Gasto Total en visitas mixtas

**Modulo/Archivo:** `Control de flotilla.html:6333-6337,6457-6458,6487`
**Descripcion:** `totalGasto` suma `gTot=(gRef+gMO>0)?gRef+gMO:(e.gasto||0)`, pero `totalGastoRef/totalGastoMO` solo acumulan gRef/gMO. Para una unidad con una visita breakdown + una visita legacy (solo `e.gasto`), el total incluye el `e.gasto` legacy pero el desglose no.
**Impacto:** El subtexto "Ref: $X · M.O.: $Y" no suma el Gasto Total mostrado; confunde conciliacion de costos.
**Causa raiz:** El fallback a `e.gasto` se aplica al total pero no se reparte al desglose.
**Evidencia:** `u.totalGasto += gTot;` vs `u.totalGastoRef += gRef||(e.gastoRef||0);`.
**Fix sugerido:** Atribuir el `e.gasto` legacy a una cubeta (p.ej. "sin desglose") o no mostrar el desglose si no cubre el total.
**Verificacion:** El mismo defecto existe en `src/taller/renderHistorial.ts`. Trigger: una visita cloud/import con breakdown + una manual con solo `e.gasto`. P2: display erroneo del sub-desglose, total persistido/mostrado correcto.

### [P2][LIVE] 35. saveTallerEntry pone gastoRef y gastoMO en 0 al editar

**Modulo/Archivo:** `Control de flotilla.html:7034-7036`
**Descripcion:** El entry construido fija `gastoRef:0` y `gastoMO:0` hardcodeados y solo guarda `gasto`. Al editar un registro con desglose heredado/cloud, lo colapsa a 0/0; el modal no tiene inputs Ref/M.O.
**Impacto:** Destruye el desglose Ref vs M.O. permanentemente al primer edit; ademas en dos consumidores sin fallback (KPI L4233, export Activas L6506) el total tambien cae a 0.
**Causa raiz:** El formulario se simplifico a un solo campo `gasto` pero el guardado fuerza 0 en vez de preservar los valores existentes.
**Evidencia:** `gastoRef: 0, gastoMO: 0, gasto: parseFloat(...tf-gasto...)||0`.
**Fix sugerido:** Preservar `srcEntry.gastoRef/gastoMO` al editar, o derivar el desglose solo cuando `gasto` este vacio y unificar los consumidores con fallback.
**Verificacion:** `cloudHydrate` y los tests modelan Ref/MO como campos de primera clase; data heredada los tiene poblados. El total contable se preserva (todos los consumidores con fallback usan `e.gasto`); solo se degrada el split. P2: alta frecuencia × impacto acotado × incertidumbre sobre volumen de data heredada.

### [P2][LIVE] 36. Editar un registro con un Area no canonica borra el campo Area

**Modulo/Archivo:** `Control de flotilla.html:6629,6690,7026`
**Descripcion:** `doTallerExcel` importa `area` como texto libre. `tf-area` es un `<select>` con 6 opciones fijas; `select.value = e?.area||''` con un valor no listado deja `selectedIndex=-1` y `.value=''`. Al guardar persiste `''`.
**Impacto:** Perdida silenciosa del campo Area en registros importados cuya area no coincide exacto con las 6 canonicas (degrada filtrado y reportes).
**Causa raiz:** Desalineacion import (texto libre) vs formulario (select fijo); el set de un valor no listado deja el control vacio.
**Evidencia:** `area: String(r[iArea]||"").trim()` (6629); `document.getElementById("tf-area").value = e?.area||""` (6690); `area: document.getElementById("tf-area").value` (7026).
**Fix sugerido:** Normalizar Area al importar (NFD/upper + mapeo) o agregar `<option>` dinamica cuando `e.area` no este en la lista.
**Verificacion:** El campo `estado` SI se normaliza con `mapEstado`, pero `area` no. El mismo patron se repite en reingreso/finalizar/duplicar. Datos reales GPA casi seguro vienen como "Logística"/"Servicio Técnico" (no canonicas). P2: campo descriptivo no critico, recuperable re-importando.

### [P2][LIVE] 37. Resumen del expediente: Primer/Ultimo Ingreso usan orden por updatedAt, no por fentrada

**Modulo/Archivo:** `Control de flotilla.html:6759-6761,6787-6788`
**Descripcion:** `allEntries` se ordena por `updatedAt` desc; el resumen toma `[length-1].fentrada` como "Primer Ingreso" y `[0].fentrada` como "Ultimo Ingreso". La posicion depende de updatedAt, no de fentrada.
**Impacto:** Editar una visita antigua (updatedAt salta a ahora) la mueve a `[0]` y muestra su fentrada (la mas antigua) como "Ultimo Ingreso" — fechas invertidas.
**Causa raiz:** Se reusa el array ordenado por updatedAt para derivar fechas que deberian calcularse por fentrada.
**Evidencia:** `.sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""))`; `${fmtDate(allEntries[allEntries.length-1].fentrada)}` / `${fmtDate(allEntries[0].fentrada)}`.
**Fix sugerido:** `const fechas = allEntries.map(e=>e.fentrada).filter(Boolean).sort(); primer=fechas[0]; ultimo=fechas[fechas.length-1];`.
**Verificacion:** Confirmado; otras partes del codigo si ordenan por fentrada para orden cronologico (evidencia de descuido). Datos almacenados intactos. P2: defecto de presentacion, frecuencia moderada (unidad multi-visita + edicion antigua).

### [P2][LIVE] 38. Importacion de Excel de taller fragmenta el historial (unitKey unico por fila)

**Modulo/Archivo:** `Control de flotilla.html:6621-6624`
**Descripcion:** Cada fila importada recibe `newId="tl_xl_"+i+"_"+Date.now()` y se asigna a `id` Y `unitKey`. El historial se agrupa por `unitKey||id`, asi que varias visitas de la misma unidad fisica importadas quedan en grupos separados.
**Impacto:** El expediente queda fragmentado tras importar: conteo de ingresos, gasto acumulado y deteccion de reingresos rotos por unidad.
**Causa raiz:** La importacion asigna `unitKey` por fila (id efimero) en vez de derivarlo de la identidad de la unidad.
**Evidencia:** `const newId = "tl_xl_" + i + "_" + Date.now(); imported.push({ id: newId, unitKey: newId, ... })`.
**Fix sugerido:** Resolver `unitKey` por eco/placa contra `tallerEntries` existentes y entre las propias filas; generar uno nuevo solo si la unidad no aparece.
**Verificacion:** El flujo manual `saveTallerEntry` si reusa `unitKey`; la importacion no lo replica. El boton de import esta cableado (`tl-xinput`). Garantizado en round-trip exportar Detalle → importar (1 fila = 1 visita). P2: sin perdida de datos, resultado visible incorrecto acotado a Historial.

### [P2][LIVE] 39. Hidratacion (poll/focus) puede re-marcar un hallazgo que el usuario acaba de desmarcar (race delete-vs-list)

**Modulo/Archivo:** `cloudHydrate.ts:186-197,502-512` + `cloudWire.ts:388-441`
**Descripcion:** Un `hydrateFromCloud` en vuelo tomo el snapshot de `checkDones` (con `done:true`) antes de que el usuario desmarque; al terminar su merge re-agrega `done:true` sobre el `checklistDB` limpiado, antes de que `deleteCheckDone` llegue a la nube.
**Impacto:** El usuario desmarca, ve el item pendiente un instante, y un refresh en background lo re-marca como atendido; el KPI "Sin check" y los conteos quedan mal.
**Causa raiz:** Write-path y read-path no comparten lock/version; el merge usa un snapshot anterior al desmarcado.
**Evidencia:** `listCheckDone(tenantId)` en el `Promise.all` (186-197); `if (cd.done === false) continue; (cdb[uid] ??= {})[key] = {done:true,...}` (504-509).
**Fix sugerido:** Marcar keys "dirty unmark" que el merge omita/borre hasta confirmar el delete; o re-leer bajo la misma serializacion que las escrituras.
**Verificacion:** Mitigacion parcial: `uiBusy()` pospone nuevos polls mientras `#det` esta abierto (donde vive el toggle), pero NO aborta un hydrate ya en vuelo. Auto-corrige en la siguiente hidratacion limpia. P2: ventana estrecha, transitorio.

### [P2][LIVE] 40. El desmarcado de otro usuario NO se propaga: hydrate nunca elimina keys ausentes del cloud

**Modulo/Archivo:** `cloudHydrate.ts:420-426,502-512`
**Descripcion:** El merge muta `checklistDB` in-place y solo agrega dones (`cdb = window.checklistDB ?? {}`). Nunca recorre keys existentes para borrar las ausentes en el snapshot. Si A desmarca (delete cloud), B (con la pestaña abierta) sigue viendo `done:true` toda la sesion.
**Impacto:** Divergencia de estado multiusuario persistente hasta hard reload; afecta KPIs de pendientes/atendidos y la columna de riesgo (recalcRisk).
**Causa raiz:** Merge aditivo sin diffing; hydrate no parte de un estado limpio para completaciones cloud-shared.
**Evidencia:** `const cdb = window.checklistDB ?? {}; for (const cd of checkDones){ if (cd.done === false) continue; ... }`.
**Fix sugerido:** Reconciliar contra el set autoritativo del cloud (con flag "lista completa exitosa" para no borrar en fallos de red de `listCheckDone`, que es no-fatal).
**Verificacion:** El desmarcado es hard-delete (no tombstone), asi que la rama `done===false` es codigo muerto para desmarcados. F5 corrige (loadAllChecklist reconstruye desde IDB local + merge del snapshot actual). La auditoria 2026-06-03 ya documenta el comportamiento como decision deliberada (reconciliacion ingenua peligrosa). P2: silencioso, auto-curable con F5, sin corromper el dato autoritativo.

### [P2][LIVE] 41. listCheckDone hace un Scan filtrado de toda la tabla en cada hidratacion

**Modulo/Archivo:** `src/api/client.ts:397-408` (modelo `resource.ts:120-130`)
**Descripcion:** `listCheckDone` usa `.list({ filter: { tenantId } })`, que en Amplify Gen 2 compila a un Scan de DynamoDB con filtro server-side. El identifier `(tenantId,unitUid,itemKey)` tiene `tenantId` como partition key, asi que podria ser un Query barato, pero `.list` lo fuerza a Scan y el modelo carece de GSI byTenant.
**Impacto:** RCU/latencia de hidratacion escalan con el tamaño global de la tabla (todos los tenants); a escala, el corte de 100 paginas de `listAll` puede dejar completaciones sin hidratar (hallazgos atendidos reaparecen como pendientes).
**Causa raiz:** Patron generico `.list+filter` (Scan) en vez de Query por PK; sin GSI byTenant.
**Evidencia:** `c.models.CheckDone.list({ filter: { tenantId: { eq: tenantId } }, limit: 1000, nextToken })`.
**Fix sugerido:** Query por PK `tenantId` (GSI byTenant + `listByX`); validar que la paginacion cubre el volumen esperado.
**Verificacion:** El mismo anti-patron existe en las otras list (Semanal tiene GSI muerto). Corre en cada login/refresh/multi-tab. Hoy es single-tenant de facto (impacto bajo); el riesgo de corrupcion solo se materializa a escala multi-tenant grande. P2: degradacion gradual + riesgo latente de correctitud.

### [P2][LIVE] 42. Desmarca offline se REVIERTE silenciosamente (deleteCheckDone falla sin reintento)

**Modulo/Archivo:** `cloudWire.ts:303-322` + `Control de flotilla.html:3324-3337` + `cloudHydrate.ts:502-512`
**Descripcion:** `__cloudSetCheck` hace `await deleteCheckDone` sin try/catch ni cola; no hay `navigator.onLine`. Si el delete rechaza (offline), el cloud sigue con `done:true` y el auto-refresh (focus/poll 4min) re-inyecta `done:true` (merge solo-aditivo).
**Impacto:** En PWA de campo, la desmarca del usuario se revierte sin aviso, corrompiendo el KPI compartido de riesgo.
**Causa raiz:** Escritura cloud fire-and-forget sin cola offline ni reintento + merge solo-aditivo.
**Evidencia:** `else { await deleteCheckDone({...}); }`; caller `.catch(...)` solo loguea/notify; merge `if (cd.done === false) continue; ... done:true`.
**Fix sugerido:** Outbox (IndexedDB) con flush en `online`/focus + backoff; `if(!navigator.onLine)` encolar; tombstones para el desmarcado.
**Verificacion:** Grep confirma 0 colas/reintento/`navigator.onLine`. Es asimetrico: marcas que fallan son inocuas; desmarcas que fallan se revierten. Al fallar hay toast parcial; la reversion posterior por auto-refresh es la parte silenciosa. P2: gateado tras desmarca + offline + auto-refresh, recuperable.

### [P2][LIVE] 43. Toggle offline divergente sin rollback ni guard de conectividad

**Modulo/Archivo:** `cloudWire.ts:303-322` + `Control de flotilla.html:3322-3339`
**Descripcion:** El orden es: mutar memoria → `await dbPut` (commit local) → `__cloudSetCheck` fire-and-forget. Si la mutacion cloud falla, IndexedDB y DynamoDB quedan divergentes sin rollback; sin `navigator.onLine`, cada toggle offline agota timeout antes del catch.
**Impacto:** Inconsistencia local/cloud persistente; marcas offline nunca llegan al equipo (sin reintento); UX degradada por timeouts.
**Causa raiz:** Mutacion cloud no transaccional respecto del commit local (write-local-then-fire-and-forget) sin rollback/outbox ni guard de conectividad.
**Evidencia:** `await dbPut("checklist",uid,...); window.__cloudSetCheck(uid,itemText,nowDone).catch(...)`.
**Fix sugerido:** Outbox de mutaciones con flush en `online`/focus + backoff; `if(!navigator.onLine) encolar y salir`; reflejar estado "pendiente de sync".
**Verificacion:** Confirmado por inspeccion (0 `navigator.onLine`/outbox/reintento). Hidratacion solo agrega cloud→local; nunca empuja local→cloud. P2: divergencia recuperable (re-marcar) + UX offline, sin perdida local ni crash.

### [P2][latente] 44. periodoId regex no normaliza zero-padding (W9 vs W09)

**Modulo/Archivo:** `src/api/batchUpload.ts:147-149,246-247`
**Descripcion:** El periodoId se deriva del filename con `\d{4}-W\d{1,2}` (sin pad). Un filename con "W9" produce `2026-W9`, mientras legacy (HTML 2184) y webhook (handler.ts 381) padean a `2026-W09`. El composite identifier de Semanal es `(tenantId, periodoId, unitUid)`.
**Impacto:** En el cutover, `2026-W9` vs `2026-W09` generan registros distintos → upsert no idempotente, dataset partido webhook/manual; ademas `periodInRange` exige 2 digitos y `2026-W9` no matchea (filtro de rango deshabilitado para ese periodo).
**Causa raiz:** Regex reinyecta el texto crudo sin re-padear como hacen los otros productores.
**Evidencia:** `zip.filename.replace(...).replace(/^.*?(\d{4}-W\d{1,2}).*$/i, "$1") || zip.filename`.
**Fix sugerido:** Capturar año/semana por separado y re-emitir con `padStart(2)`, o reusar `getISOWeek`/`isoWeekId` para los tres productores.
**Verificacion:** No live hoy: el path semanal vivo es `__cloudSyncSemanales` (recibe periodoId ya padeado del legacy); las ramas con el regex (`__cloudSyncZip`, `__cloudSyncUnits` semanal) no estan cableadas. P2: bug latente de integridad acotado a W1-W9, se activa en el cutover.

### [P2][latente] 45. Regex devuelve el filename COMPLETO como periodoId en no-match

**Modulo/Archivo:** `src/api/batchUpload.ts:147-149,246-247`
**Descripcion:** `String.prototype.replace` devuelve la cadena original (truthy) cuando no hay match, asi que el `|| zip.filename` nunca dispara. Para "Control vehicular Semanal.zip" (nombre por defecto reconocido por el legacy) el periodoId resulta "Control vehicular Semanal".
**Impacto:** periodoId basura no idempotente, incomparable con el W09 del webhook, no parseable por `periodInRange`/`isoWeekStart`.
**Causa raiz:** El fallback asume que replace devuelve falsy en no-match; no se valida que el match haya ocurrido ni se deriva de la fecha del row.
**Evidencia:** Ejecucion: `"Control vehicular Semanal.zip" → "Control vehicular Semanal"`.
**Fix sugerido:** Derivar el periodoId de la fecha de la primera fila (`getISOWeek`+`padStart(2)`, como el legacy) o usar `match()` y caer a la fecha del row si no hay match.
**Verificacion:** Mismo gating de liveness que el #44 (ramas no cableadas); el path vivo recibe el periodoId ya calculado. P2: latente, se activa al cablear `__cloudSyncZip`/`__cloudSyncUnits` semanal.

### [P2][latente] 46. inflate.ts (modulo TS) no tiene fallback pureInflate y lanza

**Modulo/Archivo:** `src/io/inflate.ts:5-14`
**Descripcion:** El HTML expone `inflateBytes` con try DecompressionStream → catch/undefined → `pureInflate`. El modulo TS solo usa DecompressionStream y lanza si no esta definido, sin try/catch en la ruta nativa.
**Impacto:** Regresion latente para el cutover: navegadores sin DecompressionStream o ante errores transitorios del stream dejaran de cargar fotos/Excel que hoy el legacy tolera; rompe la paridad declarada.
**Causa raiz:** El modulo TS asume DecompressionStream universal y omitio el fallback pure-JS.
**Evidencia:** `if (typeof DecompressionStream === "undefined") { throw new Error("DecompressionStream no soportado..."); } ... await new Response(stream).arrayBuffer();`.
**Fix sugerido:** Portar `pureInflate` a TS y replicar el patron try-nativo → catch → pureInflate; añadir tests de bloque stored multibloque.
**Verificacion:** No live: el unico consumidor (`loadZip`/`loadZipStream`) solo aparece en tests; `__cloudSyncZip` esta definido pero nunca invocado; el pipeline ZIP vivo usa `window.inflateBytes` (version legacy con fallback). `docs/FEATURE_PARITY.md` marca el pipeline ZIP TS como 🟡. P2: gated tras trabajo de cutover pendiente.

### [P3][LIVE] 47. restoreState carga registros manual\_\* (objetos) dentro de zipImgs

**Modulo/Archivo:** `Control de flotilla.html:1040-1047,2378-2387`
**Descripcion:** `restoreState` vuelca TODOS los registros de `images` a `zipImgs`, incluidos los `manual_*` (objetos `{uid,label,data}`). Esto infla el contador "ZIP · N fotos".
**Impacto:** Conteo de fotos del ZIP inflado cuando hay fotos manuales; mezcla semantica inocua en `persistState` (reescribe los objetos con la misma key/value).
**Causa raiz:** Store compartido + `restoreState` no filtra por prefijo.
**Evidencia:** `const imgRecords = await dbGetAll("images"); zipImgs = {}; for(const {key, value} of imgRecords) zipImgs[key] = value;`.
**Fix sugerido:** `if(typeof key==='string' && key.startsWith('manual_')) continue;`.
**Verificacion:** El sub-claim "blob corrupto si `imgUrl('manual_...')` se invoca" esta refutado: ningun caller de `imgUrl` recibe keys `manual_` (las fotos manuales se sirven desde `manualPhotosDB`/`manualPhotoUrl`). Impacto real limitado a un contador cosmetico. P3.

### [P3][LIVE] 48. openDB usa \_db.closed, propiedad inexistente en IDBDatabase

**Modulo/Archivo:** `Control de flotilla.html:894,916`
**Descripcion:** La guarda `if(_db && !_db.closed)` es siempre true (`_db.closed` es undefined). El cierre solo se neutraliza porque `onversionchange`/`onblocked` ponen `_db=null`.
**Impacto:** Defensa de reconexion inefectiva; posible `InvalidStateError` no recuperado en cierres forzados fuera de banda.
**Causa raiz:** Propiedad no estandar asumida sobre IDBDatabase.
**Evidencia:** `if(_db && !_db.closed){ res(_db); return; }`.
**Fix sugerido:** Registrar `_db.onclose=()=>{_db=null;}` o un flag propio en `onclose`/`onversionchange`.
**Verificacion:** No existe handler `onclose`. El navegador no cierra conexiones sanas espontaneamente; los caminos comunes ya estan cubiertos. P3: debilidad defensiva latente, efecto recuperable con recarga.

### [P3][LIVE] 49. doZip indexa imagenes solo por basename (colision) + descarta xls[1..]

**Modulo/Archivo:** `Control de flotilla.html:1958,1971-1972,1996,2019/2025`
**Descripcion:** La clave de cada imagen es el basename (`fname.split("/").pop().toLowerCase().trim()`) y `imgs[key]=data` sobrescribe sin chequear colision. Ademas solo se procesa `xls[0]`; el resto se descarta en silencio.
**Impacto:** Fotos homonimas en subcarpetas se pierden sin aviso; si el ZIP empaqueta >1 Excel, los demas se ignoran.
**Causa raiz:** Indexacion por basename + procesamiento unico de `xls[0]` sin advertir.
**Evidencia:** `const key = fname.split("/").pop().toLowerCase().trim(); ... imgs[key] = data;`; `XLSX.read(xls[0].data, ...)`.
**Fix sugerido:** Warn en `healthLog` ante colision de basename y cuando `xls.length>1`.
**Verificacion:** El esquema es consistente (lookup tambien por basename), no roto. Con datos reales MoreApp (UUID, 1 Excel) la probabilidad es muy baja → fragilidad latente. P3.

### [P3][LIVE] 50. Tooltip de alerta "Urgente" cuenta hallazgos sin descontar atendidos

**Modulo/Archivo:** `Control de flotilla.html:2764-2768`
**Descripcion:** La unidad califica via `u.risk` (recalculado contra checklistDB), pero el numero del tooltip usa `u.F.filter(f=>f.lv==="Urgente").length` sin descontar atendidos.
**Impacto:** El title "ECO (N hallazgos)" sobre-cuenta urgentes ya atendidos. Cosmetico (solo el texto del tooltip).
**Causa raiz:** El conteo por unidad del detail no aplica la capa de atendidos.
**Evidencia:** `urgentes.slice(0,8).map(u=>{const n=u.F.filter(f=>f.lv==="Urgente").length; return ...})`.
**Fix sugerido:** `const dm=checklistDB[u.uid]||{}; const n=u.F.filter(f=>f.lv==="Urgente"&&!(dm[f.text]&&dm[f.text].done)).length;`.
**Verificacion:** Es el unico outlier; chips, badge y `_hasPending` descuentan. No afecta conteos principales ni filtros. P3.

### [P3][LIVE] 51. buildAnalytics: grafica de tendencia nunca se rinde en sesiones cloud

**Modulo/Archivo:** `Control de flotilla.html:2642-2673`
**Descripcion:** La tendencia depende de `window.periodos`, que `cloudHydrate` nunca puebla (solo `units/tallerEntries/weeklyPeriodos`). En sesion cloud `periodos=[]` → `hasTrend=false` → empty-state permanente.
**Impacto:** El panel Analytics nunca muestra la linea de tendencia mensual en cloud (funcionalidad ausente, no incorrecta).
**Causa raiz:** El modulo cloud no popula `window.periodos`; la analitica se diseño contra el store local.
**Evidencia:** `const allPeriodos = Array.isArray(window.periodos) ? window.periodos : []; const hasTrend = allPeriodos.length >= 2;`.
**Fix sugerido:** Poblar `window.periodos` en cloudHydrate (agrupando inspecciones por mes) o alimentar la tendencia de `weeklyPeriodos`/`__inspections`.
**Verificacion:** El propio codigo lo reconoce (HTML L5205: "que el cloud no puebla"). Cae a empty-state honesto (no datos falsos). P3: alta exposicion, impacto cosmetico.

### [P3][LIVE] 52. Celda KM renderiza "NaNkm" si el km no es numerico

**Modulo/Archivo:** `Control de flotilla.html:3000-3002`
**Descripcion:** `u.km ? Number(u.km).toLocaleString("es-MX")+"km" : "—"` con `u.km` crudo del Excel. Texto no numerico o "12,345" → `Number(...)=NaN` → "NaNkm".
**Impacto:** Defecto visual: "NaNkm" en lugar de "—" en la tabla y replicado en detalle/modal/PDF (`Math.round(Number/1000)` → "NaNk").
**Causa raiz:** No hay `Number.isFinite` antes de `toLocaleString`; el ternario solo verifica truthiness.
**Evidencia:** `km.textContent = u.km ? Number(u.km).toLocaleString("es-MX") + "km" : "—";`.
**Fix sugerido:** `const kmN = Number(String(u.km).replace(/[^0-9.]/g,'')); Number.isFinite(kmN)&&kmN>0 ? ... : "—"` — aplicado en todos los sitios.
**Verificacion:** Otras vistas (L5727/5809) ya aplican el guard, demostrando inconsistencia. `kmHasBuffer` falla en cerrado (no genera falso "Svc vencido"). P3: cosmetico, probabilidad media-baja.

### [P3][LIVE] 53. addManualPhoto: push a manualPhotosDB antes de confirmar la tx IDB

**Modulo/Archivo:** `Control de flotilla.html:3427-3433`
**Descripcion:** Variante del #18: `manualPhotosDB[uid].push(...)` y `accepted++` ocurren sincronamente tras encolar el `put`, sin esperar `tx.oncomplete`; los handlers de error no revierten.
**Impacto:** Bajo fallo de escritura IDB (cuota), foto contada como aceptada pero no persistida; se autocorrige en la siguiente recarga (`loadManualPhotos`).
**Causa raiz:** Actualizacion optimista del estado sin esperar el `oncomplete`.
**Evidencia:** `tx.objectStore("images").put(entry,id); manualPhotosDB[uid].push({...}); accepted++;`.
**Fix sugerido:** Resolver en `tx.oncomplete` antes de push/accepted++, o revertir en `onabort`/`onerror`.
**Verificacion:** Fotos manuales solo en IndexedDB local (no a S3); el efecto es por dispositivo y no contamina datos compartidos. P3: feedback incorrecto, probabilidad baja-media, no destructivo del dato del usuario.

### [P3][LIVE] 54. lbUpdate cachea permanentemente la URL firmada de S3 en el item de lbImgs

**Modulo/Archivo:** `Control de flotilla.html:3566-3572`
**Descripcion:** `lbUpdate` hace `if(!item.url && item.fname) item.url = imgUrl(item.fname)` y persiste la URL en el objeto. `imgUrl` deliberadamente NO cachea las firmadas (expiran ~15min), pero `lbUpdate` lo deshace.
**Impacto:** Al re-navegar (lbNav) a una foto ya vista tras >~15min en sesion cloud, el `<img>` queda roto (URL vencida, sin onerror en `#lbimg`).
**Causa raiz:** `lbUpdate` trata la resolucion lazy como cache permanente, sin distinguir blob local (estable) de URL firmada cloud (TTL).
**Evidencia:** `if(!item.url && item.fname) item.url = imgUrl(item.fname); _img.src=item.url || "";`.
**Fix sugerido:** Resolver a variable local en cada `lbUpdate` (cachear en `item.url` solo blob local/manual).
**Verificacion:** El caso null se auto-cura; las miniaturas si tienen `onerror=photoImgErr` que re-firma, el `#lbimg` no. Recuperable cerrando/reabriendo el visor. P3: cosmetico, baja probabilidad.

### [P3][LIVE] 55. loadAllActions resuelve su Promise antes de poblar actionsDB

**Modulo/Archivo:** `Control de flotilla.html:3822-3834`
**Descripcion:** `loadAllActions` es async pero solo registra `req.onsuccess` y retorna; `await loadAllActions()` resuelve antes de poblar `actionsDB`. Contrasta con `loadAllNotes`/`loadAllChecklist` que envuelven el cursor en Promise.
**Impacto:** `actionsDB` puede estar vacio una ventana tras la hidratacion; `renderActionsTab` (on-demand, muy posterior) mostraria 0 acciones. Bomba latente de consistencia.
**Causa raiz:** Falta envolver el `getAll` en una Promise awaitada.
**Evidencia:** `const req=st.getAll(); req.onsuccess=()=>{ actionsDB={}; req.result.forEach(...); };` (retorna antes del onsuccess).
**Fix sugerido:** `await new Promise((res,rej)=>{ const req=st.getAll(); req.onsuccess=()=>{...; res();}; req.onerror=()=>rej(req.error); });`.
**Verificacion:** Ventana de un tick; el unico consumidor (`renderActionsTab`) es por interaccion explicita, fuera de la ventana; sin perdida de datos. P3: defecto real, impacto observable despreciable.

### [P3][LIVE] 56. Columna "Ultimo check" del modal Sin-check usa u.plate en vez de u.plate||u.uid

**Modulo/Archivo:** `Control de flotilla.html:5382,5400-5406`
**Descripcion:** `_missingLast` se llena con `e.plate || e.uid` pero la celda lee `_missingLast.get(u.plate)`. Para una unidad sin placa, el lookup recibe undefined.
**Impacto:** Unidades sin placa muestran "Nunca" aunque tengan check semanal indexado bajo su uid. No afecta el conteo (el filtro usa plate||uid).
**Causa raiz:** Llave de lectura (`u.plate`) distinta de la de escritura (`e.plate||e.uid`).
**Evidencia:** `const last = _fleetModalKind=="missingSemanal" ? _missingLast.get(u.plate) : ...`; mapa `const k = e.plate || e.uid; ... _missingLast.set(k, f);`.
**Fix sugerido:** `_missingLast.get(u.plate || u.uid)`.
**Verificacion:** Es la unica linea no armonizada al patron canonico plate||uid. P3: cosmetico en una columna de detalle.

### [P3][LIVE] 57. \_fleetDetailCell (missingSemanal) lee \_missingLast con u.plate solo

**Modulo/Archivo:** `Control de flotilla.html:5382` (mapa poblado en 5403-5407)
**Descripcion:** Misma asimetria que el #56, con la nota adicional de que `f > _missingLast.get(k)` tiene riesgo lexicografico si `f` es DMY (mismo defecto de formato del P1).
**Impacto:** "Nunca" (rojo) para unidades sin placa con historico semanal. Solo cargas XLSX manuales sin columna PLACAS (el path nube asigna plate=unitUid).
**Causa raiz:** Escritura con `plate||uid` vs lectura con `plate` solo.
**Evidencia:** `_missingLast.get(u.plate)` vs `const k = e.plate || e.uid; ... _missingLast.set(k, f);`.
**Fix sugerido:** `_missingLast.get(u.plate || u.uid)` y normalizar `f` a ISO antes de comparar.
**Verificacion:** El path nube es inmune (plate=uid). Solo afecta la celda "Ultimo check", no el conteo ni la pertenencia al modal. P3: bajo impacto.

### [P3][LIVE] 58. Donut de Operaciones Activas SIEMPRE muestra 100% / un segmento

**Modulo/Archivo:** `Control de flotilla.html:6098-6135,6191`
**Descripcion:** `nRev = filter(estado!=="Finalizado")` es identico a `nActAll = filter(!isClosed)`, asi que `nRev===nActAll` siempre → `revPct=100%`. La segunda serie `nSin` (estado vacio) es ~0 siempre (todas las rutas garantizan estado no vacio).
**Impacto:** El donut "Distribucion" es un anillo monocolor con centro fijo "100%" y leyenda "Sin Reg.: 0"; la tarjeta KPI "Activos" tambien muestra 100% siempre. Widget muerto.
**Causa raiz:** Series elegidas que no particionan el universo (`rev`=todo el total, `sin`=subconjunto vacio).
**Evidencia:** `const nActAll = latestArr.filter(e=>!isClosed(e)).length; const nRev = latestArr.filter(e=>e.estado!=="Finalizado").length;`.
**Fix sugerido:** Segmentar por estado canonico (En Diagnostico/En Reparacion/Cotizacion/Por recuperar) o por tipo (Correctivo/Preventivo).
**Verificacion:** Las otras tarjetas (Correctivo/Preventivo/Urgentes) si varian. Sin perdida de datos ni crash; no afecta calculos operativos. P3: alta exposicion, impacto estetico.

### [P3][LIVE] 59. (s.reason as Error).message asume reject Error → "error: undefined" oculta la causa del throttle

**Modulo/Archivo:** `src/api/photoUpload.ts:92`
**Descripcion:** El registro del fallo castea `s.reason` a Error sin validar. Si el SDK rechaza con un objeto sin `.message` (info en name/code/$metadata), el campo queda undefined.
**Impacto:** Degrada observabilidad en una ruta console-only (toast por conteo, no por texto); dificulta distinguir 429/SlowDown de 403.
**Causa raiz:** Cast no verificado de `reason` a Error.
**Evidencia:** `result.errors.push({ filename: fname, error: (s.reason as Error).message });`.
**Fix sugerido:** `const msg = s.reason instanceof Error ? s.reason.message : String((s.reason as any)?.message ?? (s.reason as any)?.name ?? s.reason);`.
**Verificacion:** Sin perdida de datos adicional (la foto ya esta perdida si rechaza), sin crash practico (el SDK rechaza con objetos Error). El dato que distinguiria 429/403 ($metadata) se pierde igual aunque sea Error. P3.

### [P3][latente] 60. pureInflate: bloque STORED sin validar NLEN ni bounds

**Modulo/Archivo:** `Control de flotilla.html:106-107`
**Descripcion:** El bloque stored lee LEN y salta 4 con `pos+=4` sin validar NLEN (complemento, RFC1951 3.2.4) ni `pos+ln <= src.length`. Si `ln` viene corrupto, `src[pos++]` da undefined y se escribe 0 en silencio.
**Impacto:** En el fallback pure-JS, datos corruptos pasan como validos (buffer relleno de ceros) en lugar de fallar; diverge de la via nativa que si valida.
**Causa raiz:** Implementacion minimalista del bloque stored que omite la validacion RFC1951.
**Evidencia:** `var ln=src[pos]|(src[pos+1]<<8);pos+=4; for(var k=0;k<ln;k++)push(src[pos++]);`.
**Fix sugerido:** Validar `(ln ^ nlen) === 0xffff` y `pos+ln <= src.length`, lanzando Error en vez de tragar datos.
**Verificacion:** No live: `pureInflate` solo corre cuando DecompressionStream no existe o lanza (codigo muerto en navegadores GPA modernos); ademas el .xlsx interior lo procesa SheetJS con su propio inflate, no `pureInflate`. P3: hardening defensivo en ruta inactiva.

---

## Refutados (falsos positivos)

1. **Fallback de fecha por posicion `Object.values(row)[iFecha]` desalineado con indice de cabecera** (`Control de flotilla.html:2146`) — Bajo `defval:""`, SheetJS inserta una entrada por columna en orden, asi que `Object.values(row)[iFecha]` coincide con `cell(row,iFecha)`. El unico caso de divergencia (cabeceras duplicadas) ocurre AL REVES: el fix sugerido (acceso por nombre crudo) leeria la columna equivocada. Solo inconsistencia estilistica.
2. **renderNotes formatea con toLocaleDateString pasando hour/minute que son ignoradas** (`Control de flotilla.html:3753`) — Mito incorrecto. `toLocaleDateString` con `hour/minute` explicitos SI muestra la hora en todos los motores modernos (ECMA-402 `ToDateTimeOptions` no elimina componentes de hora dados por el caller). Verificado en V8: la hora se muestra; el "fix" es un no-op.
3. **exportPDF aborta sin guardar cuando una foto falla (C.s4 undefined)** — En realidad el hallazgo se _confirma_ (el throw existe en jsPDF 4.2.1 via setTextColor(undefined)→f3(NaN), aborta antes de `doc.save`). Se reclasifico como hallazgo confirmado P2 #32 (PDF cloud sin fotos); este item duplicado en la lista de refutados queda como nota de proceso, no como falso positivo real del codigo.
4. **doTallerExcel usa cellDates:true mientras el resto usa cellDates:false** (`Control de flotilla.html:6565,6586-6595`) — Divergencia real pero NO viva en TZ Mexico (UTC-6 da match exacto; solo desfasaria al este de UTC o con hora en la celda). Deuda latente, no bug vivo; el propio hallazgo lo admite.
5. **Read-modify-write no atomico en toggleCheckItem** (`Control de flotilla.html:3317-3340`) — Inviable bajo single-thread JS: no hay `await` entre la lectura de `cur` y la mutacion; `nowDone` es una const inmutable; el hydrate es aditivo (nunca invierte un desmarcado). El riesgo residual real (ordenamiento de red out-of-order) es otro mecanismo.
6. **upsertCheckDone no envia el campo done explicito** (`cloudWire.ts:310-318` + `client.ts:371-385`) — Falso: el payload base ES `{ done: true, ...input }` (done explicito) y el unico caller siempre pasa `done:true`; el desmarcado va por `deleteCheckDone`. Nota defensiva sobre una feature futura inexistente.
7. **payload = { done: true, ...input } puede pisar el default con undefined** (`client.ts:373`) — Patron fragil real pero NO explotable: el unico caller siempre pasa `done:true` explicito; nunca undefined. Defensivo, no vivo.
8. **CheckDone itemKey embebe `${v}mm`** — Se _confirma_ (es el P1 #15); aparece aqui como duplicado de proceso, no como falso positivo.
9. **uploadPhotosToS3 sin backoff/retry → un 503 SlowDown descarta la foto** (`photoUpload.ts:82-96`) — Premisa falsa: el `s3TransferHandler` del navegador compone `retryMiddlewareFactory` con `DEFAULT_RETRY_ATTEMPTS=3` y backoff+jitter; el retry decider marca SlowDown/429/503/RequestLimitExceeded como retryable. Amplify reintenta automaticamente antes de rechazar.
10. **Foto recien subida puede no resolver por consistencia eventual del list() de S3** (`photoFetch.ts`) — Premisa falsa: S3 ofrece strong read-after-write consistency tambien para LIST desde dic-2020. Tras `await uploadData(...).result` → `await indexCloudPhotos()`, el list ve el objeto. Lo que queda es propagacion del indice por-cliente (aplica a cualquier dato), no consistencia eventual.
11. **Hallazgos de Fluidos diferencian itemKey solo por 'BAJO' vs 'bajo'** (`Control de flotilla.html:1363,1365`) — Observacion factual valida (case-sensitive, sin slug) pero el impacto P2 no se sostiene: las columnas estan en dos arrays disjuntos sin solape, asi que en runtime una columna siempre produce el mismo texto; a diferencia de llantas, el nivel es estatico, no deriva de datos. Olor de codigo, no defecto de correctitud.
12. **upsertCheckDone(update) sobreescribe atribucion (por/ts)** (`client.ts:371-385`) — Defecto real (last-writer-wins en por/ts ante re-toggle de usuarios distintos) pero solo afecta metadata de auditoria, no el flag `done` ni provoca fallo. P3 a lo sumo; clasificado como observacion menor, no bug material.
13. **pureInflate corrompe bloques STORED que siguen a un bloque comprimido (byte-align descarta bytes prefetchados)** (`Control de flotilla.html:104-107`) — Falso. Tras `rb(2)` el bit-buffer siempre tiene <8 bits (invariante de `rb`), asi que `buf=0;bit=0` descarta solo bits parciales = la alineacion correcta a byte. El fix `pos-=(bit>>3)` es un no-op. Verificado con vectores y zlib: salida identica. (La falta de validacion NLEN es el P3 #60, otro asunto.)
14. **uploadPhotosToS3 sube con basename crudo a un namespace que ningun visor cloud resuelve (escritura huerfana)** — Cadena causal erronea: el consumidor lee `u.photos[].fname` dinamicamente, no un set fijo de nombres canonicos. Cada pipeline es internamente consistente fname↔llave-S3. Lo unico real es un sub-issue de costo/redundancia (P3), no orfandad ni respaldo roto.
15. **buildPhotoPath: filename vacio se sube al propio prefijo del tenant** (`photoUpload.ts:30-34`) — Confirmado como defensivo/no alcanzable: todos los productores guardan contra vacio (`if(!key) continue`) antes de poblar las llaves. Contrato sin guard explicito, no bug vivo.
16. **uploadPhotosToS3: batches de 8 sin retry → un 429/SlowDown pierde la foto** (`photoUpload.ts:82-96`) — Mismo motivo que el #9: el SDK reintenta transitorios. Ademas el upload es idempotente por path (re-subir el ZIP recupera), por lo que no hay perdida irreversible. A lo sumo P3 de resiliencia, no P1.

## Inciertos (requieren validacion runtime)

1. **Divergencia de zero-padding del periodoId (W9 vs W09) — llaves Semanal huerfanas** (`batchUpload.ts:147-149,246-247`) — La evidencia y el defecto de codigo son exactos, pero el impacto LIVE no ocurre hoy: ninguna de las dos ramas con derivacion-por-filename es alcanzable (`__cloudSyncZip` sin llamador; `__cloudSyncUnits` siempre "mensual"). El path semanal vivo (`__cloudSyncSemanales`) recibe el periodoId ya padeado. Defecto genuino pero latente/inalcanzable hoy; se explota solo si se cablea alguna de esas rutas. (Refleja los confirmados #44/#45.)
2. **listCheckDone es Scan cross-tenant por el PK compuesto** (`client.ts:397-408`) — El sintoma (Scan en vez de Query) es real y vivo, pero el mecanismo declarado es incorrecto: en Amplify Gen2 el primer campo del identifier (`tenantId`) SI es la partition key; el Scan se debe al resolver `list` por defecto, no a la concatenacion del PK. No hay exposicion cross-tenant (AppSync inyecta el filtro de grupo). El impacto es solo costo/latencia y es transversal a las 7 listas, no especifico de CheckDone. Confirmado como P2 #41 con el mecanismo corregido; aqui se deja como incierto por la imprecision de la causa raiz original.

## Gaps de cobertura no cerrados

1. `batchUpload.ts` y `photoUpload.ts` se leyeron completos pero NO se ejecutaron contra un ZIP MoreApp real: la forma exacta del filename (`W9` vs `W09`) y la unicidad real de basenames de foto no se verificaron end-to-end.
2. El path offline/PWA de `__cloudSetCheck` (cloudWire 301-322) no se probo end-to-end; se confirma por inspeccion la ausencia de cola/`navigator.onLine` pero no se simulo perdida de red.
3. Los tests E2E con `?e2e=1` hacen BYPASS total de auth y cloud sync: ningun escenario multiusuario/CheckDone/hidratacion queda cubierto; el write-path cloud solo se audito por lectura estatica.
4. No se ejecuto Amplify/DynamoDB real: el Scan de `listCheckDone` y la semantica `done: undefined` se basan en el schema y la semantica conocida de Amplify Gen2, no en queries/mutaciones observadas.
5. La equivalencia exacta entre el inflate inline (HTML 56-784) y `src/io/inflate.ts` no se verifico con vectores de prueba; se identifica la divergencia arquitectonica pero no una discrepancia de salida concreta.
6. El heatmap de taller (HTML 2685-2696) es un consumidor adicional de la misma clase de bug de zona horaria ya cubierta en los loaders, de bajo impacto (cuenta por dia, cutoff/today locales) y no se re-audito a fondo.
