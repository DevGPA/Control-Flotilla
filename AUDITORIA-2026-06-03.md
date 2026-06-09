# Auditoría profunda — Control Flotilla (GPA Fleet Command) · 2026-06-03

Segunda auditoría multi-agente (8 clusters de módulos: capa de datos/cloud, backend webhook, analizadores+estado,
app+tabla, panel de detalle, taller, semanal, charts/PDF/IO) con **verificación adversarial de doble lente**
(corrección + alcance/riesgo) de cada hallazgo + crítico de completitud. **59 hallazgos crudos → 39 confirmados**
(20 refutados en la verificación).

Validación de los fixes: `tsc --noEmit` ✓, **544 unit (Vitest) ✓** (535 previos + 9 nuevos de regresión),
ESLint ✓. Detalle completo de cada hallazgo en [`audit/AUDITORIA-2026-06-03-detalle.md`](audit/AUDITORIA-2026-06-03-detalle.md).

> **Contexto de despliegue (clave para el triaje):** los módulos `src/*.ts` corren tras feature-flags
> (`USE_NEW_RENDER/PDF/DETAIL/TALLER/WEEKLY`) **apagados por defecto** — el cutover está diferido. El
> `Control de flotilla.html` legacy sigue siendo el motor de producción. **La capa cloud (`setupCloud()` en
> `main.ts`) SÍ está activa siempre** que se sirve por Vite, así que los bugs de `src/api/*` y del webhook son _live_;
> los de render UI están tras flags (seguros de tocar, importan para el cutover).

---

## ✅ CORREGIDOS (23) — frontend + capa de datos TS, validados por tsc + 544 unit

### Capa de datos / cloud (live)

- **#0 — Filtro Desde/Hasta roto con fechas DD/MM/YYYY.** `cloudHydrate.ts`. Los checklists subidos por
  `uploadUnitsToCloud` guardan la fecha en DMY; el min/max (`.sort()` léxico) y `applyDateRange` (`f>=from && f<=to`
  contra ISO del `<input type=date>`) fallaban → vista vacía. **Fix:** helper `isoDay()` normaliza DMY→ISO **solo para
  ordenar/comparar** (sort, min/max, rango, latest-por-unidad), sin tocar uids ni el `fecha` mostrado (evita re-keyear
  CheckDones). _La normalización del lado de escritura (batchUpload) se difiere: cambia el composite key → requiere backfill._
- **#1 — Cache de fotos sin clave de tenant.** `photoFetch.ts`. El cache-hit estaba antes del guard `hasCloudPhoto`
  y la clave era solo el filename → tras logout/login de otro tenant, una foto con el mismo nombre devolvía la URL
  firmada del tenant anterior. **Fix:** clave de cache `${tenantId}/${filename}` + guard movido arriba + `clearPhotoCache()`
  en `logout()`.
- **#3 — Hidrataciones concurrentes sin lock.** `cloudWire.ts`. `__cloudSync*` (fire-and-forget) y el auto-refresh
  podían correr 2+ `hydrateFromCloud` a la vez, intercalando mutaciones de `window.units`/`__cloudPhotoUrlMap`.
  **Fix:** serializador a nivel módulo (`hydrateSerialized`) que encola: a lo más una hidratación a la vez.

### Analizadores

- **#11 — Gating de refacción con `!== "no"` estricto.** `analyzeRow.ts`. "No cuenta", "No tiene", "Ninguna",
  "Sin refacción" se trataban como _sí tiene_ → no se generaba el hallazgo de refacción faltante. **Fix:** helper
  `esRespuestaNegativa()` (cubre negativos compuestos), aplicado a refacción y llantas internas piloto/copiloto.
- **#13 — `parseSvcDate` no manejaba Date ni serial Excel.** `analyzeRow.ts`. Una celda de fecha como serial numérico
  (cellDates:false) o `Date` → `null` → el fallback de "Servicio vencido/próximo" por fecha se desactivaba en silencio.
  **Fix:** maneja `Date` y serial Excel (rango 1954–2146) además de DMY/ISO.

### App principal + tabla

- **#15 — Lógica invertida en el shim de render.** `main.ts`. `if (rows.length===0 && allUnits.length>0) rows=allUnits`
  convertía un filtro _sin coincidencias_ (resultado legítimo `[]`) en _toda la flota_. **Fix:** eliminado; el `[]` se
  renderiza como estado vacío. El fallback a `allUnits` queda solo para cuando `filt()` LANZA (catch).
