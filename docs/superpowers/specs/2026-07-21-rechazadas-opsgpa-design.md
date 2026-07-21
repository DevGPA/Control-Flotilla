# Estatus "Rechazada" de Operaciones-GPA + triage de tesorería — Diseño

**Fecha:** 2026-07-21 · **Estado:** aprobado por Navares (enfoque A) · **Módulo:** Combustible / puente Ops-GPA

## 1. Problema

Cuando un validador de Operaciones-GPA **rechaza** una carga (p. ej. error de dedo: $700,004 en
vez de $700, unidad 45, 2026-07-20), el puente la traduce a `verdictGlobal="discrepancia"`
([mapValidacion.ts](../../../src/opsgpa/mapValidacion.ts)) y el rechazo se pierde como estatus de
primera clase — solo sobrevive en el texto de la nota. Consecuencias:

1. **El gasto rechazado sigue sumando** en KPIs y desgloses (Discrepancia no excluye de cálculo,
   por diseño).
2. Como en Ops un rechazo es **terminal** (siempre se re-captura un registro nuevo), el error
   se cuenta **doble**: suman la carga basura y su re-captura.
3. La UI no distingue un veredicto de Ops de uno de tesorería:
   [mapEntry.ts](../../../src/fuel/mapEntry.ts) aplana `fuenteDeteccion` a `"manual" | "ia"`,
   perdiendo `"ops-gpa"`.

## 2. Decisiones de negocio (Navares, 2026-07-21)

| Pregunta                          | Decisión                                                                                                         | Implicación                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| ¿Qué significa un rechazo en Ops? | **Depende del motivo** — a veces captura inválida (no debe contar), a veces evidencia incompleta pero gasto real | La exclusión **no puede ser automática**                                         |
| ¿Qué pasa tras un rechazo en Ops? | **Siempre registro nuevo** — la rechazada nunca revive                                                           | No hay transición Rechazada→Aprobada que manejar; el doble conteo es sistemático |
| Enfoque elegido                   | **A: triage manual con señal** (vs B auto-anular, C motivo estructurado de Ops)                                  | Tesorería decide caso por caso; C queda como fase 2                              |

**Principio rector:** los números nunca cambian solos. La exclusión del gasto sigue teniendo un
único mecanismo — la **Anulación** existente (tombstone reversible) — detonado por un humano.

## 3. Diseño

### 3.1 Modelo de datos (sin migración)

- `FuelVerdictGlobal` gana el valor `"rechazada"`: `"ok" | "discrepancia" | "pendiente" | "rechazada"`
  ([types.ts](../../../src/fuel/types.ts)). En backend `ValidacionCarga.verdictGlobal` ya es
  `a.string()` ([resource.ts](../../../amplify/data/resource.ts)) — solo se actualiza el comentario.
- `FuelReview.fuenteDeteccion` pasa a `"manual" | "ia" | "ops-gpa"`; mapEntry deja de aplanar
  el valor (hoy `"ops-gpa"` colapsa a `"manual"`).
- **Sin campos nuevos.** El estado "pendiente de triage" se **deriva**:
  `verdictGlobal === "rechazada" && !e.anulada && fuenteDeteccion === "ops-gpa"`.

### 3.2 Puente (receptor)

- [mapValidacion.ts](../../../src/opsgpa/mapValidacion.ts): `status "Rechaza*" → verdictGlobal "rechazada"`
  (deja de mapear a discrepancia). Nota "Rechazada en origen (Operaciones-GPA)", `revisadoPor`
  y la **regla de no-pisado** (un veredicto con `fuenteDeteccion ≠ "ops-gpa"` nunca se
  sobreescribe) quedan intactas.
- Aplica igual en `creacion` y `cambio_estado` (mapValidacion ya lee `status` de ambos) y en
  [backfill.ts](../../../src/opsgpa/backfill.ts), que reutiliza el mismo adaptador.

### 3.3 UI de tabla y filtros

