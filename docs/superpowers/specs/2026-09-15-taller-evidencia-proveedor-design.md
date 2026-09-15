# Taller híbrido · Plan 2 · Bloque 2 — Reglas de evidencia del proveedor (cámara y mano de obra)

**Fecha:** 2026-09-15 · **Estado:** decisiones cerradas con Navares; spec para su revisión · **Rama:** `feat/taller-seguimiento-proveedor` (misma que el Bloque 1; se construye después de él)
**Antecedentes:** `2026-09-04-taller-esquema-hibrido-proveedor-design.md` (Plan 1) · `2026-09-15-taller-seguimiento-proveedor-design.md` (Bloque 1: seguimiento desde el registro).
**Origen:** tras aprobar el Bloque 1, Navares pidió: (1) que el taller solo pueda **tomar** fotos desde la liga, no elegirlas de la galería; (2) que las partidas de **mano de obra** puedan subirse sin evidencia, con controles para que "mano de obra" no se vuelva la puerta trasera; (3) otras ideas.

## 1. Decisiones (cerradas 2026-09-15)

| # | Decisión | Nota |
|---|---|---|
| 1 | **Cámara dentro de la liga como único camino normal para fotos**; cada foto guarda su **origen** ("cámara de la liga" o "archivo") y Riesgos lo ve. | Honestidad técnica: una página web no puede prohibir al 100 % que el sistema del celular ofrezca la galería; se elimina la opción del camino normal y se etiqueta la excepción. |
| 2 | **Refacción exige al menos una foto.** El servidor lo aplica. | Hoy no hay mínimo (solo el máximo de 6). |
| 3 | **Mano de obra no exige foto**, pero exige **concepto de un catálogo cerrado** + descripción libre de mínimo 15 caracteres. | Catálogo inicial: diagnóstico · desmontaje y montaje · ajuste o calibración · reparación · instalación · servicio. Editable por código. |
| 4 | **Sin tope de precio** para mano de obra sin foto. | El control es la etiqueta "Sin evidencia" (decisión 6) y la firma de Riesgos. |
| 5 | **Ligar la mano de obra a una refacción de la misma visita es opcional**; si va sola y el concepto no es diagnóstico ni servicio, se **resalta**. | "Mano de obra de: cambio de balatas". |
| 6 | Riesgos ve la etiqueta **"Sin evidencia"** en cada partida de mano de obra sin foto ni refacción ligada, en el registro y en la bandeja de entrada. | La decisión sigue siendo humana, pero informada. |

**Regla que gobierna el bloque:** _la evidencia es del taller y las reglas son del servidor._ Nada de esto depende de que la pantalla del taller se porte bien: el portal rechaza lo que no cumple.

## 2. Alcance

**Entra:**
- Página de la liga (`amplify/functions/taller-portal/pagina.ts`): cámara en vivo dentro de la página (captura → JPEG → misma subida firmada de hoy), sin selector de galería; respaldo al selector con `capture` solo cuando la cámara no está disponible; selector de **concepto** para mano de obra; campo opcional "mano de obra de" (lista de refacciones ya capturadas en la visita).
- Portal (`handler.ts` + `validacion.ts`): reglas de evidencia por tipo; validación del concepto y de la refacción ligada; origen por foto.
- Esquema `TallerPartida`: tres campos nuevos, todos opcionales (aditivo, sin migración).
- Lado de Riesgos (monolito, Bloque 1 ya construido): etiqueta "Sin evidencia" en la lista del registro y en la bandeja de entrada; origen de cada foto en el visor; concepto de mano de obra visible.
- Excel/PDF (Bloque 1): columnas "Concepto MO", "Ligada a", "Evidencia" (n fotos / sin evidencia) y "Origen fotos".

**No entra (candidatos a Bloque 3, sin decidir):** foto del odómetro obligatoria al ingreso · cierre "lista para entrega" con kilometraje de recepción confirmado por Riesgos · recotización tras rechazo por precio · antes/después por partida · detección automática de fotos repetidas.

## 3. Datos

### 3.1 `TallerPartida` — campos nuevos (todos opcionales)

| Campo | Tipo | Quién lo escribe | Significado |
|---|---|---|---|
| `conceptoMO` | `enum` `diagnostico \| desmontajeMontaje \| ajusteCalibracion \| reparacion \| instalacion \| servicio` | portal (y captura manual de GPA) | Obligatorio cuando `tipo === "manoObra"`; prohibido cuando `tipo === "refaccion"`. |
| `refaccionRef` | `string` (`partidaId`) | portal | Opcional. Debe apuntar a una partida **de la misma visita** con `tipo === "refaccion"` y no cancelada. |
| `fotosOrigen` | `string[]` alineado con `fotos` (`"camara" \| "archivo"`) | portal | Declarado por la página al subir cada foto (ver §4.3); el servidor lo persiste tal cual y lo etiqueta como declaración, no como prueba. |

