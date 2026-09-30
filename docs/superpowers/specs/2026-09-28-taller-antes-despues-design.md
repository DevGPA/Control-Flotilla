# Taller híbrido · Antes y después por hallazgo

**Fecha:** 2026-09-28 · **Estado:** construido, revisado (seguridad + revisión final) y con el visto bueno de Navares en local (2026-09-30); PR pendiente · **Rama:** `feat/taller-antes-despues` (sale de `feat/taller-liga-cierre`)
**Antecedentes:** `2026-09-04-taller-esquema-hibrido-proveedor-design.md` (Plan 1) · `2026-09-15-taller-seguimiento-proveedor-design.md` (Bloque 1) · `2026-09-15-taller-evidencia-proveedor-design.md` (Bloque 2, donde este tema quedó como "candidato a Bloque 3") · `2026-09-22-taller-liga-cierre-y-llave-design.md` (la liga muere con la visita).
**Maqueta aprobada:** `.superpowers/brainstorm/3514-1790630708/content/antes-despues.html` y `antes-despues-v2.html` (locales, ignorados por git).

## En corto

Hoy el taller sube cada hallazgo con fotos de cómo está la pieza ("antes"). Con este cambio, cuando Riesgos autoriza un hallazgo, el taller entra a ese mismo hallazgo desde la liga y sube la foto del trabajo hecho ("después"). El hallazgo queda **Terminado** y ya no se puede cambiar. En Fleet, Riesgos ve las fotos del antes y del después lado a lado. Si al dar salida falta la foto del después de alguna refacción, Fleet avisa pero deja salir.

Ejemplo: "Balatas delanteras desgastadas" → foto de la balata de 2 mm al ingresar → Riesgos autoriza $1,850 → el taller cambia las balatas y sube la foto de las nuevas → Fleet muestra ambas fotos juntas.

No hay que crear campos nuevos en la base de datos: el esquema ya tiene reservados `evidenciaFinal`, el estado `terminada` y `terminadoEn` desde el Plan 1, y nadie los usa todavía.

## 1. Decisiones (cerradas 2026-09-28)

| #   | Decisión                                                                                                                                                                                                               | Nota                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | El "después" vive **dentro del mismo hallazgo** (`TallerPartida.evidenciaFinal`), no en un hallazgo nuevo ni revuelto con las fotos del antes.                                                                         | Descartadas: meterlo en `fotos` con una marca (se revuelven) y un hallazgo nuevo de "reparación" (duplica montos y firmas).                                                   |
| 2   | Solo un hallazgo **autorizado** acepta el después, y lo sube **el taller desde la liga**.                                                                                                                              | Riesgos no lo sube desde Fleet en este frente.                                                                                                                                |
| 3   | **Refacción exige al menos una foto** del después; **mano de obra puede terminarse sin foto** (opcional). Máximo 6 fotos, igual que el antes.                                                                          | Mismo criterio que la decisión 3 del Bloque 2 para el antes.                                                                                                                  |
| 4   | Al enviarlo, el hallazgo pasa a **`terminada`** (con `terminadoEn` puesto por el servidor) y **queda congelado**: ni el taller ni la liga pueden cambiar sus fotos después.                                            | La evidencia no se reescribe, igual que una firma. Si el taller se equivoca, se resuelve fuera de este frente (ver §9).                                                       |
| 5   | **Nadie vuelve a aprobar** el después: Riesgos lo ve.                                                                                                                                                                  | La firma sigue siendo una sola, la del precio.                                                                                                                                |
| 6   | Al dar salida con **refacciones autorizadas sin foto del después**: **aviso, no bloquea**.                                                                                                                             | Se suma al aviso que ya existe para partidas sin firmar (C-I5). Al salir, la liga muere y el taller ya no puede subirla.                                                      |
| 7   | En Fleet, el visor muestra **A+**: antes y después **lado a lado**, cada lado con su tira de miniaturas (ninguna foto escondida) y un botón de **pantalla completa**.                                                  | Elegida sobre "lado a lado simple" (fotos chicas, se esconden las extra) y el deslizador (las fotos del taller casi nunca coinciden en ángulo y solo compara una contra una). |
| 8   | **El dinero no cambia.** `precioAutorizado` sigue siendo el monto; terminar no toca montos ni totales.                                                                                                                 | `totalesVisita` ya suma `autorizada` + `terminada` como autorizado.                                                                                                           |
| 9   | **Orden:** la rama sale de `feat/taller-liga-cierre` y se despliega **después** de ella. El Bloque 2 va después de este frente.                                                                                        | La liga-cierre toca la misma pantalla y aporta el candado "visita cerrada o anulada ⇒ la liga no acepta nada".                                                                |
| 10  | Mientras no exista el Bloque 2, el después se toma con **el mismo selector de hoy** (`capture="environment"`). Cuando llegue el Bloque 2, su cámara obligatoria y el "origen" por foto aplican **también** al después. | Anotarlo en el plan del Bloque 2.                                                                                                                                             |
| 11  | **Navares lo ve funcionando en local antes de producción.** Es condición para abrir el PR.                                                                                                                             | Regla suya para todo cambio (2026-09-28). Cómo se arma la vista local: §8.1.                                                                                                  |

