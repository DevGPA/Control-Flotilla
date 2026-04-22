# Auditoría Industrial 360° — Hallazgos Fase 0

**Proyecto**: Control de Flotilla
**Fecha**: 2026-04-22
**Scope**: HTML legacy + módulos TS + infra (Docker/nginx) + seguridad
**Estado**: Triage — sin implementar fixes

---

## Resumen ejecutivo

| Severidad | HTML Legacy | TS Modules | Infra/Seguridad | Total |
|-----------|-------------|------------|-----------------|-------|
| 🔴 Crítico | 3 | 3 | 5 | **11** |
| 🟠 Alto    | 3 | 5 | 6 | **14** |
| 🟡 Medio   | 4 | 7 | 8 | **19** |
| 🔵 Bajo    | 1 | 5 | 7 | **13** |

**Blockers para producción industrial**: 11 críticos.
**Tiempo estimado fixes Críticos+Altos**: 8-12h.

---

## 🔴 CRÍTICO — bloquean release

### Seguridad / Supply chain
1. **[`Dockerfile:17` + `package.json:21`] Versiones jsPDF divergentes**
   HTML carga jsPDF 2.5.1 vía CDN; package.json declara `^4.2.1`. Build mensual usa libs distintas → comportamiento impredecible.
   *Fix*: pin versión única (recomendado: 2.5.1 instalado localmente, eliminar CDN).

2. **[`vite.config.ts:10`] Sourcemaps en producción**
   `sourcemap: true` expone TS completo en `dist/`. Confirmado en `dist/assets/*.map`, `dist/sw.js.map`.
   *Fix*: `sourcemap: false` o `'hidden'` para Sentry-only.

3. **[`nginx.conf:20`] CSP permite `unsafe-inline`**
   Anula mitigación XSS para script-src y style-src. HTML legacy depende de inline handlers.
   *Fix*: migrar handlers a addEventListener + nonce/hash, luego endurecer CSP.

4. **[HTML:26, 30, 35] 3 CDNs hardcodeados (SheetJS, Cloudflare, unpkg)**
   Incompatible con air-gap. CSP los bloquea pero no hay degradación graceful.
   *Fix*: bundlear todo localmente vía npm + vite.

5. **[`Dockerfile:2,17`] Imágenes base sin pin a digest**
   `node:alpine`/`nginx:alpine` sin SHA → builds no reproducibles.
   *Fix*: `FROM nginx:alpine@sha256:...`.

### Lógica / correctness
6. **[`Control de flotilla.html:2106`] `persistState(fname)` sin await**
   Usuario puede cerrar tab antes de que IDB persista → pérdida de sesión.
   *Fix*: `await persistState(fname)` + spinner "Guardando...".

7. **[`src/analyzer/constants.ts:89`] Normalización diacrítica inconsistente**
   `isBinFail()` usa rango Unicode literal `[̀-ͯ]`; resto del codebase usa `[̀-ͯ]`. Acentos pueden no normalizar bien.
   *Fix*: unificar a escape sequence.

8. **[`src/state/appState.ts:79,87`] Bridge muta `_state` sin notificar subscribers**
   `_state[key as string] = ...` salta notify → UI desincronizada cuando legacy muta.
   *Fix*: usar setter público que dispara subscribers.

9. **[`src/io/zipLoader.ts:78,119`] Cast `as BlobPart` sin validar**
   Bypass de tipos. Refactor futuro puede pasar tipo incompatible silenciosamente.
   *Fix*: `new Blob([xlsx.bytes.buffer.slice(...) as ArrayBuffer])` o type guard.

### Infra
10. **[`nginx.conf` falta] Sin `client_max_body_size`**
    Default nginx = 1MB. App acepta ZIPs de 138MB → 413 Entity Too Large garantizado.
    *Fix*: `client_max_body_size 200m;`.