Las 5 partidas que ya existen en producción no tienen estos campos: se muestran como "sin dato" (no como "sin evidencia"). No hay backfill.

### 3.2 Catálogo compartido

`CONCEPTOS_MO` vive en `src/taller/evidencia.ts` (frontend) y en `amplify/functions/taller-portal/validacion.ts` (portal), con un test que compara ambas listas (mismo patrón que la vigencia de la liga). Etiquetas en español: Diagnóstico · Desmontaje y montaje · Ajuste o calibración · Reparación · Instalación · Servicio.

## 4. Reglas del servidor (`validacion.ts`, puras y probadas)

```ts
export type Evidencia = { tipo: PartidaTipo; fotos: readonly string[]; conceptoMO?: string; descripcion: string; refaccionRef?: string };

export function validarEvidencia(e: Evidencia): { ok: true } | { ok: false; motivo: string };
```
- `refaccion`: `fotos.length ≥ 1`, si no → "Una refacción necesita al menos una foto". `conceptoMO` debe venir vacío.
- `manoObra`: `conceptoMO ∈ CONCEPTOS_MO`, si no → "Elige el tipo de mano de obra"; `descripcion.trim().length ≥ 15`, si no → "Describe el trabajo (mínimo 15 caracteres)"; fotos opcionales (0–6).
- Ambos: los límites actuales siguen (máximo 6 fotos, 10 MB, JPEG/PNG/WebP, descripción ≤ 500, precio finito ≤ tope).

```ts
export function sinEvidencia(p: { tipo; fotos; conceptoMO?; refaccionRef? }): boolean;
```
- `true` solo si `tipo === "manoObra"` y `fotos.length === 0` y no hay `refaccionRef` y `conceptoMO ∉ {diagnostico, servicio}`. Es la misma función que usa la app de Riesgos para la etiqueta (duplicada con test de igualdad, como el catálogo).

En `crearPartida` (`handler.ts`): se llama `validarEvidencia`; si hay `refaccionRef`, se lee la partida referida (`TallerPartida.get` con la misma `visitaKey`) y se exige `tipo === "refaccion"` y `estado !== "cancelada"`; `fotosOrigen` se recorta al largo de `fotos` y se normaliza a `camara`/`archivo` (cualquier otro valor → `archivo`). Bitácora: acción `crear-partida` incluye `tipo`, `conceptoMO`, `nFotos`, `origen`.

### 4.1 Página de la liga — cámara

- Al tocar "Tomar foto" la página abre la cámara trasera con `navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })`, muestra la vista en vivo en un `<video>`, y al capturar dibuja el cuadro en un `<canvas>` (lado mayor ≤ 1600 px, JPEG calidad 0.85) y obtiene el `Blob` que sigue el **mismo camino de subida firmada** que hoy. La foto se marca `origen: "camara"`.
- Si `getUserMedia` no existe o el usuario niega el permiso, la página cae al `<input type="file" accept="image/*" capture="environment">` que ya existe, con el texto "Toma la foto con la cámara", y marca `origen: "archivo"` (el sistema pudo ofrecer galería).
- Se elimina cualquier otro selector de archivo. No hay botón de "elegir de la galería".
- CSP del portal: se añade `media-src 'self' blob:` para la vista en vivo. Sin otros cambios de cabeceras.
- Restricción vigente: el script sigue siendo **ES5** (sin `=>`, `const`, `??`, plantillas); promesas sí (el test de conformidad ES5 lo vigila).
- Cada foto se sube al terminar la captura (como hoy), con su `origen` en el cuerpo del `POST /api/partida` alineado por posición.

### 4.2 Página de la liga — mano de obra

- Al elegir tipo "Mano de obra": aparece el selector **Tipo de trabajo** (catálogo) y, debajo, **"Mano de obra de"** con las refacciones ya capturadas en esta visita (descripción · precio); opción "Ninguna". La descripción muestra el mínimo de 15 caracteres y no deja enviar antes.
- Al elegir "Refacción": la partida no se puede proponer sin al menos una foto; el botón lo dice ("Toma al menos una foto").
- Los mensajes de error del servidor (§4) se muestran tal cual.

## 5. Lado de Riesgos

