# Estatus "Rechazada" de Ops-GPA + triage de tesorería — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un rechazo en Operaciones-GPA llegue a Fleet Command como estatus de primera clase ("Rechazada · Ops"), con triage de tesorería en 1 clic (anular = "no contar", reversible) y visibilidad permanente de la fila incluso después de excluirla de los KPIs.

**Architecture:** El puente (`mapValidacion`) deja de traducir rechazo→discrepancia y persiste `verdictGlobal="rechazada"` (string plano en Dynamo — sin migración). La hidratación deja de aplanar `fuenteDeteccion` para que la UI distinga veredictos de Ops. La exclusión del gasto sigue teniendo UN solo mecanismo (la Anulación tombstone existente); lo único nuevo es el triage que la detona y que las anuladas-rechazadas permanecen visibles en la tabla principal.

**Tech Stack:** TypeScript + Vite, Vitest (happy-dom, globals), Amplify Gen 2 (DynamoDB), AWS SDK v3 (script de backfill).

**Spec:** `docs/superpowers/specs/2026-07-21-rechazadas-opsgpa-design.md` (aprobado 2026-07-21).

## Global Constraints

- **Rama:** trabajar en `feat/opsgpa-mensual` (ahí viven spec y plan). ⚠️ El worktree se COMPARTE entre sesiones: correr `git branch --show-current` antes de CADA commit y stagear SOLO las rutas listadas en el task (nunca `git add -A`).
- **Anti-XSS:** DOM solo con `createElement`/`textContent` — NUNCA `innerHTML` (regla del proyecto).
- **UI en español** (es-MX), mismos textos que el spec: pill `"Rechazada · Ops"`, pill `"Rechazada · no contada"`, KPI `"Rechazadas sin triage"`.
- **Texto llave (NO cambiar):** la nota del puente `"Rechazada en origen (Operaciones-GPA)"` es el criterio del backfill (Task 7).
- **Sin cambios de agregados:** ninguna suma/KPI/rendimiento aprende a filtrar "rechazada"; la exclusión es SOLO vía `e.anulada` (ya existente).
- Este plan NO toca `<script>` inline (no requiere `npm run csp:sync`); el hook de commit corre prettier + auditoría CSP solo.
- Tests: `npx vitest run <archivo>` (config en `vite.config.ts`, environment happy-dom).
- Los datos de origen (MoreApp/Ops) NUNCA se borran ni mutan; el único write de datos es el backfill del Task 7 sobre `ValidacionCarga` (campo propio de FC).

---

### Task 1: Tipos + hidratación — el front representa "rechazada" y el origen "ops-gpa"

**Files:**

- Modify: `src/fuel/types.ts:20` (FuelVerdictGlobal) y `src/fuel/types.ts:34` (fuenteDeteccion)
- Modify: `src/fuel/mapEntry.ts:177` (VERDICTS_GLOBAL) y `src/fuel/mapEntry.ts:215` (fuenteDeteccion)
- Modify: `amplify/data/resource.ts:246` (solo el comentario del campo)
- Test: `tests/fuelRechazadas.test.ts` (nuevo)

**Interfaces:**

- Consumes: `mapCargaToFuelEntry(row: CargaRow, val?: ValidacionRow)` y tipos exportados de `src/fuel/mapEntry.ts`.
- Produces: `FuelVerdictGlobal = "ok" | "discrepancia" | "pendiente" | "rechazada"` y `FuelReview.fuenteDeteccion?: "manual" | "ia" | "ops-gpa"` — TODOS los tasks posteriores dependen de estos dos tipos.

- [ ] **Step 1: Write the failing test**

Crear `tests/fuelRechazadas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapCargaToFuelEntry, type CargaRow, type ValidacionRow } from "../src/fuel/mapEntry";

const ROW = {
  economicoId: "45",
  eventoId: "OPS-abc123",
  tipo: "carga",
  fecha: "2026-07-20",
  sucursal: "Monterrey",
} as CargaRow;

function val(over: Partial<ValidacionRow> = {}): ValidacionRow {
  return {
    loadId: "45|carga|OPS-abc123",
    verdictGlobal: "rechazada",
    revisadoPor: "ops-gpa",
    nota: "Rechazada en origen (Operaciones-GPA)",
    fuenteDeteccion: "ops-gpa",
    ...over,
  };
}

describe("hidratación de rechazadas (spec 2026-07-21)", () => {
  it("verdictGlobal 'rechazada' sobrevive la hidratación", () => {
    const e = mapCargaToFuelEntry(ROW, val());
    expect(e.review?.verdictGlobal).toBe("rechazada");
  });

  it("fuenteDeteccion 'ops-gpa' ya NO se aplana a 'manual'", () => {
    const e = mapCargaToFuelEntry(ROW, val());
    expect(e.review?.fuenteDeteccion).toBe("ops-gpa");
  });

  it("valores desconocidos siguen degradando: verdict → 'pendiente', fuente rara → 'manual'", () => {
    const e = mapCargaToFuelEntry(ROW, val({ verdictGlobal: "zzz", fuenteDeteccion: "zzz" }));
    expect(e.review?.verdictGlobal).toBe("pendiente");
    expect(e.review?.fuenteDeteccion).toBe("manual");
  });

  it("'ia' y vacío no cambian de comportamiento", () => {
    expect(mapCargaToFuelEntry(ROW, val({ fuenteDeteccion: "ia" })).review?.fuenteDeteccion).toBe(
      "ia",
    );
    expect(
      mapCargaToFuelEntry(ROW, val({ fuenteDeteccion: null })).review?.fuenteDeteccion,
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fuelRechazadas.test.ts`
Expected: FAIL — `verdictGlobal` llega como `"pendiente"` (cae del set) y `fuenteDeteccion` como `"manual"`.

