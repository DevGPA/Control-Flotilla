# Taller — Esquema híbrido: ingreso por Riesgos, cotización por liga del proveedor, autorización por partida

- **Fecha:** 2026-09-04 · **Frente:** Taller · **Estado:** diseño validado, sin implementar
- **Pedido por:** Navares (Tesorería GPA) · **Usuaria principal:** Administración de Riesgos
- **Antecedentes:** revisión honesta del módulo Taller 2026-08-14 (P0 desplegado, backlog P1/P2) ·
  [brief Eco-Admin enlace solicitud↔carga](2026-07-27-brief-eco-admin-enlace-solicitud-carga.md)
  (de ahí se toma la lección del motivo de rechazo) ·
  [integración bidireccional FC↔Ops-GPA](2026-07-15-integracion-bidireccional-fc-opsgpa-design.md)

---

## 1. El problema

Hoy todo el registro de taller cae en el escritorio de Administración de Riesgos. Ella captura el
ingreso, persigue al taller por WhatsApp para saber qué encontró y cuánto cuesta, decide qué se
repara, y transcribe el resultado a la app. Tres consecuencias medibles:

1. **La evidencia no existe en el sistema.** Taller es el módulo del gasto más grande
   (39 registros, $218k medidos en agosto-2026) y el **único sin una sola foto adjunta**. La
   evidencia de por qué se gastó vive en el celular de alguien.
2. **La autorización no es verificable.** La decisión "sí se repara / no se repara" se toma por
   WhatsApp. No queda quién autorizó, cuándo, sobre qué precio, ni por qué se rechazó lo rechazado.
   Es el mismo hueco que se documentó en combustible: de 6 rechazos, **ninguno** tenía motivo escrito.
3. **El costo no se puede desarmar.** El formulario captura un solo "Subtotal ($)" y guarda
   refacciones y mano de obra en $0 fijos — las columnas de desglose del Excel salen en cero en el
   **100%** de los registros y mienten en apariencia.

## 2. La solución en una frase

Riesgos da el ingreso con los datos de la unidad y **genera una liga**. El proveedor abre esa liga en
su celular —sin cuenta, sin instalar nada—, sube cada hallazgo como una **partida** con foto,
descripción y precio, y Riesgos **autoriza o rechaza partida por partida** desde la app. El gasto de
la visita deja de ser un número tecleado: es la suma de lo que ella firmó.

## 3. Decisiones tomadas (con quién las tomó)

| # | Decisión | Elegido |
|---|---|---|
| 1 | Acceso del proveedor | **Liga firmada sin cuenta, por visita** (no cuenta Cognito, no MoreApp) |
| 2 | Granularidad de la autorización | **Partida por partida** |
| 3 | Alcance de la liga | **Todo el ciclo**: cotiza → ve lo autorizado → sube evidencia final y factura |
| 4 | Quién firma | **Solo Administración de Riesgos** (un nivel, sin umbral de monto) |
| 5 | Entrega de la liga | **Copiar y pegar en WhatsApp** (sin correo transaccional) |
| 6 | Hallazgos posteriores | **La liga sigue viva**: puede agregar partidas en cualquier momento |
| 7 | Catálogo de proveedores | **Texto libre por ahora**, acumulando datos para un catálogo en fase 2 |
| 8 | Dónde vive el formulario | **Lambda dedicado con Function URL** (no acceso guest al identity pool) |
| 9 | Dónde viven las partidas | **Registros propios** (modelo nuevo), no dentro del blob `datos` |
| 10 | Pantalla del proveedor | **Lista viva** con "Agregar hallazgo" que abre la cámara de una |
| 11 | Pantalla de Riesgos | **Bandeja de firmas** agrupada por unidad, dentro de la pestaña Taller |

**Revisión de gerencia (2026-09-04).** La propuesta se presentó a gerencia y **Óscar Cabrera
Rodríguez** dejó cinco peticiones. Se incorporan así:

| # | Petición de gerencia | Resolución |
|---|---|---|
| 12 | Recotizar la misma partida en otro taller | **Entra en Fase 1** — §6.4. Cierra el motivo "Precio alto — recotizar", que sin esto no lleva a ninguna parte |
| 13 | Ver todas las fotos de evidencia, no solo la miniatura | **Fase 1** — galería en las dos pantallas, §9.3 |
| 14 | Adjuntar la cotización en PDF, no obligatorio | **Fase 1**, a nivel de visita — §7.3 y §5.2. El PDF es respaldo; **las partidas son la fuente de verdad del monto** |
| 15 | Fecha del próximo servicio, capturada por el proveedor | **Fase 1 solo la captura** (fecha + km). El **aviso** queda fuera: la app no tiene hoy alertas de servicio próximo y ese diseño es aparte — §11 |
| 16 | Que se vea en la app de Operaciones-GPA | **Fuera de este frente.** El puente es de una vía: la auditoría del 2026-08-14 concluye que *nada regresa de FC a Ops*. Se atiende con un **brief al equipo de Eco-Admin pidiendo el canal de regreso completo** (taller + anulaciones + veredictos de tesorería), no con código aquí — §11 |
| 17 | Vista híbrida celular + computadora (Navares) | **Fase 1** — una sola interfaz adaptativa en **ambas** pantallas, §9.4 |

**Decisiones de arranque (2026-09-08, resueltas por Navares en el tablero de decisiones).**

