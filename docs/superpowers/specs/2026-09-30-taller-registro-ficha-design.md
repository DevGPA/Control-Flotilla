# Taller · El registro como "ficha" (opción A)

**Fecha:** 2026-09-30 · **Estado:** borrador para revisión de Navares · **Rama:** `feat/taller-registro-ficha` (sale de `feat/taller-antes-despues`, que ya contiene `feat/taller-liga-cierre`)
**Antecedentes:** `2026-09-22-taller-liga-cierre-y-llave-design.md` · `2026-09-28-taller-antes-despues-design.md`.
**Boceto elegido:** opción A (`bocetos-registro/opcion-a.html`, en el scratchpad de la sesión; local, fuera de git).

En este documento, `HTML:NNNN` quiere decir la línea NNNN de `Control de flotilla.html`.

## En corto

Hoy el registro de una visita al taller es un formulario plano de 18 campos. Para saber "cómo va" la unidad hay que leerlo campo por campo, y lo que manda el taller queda a media pantalla. Con este cambio, al abrir una visita ya guardada se ve primero una **ficha de solo lectura**: estado de GPA junto a lo que reporta el taller, días en taller, salida estimada contra la prometida, costo autorizado y por firmar, y la liga con el **nombre** de quien la emitió. Debajo van **todos los hallazgos del taller**, con los que esperan firma primero. Al final queda el formulario de hoy, plegado tras **"Editar datos"**, y **Guardar** solo se enciende cuando cambias algo ahí.

**Solo cambia cómo se ve.** Guardar, la liga, las firmas, la anulación, el reingreso y la guarda de la llave siguen pasando por las mismas funciones y leyendo los mismos campos. La única llamada nueva a la nube es una **lectura** del directorio de usuarios, para convertir el id de quien emitió la liga en su nombre (§4.7).

**Lo que sí notarás distinto, además del acomodo:**

- Adentro de "Datos del registro" el formulario queda **igual que hoy** (mismas secciones, mismo orden). No se reacomoda como en el boceto ni lleva el botón "Corregir modelo, sucursal o área", para no arriesgar Guardar ni el alta.
- Quien solo consulta (viewer) ya no puede teclear en los campos y deja de ver "✓ Finalizar" y "+ Reingresar". Hoy los ve, pero la nube le rechaza el cambio.
- Sin liga, el botón dice "Emitir liga y copiar". Con la liga activa, al copiarla **se vuelve a emitir**: queda a tu nombre y vence en 90 días. La pantalla lo avisa.
- Si al guardar falta un dato, "Datos del registro" se abre solo y marca el campo.
- En el registro, las firmas dicen el nombre ("Autorizada por Ana López"). En la bandeja de firmas siguen con el correo.
- La ventana del registro es un poco más ancha, y en celular los botones de abajo van en dos renglones.

## 1. Problema

1. **La pantalla no contesta "¿cómo va?".** El estado, las fechas y el costo están regados en 6 secciones (`HTML:1322-1448`). Días en taller solo se calcula en la tabla (`HTML:9982`), no en el registro.
2. **Lo del taller se ve igual que lo de GPA.** El bloque Proveedor (`HTML:1364-1384`) pinta el estado que reporta el taller y su promesa de salida (`_provPintar`, `HTML:7876-7926`) con la misma tipografía que los campos de GPA. No hay nada que diga quién dijo qué.
3. **La liga muestra un id.** "Emitida por …" pinta `ligaCreadaPor` tal cual (`HTML:7867-7873`). El Lambda guarda `claims.email || identity.sub` (`amplify/functions/taller-portal/handler.ts:216`), pero la app llama con el token de acceso de Cognito (`src/api/amplifyClient.ts:38`), que no trae `email`. **Deducido del código, no medido:** lo esperable es que se guarde el sub de Cognito. El plan lo mide contra prod antes de construir (§4.7).
4. **Lo urgente queda abajo.** Las partidas que esperan firma están dentro del bloque Proveedor, después de Identificación. En el filtro "Todas" salen revueltas con el historial, porque `agruparPorVisita` no ordena (`src/api/tallerPartidas.ts:37-46`).
5. **Guardar siempre está encendido,** aunque no hayas tocado nada, y no queda claro que Autorizar y Rechazar se guardan solos (`HTML:8787-8823`).

## 2. Decisiones

