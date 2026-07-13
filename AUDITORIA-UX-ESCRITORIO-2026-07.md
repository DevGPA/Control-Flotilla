# Auditoría UX / diseño visual de escritorio — 2026-07-13

> **Alcance:** experiencia de uso en computadora (1366×768, 1440×900, 1920×1080), vistas
> Inspecciones, Semanales, Combustible, Taller, Unidades, Usuarios, Análisis, Cumplimiento,
> panel de detalle, filtros, tablas, modales y reportes. **Sin cambios de código** — este
> documento es el entregable; la implementación espera aprobación.
>
> **Metodología:** evidencia visual real contra prod (Playwright + Chrome del sistema,
> usuario Cognito temporal creado y **eliminado al terminar**, navegación de solo lectura;
> 68 capturas en `audit/ux-2026-07/<resolución>/<tema>/*.png`) + 4 análisis paralelos de
> código (layout, tipografía/densidad, accesibilidad con ratios de contraste calculados,
> consistencia). Verificación página completa: **cero scroll horizontal a nivel de página**
> en las 3 resoluciones (report.json); consola limpia (solo el 404 conocido de favicon).

---

## Calificación por dimensión

| Dimensión                             | Nota   | Hallazgo dominante                                                                       |
| ------------------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| Layout / aprovechamiento del viewport | **C+** | Solo Inspecciones se adapta a pantallas de ≤800px de alto; panel `#det` flota sobre todo |
| Legibilidad / tipografía              | **C+** | Datos reales (pills, celdas, badges) a 9–10px en escritorio                              |
| Consistencia entre vistas             | **C+** | 4 lenguajes de "tab activo", 3 estilos de "Aplicar", exportar con 3 diseños              |
| Accesibilidad                         | **B−** | Foco visible y modales centrales bien; filas de tabla inoperables por teclado            |
| Feedback / navegación                 | **B−** | Sin rótulo de vista; carga sin indicador fuera de Inspecciones                           |
| Tema / color                          | **B+** | Tokens sólidos, dark mode bien ejecutado; azul con 3 significados                        |

**Global: B−.** La base es sólida (el programa UX de junio/julio se nota: tokens, foco,
modales centrales, semáforo AA), pero hay **1 hallazgo crítico de encimamiento**, un grupo
de altos concentrado en Combustible/Semanales a 1366×768, y deuda de consistencia entre
vistas viejas (HTML) y módulos nuevos (`src/`).

---

## HALLAZGOS PRIORIZADOS

### 🔴 CRÍTICA

#### H1 — El panel de detalle de Inspecciones (`#det`) permanece abierto al cambiar de módulo y se encima sobre TODAS las vistas

- **Vista/flujo:** todas (abrir expediente en Inspecciones → cambiar a cualquier pestaña).
- **Resolución:** todas; a 1366×768 tapa **~37% del ancho** (x≈842→1342); a 1920 ~26%.
- **Impacto:** en Semanales oculta 2 KPIs y 4 columnas; en Combustible oculta 2 KPIs, los
  filtros de la derecha y las columnas Validación/Evidencias/Ubicación; en Cumplimiento
  oculta Vencidos/Por vencer; en Unidades/Usuarios oculta la columna de acciones. Además
  mezcla contexto: una ficha de Inspecciones "flota" sobre datos de Combustible.
- **Severidad:** **crítica** (viola directamente el criterio "ningún contenido encimado u oculto").
- **Evidencia:** `audit/ux-2026-07/1366x768/light/09-semanales.png`, `12-combustible-lista.png`,
  `13-combustible-dash.png`, `14-cumplimiento.png`, `16-unidades.png`, `17-usuarios.png`.
  Código: `showView()` (`Control de flotilla.html:6962+`) oculta `kpi/tb/periodo-bar/ops-row/tw`
  pero **nunca toca `#det`**; `#det` es `position:fixed; z-index:300` (`src/styles/main.css:1831-1843`).