**Regla que gobierna el frente:** _la evidencia es del taller y las reglas son del servidor_ (heredada del Bloque 2). La pantalla del taller solo es cortesía: el portal rechaza lo que no cumple.

## 2. Alcance

**Entra:**

- Portal (`amplify/functions/taller-portal/`): ruta nueva `POST /api/terminar`, validación pura nueva en `validacion.ts`, proyección de `evidenciaFinal` y `terminadoEn` al taller.
- Página de la liga (`pagina.ts`): botón del después en hallazgos autorizados, panel de captura, par Antes | Después en hallazgos terminados.
- Fleet: `evidenciaFinal` en el tipo `Partida` y su mapeo; función pura `refaccionesSinDespues`; aviso al finalizar; distintivos en la lista del registro; visor en modo A+; dos columnas en la hoja "Partidas" del Excel.

**No entra:**

- Que Riesgos suba o cambie el después desde Fleet.
- Reemplazar fotos o "reabrir" un hallazgo terminado.
- Emparejar fotos una a una (foto 1 del antes ↔ foto 1 del después) y el deslizador.
- El PDF del expediente (frente propio).
- Avisos por correo o notificación cuando el taller termina un hallazgo.
- Cámara obligatoria y origen de la foto (Bloque 2).

## 3. Datos

**Sin cambios de esquema.** Se usan campos que ya existen en `TallerPartida` (`amplify/data/resource.ts`):

- `evidenciaFinal: string[]`: llaves de S3 de las fotos del después.
- `estado: "terminada"`: estado final; `partidas.ts` ya lo trata como no editable.
- `terminadoEn: string`: fecha ISO, la pone el servidor.

**Llaves de S3:** las fotos del después usan exactamente la misma forma que las del antes (`llaveFoto(tenant, visitaKey, uuid, mime)`, prefijo de la visita). Por eso `llaveFotoValida`, la ruta `GET /api/foto` del taller y `__urlFotoPartida` de Fleet sirven **sin cambios**, con el mismo permiso de Storage de hoy.

**Lo que viaja al taller** (`leerVisita`): a cada partida se le agregan `evidenciaFinal` (arreglo, `[]` si no hay) y `terminadoEn` (o `null`). Nada más: la lista blanca de campos proyectados se conserva.

**Lo que viaja a Fleet** (`rowToPartida` en `src/api/tallerPartidas.ts`): agregar `evidenciaFinal` (filtrado a strings, igual que `fotos`). El tipo `Partida` (`src/taller/partidas.ts`) gana `evidenciaFinal?: string[]`.

## 4. Portal (servidor)

### 4.1 `POST /api/terminar`

Cuerpo: `{ partidaId: string, fotos: string[] }`.

