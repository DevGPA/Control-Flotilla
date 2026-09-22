# Taller — la liga muere con la visita y ninguna visita hereda a otra

**Fecha:** 2026-09-22 · **Estado:** diseño aprobado por Navares (brainstorming del mismo día) · **Rama:** `feat/taller-liga-cierre` desde `main` (`7e5a593`, que ya incluye el Bloque 1 y el PR #21).

**Antecedentes:** `2026-09-04-taller-esquema-hibrido-proveedor-design.md` (Plan 1, ciclo de firma) y
`2026-09-15-taller-seguimiento-proveedor-design.md` (Plan 2 · Bloque 1, en producción desde el 2026-09-18).
Origen: incidente en pruebas del 2026-09-22 (documentado en local, `HANDOFF-INCIDENTE-TALLER-LIGA-2026-09-22.md`).

## 1. Problema

La identidad de una visita de Taller es **unidad + fecha de atención** (`Taller.identifier(["tenantId","unitUid",
"fechaEntrada"])`; `tallerCloudKey` en `src/api/batchUpload.ts`). De esa identidad cuelgan la liga del proveedor, sus
partidas y el tombstone de anulación (`refIdTaller`). Eso produce, verificado en producción:

1. **Sobrescritura silenciosa.** Un alta con la misma unidad y la misma fecha que una visita existente (vigente o
   anulada) hace `upsert` sobre el mismo registro: los `datos` anteriores desaparecen sin aviso. Viola "anulación,
   nunca borrado" por la puerta de atrás.
2. **Herencia.** La visita nueva hereda la anulación (por eso "aparece al recargar y desaparece al hidratar"), la liga
   y las partidas de la anterior (por eso "me lleva a la misma liga", con los precios del taller anterior a la vista).
3. **La liga no muere con la visita.** Dar salida no la revoca: el portal la rechaza mientras la visita esté cerrada
   (`visitaCerrada`, `handler.ts`), pero si la visita se reabre la misma liga vuelve a funcionar con sus datos.
4. **Anular no la revoca y el portal no revisa anulaciones.** Una visita anulada puede seguir recibiendo partidas.
5. **La fecha de salida no se borra.** `fechaSalida: e.fsalidaReal || undefined` no limpia la columna, y al hidratar
   `datos.fsalidaReal ?? t.fechaSalida` la revive: una visita abierta carga una salida fantasma.
6. El bloque Proveedor dice "Liga activa · N días" en visitas cerradas cuya liga el portal ya rechaza.

**Regla que gobierna el frente:** *una visita nace sin herencia y su liga muere con ella.*

## 2. Decisiones (cerradas con Navares, 2026-09-22)

| # | Decisión | Por qué |
|---|---|---|
| 1 | **El alta se niega a guardar si la identidad ya está en uso** (vigente o anulada), y explica por qué. Aplica al alta, al reingreso y a corregir la fecha de una visita existente. | Cierra la sobrescritura y la herencia hoy, sin tocar el esquema. El arreglo de fondo (identidad sin fecha) es el frente #11. |
| 2 | **Dar salida revoca la liga, en el mismo guardado de la visita** (enfoque A). Reabrir no la resucita: se emite una nueva a propósito. | Un solo acto, sin segunda llamada que pueda fallar; funciona para los 3 operativos activos sin la credencial `riesgos` (que hoy no pueden llamar `revocarLigaTaller`); no cambia quién puede emitir/revocar a mano. |
| 3 | **Anular revoca la liga (primero revocar, después anular) y el portal rechaza visitas anuladas.** | Anular es solo de admin, y admin sí puede revocar. El portal ya tiene grant IAM sobre todos los modelos: puede leer `Anulacion`. Defensa en profundidad. |
| 4 | **La fecha de salida se borra de verdad** (`null` explícito) y la hidratación deja de caer a la columna. | Es la única causa de la salida fantasma. |
| 5 | **El bloque Proveedor dice "Liga cerrada con la visita"** cuando la visita está cerrada y la liga no fue revocada (visitas históricas). | La pantalla no debe prometer lo que el portal niega. |
| 6 | **Un solo frente**, con **revisión de seguridad** al final (toca el portal y el contrato de escritura). | Lo pidió Navares; los seis puntos se entienden juntos. |

Se descarta la opción B (abrir `revocarLigaTaller` a `operativo`: cambia la política de la credencial `riesgos` y son
dos pasos que pueden quedar a medias) y la C (rechazo en el portal por hora de cierre: invisible en pantalla y más
mecanismo). Fuera del frente: limpiar las columnas del proveedor al crear encima de otra visita (queda sin efecto con
la decisión 1) y la identidad por económico (#11).

## 3. Alcance

- **Frontend (monolito + `src/`):** la guarda del alta; la revocación en el chokepoint de guardado; "revocar antes de
  anular"; el `null` de `fechaSalida`; la hidratación sin fallback; `estadoLiga` con el estado "cerrada".
- **Servidor (`amplify/functions/taller-portal/`):** el portón `cargarVisitaVigente` rechaza visitas con tombstone
  activo. **Sin cambios de esquema** (`Anulacion` ya existe; el portal ya tiene grant).
- **Sin migración de datos.** La única visita con salida fantasma en producción (una de prueba) se corrige sola al
  hidratar con la decisión 4.

## 4. Diseño

### 4.1 La guarda del alta (decisión 1) — `src/taller/llaveVisita.ts` (nuevo, puro) + monolito

Función pura, sin DOM ni red:

```ts
export type LlaveEnUso =
  | { kind: "libre" }
  | { kind: "vigente"; id: string; fentrada: string }     // otra visita visible con la misma llave
  | { kind: "anulada"; fentrada: string; anuladaEn?: string };

export function llaveEnUso(
  candidata: { id?: string; unitUid: string; fechaEntrada: string },
  vigentes: readonly { id: string; unitUid: string; fechaEntrada: string }[],
  anuladas: ReadonlyMap<string, { anuladoEn?: string }>,   // window.__anuladasActivas (refId → info)
): LlaveEnUso
```

- `vigentes` son las visitas en memoria (`tallerEntries`, ya sin anuladas) con su llave calculada por
  `tallerCloudKey`; se excluye la propia visita (`id` igual) para permitir guardar una edición que no cambia la llave.
- `anuladas` es el mapa que publica la hidratación; el refId se compone con `refIdTaller(unitUid, fechaEntrada)` —
  la MISMA función que usa el tombstone, nunca una cadena a mano.
- El monolito, en `saveTallerEntry` (tras las validaciones existentes y antes de `tallerEntries.push`), calcula la
  llave de la entrada candidata con `window.__tallerCloudKey(entry)` y llama al puente `window.__llaveEnUso`. Si el
  resultado no es `libre`: `notify` con el mensaje de abajo, `_markInvalid("tf-fentrada")` y `return` — **no guarda**.
- Mensajes (UI): *"La unidad {eco} ya tiene una visita con fecha de atención {dd/mm/aaaa} ({vigente|anulada}).
  Cambia la fecha o abre la existente."* Con `anulada`: *"…(anulada el {dd/mm/aaaa}). Cambia la fecha, o
  restáurala desde Anulados si es la misma visita."*
- La guarda corre también en **reingreso** (mismo `saveTallerEntry`) y en **edición** cuando el usuario corrige
  `fentrada`/placa/eco hacia una llave ya usada (el candado B-C4 solo cubre visitas con partidas).
- **Límite declarado:** es una guarda de cliente; una sesión desactualizada o un segundo cliente pueden seguir
  colisionando en el servidor. Se documenta; el cierre real es el frente #11.

### 4.2 El cierre revoca la liga (decisión 2) — `src/api/batchUpload.ts` (`uploadTallerToCloud`) + `src/taller/seguimiento.ts`

Regla pura nueva en `seguimiento.ts`, junto a `estadoLiga`:

```ts
/** Al CERRAR una visita cuya liga está activa, el mismo guardado la revoca. */
export function revocacionPorCierre(
  e: Partial<TallerEntry>, cerrada: boolean, ahoraISO: string, quien: string,
): { ligaVersion: number; ligaRevocadaEn: string; ligaRevocadaPor: string } | null {
  if (!cerrada) return null;
  if (estadoLiga(e, ahoraISO).kind !== "activa") return null;   // la MISMA regla que pinta el bloque Proveedor
  return { ligaVersion: (e.ligaVersion ?? 1) + 1, ligaRevocadaEn: ahoraISO, ligaRevocadaPor: `cierre:${quien}` };
}
```

- `uploadTallerToCloud` ya deriva `estatus = e.fsalidaReal ? "cerrado" : "abierto"`. Cuando `estatus === "cerrado"`,
  llama `revocacionPorCierre(e, true, ahora, quien)` y, si devuelve algo, **lo incluye en el mismo `upsertTaller`**
  (`TallerInput` gana los tres campos opcionales). `quien` = correo de la sesión (`getSession().email`), el mismo
  que ya usa la anulación (`cloudWire.ts`, `anuladoPor`). El prefijo `cierre:` distingue en el rastro una revocación
  por cierre de una manual.
- La versión sube desde `e.ligaVersion` (la copia hidratada); si otra sesión la subió antes, el portal igual rechaza
  (la comparación es `actual !== token.v`), y la siguiente hidratación trae el valor real. **No hay carrera que
  reviva un token.**
- Cubre los tres caminos de cierre porque los tres terminan en `uploadTallerToCloud`: `finalizarUnidad` (tabla),
  `finalizarDesdeModal` (registro) y `saveTallerEntry` con estado `Finalizado` (que rellena `fsalidaReal` con hoy).
- **Autorización:** `Taller` permite `update` a `operativo` a nivel de modelo (sin restricción por campo,
  `resource.ts:~127`), así que los tres campos viajan con el guardado normal. No se toca `revocarLigaTaller`.
- Tras el guardado, `_bnRepintar`/`_provPintar` ya repintan el bloque: dirá **"Liga revocada"** con
  "Revocada por cierre:{correo} · fecha".

### 4.3 Anular revoca y el portal rechaza anuladas (decisión 3)

- **Monolito**, en el `onConfirm` de la anulación de Taller (~`:11245`): si la visita tiene liga activa
  (`window.__estadoLiga(e).kind === "activa"`), llama **primero** `window.__tallerLiga.revocar(unitUid, fechaEntrada)`
  y **después** `window.__anulaciones.anular(...)`. Si revocar falla, se aborta con aviso ("No se pudo revocar la
  liga; la visita no se anuló") — nunca se anula con una liga viva. Anular es `needs-admin`; admin puede revocar.
- **Portal**, `cargarVisitaVigente` (`handler.ts` ~`:531-549`): tras el chequeo de revocación y antes/después del de
  visita cerrada, consulta `Anulacion` por `refId = refIdTaller(tk.u, tk.f)` y la considera activa **si no tiene `restauradaTs`**
  (`esAnulacionActiva`, la misma regla de `buildAnuladasActivas`: las restauradas no excluyen) y lanza `ErrorLigaInvalida("visita anulada")`. El refId se
  compone con la función pura compartida (importable desde `src/anulacion/anulacion.ts`; si el empaquetado del Lambda
  no lo permite, se duplica en `validacion.ts` con una prueba de igualdad, patrón R68 de los topes).
- Al taller le llega el mismo aviso genérico que hoy para toda liga inválida ("Puede haber vencido o haber sido
  cancelada…"); el motivo real solo va a la bitácora del servidor, como ya ocurre.

### 4.4 La fecha de salida se borra (decisión 4)

- `batchUpload.ts`: `fechaSalida: e.fsalidaReal || null` (el campo es `a.date()` opcional: `null` explícito limpia la
  columna; `undefined` la deja como estaba — esa era la falla). `TallerInput.fechaSalida` pasa a `string | null`.
- `cloudHydrate.ts`: `fsalidaReal: String(datos.fsalidaReal ?? "")` — **sin** fallback a `t.fechaSalida`. La columna
  siempre se derivó de `datos.fsalidaReal`, así que cuando difieren la columna es la que está mal. `fentrada`
  conserva su fallback a `t.fechaEntrada` (es parte de la llave, siempre presente).

### 4.5 "Liga cerrada con la visita" (decisión 5) — `src/taller/seguimiento.ts`

`EstadoLiga` gana `{ kind: "cerrada"; emitidaEn: string; emitidaPor: string }`: cuando hay liga emitida, no revocada,
no vencida, **y la visita está cerrada** (`visitaCerrada(e)`, que ya existe en el módulo). `_provPintar` la pinta con la
pastilla gris y el texto "Liga cerrada con la visita"; `distintivoProveedor` la trata como `sin-liga` (igual que
vencida). Con la decisión 2 en vigor, este estado solo lo alcanzan las visitas cerradas ANTES de este frente.

### 4.6 Datos y permisos: nada nuevo

- Sin cambios en `amplify/data/resource.ts`. `Anulacion` ya existe; el portal ya tiene `allow.resource(tallerPortal)
  .to(["query","mutate"])` a nivel de esquema.
- Sin backfill. La revocación manual del incidente ya se hizo (`JB4479A|2026-09-14`, `ligaVersion 2`).

## 5. Errores y estados

| Situación | Comportamiento |
|---|---|
| Alta/edición con llave en uso (vigente) | No guarda; aviso con la fecha y "abre la existente"; foco en la fecha. |
| Alta con llave de una visita anulada | No guarda; aviso que ofrece cambiar la fecha o restaurar desde Anulados. |
| Cierre de visita con liga activa | Se cierra Y se revoca en el mismo guardado; el bloque dice "Liga revocada · por cierre". |
| Cierre sin liga o con liga ya revocada/vencida | Solo se cierra; nada más viaja. |
| Anular con liga activa; revocar falla | No se anula; aviso "No se pudo revocar la liga; la visita no se anuló. Intenta de nuevo." |
| El taller abre una liga de visita anulada | Portal: aviso genérico de liga inválida; bitácora: "visita anulada". |
| Quitar la fecha de salida a una visita cerrada | La columna se limpia; al recargar sigue sin salida. La liga NO revive (ya está revocada). |
| Visita cerrada antes de este frente, liga sin revocar | Bloque: "Liga cerrada con la visita"; el portal ya la rechazaba. |

## 6. Pruebas

- **Puras (vitest):** `llaveEnUso` (libre / vigente / anulada / la propia visita no choca / refId compuesto con
  `refIdTaller`); `revocacionPorCierre` (activa+cerrada → versión+1 y rastro `cierre:`; abierta → null; revocada →
  null; vencida → null; sin liga → null; `ligaVersion` ausente → 2); `estadoLiga` → `cerrada` (con fsalidaReal, con
  Finalizado, no cuando revocada, no cuando vencida) y `distintivoProveedor` con `cerrada`.
- **Contrato de subida:** `uploadTallerToCloud` manda `fechaSalida: null` cuando no hay salida; incluye los tres
  campos de revocación solo al cerrar con liga activa (mock de `upsertTaller`, patrón existente de las pruebas de
  `batchUpload`).
- **Hidratación:** una fila con `datos.fsalidaReal` ausente y columna `fechaSalida` presente hidrata `fsalidaReal = ""`.
- **Portal (arnés existente `tests/tallerPortalHandler.test.ts`):** token válido + tombstone activo → 401 con motivo
  "visita anulada" en bitácora; tombstone restaurado (`restauradaTs` presente) → sigue sirviendo.
- **Estructurales del monolito:** `saveTallerEntry` llama `__llaveEnUso` antes de `tallerEntries.push`; el `onConfirm`
  de anular llama `revocar` antes de `anular`; `_provPintar` conoce `"cerrada"`.
- **Guardias del repo:** `csp:sync` tras tocar el `<script>` inline; `audit:xss`; suite completa; e2e local (60/67).
- **Manual (Navares, antes de fusionar):** (1) registrar la 06 con fecha 14/09 → bloqueado con el aviso; (2) registrar
  con fecha de hoy → nace sin liga ni partidas; emitir liga; (3) dar salida → el bloque dice "Liga revocada · por
  cierre" y la liga en el celular ya no abre; (4) reabrir → sigue revocada; emitir nueva → abre vacía.
- **Revisión de seguridad** al cierre (portal + contrato de escritura), con esta nota explícita: **la autorización de
  `Taller` es por modelo — cualquier `operativo` puede escribir `ligaVersion` por la API y bajarla para revivir un
  token.** No lo introduce este frente; se registra como riesgo abierto para el frente #11 o una regla por campo.

## 7. Riesgos y mitigaciones

- **Doble criterio de "liga activa":** `revocacionPorCierre` reutiliza `estadoLiga` — una sola regla.
- **Guarda de cliente insuficiente:** documentada; la identidad sin fecha (#11) es el cierre real.
- **El portal consulta `Anulacion` en cada petición:** una lectura más por request, como ya hace con `AppConfig`.
- **Visitas cerradas históricas con liga "activa":** quedan como "cerrada" en pantalla; el portal ya las rechazaba.

## 8. Preguntas que quedaron cerradas

- ¿Abrir `revocarLigaTaller` a operativos? **No** (enfoque A).
- ¿Permitir dos ingresos el mismo día ya? **No**; se bloquea y se explica; la identidad se cambia en el #11.
- ¿Frentes separados pantalla/servidor? **No**; uno solo con revisión de seguridad.
- ¿Limpiar columnas del proveedor al crear encima? **No hace falta**: la guarda lo impide.