| # | Decisión | Elegido | Consecuencia |
|---|---|---|---|
| 18 | Cuarto estado del proveedor | **Sí, "Esperando refacción", y esa espera NO cuenta como retraso del taller** | Obliga a registrar las transiciones de estado con hora — §6.1 |
| 19 | Motivos de rechazo | **Arrancar con los cinco, ajustar con el uso** (no se validan antes con Riesgos) | Obliga a poder leer lo que se escriba en "Otro" — §6.2 |
| 20 | Quién genera la liga | **Administración de Riesgos y admin** | §7.7 |
| 21 | Arranque | **Toda la flota de una, sin piloto** | Obliga a apagador de despliegue y a hoja de instrucciones para talleres — §14 |
| 22 | Firmas | **Una sola: Administración de Riesgos, sin umbral de monto** | Confirma la decisión 4. Ojo: lo resolvió Navares; **gerencia nunca contestó** ese punto de la propuesta |

**Descartado explícitamente:**
- *Cuenta Cognito para el proveedor* — reusaría todo lo probado, pero la fricción de correo y
  contraseña mata el flujo con talleres chicos.
- *El proveedor entra a la app como invitado* — exigiría abrir acceso guest al identity pool de
  PROD, y las reglas de AppSync son por modelo, no por fila: un invitado con lectura en `Taller`
  leería **todos** los registros. Rompe el aislamiento actual y es inaceptable en un repo público.
- *Formulario en MoreApp / Ops-GPA* — exige licencia/app del lado del taller y el camino de regreso
  (la autorización) no existe allá.

## 4. El contrato: quién llena qué

### 4.1 Administración de Riesgos — al dar el ingreso

| Campo | Origen |
|---|---|
| Eco, placas, submarca, sucursal | Autocompletado del catálogo (como hoy) |
| **Área** | **Automática**, del catálogo de la unidad — ver §8.1 |
| Tipo de mantenimiento (Preventivo/Correctivo) | Ella: es criterio de negocio, no del taller |
| Fecha de reporte de falla, fecha de atención en taller | Ella (la segunda es parte de la llave) |
| Proveedor (nombre) | Ella, texto libre |
| Comentario de la falla | Lo que reportó el operador |
| Kilometraje | **Opcional** para ella (antes obligatorio) — ver §8.2 |

Al guardar, un botón **"Copiar liga para el proveedor"**.

### 4.2 El proveedor — desde la liga

| Campo | Por qué él |
|---|---|
| Kilometraje | Tiene el tablero enfrente |
| Estado operativo (revisando / reparando / lista) | Es el único que sabe |
| Fecha estimada de salida | Es su compromiso — ver §8.3 |
| **Partidas**: fotos + descripción + tipo + precio | El corazón del esquema |
| Próximo servicio (fecha o km) | Es quien sabe "regrésala en 6 meses o a los 10,000" |
| Cotización en PDF — **opcional** | Su documento formal; no reemplaza las partidas (§7.3) |
| Evidencia final del trabajo + factura | Cierre del ciclo (fase 2 de entrega) |

El **segundo** taller, cuando hay recotización, llena **solo su precio** sobre la descripción y las
fotos del primero — nunca ve el precio que ya se cotizó (§6.4).

### 4.3 Administración de Riesgos — durante y al cierre

| Acción | Nota |
|---|---|
| Autorizar / rechazar cada partida | Con motivo de menú al rechazar |
| Pedir precio a otro taller | Al rechazar por "precio alto": emite la liga de recotización (§6.4) |
| Cerrar la visita: `Finalizado` + fecha real de salida | El cierre del gasto **no** lo firma el taller |
| Pedido ERP | Conciliación NetSuite, como hoy |
| Capturar partidas a mano | Salida de emergencia: taller que no usa la liga (§7.4) |
| ~~Subtotal~~ | **Se elimina de la captura**: es derivado — §8.4 |

## 5. Modelo de datos

### 5.1 Modelo nuevo: `TallerPartida`

Registros propios, **no** dentro del blob `datos` de `Taller`. Razón: el proveedor escribe desde el
taller al mismo tiempo que Riesgos tiene el registro abierto. Un blob JSON único se lee-modifica-
escribe completo, así que dos escritores concurrentes = **el último gana y las partidas del otro
desaparecen sin aviso**.

```
TallerPartida
  tenantId    string  required   ─┐
  visitaKey   string  required    │ identifier compuesto
  partidaId   string  required   ─┘   visitaKey = `${unitUid}|${fechaEntrada}`

  descripcion       string  required     // texto del proveedor — NO CONFIABLE (§7.5)
  tipo              enum ["refaccion","manoObra"]
  precio            float                // sin IVA
  estado            enum ["borrador","propuesta","autorizada","rechazada","terminada","cancelada"]
  motivoRechazo     string               // del menú cerrado
  motivoRechazoNota string               // solo cuando el motivo es "Otro"
  fotos             string[]             // llaves S3, prefijo propio (§7.3)
  evidenciaFinal    string[]             // fotos del trabajo terminado
  precioAutorizado  float                // congelado en el momento de la firma
  recotizaDe        string                // partidaId del que se está recotizando (§6.4)
  proveedorNombre   string                // quién cotizó ESTA partida (puede diferir del de la visita)
  creadoPor         string               // "liga:<hash8>" | "user:<sub>"
  creadoEn / propuestoEn / decididoEn / decididoPor / terminadoEn   string (ISO)
  version           integer default 1
```

`recotizaDe` es lo único que la recotización necesita: las partidas hermanas se agrupan al pintar
por esa referencia. **No hay tabla nueva de cotizaciones** — una recotización es otra partida que
apunta a la primera.