11. **[Sin CSP en HTML] Ningún `<meta http-equiv="Content-Security-Policy">`**
    Solo nginx configura CSP. Si se sirve por otro path (file://, dev) → sin protección.
    *Fix*: añadir meta CSP como segunda línea de defensa.

---

## 🟠 ALTO — riesgo de regresión / fallas silenciosas

### HTML Legacy
12. **[`Control de flotilla.html:911`] `tx.onerror` solo logs, no notifica al usuario**
    Falla de IDB silenciosa → usuario cree que guardó.
    *Fix*: `window.notify("Error guardando sesión", "error")`.

13. **[HTML múltiples] `tbody.innerHTML = ""` + re-render full**
    Líneas 4725, 5112, 5292. Para flotillas grandes (100+ unidades) bloquea main thread en sort/filter.
    *Fix*: virtual scrolling (ya existe `src/ui/virtualTable.ts` — no se está usando).

14. **[`Control de flotilla.html:1735-1790`] Loop síncrono parsing ZIP sin yield**
    Bloquea UI durante parse de miles de entries.
    *Fix*: `if(i % 100 === 0) await new Promise(r=>setTimeout(r,0))`.

### TS Modules
15. **[`src/analyzer/analyzeRow.ts:76`] Contract drift en `validationErrors`**
    Optional en types pero analyzeRow siempre lo retorna como array. Consumers que hagan `?.validationErrors` skip checks que deberían correr.
    *Fix*: required en type O documentar claramente cuándo es undefined.

16. **[`src/io/zipReader.ts:111`] `readZip` swallow errors silenciosamente**
    Si entry falla, log warn pero no propaga → loads parciales sin alerta.
    *Fix*: acumular fallos y exponer via return value.

17. **[`src/db/indexedDB.ts:32+`] Falta handler en `tx.onerror`**
    Solo `req.onerror` está cubierto. Si transacción aborta externamente, promise cuelga.
    *Fix*: añadir `tx.onerror = () => reject(tx.error)`.

18. **[`src/ui/renderTable.ts:182`] `window.filt()` sin try-catch**
    Si retorna null/undefined → renderTable crash.
    *Fix*: guard explícito + fallback a `allUnits`.

19. **[`src/main.ts:182,217,344`] Casts `as Unit[]` sin validar shape**
    Si legacy corrompe estructura → bad data downstream sin error.
    *Fix*: type guard mínimo o zod schema.

### Infra
20. **[`nginx.conf`] Sin headers de seguridad (HSTS, Permissions-Policy, server_tokens)**
    Server expone versión nginx; sin HSTS para HTTPS.
    *Fix*: bloque add_header completo + `server_tokens off;`.

21. **[`nginx.conf` falta] Sin worker process tuning**
    Default = 1 worker. Uploads concurrentes serializan.
    *Fix*: `worker_processes auto; worker_connections 1024;`.

22. **[`package.json:20,26`] Caret pins en deps**
    Permite minor/patch silentes. Lockfile mitiga pero CI puede actualizar.
    *Fix*: pin exacto en deps críticas (xlsx, jspdf).

23. **[`HTML:7-17`] Anti-FOUC inline reads localStorage sin try/catch propagation**
    Errores swallowed; si localStorage corrupto → tema mal aplicado sin diagnóstico.
    *Fix*: log + fallback explícito.

24. **[`Dockerfile:30`] HEALTHCHECK trivial (HTTP 200 no garantiza salud)**
    GET / siempre devuelve 200 mientras nginx esté arriba.
    *Fix*: endpoint `/healthz` que valide al menos que assets cargan.

25. **[`package.json:22`] xlsx desde URL CDN en lugar de registry**
    Rompe `npm audit`, builds offline.
    *Fix*: `npm i xlsx` desde registry oficial.

---

## 🟡 MEDIO — deuda técnica / perf

### HTML
26. **[HTML:2360] Listeners en re-render de alertPanel** — funciona pero patrón mixto.
27. **[HTML:2879] `input.onchange =` vs `addEventListener`** — inconsistencia.
28. **[HTML:2889+] `db.transaction` sin error boundary unificado**.
29. **[HTML:1047,1496] URL revocation manual loops** — usar Map.

### TS
30. **[`src/io/zipReader.ts:49`] `Math.min(size, 65558)` sin comment** — magic constant.
31. **[`src/analyzer/risk.ts:40,50`] Locale hardcoded en `includes()`** — futuro keyword mixto-case rompe.
32. **[`src/state/store.ts:38`] Shallow eq sobre objetos mutables** — si referencia se reusa, no notify.
33. **[`src/ui/renderTable.ts:156`] ctx no congelado** — mutación aliena rompería renders.
34. **[`src/ui/detail/renderChecklist.ts:64`] `?? 0` esconde undefined** — narrow explícito.
35. **[`src/analyzer/classifyReport.ts:29`] Substring match (`includes`) puede falsos positivos** — usar word boundary.
36. **[`src/io/excelLoader.ts:62`] `sheet_to_json` skip silencioso de filas raggeadas** — sin validación.

### Infra
37. **[`DEPLOYMENT_GUIDE.md:24,35`] Hardcoded port 80 sin TLS** — air-gap sin HTTPS = creds en claro.
38. **[`tsconfig.json` falta] `noUncheckedIndexedAccess` no activado** — bugs reales en pipelines de datos.
39. **[`nginx.conf:9`] gzip sin nivel** — default 6, sintonizable.
40. **[`vite.config.ts:13-15`] Manual chunks sin verificación tree-shake** — bundles posiblemente bloated.
41. **[`Dockerfile:29`] wget HEALTHCHECK timeout 3s muy agresivo**.
42. **[`nginx.conf:23`] try_files cae a /index.html para `/api/*`** — masquerade de errores.
43. **[`.dockerignore:14-17`] Excluye README/ROADMAP** — debugging en container más difícil.
44. **[`nginx.conf:39`] error_page 404 → SPA** — UX confuso si bootstrap falla.

---

## 🔵 BAJO — limpieza

45. [HTML:152] Comentarios viejos polyfill deflate.
46. [HTML:16,152,729] `catch(_){}` swallow sin log.
47. [HTML:3988] `dataset.fpInit` flag manual — usar AbortController.
48. [`src/ui/detail/photoGallery.ts:173`] Lazy load sin fallback explícito.
49. [`src/weekly/weeklyStore.ts:118`] `s.toString()` redundante.
50. [`src/taller/renderActivas.ts:81`] Comparator string sobre ISO dates — frágil.
51. [`src/main.ts:375`] Cast sin instanceof narrow.
52. [`src/pdf/engine.ts:62`] `new jsPDF()` sin try-catch.
53. [`package.json` falta] `npm run audit` script.
54. [`nginx.conf:32`] `immutable` sin estrategia de cache-bust de emergencia documentada.
55. [`DEPLOYMENT_GUIDE.md:13`] No incluye verificación CSP/CORS post-deploy.
56. [`Dockerfile:14`] Build sin validación de artifacts.
57. [`vite.config.ts:39`] PWA manifest sin verificar icons existen.

---

## Plan de remediación sugerido (3 fases)

### Fase 1 — Hardening base (4-6h)
Atacar los 11 críticos. Orden:
1. Pin versiones (jsPDF, base images) — 1h
2. Eliminar CDNs + bundle local — 2h
3. Endurecer nginx (CSP estricta, client_max_body_size, headers, tuning) — 1h
4. Fix `await persistState` — 15min
5. Normalizar diacríticos en `isBinFail` — 15min
6. Fix `appState` setter notify — 30min
7. Sourcemaps off — 5min

### Fase 2 — Resilience (3-4h)
Atender altos 12-25. Foco en error boundaries, type guards, virtual table activation.

### Fase 3 — Pulido (4-6h)
Medios 26-44 + UX/animaciones/tema oscuro consistency check.

---

## Notas para el auditor siguiente

- **Tests existentes pasan**: 518/518 en 33 files. No tocar lógica de `analyzeRow` sin reflejar en `tests/analyzeRow.test.ts`.
- **Bug ZIP `uid is not defined`**: ya resuelto en commit pendiente. Causa raíz: edit manual quitó `const uid` en `loadWB`.
- **Validación de columnas**: `analyzeRow.ts` valida 4 nombres de columnas (reales + legacy). Cambiar coordinado con `loadWB`.
- **No hay agentes/skills**: `/devfleet`, `security-scan`, `eval-harness` mencionados en briefing original NO existen en este entorno. Auditoría hecha con agents Explore genéricos + análisis manual.
