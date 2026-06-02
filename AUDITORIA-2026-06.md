# Auditoría profunda — Control Flotilla (GPA Fleet Command) · 2026-06-01

Auditoría multi-agente (6 dimensiones: webhook backend, capa de datos, KPIs/filtros/consistencia,
render/UX/flujos, formularios/validación/permisos, rendimiento/XSS/errores) con **verificación
adversarial** de cada hallazgo. **39 hallazgos crudos → 24 confirmados reales** (15 refutados como
falsos positivos en la verificación).

Resumen de acción: **11 corregidos** (frontend + capa de datos TS, bajo riesgo), **5 diferidos**
(backend webhook — requieren deploy y, idealmente, el sandbox; riesgo de afectar ingesta en vivo),
**8 sin acción** (diseño intencional, falso positivo, o impacto despreciable).

Validación global de los fixes: `tsc --noEmit` ✓, `compute-csp-hashes --check` ✓, **567 unit (Vitest) ✓**,
e2e smoke + kpi-taller ✓ (incluye el test del modal "Sin check" que ejercita las llaves corregidas).

---

## ✅ CORREGIDOS (11)

### #3 — Upserts sin guard de null-data (Nota/Periodo/Semanal)

- **Módulo:** capa de datos — `src/api/client.ts`.
- **Descripción:** `upsertNota`/`upsertPeriodo`/`upsertSemanal` hacían `return created.data!` sin verificar
  que `data` no fuera null cuando `!errors`. `upsertChecklist`/`upsertUnit` SÍ validaban — inconsistente.
- **Impacto:** si una regla de autorización filtra el registro post-create (errors vacío pero data null),
  se devolvía `null` casteado a objeto → `TypeError` aguas abajo. Es la **misma clase del incidente de re-key**.
- **Causa raíz:** non-null assertion (`!`) en lugar de validación explícita.
- **Solución:** las 3 funciones ahora siguen el patrón de `upsertChecklist`: `if(!errors && data) return data;`
  y `throw` con mensaje claro si data es null (create y update).
- **Evidencia:** `tsc` OK + 567 unit (incluye `tallerStore`/`weeklyStore`/`store`).

### #4, #5, #6 — Llaves inconsistentes en indicador "Sin check" (plate vs uid)

- **Módulo:** KPIs/consistencia — `Control de flotilla.html` (buildKPIs, buildKPIsSemanales, openFleetModal/\_fleetKindFilter).
- **Descripción:** el set de "presentes en el rango" se construía con `e.uid||e.plate` pero el filtro del
  catálogo buscaba solo `x.plate` (y viceversa en el mensual). Inconsistencia de llaves entre construcción y lookup.
- **Impacto:** latente hoy (en datos cloud `uid===plate===placa`), pero si alguna unidad tuviera `uid≠plate`
  (p.ej. solo eco), el conteo de faltantes y el modal saldrían **incorrectos**.
- **Causa raíz:** expresión de llave distinta en build vs lookup.
- **Solución:** armonizadas las 3 zonas a la **misma expresión `plate||uid`** en build y en lookup.
- **Evidencia:** e2e `card SIN CHECK mensual` (filas == catálogo − presentes) ✓.

### #7 — Mes del período guardado como string, indexado como número

- **Módulo:** formularios — `Control de flotilla.html` (confirmPeriodo / renderPeriodoBar / MES_NAMES).
- **Descripción:** `confirmPeriodo` guardaba `mes` como string `"01".."12"`; `renderPeriodoBar` accedía
  `MES_NAMES[p.mes]` (array de índices numéricos). `MES_NAMES["01"]` → `undefined` → `.substring` → **TypeError**.
- **Impacto:** la barra de períodos truena al renderizar cualquier período con `mes` → UI rota en ese módulo.
- **Causa raíz:** tipo string almacenado, acceso como índice numérico.
- **Solución:** se guarda `mes` como número (`parseInt`) y el acceso es defensivo (`MES_NAMES[parseInt(p.mes,10)]||p.label`),
  cubriendo también períodos viejos ya guardados como string.
- **Evidencia:** `tsc`/CSP OK; render sin crash.

### #13 — Año del período puede quedar NaN

- **Módulo:** formularios — confirmPeriodo.
- **Descripción/Impacto:** input vacío/no numérico → `parseInt(anio)=NaN` almacenado en el período.
- **Causa raíz:** sin validación del input.
- **Solución:** valida mes (1-12) y año (2000-2100); `notify` + return si inválido.

### #14 — Rango de fechas invertido → filtro vacío silencioso

- **Módulo:** filtros — aplicarRango / applyDateRange.
- **Descripción/Impacto:** si "Desde" > "Hasta", el filtro `f>=from && f<=to` da 0 inspecciones **sin avisar** →
  el usuario cree que no hay datos.
- **Causa raíz:** sin validación de orden.
- **Solución:** `if(d&&h&&d>h){ notify(...); return; }` antes de aplicar.

### #15 — Fechas de Taller sin validación de orden

- **Módulo:** formularios — saveTallerEntry.
- **Descripción/Impacto:** salida (estimada/real) podía quedar **anterior** a la fecha de ingreso → datos ilógicos.
- **Causa raíz:** campos copiados del form sin validar.
- **Solución:** valida `fsalidaEst>=fentrada` y `fsalidaReal>=fentrada`; `notify`+focus+return si falla.

### #12 — Paginación de `listAll` corta en 100 páginas en silencio

