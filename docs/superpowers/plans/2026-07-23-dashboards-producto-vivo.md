# Rediseño "Producto Vivo" de dashboards — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar el sistema visual "Producto Vivo" (dirección C aprobada en mockups) a los dashboards de Combustible e Inspecciones, y fusionar las tarjetas "Consumo por sucursal" + "Tendencia mensual" en una sola gráfica con drill-down.

**Architecture:** Un módulo compartido nuevo (`src/dashboard/chartVivo.ts`) concentra el estilo (gradientes, ejes, tooltip, animación) y ambos dashboards lo consumen; la gráfica unificada vive en `src/fuel/consumoUnificado.ts` con option-builders **puros** (testeables) separados del estado/DOM. Los datos salen de una agregación pura nueva `aggByGroupAndMonth`.

**Tech Stack:** TypeScript + Vite, ECharts (`echarts/core`, ya instalado), Vitest (`npm run test:run`), CSS vars con theming `data-theme` existente.

**Spec:** `docs/superpowers/specs/2026-07-23-dashboards-producto-vivo-design.md`

## Global Constraints

- **Rama:** `feat/dashboards-producto-vivo` creada desde `origin/main`. ⚠️ El worktree se comparte con otras sesiones: `git add` SOLO las rutas de este plan, nunca `git add -A` (memoria `control-flotilla-sesiones-paralelas`).
- **Cero dependencias nuevas.** ECharts ya está; no agregar librerías.
- **Paleta mensual validada (valores exactos, orden fijo):** claro `#047857 / #1e4fa3 / #b45309`; oscuro `#45a87e / #3d8fd6 / #bd8426`.
- **Ajuste al spec §1.3 (razonado):** barras **agrupadas solo hasta 3 meses** (la paleta categórica validada tiene 3 pasos; nunca ciclar tonos); 4+ meses → **apiladas** con rampa secuencial del azul `--ac` generada con `aclarar()`. 1 mes → toggle oculto.
- **`prefers-reduced-motion: reduce`** ⇒ `animationDuration: 0` en todos los charts y sin transiciones CSS nuevas.
- **Sin `<script>` inline nuevos** en `Control de flotilla.html` (solo markup) ⇒ NO se requiere `csp:sync`. Si por cualquier razón se tocara un `<script>` inline: correr `npm run csp:sync` (memoria `control-flotilla-deploy-csp`).
- **`.kc` (KPI) es compartido app-wide** (Taller/Semanales/Combustible/Cumplimiento): su restyle aplica a todas las vistas — decisión de consistencia, no accidente.
- **Textos UI en español, sentence case.** Verificación por tarea: `npm run test:run` y `npm run build` en verde.
- Deploy a prod SOLO con confirmación del usuario (PR, sin merge automático).

---

### Task 0: Rama de trabajo

**Files:** ninguno (git).

- [ ] **Step 1:** `git -C "c:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla" fetch origin main`
- [ ] **Step 2:** `git status --porcelain` — confirmar qué archivos ajenos están modificados (NO tocarlos ni stagearlos).
- [ ] **Step 3:** `git checkout -b feat/dashboards-producto-vivo origin/main`
- [ ] **Step 4:** `npm run test:run` — Expected: suite verde (línea base antes de tocar nada).

---

### Task 1: Tokens CSS "Producto Vivo"

**Files:**

- Modify: `src/styles/main.css` (bloque `:root` ~L73, bloque `:root[data-theme="dark"]` ~L191, `.chart-card` ~L5978, `.kc` ~L941)

**Interfaces:**

- Produces: CSS vars `--mes1 --mes2 --mes3 --vivo-shadow`; clases `.fuel-seg`, `.fuel-crumb`, `.consumo-kpis`, `.kdelta`, `.ghost-btn`, `.chart-card-foot`.

- [ ] **Step 1: Agregar tokens al `:root` claro (junto a --ac, ~L112):**

```css
/* Producto Vivo (spec 2026-07-23): paleta mensual categórica validada + sombra */
--mes1: #047857;
--mes2: #1e4fa3;
--mes3: #b45309;
--vivo-shadow: 0 10px 30px -12px rgba(30, 79, 163, 0.18);
```

- [ ] **Step 2: Agregar tokens al `:root[data-theme="dark"]` (~L219):**

```css
--mes1: #45a87e;
--mes2: #3d8fd6;
--mes3: #bd8426;
--vivo-shadow: 0 10px 30px -14px rgba(0, 0, 0, 0.5);
```

- [ ] **Step 3: Elevar `.chart-card` (~L5978).** Dentro del bloque existente, fijar/añadir estas declaraciones (conservar las demás):

```css
border-radius: 18px;
box-shadow: var(--vivo-shadow);
background: linear-gradient(180deg, var(--bg), color-mix(in srgb, var(--bg) 96%, var(--ac) 4%));
```

- [ ] **Step 4: Elevar `.kc` (~L941).** Añadir dentro del bloque existente (sin quitar nada):

```css
border-radius: 12px;
box-shadow: var(--vivo-shadow);
```

- [ ] **Step 5: Nuevas clases al final de main.css:**

```css
/* ── Producto Vivo — gráfica unificada de consumo ─────────────────────── */
.fuel-seg {
  display: inline-flex;
  background: var(--bg3);
  border: 1px solid var(--ln);
  border-radius: 999px;
  padding: 2px;
}
.fuel-seg button {
  border: 0;
  background: transparent;
  padding: 5px 13px;
  cursor: pointer;
  color: var(--s2);
  border-radius: 999px;
  font: 600 12px var(--fb);
  min-height: 30px;
}
.fuel-seg button.on {
  background: var(--ac);
  color: #fff;
  box-shadow: 0 2px 6px color-mix(in srgb, var(--ac) 40%, transparent);
}
.fuel-crumb {
  border: 1px solid var(--ln);
  background: var(--bg3);
  color: var(--w1);
  border-radius: 999px;
  padding: 3px 12px;
  cursor: pointer;
  font: 500 13px var(--fb);
}
.fuel-crumb:hover {
  border-color: var(--ac);
  color: var(--ac);
}
.consumo-kpis {
  display: flex;
  gap: 22px;
  flex-wrap: wrap;
  margin: 10px 2px 2px;
}
.consumo-kpis .ckpi .v {
  font: 650 18px/1.2 var(--fb);
  letter-spacing: -0.02em;
  color: var(--w1);
}
.consumo-kpis .ckpi .l {
  font: 400 11px var(--fb);
  color: var(--s2);
}
.chart-card-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.chart-card-foot .hintline {
  color: var(--s2);
  font-size: 11.5px;
}
.ghost-btn {
  background: none;
  border: 1px solid var(--ln);
  color: var(--s2);
  font: 500 11.5px var(--fb);
  padding: 5px 11px;
  border-radius: 9px;
  cursor: pointer;
  min-height: 30px;
}
.ghost-btn:hover {
  color: var(--ac);
  border-color: var(--ac);
}
.kdelta {
  font: 600 11px var(--fb);
  margin-left: 6px;
}
.kdelta.buena {
  color: var(--G);
}
.kdelta.mala {
  color: var(--R);
}
.kdelta.neutra {
  color: var(--s2);
}
@media (prefers-reduced-motion: reduce) {
  .chart-card,
  .kc,
  .fuel-seg button {
    transition: none !important;
  }
}
```

- [ ] **Step 6:** `npm run build` — Expected: OK sin errores.
- [ ] **Step 7:** Commit:

```bash
git add src/styles/main.css
git commit -m "feat(ui): tokens Producto Vivo — paleta mensual validada, sombras, pills y crumb"
```

---

### Task 2: Paleta mensual en chartTheme

**Files:**

- Modify: `src/dashboard/chartTheme.ts`

**Interfaces:**

- Produces: `TremorPalette.mes1 | mes2 | mes3: string` (leídos de las CSS vars de Task 1).