- [ ] **Step 3: Write minimal implementation**

En `src/fuel/types.ts` línea 20:

```ts
/** Veredicto global de una carga revisada. "rechazada" = rechazo en origen (Ops-GPA). */
export type FuelVerdictGlobal = "ok" | "discrepancia" | "pendiente" | "rechazada";
```

En `src/fuel/types.ts` línea 34 (dentro de `FuelReview`):

```ts
  fuenteDeteccion?: "manual" | "ia" | "ops-gpa";
```

En `src/fuel/mapEntry.ts` línea 177:

```ts
const VERDICTS_GLOBAL = new Set<FuelVerdictGlobal>([
  "ok",
  "discrepancia",
  "pendiente",
  "rechazada",
]);
```

En `src/fuel/mapEntry.ts` línea 215 (dentro de `mapReview`), reemplazar la línea de `fuenteDeteccion` por:

```ts
    fuenteDeteccion:
      v.fuenteDeteccion === "ia" || v.fuenteDeteccion === "ops-gpa"
        ? v.fuenteDeteccion
        : v.fuenteDeteccion
          ? "manual"
          : undefined,
```

En `amplify/data/resource.ts` línea 246, actualizar SOLO el comentario:

```ts
// 'ok' | 'discrepancia' | 'pendiente' | 'rechazada' (rechazo en origen Ops-GPA)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/fuelRechazadas.test.ts`
Expected: PASS (4 tests).