1. Cruza **el mismo portón** que todas las rutas (`cargarVisitaVigente`): apagador encendido, token válido, liga no revocada, y visita no cerrada ni anulada (candado que aporta la liga-cierre).
2. `parseBody`: un cuerpo que no es objeto JSON ⇒ 400 (R101).
3. Busca la partida **dentro de** `listarPartidasDeVisita(tk.t, visitaKey)` por `partidaId` (un `partidaId` ausente o vacío deja la partida en `undefined`). Nunca por id suelto: una partida de otra visita simplemente no existe para esta liga.
4. `decidirTerminacion(tk.t, visitaKey, partida, body.fotos, ahoraIso)` (pura, `validacion.ts`; ver 4.2). Devuelve los cambios exactos a escribir, o `null` si es un reintento idéntico sobre una partida ya terminada; lanza `ErrorEntrada` (⇒ 400) o `ErrorConflicto` (⇒ 409).
5. Con cambios: escribe con `TallerPartida.update` exactamente lo que devolvió: `estado: "terminada"`, `evidenciaFinal: llaves`, `terminadoEn: ahora` (hora del servidor; lo que mande el cliente se ignora), `version: version + 1` (una fila sin `version` cuenta como 1).
6. `bitacora("terminar-partida", tk, { ...rastro, partidaId, fotos: llaves.length })`, **después** de escribir (patrón de `enviarAAutorizacion`). Con `null` no se escribe nada y la bitácora dice `terminar-partida-reintento`.
7. Responde un **acuse proyectado**: `{ partidaId, estado: "terminada", evidenciaFinal, terminadoEn }`; en el reintento, el mismo acuse a partir de `proyectarPartidaParaTaller` de la fila. Nunca la fila cruda (patrón A-1 / §2.3.3).

### 4.2 `decidirTerminacion` (pura)

`decidirTerminacion(tenantId, visitaKey, partida, fotos, ahoraIso): CambiosTerminacion | null`. No escribe nada: devuelve **los cambios exactos** (`{ estado: "terminada", evidenciaFinal, terminadoEn: ahoraIso, version: version + 1 }`), devuelve `null` cuando no hay que escribir, o lanza. (construido: el spec la llamaba `validarTerminacion` y solo lanzaba; la función construida también decide qué se escribe, para que el handler no repita la regla.)

Lanza `ErrorEntrada` (⇒ 400 con mensaje legible), en este orden, cuando:

| Caso                                                                         | Mensaje                                                          |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| La partida no está en esta visita (o no vino `partidaId`)                    | "Este hallazgo no existe en esta visita"                         |
| `fotos` viene y no es un arreglo                                             | "fotos no válidas"                                               |
| Más de `TOPE_FOTOS_PARTIDA` fotos                                            | "Máximo 6 fotos por hallazgo"                                    |
| Una llave repetida en el mismo envío                                         | "fotos repetidas"                                                |
| Alguna llave no pasa `llaveFotoValida`                                       | "llave de foto no válida"                                        |
| `estado` es `borrador` o `propuesta` (o viene vacío: cuenta como `borrador`) | "Este hallazgo todavía no está autorizado"                       |
| `estado` es `rechazada`, `cancelada` o cualquier valor desconocido           | "Este hallazgo no fue autorizado"                                |
| `tipo` no es `manoObra` y no trae fotos                                      | "Una refacción necesita al menos una foto del trabajo terminado" |

Las llaves se revisan **antes** que el estado (una terminada con llaves malas también da 400, no 409), y el bloque "ya terminada" de abajo se evalúa justo después de las llaves, antes de las filas de estado.

**Ya terminada (`estado === "terminada"`):**

- Si las llaves recibidas son **las mismas** que ya tiene `evidenciaFinal` (mismo conjunto, sin importar el orden) ⇒ devuelve `null`: 200 con el mismo acuse, sin escribir (es un reintento de red: el taller tiene mala señal).
- Si son **distintas** ⇒ lanza `ErrorConflicto` ⇒ 409 "Este hallazgo ya se marcó como terminado y no se puede cambiar" (decisión 4).

Mano de obra con `fotos: []` (o sin `fotos`) es válida (decisión 3). Una partida sin `tipo` (fila vieja) se trata como `refaccion`, que es el caso estricto.

### 4.3 Carrera con Riesgos