`identifier(["tenantId","visitaKey","partidaId"])` — sigue la convención de llaves naturales del
schema, y `visitaKey` empata exactamente con la llave de `Taller` (`tenantId`+`unitUid`+`fechaEntrada`),
que es la misma que ya compone `window.__tallerRefId` para la anulación.

**Autorización:** lectura aislada por tenant (incluye viewer); escritura `operativo`/`admin`; el
Lambda del portal escribe por IAM vía el grant a nivel de schema, igual que el webhook de MoreApp y
el receptor de Ops-GPA.

### 5.2 Cambios a `Taller`

Cuatro campos que el proveedor escribe **se promueven de `datos` a columnas reales**, por la misma
razón de concurrencia del §5.1: como columnas, DynamoDB las actualiza independientes y no hay
lectura-modificación-escritura del blob completo.

| Campo | Antes | Ahora |
|---|---|---|
| `km` | `datos.km` | columna `km: integer` |
| `estadoOperativo` | — (parte de `datos.estado`) | columna `estadoOperativo: enum` |
| `fsalidaEst` | `datos.fsalidaEst` | columna `fsalidaEst: string` |
| `fsalidaEstCompromiso` | — | columna `string`, **se escribe una sola vez** |

**Sin migración de datos:** se lee la columna y, si viene vacía, se cae a `datos.<campo>`. Es el
mismo patrón que ya usa `migrateEstado` para los estados legacy.

Se añaden además, en `datos` (no requieren consulta):
`proveedorNombre`, `proveedorKey` (slug normalizado, semilla del catálogo de fase 2),
`ligaVersion` (entero, para revocar), `ligaCreadaEn`, `reprogramaciones[] {fecha, motivo, en}`,
`cotizacionArchivos[] {key, nombre, subidoPor, subidoEn}` (los PDF del §7.3),
`proximoServicio {fecha, km}` (lo captura el proveedor; el taller suele decirlo en kilómetros, así
que se guardan los dos y cualquiera de los dos puede venir vacío),
`estadoHistorial[] {estado, desde}` (append-only, una entrada por transición de `estadoOperativo`;
es lo que permite pausar el reloj de cumplimiento — §6.1).

**No se guarda el token de la liga en ninguna parte.** Ver §7.1.

## 6. El ciclo

### 6.1 Estado de la visita: dos preguntas, no una

Un solo campo `estado` no puede representar a la vez "el taller está reparando" y "hay algo
esperando tu firma" — y ambas cosas son verdad todo el tiempo, porque el proveedor puede agregar
partidas en cualquier momento (decisión 6). Cuando se fuerza a un solo campo, **la que se pierde
siempre es la segunda**: el taller pone "En Reparación" y lo pendiente se esconde.

- **`estadoOperativo`** — lo mueve el proveedor, con cuatro botones en su idioma:
  `revisando` (🔧 Estoy revisando) · `reparando` (🛠 Ya estoy reparando) ·
  `esperandoRefaccion` (📦 Esperando la refacción) · `lista` (✅ Ya está lista).
- **Espera de autorización** — **nadie lo teclea**: es derivado, `count(partidas en estado propuesta) > 0`.
  El taller no lo puede apagar.
- **`Finalizado`** — solo Riesgos. Cierra el gasto.

El campo `estado` que hoy pinta la tabla y alimenta los filtros se **compone** para no romper nada:
si hay partidas propuestas → `Cotización` (con el conteo); si no → el mapeo del `estadoOperativo`
(`revisando`→`En Diagnóstico`, `reparando` y `esperandoRefaccion`→`En Reparación`,
`lista`→`Por recuperar`); y `Finalizado` gana sobre todo. Los cinco valores de `TallerEstado` y
`ESTADOS_ACTIVOS` sobreviven intactos. `esperandoRefaccion` se distingue con una **pill propia**
("📦 Esperando refacción"), igual que la pill de "VENCIDA +Xd" es un adorno sobre el estado, no un
estado más.

*Detalle histórico, para que nadie se confunda después:* el estado legacy "Esperando Refacciones"
migra hoy a `Cotización` vía `ESTADO_MIGRATION`. Eso se queda como está — solo afecta a registros
viejos. Los nuevos usan `estadoOperativo`.

**Por qué existe el cuarto botón (decisión 18).** El retraso más común no es que el taller no
trabaje: es que ya autorizaste, ya pidió la pieza y **está esperando que llegue**. Con tres botones
el taller tiene que poner "reparando" —que es falso— o dejarlo en "revisando". Y como el indicador
de cumplimiento mide contra la fecha prometida (§8.3), sin este estado **se le imputa al taller una
espera que es de su proveedor de refacciones**. Son dos problemas con dos responsables distintos.

**El reloj de cumplimiento se pausa** mientras `estadoOperativo === "esperandoRefaccion"`. Y eso
tiene una consecuencia de modelo que hay que aceptar de frente: para descontar el tiempo pausado
hay que **saber cuándo cambió de estado la visita**, así que se guarda
`estadoHistorial[] {estado, desde}` en `datos` (append-only; una entrada por transición).

Ese registro entrega gratis un pendiente que ya estaba en el backlog P2 desde agosto —
**timestamps por transición de estado**— y con él se puede contestar, por primera vez, dónde se
atoran las visitas: ¿cotizando, esperando tu firma, o esperando la pieza? Es el insumo de los
tiempos de respuesta del §10.3.

### 6.2 Vida de una partida

```
borrador ──► propuesta ──┬──► autorizada ──► terminada
   │             │       └──► rechazada (con motivo)
   │             │                 │
   └─────────────┴─────────────────┴──► cancelada
```

