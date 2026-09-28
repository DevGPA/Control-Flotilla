# Taller híbrido · Antes y después por hallazgo

**Fecha:** 2026-09-28 · **Estado:** decisiones cerradas con Navares; spec para su revisión · **Rama:** `feat/taller-antes-despues` (sale de `feat/taller-liga-cierre`)
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
3. Busca la partida **dentro de** `listarPartidasDeVisita(tk.t, visitaKey)` por `partidaId`. Nunca por id suelto: una partida de otra visita simplemente no existe para esta liga.
4. `validarTerminacion(partida, llaves)` (pura, `validacion.ts`; ver 4.2).
5. Escribe con `TallerPartida.update`: `estado: "terminada"`, `evidenciaFinal: llaves`, `terminadoEn: ahora` (hora del servidor), `version: version + 1`.
6. `bitacora("terminar-partida", tk, { ...rastro, partidaId, fotos: llaves.length })`, **después** de escribir (patrón de `enviarAAutorizacion`).
7. Responde un **acuse proyectado**: `{ partidaId, estado: "terminada", evidenciaFinal, terminadoEn }`. Nunca la fila cruda (patrón A-1 / §2.3.3).

### 4.2 `validarTerminacion` (pura)

Lanza `ErrorEntrada` (⇒ 400 con mensaje legible) cuando:

| Caso                                   | Mensaje                                                          |
| -------------------------------------- | ---------------------------------------------------------------- |
| La partida no está en esta visita      | "Este hallazgo no existe en esta visita"                         |
| `estado` es `borrador` o `propuesta`   | "Este hallazgo todavía no está autorizado"                       |
| `estado` es `rechazada` o `cancelada`  | "Este hallazgo no fue autorizado"                                |
| `tipo` es `refaccion` y no trae fotos  | "Una refacción necesita al menos una foto del trabajo terminado" |
| Más de `TOPE_FOTOS_PARTIDA` fotos      | "Máximo 6 fotos por hallazgo"                                    |
| Alguna llave no pasa `llaveFotoValida` | "llave de foto no válida"                                        |

**Ya terminada (`estado === "terminada"`):**

- Si las llaves recibidas son **las mismas** que ya tiene `evidenciaFinal` (mismo conjunto) ⇒ 200 con el mismo acuse, sin escribir (es un reintento de red: el taller tiene mala señal).
- Si son **distintas** ⇒ 409 "Este hallazgo ya se marcó como terminado y no se puede cambiar" (decisión 4).

Mano de obra con `fotos: []` es válida (decisión 3). Una partida sin `tipo` (fila vieja) se trata como `refaccion`, que es el caso estricto.

### 4.3 Carrera con Riesgos

La ruta lee, valida y escribe, igual que `enviarAAutorizacion`. La ventana entre leer y escribir es de milisegundos. Hoy, desde Fleet, nada saca a una partida de `autorizada`: la regla pura `puedeCancelar` permitiría a Riesgos cancelarla, pero **no tiene ningún caller** en la app. **El plan confirma** que la firma (`__guardarDecisionPartida` / `camposDeDecision`) tampoco re-decide una partida ya autorizada. Si alguna de las dos cosas cambia, la escritura usa `version` como condición; mientras tanto, el riesgo queda documentado como aceptado.

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

- `refaccionesSinDespues(ps: Partida[]): Partida[]` devuelve las partidas `autorizada` de tipo `refaccion` (o sin tipo). Una `terminada` nunca cuenta, y la mano de obra autorizada tampoco (decisión 3).
- Puente `window.__refaccionesSinDespues` junto a `__pendientesDeFirma` (`src/api/cloudHydrate.ts`).

### 6.2 Aviso al finalizar (monolito, `finalizarUnidad`)

`finalizarUnidad` ya arma `avisoPartidas` (C-I5) y lo muestra en el `confirm`. Se le agrega una línea:

> ⚠ 1 refacción autorizada no tiene foto del después: Balatas delanteras desgastadas ($1,850). Si finalizas, la liga del taller se cierra y ya no podrá subirla.

La línea lista descripciones cuando son 3 o menos; si son más, da el número. Se puede finalizar igual (decisión 6). Este es el camino de "✓ Finalizar" en la tabla y en el modal (`finalizarDesdeModal`).