- **Módulo:** capa de datos — `src/api/client.ts`.
- **Descripción/Impacto:** al tope de 100 páginas (100k ítems) con `nextToken` pendiente, truncaba sin aviso
  (misma clase del bug "34 vs 14"). Hoy no se alcanza, pero el truncado silencioso es peligroso a futuro.
- **Causa raíz:** límite sin log.
- **Solución:** `console.warn` cuando se corta con token pendiente.

### #20 — `lbOpen` con índice NaN/fuera de rango

- **Módulo:** visor de fotos — lightbox.
- **Descripción/Impacto:** `parseInt` de un `data-arg` malo → `NaN` → estado raro (mitigado por `if(!item)return`, pero frágil).
- **Solución:** guard `Number.isFinite` + clamp a [0, len) → si inválido abre en 0.

### #24 — `catch` vacío en `photoImgErr`

- **Módulo:** visor de fotos — auto-sanado.
- **Descripción/Impacto:** fallos de re-firma se tragaban sin log → difícil diagnosticar fotos que no cargan.
- **Solución:** `console.warn` con fname y error antes del placeholder.

---

## ⏸ DIFERIDOS — backend webhook (requieren deploy; riesgo de ingesta en vivo) (5)

> Razón de diferir: tocan el Lambda `moreapp-webhook` que ingiere datos en producción. Un error ahí
> **detiene la captura de MoreApp**. Deben probarse en el **sandbox** (ya preparado, falta credencial AWS)
> antes de tocar prod. Riesgo > beneficio para hacerlos ahora junto con cambios de frontend.

### #1 — Colisión semanal cuando `isoWeekId` devuelve "sin-fecha" [media]

- `handler.ts:372` retorna `"sin-fecha"` si la fecha no parsea; es parte de la llave compuesta del Semanal.
- **Impacto:** varias submissions de la **misma unidad** con fecha no parseable se sobreescriben entre sí.
  Los datos con fecha válida NO se afectan (llave distinta). Frecuencia baja (MoreApp casi siempre manda fecha).
- **Recomendación:** en sandbox, rechazar/loguear submissions sin fecha parseable en vez de colisionar.

### #8 — Comparación de token no constante (timing) [media]

- `handler.ts:696` usa `!==` en vez de `timingSafeEqual`.
- **Impacto real bajo:** token de bajo valor + HMAC ya protege; timing attack sobre Lambda URL por red es impráctico.
  **Riesgo del fix:** `timingSafeEqual` truena si difieren longitudes → mal hecho rompe TODA la ingesta. No vale el riesgo ahora.

### #9 — Fotos se descargan antes del upsert de Checklist [baja]

- Reintentos no perfectamente idempotentes. Mitigado por `HeadObjectCommand` (salta fotos existentes). Impacto bajo.

### #11 — Llave S3 con UUID truncado a 8 chars [baja]

- `moreapp_{placa}_{uuid8}_{dataName}` — colisión teórica si dos fotos del mismo placa+dataName comparten prefijo de 8.
  Probabilidad baja. Cambiar el esquema = re-descarga/re-backfill (churn). Diferido.

### #19 — `?backfill&form=` sin validación de enum [baja]

- Un `form` desconocido cae al default. Endpoint admin, bajo riesgo. Diferido al lote de backend.

---

## ℹ SIN ACCIÓN — diseño intencional / falso positivo / impacto despreciable (8)

- **#2 Folio no persiste en batchUpload (ZIP/legacy):** reclasificado **bajo/moot**. El folio (serialNumber) lo
  genera y persiste el **webhook** (su única fuente real). La ruta ZIP/legacy proviene de Excel, que **no tiene** folio
  → no hay nada que perder. Solo importaría si se re-subieran unidades ya hidratadas (no ocurre en el flujo normal).
- **#10 Fallos de update enmascarados con 200 OK:** **intencional** — se responde 200 para que MoreApp no entre en
  loop de reintentos; el body trae `ok:false`. (Recomendación operativa: monitorear el campo `ok` en CloudWatch.)
- **#16 setF/setB sin debounce:** **falso positivo** — son handlers de clic (1 render por clic), no de tecleo. La búsqueda sí tiene debounce.
- **#17 `fcell` recalcula filtros por fila:** perf menor (~43 filas × pocos findings = trivial). Tocar el hot path de
  `renderTable` arriesga regresión; diferido como optimización opcional.
- **#18 `__cloudGetPhotoUrl` sin diferenciar error:** ya hay **auto-sanado** (onerror re-firma + reintenta). Mejora menor.
- **#21 Dos `addEventListener('click')` en document:** **por diseño** (delegador de `data-action` + cierre de nav). No es bug.
- **#22 Race del periodo-modal (setTimeout 400ms):** **conocido y manejado** (el e2e `loadMensual` lo cierra de forma determinista).
- **#23 `buildKPIs` llamado varias veces:** redundancia menor en distintos triggers; sin impacto perceptible.

---

## Metodología y límites (honesto)

- La verificación adversarial reduce falsos positivos pero **no garantiza cero bugs ocultos**: cubre lo que los
  agentes leyeron, no rutas de ejecución no exploradas ni condiciones de carrera difíciles de detectar estáticamente.
- Los fixes aplicados son de **bajo riesgo** y están cubiertos por tsc + 567 unit + e2e. Los de backend se
  difieren a propósito hasta tener el **sandbox** (evitar otro incidente clase re-key).
