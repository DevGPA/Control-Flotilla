# Control de Flotilla — GPA

Sistema de control de flotilla (checklist, taller, historial) para General de Productos para el Agua.

## Estado

Migración en curso: de monolito `Control de flotilla.html` (6100 líneas) a app modular con Vite + TypeScript + Vitest.

- Código legado: `Control de flotilla.html` (fuente de verdad actual en producción)
- Código nuevo: `src/` (TS, en construcción)
- Tests: `tests/` (Vitest, cubriendo analyzer puro)

## Scripts

```bash
npm install
npm run dev         # Vite dev server
npm run test        # Vitest watch
npm run test:run    # Vitest single-shot (para CI)
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm run build       # tsc + vite build (dist/)
```

## Roadmap

Detalle completo en [ROADMAP.md](./ROADMAP.md). Resumen:

- **P0 — Bloqueadores** (esta semana): fix `happy-dom` dep, upgrade `xlsx` CVE, SRI hashes, purgar `innerHTML` legado
- **P1 — Hardening** (2-3 sem): responsive móvil, error boundaries, tests I/O, CP437 en ZIP
- **P2 — Modularizar** (1-2 meses): extraer CSS + partir JS monolito módulo por módulo
- **P3 — Features** (2-3 meses): virtualización, URL deep-linking, publicar GitHub
- **P4 — Cutover** (3-4 meses): matar legado, archivar `Control de flotilla.html`

Milestones: M1 2026-05-01 · M2 2026-06-15 · M3 2026-08-01 · M4 2026-09-01

## Arquitectura

```
src/
  analyzer/       # Lógica pura sin DOM (testeable)
    constants.ts
    analyzeRow.ts
    classifyReport.ts
    risk.ts
  dom/
    safeHTML.ts   # Helpers XSS-safe
  types.ts
tests/            # Vitest suites
```