**Quién puede cancelar:** el proveedor, mientras la partida esté en `borrador` o `propuesta` (aún sin
firma). Una vez `autorizada` o `rechazada`, solo Riesgos la anula. En todos los casos la partida
cancelada **se conserva** con su rastro; no se borra.

Tres reglas que hacen que la firma valga algo:

1. **Una partida enviada se congela.** Editable solo en `borrador`. Después, no: si autorizas $4,200
   y el proveedor puede cambiarlo a $6,800 esa noche, la autorización no vale nada. Si se equivocó,
   la cancela y sube otra — **y queda el rastro de las dos**.
2. **Se autoriza un precio, no una idea.** Al firmar se copia el monto a `precioAutorizado`.
3. **Cambiar de opinión deja rastro.** Reabrir una decisión se registra con quién y cuándo; nunca se
   borra. Es el estándar del proyecto (anulación reversible, `Anulacion`).

**`borrador` existe por una razón práctica:** el taller sube seis fotos con calma y aprieta "Enviar a
autorización" **una sola vez**. Sin ese estado llegan seis avisos y se dejan de ver.

**Motivos de rechazo — menú cerrado:** *No es necesario ahora · Precio alto, recotizar · Se repara en
otro lado · No corresponde a esta unidad · Otro (escribir)*. Un menú se llena; un campo libre no —
eso ya está medido en combustible.

**Decisión 19: se arranca con estos cinco sin validarlos antes con Riesgos.** La contrapartida es
obligatoria, no opcional: **"Otro" tiene que ser legible, no una papelera.** El texto va a
`motivoRechazoNota` y la app expone un **conteo de los "Otro" con su texto** (en el mismo lugar
donde viven los indicadores del §10), porque eso es exactamente lo que dice qué opción falta en el
menú. Sin esa lectura, la decisión de "ajustar con el uso" no se puede ejecutar: no habría con qué
ajustar.

Cambiar el menú después es barato en código. Lo que **no** se recupera son los rechazos ya
capturados con el menú viejo — así que el reporte de "Otro" hay que revisarlo pronto, no al año.

### 6.3 Aviso a Riesgos

El badge que **ya existe** en la pestaña Taller (`#taller-badge`) pasa a contar partidas en estado
`propuesta`. Cero infraestructura de notificación. Requiere sumar `TallerPartida` a la hidratación
(`src/api/cloudHydrate.ts`).

### 6.4 Recotizar en otro taller

Petición 12 de gerencia. Sin esto, el motivo de rechazo *"Precio alto — recotizar"* es una promesa
sin destino: te deja rechazando sin ofrecerte la salida.

**Flujo.** Rechazas la partida con ese motivo → aparece **"Pedir precio a otro taller"** → Riesgos
escribe el nombre del segundo proveedor y el sistema emite una **liga de alcance de una partida**.
El segundo taller ve la descripción y **las fotos que subió el primero**, y solo captura su precio
(puede añadir fotos propias). Se crea una partida nueva con `recotizaDe` apuntando a la original y
su propio `proveedorNombre`.

**En la bandeja**, las hermanas se pintan juntas:
`Balatas delanteras — Frenos GDL $1,850 · Zapopan $1,240`, y se firma **una** de las dos. Autorizar
una recotización deja la hermana en `rechazada`; el rastro de las dos se conserva.

**Regla no negociable: el segundo taller NO ve el precio del primero.** El payload que sirve la liga
de recotización omite `precio` y `precioAutorizado` de la partida original — no lo oculta en el
cliente, no lo manda. Si lo viera, cotizaría un peso por debajo en vez de cotizar de verdad.

**Costo técnico bajo:** reusa la liga completa; lo único nuevo es el alcance por partida en el token
(§7.1). Efecto secundario bueno: el segundo taller ve **menos** de la visita que el primero, no más.

## 7. Seguridad de la liga

El repo es **público** y el backend corre en la cuenta AWS de **producción**. La liga es la única
superficie sin autenticar del sistema, así que se diseña con el patrón que ya está probado tres veces
en este repo (`moreapp-webhook`, `opsgpa-receptor`, `admin-users`).

### 7.1 El token

Lambda nuevo `taller-portal`, Function URL `authType: NONE`, y **la autenticación es la firma**:

- Token = `base64url(payload) + "." + HMAC-SHA256(payload, secret("TALLER_PORTAL_SECRET"))`.
- Payload: `{ t: tenantId, u: unitUid, f: fechaEntrada, v: ligaVersion, exp: epoch, p?: partidaId }`.
- **`p` es el alcance de recotización** (§6.4): cuando viene, la liga sirve **una sola partida** en
  modo "solo precio" — el resto de la visita no se envía. Es el alcance más estrecho de los dos, y
  cada liga de recotización lleva su propio `p`, así que revocarla no toca la liga principal.
- **Fail-closed:** sin el secreto configurado, todo request responde 401 (patrón `opsgpa-receptor`).
- Comparación con `timingSafeEqual` (ya se usa en `moreapp-webhook`).
- **El token no se guarda en la base.** Se valida por firma. Revocar = subir `ligaVersion` en el
  registro `Taller`; cualquier token con `v` distinta muere. Riesgos tiene botón "Revocar liga".
- Caducidad `exp` = 90 días desde la emisión, renovable generando liga nueva.
- **Alcance de una sola visita.** El Lambda toma `tenantId`/`unitUid`/`fechaEntrada` **del token**,
  nunca del body. No existe endpoint que liste ni busque nada.

### 7.2 La página la sirve el propio Lambda

