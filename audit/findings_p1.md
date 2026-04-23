# Auditoría Industrial 360° — Fase 2 (post-cierre P0)

**Fecha**: 2026-04-23
**Metodología**: `pbakaus/impeccable@audit` + extensiones propias
**Scope**: full project excluyendo items de `findings_p0.md` (ya cerrados)

---

## Executive Summary

### Score dimensional

| #         | Dimensión     | Score     | Hallazgo clave                                                                           |
| --------- | ------------- | --------- | ---------------------------------------------------------------------------------------- |
| 1         | Accessibility | **1/4**   | Cero `<label for=>` en 24 inputs. WCAG Level A fallo                                     |
| 2         | Performance   | 3/4       | Bueno (content-visibility + virtualTable + tree-shaking); fixtures 133MB shipean a dist/ |
| 3         | Theming       | 2/4       | 88 hex literales HTML vs CSS vars Tremor — paleta divergente                             |
| 4         | Responsive    | 3/4       | Mobile OK (tap-targets 44px correctos); touch targets menores problemáticos              |
| 5         | Anti-Patterns | 3/4       | No AI slop; tells residuales menores (emojis UI, inline-styles legado)                   |
| **Total** |               | **12/20** | **Rating: Acceptable**                                                                   |

### Issues nuevos (no cubiertos en P0)

- **P0**: 2
- **P1**: 7
- **P2**: 9
- **P3**: 4

---

## Anti-Patterns Verdict

**NO parece AI-generated.** Tells positivos: paleta Tremor intencional, comentarios con rationale, ADRs explícitos, stack decisions documentadas. Tells residuales menores: emojis en UI strings, inline-styles masivos (legado HTML).

---

## Top 5 hallazgos críticos (ROI ordenado)

### 1. [P0][BUG] Fixtures 133MB shipean a producción

**Ubicación**: `public/semanal.zip` (133MB) + `public/mensual.xlsx` + `public/taller.xlsx` + `public/test_rof.xlsx`
**Categoría**: Performance + Deploy hygiene
**Impacto**: Build artifact dist/ infla 130MB+, tiempo deploy/pull Docker 10× más lento, bandwidth CDN desperdiciado
**Fix**: Mover a `tests/fixtures/`. Actualizar paths en `tests/e2e/load-xlsx.spec.ts:8`, `filters.spec.ts:9`, `persist.spec.ts:10`
**Effort**: S (30 min)

### 2. [P0] Cero `<label for=>` en 24 inputs

**Ubicación**: `Control de flotilla.html` (6175 líneas, 0 matches `label for=`)

- Ejemplos: `#tl-filt-q:522`, `#sw-srch:609`, `#tf-eco:655-714`
  **Categoría**: Accessibility
  **Impacto**: Operadores con screen readers no pueden navegar formularios. Cumplimiento regulatorio (WCAG 1.3.1 / 3.3.2 Level A) bloqueado
  **Fix**: `aria-label="..."` o `<label for="id" class="sr-only">...</label>` para cada input
  **Effort**: M (1-2h coordinado)

### 3. [P1][BUG latente] `src/db/indexedDB.ts` orphan + schema stale

**Ubicación**: `src/db/indexedDB.ts`
**Categoría**: Code hygiene + Data integrity
**Detalles**:

- `DB_VER=8` vs HTML `DB_VER=9` (`Control de flotilla.html:845`)
- Stores TS no coinciden: falta `semanales/weeklyImages/periodos`
- Zero imports hoy (grep confirmó)
  **Impacto**: Time-bomb — si alguien lo importa futuro pensando que es canonical, corrompe IDB con schema viejo
  **Fix**: Eliminar `src/db/indexedDB.ts` + `tests/indexedDB.test.ts`
  **Effort**: S (15 min)

### 4. [P1] Paleta divergente — 88 hex literales vs CSS vars

**Ubicación**: `Control de flotilla.html` tiene 88 matches de hex colors vs `src/styles/main.css` que define `--R/--A/--G/--B/--O` Tremor

- Ej: `#DC2626` × 8 lugares vs `--R=#e11d48` (HTML:185, 2533, 2544, 3222, 3529...)
- `#F59E0B` × 5 vs `--A=#d97706`
  **Categoría**: Theming consistency + Dark mode
  **Impacto**: Dark mode roto para badges `.taller-badge`, alerts, chips hardcoded. User ve colores light en dark theme
  **Fix**: Search/replace `#DC2626` → `var(--R)` etc. Smoke visual dark mode post-fix
  **Effort**: M (1h search/replace + visual smoke)

