# Brief para el dueño de Operaciones-GPA (Eco-Admin) — cambios del lado Ops

- **Fecha:** 2026-07-15 · **De:** Tesorería GPA (Fleet Command) · **Para:** dueño del repo `DevGPA/Eco-Admin`
- **Contexto:** el puente **Ops → Fleet Command está vivo en producción** (`gpa.ops.v1`, eventos por DynamoDB Streams). Para endurecer la integración y preparar el canal de retorno (`gpa.fc.v1`), estas son las peticiones del lado de Ops, ordenadas por prioridad. Ninguna cambia el flujo de captura; casi todas son campos que enriquecen FC sin costo de captura nuevo.
- **Respaldo técnico:** [análisis de brechas](2026-07-15-brechas-y-modelo-unificado-fc-opsgpa.md) y [diseño de integración](2026-07-15-integracion-bidireccional-fc-opsgpa-design.md).

---

## A. Integridad — bloqueantes (P0)

### A1. Congelar `economico` (server-side)

Hoy `economico` es editable en Ops. Es la **llave estable** con la que Fleet Command identifica cada unidad y liga todo el histórico de combustible. Si un usuario lo cambia, el registro correspondiente **se huérfana en FC**. Petición: hacer `economico` **no editable** en el servidor e invertir la política a **`sucursal` editable-admin** (que es el campo que sí cambia por operación).

### A2. (Resuelto — sin acción de tu lado) El aceite del semanal ya quedó verificado

Confirmamos contra registros reales de producción que el checklist **semanal sí captura el nivel de aceite**, y bajo la llave `aceite` — que es justo la que Fleet Command lee. Todo correcto; **no necesitamos nada de tu lado aquí**, solo lo dejamos anotado. (De nuestro lado regeneramos nuestro archivo de ejemplo `cl-semanal-creacion.json`, que estaba desalineado, y añadimos una prueba extra — sin cambios en Ops.)

---

## B. Datos a propagar en el evento (P0/P1) — enriquecen FC, no cambian la captura

### B1. Identidad y fecha del **aprobador** en `cambio_estado`

Hoy el evento de aprobación reenvía el mismo `responsable` (el capturista) y no dice **quién aprobó ni cuándo**. Tesorería necesita `autorizadoPor` (nombre/correo del revisor) y `fechaAut` (timestamp de la aprobación) en el envelope de `cambio_estado`. Sin ellos la auditoría solo sabe "Ops aprobó en algún momento".

### B2. Hora local / huso de la sucursal

El único sello temporal es `fechaISO` en UTC. Para sucursales fuera de UTC-6 (Cabos, Cancún), una captura cerca de medianoche cae en el **día equivocado** y el orden cronológico que alimenta el km/l se puede invertir. Petición: propagar la **hora local de captura** (o el offset/huso de la sucursal) además del sello del servidor.

---

## C. Homologación de vocabulario (P1)

### C1. Uniformar `status`

Hoy es inconsistente entre entidades: SOL emite `"Aprobada"` (femenino), CL emite `"Aprobado"` (masculino). Fijar un enum único **{Pendiente, Aprobada, Rechazada}** con un solo género.

### C2. Uniformar documentos del mensual a DOC_OPTS

La mayoría usa `"Si vigente"/"Vencido"/"No cuenta"`, pero **refrendo** y **calcomanía** usan `"Si"/"No"` plano. Uniformar todos los documentos al mismo tri-estado — nos permite alimentar el semáforo de Cumplimiento sin ambigüedad.

### C3. Discriminador `tipo_captura` explícito (solicitud vs carga)

Solicitud y reporte de carga se persisten ambos como `tipo_reg="SOL"`; el único discriminador es `formato="reporte"` dentro de `answers`. Si falta ese flag, el reporte entra como solicitud y **se pierde el km/l** (nuestro invariante). Un campo tipado de primer nivel `tipo_captura` ∈ {solicitud, carga} lo blinda.

---

## D. Para el canal de retorno `gpa.fc.v1` (cuando lo activemos)

### D1. Campos namespaced propiedad de Fleet Command

Fleet Command devolverá dos cosas a Ops por un canal firmado (espejo del actual): el **veredicto final de tesorería** y las **anulaciones**. Ops guardaría un juego de campos **read-only-from-FC**, que **nunca re-emite** por `gpa.ops.v1` (para evitar ping-pong):

- `veredictoTesoreria`, `veredictoNota`, `veredictoRevisadoPor`, `veredictoTs`
- `anulado` (bool), `anuladoMotivo`, `anuladoPor`, `anuladoTs`

Esto requiere un pequeño **receptor** del lado Ops (te pasamos el contrato `gpa.fc.v1` + golden ya listos, mismo esquema de firma HMAC que el actual).

### D2. `version`/`rev` por registro

Un contador por item habilita concurrencia optimista y desempate limpio de conflictos.

---

## E. Atributos deseables en el catálogo `CAT#VEHICLE` (P2)

Cuando Ops sea el catálogo maestro de vehículos, estos atributos por unidad enriquecen FC (hoy los infiere o los tiene solo admin): **capacidad de tanque** (L), **tipo de combustible** {Magna, Premium, Diesel, GasLP}, **productoToka** (grafía EASYGAS), **área** operativa (catálogo fijo), y `vin`/`modelo`/`anio`.

---

## Nota de contrato

Los golden viven en **ambos repos** (`Operaciones-GPA/tests/golden/` ≡ `tests/opsgpa-golden/` en FC) y el CI de cada lado truena si el contrato diverge. Cualquier cambio de C/D debe reflejarse en los golden y correr ambas suites.

## Resumen de prioridades

| P     | Ítem                                                                | Esfuerzo Ops |
| ----- | ------------------------------------------------------------------- | ------------ |
| P0    | A1 congelar económico (A2/A3 ya resueltos de nuestro lado)          | Bajo         |
| P0/P1 | B1 aprobador · B2 hora local/huso                                   | Medio        |
| P1    | C1 status · C2 DOC_OPTS · C3 tipo_captura                           | Bajo-medio   |
| P2    | D1 receptor gpa.fc.v1 + campos namespaced · D2 version · E catálogo | Medio        |