- [ ] **Step 1:** En el type `TremorPalette` agregar tras `ac2`:

```ts
mes1: string; // paleta mensual categórica validada (dataviz) — orden fijo
mes2: string;
mes3: string;
```

- [ ] **Step 2:** En `getTremorPalette()` agregar al objeto:

```ts
    mes1: readVar("--mes1"),
    mes2: readVar("--mes2"),
    mes3: readVar("--mes3"),
```

- [ ] **Step 3:** `npm run build` — Expected: OK.
- [ ] **Step 4:** Commit: `git add src/dashboard/chartTheme.ts && git commit -m "feat(charts): expone paleta mensual --mes1..3 en TremorPalette"`

---

### Task 3: Módulo compartido de estilo `chartVivo.ts`

**Files:**

- Create: `src/dashboard/chartVivo.ts`
- Test: `tests/chartVivo.test.ts`

**Interfaces:**

- Consumes: `TremorPalette` (Task 2).
- Produces:
  - `aclarar(hex: string, f: number): string` — mezcla hex hacia blanco, f∈[0,1].
  - `gradBar(hex: string): echarts.graphic.LinearGradient` — vertical claro→color.
  - `rampaSecuencial(hex: string, n: number): string[]` — n pasos claro→oscuro del mismo hue (para apiladas 4+ meses).
  - `animVivo(): { animationDuration: number; animationEasing: "cubicOut" }` — 700ms; 0 si reduced-motion o sin `window`.
  - `ejesVivo(p: TremorPalette)` — `{ axisLine:{show:false}, axisTick:{show:false}, axisLabel:{color:p.textSub,fontSize:10.5}, splitLine:{lineStyle:{color:p.ln,opacity:0.55}} }`.
  - `tooltipVivo(p: TremorPalette)` — fondo `p.bg`, borde `p.ln`, radius 10, sombra.