`GET` con token válido devuelve el HTML autocontenido (tokens de diseño inline, ~10 KB) ya poblado
con la visita y sus partidas. Tres ventajas: no toca `Control de flotilla.html` (así que **no
dispara la trampa de re-sincronizar los hashes CSP**), no arrastra el JS de la app al celular del
taller, y no hay una URL de infraestructura escrita en el repo.

Contrapartida aceptada: los tokens de diseño se copian a ese archivo con un comentario que apunta a
`src/styles/main.css` como fuente de verdad. Si divergen, es cosmético.

### 7.3 Fotos y el PDF de la cotización

El proveedor **nunca** recibe credenciales de AWS. El Lambda emite un **PUT prefirmado** por archivo:

- **La llave la genera el servidor**, derivada del token:
  `photos/<tenantId>/taller-partidas/<visitaKey>/<uuid>.<ext>`.
  El cliente no elige ruta → no hay traversal ni riesgo de pisar fotos de inspecciones.
- **Fotos:** `Content-Type` restringido a `image/jpeg|png|webp`. Topes: 6 fotos por partida,
  60 partidas por visita.
- **PDF de la cotización** (petición 14, opcional): `application/pdf`, a nivel de **visita** —
  "la cotización" es un documento completo, no un renglón. Tope 10 MB, 3 archivos por visita.
  Se registra en `datos.cotizacionArchivos[]`.
- **El tipo se valida en el servidor**, no por la extensión que mande el cliente. Un archivo que no
  case con lo permitido se rechaza antes de emitir la firma.
- Vigencia corta (minutos).

**Regla de negocio del PDF, y va escrita en las dos pantallas:** *el PDF es respaldo documental; las
partidas son la fuente de verdad del monto.* Van a diferir tarde o temprano — la cotización impresa
trae IVA, redondeos o conceptos agrupados — y hay que saber de antemano cuál gana. El gasto de la
visita **siempre** sale de la suma de partidas autorizadas (§8.4), nunca del PDF.

**Lectura de archivos:** URL firmada por demanda al abrir, como ya se hace con las fotos de
inspecciones. **Nunca listar el bucket** — ese camino ya causó un incidente de "sin fotos
disponibles" en este proyecto.

### 7.4 Salida de emergencia

Riesgos puede **capturar partidas a mano** (llegó la cotización por WhatsApp). Mismo modelo, el autor
queda como `user:<sub>` en vez de `liga:<hash8>`. Sin esta salida el módulo se atora con el primer
taller sin smartphone — y va a pasar el primer día.

### 7.5 XSS: el riesgo nuevo y real

La descripción de la partida la escribe **un tercero no autenticado** y se pinta en la pantalla de
Riesgos. Es la primera entrada de texto libre no autenticada del sistema.

- Nada de `innerHTML` con esos datos, ni en la app ni en la página del portal. El guard es
  `npm run audit:xss` y debe seguir en verde.
- Validación de longitud y normalización en el Lambda (no solo en el cliente).
- Sanitizado también al exportar a Excel (prefijos `=`, `+`, `-`, `@` → escapado, para no inyectar
  fórmulas en la hoja).

### 7.6 Bitácora

Cada apertura de liga y cada escritura se registra: `liga:<hash8>` del token, IP, momento, acción.
Sirve para auditoría y para detectar una liga filtrada.

### 7.7 Quién puede generar y revocar una liga

**Decisión 20: Administración de Riesgos y `admin`.** Generar una liga es abrir una puerta sin
contraseña hacia una visita, así que el permiso coincide con quién firma — no es una acción de
captura cualquiera. El grupo `viewer` no puede, y `operativo` tampoco por sí solo.

Cada liga guarda **quién la generó y cuándo** (`ligaCreadaEn` + el usuario), de modo que una liga
filtrada tiene un responsable identificable. Revocar (subir `ligaVersion`) requiere el mismo
permiso.

Nota de implementación: hoy `operativo` y `admin` son los grupos globales de escritura del schema;
la restricción de este permiso se aplica en la UI **y** en el Lambda que emite la liga, no solo en
la UI.

## 8. Los cuatro arreglos que este frente arrastra

### 8.1 El área no se llena — causa raíz identificada

El autocompletado **sí** intenta ponerla ([`Control de flotilla.html:9208`](../../../Control%20de%20flotilla.html)),
pero falla en silencio: el catálogo de flota guarda `Logística` con acento (`cf-area`, línea 838) y
el menú de Taller solo acepta `LOGISTICA` en mayúsculas sin acento (`tf-area`, línea 1198).
Asignar a un `<select>` un valor que no está entre sus opciones lo deja vacío, sin error.

**Arreglo:** usar el mismo mapa que ya resolvió esto en Combustible — `unidadPorEco`
(`src/api/cloudHydrate.ts:741-747`, consumido en `src/fuel/mapEntry.ts:272`), que toma el área del
catálogo de unidades por eco. Unificar la grafía de Taller a la del catálogo (`Logística`, `Almacén`,
`Servicio Técnico`, `Mantenimiento`, `Administración`) y traducir los valores viejos al leer, con el
patrón de `ESTADO_MIGRATION`. Actualizar también el filtro `tl-filt-area` y `tallerStore.ts:73`.

**Efecto colateral bueno:** el área deja de ser capturable a mano en Taller, así que el gasto por área
empieza a cuadrar contra el de Combustible (misma fuente de verdad).

### 8.2 Kilometraje