- **Recomendación:** en `showView()`, al salir de Inspecciones llamar `closeDet()` (existe,
  `Control de flotilla.html:4062`). Opcional: recordar la unidad y reabrir al volver.
  Cambio de ~2 líneas en script inline → **requiere `csp:sync`**.

---

### 🟠 ALTA

#### H2 — El modal "Flota completa" abre DEBAJO del panel de detalle, y su botón de cerrar se dibuja en la esquina de la PANTALLA

- **Vista/flujo:** Inspecciones → expediente abierto → click en KPI "42 FLOTA" (u otro `openFleetModal`).
- **Resolución:** todas (peor a 1366: el panel tapa la mitad derecha del modal).
- **Impacto:** el modal queda parcialmente ilegible bajo el panel; el usuario no ve columnas
  ni el ✕ del modal (queda cubierto). El ✕ además se renderiza **sobre el header de la app**
  (esquina superior derecha de la pantalla), donde nadie lo busca y donde puede confundirse
  con los botones del header.
- **Severidad:** alta.
- **Evidencia:** `audit/ux-2026-07/1366x768/light/04-modal-flota.png` (panel sobre el modal;
  ✕ rojo arriba a la derecha del header). Código: `#fleet-modal{z-index:200}` **<** `#det{z-index:300}`
  (`main.css:1504` vs `:1834`); el botón usa `.dcls{position:absolute;top:10px;right:10px}`
  (`main.css:1897`) y la tarjeta `#fleet-modal > div` **no tiene `position:relative`**
  (`main.css:1510-1520`) → el ✕ se ancla al overlay de pantalla completa.
- **Recomendación:** (a) `position:relative` en `#fleet-modal > div` (o `position:static` en
  el botón, como ya hacen los otros modales); (b) normalizar la escala de z-index: modales
  siempre por encima de paneles flotantes (p. ej. subir `#fleet-modal` a la banda 900+).
  Solo CSS/markup → sin csp:sync.

#### H3 — La interacción principal (abrir expediente / detalle / orden de taller) no es operable por teclado

- **Vista/flujo:** Inspecciones (filas `#tbody`), Semanales (filas), Taller (filas), encabezados de ordenación `.th`, tiles KPI-filtro `.kc` inline de Semanales/Taller.
- **Resolución:** todas.
- **Impacto:** un usuario de teclado (o con lector) no puede abrir el expediente de una
  unidad ni editar una orden de taller; los módulos nuevos (Combustible, Cumplimiento) sí lo
  permiten — brecha viejo/nuevo. WCAG 2.1.1.
- **Severidad:** alta.
- **Evidencia:** filas creadas con `div.onclick` sin `tabindex/role/keydown`
  (`Control de flotilla.html:3925-3929`); delegador `data-action` solo escucha click (`:2342-2361`);
  `.th` con onclick sin teclado (`:500-506`); `.kc` inline sin role (`:7462+`, `:8081+`).
  Contraste positivo: Cumplimiento ya lo hace bien (`renderCumplimiento.ts:225-234`).
- **Recomendación:** añadir `tabindex="0"` + `role="button"` (o `link`) a filas clicables y
  extender el delegador `data-action` a `keydown` (Enter/Espacio). Patrón ya existente en
  Cumplimiento; replicarlo.

#### H4 — Solo Inspecciones se comprime en pantallas de poca altura; las demás vistas pierden la tabla a 1366×768

- **Vista/flujo:** Semanales, Combustible, Cumplimiento, Taller (y Usuarios/Unidades en menor grado).
- **Resolución:** 1366×768 (y cualquier laptop ≤800px de alto). A 1440×900 no aplica.
- **Impacto:** el chrome fijo (barra de período + fila de KPIs + barra de filtros, que en
  Combustible envuelve a 2–3 renglones por sus 7 selects) consume altura constante y deja
  ~6 filas visibles en Combustible y ~8 en Semanales. Inspecciones sí tiene alivio
  (`@media (max-height:800px)` comprime KPIs/mapa) — el resto no.