- **#14 — Fuga de listeners/ResizeObserver en virtualización.** `renderTable.ts` + `virtualTable.ts`. Cada render en
  modo virtual creaba un `Controller` (scroll listener + ResizeObserver sobre `#tbody`) que se descartaba sin destruir →
  fuga creciente en flotas grandes. **Fix:** `WeakMap<container, Controller>` que destruye el previo antes de re-render.
- **#16 — `tcell`: ancho de barra negativo con minT negativo.** `renderTable.ts`. **Fix:** `Math.max(0, …)`.

### Panel de detalle

- **#17 — Fallback de imágenes ZIP usaba el nombre crudo.** `photoGallery.ts`. Sin `lazyObserver`, `img.src=entry.fname`
  (nombre, no URL). **Fix:** usa `resolveZipUrl(fname)`; eliminado el no-op muerto.
- **#18 — `lazyObserver` compartido nunca se desconectaba.** `photoGallery.ts`. Acumulaba `<img>` ya removidos del DOM.
  **Fix:** `unobserve` de las imágenes lazy previas antes de `replaceChildren`.
- **#19 — Lightbox memoizaba URLs firmadas (expiran).** `lightbox.ts`. **Fix:** re-resuelve siempre para items con
  `fname` + `onerror` de re-firma acotado (sin loop).
- **#20-parcial / #21 — `renderChecklist`: `prevFMap` código muerto.** Eliminado.
- **#22 — `renderService` ordenaba cross-ref semanal por label de período.** `renderService.ts`. Labels humanos
  ("Semana 9" vs "Semana 10") no ordenan cronológicamente. **Fix:** ordena por fecha real (ISO/DMY), fallback a label.
- **#23 — `renderTires`: ancho de barra negativo.** **Fix:** `Math.max(0, …)`.

### Taller

- **#25 — KPI "Días Prom. real" ignoraba los filtros activos.** `renderActivasKpis.ts`. `compArr` iteraba TODAS las
  entradas. **Fix:** respeta `matchesFilter` como `estArr`/`revArr`.
- **#27 — Cerradas sin `fentrada` se colaban en el rango.** `renderHistorial.ts`. El `&& e.fentrada` cortocircuitaba.
  **Fix:** con rango activo, ausencia de `fentrada` = fuera de rango.
- **#28 — Borde superior del rango fallaba con timestamp ISO completo.** **Fix:** comparar `fentrada.slice(0,10)`.
- **#29 — `latestClosed` sesgado por el init.** **Fix:** el primer cerrado se asigna incondicional y luego se elige el
  de mayor `updatedAt`; eliminado el parche post-loop que tomaba el primer cerrado.

### Semanal

- **#32 — Filtro carrocería/llanta dejaba pasar `undefined`.** `renderTableSemanales.ts`. `=== "OK"` no captura
  `undefined`, que la celda pinta como "Sin daños"/"Con refacción". **Fix:** tratar `undefined` como OK (alinea filtro
  con celda y KPI).

### Charts / PDF / IO

- **#33 — Heatmap de taller con fechas en UTC.** `charts.ts`. `toISOString()` desfasaba un día en México por las tardes.
  **Fix:** formato con componentes locales.
- **#34 — `loadZip` inflaba a RAM los XLSX 2º+ y los descartaba** (y no los registraba en `entries`). `zipLoader.ts`.
  **Fix:** solo el primer xlsx se infla; los siguientes solo se loguean.
- **#35 — Imágenes ZIP indexadas por basename (colisión silenciosa).** **Fix:** `console.warn` al sobrescribir.
- **#36 — PDF: kilometraje no numérico imprimía "NaN km".** `unitReport.ts`. **Fix:** `Number.isFinite` guard.

---

## ⏸ DIFERIDOS (16) — requieren deploy/sandbox, backfill, o decisión de negocio

### Backend webhook — Lambda de ingesta EN VIVO (probar en sandbox antes de prod)