**El plan verifica** si guardar el modal con "Fecha real de salida" también cierra la visita (y revoca la liga, por la liga-cierre). Si la cierra, el mismo aviso va ahí; si no, se documenta.

### 6.3 Lista del registro (`_provFilaHistorial` / `_provPartidas`)

- Refacción `autorizada` sin después: distintivo ámbar **"Sin foto del después"**.
- `terminada`: ya muestra "TERMINADA · terminada el …"; se agrega "🖼 antes y después", que abre el visor A+.

### 6.4 Visor A+ (`src/taller/visorFotos.ts`)

`abrirVisorFotos` gana un modo de dos grupos sin romper a quienes lo llaman hoy:

```ts
abrirVisorFotos({
  grupos: [
    { etiqueta: "Antes", fecha: p.creadoEn, llaves: p.fotos },
    { etiqueta: "Después", fecha: p.terminadoEn, llaves: p.evidenciaFinal },
  ],
  titulo,
  subtitulo,
  url,
});
```

- Los dos grupos van lado a lado, cada uno con su foto grande, la leyenda "ANTES · 14 sep · 2 fotos" y su tira de miniaturas. Una miniatura cambia solo la foto de su lado.
- El botón "Ver en pantalla completa" usa el overlay que ya existe (con su trampa de foco y cierre con Esc).
- Si un grupo viene vacío (mano de obra sin foto), ese lado dice "Sin foto" y no se rompe.
- Las llamadas actuales con `llaves` siguen funcionando igual (un solo grupo).
- Sin `innerHTML`. Las URLs son firmadas y se piden por demanda con la misma función `url`.

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

**Riesgo conocido que ni se abre ni se cierra aquí:** la autorización de `TallerPartida` es por modelo (M-2). Un usuario interno con permiso de escritura podría escribir `evidenciaFinal` directo por la API. Pertenece al frente #11.

## 8. Pruebas

- **Unitarias puras:** `validarTerminacion` (cada fila de 4.2 + idempotencia), `refaccionesSinDespues`, filas del Excel.
- **Handler + arnés:** las 11 propiedades de §7, con `tests/tallerPortalHandler.test.ts` y el arnés.
- **Página de la liga:** `tests/tallerPortalPagina.test.ts` cubre qué botón aparece en cada estado y tipo, y que el botón de terminar de una refacción nace deshabilitado.
- **Fleet:** mapeo de `evidenciaFinal`, visor en modo dos grupos (incluido un grupo vacío) y una línea más en el aviso de `finalizarUnidad`.
- **Chrome real** (arnés de `control-flotilla-prueba-chrome-monolito`): el registro con una partida terminada abre el visor A+, se cambia la foto con la tira, abre pantalla completa, y finalizar muestra el aviso. La red externa va bloqueada.
- **Batería completa:** `test:run`, `typecheck`, `lint`, `build`, `audit:csp`, `audit:xss`, e2e contra la referencia (60/67).
- **Prueba manual de Navares (obligatoria, regla del frente híbrido):** con una **visita real**, liga emitida y el **celular** del taller: subir un hallazgo, autorizarlo con la cuenta de **Riesgos** (no con admin), subir el después, verlo en Fleet en A+, y finalizar una visita con una refacción sin después para ver el aviso.

## 9. Preguntas que quedan abiertas (no bloquean el plan)

- **El taller subió una foto equivocada.** Con la decisión 4 no hay forma de corregirla desde la liga. Si pasa en la práctica, la salida natural es que Riesgos pueda "reabrir" un hallazgo terminado desde Fleet. Se decide si pasa.
- **Riesgos subiendo el después** cuando el taller lo manda por WhatsApp. Mismo criterio que la factura en el Bloque 2 (decisión 10 de ese spec): posible, pero no ahora.

## 10. Despliegue

1. Que `feat/taller-liga-cierre` pase la prueba manual de Navares y se fusione a `main`.
2. Llevar `main` a esta rama (merge, no rebase) y correr la batería.
3. Revisión de seguridad + revisión final de la rama.
4. PR → merge = deploy (Amplify). El push lo corre Navares desde el worktree del frente.
5. Humo en producción con la prueba manual de §8.