- **Severidad:** alta.
- **Evidencia:** `@media (max-height:800px)` solo toca ids del dashboard de Inspecciones
  (`src/styles/main.css:3873-3898`); capturas `1366x768/light/09-semanales.png` y
  `12-combustible-lista.png` (compárese el área de tabla con `1920x1080/light/*`).
- **Recomendación:** extender el mismo media query a las demás vistas: KPIs compactos
  (padding/`.kval` menores, `.ksub` oculto), barras a 1 renglón (selects más angostos), y
  en Combustible considerar colapsar la fila de KPIs a chips. Solo CSS.

#### H5 — Tabla de Combustible: 16 columnas con `nowrap` → scroll horizontal incluso a 1920; fechas partidas y nombres a 3–4 renglones a 1366

- **Vista/flujo:** Combustible · Lista.
- **Resolución:** 1366 (grave) y 1920 (persiste).
- **Impacto:** a 1366 la col. FECHA se parte en dos líneas ("2026-" / "07-13"), RESPONSABLE
  envuelve nombres completos a 3–4 renglones (filas de ~80px → solo ~6 visibles) y
  Validación/Evidencias/Ubicación exigen scroll lateral; en filas "Solicitud" 5 columnas
  (Litros/Monto/KM/L/T.captura/Alertas) van con "—" desperdiciando ancho. Logística y
  Tesorería leen esta tabla a diario.
- **Severidad:** alta.
- **Evidencia:** `1366x768/light/12-combustible-lista.png`, `1920x1080/light/12-combustible-lista.png`.
  Código: 16 columnas (`Control de flotilla.html:1025-1044`), `th{white-space:nowrap}` +
  `overflow-x:auto` (`main.css:5014-5037`).
- **Recomendación:** (a) `white-space:nowrap` + `min-width` en FECHA; (b) RESPONSABLE con
  `max-width` + `text-overflow:ellipsis` y nombre completo en `title`/tooltip (o formato
  "APELLIDO P. Nombre"); (c) evaluar **columnas por tipo de registro**: cuando el filtro es
  "Solicitudes", ocultar las 5 columnas de carga vacías (y viceversa), como ya hace el
  export; (d) mover Ubicación/Evidencias al drawer de detalle. Mayormente CSS + render TS.

#### H6 — Datos reales a 9–10px en escritorio (pills, celdas, badges)

- **Vista/flujo:** Semanales (pills de estado 10px, celdas 9–10px), Taller (celdas 10px,
  comentario multilínea 10px, headers 9.5px), Inspecciones (badge URGENTE/REVISAR 9px,
  inspector/KM/fecha 10px), Combustible drawer (etiquetas 9px), KPIs (`.klbl` 9px).
- **Resolución:** todas (es tamaño fijo; a mayor resolución peor densidad angular).
- **Impacto:** el contenido operativo —no decoración— queda por debajo del mínimo cómodo de
  lectura sostenida en monitor (~11–12px). 162 declaraciones ≤10px (87 HTML + 75 CSS); la
  propia escala de tokens arranca en 9px (`--text-2xs`), pensada para móvil de campo.
- **Severidad:** alta (grupo datos); media (micro-etiquetas de UI).
- **Evidencia:** `src/styles/main.css:148-149` (escala), `:5085-5091` (`.sw-pill` 10px),
  `:1757-1763` (`.pill` 9px), `:962-963` (`.klbl` 9px), `Control de flotilla.html:8209-8216`
  (celdas Taller 10px), `:7627-7652` (celdas Semanales 9–10px).
- **Recomendación:** establecer **piso de 11px para datos** en escritorio: subir `.sw-pill`,
  `.pill`, celdas de Taller/Semanales y `.klbl`→10.5px (como ya se hizo con `.hero-lbl`).
  Si se quiere conservar la densidad móvil, envolver los tamaños actuales en
  `@media (max-width:768px)`. Solo CSS.

#### H7 — Fuera de Inspecciones no hay indicador de carga: "Sin datos" engañoso durante la hidratación