Deja de ser obligatorio en el ingreso de Riesgos y pasa a ser obligatorio **para enviar** desde la
liga: el proveedor sube fotos desde el minuto uno, pero "Enviar a autorización" no se habilita sin
kilometraje ni fecha estimada. Se pide el dato cuando ya está invertido, no en la puerta.

Sin este dato el indicador **$/1,000 km** queda ciego, así que el bloqueo del envío es la garantía.

### 8.3 La fecha prometida es también el indicador de incumplimiento

La alerta "VENCIDA +Xd" desplegada en agosto compara contra la fecha **prometida**. Si el proveedor la
reescribe libremente, **borra su propio retraso** y la alerta se vuelve adorno.

**Arreglo:** la primera fecha que pone queda congelada en `fsalidaEstCompromiso` (se escribe una sola
vez, el Lambda rechaza sobrescribirla). Las siguientes se guardan en `reprogramaciones[]` con fecha y
motivo, `fsalidaEst` refleja la vigente, y la tarjeta muestra "reprogramada N veces". `diasVencida()`
pasa a medir contra el compromiso. **Dato nuevo que hoy no existe: qué taller cumple.**

**Y descuenta la espera de refacción** (decisión 18): `diasVencida()` resta el tiempo que la visita
pasó en `esperandoRefaccion`, leído de `estadoHistorial[]` (§6.1). Sin ese descuento el indicador
culparía al taller de esperas que no son suyas, y un indicador injusto se deja de usar en dos
semanas.

### 8.4 El subtotal se calcula, no se captura

Si el proveedor teclea un subtotal *y además* precios por partida, van a discrepar y no habrá forma
de saber cuál es verdad.

- `gasto` de la visita = **suma de `precioAutorizado` de las partidas autorizadas**.
- `gastoRef` = suma de las autorizadas de tipo `refaccion`; `gastoMO` = las de `manoObra`. **Con eso
  se arregla el desglose que hoy sale en $0 en el 100% de los registros** (pendiente P1 del backlog).
- Tres números nuevos por visita: **cotizado**, **autorizado**, **rechazado**.
- El campo `gasto` legacy se conserva para las visitas históricas: si no hay partidas, se usa el
  capturado. El guard de cobertura de `src/taller/exportExcel.ts` obliga a exportar los campos
  nuevos o justificarlos en `CAMPOS_OMITIDOS`.

## 9. Las dos pantallas

### 9.1 Proveedor — "lista viva" (maquetas validadas)

Una sola pantalla con scroll, móvil primero, sin navegación:

1. **Identificación de la unidad** (solo lectura): eco, placas, submarca, sucursal, área, tipo, fecha de ingreso.
2. **Banner ámbar** cuando falta algo para poder enviar ("Falta el kilometraje. Puedes seguir subiendo hallazgos.").
3. **La camioneta**: kilometraje, ¿cómo va?, estará lista, y **próximo servicio** (fecha o
   kilometraje — petición 15). Debajo, opcional: **"Adjuntar tu cotización en PDF"** (petición 14),
   con la leyenda de que el monto que cuenta es el de las partidas.
4. **Hallazgos**: tarjeta por partida con miniatura, descripción, tipo, precio y **su estado visible**
   — esperando autorización (violeta), autorizada (verde), no autorizada (tachada, **con el motivo
   entre comillas**). El taller ya no pregunta por WhatsApp qué procede: lo lee.
5. **"📷 Agregar hallazgo"** — abre la cámara directo, sin pantallas intermedias. Luego tres
   preguntas: qué encontraste · qué es (Refacción / Mano de obra, dos botones) · cuánto cuesta
   ("Precio sin IVA" dicho con letras). Guarda en **borrador**.
6. **Pie fijo**: *Cotizado* y *Autorizado* (dos números, no uno) + "Enviar N a autorización",
   deshabilitado con el motivo escrito abajo.

Se accede sin cuenta, funciona con una mano y con señal mala; el patrón de uso es **volver a entrar
varias veces al día**, y por eso se descartó el asistente por pasos.

### 9.2 Riesgos — "bandeja de firmas"

Pestaña Taller, sub-pestaña **"Por autorizar"** junto a Activas e Historial:

- **Franja de resumen**: "⚡ Esperando tu firma · N partidas en M unidades · Suman $X".
- **Un grupo por visita** (no por partida suelta), con encabezado de tres etiquetas:
  **Cotizado** · **Ya autorizado** · **"Esta unidad: $38,400 en 2026 · 4 visitas"**. Esa tercera
  etiqueta convierte la firma en una decisión y no en un trámite — y la app **ya calcula ese dato**,
  solo no está donde se necesita. Se muestran también las banderas: *VENCIDA +2d*, *reprogramada 2 veces*.
- **Renglón por partida**: miniatura (ampliable), descripción, tipo, precio grande, autoría
  ("Subió Frenos GDL · hoy 10:42 · desde la liga"), y dos botones **✓ Autorizar / ✕ No autorizar**.
  El rechazo abre el menú de motivos.
- **Pie del grupo**: "Si firmas las 2, lo autorizado de esta visita pasa a $5,230" +
  **"Autorizar las N"** + "Abrir expediente".

Agrupar por visita es deliberado: **autorizar partidas sueltas ciega al conjunto** — se pueden firmar
cuatro de $1,800 sin notar que van $7,200 en una unidad que ya lleva $38 mil en el año.

Cuando una partida tiene recotización (§6.4), las hermanas se pintan como un solo renglón con las
dos ofertas y **una sola decisión**.

### 9.3 Galería de fotos (petición 13)

La miniatura no basta: se autoriza mirando la evidencia.

