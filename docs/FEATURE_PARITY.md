# Feature Parity — Legado vs Módulos TS

**Auditoría 2026-04-17** (P4.2 roadmap). Base para decidir fecha cutoff (P4.1).

**Legend**:
- ✅ Cubierto por módulo TS nuevo (paridad funcional)
- 🟡 Parcial (módulo existe pero falta wire o features)
- ⚠️ Gap — solo legado, necesita port
- ➖ N/A o fuera de scope de migración

---

## 1. Carga de datos

| Feature legado | Función | Módulo TS | Status |
|----------------|---------|-----------|--------|
| Parsear Excel mensual | `doExcel`, `loadWB` | `excelLoader.loadExcel` | 🟡 loader OK, falta `loadWB` wire (poblar `units`, `zipImgs`, etc.) |
| Parsear Excel semanal | `doArchivoSemanal`, `loadWBSemanal` | `excelLoader.loadExcel` + classifier | 🟡 loader OK, falta `loadWBSemanal` equivalent |
| Parsear ZIP MoreApp | `doZip` | `zipLoader.loadZip` | 🟡 loader OK, falta wire al pipeline |
| Inflate deflate-raw | `pureInflate` | `inflate.inflateBytes` | ✅ nativo DecompressionStream |
| Parseo ZIP binario | dentro `doZip` | `zipReader.readZip` + CP437 | ✅ |
| Analizar row (risk/findings) | `analyzeRow` | `analyzer/analyzeRow` | ✅ |
| Clasificar semanal vs mensual | `classifyReport` | `analyzer/classifyReport` | ✅ |
| Normalizadores risk semanal | `normFluidRisk`, `normBodyRisk`, `normTireRisk` | `analyzer/risk` | ✅ |
| Estatus global semanal | `calcEstatusSemanal` | `analyzer/risk` | ✅ |

**Bloqueador P4**: los loaders nuevos no poblan el estado legado. Requiere adapter que tome `LoadedReport`/`LoadedZip` → rellene `units`, `zipImgs`, `weeklyPeriodos`, etc.

---

## 2. Dashboard principal (tab Inspecciones)

| Feature | Función legado | Módulo TS | Status |
|---------|----------------|-----------|--------|
| Renderizar tabla de unidades | `renderTable` | `ui/renderTable` | ✅ (USE_NEW_RENDER) |
| KPI donut + barras | `buildKPIs` | — | ⚠️ gap |
| Alertas summary (svc vencido, urgentes) | `buildAlertsSummary` | — | ⚠️ gap |
| Filtro por sucursal | `buildBranches`, `setB` | — | ⚠️ gap |
| Filtro por estado | `setF` | — | ⚠️ gap (pero URL state flag wired, falta setters) |
| Búsqueda texto | `setSrch` | — | ⚠️ gap |
| Ordenamiento columnas | `sortBy`, `sortedUnits` | — | ⚠️ gap |
| Virtualización >200 filas | — | `ui/virtualTable` + renderTable | ✅ (novedad nuestra) |
| Risk pill | `mkpill` | `ui/renderTable.mkpill` | ✅ |
| Findings cell | `fcell` | `ui/renderTable.fcell` | ✅ |
| Tire cell | `tcell` | `ui/renderTable.tcell` | ✅ |

---

## 3. Panel detalle flotante (9 sub-tabs)

| Sub-tab | Función legado | Módulo TS | Status |
|---------|----------------|-----------|--------|
| Hallazgos/Checklist | `renderChecklist` | — | ⚠️ gap |
| Llantas (TACO bars) | dentro `renderDetBody` case "t" | — | ⚠️ gap |
| Fotos + lightbox | `renderPhotos`, `lbOpen/lbUpdate/lbNav/lbClose` | — | ⚠️ gap |
| Notas | `renderNotes` | — | ⚠️ gap |
| Acciones correctivas | `renderActionsTab`, `addAction`, `updateActionStatus`, `deleteAction` | — | ⚠️ gap |
| Servicio/Historial | dentro `renderDetBody` case "o" | — | ⚠️ gap |
| Semanal (cross-ref) | dentro `renderDetBody` case "o" (latestWeekly) | — | ⚠️ gap |
| Evolución | — (dentro tendencias) | — | ⚠️ gap |
| Draggable/resizable panel | `initFloatPanel`, resizers | — | ⚠️ gap (UX compleja) |
| Tab switching | `swTab` | — | ⚠️ gap |
| Recalc risk tras checklist done | `recalcRisk`, `recalcAllRisks` | — | ⚠️ gap |

---

## 4. Taller