- **Vista/flujo:** Combustible, Cumplimiento, Taller, Semanales, Usuarios, Unidades al entrar
  antes de que termine la sincronización con nube.
- **Resolución:** todas.
- **Impacto:** el usuario ve el empty-state ("Sin datos en el período") o tabla vacía y puede
  concluir que no hay registros; el único feedback es el punto `#hdot` del header, fácil de
  no ver. `showLoader()` solo maneja DOM de Inspecciones.
- **Severidad:** alta.
- **Evidencia:** `Control de flotilla.html:2555-2562` (showLoader acota a dz/ldr/tw/kpi/tb);
  empty-states por vista sin estado "cargando" (`:902`, `:1020`, `:1107`).
- **Recomendación:** estado "Cargando datos…" compartido para los empty-states mientras
  `cloudHydrate` no termina (una clase `.is-loading` en `body` + texto alterno), o skeleton
  simple. Cambio pequeño y reutilizable.

#### H8 — Ninguna vista anuncia su nombre; la jerarquía tipográfica está invertida

- **Vista/flujo:** todas (el único H1 es la marca del header; Análisis ni siquiera tiene encabezado).
- **Resolución:** todas.
- **Impacto:** el único wayfinding es el subrayado del tab (11px); en pantallazos que
  Tesorería comparte no queda rótulo de qué vista es. A la vez, el número KPI (22px) es el
  texto más grande de la app mientras su contexto va a 9px: los tamaños no siguen a la
  importancia.
- **Severidad:** alta (compuesto navegación+jerarquía).
- **Evidencia:** único heading nivel 1 en `Control de flotilla.html:133`; sin H2 de vista;
  `.kval` 22px vs `.klbl` 9px (`main.css:971-972` vs `:962-963`).
- **Recomendación:** rótulo de vista discreto y consistente (12–13px, peso 700, mayúsculas
  suaves) al inicio de la barra de cada vista (p. ej. donde hoy dice solo "Período:"), con
  `role="heading" aria-level="2"`. No requiere rediseño.

#### H9 — "Limpiar filtros" existe solo en Inspecciones (y Taller lo reimplementa distinto); Combustible tiene 7 selects sin reset

- **Vista/flujo:** Semanales, Combustible, Cumplimiento, Unidades, Usuarios.
- **Resolución:** todas.
- **Impacto:** revertir 5–7 filtros a mano; riesgo real de leer datos filtrados creyéndolos
  completos (Tesorería/Logística).
- **Severidad:** alta.
- **Evidencia:** `#btn-clear-filters` solo en Inspecciones (`Control de flotilla.html:472`);
  Taller botón inline propio (`:659-660`); Combustible 7 selects (`:948-990`) sin limpiar.
- **Recomendación:** reutilizar la clase `.clear-filters` existente en todas las barras con
  la misma conducta (aparece solo con filtros activos).

#### H10 — Cuatro "gramáticas" de navegación/acción conviven entre vistas

- **Vista/flujo:** todas.
- **Resolución:** todas.
- **Impacto:** el usuario re-aprende cada vista: tab activo con 4 tratamientos (subrayado
  `.mnav.on`, borde `.tl-subtab.on`, píldora `.uv-tab.on`, botón sólido `.fuel-seg-btn.on`);
  "Aplicar" del rango con 3 pesos (sólido / outline / inexistente en Combustible); la acción
  "Exportar" con 3 estilos y 2 íconos distintos (y ausente en Semanales/Cumplimiento);
  4 definiciones de botón primario (`.tl-add`, `.tl-save`, `.btn-accent`, `.aq-pri`);
  "Agregar" prominente en Taller pero discreto en Usuarios/Unidades.
- **Severidad:** alta (sistémico).
- **Evidencia:** `main.css:3659` vs `:3559` vs `:1099` vs `:4576` (tabs);
  `Control de flotilla.html:242` vs `:865` vs `:933-938` (Aplicar);
  `:624-625`, `:661-662`, `:1002-1015`, `:198` (exportar);
  `main.css:4110/4358/5250/3832` (primarios).