- **En la liga:** tira de miniaturas de lo que ya subió; tocar abre la foto a pantalla completa; se
  puede **borrar una mientras la partida sea borrador** (después no, §6.2 regla 1).
- **En la bandeja:** clic en la miniatura abre el visor a pantalla completa con flechas para
  recorrer **todas** las fotos de la partida, y el contador "3 de 6".
- Reusa el visor y el patrón de URL firmada por demanda que ya existe para inspecciones. Los PDF de
  la cotización se abren en pestaña nueva, no en el visor.

### 9.4 Una sola interfaz, celular y computadora (petición 17)

No son dos productos: es el mismo código adaptándose. Y aplica a **las dos** pantallas, porque las
dos se usan en los dos lugares.

**La liga del proveedor** — hoy pensada para el celular junto a la camioneta, pero también se abre
desde la computadora de la oficina del taller:

| | Celular (< 720 px) | Computadora (≥ 720 px) |
|---|---|---|
| Estructura | Una columna, scroll | Dos columnas: datos de la camioneta fijos a la izquierda, hallazgos a la derecha |
| Fotos | Miniatura 40 px | Miniatura 96 px, galería en rejilla |
| Capturar | "📷 Agregar hallazgo" abre la cámara | "Agregar hallazgo" acepta **cámara o arrastrar archivos** |
| Pie | Fijo abajo, botón de ancho completo | En la columna izquierda, siempre visible |

**La bandeja de Riesgos** — hoy pensada para el escritorio, pero ella firma también desde el celular
cuando no está en la oficina:

| | Celular (< 720 px) | Computadora (≥ 720 px) |
|---|---|---|
| Grupo de visita | Apilado; las tres etiquetas de contexto pasan a dos renglones | Como la maqueta validada |
| Renglón de partida | Miniatura arriba, texto debajo | Miniatura a la izquierda, precio alineado a la derecha |
| Botones ✓ / ✕ | **Ancho completo, tamaño de pulgar** (mínimo 44 px de alto) | En línea, tamaño normal |
| Sub-pestañas | Deslizables horizontalmente | En línea |

Sin `min-width` que fuerce scroll horizontal del documento; el contenido ancho (tablas, galerías)
scrollea en su propio contenedor. Es el mismo estándar que ya se aplicó en la auditoría móvil de la
PWA.

## 10. Cómo se usa la información (lo que se desbloquea)

Ninguno de estos indicadores se puede calcular hoy:

1. **Cotizado vs autorizado vs rechazado**, por mes, sucursal, área y taller.
2. **Ahorro por triage**: "dejaste de gastar $X este trimestre" — el % de rechazo con su monto.
3. **Tiempos de respuesta**, separados: de ingreso a cotización (culpa del taller) y de propuesta a
   firma (**tu** SLA). Tapa el pendiente P2 de "timestamps por transición".
4. **Cumplimiento de fecha prometida** por taller, con las reprogramaciones contadas (§8.3).
5. **Desglose real refacción / mano de obra** (§8.4).
6. **Reincidencia**: la misma descripción de partida en la misma unidad dos veces en pocos meses =
   trabajo mal hecho o problema de raíz, no mala suerte.
7. **Comparativo entre talleres** — parcial ahora (por `proveedorKey` normalizado), completo cuando
   exista el catálogo de fase 2.
8. **Ahorro por recotización** (§6.4): la diferencia entre la oferta que se rechazó y la que se
   firmó, sumada por período y por taller. Es el número que justifica el esfuerzo de recotizar, y
   señala qué proveedor cotiza sistemáticamente por encima del mercado.
9. **Cumplimiento del servicio preventivo**: con `proximoServicio` capturado se puede medir cuántas
   unidades regresaron a tiempo — hoy no se sabe.

## 11. Fuera de alcance

Explícitamente **no** en este frente:

- Catálogo formal de proveedores con contactos (fase 2; ahora solo se acumula `proveedorKey`).
- Envío de la liga por correo transaccional.
- Segunda firma por umbral de monto.
- Facturación fiscal, validación de CFDI u OCR de la factura o de la cotización en PDF (solo se
  adjunta el archivo).
- **Alerta de servicio próximo** (petición 15): aquí solo se **captura** `proximoServicio`. La app no
  tiene hoy ningún aviso de mantenimiento por vencer, y diseñar uno —dónde avisa, con cuánta
  anticipación, a quién, y cómo convive con las alertas de Cumplimiento— es un frente propio. No se
  inventa de pasada.
- **Visibilidad en Operaciones-GPA** (petición 16): **no se puede construir desde este repo.** La
  auditoría del 2026-08-14 verificó que el puente es de una vía —*nada regresa de FC a Ops*— y el
  lado receptor vive en `DevGPA/Eco-Admin`, otro equipo. Se atiende con un **brief que pida el canal
  de regreso completo**: taller, las 22 anulaciones y los veredictos de tesorería, que ya eran
  invisibles para Ops antes de esta petición. Documento aparte, pendiente de escribir.
- Conexión Inspecciones → Taller (pendiente P1 propio, ya en backlog).
- Encender `USE_NEW_TALLER` (ver §12).

## 12. Restricciones del repo que este diseño debe respetar

1. **La UI viva es el monolito.** Los módulos TS de `src/taller/` corren tras `USE_NEW_TALLER`, que
   está apagado. La bandeja de firmas se construye **en el monolito**; la lógica pura (estados,
   totales, validaciones) va en `src/taller/` con tests, y el monolito la consume. Encender el
   espejo TS es un frente aparte y no se abre aquí.
