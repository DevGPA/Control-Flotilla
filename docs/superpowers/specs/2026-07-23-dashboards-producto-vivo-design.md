# Spec — Rediseño "Producto Vivo" del módulo de dashboards + gráfica unificada de consumo

**Fecha:** 2026-07-23 · **Estado:** aprobado en mockups (companion visual), pendiente revisión de este spec
**Decisiones del usuario que fijan este diseño:**

1. Gráfica de consumo por sucursal y tendencia mensual **se fusionan en UNA tarjeta** con drill-down (aprobado 2026-07-22).
2. El detalle mensual usa el formato actual de la app: **barras de litros + línea de gasto** (doble eje, preferencia explícita del usuario sobre la regla anti-doble-eje).
3. Dirección visual **C · "Producto vivo"** elegida entre 3 propuestas — y se aplica a **todo el módulo de dashboards**, no solo a la gráfica nueva.

## 1. Alcance

### 1.1 Sistema visual "Producto Vivo" (tokens + componentes)

- **Tarjeta:** radius 18px, borde sutil, fondo con degradado vertical muy leve, sombra suave azulada (`0 10px 30px -12px rgba(ac, .18)`).
- **KPI-cards:** métricas en tarjetas individuales (valor 18px w750 tracking -.02em, etiqueta 11px), con **delta** vs periodo anterior (▲/▼, verde `--G` / rojo `--R`).
- **Controles píldora:** segmented control redondeado (fondo `--bg3`, opción activa con `--ac` y sombra).
- **Barras con degradado:** LinearGradient vertical del tono claro al oscuro del mismo hue; radius superior 5px; borde 1px del color de superficie (separación entre barras).
- **Animación de entrada:** 700ms solo en el primer render de cada vista; respetar `prefers-reduced-motion` (sin animación).
- **Paleta mensual categórica validada** (validador dataviz, 6 checks PASS):
  - Claro: verde `#047857` · azul `#1e4fa3` · ámbar `#b45309` (orden fijo).
  - Oscuro: `#45a87e` · `#3d8fd6` · `#bd8426` (ámbar recalibrado para banda de luminosidad dark).
- Todo cuelga del theming existente (`data-theme` + CSS vars en `main.css`); `chartTheme.ts` expone los tokens nuevos (gradientes, colores de mes, sombra).

### 1.2 Dónde se aplica

- **Dashboard de Combustible** (`src/fuel/fuelCharts.ts`, 6 charts + KPIs de `renderKpis.ts`).
- **Dashboard de Inspecciones** (`src/dashboard/charts.ts`, 6 charts + sus KPI strips).
- Estilos de tarjeta/controles compartidos en `main.css` (los módulos ya comparten clases).

### 1.3 Gráfica unificada de consumo (reemplaza 2 tarjetas del dashboard de Combustible)

- **Nivel 1 — Comparativo por sucursal:** barras verticales; toggle **[Total | Por mes]** (por mes = serie por mes con paleta categórica; total = barra única `--ac` con etiqueta de valor). Toggle de métrica **[Gasto $ | Litros]**. Códigos cortos en eje (MTY, GDL, CDMX, CUN, CSL, PVR, CEDIS), nombre completo en tooltip.
- **Regla de legibilidad:** rango de 1 mes → sin desglose (toggle oculto); 2–6 meses → barras agrupadas; 7+ → apiladas.
- **Drill-down:** click en sucursal → la misma tarjeta muestra su evolución mensual: **barras de litros (`--ac`) + línea de gasto (ámbar) con etiquetas "$Nk"**, doble eje (L izq., $ der.). Miga "←" para regresar. El selector de métrica se oculta en detalle (se ven ambas).
- **Evolución global:** botón "📈 Evolución global" (pie de tarjeta) → mismo detalle con todas las sucursales sumadas (sustituye a la tarjeta "Tendencia mensual" actual).
- **KPIs vivos:** gasto/litros/cargas del contexto (todas ↔ sucursal drilleada) sobre la gráfica.
- **Datos:** nueva agregación pura `aggByGroupAndMonth(entries, keyOf)` en `fuelAggregates.ts` (matriz grupo×mes con gasto/litros/cargas; solo `tipo="carga"`; mismo `montoEfectivo`). El drill-down NO altera el contexto de filtros global del módulo (a diferencia del cross-filter descartado).

### 1.4 Deltas de KPI — definición

- Comparan el rango filtrado vs el rango inmediato anterior de la misma longitud (ej. may–jul vs feb–abr).
- Si el rango anterior no tiene datos (histórico corto), el delta se omite (sin "0%" engañoso).
- Formato: `▲ 2.1%` / `▼ 1.4%`; color verde/rojo semántico (en gasto, ▲ es rojo suave — subir gasto no es bueno; en litros neutral `--s2`; definir por-KPI en la implementación con tabla explícita).

## 2. Lo que NO cambia

- Cero backend, cero puente, cero dependencias nuevas (ECharts ya está).
- Filtros existentes del módulo (fechas, sucursal, búsqueda), tabla, export Excel, anulaciones: intactos.
- Sin scripts inline nuevos → no requiere `csp:sync`. Logos/íconos PWA intactos.
- La vista de tabla/export permanece como alternativa accesible a las gráficas.

## 3. Pruebas

- **Capa pura:** `aggByGroupAndMonth` (orden cronológico, meses sin datos = 0, solo cargas, dedup por identidad ya upstream); cálculo de deltas (rango anterior, histórico corto); regla agrupadas/apiladas por número de meses; default del toggle según rango.
- **Regresión visual manual:** claro/oscuro en desktop + móvil (PWA), `prefers-reduced-motion`.
- **e2e locales** (`playwright.local.config.ts` + `gen-fixture-mensual.mjs`): smoke de los dashboards renderizando y del drill-down (click → detalle → regresar).

## 4. Fases sugeridas para el plan de implementación

1. **F1 — Tokens + componentes** (main.css + chartTheme.ts): tarjeta, KPI-card, píldoras, gradientes, animación/reduced-motion.
2. **F2 — Gráfica unificada de consumo** (agregado puro + chart + drill-down + evolución global + KPIs vivos) — sustituye las 2 tarjetas.
3. **F3 — Recolorear/restilizar los charts restantes de Combustible** con el sistema (sin cambiar su lógica).
4. **F4 — Dashboard de Inspecciones** al mismo sistema.
5. **F5 — Deltas de KPI** (capa pura + UI) y pulido final móvil.

Cada fase es desplegable por sí sola; F2 entrega el valor pedido originalmente aunque F3–F5 esperen.

## 5. Riesgos y mitigación

- **Doble eje en detalle:** decisión explícita del usuario (consistencia con la gráfica actual que su equipo ya lee). Mitigación: ejes rotulados con unidades a cada lado y tooltip con ambas magnitudes.
- **Animaciones en móvil de gama baja:** entrada única de 700ms, nada continuo; `prefers-reduced-motion` la elimina.
- **Worktree compartido entre sesiones:** implementación en **rama nueva desde `main`**, stageando solo rutas propias (memoria `control-flotilla-sesiones-paralelas`).