La ruta lee, valida y escribe, igual que `enviarAAutorizacion`. La ventana entre leer y escribir es de milisegundos. Hoy, desde Fleet, nada saca a una partida de `autorizada`: la regla pura `puedeCancelar` permitiría a Riesgos cancelarla, pero **no tiene ningún caller** en la app. **Confirmado en la revisión final (construido):** la firma (`__guardarDecisionPartida` / `camposDeDecision`) tampoco re-decide una partida ya autorizada; ningún caller de la app saca una partida de `autorizada`. Si alguna de las dos cosas cambia, la escritura usa `version` como condición; mientras tanto, el riesgo queda documentado como aceptado.

## 5. Página de la liga (`pagina.ts`)

En `pintarPartidas`, según el estado de cada hallazgo:

- **`autorizada` · refacción:** botón primario "📷 Subir foto del trabajo terminado". Abre un panel dentro del hallazgo con "📷 Tomar foto" (mismo `input capture="environment"` y mismo flujo `subirFotos` → `POST /api/subida` → PUT firmado de hoy), miniaturas y el botón "Marcar como terminado", deshabilitado hasta tener una foto. Texto de la regla: "Una refacción necesita al menos una foto de la pieza nueva."
- **`autorizada` · mano de obra:** botón "✓ Marcar como terminado" y el enlace "+ Agregar foto (opcional)", que abre el mismo panel.
- **`terminada`:** el par de miniaturas **ANTES | DESPUÉS** (vía `GET /api/foto`) y la leyenda "Este hallazgo ya no se puede cambiar."
- **`propuesta`:** "El botón del después aparece cuando GPA lo autorice."
- `borrador` y `rechazada`: sin cambios.

**Mala señal:** las fotos se suben primero y la llamada a `/api/terminar` va al final, igual que el alta de hallazgos (bloque cercano a `subirFotos`). Si `/api/terminar` falla por red, el panel conserva las fotos ya subidas y el botón se puede volver a tocar. El 200 idempotente de 4.2 hace seguro ese reintento.

**Reglas del repo que aplican:** sin `innerHTML` con datos (`createElement` + `textContent`). La CSP de la liga (`CSP_PORTAL`) permite su script en línea sin hash, así que **no hay `csp:sync` del portal**.

## 6. Fleet

### 6.1 Capa pura (`src/taller/partidas.ts`)

- `refaccionesSinDespues(ps: Partida[]): Partida[]` devuelve las partidas `autorizada` cuyo `tipo` no es `manoObra` (refacción o sin tipo). Una `terminada` nunca cuenta, y la mano de obra autorizada tampoco (decisión 3).
- `avisoSinDespues(ps: Partida[]): string` arma el **texto** del aviso de §6.2 a partir de `refaccionesSinDespues`; `""` cuando no falta ninguna foto. El monolito solo lo pinta.
- Puente `window.__avisoSinDespues = avisoSinDespues`, publicado desde `src/api/cloudWire.ts` (junto a `__resumenPartidas`), que corre siempre, también con `?e2e=1`; su tipo vive en la declaración de `Window` de `cloudHydrate.ts`. (construido: el spec pedía `__refaccionesSinDespues` desde `cloudHydrate`; se publica el texto ya armado para que el monolito no repita la regla ni el formato del monto.)
- Puente `window.__abrirVisorAntesDespues` (también en `cloudWire.ts`), que inyecta la misma `urlFoto` firmada que usa `__abrirVisorFotos`.

### 6.2 Aviso al finalizar (monolito, `finalizarUnidad`)

`finalizarUnidad` ya arma `avisoPartidas` (C-I5) y lo muestra en el `confirm`. Se le suma el renglón de `_avisoSinDespues(e)`, que le pregunta a `window.__avisoSinDespues` con las partidas de la visita (sin puente, no avisa). Texto construido:

> ⚠ 1 refacción autorizada no tiene foto del después: Balatas delanteras desgastadas ($1,850.00).
> Si la finalizas, la liga del taller se cierra y ya no podrá subirla.

