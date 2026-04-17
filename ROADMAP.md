# Roadmap — Control de Flotilla

Orden por **impacto × urgencia**. Derivado de code review 2026-04-16.

Estado: migración en curso de monolito `Control de flotilla.html` (6100 líneas) a módulos TS/Vite. Fuente de verdad producción sigue siendo el HTML hasta cutover (M4).

---

## P0 — Bloqueadores (esta semana)

Bugs reales y CVEs. Debe resolverse antes de cualquier feature nueva.

| #   | Tarea                                                                            | Archivo                      | Estado    |
| --- | -------------------------------------------------------------------------------- | ---------------------------- | --------- |
| 0.1 | Agregar `happy-dom@^14` a devDependencies — tests DOM corregidos                 | `package.json`               | ✅ 2026-04-16 |
| 0.2 | Migrar `xlsx` de copia npm huérfana → tarball oficial SheetJS (CDN 0.20.3)       | `package.json`               | ✅ 2026-04-16 |
| 0.3 | Pin SRI hashes (xlsx/jspdf/lucide) + lucide `@latest` → `@1.8.0` + vendor local  | `Control de flotilla.html`, `vendor/` | ✅ 2026-04-16 |
| 0.4 | Purgar `innerHTML` con input de usuario en legado — usar helpers seguros         | `Control de flotilla.html`, `scripts/xss-audit.mjs` | ✅ 2026-04-16 |

**P0.4 resultado**:
- Auditoría heurística con `scripts/xss-audit.mjs` (npm script `audit:xss`) sobre los ~50 sitios con `.innerHTML` en el legado.
- Legado ya usaba `escHtml`/`escAttr` en 93 sitios; la auditoría detectó 2 falsos positivos:
  - L3227 `${u.minT}` → reforzado a `${Number(u.minT)}` (minT siempre numérico desde el analyzer pero explícito es mejor).
  - L3266 `${obsCards}` → variable pre-escapada (cada `t` pasa por `escHtml`); se allowlistó la convención `*Cards` / `*Html` como "pre-rendered HTML" en el auditor.
- Estado final del auditor: **0 sospechosos**. Wire a CI en **P3.5**.

**P0.3 notas**:
- Hashes SHA-384 calculados localmente sobre archivos descargados de cada CDN. Creado `vendor/` con las 3 copias para fallback si CDN falla o hash rechaza.
- `lucide@latest` → `lucide@1.8.0` (riesgo supply-chain cerrado).
- Google Fonts (Inter + DM Mono) sigue sin SRI — la API de Google sirve CSS distinto por user-agent, integridad no aplica. Alternativa (self-host fuentes) asignada a **P1.8**.
- `jspdf 2.5.1` en HTML legado es distinto al `jspdf@^4.2.1` en npm — legado no migrado aún; bumpeará en P2.2(d) con el loader nuevo.

**Verificación 2026-04-16**: `npm install` + `test:run` (49/49 ✅) + `typecheck` (clean ✅).

**Bumps aplicados adicionales durante P0**:
- `happy-dom@^20.9.0` (el `^14` inicial tenía CVE RCE crítico GHSA-37j7-fg3j-429f)
- `jspdf@^4.2.1` (2.5.1 arrastraba `dompurify` vulnerable; no usado aún en `src/`)

**Vulns residuales (9, todas dev-only)**:
- `esbuild ≤0.24.2` via `vite ≤6.4.1` → requiere `vite@8` (breaking). Asignar a **P1.7**.
- `serialize-javascript` via `workbox-build` → `vite-plugin-pwa` bump mayor. Asignar a **P1.7**.
- Impact: solo dev server / build. Runtime bundle no expuesto. No urgente.

**Criterio exit:** `npm test` pasa, `npm audit --audit-level=high` limpio, `grep -n innerHTML Control*.html` sin interpolación dinámica de usuario.

---

## P1 — Hardening (2-3 semanas)

Estabilidad + seguridad defensiva.

