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
| 2.1 | Extraer CSS monolito → `src/styles/`                             | Split por tab / componente              |
| 2.2 | Partir JS legado en módulos TS — **orden**:                      |                                         |
|     | a) `excel-loader` (envuelve `xlsx`)                              | Aisla dep externa                       |
|     | b) `zip-loader` (ya `zipReader.ts`)                              | Wire consumers existentes               |
|     | c) `render-table` + `render-detail`                              | Consumir `safeHTML`                     |
|     | d) `pdf-export` (envuelve `jsPDF`)                               | Snapshot test                           |
|     | e) `state` / store central                                       | Última — depende del resto              |
| 2.3 | Migrar consumers HTML → módulos TS uno a uno con flag opcional   | Feature flag `USE_NEW_MODULE` por tab   |

---

## P3 — Features + calidad (2-3 meses)

Pulido, cierre de gaps de testing, publicación.

| #   | Tarea                                                                      | Origen             |
| --- | -------------------------------------------------------------------------- | ------------------ |
| 3.1 | Virtualización tabla >500 filas — `virtualTable.ts` ya existe, wire en UI  | README 3.3         |
| 3.2 | URL deep-linking — `urlState.ts` ya existe, wire en tabs/filtros           | README 3.5         |
| 3.3 | Tests faltantes: `writeUrlState`, `virtualTable`, `setSafeText`            | `tests/`           |
| 3.4 | Publicar en GitHub privado — `Eminav-117/control-flotilla` ✅ 2026-04-16    | README 3.6         |
| 3.5 | CI: agregar `npm audit --audit-level=high` + `audit:xss` + coverage threshold 80% | `.github/workflows/ci.yml` |
| 3.6 | Migrar ~15 `alert()` restantes en legado a `notify()` explícito             | `Control de flotilla.html` |

---

## P4 — Corte definitivo (3-4 meses)

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