Con más de una: "⚠ N refacciones autorizadas no tienen foto del después: …". La línea lista descripciones con su monto autorizado (`$1,850.00`, dos decimales, `es-MX`) cuando son 3 o menos; si son más, solo da el número. Se puede finalizar igual (decisión 6). Este es el camino de "✓ Finalizar" en la tabla y en el modal (`finalizarDesdeModal` cierra el modal y llama a `finalizarUnidad`).

**Guardar el modal con "Fecha real de salida" también cierra la visita** (`batchUpload.ts` deriva el estatus `cerrado` de `fsalidaReal`, y con ello la liga muere por la liga-cierre). Por eso `saveTallerEntry` da el mismo aviso en un `confirm` propio ("…¿Guardar la salida de todos modos?"), **solo cuando la visita se cierra en ese guardado**: `cierraAhora = srcEntry existe && !srcEntry.fsalidaReal && !!entry.fsalidaReal`. Solo mira `fsalidaReal`: una visita que ya estaba cerrada y se vuelve a guardar no pregunta otra vez; una visita legada en `Finalizado` sin fecha real preguntaría una vez al ponerle la fecha (aceptado). Cancelar ese `confirm` no guarda nada.

### 6.3 Lista del registro (`_provFilaHistorial` / `_provPartidas`)

- Refacción `autorizada` sin después (`estado === "autorizada" && tipo !== "manoObra"`): chip ámbar `tl-pill diag` con el texto **"Sin foto del después"**, en la primera línea de la fila junto a la pastilla del estado (construido: `diag`, el mismo ámbar de "esperando firma" — es un pendiente, no un rechazo; `pendiente` es rojo).
- `terminada`: ya muestra "TERMINADA · terminada el …"; si tiene alguna foto (antes o después) se agrega el botón **"🖼 Antes y después"**, que llama a `window.__abrirVisorAntesDespues` con `{ antes: { llaves: p.fotos, fecha: p.creadoEn }, despues: { llaves: p.evidenciaFinal, fecha: p.terminadoEn }, titulo: descripción, subtitulo: "Refacción · $1,650.00 · terminada el …" }`. Sin puente, el botón no hace nada.

### 6.4 Visor A+ (`src/taller/visorFotos.ts`)

(construido: en vez de darle a `abrirVisorFotos` un modo `grupos`, hay una función hermana en el mismo archivo; el visor simple queda intacto para quienes lo llaman hoy y solo gana un callback opcional.)

```ts
abrirVisorAntesDespues({
  antes: { llaves: p.fotos, fecha: p.creadoEn }, // GrupoFotos
  despues: { llaves: p.evidenciaFinal, fecha: p.terminadoEn },
  titulo,
  subtitulo,
  url,
});
```

- Overlay propio `#taller-visor-antes-despues` (`role="dialog"`, "Antes y después del hallazgo"), con la misma trampa de foco, Esc, clic en el fondo y regla de "un solo visor vivo" del visor simple: abrir uno cierra el otro. Si los dos grupos vienen vacíos, no abre nada.
- Los dos grupos van lado a lado (`grid 1fr 1fr`), cada uno con su foto grande, la leyenda "ANTES · 14 sep · 2 fotos" / "DESPUÉS · 16 sep · 1 foto" (`fechaCorta`, exportada: una fecha sola `YYYY-MM-DD` se lee tal cual; un instante ISO usa el día local) y su tira de miniaturas cuando hay más de una foto. Una miniatura cambia solo la foto de su lado (`img[data-lado]`, `button[data-miniatura]` con `aria-pressed`).
- Cada lado con fotos lleva el botón **"⛶ Pantalla completa"** (`aria-label` "Ver antes|después en pantalla completa"): abre el visor simple existente (`abrirVisorFotos`, con `inicial` en la foto que se ve y el nuevo `alCerrar?: (i: number) => void`) con subtítulo "Antes · 14 sep". Cuando el usuario lo cierra (✕, Esc o fondo), `alCerrar` vuelve a montar el A+ con el mismo estado — la foto en la que quedó ese lado y la del otro — y el foco en ese mismo botón. `alCerrar` no se llama cuando otro visor lo reemplaza.
- Si un grupo viene vacío (mano de obra sin foto), ese lado dice "Sin foto" y no lleva tira ni botón de pantalla completa.
- Las llamadas actuales a `abrirVisorFotos` con `llaves` siguen funcionando igual.
- Sin `innerHTML`. Las URLs son firmadas y se piden por demanda con la misma función `url`; las respuestas que llegan tarde se descartan por generación.