| #   | Decisión | Por qué |
| --- | -------- | ------- |
| 1   | **Opción A:** ficha de solo lectura arriba, hallazgos del taller en medio, y "Datos del registro" (el formulario de hoy) plegado al final tras "Editar datos". Todo en una columna. | Elección de Navares sobre el boceto. |
| 2   | **Guardar solo se enciende cuando cambiaste algo en "Datos del registro".** Sin cambios se ve apagado (`disabled`) con el texto visible "Sin cambios" a su lado (no un tooltip, que en celular no se ve). Dentro del pliegue va la nota del boceto: "Guardar, abajo, se resalta en cuanto cambias algo de este bloque." | Elección de Navares (ajuste tomado de la opción B). Detalle en §4.5. |
| 3   | **Etiquetas visibles "GPA" y "TALLER"** en cada estado, fecha y cifra: GPA en azul liso, TALLER en cian con borde punteado e ícono de llave. | Elección de Navares (ajuste tomado de la opción C). |
| 4   | **La liga muestra el NOMBRE** de quien la emitió, nunca el id. Si no hay nombre, se usa un respaldo legible y **jamás el GUID**, ni en el texto, ni en un `title`, ni en un atributo del DOM (§4.7). | Pedido de Navares. |
| 5   | **Solo presentación.** No se tocan `saveTallerEntry` (`HTML:11250`), la guarda de la llave (`HTML:11362-11373`), `copiarLigaProveedor` / `revocarLigaProveedor` (`HTML:10592`, `10644`), la firma (`HTML:8787-8823`), `deleteTallerEntry` (`HTML:11412`) ni los reingresos por dentro. Todos los `tf-*` conservan su id y se siguen leyendo con `getElementById(...).value`. | Pedido de Navares. Si un `tf-*` desaparece, `saveTallerEntry` lanza TypeError y no guarda (mapa "modal"). |
| 6   | **Se usa en computadora y debe servir en celular:** misma columna. En celular (≤768 px) sale arriba un aviso tocable "N hallazgo(s) espera(n) tu firma · Ver", y el pie pasa a dos renglones. | Pedido de Navares. Una visita abierta muestra 5 botones (§4.6), que no caben en uno a 390 px. |
| 7   | **Navares lo ve en local, dentro de Fleet, antes del PR**, con datos de ejemplo (§8). | Regla suya para todo cambio. |
| 8   | **Orden de subida:** liga-cierre → antes-después → este rediseño. | Usa la lista de hallazgos y el visor que trae antes-después. |
| 9   | **El alta y los dos reingresos abren como hoy:** sin ficha, con "Datos del registro" desplegado, el foco en `#tf-eco` (alta) o en `#tf-freporte` (reingresos) y Guardar encendido. Navares lo revisa en la demo (§8). | En el alta no hay nada que resumir (`e` es null), y los reingresos no pasan por `openTallerModal` (`HTML:10727`, `11128`). Las e2e WF1 y kpi-taller teclean en `#tf-*` con `page.fill`, que exige campos visibles (`tests/e2e/workflow.spec.ts:102-126`, `kpi-taller.spec.ts:134-148`). |
| 10  | **"Identificación de la unidad" sigue primero dentro de "Datos del registro"** (el boceto la ponía al final, como resumen). No hay botón "Corregir modelo, sucursal o área": Modelo, Sucursal y Área siguen siendo campos normales, y Unidad, Placas y Fecha de ingreso los congela el candado de hoy (B-C4, `HTML:10506-10528`). | Así el alta conserva su flujo (buscar la unidad en `#tf-eco` es lo primero) y no se mueve el candado, que una prueba ejecuta tal cual (`tests/tallerOlaHonestidadUi.test.ts:286-335`). |
| 11  | **El estado GPA solo se cambia en "Datos del registro".** La ficha no trae un selector rápido. | Elegir "Finalizado" dispara el autollenado de la salida real y el aviso de "sin foto del después" al guardar (`HTML:11355-11357`, `11379-11383`). Un segundo camino sería lógica nueva. |
| 12  | **Viewer:** ve la ficha y los hallazgos sin Autorizar/Rechazar (ya son `needs-write`). El pliegue dice "Ver datos" y los campos salen **deshabilitados**. No ve Guardar, "✓ Finalizar", "+ Reingresar" ni el aviso de firma. | Hoy el viewer puede teclear en todo aunque no pueda guardar (mapa "modal"), y "✓ Finalizar" / "+ Reingresar" no llevan clase de permiso (`HTML:1453-1454`). Agregar `needs-write` es presentación: la nube ya rechaza. |
| 13  | **Visita cerrada o finalizada:** la ficha dice "Salió el dd/mm" y cuenta los días hasta la salida real. La liga tiene tres casos: `revocada` con `ligaRevocadaPor = "cierre:<correo>"` (lo normal desde liga-cierre, porque el guardado que cierra revoca) → "Se cerró junto con la visita (Nombre) el …"; `cerrada` (visitas cerradas antes de liga-cierre) → "Liga cerrada con la visita"; y `sin-liga` → "Sin liga". Siguen como hoy: "+ Reingresar" visible y "✓ Finalizar" y los botones de liga ocultos (`HTML:10466-10469`, `10554`). | `estadoLiga` (`src/taller/liga.ts:36-62`) y `revocacionPorCierre` (`src/taller/liga.ts:87`) ya dan los tres casos; la salida real está en el entry. |
| 14  | **La frase "en la lista aparece como Cotización hasta que firmes" NO se pone,** porque hoy es falsa: `estadoCompuesto` (`src/taller/partidas.ts:314`) no lo llama ninguna pantalla y la tabla ni tiene columna de estado (`HTML:9997-10019`). En su lugar va "Mientras haya hallazgos sin firmar, la lista del Taller marca esta unidad «Esperando firma»", **solo cuando `__distintivoProveedor(e, ps).kind === "esperando-firma"`**, la misma función que pinta la columna de la tabla (`HTML:8141-8142`). Con la promesa vencida esa marca va primero (`src/taller/seguimiento.ts:96-97`) y la frase no sale. | Pintar algo que no pasa sería mentir, y una condición paralela terminaría contradiciendo a la lista. Conectar "Cotización" de verdad ya no es presentación (pregunta 3). |
| 15  | **"N días después de lo estimado"** en vez de "N días tarde". | Crítica de UX al boceto. |
| 16  | **El bloque TALLER puede llevar el nombre del taller, tomado de "Técnico asignado" (`e.tecnico`).** Es un supuesto (pregunta 1). Hasta que Navares conteste, el bloque dice solo "TALLER". Si se confirma, se rotula como dato de GPA ("nombre según GPA"), nunca como "desde su liga". | La visita no guarda el nombre del proveedor. `proveedorNombre` es por partida (`amplify/data/resource.ts:176`) y el portal no lo escribe. Atribuirle al taller un dato que tecleó GPA sería falso. |
| 17  | **Las miniaturas abren el visor.** La foto del antes abre `__abrirVisorFotos` como hoy (`_bnThumb`, `HTML:8448`). En un hallazgo terminado, cualquier miniatura abre el visor A+ con el antes y el después (misma llamada que el botón "🖼 Antes y después", `HTML:8098-8119`). | Crítica de UX. |
| 18  | **El registro abre con TODOS los hallazgos, agrupados, como el boceto:** "Esperan tu firma" → "Autorizados · suman $X" → "No autorizados". Se quedan los 4 filtros (Todas, Pendientes, Autorizadas, Rechazadas). La inicial de `_provFiltro` y su reinicio por visita (`HTML:7934`, `7946`) pasan de `"pendientes"` a `"todas"`. "Pendientes" queda para el salto desde la bandeja, que ya lo fija junto con `_provFiltroId`, así que el reinicio no lo pisa (`HTML:8323`). | Es lo que eligió Navares. La e2e del antes y después solo necesita que exista el botón "Autorizadas" (`tests/e2e/antes-despues.spec.ts:19-22`); se ajusta su comentario de la línea 18. |
| 19  | **Una sola fuente para el dinero:** `__gastoDerivado(e, ps).gasto` para lo autorizado y `__montoPendienteDeFirma` para lo que falta firmar (`src/taller/partidas.ts:186`, `277-298`), lo mismo que usa `#tf-gasto`. Con eso se pintan el costo de la ficha y el "suman $X" del grupo "Autorizados", que dan siempre el mismo número. La línea "Autorizado $X · Esperando $Y" de la lista, que sale de `resumenPartidas`, se quita. | Hoy la barra usa `resumenPartidas` y `#tf-gasto` usa `gastoDerivado`, y difieren ante un precio que no es número (mapa "proveedor"). Con una sola fuente, las cifras de la pantalla cuadran entre sí. |
| 20  | **Los botones de liga dicen la verdad.** Sin liga, revocada o vencida, el botón dice "Emitir liga y copiar". Con la liga activa dice "Copiar liga", y debajo, en `#tf-prov-liga-meta`, va la nota "Copiar vuelve a emitir: la liga queda a tu nombre y vence en 90 días". Es que `copiarLigaProveedor` **siempre emite**: reescribe `ligaCreadaEn`/`ligaCreadaPor` y limpia la revocación (`HTML:10592-10642`, `handler.ts:985-1004`). "Revocar" solo se muestra si la nube confirma la liga (como hoy) **y** la pastilla local dice activa. | Hoy, después de revocar, conviven la pastilla "Liga revocada" y el botón "Revocar liga" (`HTML:10644-10672`). Solo cambian la visibilidad y el texto; la función no se toca. |
| 21  | **Alta y reingresos limpian lo que se pintó de la visita anterior.** `clearTallerEntryFields` (`HTML:10708`, la usan los dos reingresos) y la rama del alta de `openTallerModal` (la que hoy oculta `#tf-proveedor`, `HTML:10573`): ocultan `#tf-ficha`, `#tf-aviso-firma` y `#tf-proveedor`, limpian `#tl-msub`, despliegan "Datos del registro", descartan la foto de §4.5 y encienden Guardar. `clearTallerEntryFields` además oculta "✓ Finalizar" y "Expediente". | Los reingresos no pasan por `openTallerModal`: sin esto heredan la ficha, el subtítulo y el Guardar apagado de la visita anterior. El defecto del `unitKey` perdido es lógica y queda fuera (pregunta 4). |
| 22  | **Un campo inválido despliega solo "Datos del registro"** antes de marcarlo y darle el foco. Aplica a los campos requeridos y a la llave ocupada, que marca `#tf-fentrada` (`HTML:11242`, `11362-11373`). | Con el bloque plegado, el aviso apuntaría a un campo que no se ve. El cambio va dentro de `_markInvalid`, no en `saveTallerEntry` (§4.4). |
| 23  | **Cerrar con cambios sin guardar:** propuesta en la pregunta 2. Mientras no la contestes, se queda como hoy (se descarta sin avisar). | Hoy Escape, el fondo, ✕, Cancelar, "Finalizar" y "Expediente" tiran lo editado (`HTML:11075`, `11080`). |
| 24  | **Al abrir una visita guardada, el foco nunca cae en un control que escribe.** Va al título del modal (§4.4). | "Emitir liga y copiar" / "Copiar liga" emite en prod y "✓ Autorizar" firma dinero. La bandeja abre el registro con Enter (`HTML:8323-8327`) y un Enter de más activaría el botón. |
| 25  | **Días en taller: manda la fórmula de la tabla.** La ficha usa la cuenta de `HTML:9982` (`new Date("AAAA-MM-DD")` es medianoche UTC), extraída tal cual a una función pura. El Excel (`diasEnTaller`, `src/taller/exportExcel.ts:128-133`, medianoche local) queda como está. | En México, entre las 06:00 y las 12:00 las dos cuentas difieren en 1 día. La ficha debe coincidir con la tabla que Navares ya lee. Unificar los tres lados ya no es presentación; se anota como defecto previo (§3). |

**Regla que gobierna el frente:** _el monolito pinta; las cuentas salen de funciones puras._ Días, diferencia de fechas, costo, orden de hallazgos y nombre de usuario salen de `src/taller/*` (probadas), no de aritmética nueva en el HTML. `tests/tallerBloqueProveedor.test.ts:69-74` ya prohíbe `24*60*60` dentro de `_provPintar`.

