# Taller híbrido · Plan 2 · Bloque 1 — Seguimiento del proveedor desde el registro de la unidad

**Fecha:** 2026-09-15 · **Estado:** aprobado por Navares en brainstorming (7 decisiones, abajo) · **Rama:** `feat/taller-seguimiento-proveedor` (desde `main` = `6bf4260`, PR #17 + #18 desplegados)
**Lienzo de diseño (estilos reales de la app):** https://claude.ai/artifact/1WACnwKyjWhGptGbwqcicj
**Antecedente:** `2026-09-04-taller-esquema-hibrido-proveedor-design.md` (Plan 1: el ciclo de firma). Este bloque cubre lo que el Plan 1 dejó escrito y sin lado de lectura (ruling R88) y la petición de Navares tras el lanzamiento: _"que se pueda llevar un seguimiento y actualización de información desde este panel"_ y _"siempre tener visibilidad de qué se rechazó y qué se aceptó"_.

## 1. Problema

Tras el despliegue del esquema híbrido (2026-09-14) el ciclo funciona de punta a punta, pero la visibilidad para Riesgos es mínima:

- La firma vive en una pestaña aparte ("Bandeja de firmas") y el registro de la visita solo muestra el total. Dos lugares para una sola tarea.
- Las columnas que el taller escribe desde su liga (`estadoOperativo`, `km`, `fsalidaEst`, `fsalidaEstCompromiso`) y las de la liga (`ligaVersion`, `ligaCreadaEn/Por`, `ligaRevocadaEn/Por`) **se guardan y nunca se pintan**.
- Qué se autorizó y qué se rechazó, por quién, cuándo y por qué, existe en `TallerPartida` (`estado`, `decididoPor`, `decididoEn`, `motivoRechazo`, `precioAutorizado`) pero solo se ve la fila pendiente mientras está pendiente.
- Las fotos del taller se ven en una miniatura de 56 px sin forma de abrirlas.

## 2. Decisiones (cerradas con Navares, 2026-09-15)

| # | Decisión | Razón |
|---|---|---|
| 1 | **Se firma y se ve el historial desde el registro de la unidad** (modal "Editar registro"). | Una persona firma y hay pocas visitas abiertas a la vez: todo en un lugar, con el contexto de la camioneta. |
| 2 | La pestaña "Bandeja de firmas" pasa a **"Pendientes de firma"**: bandeja de **entrada** (lista por unidad con total) cuyo renglón **abre el registro**. Ahí no se firma. Se puede ocultar tras el piloto si nadie la usa. | Responde "¿qué me espera hoy, de todas las camionetas?" sin abrir una por una. |
| 3 | Bloque **"Proveedor" arriba** del registro, debajo de la identificación. | Es lo primero que Riesgos quiere ver en una visita con liga. |
| 4 | **Distintivo por renglón** en la tabla de Taller: una sola señal, la más urgente. | La tabla dice dónde entrar. |
| 5 | **Fotos del taller en visor** grande (clic en la miniatura). | Hoy no se pueden revisar. |
| 6 | **Excel y expediente PDF** incluyen las partidas con estado, motivo y firmante. | El rastro debe poder salir del sistema (una disputa con el taller). |
| 7 | **Fuera de esta versión:** registrar cuándo entra el taller a la liga (último acceso); que Riesgos corrija lo que reporta el taller; avisos por correo; asignar la credencial `riesgos` desde el panel de usuarios. | v1 sin cambios de servidor. |

**Regla que gobierna todo el bloque:** _el taller REPORTA (estado operativo, km, fecha prometida, fotos, partidas); Riesgos VE y DECIDE (liga, firma)._ Una sola fuente de verdad por dato; nada de lo que reporta el taller se edita desde la app.

## 3. Alcance

**Entra (v1):**
- Bloque "Proveedor" en el modal, con cuatro partes: liga · estado del taller · partidas (lista completa con filtros y decisión inline) · fotos (por partida, con visor).
- Distintivo "Proveedor" por renglón en la tabla de visitas de Taller.
- Pestaña "Pendientes de firma" como bandeja de entrada por unidad.
- Visor de fotos (overlay) reutilizado por el bloque y por la bandeja.
- Exports: hoja "Partidas" en el Excel de Taller; tabla de partidas en el expediente PDF.
- Todo detrás del apagador (`needs-hibrido` / `__tallerHibrido`) y del tri-estado (`_partidasConfiables()`).

**No entra:** nada de la decisión 7; ningún cambio de esquema, de Lambda ni de IAM; ningún cambio a lo que ve el taller en su celular (`pagina.ts`).

## 4. Datos: nada nuevo se escribe

Todo lo que el bloque muestra ya vive en la nube. Lo que falta es leerlo.

### 4.1 Columnas de `Taller` que hoy no llegan al `TallerEntry`

`cloudHydrate.ts` construye `TallerEntry` desde `datos` (blob) y algunas columnas. Se añaden al mapeo, con `numOrUndef`/`String` según tipo y **sin normalizar**:

| Columna | Campo nuevo en `TallerEntry` | Tipo | Quién la escribe |
|---|---|---|---|
| `ligaVersion` | `ligaVersion` | `number \| undefined` | resolver (emitir/revocar) |
| `ligaCreadaEn`, `ligaCreadaPor` | `ligaCreadaEn`, `ligaCreadaPor` | `string \| undefined` | resolver (emitir) |
| `ligaRevocadaEn`, `ligaRevocadaPor` | `ligaRevocadaEn`, `ligaRevocadaPor` | `string \| undefined` | resolver (revocar); emitir las pone en `null` |
| `estadoOperativo` | `estadoOperativo` | `"revisando" \| "reparando" \| "esperandoRefaccion" \| "lista" \| undefined` | portal (`/api/visita`) |
| `km` (columna) | `kmTaller` | `number \| undefined` | portal — distinto de `datos.km` (el que teclea Riesgos); se muestran los dos si difieren |
| `fsalidaEst` (columna) | `fsalidaEstTaller` | `string \| undefined` | portal — la promesa VIGENTE |
| `fsalidaEstCompromiso` | `fsalidaEstCompromiso` | `string \| undefined` | portal — la PRIMERA promesa, se escribe una sola vez (`actualizarVisita`) |

Estos campos **no viajan en el upload** (`uploadTallerToCloud` no los toca: son columnas del servidor). `sinGastoSiTienePartidas` y el resto del chokepoint quedan intactos.

### 4.2 Partidas

Ya están en memoria: `window.__tallerPartidas` (mapa `visitaKey → Partida[]`, publicado en la hidratación, BC-C1) con `estado`, `precio`, `precioAutorizado`, `decididoPor`, `decididoEn`, `motivoRechazo`, `motivoRechazoNota`, `fotos`, `creadoPor`, `propuestoEn`. La llave de la visita sale de `tallerCloudKey(e)`/`visitaKeyDe(e)` — **nunca** se recompone en el monolito.

## 5. Capa pura (nueva, `src/taller/seguimiento.ts`, 100 % probada)

```ts
export type EstadoLiga =
  | { kind: "sin-liga" }
  | { kind: "activa"; venceEn: string; diasRestantes: number; emitidaEn: string; emitidaPor: string }
  | { kind: "vencida"; vencioEn: string; emitidaEn: string; emitidaPor: string }
  | { kind: "revocada"; revocadaEn: string; revocadaPor: string };

export function estadoLiga(e: LigaCampos, ahora: Date, vigenciaMs = VIGENCIA_LIGA_MS): EstadoLiga;
```
- `sin-liga` si no hay `ligaCreadaEn`.
- `revocada` si `ligaRevocadaEn` existe y es posterior o igual a `ligaCreadaEn` (emitir limpia las columnas de revocación, así que una re-emisión vuelve a `activa`).
- `vencida` si `ahora ≥ ligaCreadaEn + vigencia` (90 días, **la misma constante** que usa el portal: `VIGENCIA_LIGA_MS` en `amplify/functions/taller-portal/token.ts`; como el frontend no importa del backend, se duplica en `seguimiento.ts` con un test que lea el archivo del portal y compare los dos valores).
- `activa` en otro caso, con `diasRestantes = ceil((vence − ahora) / 1 día)`.

```ts
export type PromesaTaller =
  | { kind: "sin-promesa" }
  | { kind: "vigente"; fecha: string; diasRestantes: number }
  | { kind: "vencida"; fecha: string; diasVencida: number; compromisoOriginal?: string };

export function promesaTaller(e: PromesaCampos, hoyISO: string): PromesaTaller;
```
- Usa `fsalidaEstTaller` (la vigente); si difiere de `fsalidaEstCompromiso`, expone el compromiso original para pintarlo ("prometió 12/09, ahora dice 19/09").
- `vencida` solo si la visita **no** está cerrada (`estado` ≠ Finalizado/Listo y sin `fsalidaReal`).
- Comparación por fecha civil (`YYYY-MM-DD`), sin horas ni husos.

```ts
export type ResumenPartidas = {
  pendientes: { n: number; monto: number };   // estado "propuesta"
  autorizadas: { n: number; monto: number };  // suma de precioAutorizado
  rechazadas: { n: number; monto: number };   // suma de precio
  borradoresTaller: number;                   // estado "borrador" con creadoPor "liga:…" — informativo
};
export function resumenPartidas(ps: readonly Partida[]): ResumenPartidas;
```
- `montoPendienteDeFirma`/`gastoTotalDe` existentes siguen siendo la fuente para dinero de la visita; `resumenPartidas` **no** introduce una segunda fórmula de gasto: `autorizadas.monto` debe coincidir con `gastoDerivado(e, ps).gasto` y hay un test que lo exige.

```ts
export type Distintivo =
  | { kind: "promesa-vencida"; dias: number }
  | { kind: "esperando-firma"; n: number }
  | { kind: "liga-activa"; dias: number }
  | { kind: "liga-revocada" }
  | { kind: "sin-liga" };
export function distintivoProveedor(liga: EstadoLiga, promesa: PromesaTaller, resumen: ResumenPartidas): Distintivo;
```
- Prioridad fija: promesa vencida › esperando firma (N ≥ 1) › liga activa › liga revocada › sin liga. Una liga **vencida** con nada pendiente se muestra como `sin-liga` (ya no sirve; emitir de nuevo la reactiva).

```ts
export function filasPendientes(entries, partidasPorVisita): FilaPendiente[];  // para la bandeja de entrada
```
- Una fila por visita con ≥ 1 `propuesta`: unidad, placa, ingreso, n, monto, la propuesta más antigua (`propuestoEn` mínimo), distintivo. Ordenadas por antigüedad de la más antigua (la que más espera, arriba). Reusa `filasBandeja` existente como insumo, no la duplica.

## 6. Pantallas

### 6.1 Registro de la unidad (modal `#taller-modal`) — bloque "Proveedor"

Se inserta después de la sección "Identificación de la unidad", como `.tl-sec` + un contenedor `grid-column: 1/-1`, clase `needs-hibrido`. Solo para visitas **persistidas** (`e` existe); en un ingreso nuevo el bloque no se pinta.

1. **Liga:** pastilla de estado (`activa` azul con días, `vencida`/`revocada` gris, `sin-liga` gris) + "Emitida por … el …" + botones **Copiar liga** / **Revocar** (los que ya existen, se mueven aquí con sus clases `needs-liga needs-hibrido` y la misma lógica `ligaOfrecible`; el pie del modal deja de mostrarlos).
2. **Estado del taller:** pastilla `estadoOperativo` con las clases existentes de la tabla (`tl-pill` + `repar`/`cotiz`/`porrec`/`listo` mapeadas desde revisando/reparando/esperandoRefaccion/lista), `kmTaller` (si difiere de `datos.km` se pintan ambos: "km taller 100 · km ingreso 98"), promesa con aviso rojo si vencida y, si cambió, el compromiso original. Línea gris: "Estado, km y fecha prometida los reporta el proveedor desde su liga." Si no hay nada reportado: "El taller aún no ha reportado estado."
3. **Partidas:** fila de filtros (`Todas · N`, `Pendientes · N`, `Autorizadas · N`, `Rechazadas · N`) + total autorizado/esperando a la derecha. Lista con **una fila por partida** (reusa `_bnPartida` del monolito: misma anatomía, mismos handlers `_bnAutorizar`/`_bnRechazar`, mismo menú de motivos):
   - pendiente: fondo ámbar tenue, botones **Autorizar**/**Rechazar** (`needs-write bandeja-firma-btn`, 44 px);
   - autorizada: pastilla verde, "Autorizada por … el …", precio autorizado;
   - rechazada: descripción tachada, pastilla roja, "Rechazada por … el … · motivo" (+ nota si la hay);
   - borrador del taller (aún no enviado): pastilla gris "Borrador del taller", sin botones;
   - cancelada: no se lista (anulación) salvo bajo el filtro "Todas", con pastilla "Cancelada".
   Filtro por defecto: **Pendientes** si hay alguna; si no, **Todas**.
4. **Fotos:** la miniatura de cada partida (44 px aquí, 56 en la bandeja) es un botón con `aria-label="Ver N fotos"`, contador de fotos en la esquina; clic abre el visor (§6.3).

**Repintado:** al autorizar/rechazar desde el modal, la misma secuencia que la bandeja (BC-C1): `__guardarDecisionPartida` → `__cloudHydrate()` → repintar el bloque (lista, filtros, totales), el campo `#tf-gasto` derivado, el distintivo del renglón en la tabla y el contador de la pestaña, **sin recargar**. Si la partida ya fue decidida en otra pestaña (B-C3), el aviso dice quién y cuándo la decidió y el bloque se repinta.

**Tri-estado:** con `!_partidasConfiables()` el bloque muestra "No se pudieron cargar las partidas" en lugar de la lista y **deshabilita** las decisiones; liga y estado del taller sí se pintan (no dependen de partidas).

### 6.2 Tabla de Taller — columna "Proveedor"

Nueva columna después de "Días", encabezado "Proveedor", visible solo con el apagador encendido (`needs-hibrido` en `th` y `td`). Contenido: una pastilla `tl-pill` por `distintivoProveedor(...)`:

| Distintivo | Texto | Colores (tokens) |
|---|---|---|
| promesa-vencida | `Promesa vencida · Nd` | `--Rl` / `--tl-pend-fg` |
| esperando-firma | `Esperando firma · N` | `--Al` / `--tl-warn-fg` |
| liga-activa | `Liga activa · Nd` | `--Bl` / `--B` |
| liga-revocada | `Liga revocada` (tachado) | `--bg3` / `--s2` |
| sin-liga | `Sin liga` | `--bg3` / `--s2` |

Ordenable por urgencia (misma prioridad). Si la tabla queda ancha en pantallas chicas, la alternativa aprobada es pintar la pastilla debajo del No. Unidad en la primera celda (decisión de implementación, no de producto).

### 6.3 Visor de fotos (nuevo, `src/taller/visorFotos.ts` + montaje en el monolito)

Overlay `position: fixed` construido con `createElement` (cero `innerHTML`): fondo `rgba(11,15,25,.92)`, imagen `max 90vw × 80vh` con `object-fit: contain`, encabezado (descripción · precio · "foto i de N · subida por el taller el …"), flechas anterior/siguiente (44 px), cerrar (X), tira de miniaturas. Teclado: `Esc` cierra, `←/→` cambian; clic fuera de la imagen cierra; en táctil, deslizar. Foco atrapado dentro del visor mientras está abierto y devuelto al botón que lo abrió al cerrar (`role="dialog"`, `aria-modal`). Las URLs salen del **mismo puente firmado** que usa la bandeja (`getUrl` en `tallerPartidas.ts`), bajo demanda por foto, con `onerror` → "Foto no disponible". Un solo visor para bandeja, registro y expediente.

### 6.4 Pestaña "Pendientes de firma" (antes "Bandeja de firmas")

Mismo contenedor `#tl-bandeja`, mismo contador `#tl-bandeja-cnt`. Renombrada. Contenido: la franja de resumen actual + **una fila por unidad** (`filasPendientes`): unidad · placa · modelo · sucursal · ingreso · distintivo · "N partidas · $monto" · "la más antigua espera desde …" · botón **Abrir registro** (44 px) que llama `openTallerModal(id)` y deja el filtro del bloque en "Pendientes". Vacío: "No hay partidas esperando tu firma." Ya **no** pinta partidas ni botones de decisión (código de `_bnPartida` se conserva, lo usa el modal).

### 6.5 Exports (decisión 6)

- **Excel de Taller** (`src/taller/exportExcel.ts`, ExcelJS): nueva hoja **"Partidas"**: Unidad · Placa · Ingreso · Descripción · Tipo · Precio propuesto · Estado · Precio autorizado · Decidido por · Decidido el · Motivo de rechazo · Nota · Origen (taller/GPA) · Fotos (n). Una fila por partida de las visitas exportadas; canceladas incluidas con estado "Cancelada". Fechas con `utcWallClock` como el resto.
- **Expediente PDF** (motor `src/pdf/engine.ts`; fotos vía `src/pdf/photoImages.ts`; se dispara desde `expedienteDesdeModal()` en el monolito): tabla "Partidas del proveedor" con las mismas columnas esenciales (descripción, precio, estado, decidido por/el, motivo) y, si hay fotos, las miniaturas descargadas por bytes y reescaladas con el helper existente (regla del repo: nunca una URL a `addImage`).
- La columna "Capturado originalmente" (`gastoCapturadoOriginal`) queda como está: decisión pendiente aparte (§4.20 del handoff).

## 7. Permisos y apagador

- **Ver** el bloque, la columna y la pestaña: cualquier usuario con el apagador encendido (`needs-hibrido`); `viewer` ve todo en solo lectura.
- **Decidir** partidas: `needs-write` (admin u operativo) — sin cambios respecto a la bandeja de hoy; el servidor ya lo aplica (`TallerPartida.update` para `operativo`/`admin`).
- **Emitir/revocar liga:** `needs-liga` (admin o `riesgos`) — sin cambios.
- **Apagador apagado:** nada de esto se pinta (R62 intacto); la pestaña se oculta como hoy.

## 8. Errores y estados

| Situación | Comportamiento |
|---|---|
| Partidas no cargadas (tri-estado) | Bloque: "No se pudieron cargar las partidas"; decisiones deshabilitadas; liga y estado del taller sí se pintan. Tabla: la pastilla no se pinta (celda vacía) para no mentir. |
| Partida ya decidida en otra pestaña | Aviso "Esta partida ya fue autorizada/rechazada por … el …" y repintado. |
| Fallo al decidir | Aviso "No se pudo autorizar/rechazar. Intenta de nuevo." (existente) y el botón se reactiva. |
| Foto que no carga | Miniatura "Sin foto"; en el visor "Foto no disponible". |
| Visita cerrada (Finalizado / con salida real) | Liga: no se ofrece emitir; promesa: no se marca vencida; partidas: historial completo, sin decisiones nuevas (misma regla de hoy). |

## 9. Pruebas

- **Puras (vitest):** `estadoLiga` (sin liga, activa con días exactos, vencida al minuto de 90 días, revocada, re-emitida tras revocar), `promesaTaller` (sin promesa, vigente, vencida, cerrada ⇒ no vencida, compromiso ≠ vigente), `resumenPartidas` (coincide con `gastoDerivado`; borradores no cuentan; canceladas no cuentan), `distintivoProveedor` (tabla de prioridad completa), `filasPendientes` (orden por antigüedad, una fila por visita, vacío).
- **Estructurales del monolito** (patrón `tallerOlaHonestidadUi.test.ts`): bloque bajo `needs-hibrido`; decisiones con `needs-write`; botones de liga movidos al bloque (y ausentes del pie); columna con `needs-hibrido`; visor sin `innerHTML`; `Esc` cierra; secuencia de repintado tras decidir incluye tabla y contador.
- **Exports:** hoja "Partidas" con encabezados exactos y una fila por partida; canceladas etiquetadas.
- **Guardias del repo:** `npm run csp:sync` tras tocar `<script>` inline; `audit:xss` limpio; e2e local sin regresión (los 7 ambientales conocidos).
- **Manual (Navares/Riesgos), antes de fusionar:** autorizar desde el registro y ver que la fila cambia de estado, el `#tf-gasto`, la pastilla de la tabla y el contador se actualizan sin recargar; abrir una foto en grande; la pestaña abre el registro con el filtro en Pendientes.

## 10. Plan de construcción (dos tareas, sin servidor)

- **T1 — Registro + tabla + visor:** §4.1 (hidratación), §5 (capa pura con tests), §6.1, §6.2, §6.3, §7, §8. Es el grueso.
- **T2 — Bandeja de entrada + exports:** §6.4, §6.5 y el renombre de la pestaña.

Cada tarea: brief → implementación (TDD en la capa pura) → revisión (OPUS en T1 por tocar dinero y decisiones) → verificación del controller (suite capturada a archivo, typecheck, lint, csp, xss, build, e2e). Merge en un PR por bloque; deploy lo aprueba Navares.

## 11. Riesgos y mitigaciones

- **Dos fórmulas de dinero:** `resumenPartidas` podría divergir de `gastoDerivado`. Mitigación: test de igualdad obligatorio y `autorizadas.monto` calculado con la misma función.
- **Modal ya largo:** el bloque agrega altura. Mitigación: filtro por defecto en Pendientes, lista con scroll propio a partir de 6 filas, liga y estado del taller en dos líneas.
- **Tabla ancha:** columna nueva en pantallas chicas. Mitigación aprobada: pastilla bajo el No. Unidad.
- **Repintado incompleto:** el defecto #1 del cierre del Plan 1 fue exactamente eso. Mitigación: la secuencia de repintado se prueba estructuralmente y se verifica a mano antes de fusionar.
- **Vigencia distinta a la del portal:** si el frontend asume 90 días y el portal cambia, "vence en" mentiría. Mitigación: una sola constante compartida o test que compare ambas.

## 12. Preguntas que quedaron cerradas en el brainstorming

- ¿Riesgos edita lo que reporta el taller? **No** (decisión 1: una fuente de verdad).
- ¿Se registra cuándo el taller abre la liga? **No en v1** (decisión 7).
- ¿Se quita la pestaña? **No; se convierte en bandeja de entrada** y se evalúa tras el piloto (decisión 2).
- ¿Dónde va el bloque? **Arriba** (decisión 3). ¿Distintivo en la tabla? **Sí, uno por renglón** (decisión 4).