- **Recomendación:** consolidar por adopción incremental (patrón ya probado en el programa
  de julio): 1 estilo canónico de tab interna, `.btn-accent` como único primario de barra,
  un botón "Exportar" canónico (mismo ícono/verbo) presente en todas las tablas.

---

### 🟡 MEDIA

#### H11 — El panel `#det` (500px fijos) tapa la tabla en Inspecciones a 1366; el modo "tabla angosta" es código muerto

- **Resolución:** 1366 (tapa ~37%; a 1920 es aceptable).
- **Impacto:** para leer la tabla con el expediente abierto hay que arrastrar o cerrar el panel.
- **Evidencia:** `1366x768/light/02-inspecciones-detalle.png`; geometría JS `pw=500`
  (`Control de flotilla.html:5886-5888`); `#tw.narrow{flex:0 0 400px}` nunca se activa
  (`main.css:1429-1431`, solo `classList.remove` en `:1699`).
- **Recomendación:** en ≥1200px de ancho, activar el modo lado-a-lado real (revivir `narrow`:
  tabla cede espacio y nada se tapa); bajo 1200px, mantener flotante. También aplica al
  drawer de Combustible (600px, ~44% a 1366).

#### H12 — Columna de unidad truncada incluso a 1920 mientras "Comentarios" (1fr) va casi vacía

- **Vista:** Inspecciones. **Resolución:** todas (peor visibilidad del problema a 1920).
- **Impacto:** "FREIGHTLINER Chasis Cabin…", "GUZMAN DIAZ ANGEL AGUSTI…" cortados a media
  palabra en pantalla grande, con ~700px ociosos al lado.
- **Evidencia:** `1920x1080/light/01-inspecciones.png`; `--col-tpl: 36 96 148 110 92 1fr 76 86`
  (px fijos para nombre, 1fr para comentarios) `main.css:141`.
- **Recomendación:** plantilla fluida: `minmax(148px, 220px)` para unidad/inspector y
  `minmax(200px, 1fr)` para comentarios; añadir `title` con el nombre completo.

#### H13 — Los overlays "display:" no atrapan el foco ni lo mueven al abrir

- **Vistas:** Gasto, Tendencias, detalle Cumplimiento, mini-ficha unidad, Flota, lightbox.
- **Impacto:** Tab se escapa al fondo; el lector no anuncia el diálogo (WCAG 2.4.3/2.1.2).
  Escape sí funciona (ya parcheado).
- **Evidencia:** `_trapFocus` solo dentro de `openModal` (`Control de flotilla.html:5009-5011`);
  overlays abren con `style.display` (`:6441`, `:6095`, `wire.ts:157`, `:3799`, `:7256`).
- **Recomendación:** extraer el trap/foco de `openModal` a un helper y aplicarlo a los 6
  overlays (o migrarlos a `openModal`).

#### H14 — Estados ARIA ausentes en la navegación y filtros

- **Impacto:** lector de pantalla no anuncia vista activa ni filtros activados.
- **Evidencia:** `.mnav` sin `aria-current` (`:141-170`); chips toggle sin `aria-pressed`
  (`:460-464`); `.uv-tab`/`.tl-subtab` sin `role=tab/aria-selected` (`:684-685`, `:590-595`)
  — Combustible sí lo hace bien (`wire.ts:340-345`).
- **Recomendación:** `aria-current="page"` en `.mnav.on`; `aria-pressed` en chips;
  `role=tab`+`aria-selected` en sub-tabs (copiar patrón de Combustible).

#### H15 — Contraste: texto secundario bajo AA sobre fondos tintados; `--s4` falla

- **Impacto:** hints y textos secundarios sobre `--bg2/--bg3` quedan en 3.95–4.28:1;
  `--s4` como texto = 4.01:1 en claro (el comentario del código dice 4.5) y **2.53:1 en
  oscuro** (flechas de ordenación `↕` casi invisibles en dark).