| #   | Tarea                                                                            | Origen             | Estado        |
| --- | -------------------------------------------------------------------------------- | ------------------ | ------------- |
| 1.1 | Responsive ≤768px — stats apiladas, tabla scroll-x, detalle fullscreen + tap 44px | README 1.3, `Control de flotilla.html` | ✅ 2026-04-16 |
| 1.2 | Error boundaries + toast en `doExcel`, `doZip`, `restoreState`                   | README 1.5         | ✅ 2026-04-16 |
| 1.3 | `IndexedDB.onversionchange` → close + reset cache `_db`                          | `src/db/indexedDB.ts` | ✅ 2026-04-16 |
| 1.4 | ZIP encoding CP437 fallback cuando GPBitFlag bit 11 == 0 (filenames con tildes)  | `src/io/zipReader.ts` | ✅ 2026-04-16 |
| 1.5 | `calcEstatusSemanal` — documentar params ignorados (_carroceria/_llanta)         | `src/analyzer/risk.ts` | ✅ 2026-04-16 |
| 1.6 | Tests I/O: `zipReader` (5), `inflate` (4), `indexedDB` (5) con `fake-indexeddb`  | `tests/`           | ✅ 2026-04-16 |
| 1.7 | Bump `vite@6 → 8` + `vite-plugin-pwa` mayor (9 vulns dev: esbuild, serialize-js) | `package.json`     | ⏳            |
| 1.8 | Self-host Inter + DM Mono (Google Fonts no soporta SRI)                          | `Control de flotilla.html`, `vendor/fonts/` | ✅ 2026-04-16 |

**P1.8 notas**:
- 11 WOFF2 descargados a `vendor/fonts/` (Inter: 5 weights × variantes unicode-range, DM Mono: 2 weights × 2 ranges). Total ~270 KB.
- CSS local `vendor/fonts/fonts.css` generado desde el original de Google con reescritura de URLs a paths relativos; preserva la lógica unicode-range (browser carga on-demand).
- HTML legado: `<link href="https://fonts.googleapis.com/..."/>` → `<link href="./vendor/fonts/fonts.css"/>`.
- `vite.config.ts`: removido `runtimeCaching` de Google Fonts (ahora servidas localmente via `globPatterns`).
- Verificado en preview: `document.fonts.status === 'loaded'`, 0 network failures, Inter aplicado a elementos renderizados.

**P1.1 notas**:
- El legado ya tenía bloques `@media (max-width: 768px)` y `@media (max-width: 420px)` cubriendo hero stack vertical, tabla scroll-x, detalle fullscreen, input iOS zoom-safe, overflow-auto.
- Validado en preview a 375×812, 767, 769 y 1280×800: transición clean en el breakpoint, sin horizontal overflow.
- **Fix aplicado**: tap targets ≤26px (Inspecciones/Taller/Semanales en `#mainnav .mnav`) → bump a 44px min-height (Apple HIG / Google Material). `.ubtn` pasó de `32px` a `44px` min-height en móvil.
- Media queries print (`@media print`) intactas para PDF legible.

**P1.2 notas**:
- Los 3 funcs target ya tenían error boundaries:
  - `restoreState` → envuelto en `runSafe("Restaurar sesión", …)` (líneas 1716-1717).
  - `doExcel` → `try/catch` + `window.notify(…, "error", 6000)` + cierra loader (línea 2277-2282).
  - `doZip` → `try/catch` wrap completo; se reemplazó `alert()` por `window.notify(…, "error"/"warn"/"ok", N)` para severidad explícita (líneas 2438, 2443, 2465, 2480, 2485).
- Restan ~15 `alert()` en otros paths (PDF export, taller import, etc.) que el shim de `alert→notify` (línea 1572) convierte a toast automáticamente. Follow-up opcional: migrar explícitos para control de severidad. Asignado a **P3.6**.

**P1.3-1.6 notas**:
- Tests totales: 49 → **63** (+14). Cobertura expandida a capa I/O.
- CP437 tabla implementada para rango 0x80-0xAF (suficiente para español: ó, í, ñ, á, é, ú, ü). Rango box-drawing (≥0xB0) fallback directo.
- `fake-indexeddb@^6.2.5` agregado a devDeps; import `fake-indexeddb/auto` antes del módulo polyfilea globales.

---

## P2 — Modularizar (1-2 meses)

Mover código del HTML monolito a módulos TS. **Un módulo por PR**, no big-bang.

