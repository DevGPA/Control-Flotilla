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
src/                # Frontend Vite + TS (existente)
  analyzer/         # Lógica pura sin DOM (testeable)
  dom/              # Helpers XSS-safe
  types.ts
tests/              # Vitest suites

infra/              # AWS CDK v2 — infraestructura como código
  bin/app.ts
  lib/
    storage-stack.ts    # S3 + DynamoDB single-table + KMS
    auth-stack.ts       # Cognito User Pool
    api-stack.ts        # Lambda + API Gateway + Cognito Authorizer

backend/            # Lambda handlers (Node 20 ARM64)
  src/
    handlers/       # units, taller, notas, checklist, periodos, semanales, images
    lib/
      idempotency.ts    # Dedup core (3 capas anti-duplicados)
      repo.ts           # DDB single-table helpers (optimistic lock)
      http.ts           # Cognito JWT extraction, error envelope

shared/types/       # Tipos compartidos backend ↔ frontend
```

## Backend AWS (Fase 1 entregada)

Migración del backend a AWS gestionada en 6 fases (ver `Backend_AWS_Control_Flotilla_Resumen.pdf`):

| #   | Fase                                                  | Status                             |
| --- | ----------------------------------------------------- | ---------------------------------- |
| 1   | Infra CDK (S3 + DynamoDB + Cognito + Lambda + API GW) | ✅ Code listo, pendiente deploy TI |
| 2   | Auth Cognito en frontend                              | ⏳                                 |
| 3   | Repository pattern (extraer IndexedDB del HTML)       | ⏳                                 |
| 4   | Image pipeline S3                                     | ⏳                                 |
| 5   | Metadata sync + migración IDB → DDB + Background Sync | ⏳                                 |
| 6   | Hardening (CloudWatch, AWS Backup, WAF, runbook)      | ⏳                                 |

**Diseño DynamoDB**: single-table, PK=`TENANT#{orgId}`, SK=`{ISO-date}#{type}#{id}`, GSI1 por unidad, GSI2 por sucursal, PITR ON, KMS CMK.

**Antiduplicados — 3 capas**: id determinístico (SHA-256 de natural key) + conditional writes + Idempotency-Key header table. Updates con optimistic locking via `version` attribute.

**Costo proyectado**: < USD 30/mes para 5–20 usuarios. Free tier cubre primeros 12 meses.

### Para Sistemas/TI

El despliegue lo ejecuta TI (no el desarrollador). Documentación:

- **[docs/HANDOFF_TI.md](./docs/HANDOFF_TI.md)** — Checklist paso a paso para el administrador AWS.
- **[infra/README.md](./infra/README.md)** — Detalle técnico de stacks, schema y política antiduplicados.

Resumen del flujo TI:

```bash
aws configure --profile gpa-deploy
cd infra && npm install
cd ../backend && npm install
cd ../infra
npm run bootstrap   # 1 vez por cuenta+región
npm run deploy:dev  # validar
npm run deploy:prod # cuando dev OK
```

TI envía al desarrollador los outputs (UserPoolId, ApiUrl, ImagesBucketName, etc.) → el desarrollador los configura en `.env.production` del frontend.