- Pill nueva **"Rechazada · Ops"** en `VERDICT_PILL` + entrada en `FuelDisplayVerdict`,
  `VERDICT_RANK` (rango propio, arriba de pendiente) y el filtro de veredicto
  ([renderTableCombustible.ts](../../../src/fuel/renderTableCombustible.ts)).
- Fila resaltada como acción pendiente (estilo propio, análogo a `sw-urg`).
- Origen visible en veredictos de Ops: con `fuenteDeteccion` sin aplanar, las aprobadas en
  origen se muestran distinguibles ("OK · Ops" vs "OK" de tesorería). La regla `historico`
  no aplica a rechazadas (una validación real se respeta aunque sea vieja, igual que hoy).

### 3.4 Triage (detalle de carga)

En el detalle de una **rechazada vigente**, el admin ve dos acciones:

1. **"⛔ No contar"** → abre el modal de anulación existente con motivo precargado
   ("Rechazada en Ops — registro inválido"). Exclusión, reversibilidad, panel de anulados y el
   retorno FC→Ops (§4.6 del spec de integración) ya existen — cero lógica nueva de agregados.
2. **"✓ Gasto real"** → el flujo de veredicto humano existente (panel lado-a-lado); tesorería
   pone su `ok`/`discrepancia` encima (no-pisado: la palabra humana gana) y el registro sigue
   contando, ya validado. Al guardarse, sale del contador de triage.

KPI nueva tarjeta: **"Rechazadas sin triage"** (conteo de la derivación §3.1) en los KPIs del
módulo — el radar para que ninguna se quede sumando por olvido.

### 3.5 Backfill único

Script idempotente (en `scripts/`) que reclasifica las `ValidacionCarga` existentes con
`fuenteDeteccion="ops-gpa"` **y** `verdictGlobal="discrepancia"` **y** nota
`"Rechazada en origen (Operaciones-GPA)"` → `verdictGlobal="rechazada"`. El backlog aparece en
el contador y se tría una sola vez.

### 3.6 Efectos colaterales esperados

- El conteo de "Discrepancias" **baja** (los rechazos de Ops salen de ese bucket; discrepancia
  queda reservada para auditoría de tesorería). Correcto y deseado.
- El gasto **no cambia** hasta que tesorería anule caso por caso.
- Clientes con PWA vieja ven "Pendiente" en rechazadas (fallback de `VERDICTS_GLOBAL` en
  mapEntry) hasta recargar; el mecanismo sw-force-reload existente lo resuelve.

### 3.7 Pruebas

- **mapValidacion:** `"Rechazada"/"Rechazado" → "rechazada"`; aprobadas y pendientes sin cambio;
  no-pisado extendido al veredicto nuevo.
- **mapEntry:** `fuenteDeteccion="ops-gpa"` sobrevive la hidratación; `verdictGlobal="rechazada"`
  pasa la validación de `VERDICTS_GLOBAL`; valores desconocidos siguen cayendo a `"pendiente"`.
- **Derivación de triage:** rechazada vigente cuenta; anulada o con veredicto manual encima no.
- **UI:** pill/filtro/orden con el veredicto nuevo (tests de tabla existentes extendidos).

## 4. Fuera de alcance (a propósito)

- **Enlazar re-captura ↔ rechazada:** no hay llave confiable entre ambas (eventoId distinto);
  el triage humano cubre el caso.
- **Motivo estructurado de rechazo (enfoque C):** requiere que Ops capture y emita
  `motivoRechazo` categorizado; fase 2 sobre esta misma UI y tombstone. Se negocia junto con
  los campos fantasma `autorizadoPor`/`fechaAut` del spec de brechas.
- **Cambios en agregados/KPIs de gasto:** la exclusión sigue siendo solo vía anulación.
- **Auto-anulación (enfoque B):** descartada como default — subestimaría gasto real en silencio.

## 5. Interim

Mientras esto no se implemente, el flujo manual vigente: anular la carga rechazada desde el
detalle ("⛔ Anular registro…", admin) con motivo. Aplicado al caso unidad 45 del 2026-07-20.