- **#5 — `processSemanal` lee el dataName equivocado para la llanta de refacción** (`llantaDeRefaccionFuncional` no
  existe; el real es `cuentaConLlantaDeRefaccin`) → `llantaRisk` se persiste SIEMPRE como "OK". Bug de datos real.
  **Recomendación:** confirmar el dataName con `?sample=1&form=<SEMANAL>` y corregir; afecta ingesta nueva + requiere backfill.
- **#6 — Zona horaria UTC vs hora de captura MX** en `fecha` del Checklist (llave compuesta) y en el cálculo de días de servicio.
- **#7 — Clave de auditoría S3 con `Date.now()`** → colisión entre reintentos/concurrentes (pisa el crudo).
- **#8 — El crudo se escribe en S3 (con headers completos) antes de validar la firma HMAC.**

### Migración de datos / composite key (requieren backfill)

- **#0-escritura — Normalizar la fecha a ISO en `batchUpload.uploadUnitsToCloud`.** Cambia el composite key del
  Checklist → filas DMY ya subidas quedarían huérfanas. Planear saneo. (El síntoma de filtro ya se mitigó en hydrate.)
- **#4 — Auto-migración de taller: colisión de composite key `(unitUid, fechaEntrada)`** → pérdida silenciosa de un
  registro cuando dos entradas comparten unidad+fecha; re-migración no idempotente.

### Decisiones de negocio / producto

- **#9 / #12 / #31 — Regla de "riesgo efectivo" semanal: 2 vitales vs 4 vitales.** `calcEstatusSemanal` escala
  carrocería+llanta, pero el webhook (persiste `risk`), el legacy y `computeEffectiveRisk` usan solo aceite+radiador
  → los KPIs/chips no cuadran con la tabla/filtro (una volcadura puede salir "Operativa"). **Requiere tu decisión**
  sobre cuál regla es la correcta; luego se consolida en UNA sola función. _(Tras flag `USE_NEW_WEEKLY`.)_
- **#2 — Cloud no reconcilia desmarcados de CheckDone.** Un desmarcado de otro usuario (que BORRA el registro) no
  vuelve a "pendiente" en los demás. **No se aplicó una reconciliación ingenua a propósito:** `listCheckDone` es
  no-fatal (devuelve `[]` ante fallo) → reconciliar "por ausencia" borraría TODAS las completaciones locales en un
  fallo transitorio (peor que el bug actual). **Fix correcto:** tombstones `done=false` en `__cloudSetCheck` +
  respetarlos en el merge, o un flag "lista completa y exitosa" que gatee la reconciliación.
- **#20 — Checklist: todo el item es clickeable como toggle** (regresión vs legado: el cuerpo abría la foto) +
  sin accesibilidad de teclado. Decisión de interacción/UX.
- **#24 — Donut de taller siempre 100%/0** (`nSin` muerto, `nRev === nActAll`). Requiere redefinir qué segmenta.
- **#10 — `urlState`: "limpiado" y "ausente" colapsan** → back/forward no resetea filtros. Requiere coordinación en main.ts.
- **#26 — Badge "Visitas" (vida total) vs KPI "Visitas (período)".** Etiquetados distinto a propósito; revisar si confunde.
- **#30 — `fmtMXN` muestra negativos como $0.** Política contable con Tesorería.

### Bajo / fuera de alcance TS

- **#37 — ZIP reader no soporta ZIP64** (>4GB). Edge case fuera del dominio (fotos de flota). Riesgo del fix > beneficio.
- **#38 — Charts ocultados (`display:none`) sin `dispose`** → observers vivos. La causa raíz está en el caller del
  HTML legacy (oculta sin disponer), fuera del alcance de los módulos TS.

---

## ⚠ Gap mayor de cobertura (crítico de completitud)

**El `Control de flotilla.html` (7177 líneas, ~6300 de JS inline) NO fue auditado** y es el motor que corre para la
mayoría de usuarios (flags apagados). Los `src/*.ts` son un shim parcial. Sospechas concretas no verificadas en el
legacy: `periodoId` derivado solo de `entries[0].fecha` (mezcla de formatos corrompe la semana ISO), mismatch de
zero-padding `W9` vs `W09` entre legacy y `batchUpload`, conversiones serial-Excel TZ-local desfasadas, escritura
fire-and-forget de CheckDone sin cola de reintento, y `listCheckDone` como Scan sin índice. **Recomendación:** una
tercera pasada enfocada en el HTML legacy y en el path de escritura multiusuario.