Run también (regresión de tipos): `npx vitest run tests/renderTableCombustible.test.ts tests/renderDetalleCarga.test.ts tests/fuelAnulacion.test.ts`
Expected: PASS sin cambios.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # debe decir feat/opsgpa-mensual
git add src/fuel/types.ts src/fuel/mapEntry.ts amplify/data/resource.ts tests/fuelRechazadas.test.ts
git commit -m "feat(fuel): veredicto 'rechazada' de primera clase + fuenteDeteccion ops-gpa en hidratacion"
```

---

### Task 2: Puente — `mapValidacion` traduce Rechaza\* → "rechazada"

**Files:**

- Modify: `src/opsgpa/mapValidacion.ts` (doc, tipo del input, mapeo)
- Modify: `tests/opsgpa-mapValidacion.test.ts:29-37` (expectativas)

**Interfaces:**

- Consumes: `FuelVerdictGlobal` con `"rechazada"` (Task 1).
- Produces: `ValidacionCargaInput.verdictGlobal: "ok" | "rechazada"` — lo consumen `amplify/functions/opsgpa-receptor/handler.ts` y `src/opsgpa/backfill.ts` SIN cambios (pasan el objeto entero al upsert).

- [ ] **Step 1: Update the test to the new expectation (failing)**

En `tests/opsgpa-mapValidacion.test.ts`, reemplazar el test de la línea 29:

```ts
it("Rechazada → verdict 'rechazada' (primera clase, decisión 2026-07-21); tolera género/variantes", () => {
  for (const s of ["Rechazada", "Rechazado", "rechazada"]) {
    const v = mapValidacion({ status: s }, CARGA);
    expect(v?.verdictGlobal).toBe("rechazada");
    expect(v?.nota).toMatch(/Rechazada en origen/);
    expect(v?.revisadoPor).toBe("ops-gpa"); // sin autorizadoPor
  }
  expect(mapValidacion({ status: "Aprobado" }, CARGA)?.verdictGlobal).toBe("ok");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/opsgpa-mapValidacion.test.ts`
Expected: FAIL — `expected 'discrepancia' to be 'rechazada'`.

- [ ] **Step 3: Write minimal implementation**

En `src/opsgpa/mapValidacion.ts`:

Línea 9 del doc de cabecera, reemplazar por:

```ts
 *   status "Rechazada" → verdictGlobal "rechazada" (primera clase; decisión 2026-07-21 —
 *                        antes se traducía a "discrepancia" y el rechazo se perdía)
```

Línea 25 (interface `ValidacionCargaInput`):

```ts
verdictGlobal: "ok" | "rechazada";
```

Línea 55 (dentro de `mapValidacion`):

```ts
    verdictGlobal: aprobada ? "ok" : "rechazada",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/opsgpa-mapValidacion.test.ts tests/opsgpa-backfill.test.ts tests/opsgpa-golden-contract.test.ts`
Expected: PASS (backfill y golden-contract reutilizan el adaptador; si alguno esperara "discrepancia" para rechazos, actualizar su expectativa a "rechazada" — misma justificación).

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add src/opsgpa/mapValidacion.ts tests/opsgpa-mapValidacion.test.ts
git commit -m "feat(opsgpa): el puente persiste rechazos como verdictGlobal 'rechazada' (ya no discrepancia)"
```

---

### Task 3: Tabla — pill "Rechazada · Ops", filtro, rank, fila resaltada y "no contada"

**Files:**

- Modify: `src/fuel/renderTableCombustible.ts` (FuelVerdictFilter:42, VERDICT_RANK:163, VERDICT_PILL:236, verdictCell:358, loop de filas:434, celda de monto:462)
- Modify: `src/styles/main.css` (~5117 pills, ~5068 filas light, ~390 filas dark)
- Modify: `Control de flotilla.html:961` (option del filtro)
- Test: `tests/fuelRechazadas.test.ts` (extender)

**Interfaces:**

- Consumes: `FuelVerdictGlobal`/`fuenteDeteccion` (Task 1).
- Produces: `FuelVerdictFilter` acepta `"rechazada"` (lo usan Task 4 y 5); pills con textos exactos `"Rechazada · Ops"`, `"Rechazada · no contada"`, `"Validado · Ops"`; clases de fila `sw-rej` (vigente) y `sw-nocontada` (anulada visible).

- [ ] **Step 1: Write the failing tests**

Añadir a `tests/fuelRechazadas.test.ts`:

```ts
import {
  filterAndSortFuel,
  renderTableCombustible,
  type FuelTableFilter,
} from "../src/fuel/renderTableCombustible";
import type { FuelEntry } from "../src/fuel/types";

const NO_FILTER: FuelTableFilter = {
  tipo: "all",
  verdict: "all",
  sucursal: "",
  responsable: "",
  search: "",
  flag: "",
  area: "",
  submarca: "",
};

function fe(p: Partial<FuelEntry> & { eco: string }): FuelEntry {
  return {
    loadId: `${p.eco}|carga|${p.eventoId ?? "x"}`,
    tipo: "carga",
    eventoId: p.eventoId ?? "x",
    sucursal: "Monterrey",
    fecha: "2026-07-20",
    photos: [],
    ...p,
  } as FuelEntry;
}

const VIGENTE_RECHAZADA = fe({
  eco: "45",
  eventoId: "r1",
  monto: 700004,
  review: {
    verdictGlobal: "rechazada",
    porEvidencia: {},
    revisadoPor: "ops-gpa",
    fuenteDeteccion: "ops-gpa",
  },
});
const NO_CONTADA = fe({
  eco: "45",
  eventoId: "r2",
  monto: 700004,
  review: { verdictGlobal: "rechazada", porEvidencia: {}, fuenteDeteccion: "ops-gpa" },
  anulada: {
    motivo: "Rechazada en Operaciones-GPA — registro inválido",
    anuladoPor: "x@gpa",
    ts: "2026-07-21T10:00:00Z",
  },
});
const OK_OPS = fe({
  eco: "44",
  eventoId: "a1",
  monto: 700,
  review: {
    verdictGlobal: "ok",
    porEvidencia: {},
    revisadoPor: "admin · ops-gpa",
    fuenteDeteccion: "ops-gpa",
  },
});

describe("tabla: rechazadas (spec 2026-07-21)", () => {
  it("el filtro verdict='rechazada' matchea vigentes y no contadas", () => {
    const rows = filterAndSortFuel(
      [VIGENTE_RECHAZADA, NO_CONTADA, OK_OPS],
      { ...NO_FILTER, verdict: "rechazada" },
      "_idx",
      -1,
    );
    expect(rows).toHaveLength(2);
  });

  it("pills y clases de fila: 'Rechazada · Ops' (sw-rej), 'Rechazada · no contada' (sw-nocontada, monto tachado), 'Validado · Ops'", () => {
    const tbody = document.createElement("tbody");
    renderTableCombustible({
      tbody,
      entries: [VIGENTE_RECHAZADA, NO_CONTADA, OK_OPS],
      filter: NO_FILTER,
      sortCol: "eco",
      sortDir: 1,
    });
    const html = tbody.textContent ?? "";
    expect(html).toContain("Rechazada · Ops");
    expect(html).toContain("Rechazada · no contada");
    expect(html).toContain("Validado · Ops");
    expect(tbody.querySelector("tr.sw-rej")).toBeTruthy();
    const noContada = tbody.querySelector("tr.sw-nocontada");
    expect(noContada).toBeTruthy();
    expect(noContada!.querySelector("s")).toBeTruthy(); // monto tachado
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fuelRechazadas.test.ts`
Expected: FAIL — TS no acepta `verdict: "rechazada"` y/o `VERDICT_PILL["rechazada"]` es undefined al renderizar.

- [ ] **Step 3: Implement in `src/fuel/renderTableCombustible.ts`**

Línea 42, añadir el valor al filtro:

```ts
export type FuelVerdictFilter =
  | "all"
  | "ok"
  | "discrepancia"
  | "pendiente"
  | "historico"
  | "rechazada"
  | "anulada";
```

Línea 163, el rank (rechazada = lo más urgente del radar):

```ts
const VERDICT_RANK: Record<FuelDisplayVerdict, number> = {
  rechazada: 4,
  discrepancia: 3,
  pendiente: 2,
  ok: 1,
  historico: 0,
};
```

Línea 236, la pill:

```ts
const VERDICT_PILL: Record<FuelDisplayVerdict, { cls: string; txt: string }> = {
  ok: { cls: "sw-pill-ok", txt: "Validado" },
  discrepancia: { cls: "sw-pill-urg", txt: "Discrepancia" },
  pendiente: { cls: "sw-pill-rev", txt: "Pendiente" },
  historico: { cls: "sw-pill-hist", txt: "Histórico" },
  rechazada: { cls: "sw-pill-rej", txt: "Rechazada · Ops" },
};
```

`verdictCell` (línea 358) — dos cambios. El branch de anuladas distingue rechazadas:

```ts
  if (e.anulada) {
    const rechazada = e.review?.verdictGlobal === "rechazada";
    const wrap = document.createElement("div");
    wrap.className = "sw-valcell";
    const span = document.createElement("span");
    span.className = rechazada ? "sw-pill sw-pill-rej" : "sw-pill sw-pill-hist";
    span.textContent = rechazada ? "Rechazada · no contada" : "Anulada";
    span.title = e.anulada.motivo || "Sin motivo registrado";
    wrap.appendChild(span);
    // ... (resto del branch idéntico: sub con quién/cuándo)
```

Y después del branch de anuladas, el origen visible en aprobadas de Ops (reemplaza `if (!rev || rev === "ui") return pill(v);` y el `wrap.appendChild(pill(v));`):

```ts
const p = pill(v);
// Origen visible: aprobación hecha EN Ops (fuenteDeteccion del puente), no por tesorería.
if (v === "ok" && e.review?.fuenteDeteccion === "ops-gpa") p.textContent = "Validado · Ops";
const rev = e.review?.revisadoPor;
if (!rev || rev === "ui") return p;
const wrap = document.createElement("div");
wrap.className = "sw-valcell";
wrap.appendChild(p);
```

Loop de filas (línea 434), clases de la fila — reemplazar el bloque `if (v === "discrepancia")...`:

```ts
const noContada = !!e.anulada && e.review?.verdictGlobal === "rechazada";
if (noContada) tr.classList.add("sw-nocontada");
else if (v === "rechazada") tr.classList.add("sw-rej");
else if (v === "discrepancia") tr.classList.add("sw-urg");
else if (v === "pendiente") tr.classList.add("sw-rev");
```

Celda de monto (línea 462) — extraer el texto y tachar cuando no contada. Reemplazar el elemento `esSol ? ... : e.monto != null ? PESO.format(e.monto) : "—"` del array `cells` por la variable `montoCell`, declarada justo antes del array:

```ts
const montoTxt = esSol
  ? e.montoEstimado != null
    ? PESO.format(e.montoEstimado)
    : "—"
  : e.monto != null
    ? PESO.format(e.monto)
    : "—";
let montoCell: string | HTMLElement = montoTxt;
if (noContada) {
  const s = document.createElement("s");
  s.textContent = montoTxt;
  montoCell = s;
}
```

En `src/styles/main.css`, después del bloque `.sw-pill-hist` (~línea 5117):

```css
.sw-pill-rej {
  /* Rechazada en origen (Operaciones-GPA): acción pendiente de triage de tesorería. */
  background: var(--Rd);
  color: var(--R);
  border: 1px dashed var(--R);
}
```

Después de `.sw-table tr.sw-rev:hover td` (~línea 5068):

```css
.sw-table tr.sw-rej td {
  background: #fff5f5;
}
.sw-table tr.sw-rej:hover td {
  background: #fee2e2;
}
/* Rechazada "no contada" (anulada visible): atenuada, fuera de cálculo. */
.sw-table tr.sw-nocontada td {
  opacity: 0.55;
}
```

En el bloque dark (~línea 390), junto a los overrides de sw-urg/sw-rev:

```css
:root[data-theme="dark"] .sw-table tr.sw-rej td {
  background: transparent;
}
:root[data-theme="dark"] .sw-table tr.sw-rej:hover td {
  background: var(--bg3);
}
```

En `Control de flotilla.html` línea 961, entre Histórico y Anuladas:

```html
<option value="historico">Histórico</option>
<option value="rechazada">Rechazadas · Ops</option>
<option value="anulada">Anuladas</option>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/fuelRechazadas.test.ts tests/renderTableCombustible.test.ts tests/fuelAnulacion.test.ts`
Expected: PASS (los tests viejos de anuladas siguen viendo "Anulada" para anuladas sin veredicto rechazada).

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add src/fuel/renderTableCombustible.ts src/styles/main.css "Control de flotilla.html" tests/fuelRechazadas.test.ts
git commit -m "feat(fuel): pill Rechazada-Ops, filtro y fila 'no contada' visible con monto tachado"
```

---

### Task 4: Universo de tabla — las "no contadas" visibles en la vista principal

**Files:**

- Modify: `src/fuel/renderTableCombustible.ts` (helper puro nuevo, junto a `verdictOf` ~línea 83)
- Modify: `src/fuel/wire.ts:305-310` (universo de la tabla)
- Test: `tests/fuelRechazadas.test.ts` (extender)

**Interfaces:**

- Consumes: `FuelEntry.anulada` + `review.verdictGlobal` (Task 1).
- Produces: `rechazadasNoContadas(anuladas: readonly FuelEntry[]): FuelEntry[]` exportada de `renderTableCombustible.ts`.

- [ ] **Step 1: Write the failing test**

Añadir a `tests/fuelRechazadas.test.ts` (reusa las fixtures del Task 3):

```ts
import { rechazadasNoContadas } from "../src/fuel/renderTableCombustible";

describe("rechazadasNoContadas", () => {
  it("de las anuladas, solo las con veredicto rechazada quedan visibles", () => {
    const anuladaNormal = fe({
      eco: "10",
      eventoId: "dup1",
      anulada: { motivo: "duplicada", anuladoPor: "x@gpa", ts: "2026-07-01T10:00:00Z" },
    });
    const out = rechazadasNoContadas([NO_CONTADA, anuladaNormal]);
    expect(out).toHaveLength(1);
    expect(out[0]!.eventoId).toBe("r2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fuelRechazadas.test.ts`
Expected: FAIL — `rechazadasNoContadas` no existe.

- [ ] **Step 3: Implement**

En `src/fuel/renderTableCombustible.ts`, después de `verdictOf` (~línea 83):

```ts
/**
 * Anuladas que permanecen VISIBLES en la tabla principal: las rechazadas en origen tras el
 * triage "No contar" (spec 2026-07-21) — la evidencia del rechazo no se esconde. Siguen fuera
 * de TODO cálculo (KPIs/rendimientos/exportes trabajan con vigentes).
 */
export function rechazadasNoContadas(anuladas: readonly FuelEntry[]): FuelEntry[] {
  return anuladas.filter((e) => e.review?.verdictGlobal === "rechazada");
}
```

En `src/fuel/wire.ts`, importar `rechazadasNoContadas` junto a los imports existentes de `./renderTableCombustible`, y reemplazar las líneas 308-310:

```ts
const vistaAnuladas = filter.verdict === "anulada";
// Rechazadas "no contadas" (triage): anuladas (fuera de todo cálculo) pero visibles en la
// tabla principal para todos — la evidencia del rechazo no se esconde (spec 2026-07-21).
const noContadas = vistaAnuladas ? [] : rechazadasNoContadas(scopedAnuladas());
const tableEntries = vistaAnuladas
  ? scopedAnuladas()
  : noContadas.length
    ? [...all, ...noContadas]
    : all;
const tableFilter = vistaAnuladas ? { ...filter, verdict: "all" as const, flag: "" } : filter;
```

Nota: `filterAndSortFuel` no muta y re-ordena siempre (default: más reciente primero), así que el append no altera el orden visible. El contador "X de Y" incluye a las no contadas en Y — correcto: son filas del universo visible.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/fuelRechazadas.test.ts`
Expected: PASS.

Run typecheck del wire: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add src/fuel/renderTableCombustible.ts src/fuel/wire.ts tests/fuelRechazadas.test.ts
git commit -m "feat(fuel): anuladas-rechazadas visibles en la tabla principal (fuera de calculo)"
```

---

### Task 5: KPI "Rechazadas sin triage" + clic-filtro

**Files:**

- Modify: `src/fuel/renderKpis.ts:18` (union de filter) y `buildKpisFuel` (~línea 59 y ~119)
- Modify: `src/fuel/wire.ts:282-288` (callback del clic)
- Test: `tests/fuelRechazadas.test.ts` (extender)

**Interfaces:**

- Consumes: `verdictOf` (ya importado en renderKpis), `FuelVerdictFilter` con `"rechazada"` (Task 3).
- Produces: tarjeta `{ key: "rechazadas", label: "Rechazadas sin triage", filter: "rechazada" }` — solo presente cuando el conteo > 0.

- [ ] **Step 1: Write the failing test**

Añadir a `tests/fuelRechazadas.test.ts`:

```ts
import { buildKpisFuel } from "../src/fuel/renderKpis";
import { computeFuelMetrics, buildFleetBaseline } from "../src/fuel/fuelAnalysis";

describe("KPI Rechazadas sin triage", () => {
  const kpis = (entries: FuelEntry[]) => {
    const metrics = computeFuelMetrics(entries);
    return buildKpisFuel(entries, metrics, buildFleetBaseline(metrics, entries), []);
  };

  it("cuenta las rechazadas vigentes (las anuladas nunca llegan: scoped() las excluye)", () => {
    const card = kpis([VIGENTE_RECHAZADA, OK_OPS]).find((c) => c.key === "rechazadas");
    expect(card?.value).toBe("1");
    expect(card?.filter).toBe("rechazada");
    expect(card?.tone).toBe("r");
  });

  it("la tarjeta NO aparece cuando no hay rechazadas", () => {
    expect(kpis([OK_OPS]).find((c) => c.key === "rechazadas")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fuelRechazadas.test.ts`
Expected: FAIL — no existe tarjeta `rechazadas`.

- [ ] **Step 3: Implement**

En `src/fuel/renderKpis.ts` línea 18:

```ts
  filter?: "discrepancia" | "pendiente" | "anomalia" | "historico" | "rechazada"; // clic → filtro
```

En `buildKpisFuel`, junto al conteo de discrepancias (~línea 59):

```ts
// Rechazadas en origen (Ops) SIN triage: siguen sumando gasto hasta que tesorería decida
// (anular o validar como gasto real). Las ya anuladas no llegan aquí (scoped() las excluye).
const rechazadas = entries.filter((e) => verdictOf(e) === "rechazada").length;
```

En el array de retorno, inmediatamente después de la tarjeta `discrepancias` (~línea 119):

```ts
    // Radar de triage: solo aparece si hay rechazadas pendientes de decisión.
    ...(rechazadas > 0
      ? [
          {
            key: "rechazadas",
            label: "Rechazadas sin triage",
            value: NUM.format(rechazadas),
            sub: "decidir: no contar o gasto real",
            tone: "r" as const,
            filter: "rechazada" as const,
          },
        ]
      : []),
```

En `src/fuel/wire.ts`, en el callback de KPIs (líneas 282-288), añadir el branch:

```ts
if (f === "discrepancia") setVerdictFilter("discrepancia");
else if (f === "pendiente") setVerdictFilter("pendiente");
else if (f === "historico") setVerdictFilter("historico");
else if (f === "rechazada") setVerdictFilter("rechazada");
// La KPI "Anomalías" filtra por alerta detectada (antes caía en "pendiente").
else if (f === "anomalia") setFlagFilter("any");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/fuelRechazadas.test.ts tests/renderTableCombustible.test.ts`
Expected: PASS (el test viejo de buildKpisFuel no tiene rechazadas → la tarjeta no aparece → sus conteos no cambian).

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add src/fuel/renderKpis.ts src/fuel/wire.ts tests/fuelRechazadas.test.ts
git commit -m "feat(fuel): KPI 'Rechazadas sin triage' con clic-filtro"
```

---

### Task 6: Detalle — banner de triage + motivo precargado en el modal de anulación

**Files:**

- Modify: `src/anulacion/ui.ts:60-99` (opción `motivoInicial`)
- Modify: `src/fuel/renderDetalleCarga.ts:316-328` (banner de triage para rechazadas vigentes)
- Modify: `src/fuel/wire.ts:790,802` (pasar el motivo precargado)
- Test: `tests/fuelRechazadas.test.ts` (extender)

**Interfaces:**

- Consumes: `deps.esAdmin`, `deps.onAnular` (existentes en `RenderDetalleCargaDeps`).
- Produces: `AnularModalOpts.motivoInicial?: string`; texto exacto del motivo precargado: `"Rechazada en Operaciones-GPA — registro inválido (error de captura)"`.

- [ ] **Step 1: Write the failing test**

Añadir a `tests/fuelRechazadas.test.ts`:

```ts
import { renderDetalleCarga } from "../src/fuel/renderDetalleCarga";

describe("detalle: triage de rechazada", () => {
  it("admin ve el banner de triage con botón 'No contar' que dispara onAnular", () => {
    const body = document.createElement("div");
    let anulada = false;
    renderDetalleCarga({
      body,
      load: VIGENTE_RECHAZADA,
      resolveUrl: () => "",
      canWrite: true,
      onValidate: () => {},
      esAdmin: true,
      onAnular: () => {
        anulada = true;
      },
    });
    expect(body.textContent).toContain("Rechazada en Operaciones-GPA — pendiente de triage");
    const btn = [...body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("No contar"),
    );
    expect(btn).toBeTruthy();
    btn!.click();
    expect(anulada).toBe(true);
  });

  it("sin admin no hay banner de triage", () => {
    const body = document.createElement("div");
    renderDetalleCarga({
      body,
      load: VIGENTE_RECHAZADA,
      resolveUrl: () => "",
      canWrite: true,
      onValidate: () => {},
      esAdmin: false,
    });
    expect(body.textContent).not.toContain("pendiente de triage");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fuelRechazadas.test.ts`
Expected: FAIL — el banner no existe (solo aparece el botón discreto "⛔ Anular registro…").

- [ ] **Step 3: Implement**

En `src/anulacion/ui.ts`, añadir a `AnularModalOpts` (línea 60):

```ts
  /** Texto precargado del motivo (p.ej. triage de rechazadas de Ops); el admin puede editarlo. */
  motivoInicial?: string;
```

Y tras crear el textarea `motivo` (después de la línea 99):

```ts
if (opts.motivoInicial) motivo.value = opts.motivoInicial;
```

(El botón "Anular registro" sigue deshabilitado hasta escribir el `confirmText` — `sync` ya valida ambos campos.)

En `src/fuel/renderDetalleCarga.ts`, reemplazar el branch `} else if (deps.esAdmin && deps.onAnular) {` (línea 316) por:

```ts
    } else if (deps.esAdmin && deps.onAnular && load.review?.verdictGlobal === "rechazada") {
      // Triage de rechazada en origen (Ops): la decisión es humana — no contar (anular) o
      // validar el gasto real con el panel de evidencias de abajo (spec 2026-07-21).
      const banner = document.createElement("div");
      banner.style.cssText =
        "display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;margin-bottom:10px;border:1px solid var(--ln);border-left:4px solid var(--R);border-radius:8px;background:var(--bg3)";
      const txt = document.createElement("div");
      txt.style.cssText = "flex:1;min-width:200px;font-size:12px";
      const t1 = document.createElement("div");
      t1.style.fontWeight = "700";
      t1.textContent = "🚫 Rechazada en Operaciones-GPA — pendiente de triage";
      const t2 = document.createElement("div");
      t2.style.cssText = "color:var(--s2);margin-top:2px";
      t2.textContent =
        'Si fue error de captura, exclúyela con "No contar". Si el gasto fue real, valida las evidencias abajo — tu veredicto tiene la última palabra.';
      txt.appendChild(t1);
      txt.appendChild(t2);
      banner.appendChild(txt);
      const noContar = document.createElement("button");
      noContar.className = "fv-btn";
      noContar.style.cssText = "color:var(--R);border-color:var(--R)";
      noContar.textContent = "⛔ No contar…";
      noContar.title =
        'Crea la anulación estándar (reversible): fuera de KPIs y cálculos, visible como "Rechazada · no contada"';
      noContar.addEventListener("click", () => deps.onAnular!());
      banner.appendChild(noContar);
      body.appendChild(banner);
    } else if (deps.esAdmin && deps.onAnular) {
```

(El branch existente del botón discreto "⛔ Anular registro…" queda como tercer caso, sin cambios.)

En `src/fuel/wire.ts`:

Línea 802, la firma y el modal:

```ts
function anularCarga(load: FuelEntry, motivoInicial?: string): void {
  openAnularModal({
    etiqueta: etiquetaDe(load),
    confirmText: load.eco,
    motivoInicial,
```

Línea 790, el dep:

```ts
    onAnular: () =>
      anularCarga(
        load,
        load.review?.verdictGlobal === "rechazada"
          ? "Rechazada en Operaciones-GPA — registro inválido (error de captura)"
          : undefined,
      ),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/fuelRechazadas.test.ts tests/renderDetalleCarga.test.ts tests/anulacion.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add src/anulacion/ui.ts src/fuel/renderDetalleCarga.ts src/fuel/wire.ts tests/fuelRechazadas.test.ts
git commit -m "feat(fuel): banner de triage en el detalle + motivo precargado en anulacion"
```

---

### Task 7: Backfill único — reclasificar rechazadas históricas en `ValidacionCarga`

**Files:**

- Create: `scripts/backfill-rechazadas-opsgpa.mjs`

**Interfaces:**

- Consumes: tabla DynamoDB `ValidacionCarga-<apiId>-NONE` de PROD (el apiId activo empieza con `t5zfjwkc6…` — confirmarlo con `aws dynamodb list-tables`); credenciales AWS del perfil Admin (la cuenta del sandbox ES la de prod).
- Produces: filas con `verdictGlobal="rechazada"` donde antes decía `"discrepancia"` y la nota era exactamente `"Rechazada en origen (Operaciones-GPA)"`.

- [ ] **Step 1: Write the script**

Crear `scripts/backfill-rechazadas-opsgpa.mjs`:

```js
#!/usr/bin/env node
/**
 * Backfill único (spec 2026-07-21): reclasifica las ValidacionCarga que el puente de Ops
 * escribió como "discrepancia" cuando en realidad eran RECHAZOS en origen.
 *
 *   criterio: fuenteDeteccion="ops-gpa" AND verdictGlobal="discrepancia"
 *             AND nota="Rechazada en origen (Operaciones-GPA)"
 *   cambio:   verdictGlobal → "rechazada"
 *
 * Dry-run por default; --apply para escribir. Idempotente: re-correrlo da 0 candidatas.
 * Uso:  node scripts/backfill-rechazadas-opsgpa.mjs --table <ValidacionCarga-...-NONE> [--apply]
 */
import { DynamoDBClient, paginateScan, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const args = process.argv.slice(2);
const table = args[args.indexOf("--table") + 1];
const apply = args.includes("--apply");
if (args.indexOf("--table") < 0 || !table || table.startsWith("--")) {
  console.error("Falta --table <nombre de la tabla ValidacionCarga>");
  process.exit(1);
}

const NOTA = "Rechazada en origen (Operaciones-GPA)";
const client = new DynamoDBClient({});
let escaneadas = 0;
let candidatas = 0;
let actualizadas = 0;

const pages = paginateScan(
  { client },
  {
    TableName: table,
    FilterExpression: "fuenteDeteccion = :f AND verdictGlobal = :d AND nota = :n",
    ExpressionAttributeValues: {
      ":f": { S: "ops-gpa" },
      ":d": { S: "discrepancia" },
      ":n": { S: NOTA },
    },
  },
);

for await (const page of pages) {
  escaneadas += page.ScannedCount ?? 0;
  for (const item of page.Items ?? []) {
    const row = unmarshall(item);
    candidatas++;
    console.log(`${apply ? "ACTUALIZA" : "haría"}: ${row.loadId} (ts=${row.ts ?? "—"})`);
    if (!apply) continue;
    await client.send(
      new UpdateItemCommand({
        TableName: table,
        Key: { id: item.id },
        UpdateExpression: "SET verdictGlobal = :r",
        // Guardia de idempotencia/carrera: solo si sigue siendo discrepancia.
        ConditionExpression: "verdictGlobal = :d",
        ExpressionAttributeValues: { ":r": { S: "rechazada" }, ":d": { S: "discrepancia" } },
      }),
    );
    actualizadas++;
  }
}

console.log(
  `\nEscaneadas: ${escaneadas} · candidatas: ${candidatas} · actualizadas: ${actualizadas}` +
    (apply ? "" : "  (dry-run — usa --apply para escribir)"),
);
```

- [ ] **Step 2: Dry-run contra prod (NO escribe)**

```bash
aws dynamodb list-tables --output text | tr '\t' '\n' | grep ValidacionCarga
node scripts/backfill-rechazadas-opsgpa.mjs --table <la tabla del apiId t5zfjwkc6...>
```

Expected: lista de `loadId` candidatas (incluida `45|carga|OPS-…` del 2026-07-20 si no fue anulada antes) y el resumen `candidatas: N · actualizadas: 0 (dry-run…)`. Anotar N para el paso de verificación del Task 8.

⚠️ **NO correr `--apply` todavía** — se aplica DESPUÉS del deploy del front (Task 8), para que ningún cliente viejo vea esas filas como "Pendiente".

- [ ] **Step 3: Commit**

```bash
git branch --show-current
git add scripts/backfill-rechazadas-opsgpa.mjs
git commit -m "feat(opsgpa): script de backfill discrepancia->rechazada (dry-run por default)"
```

---

### Task 8: Verificación integral y checklist de release

**Files:** ninguno nuevo (verificación).

- [ ] **Step 1: Suite completa de unit tests**

Run: `npx vitest run`
Expected: PASS completo (sin regresiones en las ~80 suites).

- [ ] **Step 2: Typecheck + build de producción**

Run: `npx tsc --noEmit; if ($?) { npm run build }`
Expected: exit 0 en ambos.

- [ ] **Step 3 (opcional, referencia 2026-07-10): e2e locales**

```bash
node scripts/gen-fixture-mensual.mjs
npx playwright test -c playwright.local.config.ts
```

Expected: ≥47/54 (los 7 fallos ambientales conocidos no cuentan como regresión; comparar A/B contra main si algo nuevo falla).

- [ ] **Step 4: Checklist de release (ORDEN IMPORTA — confirmar el deploy con Navares antes de ejecutarlo)**

1. Push de la rama y deploy a prod (main) — **pedir confirmación explícita**.
2. Ya desplegado el front → correr el backfill: `node scripts/backfill-rechazadas-opsgpa.mjs --table <tabla> --apply`; re-correr sin `--apply` y verificar `candidatas: 0` (idempotencia).
3. Verificación en prod con el caso real (unidad 45, carga 2026-07-20):
   - La fila aparece con pill "Rechazada · Ops" y el KPI "Rechazadas sin triage" ≥ 1.
   - Abrir el detalle → banner de triage → "⛔ No contar…" → el modal trae el motivo precargado → confirmar con `45`.
   - La fila queda atenuada "Rechazada · no contada" con monto tachado, VISIBLE en la vista principal.
   - El KPI de Gasto del período baja ~$700,004 y "Rechazadas sin triage" decrementa.
   - Restaurar desde el panel de anulados y volver a anular (ida y vuelta reversible) — opcional.

---

## Fuera del plan (documentado en el spec §4)

- Enlazar re-captura ↔ rechazada (sin llave confiable).
- `motivoRechazo` estructurado desde Ops (enfoque C, fase 2).
- Auto-anulación (enfoque B, descartado).