- **Lista de partidas del registro y bandeja de entrada (Bloque 1):** las partidas de mano de obra muestran su concepto ("Mano de obra · Reparación") y, si aplica, "de: cambio de balatas". Las que cumplen `sinEvidencia()` llevan la etiqueta **"Sin evidencia"** (ámbar, `--Al`/`--tl-warn-fg`) junto al estado; en la bandeja de entrada la fila dice "N partidas · $monto · 1 sin evidencia".
- **Visor de fotos:** el pie de cada foto dice "Tomada desde la liga" o "Cargada como archivo" según `fotosOrigen`; "Origen sin dato" para partidas anteriores a este bloque.
- **Captura manual de partidas por GPA** (T12 del Plan 1): también pide concepto cuando el tipo es mano de obra, para que el dato sea uniforme; no exige foto (es Riesgos capturando).
- La prioridad del distintivo de la tabla **no cambia**.

## 6. Permisos, apagador y seguridad

- Las reglas viven en el servidor y aplican con el apagador encendido o apagado (con apagado el portal rechaza todo antes).
- `fotosOrigen` es una **declaración del cliente**: se persiste y se muestra, nunca se usa para autorizar nada.
- La cámara no añade superficie: mismo `PUT` prefirmado, mismos límites de tamaño y tipo, misma llave acotada al prefijo de la visita (A-5, A-8 del cierre del Plan 1 siguen vigentes).
- El harness del portal (R83) cubre las reglas nuevas ejecutando el handler.

## 7. Errores y estados

| Situación | Comportamiento |
|---|---|
| Refacción sin foto | Portal 400 "Una refacción necesita al menos una foto"; la página lo impide antes. |
| Mano de obra sin concepto o descripción corta | Portal 400 con el mensaje del catálogo / del mínimo; la página lo impide antes. |
| `refaccionRef` inexistente, de otra visita, cancelada o de tipo mano de obra | Portal 400 "La refacción ligada no existe en esta visita". |
| Cámara no disponible o permiso negado | La página cae al selector con `capture`; la foto se marca "archivo". |
| Partida anterior a este bloque | Sin concepto ni origen: "sin dato"; **no** se etiqueta "Sin evidencia". |

## 8. Pruebas

- **Puras (`validacion.ts` y `src/taller/evidencia.ts`):** tabla completa de `validarEvidencia` (refacción con 0/1/6/7 fotos; MO con cada concepto, concepto inválido, descripción de 14 y 15 caracteres); `sinEvidencia` (los seis conceptos × con/sin foto × con/sin ref); igualdad de catálogos frontend/portal.
- **Harness del portal (ejecuta `handler`):** refacción sin fotos ⇒ 400; MO válida sin fotos ⇒ 200 y fila con `conceptoMO`; `refaccionRef` de otra visita ⇒ 400; `fotosOrigen` desalineado ⇒ recortado/normalizado; bitácora con `tipo` y `origen`.
- **Página (`tallerPortalPagina.test.ts`):** existe el flujo de cámara (`getUserMedia`, `<video>`, `<canvas>`), no existe ningún `type="file"` sin `capture`, el selector de concepto y el de refacción existen, conformidad ES5 intacta, `media-src` en la CSP.
- **App (estructurales):** etiqueta "Sin evidencia" solo bajo `sinEvidencia()`; pie del visor con el origen; Excel con las columnas nuevas.
- **Manual (Navares/taller):** desde un celular, capturar una refacción (obliga foto con cámara, sin galería), una mano de obra ligada y una sola; ver en el registro las etiquetas y en el visor el origen.

## 9. Plan de construcción

Después del Bloque 1 (T1, T2), en la misma rama:
- **T3 — Servidor:** esquema (3 campos opcionales), `validacion.ts` (reglas + catálogo + `sinEvidencia`), `handler.ts` (crearPartida, bitácora, CSP `media-src`), harness.
- **T4 — Página de la liga:** cámara in-app con respaldo, selector de concepto, "mano de obra de", mensajes; conformidad ES5.
- **T5 — Lado de Riesgos:** etiquetas, concepto en la lista, origen en el visor, captura manual con concepto, columnas de exports.

T3 y T4 tocan el portal público: revisión OPUS obligatoria (seguridad). Despliegue: cambio de esquema **aditivo** (campos opcionales), sin pasos de runbook nuevos.

## 10. Riesgos

- **La cámara in-app en navegadores viejos de Android:** si `getUserMedia` falla, el respaldo con `capture` mantiene el flujo; el origen "archivo" lo delata. Probar en el teléfono real del taller antes de fusionar.
- **Fotos más pesadas o más lentas de subir** por venir de la cámara a resolución completa: se reescalan en el celular a 1600 px antes de subir (hoy se sube el archivo tal cual hasta 10 MB).
- **El catálogo se queda corto:** es una constante; agregar un concepto son dos líneas y un test.
- **"Diagnóstico" como comodín** para evitar evidencia: no se marca como "Sin evidencia" por decisión 5. Si en el piloto se abusa, se quita de la excepción (una línea).