| #   | Tarea                                                            | Estrategia                              |
| --- | ---------------------------------------------------------------- | --------------------------------------- |
| 2.1 | Extraer CSS monolito → `src/styles/main.css` ✅ 2026-04-16       | `<link>` en legacy (-54KB HTML)         |
| 2.2 | Partir JS legado en módulos TS — **orden**:                      |                                         |
|     | a) `excel-loader` ✅ 2026-04-16                                   | `src/io/excelLoader.ts`, 7 tests        |
|     | b) `zip-loader` ✅ 2026-04-16 (combina readZip + loadExcel)      | `src/io/zipLoader.ts`, 5 tests          |
|     | c) `render-table` (tab Inspecciones) ✅ 2026-04-16               | `src/ui/renderTable.ts`, 24 tests, XSS-safe |
|     | d) `pdf-export` ✅ 2026-04-16 (engine + unitReport)              | `src/pdf/`, 32 tests                    |
|     | e) `state` / store central ✅ 2026-04-16                         | `src/state/store.ts` + `appState.ts`, 16 tests |
| 2.3 | Migrar consumers HTML → módulos TS con feature flags ✅ 2026-04-16 | `main.ts` wire: USE_NEW_RENDER, USE_NEW_PDF, USE_STORE_LOG |

**P2.1 notas**:
- CSS inline (`<style>` líneas 150-971) extraído a `src/styles/main.css` con header documentando que es autoritativo.
- HTML: `<style>...</style>` → `<link rel="stylesheet" href="./src/styles/main.css"/>`.
- HTML legado pasó de 332KB → 278KB (-16%).
- Verificado en preview: 486 CSS rules cargadas, body bg correcto, responsive intacto.

**P2.2(e) + P2.3 notas**:
- `src/state/store.ts`: clase `Store<T>` genérica con pub/sub. API: `get/set/update/subscribe/subscribeKey/reset/state`. Inmutabilidad shallow — cada set produce nueva referencia para diff `===`. 12 tests genéricos (inicialización, set/update, optimización NO-emit si mismo valor, subscribers globales y por-clave, unsubscribe, inmutabilidad ref, múltiples subs).
- `src/state/appState.ts`: `appStore: Store<AppState>` singleton. Shape tipado: `units`, `selectedUid`, `checklistDB`, `hasZip`, `zipImgs`, `lastFilename`. `bindLegacyWindow()` monta getters/setters en window para espejo bidireccional con propiedades del legado (`units`, `selId`, `checklistDB`, `hasZip`, `zipImgs`). Unbind restaura descriptors originales. 4 tests de integración.
- `src/main.ts` ahora: `bindLegacyWindow()` siempre activo; los shims de `renderTable`/`exportPDF` leen del store (`appStore.get(...)`) en vez de `window.*` directamente. Store expuesto via `window.__appStore` para debug en devtools.
- Nueva feature flag `USE_STORE_LOG` — imprime cambios del store en console para debug.
- Validado en preview: escritura legado → store propaga OK, store.set → window espeja OK, subscribeKey emite solo cuando la clave cambia (no en set con mismo valor), baseline DOM intacto.

**P2.2(d) notas**:
- `src/pdf/engine.ts`: wrapper delgado sobre jsPDF@4 (ESM) con API ergonómica. Mantiene cursor `y`, maneja paginación automática, expone helpers `line/rect/roundedRect/text/textBlock/pill`. Paleta `PDF_COLORS` alineada con main.css vars. Constantes `A4`, `LETTER`. Helper `riskColor(RiskLevel)`.
- `src/pdf/unitReport.ts`: `buildUnitReport(unit, opts)` genera PDF ejecutivo de una sola unidad. Secciones: header teal, identificación + risk pill, datos (fecha/sucursal/km/svc), hallazgos pendientes con dots de severidad, observaciones con wrap, footer con timestamp y paginación. Port parcial del `exportPDF()` legado (~400 líneas); secciones avanzadas (fotos, notas, historial) quedan para futuro.
- 22 tests engine (constantes, instancia, ensureSpace, paginación auto, textBlock wrap, pill, blob/bytes magic bytes `%PDF-`). 10 tests unitReport (magic bytes, paginación con findings, opts.title/subtitle, checklistDB, obsArr multi, unit sin eco, 4 risk levels, minT null, unit minimalista).
- Feature flag `USE_NEW_PDF === '1'` wired en `src/main.ts` que override `window.exportPDF`. Validado en preview: genera PDF para unit con 3 findings + obs, sin errores, `save()` dispara descarga.