- **Evidencia:** ratios calculados sobre `main.css:74-87, 200` (`--s2 #64748b`, `--s3 #6b7280`,
  `--s4 #75808e/#475569`, `--bg2 #eff1f5`, `--bg3 #e8eaf0`); usos `main.css:1595, 1628,
2260, 3302, 3913-3915, 5810`.
- **Recomendación:** oscurecer un paso el texto secundario cuando va sobre `--bg2/--bg3`
  (o aclarar esos fondos); corregir `--s4` dark a un gris ≥4.5:1 y actualizar el comentario.

#### H16 — Ocho anchos de modal, dos mecánicas y dos diseños de botón cerrar

- **Impacto:** cada diálogo "salta" distinto; el ✕ a veces es caja con borde, a veces
  carácter suelto; posición esquina vs cabecera.
- **Evidencia:** anchos 420/420/560/620/680/680/720/900 (`main.css:4262-4451`, `:1501`,
  markup `:252-389, 1131`); `.dcls` neutralizado inline en 4 modales (`:714, 801, 1147, 1259`).
- **Recomendación:** escala sm/md/lg (p.ej. 480/640/880) + un `.modal-close` único; aplicar
  al tocar cada modal (incremental).

#### H17 — Empty-states desiguales: Inspecciones sin mensaje de "0 resultados"; Taller con texto plano

- **Impacto:** tabla filtrada a cero parece rota; Semanales/Combustible/Cumplimiento ya
  comparten un patrón bueno (`.sw-empty`) que Taller e Inspecciones no usan.
- **Evidencia:** `#dz`/loader como único vacío de Inspecciones (`:479`); Taller inline en
  `<td>` (`:8185`, `:8370`).
- **Recomendación:** reutilizar `.sw-empty` en Taller e Inspecciones (con mensaje distinto
  para "sin datos" vs "0 con estos filtros" + botón limpiar filtros → conecta con H9).

#### H18 — Controles de fecha nativos sin `.field-input` en Semanales/Combustible; botón "Anulados" con 3 estilos inline

- **Impacto:** los controles más usados se ven distintos entre vistas (altura/borde nativos).
- **Evidencia:** `:863-864`, `:935-936` (dates sin clase) vs `:239-241`, `:651-657` (con);
  Anulados `:244-246` / `:867-869` / `:996-1001`.
- **Recomendación:** aplicar `.field-input` a los 4 dates restantes y una clase `.btn-anulados`.

#### H19 — Color con significado diluido: el azul significa 3 cosas; naranja vs ámbar ambiguos

- **Impacto:** azul = acción/marca, "En taller" y "info cosmética" (índigo hardcodeado);
  naranja `--O` (llanta crítica) casi indistinguible del ámbar `--A` (revisar) como nivel de
  gravedad.
- **Evidencia:** `main.css:90-111`; `.sw-pill-info #4338ca` (`:5118-5121`); hero cards
  `:290, 298, 306`.
- **Recomendación:** reservar azul de marca para acción; "En taller" a un neutro con ícono;
  decidir un solo escalón entre rojo y ámbar (el naranja sobra o sustituye al ámbar).

#### H20 — Textos en inglés/Spanglish y rótulo del header que se envuelve

- **Impacto:** heatmap de Taller con iniciales de día S/M/T/W/T/F/S **en inglés**; hints
  "90 DÍAS · HOVER VER COUNT", "CLICK BARRA → FILTRAR"; el estado "Datos del servidor (nube)"
  se envuelve a 3 renglones a 1366 y queda amontonado.
