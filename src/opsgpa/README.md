# Conector Operaciones-GPA → GPA Fleet Command

Estructura de conexión que permite que **Operaciones-GPA** alimente a Fleet Command en
sustitución de MoreApp. Se construye **enteramente del lado de Fleet Command** y lee de
Operaciones-GPA en **solo-lectura**: no modifica el stack, la tabla ni los datos de Ops.

## Principio de diseño (por qué pull y no push)

MoreApp empujaba por webhook. Operaciones-GPA **no se toca**, así que no se le añade ningún
publicador (nada de DynamoDB Streams en su stack). En su lugar, un componente de Fleet
Command **lee** los registros nuevos de la tabla `gpa_operaciones_*` (GSI `tipo-fecha-idx`,
solo-lectura) y los traduce a los **mismos upserts idempotentes** que hoy produce el webhook
de MoreApp. Ops queda intacto y sin enterarse.

```
Operaciones-GPA (INTACTO)                 Fleet Command (todo lo nuevo vive aquí)
┌───────────────────────────┐            ┌──────────────────────────────────────────┐
│ DynamoDB gpa_operaciones_* │──lectura──▶│ lector (GSI tipo-fecha, read-only IAM)     │
│  SOL / CL / MC             │            │        │                                    │
│ S3 evidencias (SOL/CL/..)  │──lectura──▶│ copia S3→S3 → gpa-fleet-photos/photos/gpa/ │
└───────────────────────────┘            │        │                                    │
                                         │  adaptadores (este módulo, PUROS)          │
                                         │   mapSolicitud / mapCarga / mapChecklist   │
                                         │        │                                    │
                                         │  upsert idempotente (reusa process*/       │
                                         │  analyzeRow)  eventoId="OPS-<id>"           │
                                         │        │      fuente="ops-gpa"              │
                                         │        ▼                                    │
                                         │  CargaCombustible / Checklist / Semanal     │
                                         │  → dashboards, km/l, Toka, cumplimiento     │
                                         └──────────────────────────────────────────┘
```

## Garantías

- **Idempotente:** `eventoId = "OPS-<id>"` + claves naturales de Fleet Command → re-leer no
  duplica. Coexiste con el histórico de MoreApp sin colisión de folios.
- **Trazable / reversible:** cada registro lleva `fuente: "ops-gpa"` en `datos`; separable o
  purgable en cualquier momento.
- **Solo-lectura sobre Ops:** IAM del lector limitado a `Query`/`GetItem` en la tabla y
  `GetObject` en el bucket de evidencias de Ops. Cero permisos de escritura sobre Ops.
- **Sin cambios en el front:** las fotos aterrizan en `gpa-fleet-photos/photos/gpa/` con
  nombre determinístico; el front las firma por demanda igual que hoy.

## Estado (rama `feat/opsgpa-connector`, sin desplegar)

| Pieza                                                                                                                                                            | Archivo                                                 | Estado                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Contrato + tipos (SOL/CL/Carga, resolver de evidencias, input FC)                                                                                                | `contract.ts`                                           | ✅                                                                                                                                     |
| Adaptador Solicitud → CargaCombustible                                                                                                                           | `mapSolicitud.ts`                                       | ✅ + test de oro (dato real)                                                                                                           |
| Adaptador Carga → CargaCombustible + despachador `mapCombustible`                                                                                                | `mapCarga.ts`                                           | ✅ + test (fixture; sin reporte real aún)                                                                                              |
| **Traductor del envelope canónico** (publisher real e7c3d25) + firma HMAC (`X-GPA-Timestamp`/`X-GPA-Firma`, anti-replay ±300s)                                   | `evento.ts`                                             | ✅ + **test de equivalencia**: mapear vía envelope ≡ mapear el registro de tabla, byte a byte                                          |
| Adaptador Checklist SEMANAL → Unit + Semanal (motores `analyzer/risk.ts` canónicos — entienden el vocabulario de Ops sin traducción)                             | `mapChecklist.ts`                                       | ✅ + test con el CL real de prod                                                                                                       |
| **Lambda receptora** — Function URL dedicada, firma HMAC fail-closed, archivo crudo `ops-capture/`, copia de evidencias S3→S3 idempotente, upserts create→update | `amplify/functions/opsgpa-receptor/`                    | ✅ código completo (typecheck limpio; falta desplegar a sandbox y probar e2e)                                                          |
| Checklist MENSUAL → `analyzeRow` (~40 campos itemId→columna)                                                                                                     | `answersMap.ts`                                         | ⏳ — el receptor responde 422 explícito mientras tanto (visible en DLQ, no silencioso)                                                 |
| **Backfill pull** (lee GSI tipo-fecha de la tabla de Ops → mismos adaptadores/upserts; `dryRun` y `limit`; idempotente)                                          | `backfill.ts` + modo de invocación directa del receptor | ✅ + 5 tests (flujo completo con deps inyectadas). Se dispara SIN URL: `aws lambda invoke --payload '{"backfill":true,"dryRun":true}'` |

**Descubrimiento (2026-07-09):** en Operaciones-GPA la solicitud y el reporte de carga se
persisten ambos como `tipo_reg="SOL"`; el único discriminador fiable es `formato:"reporte"`
(lo maneja `esReporteDeCarga` / `mapCombustible`). Fleet Command sí separa `solicitud`/`carga`.

## Decisión pendiente: cómo se dispara la sincronización

El núcleo (adaptadores) es igual en los tres casos; lo que falta definir es el envoltorio:

1. **On-demand (endpoint admin):** un admin dispara la sync (como el `?backfill` de MoreApp).
   Simple, fácil de probar, sin scheduler. Ideal para el piloto en sombra.
2. **Programado (EventBridge cron cada N min):** sincroniza solo; casi en tiempo real.
3. **Solo núcleo por ahora:** dejar los adaptadores puros y decidir el disparador después.

## Fuera de alcance (por ahora)

Montacargas (MC) y las 27 plantillas dinámicas de Ops no cruzan el puente hasta que exista
un módulo en Fleet Command que las consuma. El contrato admite añadirlas como tipos nuevos.