| Feature | Función legado | Módulo TS | Status |
|---------|----------------|-----------|--------|
| Activas (unidades en taller) | `renderActivas`, `renderTaller` | — | ⚠️ gap |
| Historial/Expedientes | `renderHistorial` | — | ⚠️ gap |
| Subnav activas/historial | `tlSwitch` | — | ⚠️ gap |
| Filtros sucursal/tipo/área | `buildTallerSucOptions`, `setHistFilterTipo` | — | ⚠️ gap |
| Ordenamiento | `tlSort`, `tlSortByUrgencia` | — | ⚠️ gap |
| Crear entrada taller | `openTallerModal`, `clearTallerEntryFields` | — | ⚠️ gap |
| Autocompletar eco | `tlAcSearch`, `tlAcSelect`, `tlAcSelectNew` | — | ⚠️ gap |
| Finalizar unidad | `finalizarUnidad`, `finalizarDesdeModal` | — | ⚠️ gap |
| Expediente (ver historial de unidad) | `openHistorialModal`, `renderHistorialModal` | — | ⚠️ gap |
| Reingreso | `reingresoTaller`, `reingresoDesdeHistorial` | — | ⚠️ gap |
| Búsqueda expediente | `buscarExpediente` | — | ⚠️ gap |
| Badge counter nav | `updateTallerBadge` | — | ⚠️ gap |
| Importar Excel taller | `doTallerExcel` | — | ⚠️ gap |
| Exportar Excel activas | `exportTallerActivasExcel` | — | ⚠️ gap |
| Exportar Excel historial | `exportTallerHistorialExcel` | — | ⚠️ gap |
| "Enviar a taller" desde inspección | `enviarATallerDesdeInspeccion` | — | ⚠️ gap |

---

## 5. Semanales

| Feature | Función legado | Módulo TS | Status |
|---------|----------------|-----------|--------|
| Tabla semanal | `renderTableSemanales` | — | ⚠️ gap |
| KPIs semanal | `buildKPIsSemanales` | — | ⚠️ gap |
| Render tab raíz | `renderSemanales` | — | ⚠️ gap |
| Chips por período | `renderWeeklyPeriodoBar` | — | ⚠️ gap |
| Switch período | `switchWeeklyPeriodo` | — | ⚠️ gap |
| Delete período | `deleteWeeklyPeriodo` | — | ⚠️ gap |
| Fotos semanales (ZIP) | `openSwPhotos` | — | ⚠️ gap |
| URL cache semanal | `clearWeeklyUrlCache`, `weeklyImgUrl` | — | ⚠️ gap |
| Filtros tabla semanal | `swSetF`, `swSort`, `swDebouncedSearch` | — | ⚠️ gap |
| Badge nav semanal | `updateSwNavBadge` | — | ⚠️ gap |

---

## 6. Periodos mensuales (snapshots)

| Feature | Función legado | Módulo TS | Status |
|---------|----------------|-----------|--------|
| Guardar snapshot período | `showPeriodoModal`, `closePeriodoModal` | — | ⚠️ gap |
| Barra de períodos | `renderPeriodoBar` | — | ⚠️ gap |
| Switch período activo | `switchPeriodo` | — | ⚠️ gap |
| Delete período | `deletePeriodo` | — | ⚠️ gap |
| Tendencias (comparación) | `showTendencias` | — | ⚠️ gap |

---

## 7. Export / Reportes

| Feature | Función legado | Módulo TS | Status |
|---------|----------------|-----------|--------|
| PDF unidad (reporte ejecutivo) | `exportPDF` | `pdf/unitReport.buildUnitReport` | 🟡 cubre layout esencial, faltan: fotos, notas, historial completo |
| PDF flotilla completa | `exportFleetPDF` | — | ⚠️ gap |
| Resumen ejecutivo (texto copiable) | `showResumenEjecutivo` | — | ⚠️ gap |
| PDF engine (helpers) | inline en legado | `pdf/engine.PdfDoc` | ✅ (nueva abstracción) |

---

## 8. Persistencia (IndexedDB)

| Feature | Función legado | Módulo TS | Status |
|---------|----------------|-----------|--------|
| Abrir DB + stores | `openDB` | `db/indexedDB.openDB` | ✅ (incl. onversionchange) |
| Put/Get/Delete | inline async | `db/indexedDB.dbPut/dbGet/dbDelete` | ✅ |
| Stores definidos | 7 stores | mismos 7 stores | ✅ |
| Restaurar sesión | `restoreState` | — | ⚠️ gap (pero `runSafe` legado ya robusto) |

---

## 9. Infraestructura / UX