## 3. Alcance

**Entra:**

- Markup de `#taller-modal`: contenedor de la ficha, sección "Hallazgos del taller", pliegue "Datos del registro" y pie. Los mismos ids `tf-*`, `tf-prov-*` y `btn-*`. Sale el encabezado suelto `<div class="tl-sec needs-hibrido">Proveedor</div>` (`HTML:1364`).
- Pintado: una función nueva `_fichaPintar(e)` en el monolito, llamada desde `_provPintar` (§4.1), y ajustes de visibilidad y texto en `_provPintar`, `_provPartidas`, `_provFilaHistorial`, `openTallerModal`, `clearTallerEntryFields` y `_markInvalid`.
- Funciones puras nuevas en `src/taller/` (ficha, orden de hallazgos, nombre de usuario, `hayCambios`) y sus puentes `window.__*` en `src/api/cloudWire.ts`, junto a los de `:583-598`.
- Lectura en caché del directorio `UserProfile` (§4.7).
- CSS nuevo con clases `tl-ficha-*` y `tl-datos-*` en `src/styles/main.css`, con su par oscuro en `:root[data-theme="dark"]`.
- `openModal`: respeta un `[data-autofocus]` si el modal lo trae (§4.4). Ningún otro modal lo usa, así que para ellos no cambia nada.
- Demo local nueva `demo=registro-ficha` (§8).

**No entra:**