- [ ] **Step 1: Test que falla** (`tests/chartVivo.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import {
  aclarar,
  rampaSecuencial,
  animVivo,
  ejesVivo,
  tooltipVivo,
  gradBar,
} from "../src/dashboard/chartVivo";
import type { TremorPalette } from "../src/dashboard/chartTheme";

const P = {
  mode: "light",
  bg: "#fff",
  bg2: "#eee",
  bg3: "#ddd",
  ln: "#ccc",
  text: "#000",
  textSub: "#666",
  R: "#e11d48",
  A: "#b45309",
  G: "#047857",
  B: "#1d4ed8",
  O: "#ea580c",
  ac: "#1e4fa3",
  ac2: "#15397a",
  mes1: "#047857",
  mes2: "#1e4fa3",
  mes3: "#b45309",
} as TremorPalette;

describe("aclarar", () => {
  it("f=0 devuelve el color; f=1 devuelve blanco", () => {
    expect(aclarar("#1e4fa3", 0)).toBe("#1e4fa3");
    expect(aclarar("#1e4fa3", 1)).toBe("#ffffff");
  });
  it("f=0.5 mezcla a mitad de camino por canal", () => {
    expect(aclarar("#000000", 0.5)).toBe("#808080");
  });
});

describe("rampaSecuencial", () => {
  it("n pasos, monótona (más claro primero), termina en el color base", () => {
    const r = rampaSecuencial("#1e4fa3", 4);
    expect(r).toHaveLength(4);
    expect(r[3]).toBe("#1e4fa3");
    expect(new Set(r).size).toBe(4);
  });
});

describe("animVivo", () => {
  it("devuelve 700ms cubicOut (en node, sin matchMedia, no truena)", () => {
    expect(animVivo()).toEqual({ animationDuration: 700, animationEasing: "cubicOut" });
  });
});

describe("ejesVivo / tooltipVivo / gradBar", () => {
  it("ejes recesivos: sin axisLine ni ticks, splitLine suave", () => {
    const e = ejesVivo(P);
    expect(e.axisLine.show).toBe(false);
    expect(e.axisTick.show).toBe(false);
    expect(e.splitLine.lineStyle.opacity).toBeCloseTo(0.55);
  });
  it("tooltip usa superficie del tema", () => {
    expect(tooltipVivo(P).backgroundColor).toBe("#fff");
  });
  it("gradBar produce LinearGradient vertical con 2 stops", () => {
    const g = gradBar("#1e4fa3") as unknown as { colorStops: { color: string }[]; y2: number };
    expect(g.colorStops).toHaveLength(2);
    expect(g.colorStops[1]!.color).toBe("#1e4fa3");
    expect(g.y2).toBe(1);
  });
});
```

- [ ] **Step 2:** `npm run test:run -- tests/chartVivo.test.ts` — Expected: FAIL (módulo no existe).
- [ ] **Step 3: Implementación** (`src/dashboard/chartVivo.ts`):

```ts
/**
 * Estilo compartido "Producto Vivo" (spec 2026-07-23) para TODOS los charts ECharts
 * de la app: gradientes de barra, ejes recesivos, tooltip elevado y animación de
 * entrada (respetando prefers-reduced-motion). Puro salvo animVivo (lee matchMedia).
 */
import * as echarts from "echarts/core";
import type { TremorPalette } from "./chartTheme";

/** Mezcla un hex hacia blanco. f=0 → color, f=1 → blanco. */
export function aclarar(hex: string, f: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  const mix = (c: number) => Math.round(c + (255 - c) * f);
  const r = mix((n >> 16) & 255),
    g = mix((n >> 8) & 255),
    b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Degradado vertical claro→color para barras (dirección C). */
export function gradBar(hex: string): echarts.graphic.LinearGradient {
  return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: aclarar(hex, 0.28) },
    { offset: 1, color: hex },
  ]);
}

/** Rampa secuencial de un hue (claro→base) para apiladas de 4+ meses. */
export function rampaSecuencial(hex: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(aclarar(hex, 0.55 * (1 - i / Math.max(1, n - 1))));
  out[n - 1] = hex;
  return out;
}

/** Animación de entrada única; 0 si el usuario pide reduced-motion (o sin window). */
export function animVivo(): { animationDuration: number; animationEasing: "cubicOut" } {
  const reduce =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return { animationDuration: reduce ? 0 : 700, animationEasing: "cubicOut" };
}

/** Ejes recesivos: sin línea ni ticks, grid sutil. */
export const ejesVivo = (p: TremorPalette) => ({
  axisLine: { show: false },
  axisTick: { show: false },
  axisLabel: { color: p.textSub, fontSize: 10.5 },
  splitLine: { lineStyle: { color: p.ln, opacity: 0.55 } },
});

/** Tooltip flotante con la superficie del tema. */
export const tooltipVivo = (p: TremorPalette) => ({
  backgroundColor: p.bg,
  borderColor: p.ln,
  borderWidth: 1,
  padding: [8, 12],
  textStyle: { color: p.text, fontSize: 12 },
  extraCssText: "border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,.16)",
});
```

- [ ] **Step 4:** `npm run test:run -- tests/chartVivo.test.ts` — Expected: PASS (7 tests).
- [ ] **Step 5:** Commit: `git add src/dashboard/chartVivo.ts tests/chartVivo.test.ts && git commit -m "feat(charts): chartVivo — estilo compartido Producto Vivo con tests"`

---

### Task 4: Agregación pura sucursal × mes

**Files:**

- Modify: `src/fuel/fuelAggregates.ts` (después de `aggByMonth`, ~L236)
- Test: `tests/fuelGroupMonth.test.ts`

**Interfaces:**

- Consumes: `FuelEntry`, `montoEfectivo` (ya en el archivo).
- Produces:

```ts
export type CeldaConsumo = { litros: number; gasto: number; cargas: number };
export type ConsumoPorGrupoMes = {
  meses: string[]; // YYYY-MM cronológico
  grupos: string[]; // por gasto total DESC
  celdas: Record<string, Record<string, CeldaConsumo>>; // celdas[grupo][mes] SIEMPRE definida (0s)
  totalesGrupo: Record<string, CeldaConsumo>;
  totalesMes: Record<string, CeldaConsumo>;
};
export function aggByGroupAndMonth(
  entries: readonly FuelEntry[],
  keyOf: (e: FuelEntry) => string,
): ConsumoPorGrupoMes;
```

- [ ] **Step 1: Test que falla** (`tests/fuelGroupMonth.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { aggByGroupAndMonth } from "../src/fuel/fuelAggregates";
import type { FuelEntry } from "../src/fuel/types";

const carga = (over: Partial<FuelEntry>): FuelEntry =>
  ({
    tipo: "carga",
    eco: "12",
    loadId: "x",
    fecha: "2026-07-01",
    litros: 10,
    monto: 240,
    ...over,
  }) as FuelEntry;

describe("aggByGroupAndMonth", () => {
  it("matriz grupo×mes con celdas en 0 donde no hay datos, meses cronológicos, grupos por gasto DESC", () => {
    const m = aggByGroupAndMonth(
      [
        carga({ sucursal: "GDL", fecha: "2026-05-10", monto: 100, litros: 4 }),
        carga({ sucursal: "GDL", fecha: "2026-07-02", monto: 300, litros: 12 }),
        carga({ sucursal: "MTY", fecha: "2026-06-01", monto: 900, litros: 40 }),
      ],
      (e) => e.sucursal ?? "(sin dato)",
    );
    expect(m.meses).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(m.grupos).toEqual(["MTY", "GDL"]); // 900 > 400
    expect(m.celdas["GDL"]!["2026-06"]).toEqual({ litros: 0, gasto: 0, cargas: 0 }); // hueco = 0
    expect(m.celdas["GDL"]!["2026-07"]!.gasto).toBe(300);
    expect(m.totalesGrupo["GDL"]!.cargas).toBe(2);
    expect(m.totalesMes["2026-06"]!.gasto).toBe(900);
  });
  it("ignora solicitudes y fechas malformadas", () => {
    const m = aggByGroupAndMonth(
      [
        carga({ tipo: "solicitud", sucursal: "GDL" }),
        carga({ sucursal: "GDL", fecha: "sin-fecha" }),
        carga({ sucursal: "GDL", fecha: "2026-07-01", monto: 50 }),
      ],
      (e) => e.sucursal ?? "",
    );
    expect(m.totalesGrupo["GDL"]!.cargas).toBe(1);
  });
});
```

- [ ] **Step 2:** `npm run test:run -- tests/fuelGroupMonth.test.ts` — Expected: FAIL (`aggByGroupAndMonth` no exportada).
- [ ] **Step 3: Implementación** (añadir a `fuelAggregates.ts` tras `aggByMonth`):

```ts
export type CeldaConsumo = { litros: number; gasto: number; cargas: number };

export type ConsumoPorGrupoMes = {
  meses: string[];
  grupos: string[];
  celdas: Record<string, Record<string, CeldaConsumo>>;
  totalesGrupo: Record<string, CeldaConsumo>;
  totalesMes: Record<string, CeldaConsumo>;
};

const celdaCero = (): CeldaConsumo => ({ litros: 0, gasto: 0, cargas: 0 });
const sumar = (c: CeldaConsumo, litros: number, gasto: number): void => {
  c.litros += litros;
  c.gasto += gasto;
  c.cargas += 1;
};

/**
 * Matriz grupo×mes de consumo (solo cargas) para la gráfica unificada (spec
 * Producto Vivo 2026-07-23). Todas las celdas del producto cartesiano existen
 * (0s en huecos) — los charts no manejan undefined. Grupos por gasto DESC.
 */
export function aggByGroupAndMonth(
  entries: readonly FuelEntry[],
  keyOf: (e: FuelEntry) => string,
): ConsumoPorGrupoMes {
  const filas = new Map<string, Map<string, CeldaConsumo>>();
  const totalesGrupo: Record<string, CeldaConsumo> = {};
  const totalesMes: Record<string, CeldaConsumo> = {};
  const mesesSet = new Set<string>();
  for (const e of entries) {
    if (e.tipo !== "carga") continue;
    const mes = (e.fecha || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mes)) continue;
    const grupo = keyOf(e) || "(sin dato)";
    mesesSet.add(mes);
    let fila = filas.get(grupo);
    if (!fila) filas.set(grupo, (fila = new Map()));
    let celda = fila.get(mes);
    if (!celda) fila.set(mes, (celda = celdaCero()));
    const litros = e.litros ?? 0;
    const gasto = montoEfectivo(e);
    sumar(celda, litros, gasto);
    sumar((totalesGrupo[grupo] ??= celdaCero()), litros, gasto);
    sumar((totalesMes[mes] ??= celdaCero()), litros, gasto);
  }
  const meses = [...mesesSet].sort();
  const grupos = [...filas.keys()].sort(
    (a, b) => (totalesGrupo[b]?.gasto ?? 0) - (totalesGrupo[a]?.gasto ?? 0),
  );
  const celdas: Record<string, Record<string, CeldaConsumo>> = {};
  for (const g of grupos) {
    celdas[g] = {};
    for (const m of meses) celdas[g][m] = filas.get(g)?.get(m) ?? celdaCero();
  }
  return { meses, grupos, celdas, totalesGrupo, totalesMes };
}
```

- [ ] **Step 4:** `npm run test:run -- tests/fuelGroupMonth.test.ts` — Expected: PASS.
- [ ] **Step 5:** Commit: `git add src/fuel/fuelAggregates.ts tests/fuelGroupMonth.test.ts && git commit -m "feat(fuel): aggByGroupAndMonth — matriz sucursal×mes pura con tests"`

---

### Task 5: Option-builders puros de la gráfica unificada

**Files:**

- Create: `src/fuel/consumoUnificado.ts` (solo la parte pura en esta task)
- Test: `tests/consumoUnificado.test.ts`

**Interfaces:**

- Consumes: `ConsumoPorGrupoMes`, `CeldaConsumo` (Task 4); `TremorPalette` (Task 2); `ejesVivo/tooltipVivo/gradBar/rampaSecuencial/animVivo` (Task 3).
- Produces:

```ts
export type ModoDesglose = "oculto" | "agrupadas" | "apiladas";
export function modoDesglose(nMeses: number): ModoDesglose; // 1→oculto · 2-3→agrupadas · 4+→apiladas
export type MetricaConsumo = "gasto" | "litros";
export function codigoSucursal(nombre: string): string; // "Ciudad de México"→"CDMX", resto 3-4 letras
export function mesCorto(yyyymm: string): string; // "2026-05" → "may 26"
export function buildComparativoOption(
  p: TremorPalette,
  m: ConsumoPorGrupoMes,
  o: { porMes: boolean; metrica: MetricaConsumo },
): Record<string, unknown>;
export function buildDetalleOption(
  p: TremorPalette,
  m: ConsumoPorGrupoMes,
  grupo: string | null,
): Record<string, unknown>; // null = todas (evolución global)
```

- [ ] **Step 1: Test que falla** (`tests/consumoUnificado.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import {
  modoDesglose,
  codigoSucursal,
  mesCorto,
  buildComparativoOption,
  buildDetalleOption,
} from "../src/fuel/consumoUnificado";
import { aggByGroupAndMonth } from "../src/fuel/fuelAggregates";
import type { TremorPalette } from "../src/dashboard/chartTheme";
import type { FuelEntry } from "../src/fuel/types";

const P = {
  mode: "light",
  bg: "#fff",
  bg2: "#eee",
  bg3: "#ddd",
  ln: "#ccc",
  text: "#000",
  textSub: "#666",
  R: "#e11d48",
  A: "#b45309",
  G: "#047857",
  B: "#1d4ed8",
  O: "#ea580c",
  ac: "#1e4fa3",
  ac2: "#15397a",
  mes1: "#047857",
  mes2: "#1e4fa3",
  mes3: "#b45309",
} as TremorPalette;

const carga = (suc: string, fecha: string, monto: number): FuelEntry =>
  ({
    tipo: "carga",
    eco: "1",
    loadId: fecha + suc,
    fecha,
    litros: monto / 24,
    monto,
    sucursal: suc,
  }) as FuelEntry;

const MATRIZ = aggByGroupAndMonth(
  [
    carga("Guadalajara", "2026-05-01", 100),
    carga("Guadalajara", "2026-06-01", 200),
    carga("Monterrey", "2026-05-15", 900),
    carga("Monterrey", "2026-07-01", 100),
  ],
  (e) => e.sucursal ?? "",
);

describe("modoDesglose", () => {
  it("1→oculto, 2-3→agrupadas, 4+→apiladas", () => {
    expect(modoDesglose(1)).toBe("oculto");
    expect(modoDesglose(3)).toBe("agrupadas");
    expect(modoDesglose(4)).toBe("apiladas");
  });
});

describe("codigoSucursal / mesCorto", () => {
  it("códigos cortos estables", () => {
    expect(codigoSucursal("Ciudad de México")).toBe("CDMX");
    expect(codigoSucursal("Guadalajara")).toBe("GDL");
    expect(mesCorto("2026-05")).toBe("may 26");
  });
});

describe("buildComparativoOption", () => {
  it("por mes: una serie bar por mes con la paleta mensual en orden fijo", () => {
    const opt = buildComparativoOption(P, MATRIZ, { porMes: true, metrica: "gasto" }) as {
      series: { name: string; type: string; stack?: string }[];
      xAxis: { data: string[] };
    };
    expect(opt.series).toHaveLength(3);
    expect(opt.series.every((s) => s.type === "bar" && !s.stack)).toBe(true);
    expect(opt.xAxis.data[0]).toBe("MTY"); // grupos por gasto DESC → códigos
  });
  it("total: una sola serie con etiqueta visible", () => {
    const opt = buildComparativoOption(P, MATRIZ, { porMes: false, metrica: "litros" }) as {
      series: { data: number[]; label: { show: boolean } }[];
    };
    expect(opt.series).toHaveLength(1);
    expect(opt.series[0]!.label.show).toBe(true);
  });
  it("4+ meses → apiladas (stack)", () => {
    const m4 = aggByGroupAndMonth(
      ["2026-01", "2026-02", "2026-03", "2026-04"].map((mm, i) =>
        carga("GDL", `${mm}-10`, 100 + i),
      ),
      (e) => e.sucursal ?? "",
    );
    const opt = buildComparativoOption(P, m4, { porMes: true, metrica: "gasto" }) as {
      series: { stack?: string }[];
    };
    expect(opt.series.every((s) => s.stack === "meses")).toBe(true);
  });
});

describe("buildDetalleOption", () => {
  it("detalle de sucursal: barras de litros + línea de gasto en eje secundario", () => {
    const opt = buildDetalleOption(P, MATRIZ, "Guadalajara") as {
      series: { name: string; type: string; yAxisIndex?: number }[];
      yAxis: unknown[];
    };
    expect(opt.yAxis).toHaveLength(2);
    expect(opt.series[0]).toMatchObject({ name: "Litros", type: "bar" });
    expect(opt.series[1]).toMatchObject({ name: "Gasto", type: "line", yAxisIndex: 1 });
  });
  it("grupo null = evolución global (suma de todas)", () => {
    const opt = buildDetalleOption(P, MATRIZ, null) as { series: { data: number[] }[] };
    expect(opt.series[1]!.data).toEqual([1000, 200, 100]); // gasto por mes global
  });
});
```

- [ ] **Step 2:** `npm run test:run -- tests/consumoUnificado.test.ts` — Expected: FAIL (módulo no existe).
- [ ] **Step 3: Implementación** (crear `src/fuel/consumoUnificado.ts`):

```ts
/**
 * Gráfica unificada de consumo (spec Producto Vivo 2026-07-23): comparativo por
 * sucursal ⇄ detalle mensual (drill-down) ⇄ evolución global. Esta mitad del
 * módulo es PURA (option-builders testeables); el estado/DOM va en mountConsumo
 * (misma file, Task 6).
 */
import type { TremorPalette } from "../dashboard/chartTheme";
import { ejesVivo, tooltipVivo, gradBar, rampaSecuencial, animVivo } from "../dashboard/chartVivo";
import type { ConsumoPorGrupoMes, CeldaConsumo } from "./fuelAggregates";

const NUM = new Intl.NumberFormat("es-MX");
const PESO = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

export type ModoDesglose = "oculto" | "agrupadas" | "apiladas";
export type MetricaConsumo = "gasto" | "litros";

/** 1 mes → sin desglose · 2-3 → agrupadas (paleta categórica de 3) · 4+ → apiladas. */
export function modoDesglose(nMeses: number): ModoDesglose {
  if (nMeses <= 1) return "oculto";
  return nMeses <= 3 ? "agrupadas" : "apiladas";
}

const CODIGOS: Record<string, string> = {
  "ciudad de mexico": "CDMX",
  "ciudad de méxico": "CDMX",
  guadalajara: "GDL",
  monterrey: "MTY",
  cancun: "CUN",
  cancún: "CUN",
  cabos: "CSL",
  vallarta: "PVR",
  cedis: "CEDIS",
};
export function codigoSucursal(nombre: string): string {
  const k = nombre.trim().toLowerCase();
  return CODIGOS[k] ?? nombre.trim().slice(0, 4).toUpperCase();
}

const MES_NOMBRE = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];
export function mesCorto(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  return `${MES_NOMBRE[Number(m) - 1] ?? yyyymm} ${String(y).slice(2)}`;
}

const fmtK = (metrica: MetricaConsumo, v: number): string =>
  metrica === "gasto" ? `$${Math.round(v / 1000)}k` : `${NUM.format(Math.round(v / 1000))}k L`;
const celdaTxt = (c: CeldaConsumo): string =>
  `${PESO.format(Math.round(c.gasto))} · ${NUM.format(Math.round(c.litros))} L · ${c.cargas} cargas`;

/** Nivel 1 — comparativo por sucursal (Total | Por mes). */
export function buildComparativoOption(
  p: TremorPalette,
  m: ConsumoPorGrupoMes,
  o: { porMes: boolean; metrica: MetricaConsumo },
): Record<string, unknown> {
  const modo = modoDesglose(m.meses.length);
  const porMes = o.porMes && modo !== "oculto";
  const val = (c: CeldaConsumo) =>
    o.metrica === "gasto" ? Math.round(c.gasto) : Math.round(c.litros);
  const colores =
    modo === "apiladas" ? rampaSecuencial(p.ac, m.meses.length) : [p.mes1, p.mes2, p.mes3];
  const series = porMes
    ? m.meses.map((mes, i) => ({
        name: mesCorto(mes),
        type: "bar",
        ...(modo === "apiladas" ? { stack: "meses" } : {}),
        barMaxWidth: modo === "apiladas" ? 26 : 13,
        barGap: "25%",
        itemStyle: {
          color: gradBar(colores[i]!),
          borderRadius: modo === "apiladas" && i < m.meses.length - 1 ? [0, 0, 0, 0] : [5, 5, 0, 0],
          borderColor: p.bg,
          borderWidth: 1,
        },
        data: m.grupos.map((g) => val(m.celdas[g]![mes]!)),
        label: { show: false },
      }))
    : [
        {
          name: "Total",
          type: "bar",
          barMaxWidth: 26,
          itemStyle: { color: gradBar(p.ac), borderRadius: [5, 5, 0, 0] },
          label: {
            show: true,
            position: "top",
            color: p.textSub,
            fontSize: 10,
            formatter: (pt: { value: number }) => fmtK(o.metrica, pt.value),
          },
          data: m.grupos.map((g) => val(m.totalesGrupo[g]!)),
        },
      ];
  return {
    ...animVivo(),
    grid: { left: 6, right: 6, top: porMes ? 30 : 26, bottom: 4, containLabel: true },
    legend: porMes
      ? {
          top: 0,
          left: 0,
          itemWidth: 10,
          itemHeight: 10,
          icon: "roundRect",
          itemGap: 14,
          textStyle: { color: p.textSub, fontSize: 11 },
        }
      : { show: false },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: p.bg3, opacity: 0.5 } },
      ...tooltipVivo(p),
      formatter: (ps: unknown) => {
        const arr = ps as { dataIndex: number; seriesName: string; marker: string }[];
        const g = m.grupos[arr[0]!.dataIndex]!;
        if (!porMes)
          return `<b>${g}</b><br/>${celdaTxt(m.totalesGrupo[g]!)}<br/><span style="opacity:.6">Click para ver detalle mensual</span>`;
        const lineas = arr.map(
          (a, i) =>
            `${a.marker} ${a.seriesName}&nbsp;&nbsp;${celdaTxt(m.celdas[g]![m.meses[i]!]!)}`,
        );
        return `<b>${g}</b><br/>${lineas.join("<br/>")}<br/><span style="opacity:.6">Click para ver detalle mensual</span>`;
      },
    },
    xAxis: {
      type: "category",
      data: m.grupos.map(codigoSucursal),
      ...ejesVivo(p),
      axisLabel: { color: p.textSub, fontSize: 10.5, interval: 0 },
    },
    yAxis: {
      type: "value",
      ...ejesVivo(p),
      axisLabel: { color: p.textSub, fontSize: 10.5, formatter: (v: number) => fmtK(o.metrica, v) },
    },
    series,
  };
}

/** Nivel 2 — detalle mensual (grupo, o null = todas): barras litros + línea gasto (formato actual de la app, decisión del usuario). */
export function buildDetalleOption(
  p: TremorPalette,
  m: ConsumoPorGrupoMes,
  grupo: string | null,
): Record<string, unknown> {
  const celda = (mes: string): CeldaConsumo =>
    grupo ? m.celdas[grupo]![mes]! : (m.totalesMes[mes] ?? { litros: 0, gasto: 0, cargas: 0 });
  const nombre = grupo ?? "Todas las sucursales";
  return {
    ...animVivo(),
    grid: { left: 6, right: 6, top: 30, bottom: 4, containLabel: true },
    legend: {
      top: 0,
      left: 0,
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 14,
      textStyle: { color: p.textSub, fontSize: 11 },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: p.bg3, opacity: 0.5 } },
      ...tooltipVivo(p),
      formatter: (ps: unknown) => {
        const i = (ps as { dataIndex: number }[])[0]!.dataIndex;
        return `<b>${nombre} · ${mesCorto(m.meses[i]!)}</b><br/>${celdaTxt(celda(m.meses[i]!))}`;
      },
    },
    xAxis: { type: "category", data: m.meses.map(mesCorto), ...ejesVivo(p) },
    yAxis: [
      {
        type: "value",
        ...ejesVivo(p),
        axisLabel: {
          color: p.textSub,
          fontSize: 10.5,
          formatter: (v: number) => `${NUM.format(Math.round(v / 1000))}k L`,
        },
      },
      {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          color: p.textSub,
          fontSize: 10.5,
          formatter: (v: number) => `$${Math.round(v / 1000)}k`,
        },
      },
    ],
    series: [
      {
        name: "Litros",
        type: "bar",
        barMaxWidth: 44,
        itemStyle: { color: gradBar(p.ac), borderRadius: [5, 5, 0, 0] },
        data: m.meses.map((mes) => Math.round(celda(mes).litros)),
      },
      {
        name: "Gasto",
        type: "line",
        yAxisIndex: 1,
        smooth: true,
        symbol: "circle",
        symbolSize: 8,
        lineStyle: { width: 2.5, color: p.mes3 },
        itemStyle: { color: p.mes3, borderColor: p.bg, borderWidth: 2 },
        label: {
          show: true,
          position: "top",
          color: p.textSub,
          fontSize: 10.5,
          formatter: (pt: { value: number }) => `$${Math.round(pt.value / 1000)}k`,
        },
        data: m.meses.map((mes) => Math.round(celda(mes).gasto)),
      },
    ],
  };
}
```

- [ ] **Step 4:** `npm run test:run -- tests/consumoUnificado.test.ts` — Expected: PASS.
- [ ] **Step 5:** Commit: `git add src/fuel/consumoUnificado.ts tests/consumoUnificado.test.ts && git commit -m "feat(fuel): option-builders puros de la gráfica unificada de consumo"`

---

### Task 6: Componente interactivo + HTML + integración en wire

**Files:**

- Modify: `src/fuel/consumoUnificado.ts` (agregar `mountConsumo`)
- Modify: `Control de flotilla.html` (~L1072 tarjeta sucursal, ~L1077 tarjeta tendencia)
- Modify: `src/fuel/fuelCharts.ts` (renderFuelDashboard + tipos)
- Modify: `src/fuel/wire.ts` (~L422-446 `renderFuelDash`)

**Interfaces:**

- Consumes: builders de Task 5; `makeChart` NO se usa aquí (el componente maneja su propia instancia por el estado del drill).
- Produces: `mountConsumo(els: ConsumoEls, matriz: ConsumoPorGrupoMes): void` exportada desde `consumoUnificado.ts` y re-exportada/llamada desde `renderFuelDashboard`.

- [ ] **Step 1: HTML — reemplazar la tarjeta de sucursal (L1072) por la tarjeta unificada** (una sola línea-bloque, mismo estilo compacto del archivo):

```html
<div class="chart-card chart-card-wide">
  <div class="chart-card-header">
    <button
      id="fuel-consumo-back"
      class="fuel-crumb"
      hidden
      aria-label="Regresar al comparativo de sucursales"
    >
      ←
    </button>
    <div class="chart-title" role="heading" aria-level="2" id="fuel-consumo-title">
      Consumo por sucursal
    </div>
    <span style="display:flex;gap:8px;align-items:center"
      ><span class="fuel-seg" id="fuel-consumo-metrica" role="group" aria-label="Métrica"
        ><button data-m="gasto" class="on">Gasto $</button
        ><button data-m="litros">Litros</button></span
      ><span class="fuel-seg" id="fuel-consumo-modo" role="group" aria-label="Desglose"
        ><button data-mo="total">Total</button
        ><button data-mo="mes" class="on">Por mes</button></span
      ></span
    >
  </div>
  <div id="fuel-consumo-kpis" class="consumo-kpis"></div>
  <div
    id="fchart-consumo"
    class="chart-canvas"
    role="img"
    aria-label="Gráfica de consumo de combustible: comparativo por sucursal con desglose mensual; click en una sucursal para ver su evolución de litros y gasto"
  ></div>
  <div class="chart-card-foot">
    <span class="hintline" id="fuel-consumo-hint"
      >Click en una sucursal para ver su detalle mensual</span
    ><button class="ghost-btn" id="fuel-consumo-global">📈 Evolución global</button>
  </div>
</div>
```

- [ ] **Step 2: HTML — eliminar la tarjeta de tendencia** (L1077, la de `fchart-tendencia`) por completo.
- [ ] **Step 3: `consumoUnificado.ts` — agregar el componente con estado** (al final del archivo):

```ts
// ── Componente interactivo (estado + DOM). Módulo-level state, mismo patrón que
// dashSubmarca en wire.ts: el drill-down sobrevive re-renders del dashboard. ──
import * as echarts from "echarts/core";
import { getTremorPalette, onThemeChange } from "../dashboard/chartTheme";

export type ConsumoEls = {
  chart: HTMLElement;
  kpis: HTMLElement;
  titulo: HTMLElement;
  hint: HTMLElement;
  back: HTMLButtonElement;
  global: HTMLButtonElement;
  segMetrica: HTMLElement;
  segModo: HTMLElement;
};

type Nivel = { tipo: "comparativo" } | { tipo: "detalle"; grupo: string | null };
let nivel: Nivel = { tipo: "comparativo" };
let metrica: MetricaConsumo = "gasto";
let porMes = true;
let matrizActual: ConsumoPorGrupoMes | null = null;
let elsActual: ConsumoEls | null = null;
let wired = false;

function pintarKpis(): void {
  if (!elsActual || !matrizActual) return;
  const m = matrizActual;
  const total = (sel: string | null): CeldaConsumo => {
    if (sel) return m.totalesGrupo[sel] ?? { litros: 0, gasto: 0, cargas: 0 };
    const t = { litros: 0, gasto: 0, cargas: 0 };
    for (const g of m.grupos) {
      const c = m.totalesGrupo[g]!;
      t.litros += c.litros;
      t.gasto += c.gasto;
      t.cargas += c.cargas;
    }
    return t;
  };
  const sel = nivel.tipo === "detalle" ? nivel.grupo : null;
  const c = total(sel);
  elsActual.kpis.replaceChildren();
  for (const [v, l] of [
    [PESO.format(Math.round(c.gasto)), "Gasto del periodo"],
    [`${NUM.format(Math.round(c.litros))} L`, "Litros"],
    [NUM.format(c.cargas), "Cargas"],
  ] as const) {
    const d = document.createElement("div");
    d.className = "ckpi";
    const dv = document.createElement("div");
    dv.className = "v";
    dv.textContent = v;
    const dl = document.createElement("div");
    dl.className = "l";
    dl.textContent = l;
    d.append(dv, dl);
    elsActual.kpis.appendChild(d);
  }
}

function pintar(): void {
  if (!elsActual || !matrizActual) return;
  const els = elsActual,
    m = matrizActual,
    p = getTremorPalette();
  const oculto = modoDesglose(m.meses.length) === "oculto";
  const enDetalle = nivel.tipo === "detalle";
  els.back.hidden = !enDetalle;
  els.segModo.style.display = enDetalle || oculto ? "none" : "";
  els.segMetrica.style.display = enDetalle ? "none" : "";
  els.global.style.display = enDetalle ? "none" : "";
  if (enDetalle) {
    const g = (nivel as { grupo: string | null }).grupo;
    els.titulo.textContent = `${g ?? "Todas las sucursales"} — evolución mensual`;
    els.hint.textContent = "«←» para regresar al comparativo de sucursales";
  } else {
    els.titulo.textContent = "Consumo por sucursal";
    els.hint.textContent = "Click en una sucursal para ver su detalle mensual";
  }
  const chart =
    echarts.getInstanceByDom(els.chart) ?? echarts.init(els.chart, null, { renderer: "canvas" });
  chart.setOption(
    enDetalle
      ? buildDetalleOption(p, m, (nivel as { grupo: string | null }).grupo)
      : buildComparativoOption(p, m, { porMes, metrica }),
    true,
  );
  pintarKpis();
}

/** Monta/actualiza la gráfica unificada. Idempotente: listeners se cablean una vez. */
export function mountConsumo(els: ConsumoEls, matriz: ConsumoPorGrupoMes): void {
  elsActual = els;
  matrizActual = matriz;
  // Si la sucursal drilleada desapareció del rango filtrado, regresar al comparativo.
  if (nivel.tipo === "detalle" && nivel.grupo && !matriz.grupos.includes(nivel.grupo))
    nivel = { tipo: "comparativo" };
  if (!wired) {
    wired = true;
    const chart = echarts.init(els.chart, null, { renderer: "canvas" });
    chart.on("click", (pt) => {
      if (nivel.tipo !== "comparativo" || !matrizActual) return;
      const g = matrizActual.grupos[(pt as { dataIndex: number }).dataIndex];
      if (g) {
        nivel = { tipo: "detalle", grupo: g };
        pintar();
      }
    });
    new ResizeObserver(() => chart.resize()).observe(els.chart);
    onThemeChange(() => pintar());
    els.back.addEventListener("click", () => {
      nivel = { tipo: "comparativo" };
      pintar();
    });
    els.global.addEventListener("click", () => {
      nivel = { tipo: "detalle", grupo: null };
      pintar();
    });
    const seg = (cont: HTMLElement, on: (b: HTMLButtonElement) => void): void =>
      cont.addEventListener("click", (ev) => {
        const b = (ev.target as HTMLElement).closest("button");
        if (!b) return;
        cont.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
        on(b as HTMLButtonElement);
      });
    seg(els.segMetrica, (b) => {
      metrica = (b.dataset.m as MetricaConsumo) ?? "gasto";
      pintar();
    });
    seg(els.segModo, (b) => {
      porMes = b.dataset.mo === "mes";
      pintar();
    });
  }
  pintar();
}
```

- [ ] **Step 4: `fuelCharts.ts`** — en `FuelDashboardData` reemplazar `porSucursal: GroupConsumo[]` y `meses: MonthConsumo[]` por `consumo: ConsumoPorGrupoMes` (import de `./fuelAggregates`); en `FuelDashboardEls` reemplazar `sucursal`/`tendencia` por `consumo: ConsumoEls | null`; en `renderFuelDashboard` reemplazar las dos líneas `if (els.sucursal)…`/`if (els.tendencia)…` por:

```ts
if (els.consumo) mountConsumo(els.consumo, data.consumo);
```

con `import { mountConsumo, type ConsumoEls } from "./consumoUnificado";`. Eliminar la función `tendencia()` (ya sin usos) y el import de `MonthConsumo` si queda huérfano.

- [ ] **Step 5: `wire.ts` (`renderFuelDash`, ~L422)** — en `data`: quitar `porSucursal` y `meses`, agregar:

```ts
    consumo: aggByGroupAndMonth(ctx.filtered, (e) => e.sucursal ?? "(sin dato)"),
```

(con `aggByGroupAndMonth` agregado al import de `./fuelAggregates`). En `els`: quitar `sucursal`/`tendencia` y agregar:

```ts
    consumo: (() => {
      const chart = $("fchart-consumo"), kpis = $("fuel-consumo-kpis"), titulo = $("fuel-consumo-title"),
        hint = $("fuel-consumo-hint"), back = $("fuel-consumo-back"), global = $("fuel-consumo-global"),
        segMetrica = $("fuel-consumo-metrica"), segModo = $("fuel-consumo-modo");
      return chart && kpis && titulo && hint && back && global && segMetrica && segModo
        ? { chart, kpis, titulo, hint, back: back as HTMLButtonElement, global: global as HTMLButtonElement, segMetrica, segModo }
        : null;
    })(),
```

- [ ] **Step 6:** `npm run test:run` y `npm run build` — Expected: todo verde.
- [ ] **Step 7: Verificación manual** — `npm run dev`, abrir el módulo Combustible → dashboard: la tarjeta unificada renderiza, toggle Total/Por mes funciona, click en sucursal → detalle litros+línea gasto, «←» regresa, «Evolución global» muestra la suma, KPIs cambian con el drill, tema oscuro OK.
- [ ] **Step 8:** Commit:

```bash
git add src/fuel/consumoUnificado.ts src/fuel/fuelCharts.ts src/fuel/wire.ts "Control de flotilla.html"
git commit -m "feat(fuel): gráfica unificada de consumo con drill-down y evolución global"
```

---

### Task 7: Restilizar los charts restantes de Combustible

**Files:**

- Modify: `src/fuel/fuelCharts.ts` (`axisCommon` L49, `hbar` L63, `consumoBar` L135, `duracionBar` L173, `makeChart` L30)

- [ ] **Step 1:** Importar `{ gradBar, ejesVivo, tooltipVivo, animVivo } from "../dashboard/chartVivo"`.
- [ ] **Step 2:** En `makeChart`, mezclar la animación al build: `chart.setOption({ ...animVivo(), ...build(getTremorPalette()) })` (ambas llamadas a setOption).
- [ ] **Step 3:** Reemplazar el cuerpo de `axisCommon` por `ejesVivo(p)` (mantener el nombre exportado local para no tocar cada uso), y en los 3 builders sustituir el bloque tooltip `backgroundColor/borderColor/textStyle` por `...tooltipVivo(p)`.
- [ ] **Step 4:** Gradientes y radios: en `hbar` → `itemStyle: { color: gradBarH(color(p)), borderRadius: [0, 5, 5, 0] }` — para barras horizontales el degradado es horizontal; agregar en `chartVivo.ts`:

```ts
/** Variante horizontal (barras hbar): claro a la izquierda. */
export function gradBarH(hex: string): echarts.graphic.LinearGradient {
  return new echarts.graphic.LinearGradient(0, 0, 1, 0, [
    { offset: 0, color: aclarar(hex, 0.28) },
    { offset: 1, color: hex },
  ]);
}
```

En `consumoBar` → `itemStyle: { color: gradBar(p.ac), borderRadius: [5, 5, 0, 0] }`, `barMaxWidth: 26`. En `duracionBar` → `gradBarH(p.ac)`, `borderRadius: [0, 5, 5, 0]`.

- [ ] **Step 5:** Test rápido de la variante nueva en `tests/chartVivo.test.ts`:

```ts
it("gradBarH es horizontal (x2=1, y2=0)", () => {
  const g = gradBarH("#1e4fa3") as unknown as { x2: number; y2: number };
  expect(g.x2).toBe(1);
  expect(g.y2).toBe(0);
});
```

- [ ] **Step 6:** `npm run test:run` + `npm run build` — verde. Verificación visual dev (9 tarjetas, ambos temas).
- [ ] **Step 7:** Commit: `git add src/fuel/fuelCharts.ts src/dashboard/chartVivo.ts tests/chartVivo.test.ts && git commit -m "feat(fuel): dashboard de combustible al estilo Producto Vivo"`

---

### Task 8: Restilizar dashboard de Inspecciones

**Files:**

- Modify: `src/dashboard/charts.ts`

- [ ] **Step 1:** Importar `{ gradBar, gradBarH, ejesVivo, tooltipVivo, animVivo } from "./chartVivo"`.
- [ ] **Step 2:** En los 5 builders (`buildBranchesOption`, `buildCategoriesOption`, `buildDonutOption`, `buildTrendOption`, `buildKmScatterOption`, `buildHeatmapOption`): agregar `...animVivo(),` como primera propiedad del objeto retornado y sustituir en cada `tooltip` el trío `backgroundColor/borderColor/textStyle` por `...tooltipVivo(p)` (conservando `formatter`/`valueFormatter`/`padding` propios si difieren).
- [ ] **Step 3:** Ejes: en cada xAxis/yAxis de tipo `value` sustituir `axisLine/axisTick/splitLine/axisLabel` genéricos por `...ejesVivo(p)` + overrides existentes (p.ej. `formatter`). Los ejes `category` conservan sus labels con `fontWeight: 500`.
- [ ] **Step 4:** Barras con degradado (stacked horizontal de `buildBranchesOption`): `Urgente` → `gradBarH(p.R)` con `borderRadius: [5, 0, 0, 5]`, `Operativa` → `gradBarH(p.G)` con `borderRadius: [0, 5, 5, 0]`, `Revisar` → `gradBarH(p.A)`. En `buildCategoriesOption` (vertical): `gradBar(p.R|p.A|p.B)` y `borderRadius: [5, 5, 0, 0]`. Donut: `borderRadius: 5` (ya trae 3), `borderWidth: 2` se mantiene. Scatter/heatmap: solo tooltip+ejes (sin gradiente).
- [ ] **Step 5:** `npm run test:run` + `npm run build` — verde. Verificación visual del dashboard de Inspecciones (6 tarjetas, ambos temas).
- [ ] **Step 6:** Commit: `git add src/dashboard/charts.ts && git commit -m "feat(dashboard): inspecciones al estilo Producto Vivo"`

---

### Task 9: Capa pura de deltas de KPI

**Files:**

- Create: `src/fuel/kpiDeltas.ts`
- Test: `tests/kpiDeltas.test.ts`

**Interfaces:**

- Produces:

```ts
export type RangoISO = { from: string; to: string }; // YYYY-MM-DD inclusivo
export function rangoAnterior(r: RangoISO): RangoISO; // mismo largo, pegado hacia atrás
export type SemanticaDelta = "costo" | "neutral"; // costo: subir = malo (rojo)
export type DeltaKpi = {
  pct: number;
  direccion: "up" | "down" | "flat";
  tone: "buena" | "mala" | "neutra";
};
export function deltaKpi(actual: number, anterior: number, sem: SemanticaDelta): DeltaKpi | null; // null si anterior ≤ 0
export function totalesCargas(
  entries: readonly FuelEntry[],
  r: RangoISO,
): { litros: number; gasto: number; cargas: number };
```

- [ ] **Step 1: Test que falla** (`tests/kpiDeltas.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { rangoAnterior, deltaKpi, totalesCargas } from "../src/fuel/kpiDeltas";
import type { FuelEntry } from "../src/fuel/types";

describe("rangoAnterior", () => {
  it("mismo largo, inmediatamente anterior (inclusivo)", () => {
    expect(rangoAnterior({ from: "2026-05-01", to: "2026-07-31" })).toEqual({
      from: "2026-01-30",
      to: "2026-04-30",
    });
    expect(rangoAnterior({ from: "2026-07-01", to: "2026-07-01" })).toEqual({
      from: "2026-06-30",
      to: "2026-06-30",
    });
  });
});

describe("deltaKpi", () => {
  it("semántica costo: subir gasto es malo", () => {
    expect(deltaKpi(110, 100, "costo")).toEqual({ pct: 10, direccion: "up", tone: "mala" });
    expect(deltaKpi(90, 100, "costo")).toEqual({ pct: -10, direccion: "down", tone: "buena" });
  });
  it("neutral: cualquier dirección es neutra; sin base → null; sin cambio → flat", () => {
    expect(deltaKpi(110, 100, "neutral")!.tone).toBe("neutra");
    expect(deltaKpi(5, 0, "neutral")).toBeNull();
    expect(deltaKpi(100, 100, "costo")).toEqual({ pct: 0, direccion: "flat", tone: "neutra" });
  });
});

describe("totalesCargas", () => {
  it("suma solo cargas dentro del rango inclusivo", () => {
    const es = [
      { tipo: "carga", fecha: "2026-06-30", litros: 10, monto: 240 },
      { tipo: "carga", fecha: "2026-07-01", litros: 5, monto: 120 },
      { tipo: "solicitud", fecha: "2026-06-30", litros: 99, monto: 999 },
    ] as FuelEntry[];
    expect(totalesCargas(es, { from: "2026-06-01", to: "2026-06-30" })).toEqual({
      litros: 10,
      gasto: 240,
      cargas: 1,
    });
  });
});
```

- [ ] **Step 2:** `npm run test:run -- tests/kpiDeltas.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementación** (`src/fuel/kpiDeltas.ts`):

```ts
/**
 * Deltas de KPI (spec Producto Vivo §1.4): comparan el rango filtrado contra el
 * rango inmediato anterior del mismo largo. Capa PURA. Semántica por-KPI:
 * gasto = "costo" (subir es malo → rojo); litros/cargas = "neutral".
 */
import type { FuelEntry } from "./types";
import { montoEfectivo } from "./fuelAggregates";

export type RangoISO = { from: string; to: string };

const DIA = 86_400_000;
const toMs = (iso: string): number => Date.parse(`${iso}T12:00:00Z`);
const toISO = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function rangoAnterior(r: RangoISO): RangoISO {
  const dias = Math.round((toMs(r.to) - toMs(r.from)) / DIA) + 1;
  const to = toMs(r.from) - DIA;
  return { from: toISO(to - (dias - 1) * DIA), to: toISO(to) };
}

export type SemanticaDelta = "costo" | "neutral";
export type DeltaKpi = {
  pct: number;
  direccion: "up" | "down" | "flat";
  tone: "buena" | "mala" | "neutra";
};

export function deltaKpi(actual: number, anterior: number, sem: SemanticaDelta): DeltaKpi | null {
  if (!Number.isFinite(anterior) || anterior <= 0) return null; // sin base honesta → sin delta
  const pct = Math.round(((actual - anterior) / anterior) * 1000) / 10;
  const direccion = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const tone =
    direccion === "flat" || sem === "neutral" ? "neutra" : direccion === "up" ? "mala" : "buena"; // costo: subir = malo
  return { pct, direccion, tone };
}

export function totalesCargas(
  entries: readonly FuelEntry[],
  r: RangoISO,
): { litros: number; gasto: number; cargas: number } {
  const t = { litros: 0, gasto: 0, cargas: 0 };
  for (const e of entries) {
    if (e.tipo !== "carga") continue;
    const f = (e.fecha || "").slice(0, 10);
    if (f < r.from || f > r.to) continue;
    t.litros += e.litros ?? 0;
    t.gasto += montoEfectivo(e);
    t.cargas += 1;
  }
  return t;
}
```

- [ ] **Step 4:** `npm run test:run -- tests/kpiDeltas.test.ts` — Expected: PASS.
- [ ] **Step 5:** Commit: `git add src/fuel/kpiDeltas.ts tests/kpiDeltas.test.ts && git commit -m "feat(fuel): capa pura de deltas de KPI vs periodo anterior"`

---

### Task 10: Deltas en los KPIs del módulo Combustible

**Files:**

- Modify: `src/fuel/renderKpis.ts`
- Modify: `src/fuel/wire.ts` (callsite de `buildKpisFuel` — localizarlo con `grep -n "buildKpisFuel" src/fuel/wire.ts`)

**Interfaces:**

- Consumes: `deltaKpi`, `rangoAnterior`, `totalesCargas`, `DeltaKpi` (Task 9).
- Produces: `FuelKpiCard.delta?: DeltaKpi` (opcional — sin `prev`, el render es idéntico al actual).

- [ ] **Step 1:** En `renderKpis.ts`: agregar a `FuelKpiCard` el campo `delta?: DeltaKpi | null` (`import type { DeltaKpi } from "./kpiDeltas"`). Agregar a `buildKpisFuel` un 6º parámetro opcional:

```ts
  prev?: { litros: number; gasto: number; cargas: number },
```

y en las tarjetas `cargas`, `litros` y `gasto` agregar respectivamente:

```ts
      delta: prev ? deltaKpi(cargas.length, prev.cargas, "neutral") : undefined,
      delta: prev ? deltaKpi(litros, prev.litros, "neutral") : undefined,
      delta: prev ? deltaKpi(gasto, prev.gasto, "costo") : undefined,
```

(`import { deltaKpi } from "./kpiDeltas"`).

- [ ] **Step 2:** En `renderKpisFuel`, tras asignar `kval.textContent = c.value;` agregar:

```ts
if (c.delta) {
  const kd = document.createElement("span");
  kd.className = `kdelta ${c.delta.tone}`;
  const flecha = c.delta.direccion === "up" ? "▲" : c.delta.direccion === "down" ? "▼" : "•";
  kd.textContent = ` ${flecha} ${Math.abs(c.delta.pct).toFixed(1)}%`;
  kd.title = "vs periodo anterior de la misma duración";
  kval.appendChild(kd);
}
```

- [ ] **Step 3:** En `wire.ts`, en el callsite de `buildKpisFuel`: calcular y pasar `prev`. El rango actual es el mismo par desde/hasta que usa el filtro de período del módulo (visible en `computeCtx`; usar las MISMAS variables que acotan `ctx.filtered`):

```ts
const prev = totalesCargas(todasLasEntradas, rangoAnterior({ from: desdeISO, to: hastaISO }));
```

donde `todasLasEntradas` es el arreglo completo sin filtro de fecha (p.ej. `window.fuelEntries` ya scoped por anulaciones) — importar `{ totalesCargas, rangoAnterior } from "./kpiDeltas"`. Si el módulo está en modo "histórico completo" (sin rango acotado), pasar `undefined` (sin deltas).

- [ ] **Step 4:** `npm run test:run` + `npm run build` — verde. Verificación manual: KPIs muestran `▲/▼ %` con tooltip; sin rango previo con datos, no aparece delta.
- [ ] **Step 5:** Commit: `git add src/fuel/renderKpis.ts src/fuel/wire.ts && git commit -m "feat(fuel): deltas de KPI vs periodo anterior (gasto=costo, resto neutral)"`

---

### Task 11: Verificación integral y PR

**Files:** ninguno nuevo.

- [ ] **Step 1:** Suite completa: `npm run test:run` — Expected: todo verde (línea base + nuevos).
- [ ] **Step 2:** `npm run build` — Expected: OK.
- [ ] **Step 3:** e2e locales (memoria `control-flotilla-prepush-e2e`): `node scripts/gen-fixture-mensual.mjs && npx playwright test -c playwright.local.config.ts` — Expected: ≥47/54 (los 7 fallos ambientales conocidos no cuentan como regresión; comparar contra `main` si hay dudas).
- [ ] **Step 4:** Checklist visual manual (dev server): tema claro y oscuro × (dashboard Combustible completo, dashboard Inspecciones, drill-down ida/vuelta, evolución global, deltas) + móvil (viewport 390px) + `prefers-reduced-motion` (DevTools → Rendering → emulate) sin animación.
- [ ] **Step 5:** Usar la skill `verify` para ejercitar el flujo end-to-end antes del PR.
- [ ] **Step 6:** Push y PR (sin merge — el deploy a prod lo decide el usuario):

```bash
git push -u origin feat/dashboards-producto-vivo --no-verify
gh pr create --base main --title "Rediseño Producto Vivo: dashboards + gráfica unificada de consumo" --body "Spec: docs/superpowers/specs/2026-07-23-dashboards-producto-vivo-design.md

- Sistema visual Producto Vivo (tokens, KPI-cards, píldoras, gradientes, reduced-motion)
- Gráfica unificada de consumo: comparativo ⇄ drill-down por sucursal ⇄ evolución global
- 12 charts restilizados (Combustible + Inspecciones)
- Deltas de KPI vs periodo anterior
- Paleta mensual validada por accesibilidad (claro y oscuro)

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-review (hecho al escribir)

- **Cobertura vs spec:** §1.1 tokens → T1-T3 · §1.2 ambos dashboards → T7-T8 · §1.3 gráfica unificada → T4-T6 · §1.4 deltas → T9-T10 · §3 pruebas → tests por task + T11. Ajuste declarado: agrupadas hasta 3 meses (no 6) — razón en Global Constraints.
- **Placeholders:** ninguno; el único punto flexible declarado es el nombre exacto de las variables de rango en el callsite de `buildKpisFuel` (T10 Step 3), resuelto con grep en el paso.
- **Consistencia de tipos:** `ConsumoPorGrupoMes/CeldaConsumo` (T4) usados en T5/T6; `ConsumoEls/mountConsumo` (T6) usados en fuelCharts/wire; `DeltaKpi` (T9) usado en T10; `gradBarH` se define en T7 y se usa en T7/T8.