| Feature | Función legado | Módulo TS | Status |
|---------|----------------|-----------|--------|
| Toast notifications | `notify`, `notifyUndo`, `runSafe` | — | ⚠️ gap (legado sólido, worth portar) |
| Loader spinner | `showLoader` | — | ⚠️ gap |
| Shim alert → notify | inline | — | ➖ no aplica post-cutover |
| Debounce | `debounce` | — | ⚠️ gap (utilidad mínima) |
| Format date | `fDate`, `fmtDate`, `parseSvcDate` | — | ⚠️ gap |
| ISO week | `getISOWeek` | — | ⚠️ gap |
| HTML escape | `escHtml`, `escAttr` | `dom/safeHTML.escHtml/escAttr` + `setSafeText` + `safeHTML` tag | ✅ superior |
| State central | global vars | `state/store` + `appState` | ✅ (con bridge bidireccional al legado) |
| URL deep-link | — (nuevo) | `state/urlState` | ✅ (novedad nuestra, flag wire-in) |

---

## Resumen cuantitativo

| Categoría | Items totales | ✅ cubierto | 🟡 parcial | ⚠️ gap |
|-----------|---------------|-------------|------------|--------|
| 1. Carga de datos | 9 | 6 | 3 | 0 |
| 2. Tab Inspecciones | 11 | 5 | 0 | 6 |
| 3. Panel detalle | 11 | 0 | 0 | 11 |
| 4. Taller | 16 | 0 | 0 | 16 |
| 5. Semanales | 10 | 0 | 0 | 10 |
| 6. Períodos | 5 | 0 | 0 | 5 |
| 7. Export/Reportes | 4 | 1 (engine novedad) | 1 | 2 |
| 8. Persistencia | 4 | 3 | 0 | 1 |
| 9. Infraestructura | 9 | 3 | 0 | 6 |
| **TOTAL** | **79** | **18** (23%) | **4** (5%) | **57** (72%) |

---

## Implicaciones para P4 cutover

### Gap real: **57 funciones del legado sin equivalente TS** (72%)

Tabs grandes totalmente pendientes:
- **Panel detalle flotante** — 11 funciones, incluye 9 sub-tabs
- **Taller** — 16 funciones, todo el módulo
- **Semanales** — 10 funciones, todo el módulo
- **Períodos** — 5 funciones, snapshot/comparison

### Opciones de cutover

**Opción A — Full port antes de cutover (conservador)**
- Port los 57 gaps en módulos TS
- Estimate: 3-5 semanas full-time (o 2-3 meses part-time)
- Cutover limpio, arquitectura consistente
- Riesgo: scope creep, pospone cutover indefinidamente

**Opción B — Híbrido permanente (pragmático)**
- Cutover = distribución de la app actual (legado HTML + módulos nuevos coexistiendo)
- Mantiene `Control de flotilla.html` como shell, módulos nuevos activan via flags cuando estén listos
- Es como trabajamos ahora — sin cutover explícito
- Pero resuelve el objetivo: "app en producción con mejoras de seguridad/tests/CI"
- Cutover de M4 sería solo: establecer distribución formal + retirar drafts/backups

**Opción C — Cutover parcial por features (balanceado)** ⭐ RECOMENDADO
- Fase 1 (ya hecho): hardening + módulos críticos (data loading, state, render, pdf) — ✅ completado
- Fase 2 (1-2 semanas): port del panel detalle + notify/loader (alta visibilidad user)
- Fase 3 (2-3 semanas): port de taller completo (módulo más grande)
- Fase 4 (1-2 semanas): semanales + períodos
- Cada fase se libera con feature flag; usuarios pueden opt-in
- Cutover final cuando todos los flags activados por default + legado archivado

### Recomendación fecha cutoff (P4.1)

Dado que P0-P3 adelantaron 3.5 meses respecto al roadmap original:
- **Opción realista**: M4 cutover 2026-07-01 (3 meses desde hoy, sigue adelantando respecto al 2026-09-01 original)
- **Opción agresiva**: M4 cutover 2026-06-01 (2 meses)
- **Con opción B (híbrido)**: M4 puede ser 2026-05-01 (2-3 semanas)

---

## Decisiones pendientes para continuar

1. ¿Opción A, B, o C para el cutover?
2. Si C, ¿qué fase atacamos primero? (recomiendo **panel detalle** por visibilidad)
3. ¿Plan de distribución? — PWA Vercel/Netlify, internal server, o standalone file:// distribuido por OneDrive
4. ¿Beta paralelo con usuarios reales? — ¿Cuáles inspectores, cuánto tiempo?