### 5. [P1][security] XSS residual en `onclick` dinámico

**Ubicación**: `Control de flotilla.html:3508-3509`

```js
safeText = escHtml(...).replace(/'/g, "&#39;")
// luego: onclick="addAction('${uid}','${safeText}')"
```

**Categoría**: Security
**Impacto**: Browser decodifica HTML entities ANTES de parsear JS. Defensa rota si texto contiene `\\` o secuencias que normalizan a quote. Mitigado por CSP `'unsafe-inline'` pero defense-in-depth perdida
**Fix**: Migrar a `addEventListener` — ya existe `src/ui/detail/renderActions.ts` listo para usar
**Effort**: M (2h + regression test)

---

## Otros P1 (no tope-5)

| ID   | Issue                                                     | File:line                     | Effort |
| ---- | --------------------------------------------------------- | ----------------------------- | ------ |
| P1.6 | `outline:none` sin `:focus-visible` — WCAG 2.4.7          | `main.css:946, 971, 2189...`  | S      |
| P1.7 | Sin `prefers-reduced-motion` — 70 animaciones, WCAG 2.3.3 | `main.css` múltiples          | S      |
| P1.8 | Touch targets 16×16 en botones destructivos               | `HTML:3222, 3529`             | S      |
| P1.9 | 27 `console.*` ruido producción                           | grep `console.log/debug/info` | S      |

---

## Patrones sistémicos

1. **Paleta duplicada HTML + TS**: hex literals aparecen en HTML + `pdf/engine.ts` + `renderActivas.ts` + `renderHistorial.ts` + `renderKpisSemanales.ts`. Single source of truth Tremor CSS vars no se respeta en TS modules.

2. **`innerHTML=` × 56 en HTML legado**: módulos nuevos ya usan DOM API puro (buena práctica), pero HTML monolito sigue con innerHTML masivo. Riesgo XSS si data source cambia.

3. **Cero `<label for=>` en 24 inputs**: gap WCAG sistémico, no un solo input.

---

## Positive findings — NO tocar

- **Store pub/sub tipado** (`src/state/store.ts`) con Force flag y notify correcto
- **Bridge `window.*` ↔ `appStore`** bidireccional sin leaks
- **`content-visibility` + `virtualTable`** para flotillas grandes (P0 #13 cerrado)
- **CSP dual** (meta + nginx) — defense in depth
- **`runSafe()` + `window.onerror`** error boundary global
- **ECharts tree-shaking** — 5 charts con imports explícitos, no bundle entero
- **IDB `onblocked` + `onversionchange`** handlers presentes
- **Mobile tap-targets 44px** correctos en `main.css:3747-3760`

---

## Recomendaciones ordenadas (mayor ROI)

| #   | Acción                                                    | Effort | Priority | Gain                       |
| --- | --------------------------------------------------------- | ------ | -------- | -------------------------- |
| 1   | Mover fixtures a `tests/fixtures/` + actualizar paths e2e | S      | P0       | -130MB dist, CI 10× rápido |
| 2   | Eliminar `src/db/indexedDB.ts` orphan                     | S      | P1       | Quita time-bomb            |
| 3   | ARIA labels en 24 inputs HTML                             | M      | P0       | WCAG AA compliance         |
| 4   | Search/replace hex literals → CSS vars                    | M      | P1       | Dark mode + consistency    |
| 5   | `addEventListener` en handlers dinámicos (XSS defense)    | M      | P1       | Security defense-in-depth  |
| 6   | `:focus-visible` + `prefers-reduced-motion` CSS           | S      | P1       | WCAG 2.4.7 + 2.3.3         |
| 7   | Strip 27 `console.*` en prod (Vite drop_console)          | S      | P1       | Prod hygiene               |
| 8   | Touch targets destructivos 16px→44px                      | S      | P1       | Mobile safety              |

**Score proyectado post-fixes 1-5**: **12 → 15/20 (Good)** en ~8h trabajo coordinado.

---

## Archivo a atacar primero

**`Control de flotilla.html`** — concentra:

- 2 P0 (indirecto via `public/`, directo por labels)
- P1 paleta divergente
- P1 XSS defensa
- Patrón sistémico `innerHTML`

Un pase coordinado en este archivo + eliminar `src/db/indexedDB.ts` + quick CSS fixes (focus-visible, reduced-motion) sube score **12 → 15/20 (Good)** en ~8h.