**P2.2(c) notas**:
- `src/ui/renderTable.ts`: reemplaza `renderTable()` del legado (línea ~2195). DOM-API first (no `innerHTML` con input de usuario), helpers `mkpill`/`fcell`/`tcell` exportados para tests y reuso.
- Deps inyectables: `units`, `selectedUid`, `checklistDB`, `hasZip`, `isUnitEnTaller`, `parseSvcDate`, `onSelect`, `today`. Facilita testing y desacopla del estado global del legado.
- 24 tests: 4 mkpill, 4 fcell (con cuenta de done), 5 tcell (con thresholds), 11 renderTable (empty state, risk classes, selección, click, XSS, photos icon, taller badge, obsArr count, alertas svc, re-render).
- `src/main.ts`: entry Vite con feature flag `localStorage.USE_NEW_RENDER === '1'`. Cuando activa, overrides `window.renderTable` con shim que inyecta el estado global del legado al módulo nuevo; try/catch fallback al legado si algo falla.
- `Control de flotilla.html`: `<script type="module" src="/src/main.ts">` añadido pre-`</body>`. Bajo file:// 404 silenciosamente; bajo Vite dev se activa.
- Validado en preview: flag OFF → idéntico al baseline (`#hdr 1280×52`, `#dz 1280×748`). Flag ON → 2 filas renderizan correctamente; input hostil (`<script>`, `<img onerror>`, `<svg onload>`) NO se ejecuta (pwned* flags todos false, 0 nodos inyectados).

**P2.2(a-b) notas**:
- `loadExcel(file)` valida magic bytes ZIP (PK\x03\x04) antes de parsear — evita que xlsx trague basura como CSV vacío. Retorna `LoadedReport` con clasificación mensual/semanal.
- `loadZip(file)` combina `readZip` + `loadExcel`: separa imágenes (jpg/png/gif/webp) del XLSX embebido, filtra `__MACOSX/` y archivos ocultos. Retorna `LoadedZip`.
- Ambos DOM-agnostic (testeables sin browser). Clases de error dedicadas con `cause` preservado.

---

## P3 — Features + calidad (2-3 meses)

Pulido, cierre de gaps de testing, publicación.

| #   | Tarea                                                                      | Origen             |
| --- | -------------------------------------------------------------------------- | ------------------ |
| 3.1 | Virtualización tabla — `virtualTable` integrado en `renderTable` con auto-threshold 200 ✅ 2026-04-16 | `src/ui/renderTable.ts` |
| 3.2 | URL deep-linking — `urlState` wired con feature flag `USE_URL_STATE` ✅ 2026-04-16 | `src/main.ts`, `src/state/urlState.ts` |
| 3.3 | Tests faltantes: `writeUrlState` (11), `virtualTable` (7), `setSafeText` (9) ✅ 2026-04-16 | `tests/` |
| 3.4 | Publicar en GitHub privado — `Eminav-117/control-flotilla` ✅ 2026-04-16    | README 3.6         |
| 3.5 | CI hardening: coverage 80% + `audit:xss` + `npm audit --omit=dev` ✅ 2026-04-16 | `.github/workflows/ci.yml`, `vite.config.ts` |
| 3.6 | Migrar 18 `alert()` del legado a `notify()` con severidad explícita ✅ 2026-04-16 | `Control de flotilla.html` |

**P3 notas**:
- **P3.1**: `RenderTableDeps` ahora incluye `virtualize?: boolean` y `rowHeight?: number`. Auto-activa cuando `units.length >= VIRTUALIZE_THRESHOLD (200)`. Fila `buildRow` extraída para reuso entre fragment y virtual. 3 tests adicionales (virtualize=true, auto-threshold, virtualize=false fuerza clásico).
- **P3.2**: nueva flag `USE_URL_STATE`. Al cargar parsea `readUrlState()` y aplica a setters del legado (`setTab`, `setF`, `setBranch`, `setSearch`, `selUnit`, `setPeriodo`) si existen. `popstate` re-aplica. Expone `window.__syncUrlState(patch)` para que el legado escriba al cambiar filtros.
- **P3.3**: 27 tests nuevos. `setSafeText`: null/undefined/number/boolean/object/HTML-as-text. `writeUrlState`: merge, sentinelas "all", replace vs push history, keys desconocidas, undefined como borrar. `virtualTable`: render subset, sizer altura, setRows, scrollToIndex, onVisibleRangeChange, destroy cleanup.
- **P3.5**: CI actualizado: `test:cov` con threshold (lines/funcs/stmts 80%, branches 75%), `audit:xss` step, `npm audit --audit-level=high --omit=dev` (runtime-only, ignora workbox dev chain), upload coverage artifact. Coverage real: 95.93%/88.04%/93.22%/96.99%.
- **P3.6**: 18 `alert()` reemplazados con `window.notify(msg, kind, ms)` donde `kind = "error" | "warn" | "ok" | "info"` según contexto. Los únicos `alert(` restantes en el HTML son comentarios descriptivos (líneas 692, 757). El shim `alert→notify` del legado sigue activo como red de seguridad.