- **Evidencia:** `1366x768/light/10-analytics.png`, `01-inspecciones.png` (header).
- **Recomendación:** L-M-M-J-V-S-D (o Lu-Ma-Mi…), hints en español ("pasa el cursor para ver
  el conteo"), y acortar el estado del header ("● Nube" con `title` completo).

---

### 🟢 BAJA

- **H21 — z-index menores:** `#more-menu` (8500) se dibuja sobre modales (8000); toasts
  (9999, abajo-derecha) pueden tapar los botones inferiores de `#det`/`#fuel-det`.
  (`main.css:1210-1216`; `Control de flotilla.html:1281`).
- **H22 — Subutilización a 1920×1080:** mapa de flota topado a 150px aunque sobre espacio
  (`main.css:3861-3869`); gráficas a 260/320px fijos; Análisis en 2 columnas fijas
  (`main.css:5759-5762`) pudiendo ser 3 en ≥1700px.
- **H23 — Nombres accesibles menores:** `.det-compact`/`.det-pdf` solo con `title`
  (`:514-519`); filas de Combustible activan con Enter pero no Espacio y sin `role`
  (`renderTableCombustible.ts:442, 491-493`); desglose del donut de Taller solo por hover
  (`:8148-8156`).
- **H24 — Detalles de barra:** doble `margin-left:auto` en `#fuel-bar` (salto de bloque
  al envolver, `:999` y `:1005`); `.dtag` a 9px; KPI-bar del historial de Taller con
  scroll-x propio a 1366 (`main.css:3441-3453`).

---

## Lo que está bien (mantener y replicar)

- **Cero scroll horizontal a nivel página** en las 3 resoluciones (arquitectura de viewport
  fijo funciona); tablas contienen su scroll.
- **Foco visible global** (`:focus-visible` con outline de acento) — verificado en captura
  `19-foco-tab5.png`.
- **Dark mode sólido** (capturas dark/ sin fondos rotos; el fix del hardcode de Tendencias
  ya no reaparece).
- **Modales centrales** (`openModal`): focus trap, Escape, `aria-labelledby` — el estándar a
  extender (H13).
- **Semáforo AA verificado** (R 4.70 / A 5.02 / G 5.48 sobre blanco) y pills de Semanales
  todas AA (recalculadas).
- **Cumplimiento** como patrón de referencia: `.kc` con `role=button`+teclado, `.field-input`,
  empty-state compartido.
- Formularios con `label for`/`aria-label` completos; `fuel-seg-btn` con `role=tab` correcto.

---

## RECOMENDACIONES AGRUPADAS

### A. Correcciones rápidas (cambios chicos, seguros, alto retorno)

1. **H1** `closeDet()` en `showView()` al salir de Inspecciones (⚠️ csp:sync).
2. **H2** `position:relative` a la tarjeta del modal Flota + z-index a banda de modales.
3. **H5a** `nowrap` en FECHA y `ellipsis+title` en RESPONSABLE (Combustible).
4. **H9** `.clear-filters` reutilizada en Semanales/Combustible/Cumplimiento/Usuarios/Unidades.
5. **H18** `.field-input` en los 4 date inputs restantes; clase única para "Anulados".
6. **H20** Días en español en el heatmap; hints en español; header "● Nube".
7. **H14** `aria-current`/`aria-pressed`/`role=tab` (atributos, sin cambio visual).
8. **H23/H24** aria-labels de `.det-compact`/`.det-pdf`; Espacio en filas Combustible; quitar un `margin-left:auto`.

### B. Mejoras estructurales (lotes medianos, patrón reutilizable)

1. **H4** `@media (max-height:800px)` para Semanales/Combustible/Cumplimiento/Taller
   (KPIs compactos, barras a 1 renglón).
2. **H6** Piso tipográfico de 11px para datos en escritorio (pills, celdas, badges, `.klbl`),
   conservando los tamaños actuales solo bajo `max-width:768px`.
3. **H5b** Columnas por tipo en la tabla Combustible (Solicitud vs Carga) + mover
   Ubicación/Evidencias al drawer.
4. **H3** Teclado en filas de Inspecciones/Semanales/Taller + `.th` ordenables
   (delegador `data-action` + keydown; patrón Cumplimiento).
5. **H7** Estado "Cargando datos…" compartido en los empty-states durante hidratación.
6. **H8** Rótulo de vista consistente (H2 visual + `aria-level=2`) en las 8 vistas.
7. **H13** Helper de focus-trap aplicado a los 6 overlays "display:".
8. **H11/H12** Modo lado-a-lado real del `#det` en ≥1200px (revivir `narrow`) + plantilla
   de columnas fluida (`minmax`) en la tabla de Inspecciones.
9. **H10** Consolidación de familias: tab interna canónica, primario único, "Exportar"
   canónico (y añadirlo a Semanales/Cumplimiento).
10. **H16/H17** Escala de modales (sm/md/lg) + `.modal-close` único; `.sw-empty` en
    Taller/Inspecciones con variante "0 con estos filtros".

### C. Mejoras opcionales (pulido / decisión de producto)

1. **Lote 5 diferido (Semanales):** rediseño de densidad — 9 KPIs → chips, 13 columnas,
   5 pills×6 colores por fila. Requiere mockups y tu decisión (pendiente desde julio).
2. **H15** ajuste fino de contrastes secundarios (`--s4` dark, `--s2/--s3` sobre tintados).
3. **H19** semántica de color (azul solo acción; naranja vs ámbar).
4. **H22** aprovechamiento en 1920: mapa/gráficas con altura fluida, Análisis a 3 columnas.
5. **H21** ajustes de z-index menores (more-menu, toasts).

---

## PLAN DE IMPLEMENTACIÓN PROPUESTO (espera aprobación)

| Fase                                               | Contenido                                                                                 | Riesgo                               | Verificación                                                                                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **F1 — Encimamientos** (H1, H2 + A.8)              | closeDet en showView; fix ✕/z-index modal Flota; aria-labels menores                      | Bajo (2 líneas JS inline + CSS)      | typecheck, lint, vitest, audit:xss, **csp:sync + audit:csp**, e2e local A/B, captura visual de regresión |
| **F2 — 1366×768** (H4, H5a, H6)                    | media-query de altura para 4 vistas; fecha/responsable de Combustible; piso 11px de datos | Bajo-medio (solo CSS)                | suite + re-captura en 1366×768 y 1920 (comparar filas visibles)                                          |
| **F3 — Feedback y filtros** (H7, H8, H9, H18, H20) | loading compartido, rótulos de vista, limpiar filtros, field-input, textos ES             | Medio (toca render de varias vistas) | suite + e2e A/B + captura                                                                                |
| **F4 — Teclado y overlays** (H3, H13, H14)         | filas operables, focus-trap unificado, ARIA de estado                                     | Medio                                | suite + prueba manual de teclado + captura de foco                                                       |
| **F5 — Consistencia** (H10, H16, H17, H11/H12)     | familias canónicas, modales, empty-states, det lado-a-lado                                | Medio-alto (visual amplio)           | suite + captura comparativa por vista                                                                    |
| **F6 — Opcionales** (C.1–C.5)                      | Semanales (con mockups previos y tu decisión), contrastes, color, 1920                    | —                                    | según lote                                                                                               |

Cada fase = rama corta → suite verde → deploy → verificación en prod (formato de lotes ya
probado en los programas de junio/julio). F1 y F2 son independientes y pueden ir juntas si
prefieres un solo deploy.

## Criterios de aceptación (los tuyos, mapeados)

- Sin elementos superpuestos/cortados/ocultos en 1366/1440/1920 → **F1** (H1, H2) + F2 (H5).
- Vistas comprensibles sin capacitación → F3 (rótulos, loading, limpiar filtros).
- Información crítica y acciones visibles → F2 (piso 11px, filas visibles), F5 (primarios).
- Tablas legibles sin scroll-x evitable → F2/F5 (Combustible por tipo de registro).
- Modales/paneles no bloquean información → F1, F4, F5.
- Funcionalidad y lógica intactas → todos los lotes son CSS/markup/atributos + 2 líneas JS;
  cero cambios de reglas de negocio, permisos o datos.
- Verificaciones del proyecto → typecheck, lint, vitest, audit:xss, audit:csp (+csp:sync
  cuando se toque JS inline), e2e locales patrón A/B.