2. **Sesiones paralelas comparten worktrees.** Verificar rama antes de commitear y stagear solo las
   rutas de este frente. **La rama actual es `feat/cumplimiento-expedientes`, de otro frente** — este
   trabajo necesita su propia rama/worktree.
3. **CSP:** si por alguna razón se toca un `<script>` inline de `Control de flotilla.html`, correr
   `npm run csp:sync`. El diseño evita esto sirviendo el portal desde el Lambda (§7.2).
4. **Íconos:** cualquier ícono Lucide nuevo exige re-correr `node scripts/gen-lucide-subset.mjs`.
5. **Anulación, nunca borrado.** Las partidas se cancelan/anulan con tombstone; jamás `delete`.
6. **Excel con formato = ExcelJS**, no `xlsx` community. Respetar el guard de cobertura de campos.
7. **Amplify sandbox corre en la cuenta AWS de PROD.** Probar el Lambda con cuidado y con datos de
   una visita de prueba.

## 13. Pruebas

- **Capa pura (vitest):** transición de estados de partida (incluida la prohibición de editar fuera de
  `borrador`), composición del `estado` de la visita, totales cotizado/autorizado/rechazado y
  desglose Ref/MO, congelado de `fsalidaEstCompromiso` y conteo de reprogramaciones, normalización de
  área con valores legacy.
- **Lambda del portal:** token válido / firma inválida / expirado / `ligaVersion` revocada / sin
  secreto configurado (fail-closed) / intento de pasar `unitUid` por el body / tope de partidas,
  fotos y PDF / `Content-Type` no permitido (incluido un PDF renombrado a `.jpg`) / llave de S3
  fuera del prefijo.
- **Recotización (§6.4):** un token con `p` sirve **una sola** partida y ninguna otra de la visita;
  **el payload no contiene `precio` ni `precioAutorizado` de la partida original** — este test es el
  que protege la regla no negociable, y debe fallar si alguien agrega el campo "para mostrarlo en la
  UI"; autorizar una hermana deja la otra en `rechazada`; una liga de recotización revocada no
  afecta la liga principal.
- **Vista híbrida (§9.4):** el documento no scrollea horizontalmente en 360 px de ancho en ninguna de
  las dos pantallas; los botones de firma miden al menos 44 px de alto en móvil.
- **Reloj pausado (§6.1 / §8.3):** una visita que pasó 5 días en `esperandoRefaccion` y venció por
  3 días reporta **0 días de retraso del taller**; `estadoHistorial` es append-only (una transición
  no borra las anteriores); dos transiciones al mismo estado seguidas no duplican la entrada; una
  visita sin historial (registro viejo) cae al cálculo actual sin romperse.
- **Permiso de liga (§7.7):** un usuario `viewer` u `operativo` no puede emitir ni revocar liga —
  verificado **en el Lambda**, no solo en la UI.
- **Apagador (§14.1):** con la bandera apagada, Taller se comporta exactamente como hoy y las
  partidas ya capturadas siguen visibles.
- **Concurrencia:** proveedor y Riesgos escribiendo la misma visita — verificar que no se pierden
  partidas ni campos (es la razón de ser de §5.1 y §5.2).
- **XSS:** `npm run audit:xss` en verde con descripciones hostiles; inyección de fórmula en el Excel.
- **e2e:** validar A/B contra `main` (referencia 47/54; 7 fallos ambientales conocidos).

## 14. Entrega en dos fases (secuencia, no recorte)

- **Fase 1 — el ciclo de decisión.** Modelo `TallerPartida`, columnas nuevas en `Taller`, Lambda del
  portal con la liga, pantalla del proveedor (cotizar + estado + km + fecha + próximo servicio +
  PDF opcional), bandeja de firmas, badge, **recotización en otro taller** (§6.4), **galería de
  fotos** (§9.3), **vista híbrida celular/computadora** (§9.4) y los cuatro arreglos del §8.
- **Fase 2 — el cierre.** Evidencia final del trabajo y factura adjunta, estado `terminada`, los
  indicadores del §10 y el catálogo de proveedores a partir de `proveedorKey`.
- **Aparte, sin dependencia de las fases:** el brief a Eco-Admin por el canal de regreso (§11).

**Nota de alcance:** gerencia aceptó que la recotización entre en Fase 1 sabiendo que la alarga. La
razón es que el motivo de rechazo *"Precio alto — recotizar"* ya forma parte del menú: entregar sin
la recotización dejaría ese botón sin destino. La alternativa descartada era quitar el motivo del
menú mientras tanto.

### 14.1 Arranque sin piloto (decisión 21)

Se prende para **toda la flota y todos los talleres a la vez**. Se eligió a sabiendas, contra la
recomendación de un piloto de dos semanas con un taller de confianza. Como no hay ensayo, dos
mitigaciones dejan de ser opcionales:

1. **Apagador de despliegue.** El esquema híbrido se enciende con una bandera que se puede **apagar
   sin volver a desplegar**. Si el primer día sale mal, Taller vuelve al comportamiento actual
   —captura manual completa por Riesgos— y los datos ya capturados se conservan. No se prende algo
   así en toda la flota sin freno de mano.
2. **Hoja de instrucciones para los talleres, de una página.** Sin piloto no hay un proveedor
   tolerante que aguante la primera versión torpe: van a ser todos a la vez y la primera impresión
   es la única. La hoja se manda junto con la liga.

Y una tercera que ya estaba en el diseño pero que aquí sube de importancia: la **anulación
reversible de partidas** (§6.2). Si a escala se capturan precios mal, hay que poder deshacer sin
borrar el rastro.