Tests totales: 148 → **178** (+30 en P3).

---

## P4 — Cutover (estrategia fases) — EN PROGRESO

**Estrategia adoptada**: opción C (cutover por fases). Módulos nuevos activan por feature flag hasta feature parity.

### Fases

| Fase | Estado | Scope |
|------|--------|-------|
| Fase 1 — Hardening (P0+P1+P2+P3) | ✅ completa 2026-04-16 | deps, tests, CI, store, loaders, render-table, pdf, CSS extract |
| Fase 2 — Panel detalle | 🟡 en progreso | Checklist done (2026-04-17). Pendientes: Llantas, Fotos, Notas, Acciones, Servicio |
| Fase 3 — Taller completo | 🟡 pure logic ✅ (2026-04-17), renderers en legado | `src/taller/tallerStore.ts` + 38 tests |
| Fase 4 — Semanales + Períodos | 🟡 pure logic ✅ (2026-04-17), renderers en legado | `src/weekly/weeklyStore.ts` + 30 tests |
| Cutover final | ⏳ decisiones de negocio | Plan detallado: [docs/CUTOVER_PLAN.md](docs/CUTOVER_PLAN.md) |

**Feature parity audit completo**: [docs/FEATURE_PARITY.md](docs/FEATURE_PARITY.md).

### Fase 2 detalle

| Sub-tab | Legado fn | Módulo TS | Status |
|---------|-----------|-----------|--------|
| Hallazgos/Checklist | `renderChecklist` | `src/ui/detail/renderChecklist.ts` | ✅ 2026-04-17 (16 tests) |
| Llantas TACO | inline `renderDetBody` case "t" | `src/ui/detail/renderTires.ts` | ✅ 2026-04-17 (15 tests) |
| Fotos + lightbox | `renderPhotos`, `lbOpen/lbNav/lbClose` | `src/ui/detail/photoGallery.ts` + `lightbox.ts` | ✅ 2026-04-17 (35 tests) |
| Notas | `renderNotes` | `src/ui/detail/renderNotes.ts` | ✅ 2026-04-17 (14 tests) |
| Acciones correctivas | `renderActionsTab`, `addAction`, etc. | `src/ui/detail/renderActions.ts` | ✅ 2026-04-17 (17 tests) |
| Servicio/Historial | `renderDetBody` case "o" | `src/ui/detail/renderService.ts` | ✅ 2026-04-17 (12 tests) |

### P4 original (Corte definitivo) — referencia

Matar legado. Sin esto, drift entre dos implementaciones acumula indefinidamente.

| #   | Tarea                                                                     |
| --- | ------------------------------------------------------------------------- |
| 4.1 | Fijar fecha cutoff legado (target: 2026-09-01)                            |
| 4.2 | Matriz feature parity — legado vs nuevo, por tab                          |
| 4.3 | Beta paralelo 2 semanas con usuarios reales                               |
| 4.4 | Cutover — mover `Control de flotilla.html` → `_legacy/` archive           |
| 4.5 | Remover dead code del monolito (analyzer duplicado, inflate legado, etc.) |

---

## Milestones

| Hito | Target       | Entrega                                                     |
| ---- | ------------ | ----------------------------------------------------------- |
| M1   | 2026-05-01   | P0 + P1 done → producción segura                            |
| M2   | 2026-06-15   | P2 done → nuevo código es fuente de verdad opcional         |
| M3   | 2026-08-01   | P3 done → feature parity + publicado                        |
| M4   | 2026-09-01   | P4 cutover → legado archivado                               |

---

## Riesgos

- **Dual-source drift**: cada semana sin cutover, legado y `src/` divergen. Prioriza P2 sin pausas largas.
- **xlsx bundle size**: ~900KB. `manualChunks` ya separa chunk. Si dashboard queda solo-lectura, evaluar lazy-load dinámico.
- **PWA + IndexedDB migrations**: ya en `DB_VER = 8`. Cada bump requiere plan de migración de datos en producción. Documentar schema + razón de bump en comentario junto a la constante.
- **SRI + CDN offline**: PWA service worker cachea, pero primer load requiere CDN. Fallback local reduce blast radius si CDN cae.

---

## Cambios a este roadmap

Actualizar al cierre de cada milestone. Mantener `README.md` → sección Estado como resumen de 5 líneas con link aquí.