- Cambios a `saveTallerEntry`, a la liga (emitir/revocar), a la firma, a la anulación, a la guarda de la llave, al portal o a cualquier Lambda.
- Mostrar "Cotización" en la tabla con `estadoCompuesto` (pregunta 3).
- Arreglar de raíz que `emitirLiga` guarde el correo en vez del sub. Toca un Lambda de seguridad (trampa 5) y no arregla las ligas ya emitidas.
- "Autorizar las N" en lote. `_bnGrupo`, `_bnFooter` y `_bnAutorizarLote` son código muerto previo: **se mencionan, no se borran**.
- El `unitKey` que pierde el reingreso hecho desde el modal (`HTML:10727-10731` + `10583`) y que Escape no limpie `_tallerEditId` (`HTML:5406`). Son lógica y quedan anotados (pregunta 4).
- **Defectos previos de fechas, solo anotados:** el Excel cuenta los días en taller con medianoche local y la tabla con medianoche UTC (§2 #25). `__promesaTaller` y `__distintivoProveedor` usan la fecha UTC (`cloudWire.ts:584`, `592`) y `diasVencida` la local, así que después de las 18:00 "hoy" ya es mañana para la promesa. La ficha usa los mismos puentes que la tabla para no contradecirla.
- La bandeja de firmas y la tabla de Taller (salvo que la nueva línea de §2 #14 describe lo que ya hacen).
- `calcTotalGasto` en `enviarATallerDesdeInspeccion` (`HTML:9667`): código muerto previo, se menciona y no se borra.

## 4. Diseño por partes

### 4.1 Estructura del modal

```
#taller-modal (.open, sin cambios)  >  .tl-mcard
  .tl-mhdr   #tl-mttl (tabindex=-1) "Unidad 06 · <placa>"  +  #tl-msub (nuevo) "modelo · sucursal · área"  +  ✕
  .tl-mbody
    #tf-aviso-firma      (nuevo, <button hidden>, solo celular, needs-write needs-hibrido)
    #tf-ficha            (nuevo, NO needs-hibrido, grid-column 1/-1)
       "Cómo va"
       estado:  #tf-ficha-gpa (siempre)  |  #tf-prov-taller + #tf-prov-taller-nota (se mueven aquí, needs-hibrido)
       cifras:  #tf-ficha-dias · #tf-ficha-salida · #tf-ficha-costo
       liga:    #tf-prov-liga [#btn-liga-copiar, #btn-liga-revocar] + #tf-prov-liga-meta  (se mueven aquí, needs-hibrido)
    #tf-proveedor        (se queda, needs-hibrido) → título "Hallazgos del taller (N)" + #tf-prov-partidas
    <details id="tf-datos">  (nuevo, grid-column 1/-1)
       <summary> "Datos del registro" + resumen "Guardado: …" + "Editar datos" / "Ocultar" (viewer: "Ver datos")
       nota: "Guardar, abajo, se resalta en cuanto cambias algo de este bloque."
       <fieldset id="tf-datos-campos" class="tl-datos-grid">
          las secciones de hoy, en el mismo orden y con los mismos ids:
          Identificación → Mantenimiento → Fechas → Costos y responsable → Notas
  .tl-mftr   Cerrar · + Reingresar · Expediente · ✓ Finalizar · "Sin cambios" · Guardar
```

- **Los ids no cambian, solo de lugar.** `_provPintar` escribe en `#tf-prov-liga`, `#tf-prov-liga-meta`, `#tf-prov-taller` y `#tf-prov-taller-nota` por `getElementById`, así que sigue funcionando. Hay que respetar una trampa: `_provPintar` borra todos los hijos de `#tf-prov-liga` salvo los dos botones (`HTML:7851-7853`), por eso **nada nuevo va dentro de `#tf-prov-liga`**. El texto nuevo de la fila de liga (nombre y nota de §2 #20) va en `#tf-prov-liga-meta`.
- **El encabezado "Proveedor" (`HTML:1364`) se quita.** Lo reemplaza el título "Hallazgos del taller (N)", que va dentro de `#tf-proveedor`. Así no queda un rótulo suelto entre la ficha y los hallazgos, ni vacío en el alta con el apagador encendido.
- **Una sola ruta de repintado.** `_provPintar(e)` llama a `_fichaPintar(e)` en su **primera línea**, antes de revisar si falta `__estadoLiga`. Así los cuatro lugares que ya repintan (`_bnRepintar` `HTML:8783`, apertura `HTML:10573`, emitir `HTML:10616` y revocar `HTML:10664`) refrescan la ficha sin tocarlos, y el "Esperando tu firma $X" no se queda viejo después de firmar. Esto evita repetir el defecto que se arregló en liga-cierre. `_bnRepintar` ya llama a `_tfGastoPintar` **antes** que a `_provPintar` (`HTML:8778-8785`), así que la ficha y `#tf-gasto` leen las mismas partidas recién hidratadas. `_fichaPintar` termina recalculando "hay cambios" (§4.5).
- **Si falta `__estadoLiga`,** `_provPintar` ya oculta `#tf-proveedor`. Además tiene que ocultar `#tf-prov-liga` y `#tf-prov-taller`, que ahora viven en la ficha. Es un ajuste de visibilidad dentro de la misma función.
- **El apagador.** `#tf-ficha` **no** lleva `needs-hibrido`, así que días, salida estimada de GPA y costo capturado se ven con el apagador apagado, como en producción. Las piezas del taller conservan su propia clase `needs-hibrido` (y los botones, `needs-liga`), así que con el apagador apagado no se filtra nada del esquema (`HTML:2855-2862`).
- **`.open` y `#taller-modal` no cambian.** De ellos depende la pausa del auto-refresco (`src/api/cloudWire.ts:911`) y el repintado de `_bnRepintar`.
- **CSS compartido:** no se tocan `.tl-mcard`, `.tl-mbody`, `.tl-mftr` ni `.tl-sec`, que usan los modales de usuario, unidad, contraseña temporal y accesorio (`src/styles/main.css:4358-4455`). Lo propio de este modal se acota con `#taller-modal …` o con clases nuevas. `#tf-ficha`, `#tf-proveedor` y `#tf-datos` llevan `grid-column: 1 / -1`, porque `.tl-mbody` es una rejilla de 2 columnas (`main.css:4401-4409`). `.tl-datos-grid` repite esa rejilla dentro del pliegue y pasa a 1 columna en ≤768 px, como la regla de `main.css:6013-6015`.
- **El `<fieldset>` sin estilos del navegador:** `#tf-datos-campos { border: 0; padding: 0; margin: 0; min-width: 0; min-inline-size: 0 }`. El `min-inline-size: min-content` de fábrica impide que la rejilla se encoja y provoca scroll horizontal a 390 px, y el borde `groove` se ve mal en tema oscuro.
- **Ancho:** `#taller-modal .tl-mcard` pasa de 620 px a 760 px, para que las dos columnas del estado, las tres cifras y los 5 botones del pie quepan sin apretarse. Solo afecta a este modal.

### 4.2 La ficha ("Cómo va")

Sale de una función pura nueva en `src/taller/ficha.ts` (sin DOM):

```ts
fichaRegistro(e, ps, { ahora, hibrido, confiables })
// ahora: ISO del instante actual. hibrido: true | false | undefined (desconocido,
// antes de hidratar o con __tallerHibridoDesconocido). confiables: _partidasConfiables().
```

Se publica como `window.__fichaRegistro`, y el puente pone `ahora = new Date().toISOString()`, igual que `__promesaTaller` y `__distintivoProveedor`, para que la ficha y la tabla usen el mismo "hoy". `_fichaPintar` le pasa `hibrido = window.__tallerHibrido` y solo crea nodos con `createElement`/`textContent`.

| Pieza | Qué muestra | De dónde sale |
| ----- | ----------- | ------------- |
| **Estado · GPA** | Pastilla con `e.estado`, usando las variantes `.tl-pill` que ya existen (`main.css:4265-4305`), y el tipo de mantenimiento. Abajo: "Se cambia en Datos del registro". La línea de §2 #14 solo si el distintivo es "esperando-firma". | `e.estado`, `e.tipo` (`src/taller/types.ts:3-8`), `__distintivoProveedor`. |
| **Estado · TALLER** | Pastilla del estado operativo, con las etiquetas que ya usa `_provPintar` (REVISANDO, REPARANDO, ESPERANDO REFACCIÓN, LISTA; `HTML:7879-7886`). También "km del taller X · km ingreso Y", que se conserva porque la prueba lo exige (`tests/tallerBloqueProveedor.test.ts:44-58`). Sin reporte: "El taller aún no ha reportado estado." **La promesa de salida y "PROMESA VENCIDA" se quitan de aquí** y viven solo en la fila "Salida", para no salir dos veces. | Las mismas columnas y el mismo código de hoy en `#tf-prov-taller` (`HTML:7876-7926`, `src/api/cloudHydrate.ts:1104-1112`), sin la parte de la promesa. |
| **En taller** | "5 días" y debajo "Ingresó el dd/mm/aaaa". En una visita cerrada: "Salió el dd/mm/aaaa · estuvo N días". Colores: más de 3 días en ámbar y más de 7 en rojo, igual que la tabla, y solo en visitas abiertas. | §2 #25: la fórmula de `HTML:9982`, `Math.round((ahora − Date.parse(fentrada)) / 86 400 000)`, extraída tal cual a `ficha.ts`. En una cerrada, el fin es `Date.parse(fsalidaReal)`. No se importa nada de `exportExcel.ts`, así que ExcelJS no llega al arranque. |
| **Salida** | Fila GPA: "Estimada por GPA dd/mm". Fila TALLER (`needs-hibrido`): "El taller promete dd/mm", más "(había prometido dd/mm)" si cambió la promesa. Una sola señal debajo, por prioridad: ① "PROMESA VENCIDA · N días" (rojo) · ② "Salida estimada vencida hace N días" (rojo) · ③ "N día(s) después de lo estimado" (ámbar), si la promesa del taller cae después de la estimada. | ① `promesaTaller` (`src/taller/seguimiento.ts:23-43`), con el mismo "hoy" UTC que la tabla · ② `diasVencida` (`src/taller/tallerStore.ts:50-61`) · ③ nueva: diferencia de fechas civiles entre `fsalidaEstTaller` y `fsalidaEst`, en días enteros de calendario (sin huso). **Las dos fechas nunca se mezclan ni se renombran** (`types.ts:58`: "separados a propósito"). `_provPintar` sigue llamando a `window.__promesaTaller(` para pintar la fila TALLER (`tests/tallerBloqueProveedor.test.ts:44-51`). |
| **Costo** | `hibrido === true`, partidas confiables y con partidas: "Autorizado $X" (verde) y "Esperando tu firma $Y" (ámbar, oculto si es $0), con la nota "El subtotal es la suma de los hallazgos autorizados". `hibrido === true`, confiables y sin partidas, o `hibrido === false`: "Capturado por GPA $X". `hibrido === true` y no confiables: "No se pudieron cargar los hallazgos", **nunca $0**. `hibrido` desconocido: "Capturado por GPA $X · verificando…", sin hablar de hallazgos. | §2 #19: `__gastoDerivado` y `__montoPendienteDeFirma`, la misma fuente que `_tfGastoPintar` (`HTML:10432-10458`). Confiabilidad: `_partidasConfiables()` (`HTML:7826-7834`). |
| **Liga** (`needs-hibrido`) | Punto de color y "Liga del proveedor activa · vence en N días · emitida por **Nombre** el dd/mm/aaaa". También "revocada por Nombre el …", vencida, los tres casos de visita cerrada (§2 #13) o "Sin liga". Botones a la derecha y nota, según §2 #20. | `__estadoLiga(e)` (`src/taller/liga.ts:36-62`) y el nombre de §4.7. El texto "Liga cerrada con la visita" se conserva (`tests/tallerLigaCierreUi.test.ts:118-124`). |

### 4.3 Hallazgos del taller

- Siguen en `#tf-proveedor` / `#tf-prov-partidas` con `_provPartidas` (`HTML:7940-8026`), `_bnPartida` para los que esperan firma (`HTML:8514-8610`) y `_provFilaHistorial` para el resto (`HTML:8032-8122`). Filas, botones, panel de rechazo (`_bnPanelVisible`, `HTML:8616`), chip "Sin foto del después" con su clase exacta `tl-pill diag` y botón "🖼 Antes y después": **sin cambios de comportamiento**.
- El título dice "Hallazgos del taller (N)" y, si hay pendientes, "· N espera(n) tu firma" en ámbar.
- **Abre en "Todas", agrupado** (§2 #18): "Esperan tu firma" → "Autorizados · suman $X" (autorizadas y terminadas; X de §2 #19) → "No autorizados". Los grupos vacíos no se pintan. Debajo de "Esperan tu firma" va la nota "Autorizar y No autorizar se guardan solos; no necesitas Guardar."
- **Orden:** función pura nueva `ordenarHallazgos(ps)` en `src/taller/seguimiento.ts`. Devuelve los tres grupos (propuestas; autorizadas y terminadas; el resto), cada uno en el orden en que llegan (estable). El monolito solo pinta los subtítulos. Los filtros "Pendientes", "Autorizadas" y "Rechazadas" siguen mostrando un solo grupo.
- **Se conservan** los textos "No se pudieron cargar las partidas…" y "Esta visita no tiene partidas del proveedor." (`tests/tallerPartidasEnRegistro.test.ts:13-30`, `120-122`), las llamadas `_bnPartida(`, `window.__resumenPartidas(` (para los conteos) y `_partidasConfiables()`.
- **Miniaturas:** §2 #17. `_provFilaHistorial` se sigue pudiendo ejecutar con `new Function(window, _bnThumb, _fmtMon2, fmtDate)` (`tests/tallerAntesDespuesMonolito.test.ts:36-62`). Si necesita algo nuevo, lo toma de `window.*` con guarda (§4.7 punto 4), no de un parámetro nuevo.
- Se acepta el repintado completo tras firmar, como hoy (`cont.textContent=''`). Se pierde el scroll de la lista y cualquier panel de rechazo abierto en otra partida. Es comportamiento previo, provocado por una acción propia, y queda fuera. Lo que **no** se acepta es un repintado que llegue solo (§4.7 punto 1).

### 4.4 "Datos del registro" (plegado)

- Es un `<details id="tf-datos">`: abre y cierra sin JS y funciona con teclado. El `<summary>` muestra "Datos del registro" y un resumen de una línea rotulado **"Guardado:"** ("Guardado: Km al ingreso 85,000 · Técnico: … · Pedido ERP: **sin capturar**"), que pinta `_fichaPintar` con `textContent` desde lo guardado. El rótulo evita confundirlo con lo que se está tecleando.
- **"Editar datos" / "Ocultar" sin JS nuevo:** el `<summary>` trae dos `<span>` y el CSS muestra uno u otro (`#tf-datos[open] .tl-datos-ver{display:none}`, `#tf-datos:not([open]) .tl-datos-ocultar{display:none}`). Para viewer, `openTallerModal` cambia una vez el texto de `.tl-datos-ver` a "Ver datos".
- **Cuándo abre desplegado:** en el alta (`!e`) y en los reingresos (§2 #9 y #21). **Cuándo abre plegado:** en una visita guardada (`e`). `openTallerModal` fija `tf-datos.open = !e`.
- **Adentro va el formulario de hoy, sin cambios:** las mismas secciones, en el mismo orden y con los mismos literales, entre ellos `>Identificación de la unidad<` y `<div class="tl-sec">Mantenimiento</div>`. Se envuelven en `<fieldset id="tf-datos-campos">`. Para viewer, `openTallerModal` pone `fieldset.disabled = isViewer()` (`HTML:2702`). Un control deshabilitado sigue dando su `.value` y no cambia la propiedad `readOnly`, así que la señal de `#tf-gasto.readOnly` que lee `saveTallerEntry` (`HTML:11309-11311`) no se toca.
- **Candados sin cambios:** `#tf-gasto.readOnly` (`_tfGastoPintar`) y B-C4 sobre `tf-fentrada`, `tf-plate` y `tf-eco` siguen como están. En el bloque del candado no se agrega ningún `getElementById`, porque la prueba lo ejecuta con un `document` falso que solo resuelve 4 ids (`tests/tallerOlaHonestidadUi.test.ts:286-335`). `#tf-identidad-hint` y la leyenda de `#tf-gasto` siguen dentro del pliegue, y la ficha ya muestra el costo.
- **Un campo inválido abre el pliegue (§2 #22):** dentro de `_markInvalid`, antes del `focus()`, se agrega `const d = el.closest && el.closest("details"); if (d) d.open = true;`. No es un `getElementById` nuevo ni toca el texto de `saveTallerEntry`, que una prueba extrae hasta `// Validaci` y ejecuta (`tests/tallerSaveEntryGastoCandado.test.ts:30-37`). Cubre también la llave ocupada, que marca `#tf-fentrada`.
- **Autofoco (§2 #24):** hoy `openModal` (`HTML:5416-5432`) enfoca, 30 ms después, el primer control del DOM. Se le agrega una sola cosa: dentro del mismo `setTimeout`, si el modal trae un elemento `[data-autofocus]`, enfoca ese; si no, sigue como hoy. No se agrega el filtro `offsetParent`, así que los demás modales, que no usan el atributo, no cambian. En `#taller-modal`, una función nueva `_tfAutofoco(id)` (en su propio bloque, fuera de `openTallerModal`…`closeTallerModal`) quita el atributo de donde esté y lo pone en `id`:
  - visita guardada: `#tl-mttl` (con `tabindex="-1"`). El foco nunca cae en "Copiar liga", "Emitir liga y copiar", el aviso de firma ni un botón de firma, en computadora ni en celular.
  - alta: `#tf-eco`.
  - reingresos: `#tf-freporte`, desde `clearTallerEntryFields`, igual que el `.focus()` que ya hacen (`HTML:10744`, `11148`).
  Los `.focus()` directos de hoy (`HTML:10577`, `10744`, `11148`) quedan igual.

### 4.5 Pie y "Guardar solo con cambios"

- **Pie:** Cerrar (`tl-cancel`, a la izquierda) · + Reingresar · Expediente · ✓ Finalizar · "Sin cambios" · Guardar. "+ Reingresar" y "✓ Finalizar" ganan `needs-write` (§2 #12). La lógica que decide cuál se ve según el estado de la visita no cambia (`HTML:10466-10469`): "+ Reingresar" sale en **toda** visita guardada y "✓ Finalizar" en las abiertas, así que una visita abierta muestra los 5 botones.
- **Qué cuenta como cambio (solo al editar una visita guardada):** al final de `openTallerModal(id)`, ya con todos los campos llenos, se guarda una **foto** del valor de cada control de `#tf-datos-campos`. Un solo escuchador de `input`/`change` sobre `#tf-datos` recalcula "hay cambios" contra esa foto. También recalculan `tlAcSelect` y `tlAcSelectNew`, que llenan campos por código sin disparar eventos (`HTML:11216`, `11226`), y el final de `_fichaPintar` (§4.1), que corre después de cada `_bnRepintar`. La comparación la hace una función pura nueva, `hayCambios(foto, actual)`, que **excluye un control si está en `readOnly` en la foto o en el momento de comparar**.
- **Por qué se excluyen los `readOnly`:** `_bnRepintar → _tfGastoPintar` vuelve a escribir `#tf-gasto.value` con lo derivado y puede pasarlo de editable a `readOnly` o al revés (`HTML:8778-8785`, `10453-10457`), sin que la persona toque nada. Si contara, Guardar se encendería solo después de firmar, o se quedaría encendido con el valor ya revertido.
- **Guardar:** sin cambios queda `disabled`, con la piel discreta del boceto y el texto visible "Sin cambios" a su lado (§2 #2). Con cambios se enciende con la piel `.tl-save` de hoy y el texto se oculta. **En el alta y en los reingresos está siempre encendido y sin foto** (§2 #21): ahí todo es captura, y lo que llenan `sendUnitToTaller` / `enviarATallerDesdeInspeccion` (`HTML:4124`, `9655`) sin eventos no debe dejarlo apagado.
- **Firmar no enciende Guardar:** Autorizar y No autorizar se guardan por su propio camino (`HTML:8787-8823`).
- **Cerrar la visita:** poner "Fecha real de salida" o "Finalizado" es un cambio en el formulario, así que Guardar se enciende. El guardado que cierra la visita (y revoca la liga, `src/api/batchUpload.ts:531-550`) sigue disponible.
- `saveTallerEntry` **no cambia**: el botón deshabilitado basta, porque no hay `<form>` que se envíe con Enter.

### 4.6 Celular (≤768 px)

- La misma columna. El estado GPA | TALLER se apila y las cifras quedan en 2 + 1 (días y salida arriba, costo a todo lo ancho), como en el boceto.
- **Aviso tocable** `#tf-aviso-firma` arriba de la ficha: "N hallazgo(s) espera(n) tu firma · $Y · Ver →". Solo sale si hay pendientes, las partidas son confiables, el apagador está encendido y quien mira puede firmar (`needs-write needs-hibrido`). Al tocarlo pone el filtro "Pendientes", repinta con `_provPartidas` y hace `scrollIntoView` a la primera fila por firmar. En computadora nunca sale, porque los hallazgos quedan a la vista justo debajo de la ficha.
  - Su visibilidad se maneja con el atributo `hidden`, **nunca con `style.display` en línea**, que le ganaría a la regla de escritorio. El CSS lleva `#tf-aviso-firma[hidden]{display:none!important}` y, en ≥769 px, `#tf-aviso-firma{display:none!important}`, como las reglas `needs-*`.
- **Pie en dos renglones** (`flex-wrap: wrap` en ≤768 px): arriba "Sin cambios" + Guardar (a lo ancho) y "✓ Finalizar"; abajo Cerrar · + Reingresar · Expediente. Se ordena con `order` en CSS, sin mover los botones en el HTML. El pie ya queda fijo abajo porque `.tl-mcard` es columna flex y `.tl-mbody` hace el scroll (`main.css:4377-4409`). El boceto solo pintaba 4 botones (no traía "+ Reingresar").
- Controles de al menos 44 px de alto en celular, y sin scroll horizontal a 390 px.

### 4.7 "Emitida por": el nombre, nunca el id

**Qué se guarda hoy:** `ligaCreadaPor` y `ligaRevocadaPor` traen, según el código, el **sub** de Cognito (§1 punto 3), o `"desconocido"` si el Lambda no tuvo ninguno de los dos. La revocación al cerrar guarda `cierre:<correo>` o `cierre:desconocido` (`src/taller/liga.ts:87`). Las firmas guardan el correo (`src/api/cloudHydrate.ts:1167`) y hoy se pintan crudas, "Autorizada por <correo>" (`HTML:8081-8088`).

**Primer paso del plan (medición, solo lectura):** contar en la tabla viva de prod qué forma tienen hoy `ligaCreadaPor` y `ligaRevocadaPor` (sub, correo, `cierre:…`, `desconocido`), con la receta de la memoria `inspeccion-datos-prod-dynamodb` (`PYTHONIOENCODING=utf-8` y Bash). Si aparecen correos, el orden de la cadena de respaldo no cambia, porque ya los acepta.

**Solución (del lado del cliente, sin tocar backend):**

1. **Directorio:** un módulo nuevo `src/api/directorioUsuarios.ts` lee **una vez por sesión** el modelo `UserProfile` del tenant, **paginando con `nextToken`**, con un `selectionSet` mínimo: `cognitoSub`, `email` y `nombre` (sin `telefono`). Lo puede leer cualquier miembro del tenant, no solo admin (`allow.groupDefinedIn("tenantId").to(["read"])`, `amplify/data/resource.ts:555-573`), que es la misma regla que ya le deja ver el Taller (`resource.ts:195`, `219`). Así que quien puede abrir el registro puede leer el directorio. Se descarta `__admin.listUsers`, porque es solo para admin (`src/api/cloudWire.ts:474`, `resource.ts:655-659`).
   - **Pasiva:** usa la sesión que ya existe y **nunca** `ensureSession`, para no repetir B-I5 (el login encima del modal, `cloudWire.ts:678-681`). Nunca bloquea el pintado: la ficha sale con el respaldo.
   - **Cuando llega, solo reescribe los nombres.** Si el modal sigue `.open` en la misma visita (`_tallerEditId`), busca otra vez la visita en `tallerEntries` y reescribe por `textContent` únicamente los nodos que muestran un nombre (en `#tf-prov-liga-meta` y los "Autorizada por …"). **No** llama a `_provPintar` ni a `_provPartidas`, para no borrar un panel de "No autorizar" a medio escribir, quitar el foco ni volver a firmar las URL de las miniaturas. Cada nodo de nombre se registra al pintarlo en un `WeakMap` nodo → valor crudo, en JS; el crudo nunca se escribe en el DOM.
   - Se carga la primera vez que se abre un registro que tiene liga o partidas, no al arrancar.
   - Si falla (sin sesión, `?e2e=1` sin Amplify, error de red), se calla y queda el respaldo.
   - El sub propio sale de `getCurrentUser().userId` (`src/main.ts:706-717`), porque `__cloudSession` no lo trae (`src/api/auth.ts:235-242`).
2. **Traducción:** una función pura nueva, `nombreDeUsuario(crudo, directorio, yo)` en `src/taller/nombreUsuario.ts`, publicada como `window.__nombreDeUsuario`. Acepta un sub, un correo o `"desconocido"`, en este orden:
   1. El `nombre` del directorio (si es la persona que mira: "Ana López (tú)").
   2. El correo sin dominio, si el crudo es un correo o si el directorio tiene el correo pero no el nombre. El auto-arreglo del panel crea perfiles con `nombre: ""` (`amplify/functions/admin-users/handler.ts:452-470`).
   3. "tú", si el crudo es tu propio sub o tu correo.
   4. **"un usuario de GPA"** (también para `"desconocido"`, vacío o nulo). Nunca el GUID: ni en el texto ni en un `title`.
3. **Prefijo `cierre:`:** "Revocada por cierre:ana@…" pasa a **"Se cerró junto con la visita (Ana López) el …"**. Con `cierre:desconocido` queda solo "Se cerró junto con la visita".
4. **Firmas:** para que la pantalla no mezcle nombres con correos, la misma función se usa en el "Autorizada por …" de `_provFilaHistorial`, **solo en el registro**. La bandeja queda como está. La llamada va con guarda, `typeof window.__nombreDeUsuario === "function" ? … : respaldo`, y el respaldo es el correo sin dominio o "un usuario de GPA", nunca un GUID. Así no truena la prueba que ejecuta `_provFilaHistorial` con `window = {}` (`tests/tallerAntesDespuesMonolito.test.ts:36-62`) ni la demo del antes y después, que no publica el puente.

**Si la lectura falla:** la cadena de respaldo funciona sin directorio. Con un sub, el resultado es "tú" o "un usuario de GPA", más la fecha de emisión.

**Lo que no hace:** no escribe nada ni toca el Lambda ni cambia qué se guarda. Las ligas viejas y las nuevas se leen igual.

## 5. Errores y estados vacíos

| Caso | Ficha | Hallazgos | Datos del registro | Pie |
| ---- | ----- | --------- | ------------------ | --- |
| **Alta** (`!e`) | Oculta; `#tl-msub` vacío | Oculto | Desplegado; foco en `#tf-eco` | Guardar siempre encendido; sin Reingresar, Finalizar ni Expediente (como hoy) |
| **Reingreso** (los dos) | Oculta; `#tl-msub` vacío (§2 #21) | Oculto | Desplegado; foco en `#tf-freporte` | Guardar encendido; Finalizar, Expediente y liga ocultos |
| **Sin liga** | "Sin liga" + "Emitir liga y copiar" (si puede) | Normal | Plegado | Normal |
| **Liga activa** | "emitida por Nombre el …" + "Copiar liga" y la nota de que copiar vuelve a emitir | Normal | Plegado | Normal |
| **Liga revocada / vencida** | "Liga revocada por Nombre el …" o "Liga vencida el …"; sin "Revocar" | Normal | Plegado | Normal |
| **Sin hallazgos** | Costo: "Capturado por GPA $X" | "Esta visita no tiene partidas del proveedor." | Plegado | Normal |
| **Hallazgos sin cargar** (apagador encendido) | Costo: "No se pudieron cargar los hallazgos" (nunca $0); sin aviso de firma | "No se pudieron cargar las partidas…" | `#tf-gasto` bloqueado con su aviso (como hoy) | Normal |
| **Apagador todavía desconocido** (antes de hidratar) | Costo: "Capturado por GPA $X · verificando…"; nada del taller | Oculto | Plegado | Normal |
| **Sin reporte del taller** | TALLER: "El taller aún no ha reportado estado."; sin fila de promesa | Normal | Plegado | Normal |
| **Apagador apagado** (prod hoy) | Solo GPA: estado, días, salida estimada y "Capturado por GPA"; nada del taller | Oculto (`needs-hibrido`) | Plegado | Normal |
| **Visita cerrada / finalizada** | "Salió el …", días hasta la salida; liga: "Se cerró junto con la visita (Nombre)", "Liga cerrada con la visita" (legado) o "Sin liga" (§2 #13) | Normal (solo lectura por estado, como hoy) | Plegado | "+ Reingresar" visible; sin "✓ Finalizar" |
| **Viewer** | Completa, sin botones de liga | Sin Autorizar/No autorizar (como hoy) | "Ver datos", campos deshabilitados | Solo Cerrar y Expediente |
| **Sin nombre para la liga** | "emitida por un usuario de GPA el …" | — | — | — |
| **Campo inválido o llave ocupada al guardar** | — | — | Se despliega solo y marca el campo (§4.4) | Aviso de hoy |

## 6. Pruebas

**Pruebas de estructura que se ajustan a propósito (sin borrar lo que protegen):**

| Prueba | Qué fija hoy | Ajuste |
| ------ | ------------ | ------ |
| `tests/tallerBloqueProveedor.test.ts:8-20` | `#tf-proveedor` entre Identificación y Mantenimiento, con `needs-hibrido` | Nuevo orden: `#tf-ficha` → `#tf-proveedor` (con `needs-hibrido`) → `#tf-datos` → `>Identificación de la unidad<` → `<div class="tl-sec">Mantenimiento</div>`. Se agrega que ya no exista `<div class="tl-sec needs-hibrido">Proveedor</div>`. |
| `tests/tallerBloqueProveedor.test.ts:22-33` | Botones de liga dentro de `#tf-proveedor`, antes de `#tf-prov-partidas`, fuera del `.tl-mftr` | Dentro de `#tf-prov-liga`, antes de `#tf-prov-partidas` y fuera del `.tl-mftr`. Se agrega que `#tf-prov-liga` y `#tf-prov-taller` lleven `needs-hibrido`. |
| `tests/tallerPartidasEnRegistro.test.ts:54-60` | `_bnRepintar` llama a `_tfGastoPintar`, `_provPintar(e)`, `renderTaller` y `updateTallerBadge`, y **no** a `_provPartidas(` | Sin cambio. Se agrega que `_provPintar` llame a `_fichaPintar(e)` en su primera línea. |
| `tests/tallerPartidasEnRegistro.test.ts` (texto de totales, `:118`) | "Autorizado … · Esperando …" en la barra | Se mueve a la prueba de la ficha (§2 #19). |

**Se quedan intactas y deben seguir verdes:** `tallerBloqueProveedor.test.ts:44-74` (`__estadoLiga`, `__promesaTaller`, "km del taller", sin `innerHTML`, sin `24*60*60`, `if (e) _provPintar(e)`), `tallerOlaHonestidadUi.test.ts:272-276`, `286-335` y `412-429`, `tallerLigaCierreUi.test.ts:37-146` (la lista de `_clearInvalid` no cambia), `tallerSaveEntryGastoCandado.test.ts`, `tallerAntesDespuesMonolito.test.ts` (`tl-pill diag`), `tallerPanelRechazoVisibilidad.test.ts`, `tallerBandejaEntrada.test.ts`. **Cuidado con los cortes:** varias pruebas cortan cada función en el siguiente `\nfunction ` o `\nasync function ` (`tallerLigaCierreUi.test.ts:22-33`, `tallerPartidasEnRegistro.test.ts:5-9`), y `tallerBloqueProveedor` corta `openTallerModal` hasta `\nfunction closeTallerModal`. Por eso las funciones nuevas del monolito (`_fichaPintar`, `_tfAutofoco`, el recálculo de cambios) van en su propio bloque, **nunca entre `openTallerModal` y `closeTallerModal`**.

**Nuevas (unitarias puras):**

- `fichaRegistro`:
  - días de una visita abierta con el instante fijo `2026-09-30T16:00:00Z` (10:00 en CST) y entrada `2026-09-25`: da **6**, igual que la fórmula de la tabla (el Excel daría 5); días de una cerrada (hasta la salida real);
  - "N día(s) después de lo estimado" en singular y plural, y la prioridad de las señales de salida;
  - costo igual a `gastoDerivado` / `montoPendienteDeFirma`;
  - tri-estado del apagador: `hibrido === true` y no confiables da "sin datos" y nunca 0; `false` da "capturado"; desconocido da "capturado · verificando" y nunca menciona hallazgos;
  - la línea "Esperando firma" sale con pendientes y promesa vigente, y **no** sale con pendientes y promesa vencida.
- `ordenarHallazgos`: tres grupos en su orden y orden estable dentro de cada uno.
- `nombreDeUsuario`: sub en el directorio; perfil sin nombre; correo; propio ("tú"); `desconocido` como `ligaCreadaPor`; sub que no está; `cierre:correo`; `cierre:desconocido`; y **que la salida nunca parezca un GUID**.
- `hayCambios`: excluye un control `readOnly` en la foto y uno que pasó a `readOnly` después; `#tf-gasto` repintado no cuenta.

**Nuevas (estructura del monolito):**

- `#tf-ficha` sin `needs-hibrido` y sus piezas del taller con él; "✓ Finalizar" y "+ Reingresar" con `needs-write`.
- `clearTallerEntryFields` y la rama del alta de `openTallerModal` ocultan ficha, aviso y proveedor, limpian `#tl-msub`, abren `#tf-datos` y encienden Guardar.
- `_markInvalid` abre el `<details>`.
- `openModal` respeta `[data-autofocus]` dentro del `setTimeout`; en una visita guardada el atributo va en `#tl-mttl`, nunca en `btn-liga-copiar`, `#tf-aviso-firma` ni un botón de firma.
- `#tf-aviso-firma` se muestra con `hidden`, nunca con `style.display`.
- `_provFilaHistorial` corre con `window = {}` (sin `__nombreDeUsuario`) y no muestra GUID.
- La llegada del directorio no llama a `_provPartidas(` ni a `_provPintar(`.
- `_fichaPintar` y el pintado del nombre sin `innerHTML`.

**e2e:**

- WF1 y kpi-taller siguen como están, porque el alta abre desplegado. WF1 ya estaba roto por `#tf-area` (`tests/e2e/workflow.spec.ts:110`, fallo ambiental conocido).
- `antes-despues.spec.ts` sigue igual: el botón "Autorizadas" se queda. Solo se corrige su comentario de la línea 18.
- **Nueva** `tests/e2e/registro-ficha.spec.ts` sobre la demo de §8:
  - la ficha se ve, "Datos del registro" viene plegado y los hallazgos abren en "Todas" con "Esperan tu firma" primero;
  - al abrir una visita guardada, el foco está en el título y no en un botón de liga ni de firma;
  - Guardar está deshabilitado con "Sin cambios", y teclear en Km lo enciende;
  - la liga muestra un nombre y no un GUID;
  - Autorizar actualiza "Esperando tu firma" y no enciende Guardar;
  - abrir una visita guardada y luego "Agregar unidad": Guardar encendido y sin ficha;
  - a 390 px: sale el aviso y tocarlo lleva a la fila; una visita abierta muestra los 5 botones del pie, de al menos 44 px; y la página no tiene scroll horizontal;
  - el alta abre con el formulario.
- **Arneses locales de Chrome** en `.scratch` (liga-cierre 22/22, antes-después, seguimiento-proveedor 18/18): los que teclean o leen campos `tf-*` de una visita **guardada** deben abrir `#tf-datos` primero (`details.open = true`), porque ahora vienen plegados. Si no, fallan por visibilidad y no por el código. Se ajustan y se corren como parte de la compuerta antes del PR.
- Referencia completa: 60/67, con validación A/B contra la rama base.

**Obligatorio antes de cada commit que toque el HTML:**

- `npm run csp:sync`, porque `openTallerModal`, `_provPintar` y compañía viven en el `<script>` en línea de `HTML:1539` (trampa 1), y re-stagear `Control de flotilla.html` y `nginx.conf`.
- `npm run audit:csp` otra vez sobre el commit ya hecho, porque el hook reformatea.
- `npm run audit:xss`: todo con `createElement` y `textContent`; los nombres, las descripciones y los datos del taller los escriben terceros.
- Batería: `test:run`, `typecheck`, `lint` y `build`.

**Ambiental:** en este worktree falta `amplify_outputs.json` (se ignora en git). Por eso 3 suites no cargan (`tallerApagador`, `tallerOlaHonestidadUi`, `tallerSaveEntryGastoCandado`) y `npm run dev` no levanta. Antes de empezar se copia el de otro worktree que funcione. No es falla del código.

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
| ------ | ---------- |
| Quitar o renombrar un `tf-*` rompe Guardar sin avisar (TypeError). | Ningún id cambia. La ficha usa ids propios (`tf-ficha-*`), así que no hay dos elementos con el mismo id. |
| Campos plegados que la validación marca y enfoca sin que se vean. | `_markInvalid` abre el `<details>` (§4.4). |
| El foco inicial cae en "Copiar liga" (que emite en prod) o en "✓ Autorizar" (que firma), y un Enter de más desde la bandeja lo activa. | `[data-autofocus]` en el título para toda visita guardada (§4.4, §2 #24), con prueba de estructura y e2e. Los demás modales no cambian. |
| La ficha se queda vieja tras firmar, emitir o revocar. | `_fichaPintar` se llama desde `_provPintar`, que ya está en los cuatro puntos de repintado. |
| La llegada del directorio borra lo que alguien está escribiendo en "No autorizar". | Solo se reescriben los nodos de nombre por `textContent`; no se repinta la lista (§4.7 punto 1), con prueba. |
| Cifras de dinero que no cuadran entre sí. | Una sola fuente (§2 #19) para la ficha y el "suman $X"; la línea de `resumenPartidas` se quita. |
| La ficha y la tabla dicen días distintos, o una marca "PROMESA VENCIDA" y la otra no. | La ficha usa la fórmula de la tabla (§2 #25) y los mismos puentes con el mismo "hoy" (§4.2). El desfase con el Excel queda anotado como defecto previo. |
| El apagador apagado esconde datos de GPA, deja ver UI del taller o, antes de hidratar, habla de "hallazgos" que no existen. | `#tf-ficha` sin `needs-hibrido`; cada pieza del taller con el suyo; tri-estado del apagador en `fichaRegistro`. Hay prueba de estructura y unitaria. |
| Guardar se enciende solo (`#tf-gasto` repintado) o se apaga en un alta prellenada o un reingreso. | Los `readOnly` se excluyen en la foto y al comparar; la foto solo existe al editar; alta y reingresos la descartan y encienden Guardar (§2 #21). |
| Tocar la señal `#tf-gasto.readOnly` y pisar dinero firmado (R95). | El viewer usa `fieldset.disabled`, no `readOnly`. El candado no se toca. |
| `_provPintar` borra lo que se agregue en `#tf-prov-liga`. | Nada nuevo va ahí; el texto va en `#tf-prov-liga-meta`. |
| "Copiar liga" re-emite (reescribe quién la emitió, reinicia los 90 días y reabre una revocada) sin que se note. | "Emitir liga y copiar" cuando no está activa, y nota visible cuando está activa (§2 #20). |
| La lectura de `UserProfile` abre el login encima del modal o bloquea el pintado. | Lectura pasiva, en caché, que nunca llama a `ensureSession` ni bloquea; si falla, se calla y queda el respaldo. |
| El GUID se cuela en la pantalla por una ruta sin puente (pruebas, demo, `?e2e=1`). | Guarda `typeof` con respaldo sin GUID (§4.7 punto 4) y el crudo solo en un `WeakMap`. |
| `ligaCreadaPor` se pierde si se rompe el arrastre de columnas solo-nube al guardar (`HTML:11323-11334`). | `saveTallerEntry` no se toca, y `tallerLigaCierreUi` ya lo cubre. |
| Los reingresos heredan la ficha de la visita anterior. | Limpieza en `clearTallerEntryFields` (§2 #21), con su prueba. |
| El pie no cabe en celular. | Dos renglones en ≤768 px (§4.6) y e2e a 390 px con los 5 botones. |
| CSS compartido con otros modales, o estilos de fábrica del `<fieldset>`. | Clases nuevas o selectores acotados con `#taller-modal`; `#tf-datos-campos` sin borde, padding ni `min-inline-size` (§4.1). |
| Tema oscuro del boceto con `prefers-color-scheme`, que la app no usa. | Los tokens nuevos (`--tal-bg`, `--tal-bd`) se definen en `:root` y en `:root[data-theme="dark"]` (`main.css:196`). Se reutilizan `--cyan-ink`, `--Al` y `--acl`, que ya existen. |
| Olvidar `csp:sync` tira producción. | Paso fijo en cada tarea del plan y `audit:csp` sobre el commit. |
| Los arneses de Chrome fallan porque los campos vienen plegados y confunden la validación A/B. | Se ajustan para abrir `#tf-datos` (§6). |
| La demo de hoy no ejercita firmar ni trae liga ni reporte del taller. | Demo nueva con dobles locales (§8). |

## 8. Vista local para Navares (compuerta antes del PR)

Se arma con `npm run dev` y una demo nueva, `?e2e=1&demo=registro-ficha`, en `src/dev/demoRegistroFicha.ts`. Sigue el patrón de `src/dev/demoAntesDespues.ts`: solo corre en DEV con `?e2e=1`, se niega si hay una sesión real (`:119-122`), corta la red externa (`:70-92`) y reemplaza el guardado y la hidratación por dobles que no escriben (`:126-130`).

**Qué trae (todo simulado, nombres ficticios):**

- **Visita 1:** liga activa emitida por "Ana López" (nombre del directorio simulado), reporte del taller "reparando", promesa de salida un día después de la estimada, 4 hallazgos (uno esperando firma, uno autorizado sin foto del después, uno terminado con antes y después, uno de mano de obra).
- **Visita 2:** sin liga, sin hallazgos y sin reporte del taller.
- **Visita 3:** cerrada con liga-cierre, `ligaRevocadaPor: "cierre:ana@…"` ("Se cerró junto con la visita (Ana López)").
- **Visita 4:** liga revocada por un usuario con nombre, promesa del taller vencida y salida estimada vencida, con un hallazgo esperando firma (la lista la marca «Promesa vencida» y la frase de firma no sale).
- **Visita 5:** cerrada antes de liga-cierre ("Liga cerrada con la visita").
- La **tabla del Taller** de la demo con las cinco visitas y su pastilla en la columna "Proveedor", para contrastarla con lo que dice cada ficha.
- **"Agregar unidad" y "+ Reingresar"** funcionando, con el guardado simulado.
- Un selector arriba para cambiar entre **admin, Riesgos y viewer**, y para **prender y apagar el apagador**.
- Un **doble local de `__guardarDecisionPartida`** que cambia la partida en `__tallerPartidas` y llama a `_bnRepintar()`, para ver que Autorizar actualiza la ficha. La demo actual no lo permite (`HTML:8790-8792`).
- Un **doble del directorio**, con un usuario con nombre, uno sin nombre y uno que no existe (para ver el respaldo "un usuario de GPA"). Llega con 2 segundos de retraso, para ver que no borra lo que estás escribiendo.

**Qué es simulado:** la nube completa (guardar, firmar, liga, directorio). **Qué es real:** el HTML, el CSS, `openTallerModal`, `_provPintar`, `_provPartidas`, las funciones puras, la tabla y el visor.

**Qué revisar (en llano):**

1. Al abrir la visita 1, ¿entiendes "cómo va" sin bajar?
2. ¿Se distingue a la primera lo que dice GPA de lo que dice el taller?
3. ¿La liga dice un nombre y no un código raro?
4. Autoriza un hallazgo: ¿cambia el costo de arriba y Guardar sigue apagado?
5. Cambia el Km en "Editar datos": ¿se enciende Guardar?
6. En la visita 4, ¿la ficha y la tabla dicen lo mismo («Promesa vencida»)?
7. "Agregar unidad" y "+ Reingresar": ¿se ven como hoy, con el formulario abierto?
8. En la vista de celular (390 px): ¿el aviso de firma te lleva al hallazgo y los botones de abajo se leen bien?

**Opcional, con su usuario:** Navares puede abrir `npm run dev` con su sesión para ver sus unidades reales. ⚠️ Ese modo lee **y escribe en producción**: ahí no se toca Guardar, Autorizar, No autorizar ni "Copiar liga" (que **emite**). Se recomienda hacerlo con una cuenta viewer.

También se revisa en celular: el mismo `npm run dev` expuesto en la red local, o la vista de 390 px del navegador.

Navares la recorre. **Hasta que diga que está bien, no hay PR.**

## 9. Preguntas para Navares

1. **Nombre del taller:** ¿en "Técnico asignado" ustedes escriben el nombre del taller? Si sí, lo muestro junto a lo que reporta el taller; si ahí va una persona o casi siempre está vacío, dejo solo la palabra "TALLER".
2. **Si cierras el registro con cambios sin guardar** (con ✕, Cerrar, Esc, clic afuera, Finalizar o Expediente): hoy se pierden sin aviso. ¿Te pregunto "¿Descartar los cambios?" antes de cerrar? Te lo recomiendo, y es poco trabajo porque ya sabremos si hubo cambios.
3. **"Cotización" en la lista:** hoy la lista del Taller no muestra "Cotización" cuando hay firmas pendientes; lo que sale es la marca «Esperando firma». Por eso puse esa frase, que sí es cierta. ¿Te basta, o quieres que la lista muestre de verdad el estado "Cotización"? (Eso sería otro frente pequeño, porque ya cambia lógica.)
4. **Un defecto que ya existe hoy:** si reingresas una unidad **desde el registro** (no desde el historial), la visita nueva queda separada del historial de esa unidad. ¿Lo arreglo aparte en este mismo frente (es una línea, pero toca lógica), o lo anoto para otro?

## 10. Despliegue

1. `feat/taller-liga-cierre` y luego `feat/taller-antes-despues` pasan su prueba manual y se fusionan a `main`, en ese orden.
2. Se lleva `main` a esta rama (merge, no rebase) y se corre la batería.
3. Revisión final de la rama. No hay ruta pública nueva ni Lambda tocado, así que no aplica la revisión de seguridad del portal.
4. **Navares lo ve en local (§8) y da el visto bueno.**
5. PR → merge = deploy (Amplify). El push lo corre Navares desde el worktree del frente.
6. Humo en producción: con el apagador **apagado**, que la ficha muestre solo lo de GPA. Si se prende, repetir la visita 1 con la cuenta de Riesgos.