### 6.5 Excel (`src/taller/exportExcel.ts`)

`COLUMNAS_PARTIDAS` gana dos columnas al final: **"Fotos después"** (número; vacío si la partida no está terminada) y **"Terminado el"** (fecha local, patrón `utcWallClock` de los exports). Aplica a los dos Excel que ya usan la hoja "Partidas".

### 6.6 CSP del monolito

Los cambios de 6.2 y 6.3 viven en scripts en línea de `Control de flotilla.html` ⇒ `npm run csp:sync` y re-stagear el HTML y `nginx.conf` (trampa #1). Correr `audit:csp` otra vez sobre el commit ya hecho, porque el hook reformatea.

## 7. Seguridad

Es una **ruta nueva en el portal público** ⇒ revisión de seguridad obligatoria antes del merge (trampa #5 de `CLAUDE.md`; mismo criterio que el Bloque 2). Propiedades que el arnés (`tests/tallerPortalHarness.test.ts`) debe **ejecutar**, no solo afirmar:

1. No se puede terminar una partida de **otra visita** (mismo tenant, otra `visitaKey`) ni de otro tenant.
2. No se puede terminar una partida `borrador`, `propuesta`, `rechazada` ni `cancelada`.
3. Refacción sin fotos ⇒ 400.
4. Llave de otra visita o con forma inválida ⇒ 400.
5. Más de 6 fotos ⇒ 400.
6. Liga revocada, visita cerrada o visita anulada ⇒ rechazo del portón.
7. Apagador apagado ⇒ rechazo.
8. Una `terminada` no se reescribe con llaves distintas (409), y el reintento idéntico no escribe.
9. El acuse no trae campos fuera de la lista (sin `creadoPor`, `decididoPor`, `motivoRechazoNota` ni correos).
10. Cuerpo que no es objeto JSON ⇒ 400.
11. La forma del evento es la **real** de Amplify Gen 2 (`fieldName` en la raíz; lección R102).

**Postura aceptada (revisión de seguridad, construido):** la foto del después puede ser **cualquier llave bien formada del prefijo de esta visita** (`llaveFotoValida`), incluso una llave ya usada en el antes o una que nunca se subió: el portal no hace `HeadObject` contra S3. Es exactamente la misma postura que ya tiene `POST /api/partida` para el antes; se acepta y queda documentada. Una llave inexistente solo produce "Foto no disponible" en los visores.

**Cómo las ejecuta el arnés** (`describe("P18 — POST /api/terminar…")`, más los recorridos de `RUTAS_PUBLICAS`, donde `POST /api/terminar` ya está inscrito):

| #   | Prueba(s)                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | "una partida de OTRA visita no existe para esta liga — aunque la consulta dejara de acotar" · "una partida de OTRO tenant, con la misma visita y el mismo id, tampoco existe"                                |
| 2   | `it.each` "partida borrador \| propuesta \| rechazada \| cancelada ⇒ 400 y nada se escribe"                                                                                                                  |
| 3   | "refacción sin foto ⇒ 400 con el mensaje del spec y NADA se escribe"                                                                                                                                         |
| 4   | `it.each` "llave de otra visita \| de otro tenant \| de inspecciones \| con travesía (..) ⇒ 400 y nada se escribe"                                                                                           |
| 5   | "más de 6 fotos ⇒ 400"                                                                                                                                                                                       |
| 6   | "visita cerrada ⇒ 401 opaco y nada se escribe (el portón va primero)" en P18; revocada (P4 por versión, P4b por rastro), cerrada (P5) y anulada (P5b) recorren todas las rutas JSON de `RUTAS_PUBLICAS`      |
| 7   | P6 "apagado ⇒ 401 opaco en las N rutas públicas" (recorre `RUTAS_PUBLICAS`)                                                                                                                                  |
| 8   | "reintento idéntico (la respuesta se perdió por mala señal) ⇒ 200 con el mismo acuse y CERO escrituras" · "cambiar el después de una terminada ⇒ 409 y cero escrituras"                                      |
| 9   | "el acuse no trae nada interno aunque la fila lo tenga" (llaves exactas `estado, evidenciaFinal, partidaId, terminadoEn`)                                                                                    |
| 10  | `it.each` "cuerpo que no es objeto (null \| [] \| 5 \| "texto" \| true) ⇒ 400 y nada se escribe"                                                                                                             |
| 11  | "un evento con un fieldName desconocido no alcanza /api/terminar: cae al perímetro y sin liga da 401" (payload con `fieldName` en la raíz); la forma real del resolver la cubren las regresiones R102 de P17 |

Sin número pero también ejecutadas: la hora y la versión las pone el servidor (lo que mande el cliente se ignora, el dinero no cambia), la bitácora va después de escribir y sin token, `sin partidaId ⇒ 400`, y `GET /api/visita` le muestra al taller su antes y su después.

**Riesgo conocido que ni se abre ni se cierra aquí:** la autorización de `TallerPartida` es por modelo (M-2). Un usuario interno con permiso de escritura podría escribir `evidenciaFinal` directo por la API. Pertenece al frente #11.

## 8. Pruebas

- **Unitarias puras:** `decidirTerminacion` (cada fila de 4.2 + idempotencia + 409) en `tests/tallerPortalHandler.test.ts`; `refaccionesSinDespues`, `avisoSinDespues` y el mapeo de `evidenciaFinal` en `tests/tallerAntesDespuesPuro.test.ts`; filas del Excel en `tests/tallerExcelPartidas.test.ts`.
- **Handler + arnés:** las 11 propiedades de §7, con `tests/tallerPortalHandler.test.ts` y el arnés (`P18` de `tests/tallerPortalHarness.test.ts`).
- **Página de la liga:** `tests/tallerPortalPaginaDespues.test.ts` cubre qué botón aparece en cada estado y tipo, que el botón de terminar de una refacción nace deshabilitado, los totales, y que terminar otro hallazgo no cierra el panel del después ya abierto.
- **Fleet:** visor A+ (dos grupos, un grupo vacío, tira por lado y pantalla completa con ida y vuelta) en `tests/tallerVisorAntesDespues.test.ts`; la fila del registro, `finalizarUnidad` y `saveTallerEntry` en `tests/tallerAntesDespuesMonolito.test.ts`.
- **Chrome real** (construido como `tests/e2e/antes-despues.spec.ts`, 4 pruebas sobre la demo de §8.1, con la red externa bloqueada por Playwright): la fila dice "Sin foto del después"; el 🖼 abre el A+ con las dos leyendas, la miniatura 2 del después cambia solo su lado, "Ver antes en pantalla completa" abre el visor simple y Esc vuelve al A+ con la foto 2 del después todavía marcada, y otro Esc lo cierra; finalizar con una refacción sin después avisa y cancelar deja la visita "En Reparación"; y la demo corta la red externa ella misma (fetch y XHR) dejando lo local vivo. La **liga** se probó aparte en Chrome real a 390×844 con un script desechable (`.scratch`, no versionado) contra la vista local: 16/16 (6 tarjetas; terminada con ANTES/DESPUÉS con imagen; mano de obra a un toque ⇒ Terminada + "Sin foto"; refacción con foto del selector ⇒ Terminada con después visible; total Autorizado fijo; persiste tras recargar; el panel autoriza y la liga ofrece subir el después).
- **Batería completa:** `test:run`, `typecheck`, `lint`, `build` (la demo queda fuera de `dist`), `audit:csp`, `audit:xss`, smoke de la vista local (`preview:liga --smoke`), e2e contra la referencia **64/71** (71 pruebas; los 7 fallos son los ambientales conocidos; las 4 de antes-despues pasan). Sobre el merge con `main` salen **63/71**: se suma `kpi-taller.spec.ts:89`, que ya falla en `main` desde el PR #24 (espera el título viejo del modal, "Sin check mensual"; la prueba es idéntica a la de `main`) y se ajusta en un PR aparte. `audit:xss` marca **1 sospechoso preexistente de `main`** (`Control de flotilla.html`, `body.innerHTML` de llantas, commit `eaf6bb9`): no es de este frente; se avisa en el PR.
- **Prueba manual de Navares (obligatoria, regla del frente híbrido):** con una **visita real**, liga emitida y el **celular** del taller: subir un hallazgo, autorizarlo con la cuenta de **Riesgos** (no con admin), subir el después, verlo en Fleet en A+, y finalizar una visita con una refacción sin después para ver el aviso.

### 8.1 Vista local para Navares (antes del PR)

La ruta nueva del portal solo existe en la nube después de desplegar, así que "verlo en local" se armó con dos piezas que no tocan producción:

- **La liga en el navegador de la computadora (y del celular en la misma red):** `npm run preview:liga` (`scripts/preview-liga-local.mjs`) sirve la página real de `pagina.ts` en `http://localhost:5180` contra un **servidor simulado en memoria** que carga `validacion.ts` con Vite y usa sus **mismas** funciones (`decidirTerminacion`, `llaveFoto`, `proyectarPartidaParaTaller`…). Trae una visita de ejemplo con **6 hallazgos**, uno por estado: autorizada refacción, autorizada mano de obra, terminada (con antes y después), propuesta, rechazada y borrador. Las fotos son dibujos SVG y viven en memoria; `/__panel` hace de Riesgos (autorizar). `--red` la abre a la misma red para el celular; `--smoke` se prueba sola y sale. Nada sale a internet. Lo que **no** replica lo dice en su cabecera: la firma HMAC, el apagador, el portón de visita cerrada/anulada, la CSP del portal, S3 y los chequeos que viven en `handler.ts` y no en `validacion.ts`.
- **Fleet con `npm run dev`** y la URL `Control de flotilla.html?e2e=1&demo=antes-despues`: `src/dev/demoAntesDespues.ts` (solo desarrollo: `main.ts` la importa detrás de `import.meta.env.DEV`, así que no viaja al build) siembra una visita **inventada** con hallazgos en cada estado y abre su registro con las funciones reales de la app: la fila con "Sin foto del después", el visor A+ y el aviso al finalizar. Todo lo que tocaría la nube o el disco es un doble que no escribe (DynamoDB, S3, IndexedDB); la demo **corta la red externa ella misma** (fetch y XHR: solo `localhost`, `data:` y `blob:`), no corre si hay una sesión real abierta y pone el letrero "MODO DEMO · datos inventados · nada se guarda" arriba, sin atrapar clics.

Navares recorrió las dos y dio el visto bueno el 2026-09-30.

## 9. Preguntas que quedan abiertas (no bloquean el plan)

- **El taller subió una foto equivocada.** Con la decisión 4 no hay forma de corregirla desde la liga. Si pasa en la práctica, la salida natural es que Riesgos pueda "reabrir" un hallazgo terminado desde Fleet. Se decide si pasa.
- **Riesgos subiendo el después** cuando el taller lo manda por WhatsApp. Mismo criterio que la factura en el Bloque 2 (decisión 10 de ese spec): posible, pero no ahora.

## 10. Despliegue

1. ✅ `feat/taller-liga-cierre` pasó la prueba manual de Navares y se fusionó a `main` el 2026-09-30 (PR #25).
2. ✅ `main` traído a esta rama (merge, no rebase) el 2026-09-30; la batería se repitió sobre el merge (`98ba585`) el mismo día: vitest 189 archivos / 2,561 pruebas, typecheck, lint, build, `audit:csp` verdes; e2e 63/71 (7 ambientales + `kpi-taller.spec.ts:89`, preexistente de `main`).
3. ✅ Revisión de seguridad + revisión final de la rama (3 lentes de seguridad + 4 de revisión final; los hallazgos quedaron como menores, sin críticos abiertos).
4. ✅ **Navares lo vio en local (§8.1) y dio el visto bueno el 2026-09-30.**
5. PR → merge = deploy (Amplify). El push lo corre Navares desde el worktree del frente.
6. Humo en producción con la prueba manual de §8.
