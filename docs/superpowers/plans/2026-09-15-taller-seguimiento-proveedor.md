# Seguimiento del proveedor desde el registro de la unidad — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Administración de Riesgos firme, consulte y dé seguimiento a todo lo del proveedor desde el registro de la unidad, y que la tabla de Taller diga de un vistazo dónde hace falta entrar.

**Architecture:** Cero cambios de servidor. Las columnas que el resolver y el portal ya escriben (`estadoOperativo`, `km`, `fsalidaEst`, `fsalidaEstCompromiso`, `liga*`) se traen al `TallerEntry` en la hidratación; una capa pura nueva (`src/taller/seguimiento.ts`) calcula estado de liga, promesa vencida, resumen de partidas y el distintivo; el monolito pinta. La firma reusa las funciones que ya operan en la bandeja (`_bnPartida`, `__guardarDecisionPartida`), solo cambia dónde se pintan.

**Tech Stack:** Vite + TypeScript vanilla · monolito `Control de flotilla.html` (scripts inline, CSP por hash) · AWS Amplify Gen 2 (AppSync/DynamoDB) · vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-taller-seguimiento-proveedor-design.md`

## Global Constraints

- **Rama y worktree:** `feat/taller-seguimiento-proveedor` en `C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla-wt-taller-seguimiento`. Verificar con `git branch --show-current` antes de cada commit. Base: `origin/main` (ya integrado hasta `aeec150`).
- **Repo PÚBLICO:** ni un correo, RFC, identificador de AWS, nombre de tabla ni hostname en código, pruebas o mensajes de commit. Datos de prueba inventados.
- **Stagear por ruta** (`git add <archivo>`), nunca `git add -A`. Nunca `git push` (lo hace Navares). Nunca `ampx sandbox` ni `npm run amplify:sandbox` (corren contra la cuenta de PROD).
- **CSP:** toda edición de un `<script>` inline de `Control de flotilla.html` exige `npm run csp:sync` ANTES del commit, e incluir `nginx.conf` y el `<meta>` del HTML en ESE MISMO commit. Verificar con `npm run audit:csp`.
- **XSS:** nada de `innerHTML` con datos. Todo lo que lleve texto de la nube se pinta con `createElement` + `textContent`. Guardia: `npm run audit:xss` (el único hallazgo tolerado es el `${alertMin}` preexistente de `main`).
- **Dinero:** la única fórmula del gasto de una visita es `gastoDerivado`/`gastoTotalDe` (`src/taller/partidas.ts`). Ninguna aritmética de dinero nueva en el monolito ni en `seguimiento.ts` que no derive de ahí.
- **Apagador:** todo lo nuevo cuelga de `needs-hibrido`; con el esquema apagado no se pinta nada (R62).
- **Tri-estado:** con `!_partidasConfiables()` (monolito) no se pinta un `$0` ni un conteo: se dice "No se pudieron cargar las partidas" y las decisiones quedan deshabilitadas.
- **Permisos:** ver = cualquiera; decidir partidas = `needs-write` (admin u operativo); liga = `needs-liga` (admin o riesgos). No se toca el esquema.
- **Verificación por tarea:** `npm run test:run > <scratch>/taskN.txt 2>&1` y luego `grep -nE "^ *FAIL" <scratch>/taskN.txt` (NUNCA `| tail`). Único fallo intermitente tolerado: `tests/fuelOpsGuardHandlers.test.ts › handleKmDetectado` — se cita por nombre y se re-corre aislado. Además `npm run typecheck` y `npm run lint`. Baseline al arrancar: **165 archivos / 2186 pruebas**.
- **🔴 Regla nacida de dos defectos en PROD (fieldName y firma de `operativo`):** las pruebas NO ejecutan la autorización real de AppSync ni el contrato de eventos de Amplify. Cualquier tarea que toque permisos o el contrato con el servidor se verifica a mano con una cuenta del rol afectado, no solo con la de administrador. En este plan aplica a la Tarea 6 (decisión inline).

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/taller/types.ts` (modificar) | `TallerEntry` gana los campos del proveedor: `estadoOperativo`, `kmTaller`, `fsalidaEstTaller`, `fsalidaEstCompromiso`, `ligaVersion`, `ligaCreadaEn/Por`, `ligaRevocadaEn/Por`. |
| `src/api/cloudHydrate.ts` (modificar) | Mapear esas columnas de la fila `Taller` al `TallerEntry`. Nada más. |
| `src/taller/seguimiento.ts` (**crear**) | Capa pura: `estadoLiga`, `promesaTaller`, `resumenPartidas`, `distintivoProveedor`, `filasPendientes`, `etiquetaDistintivo`. Sin DOM, sin red. |
| `src/taller/visorFotos.ts` (**crear**) | Visor de fotos reutilizable (overlay). Sin lógica de negocio. |
| `src/api/cloudWire.ts` (modificar) | Puentes `window.__seguimiento*` y `window.__abrirVisorFotos` para el monolito. |
| `Control de flotilla.html` (modificar) | Pinta: bloque Proveedor en el modal, lista de partidas con decisión, distintivo en la tabla, pestaña de pendientes. |
| `src/taller/exportExcel.ts` (modificar) | Hoja "Partidas" y columnas de seguimiento. |
| `tests/tallerSeguimiento*.test.ts` (**crear**) | Pruebas puras y estructurales por tarea. |

---

### Task 1: Las columnas del proveedor llegan a la app

**Files:**
- Modify: `src/taller/types.ts` (dentro de `export type TallerEntry`)
- Modify: `src/api/cloudHydrate.ts` (mapeo `dedupedTaller.map((t) => {...})`)
- Test: `tests/tallerSeguimientoHidratacion.test.ts` (crear)

**Interfaces:**
- Consumes: nada.
- Produces: `TallerEntry` con `estadoOperativo?: "revisando" | "reparando" | "esperandoRefaccion" | "lista"`, `kmTaller?: number`, `fsalidaEstTaller?: string`, `fsalidaEstCompromiso?: string`, `ligaVersion?: number`, `ligaCreadaEn?: string`, `ligaCreadaPor?: string`, `ligaRevocadaEn?: string`, `ligaRevocadaPor?: string`. Todas las tareas siguientes leen de aquí.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `tests/tallerSeguimientoHidratacion.test.ts`:

```ts
// Las columnas que el resolver (liga) y el portal (estado del taller) escriben
// en la fila `Taller` nunca llegaban al TallerEntry: se guardaban y nadie las
// leía (hueco del Plan 1, ruling R88). Esta prueba fija el mapeo.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "..", "src", "api", "cloudHydrate.ts"), "utf8");
const tipos = readFileSync(join(__dirname, "..", "src", "taller", "types.ts"), "utf8");

const bloqueMapeo = (() => {
  const i = src.indexOf("const tallerEntries: TallerEntry[] = dedupedTaller.map(");
  expect(i).toBeGreaterThan(-1);
  const fin = src.indexOf("window.tallerEntries = tallerEntries;", i);
  expect(fin).toBeGreaterThan(i);
  return src.slice(i, fin);
})();

describe("hidratación — las columnas del proveedor llegan al TallerEntry", () => {
  it("el tipo declara los campos del proveedor, separados de los que teclea Riesgos", () => {
    for (const campo of [
      "estadoOperativo?:",
      "kmTaller?:",
      "fsalidaEstTaller?:",
      "fsalidaEstCompromiso?:",
      "ligaVersion?:",
      "ligaCreadaEn?:",
      "ligaCreadaPor?:",
      "ligaRevocadaEn?:",
      "ligaRevocadaPor?:",
    ]) {
      expect(tipos, `falta ${campo} en TallerEntry`).toContain(campo);
    }
    // `km` y `fsalidaEst` (lo que teclea Riesgos) siguen existiendo aparte.
    expect(tipos).toContain("km?: number | string;");
    expect(tipos).toContain("fsalidaEst?: string;");
  });

  it("el mapeo lee las COLUMNAS de la fila, no el blob `datos`", () => {
    for (const linea of [
      "estadoOperativo: t.estadoOperativo ?? undefined,",
      "kmTaller: numOrUndef(t.km),",
      "fsalidaEstTaller: t.fsalidaEst ?? undefined,",
      "fsalidaEstCompromiso: t.fsalidaEstCompromiso ?? undefined,",
      "ligaVersion: numOrUndef(t.ligaVersion),",
      "ligaCreadaEn: t.ligaCreadaEn ?? undefined,",
      "ligaCreadaPor: t.ligaCreadaPor ?? undefined,",
      "ligaRevocadaEn: t.ligaRevocadaEn ?? undefined,",
      "ligaRevocadaPor: t.ligaRevocadaPor ?? undefined,",
    ]) {
      expect(bloqueMapeo, `falta el mapeo: ${linea}`).toContain(linea);
    }
  });

  it("NO se suben de vuelta: el upload sigue mandando solo lo de `datos`", () => {
    const up = readFileSync(join(__dirname, "..", "src", "api", "batchUpload.ts"), "utf8");
    for (const campo of ["estadoOperativo", "fsalidaEstCompromiso", "ligaCreadaPor"]) {
      expect(up, `${campo} no debe viajar en el upload`).not.toContain(`${campo}:`);
    }
  });
});
```

- [ ] **Step 2: Correr la prueba y verla fallar**

Run: `npx vitest run tests/tallerSeguimientoHidratacion.test.ts`
Expected: FAIL — "falta estadoOperativo?: en TallerEntry".

- [ ] **Step 3: Agregar los campos al tipo**

En `src/taller/types.ts`, dentro de `export type TallerEntry`, justo después del bloque de `km?: number | string;`:

```ts
  // ── Lo que reporta el PROVEEDOR desde su liga (columnas reales de `Taller`,
  //    escritas por el portal y por el resolver). Se leen, nunca se escriben
  //    desde la app: el taller es la única fuente de verdad de estos datos.
  //    Separados a propósito de `km`/`fsalidaEst`, que son lo que teclea Riesgos.
  /** Los 4 botones del taller (spec §6.1). */
  estadoOperativo?: "revisando" | "reparando" | "esperandoRefaccion" | "lista";
  /** Km que reportó el taller al abrir la liga (columna `km`). */
  kmTaller?: number;
  /** Fecha de salida que el taller promete HOY (columna `fsalidaEst`). */
  fsalidaEstTaller?: string;
  /** La PRIMERA promesa, congelada: el portal la escribe una sola vez. */
  fsalidaEstCompromiso?: string;

  // ── Liga del proveedor (columnas reales, ver amplify/data/resource.ts).
  ligaVersion?: number;
  ligaCreadaEn?: string;
  ligaCreadaPor?: string;
  ligaRevocadaEn?: string;
  ligaRevocadaPor?: string;
```

- [ ] **Step 4: Mapear las columnas en la hidratación**

En `src/api/cloudHydrate.ts`, dentro del objeto que devuelve `dedupedTaller.map((t) => { ... return { ... } })`, justo antes de `_cloud: true,`:

```ts
        // Lo que reporta el proveedor y el estado de su liga: COLUMNAS de la
        // fila, no `datos` (el blob lo reemplaza cada upload y las perdería).
        // Ver spec 2026-09-15-taller-seguimiento-proveedor-design.md §4.1.
        estadoOperativo: t.estadoOperativo ?? undefined,
        kmTaller: numOrUndef(t.km),
        fsalidaEstTaller: t.fsalidaEst ?? undefined,
        fsalidaEstCompromiso: t.fsalidaEstCompromiso ?? undefined,
        ligaVersion: numOrUndef(t.ligaVersion),
        ligaCreadaEn: t.ligaCreadaEn ?? undefined,
        ligaCreadaPor: t.ligaCreadaPor ?? undefined,
        ligaRevocadaEn: t.ligaRevocadaEn ?? undefined,
        ligaRevocadaPor: t.ligaRevocadaPor ?? undefined,
```

- [ ] **Step 5: Correr la prueba y verla pasar**

Run: `npx vitest run tests/tallerSeguimientoHidratacion.test.ts`
Expected: PASS (3 pruebas).

- [ ] **Step 6: Batería y commit**

```bash
npm run typecheck
npm run lint
npm run test:run > "$SCRATCH/task1.txt" 2>&1; grep -nE "^ *FAIL" "$SCRATCH/task1.txt"
git add src/taller/types.ts src/api/cloudHydrate.ts tests/tallerSeguimientoHidratacion.test.ts
git commit -m "feat(taller): las columnas del proveedor llegan al TallerEntry"
```

---

### Task 2: Capa pura — estado de la liga y promesa del taller

**Files:**
- Create: `src/taller/seguimiento.ts`
- Test: `tests/tallerSeguimientoEstado.test.ts` (crear)

**Interfaces:**
- Consumes: `TallerEntry` de la Tarea 1.
- Produces:
  - `export const VIGENCIA_LIGA_DIAS = 90`
  - `export type EstadoLiga = { kind: "sin-liga" } | { kind: "activa"; diasRestantes: number; venceEn: string; emitidaEn: string; emitidaPor: string } | { kind: "vencida"; vencioEn: string; emitidaEn: string; emitidaPor: string } | { kind: "revocada"; revocadaEn: string; revocadaPor: string }`
  - `export function estadoLiga(e: Partial<TallerEntry>, ahoraISO: string): EstadoLiga`
  - `export type PromesaTaller = { kind: "sin-promesa" } | { kind: "vigente"; fecha: string; diasRestantes: number; compromisoOriginal?: string } | { kind: "vencida"; fecha: string; diasVencida: number; compromisoOriginal?: string }`
  - `export function promesaTaller(e: Partial<TallerEntry>, hoyISO: string): PromesaTaller`

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/tallerSeguimientoEstado.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { estadoLiga, promesaTaller, VIGENCIA_LIGA_DIAS } from "../src/taller/seguimiento";

const EMITIDA = "2026-09-01T10:00:00.000Z";
const POR = "alguien@ejemplo.test";

describe("estadoLiga", () => {
  it("sin ligaCreadaEn no hay liga", () => {
    expect(estadoLiga({}, "2026-09-15T12:00:00.000Z")).toEqual({ kind: "sin-liga" });
  });

  it("recién emitida: activa con los días que faltan", () => {
    const r = estadoLiga(
      { ligaCreadaEn: EMITIDA, ligaCreadaPor: POR },
      "2026-09-15T12:00:00.000Z",
    );
    expect(r.kind).toBe("activa");
    if (r.kind !== "activa") throw new Error("kind");
    expect(r.diasRestantes).toBe(76); // 90 − 14 días transcurridos
    expect(r.emitidaPor).toBe(POR);
    expect(r.venceEn.slice(0, 10)).toBe("2026-11-30");
  });

  it("el día 90 exacto ya está vencida (el portal deja de aceptarla)", () => {
    const r = estadoLiga({ ligaCreadaEn: EMITIDA, ligaCreadaPor: POR }, "2026-11-30T10:00:00.000Z");
    expect(r.kind).toBe("vencida");
  });

  it("revocada después de emitir gana sobre activa", () => {
    const r = estadoLiga(
      {
        ligaCreadaEn: EMITIDA,
        ligaCreadaPor: POR,
        ligaRevocadaEn: "2026-09-10T10:00:00.000Z",
        ligaRevocadaPor: POR,
      },
      "2026-09-15T12:00:00.000Z",
    );
    expect(r.kind).toBe("revocada");
  });

  it("re-emitida DESPUÉS de una revocación vuelve a estar activa", () => {
    // emitirLiga limpia ligaRevocada*, pero si llegara una fila con ambas, gana
    // la más reciente: la liga que sirve es la última emitida.
    const r = estadoLiga(
      {
        ligaCreadaEn: "2026-09-12T10:00:00.000Z",
        ligaCreadaPor: POR,
        ligaRevocadaEn: "2026-09-10T10:00:00.000Z",
        ligaRevocadaPor: POR,
      },
      "2026-09-15T12:00:00.000Z",
    );
    expect(r.kind).toBe("activa");
  });

  it("la vigencia es la MISMA que aplica el portal", () => {
    const portal = readFileSync(
      join(__dirname, "..", "amplify", "functions", "taller-portal", "token.ts"),
      "utf8",
    );
    const m = portal.match(/VIGENCIA_LIGA_MS\s*=\s*(\d+)\s*\*\s*24/);
    expect(m, "no se encontró VIGENCIA_LIGA_MS en el portal").not.toBeNull();
    expect(Number(m![1])).toBe(VIGENCIA_LIGA_DIAS);
  });
});

describe("promesaTaller", () => {
  it("sin fecha prometida no hay promesa", () => {
    expect(promesaTaller({}, "2026-09-15")).toEqual({ kind: "sin-promesa" });
  });

  it("fecha futura: vigente con los días que faltan", () => {
    const r = promesaTaller({ fsalidaEstTaller: "2026-09-19" }, "2026-09-15");
    expect(r).toEqual({ kind: "vigente", fecha: "2026-09-19", diasRestantes: 4 });
  });

  it("fecha pasada y visita abierta: vencida con los días de retraso", () => {
    const r = promesaTaller({ fsalidaEstTaller: "2026-09-12" }, "2026-09-15");
    expect(r.kind).toBe("vencida");
    if (r.kind !== "vencida") throw new Error("kind");
    expect(r.diasVencida).toBe(3);
  });

  it("una visita YA CERRADA no tiene promesa vencida", () => {
    for (const cerrada of [
      { fsalidaEstTaller: "2026-09-12", fsalidaReal: "2026-09-13" },
      { fsalidaEstTaller: "2026-09-12", estado: "Finalizado" as const },
    ]) {
      expect(promesaTaller(cerrada, "2026-09-15").kind).not.toBe("vencida");
    }
  });

  it("si el taller movió la promesa, se conserva el compromiso ORIGINAL", () => {
    const r = promesaTaller(
      { fsalidaEstTaller: "2026-09-19", fsalidaEstCompromiso: "2026-09-12" },
      "2026-09-15",
    );
    expect(r.kind).toBe("vigente");
    if (r.kind !== "vigente") throw new Error("kind");
    expect(r.compromisoOriginal).toBe("2026-09-12");
  });

  it("si no la movió, no se repite el compromiso", () => {
    const r = promesaTaller(
      { fsalidaEstTaller: "2026-09-19", fsalidaEstCompromiso: "2026-09-19" },
      "2026-09-15",
    );
    if (r.kind !== "vigente") throw new Error("kind");
    expect(r.compromisoOriginal).toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/tallerSeguimientoEstado.test.ts`
Expected: FAIL — no existe `src/taller/seguimiento.ts`.

- [ ] **Step 3: Implementar**

Crear `src/taller/seguimiento.ts`:

```ts
/**
 * Seguimiento del proveedor — capa PURA (sin DOM, sin red).
 *
 * Todo lo que calcula sale de columnas que el portal y el resolver YA escriben:
 * este módulo no inventa datos ni hace aritmética de dinero (para eso está
 * gastoDerivado en ./partidas). Ver la spec
 * docs/superpowers/specs/2026-09-15-taller-seguimiento-proveedor-design.md
 */
import type { TallerEntry } from "./types";

/** Debe coincidir con VIGENCIA_LIGA_MS del portal (taller-portal/token.ts).
 *  El frontend no puede importar del backend, así que se duplica y una prueba
 *  compara ambos valores: si alguien cambia uno, la prueba cae. */
export const VIGENCIA_LIGA_DIAS = 90;

const DIA_MS = 24 * 60 * 60 * 1000;

export type EstadoLiga =
  | { kind: "sin-liga" }
  | { kind: "activa"; diasRestantes: number; venceEn: string; emitidaEn: string; emitidaPor: string }
  | { kind: "vencida"; vencioEn: string; emitidaEn: string; emitidaPor: string }
  | { kind: "revocada"; revocadaEn: string; revocadaPor: string };

export function estadoLiga(e: Partial<TallerEntry>, ahoraISO: string): EstadoLiga {
  const emitidaEn = (e.ligaCreadaEn ?? "").trim();
  if (!emitidaEn) return { kind: "sin-liga" };

  const revocadaEn = (e.ligaRevocadaEn ?? "").trim();
  // Una revocación solo cuenta si es POSTERIOR a la emisión vigente: emitir
  // limpia esas columnas, pero una fila vieja puede traer ambas.
  if (revocadaEn && Date.parse(revocadaEn) >= Date.parse(emitidaEn)) {
    return { kind: "revocada", revocadaEn, revocadaPor: (e.ligaRevocadaPor ?? "").trim() };
  }

  const emitidaPor = (e.ligaCreadaPor ?? "").trim();
  const vence = Date.parse(emitidaEn) + VIGENCIA_LIGA_DIAS * DIA_MS;
  const ahora = Date.parse(ahoraISO);
  if (!Number.isFinite(vence) || !Number.isFinite(ahora)) return { kind: "sin-liga" };

  const venceEn = new Date(vence).toISOString();
  if (ahora >= vence) return { kind: "vencida", vencioEn: venceEn, emitidaEn, emitidaPor };
  return {
    kind: "activa",
    diasRestantes: Math.ceil((vence - ahora) / DIA_MS),
    venceEn,
    emitidaEn,
    emitidaPor,
  };
}

export type PromesaTaller =
  | { kind: "sin-promesa" }
  | { kind: "vigente"; fecha: string; diasRestantes: number; compromisoOriginal?: string }
  | { kind: "vencida"; fecha: string; diasVencida: number; compromisoOriginal?: string };

/** Una visita cerrada ya no debe nada: su promesa no vence. */
function visitaCerrada(e: Partial<TallerEntry>): boolean {
  if ((e.fsalidaReal ?? "").trim()) return true;
  return e.estado === "Finalizado" || e.estado === "Listo";
}

export function promesaTaller(e: Partial<TallerEntry>, hoyISO: string): PromesaTaller {
  const fecha = (e.fsalidaEstTaller ?? "").trim().slice(0, 10);
  if (!fecha) return { kind: "sin-promesa" };

  const original = (e.fsalidaEstCompromiso ?? "").trim().slice(0, 10);
  const compromisoOriginal = original && original !== fecha ? original : undefined;

  // Comparación por fecha CIVIL: sin horas ni husos, que es como el taller la
  // captura y como Riesgos la lee.
  const hoy = Date.parse(`${hoyISO.slice(0, 10)}T00:00:00Z`);
  const prometida = Date.parse(`${fecha}T00:00:00Z`);
  if (!Number.isFinite(hoy) || !Number.isFinite(prometida)) return { kind: "sin-promesa" };

  const dias = Math.round((prometida - hoy) / DIA_MS);
  if (dias < 0 && !visitaCerrada(e)) {
    return { kind: "vencida", fecha, diasVencida: -dias, compromisoOriginal };
  }
  return { kind: "vigente", fecha, diasRestantes: Math.max(dias, 0), compromisoOriginal };
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run tests/tallerSeguimientoEstado.test.ts`
Expected: PASS (12 pruebas).

- [ ] **Step 5: Batería y commit**

```bash
npm run typecheck && npm run lint
npm run test:run > "$SCRATCH/task2.txt" 2>&1; grep -nE "^ *FAIL" "$SCRATCH/task2.txt"
git add src/taller/seguimiento.ts tests/tallerSeguimientoEstado.test.ts
git commit -m "feat(taller): capa pura del estado de la liga y la promesa del taller"
```

---

### Task 3: Capa pura — resumen de partidas, distintivo y pendientes

**Files:**
- Modify: `src/taller/seguimiento.ts`
- Test: `tests/tallerSeguimientoDistintivo.test.ts` (crear)

**Interfaces:**
- Consumes: `estadoLiga`, `promesaTaller` (Tarea 2); `Partida` y `gastoDerivado` de `src/taller/partidas.ts`; `visitaKeyDe` de `src/api/tallerPartidas.ts`.
- Produces:
  - `export type ResumenPartidas = { pendientes: {n, monto}, autorizadas: {n, monto}, rechazadas: {n, monto}, borradoresTaller: number }`
  - `export function resumenPartidas(ps: readonly Partida[]): ResumenPartidas`
  - `export type Distintivo = {kind:"promesa-vencida";dias:number} | {kind:"esperando-firma";n:number} | {kind:"liga-activa";dias:number} | {kind:"liga-revocada"} | {kind:"sin-liga"}`
  - `export function distintivoProveedor(liga: EstadoLiga, promesa: PromesaTaller, r: ResumenPartidas): Distintivo`
  - `export function etiquetaDistintivo(d: Distintivo): string`
  - `export type FilaPendiente = { entry: TallerEntry; visitaKey: string; n: number; monto: number; masAntigua?: string; distintivo: Distintivo }`
  - `export function filasPendientes(entries: readonly TallerEntry[], porVisita: ReadonlyMap<string, Partida[]>, ahoraISO: string): FilaPendiente[]`

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/tallerSeguimientoDistintivo.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  resumenPartidas,
  distintivoProveedor,
  etiquetaDistintivo,
  filasPendientes,
  estadoLiga,
  promesaTaller,
} from "../src/taller/seguimiento";
import { gastoDerivado, type Partida } from "../src/taller/partidas";
import { visitaKeyDe } from "../src/api/tallerPartidas";
import type { TallerEntry } from "../src/taller/types";

const VK = "JB4479A|2026-09-14";
const P = (o: Partial<Partida> = {}): Partida => ({
  partidaId: "p",
  visitaKey: VK,
  descripcion: "x",
  tipo: "refaccion",
  precio: 100,
  estado: "propuesta",
  fotos: [],
  ...o,
});

describe("resumenPartidas", () => {
  const ps = [
    P({ partidaId: "a", estado: "propuesta", precio: 550 }),
    P({ partidaId: "b", estado: "autorizada", precio: 35000, precioAutorizado: 35000 }),
    P({ partidaId: "c", estado: "autorizada", precio: 250, precioAutorizado: 250 }),
    P({ partidaId: "d", estado: "rechazada", precio: 2500 }),
    P({ partidaId: "e", estado: "borrador", precio: 80, creadoPor: "liga:" + VK }),
    P({ partidaId: "f", estado: "cancelada", precio: 999 }),
  ];

  it("cuenta y suma por estado", () => {
    const r = resumenPartidas(ps);
    expect(r.pendientes).toEqual({ n: 1, monto: 550 });
    expect(r.autorizadas).toEqual({ n: 2, monto: 35250 });
    expect(r.rechazadas).toEqual({ n: 1, monto: 2500 });
    expect(r.borradoresTaller).toBe(1);
  });

  it("lo autorizado COINCIDE con la única fórmula del dinero (gastoDerivado)", () => {
    const entry = { id: "t1", estado: "En Diagnóstico" } as TallerEntry;
    expect(resumenPartidas(ps).autorizadas.monto).toBe(gastoDerivado(entry, ps).gasto);
  });

  it("sin partidas, todo en cero (nunca NaN)", () => {
    const r = resumenPartidas([]);
    expect(r.autorizadas).toEqual({ n: 0, monto: 0 });
    expect(r.pendientes).toEqual({ n: 0, monto: 0 });
  });
});

describe("distintivoProveedor — una sola señal, por prioridad", () => {
  const sinNada = resumenPartidas([]);
  const conPendiente = resumenPartidas([P({ estado: "propuesta", precio: 550 })]);
  const ligaActiva = estadoLiga(
    { ligaCreadaEn: "2026-09-01T00:00:00.000Z" },
    "2026-09-15T00:00:00.000Z",
  );
  const promVencida = promesaTaller({ fsalidaEstTaller: "2026-09-12" }, "2026-09-15");
  const promNinguna = promesaTaller({}, "2026-09-15");

  it("promesa vencida gana sobre todo", () => {
    expect(distintivoProveedor(ligaActiva, promVencida, conPendiente)).toEqual({
      kind: "promesa-vencida",
      dias: 3,
    });
  });

  it("esperando firma gana sobre liga activa", () => {
    expect(distintivoProveedor(ligaActiva, promNinguna, conPendiente)).toEqual({
      kind: "esperando-firma",
      n: 1,
    });
  });

  it("liga activa cuando no hay nada más urgente", () => {
    expect(distintivoProveedor(ligaActiva, promNinguna, sinNada)).toEqual({
      kind: "liga-activa",
      dias: 76,
    });
  });

  it("revocada y sin liga", () => {
    const rev = estadoLiga(
      { ligaCreadaEn: "2026-09-01T00:00:00.000Z", ligaRevocadaEn: "2026-09-05T00:00:00.000Z" },
      "2026-09-15T00:00:00.000Z",
    );
    expect(distintivoProveedor(rev, promNinguna, sinNada)).toEqual({ kind: "liga-revocada" });
    expect(distintivoProveedor({ kind: "sin-liga" }, promNinguna, sinNada)).toEqual({
      kind: "sin-liga",
    });
  });

  it("una liga VENCIDA sin nada pendiente se lee como 'sin liga' (ya no sirve)", () => {
    const venc = estadoLiga(
      { ligaCreadaEn: "2026-01-01T00:00:00.000Z" },
      "2026-09-15T00:00:00.000Z",
    );
    expect(distintivoProveedor(venc, promNinguna, sinNada)).toEqual({ kind: "sin-liga" });
  });

  it("las etiquetas son las que ve el usuario", () => {
    expect(etiquetaDistintivo({ kind: "promesa-vencida", dias: 3 })).toBe("Promesa vencida · 3d");
    expect(etiquetaDistintivo({ kind: "esperando-firma", n: 2 })).toBe("Esperando firma · 2");
    expect(etiquetaDistintivo({ kind: "liga-activa", dias: 76 })).toBe("Liga activa · 76d");
    expect(etiquetaDistintivo({ kind: "liga-revocada" })).toBe("Liga revocada");
    expect(etiquetaDistintivo({ kind: "sin-liga" })).toBe("Sin liga");
  });
});

describe("filasPendientes — la bandeja de ENTRADA", () => {
  const e1 = { id: "t1", plate: "JB4479A", fentrada: "2026-09-14", estado: "En Diagnóstico" } as TallerEntry;
  const e2 = { id: "t2", plate: "JB4256A", fentrada: "2026-09-08", estado: "En Reparación" } as TallerEntry;
  const k1 = visitaKeyDe(e1);
  const k2 = visitaKeyDe(e2);

  const mapa = new Map<string, Partida[]>([
    [k1, [P({ partidaId: "a", visitaKey: k1, precio: 550, propuestoEn: "2026-09-14T17:21:00Z" })]],
    [
      k2,
      [
        P({ partidaId: "b", visitaKey: k2, precio: 700, propuestoEn: "2026-09-13T09:00:00Z" }),
        P({ partidaId: "c", visitaKey: k2, precio: 500, propuestoEn: "2026-09-14T09:00:00Z" }),
        P({ partidaId: "d", visitaKey: k2, estado: "autorizada", precio: 100, precioAutorizado: 100 }),
      ],
    ],
  ]);

  it("una fila por visita con pendientes, con su conteo y monto", () => {
    const filas = filasPendientes([e1, e2], mapa, "2026-09-15T12:00:00.000Z");
    expect(filas).toHaveLength(2);
    const f2 = filas.find((f) => f.visitaKey === k2)!;
    expect(f2.n).toBe(2);
    expect(f2.monto).toBe(1200);
  });

  it("ordena por la espera más larga: la más antigua primero", () => {
    const filas = filasPendientes([e1, e2], mapa, "2026-09-15T12:00:00.000Z");
    expect(filas[0]!.visitaKey).toBe(k2); // propuesta desde el 13
    expect(filas[0]!.masAntigua).toBe("2026-09-13T09:00:00Z");
  });

  it("una visita sin pendientes no aparece", () => {
    const soloAutorizadas = new Map<string, Partida[]>([
      [k1, [P({ visitaKey: k1, estado: "autorizada", precioAutorizado: 100 })]],
    ]);
    expect(filasPendientes([e1], soloAutorizadas, "2026-09-15T12:00:00.000Z")).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/tallerSeguimientoDistintivo.test.ts`
Expected: FAIL — `resumenPartidas is not a function`.

- [ ] **Step 3: Implementar (agregar al final de `src/taller/seguimiento.ts`)**

```ts
import { gastoDerivado, type Partida } from "./partidas";
import { visitaKeyDe } from "../api/tallerPartidas";

export type ResumenPartidas = {
  pendientes: { n: number; monto: number };
  autorizadas: { n: number; monto: number };
  rechazadas: { n: number; monto: number };
  /** Capturadas por el taller y AÚN NO enviadas: informativo, no accionable. */
  borradoresTaller: number;
};

const finito = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function resumenPartidas(ps: readonly Partida[]): ResumenPartidas {
  const r: ResumenPartidas = {
    pendientes: { n: 0, monto: 0 },
    autorizadas: { n: 0, monto: 0 },
    rechazadas: { n: 0, monto: 0 },
    borradoresTaller: 0,
  };
  for (const p of ps) {
    if (p.estado === "propuesta") {
      r.pendientes.n++;
      r.pendientes.monto += finito(p.precio);
    } else if (p.estado === "autorizada") {
      r.autorizadas.n++;
      // El monto autorizado sale de precioAutorizado, que es lo que congela
      // `autorizar` — la MISMA base que usa gastoDerivado. Una prueba lo exige.
      r.autorizadas.monto += finito(p.precioAutorizado);
    } else if (p.estado === "rechazada") {
      r.rechazadas.n++;
      r.rechazadas.monto += finito(p.precio);
    } else if (p.estado === "borrador" && String(p.creadoPor ?? "").startsWith("liga:")) {
      r.borradoresTaller++;
    }
  }
  return r;
}

export type Distintivo =
  | { kind: "promesa-vencida"; dias: number }
  | { kind: "esperando-firma"; n: number }
  | { kind: "liga-activa"; dias: number }
  | { kind: "liga-revocada" }
  | { kind: "sin-liga" };

/** Una sola señal por visita, la más urgente. El orden es la decisión de
 *  producto (spec §6.2) y no depende de quién llame. */
export function distintivoProveedor(
  liga: EstadoLiga,
  promesa: PromesaTaller,
  resumen: ResumenPartidas,
): Distintivo {
  if (promesa.kind === "vencida") return { kind: "promesa-vencida", dias: promesa.diasVencida };
  if (resumen.pendientes.n > 0) return { kind: "esperando-firma", n: resumen.pendientes.n };
  if (liga.kind === "activa") return { kind: "liga-activa", dias: liga.diasRestantes };
  if (liga.kind === "revocada") return { kind: "liga-revocada" };
  // Una liga vencida ya no sirve para nada: se lee igual que no tenerla.
  return { kind: "sin-liga" };
}

export function etiquetaDistintivo(d: Distintivo): string {
  switch (d.kind) {
    case "promesa-vencida":
      return `Promesa vencida · ${d.dias}d`;
    case "esperando-firma":
      return `Esperando firma · ${d.n}`;
    case "liga-activa":
      return `Liga activa · ${d.dias}d`;
    case "liga-revocada":
      return "Liga revocada";
    default:
      return "Sin liga";
  }
}

export type FilaPendiente = {
  entry: TallerEntry;
  visitaKey: string;
  n: number;
  monto: number;
  /** `propuestoEn` de la pendiente más antigua: lo que más ha esperado. */
  masAntigua?: string;
  distintivo: Distintivo;
};

export function filasPendientes(
  entries: readonly TallerEntry[],
  porVisita: ReadonlyMap<string, Partida[]>,
  ahoraISO: string,
): FilaPendiente[] {
  const hoy = ahoraISO.slice(0, 10);
  const filas: FilaPendiente[] = [];
  for (const entry of entries) {
    const visitaKey = visitaKeyDe(entry);
    const ps = porVisita.get(visitaKey) ?? [];
    const resumen = resumenPartidas(ps);
    if (resumen.pendientes.n === 0) continue;
    const esperas = ps
      .filter((p) => p.estado === "propuesta" && p.propuestoEn)
      .map((p) => String(p.propuestoEn))
      .sort();
    filas.push({
      entry,
      visitaKey,
      n: resumen.pendientes.n,
      monto: resumen.pendientes.monto,
      masAntigua: esperas[0],
      distintivo: distintivoProveedor(estadoLiga(entry, ahoraISO), promesaTaller(entry, hoy), resumen),
    });
  }
  // La que más ha esperado, arriba. Sin `propuestoEn` va al final.
  return filas.sort((a, b) => (a.masAntigua ?? "9999").localeCompare(b.masAntigua ?? "9999"));
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run tests/tallerSeguimientoDistintivo.test.ts`
Expected: PASS (11 pruebas).

- [ ] **Step 5: Batería y commit**

```bash
npm run typecheck && npm run lint
npm run test:run > "$SCRATCH/task3.txt" 2>&1; grep -nE "^ *FAIL" "$SCRATCH/task3.txt"
git add src/taller/seguimiento.ts tests/tallerSeguimientoDistintivo.test.ts
git commit -m "feat(taller): resumen de partidas, distintivo por prioridad y bandeja de entrada"
```

---

### Task 4: Visor de fotos

**Files:**
- Create: `src/taller/visorFotos.ts`
- Modify: `src/api/cloudWire.ts` (puente `window.__abrirVisorFotos`)
- Test: `tests/tallerVisorFotos.test.ts` (crear)

**Interfaces:**
- Consumes: `urlFotoPartida` (ya expuesta como `window.__urlFotoPartida`, ver `cloudHydrate.ts`).
- Produces: `export function abrirVisorFotos(opts: { llaves: readonly string[]; inicial?: number; titulo?: string; subtitulo?: string; url: (llave: string) => Promise<string | null> }): void` y el puente `window.__abrirVisorFotos` con la misma firma menos `url` (lo inyecta el puente).

- [ ] **Step 1: Escribir la prueba que falla**

Crear `tests/tallerVisorFotos.test.ts`:

```ts
// El visor se construye con createElement (nunca innerHTML) y vive en happy-dom.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { abrirVisorFotos } from "../src/taller/visorFotos";

const url = vi.fn(async (k: string) => `https://ejemplo.test/${k}`);

beforeEach(() => {
  document.body.innerHTML = "";
  url.mockClear();
});

const abrir = () =>
  abrirVisorFotos({
    llaves: ["a.jpg", "b.jpg", "c.jpg"],
    titulo: "Balatas delanteras · $550.00",
    subtitulo: "Eco 06 · subida por el taller",
    url,
  });

describe("visor de fotos", () => {
  it("abre con la primera foto y dice cuántas hay", async () => {
    abrir();
    const visor = document.querySelector("#taller-visor-fotos");
    expect(visor).not.toBeNull();
    expect(visor!.getAttribute("role")).toBe("dialog");
    expect(visor!.textContent).toContain("1 de 3");
    expect(visor!.textContent).toContain("Balatas delanteras");
  });

  it("la flecha derecha avanza y la izquierda retrocede", async () => {
    abrir();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(document.querySelector("#taller-visor-fotos")!.textContent).toContain("2 de 3");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(document.querySelector("#taller-visor-fotos")!.textContent).toContain("1 de 3");
  });

  it("Esc cierra y limpia el DOM", () => {
    abrir();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector("#taller-visor-fotos")).toBeNull();
  });

  it("sin fotos no abre nada", () => {
    abrirVisorFotos({ llaves: [], url });
    expect(document.querySelector("#taller-visor-fotos")).toBeNull();
  });

  it("no usa innerHTML con datos: el título viaja como texto", () => {
    abrirVisorFotos({ llaves: ["a.jpg"], titulo: "<img src=x onerror=alert(1)>", url });
    const visor = document.querySelector("#taller-visor-fotos")!;
    expect(visor.querySelector("img[src='x']")).toBeNull();
    expect(visor.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/tallerVisorFotos.test.ts`
Expected: FAIL — no existe el módulo.

- [ ] **Step 3: Implementar `src/taller/visorFotos.ts`**

```ts
/**
 * Visor de fotos del taller. Un solo overlay reutilizado por el registro de la
 * unidad y por la bandeja de entrada.
 *
 * Reglas del repo que aplican aquí: cero `innerHTML` (todo createElement +
 * textContent) y las URLs son FIRMADAS y por demanda — la misma función que ya
 * usa la miniatura de la bandeja, nunca un índice del bucket.
 */
const ID = "taller-visor-fotos";

export function abrirVisorFotos(opts: {
  llaves: readonly string[];
  inicial?: number;
  titulo?: string;
  subtitulo?: string;
  url: (llave: string) => Promise<string | null>;
}): void {
  const { llaves, titulo, subtitulo, url } = opts;
  if (!llaves.length) return;
  document.getElementById(ID)?.remove();

  let i = Math.min(Math.max(opts.inicial ?? 0, 0), llaves.length - 1);
  const devolverFoco = document.activeElement as HTMLElement | null;

  const overlay = document.createElement("div");
  overlay.id = ID;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Fotos del taller");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:9999;background:rgba(11,15,25,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px";

  const cabecera = document.createElement("div");
  cabecera.style.cssText =
    "position:absolute;top:16px;left:24px;right:24px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px";
  const textos = document.createElement("div");
  textos.style.cssText = "display:flex;flex-direction:column;gap:2px;min-width:0";
  const t1 = document.createElement("span");
  t1.style.cssText = "font-size:13px;font-weight:700;color:#e2e8f0";
  t1.textContent = titulo ?? "Foto del taller";
  const t2 = document.createElement("span");
  t2.style.cssText = "font-size:11px;color:#94a3b8";
  textos.append(t1, t2);

  const btnCerrar = document.createElement("button");
  btnCerrar.type = "button";
  btnCerrar.setAttribute("aria-label", "Cerrar");
  btnCerrar.textContent = "✕";
  btnCerrar.style.cssText =
    "min-width:44px;min-height:44px;border-radius:6px;border:1px solid rgba(148,170,205,.25);background:transparent;color:#e2e8f0;cursor:pointer;font-size:14px";
  cabecera.append(textos, btnCerrar);

  const img = document.createElement("img");
  img.alt = "Foto del taller";
  img.style.cssText =
    "max-width:90vw;max-height:78vh;object-fit:contain;border-radius:10px;background:#1a2234";
  const aviso = document.createElement("div");
  aviso.style.cssText = "font-size:11px;color:#94a3b8";

  const fila = document.createElement("div");
  fila.style.cssText = "display:flex;align-items:center;gap:18px";
  const flecha = (etiqueta: string, paso: number): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", etiqueta);
    b.textContent = paso < 0 ? "‹" : "›";
    b.style.cssText =
      "min-width:44px;min-height:44px;border-radius:22px;border:none;background:rgba(226,232,240,.12);color:#e2e8f0;font-size:20px;cursor:pointer";
    b.addEventListener("click", () => mover(paso));
    b.style.visibility = llaves.length > 1 ? "visible" : "hidden";
    return b;
  };
  fila.append(flecha("Foto anterior", -1), img, flecha("Foto siguiente", 1));

  overlay.append(cabecera, fila, aviso);

  function pintar(): void {
    t2.textContent = `${subtitulo ? subtitulo + " · " : ""}foto ${i + 1} de ${llaves.length}`;
    img.removeAttribute("src");
    aviso.textContent = "Cargando…";
    const llave = llaves[i] as string;
    void url(llave)
      .then((u) => {
        if (!document.getElementById(ID)) return;
        if (!u) {
          aviso.textContent = "Foto no disponible";
          return;
        }
        img.src = u;
        aviso.textContent = "";
      })
      .catch(() => {
        aviso.textContent = "Foto no disponible";
      });
  }

  function mover(paso: number): void {
    i = (i + paso + llaves.length) % llaves.length;
    pintar();
  }

  function cerrar(): void {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    devolverFoco?.focus?.();
  }

  function onKey(ev: KeyboardEvent): void {
    if (ev.key === "Escape") cerrar();
    else if (ev.key === "ArrowRight") mover(1);
    else if (ev.key === "ArrowLeft") mover(-1);
  }

  btnCerrar.addEventListener("click", cerrar);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) cerrar();
  });
  document.addEventListener("keydown", onKey);

  document.body.appendChild(overlay);
  img.onerror = () => {
    aviso.textContent = "Foto no disponible";
  };
  pintar();
  btnCerrar.focus();
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run tests/tallerVisorFotos.test.ts`
Expected: PASS (5 pruebas).

- [ ] **Step 5: Publicar el puente para el monolito**

En `src/api/cloudWire.ts`, junto a los otros `window.__taller*` (buscar `window.__tallerLiga = {`), agregar antes de ese bloque:

```ts
  // Visor de fotos (bloque Proveedor y bandeja de entrada). La URL firmada sale
  // del mismo puente que ya usa la miniatura: por demanda, nunca un índice.
  window.__abrirVisorFotos = (opts) =>
    abrirVisorFotos({
      ...opts,
      url: (llave) => urlFotoPartida(llave),
    });
```

Agregar el import al inicio del archivo:

```ts
import { abrirVisorFotos } from "../taller/visorFotos";
```

Y declarar el tipo en el bloque `declare global { interface Window { ... } }` de `src/api/cloudHydrate.ts`:

```ts
    /** Abre el visor de fotos del taller. Lo monta src/taller/visorFotos.ts. */
    __abrirVisorFotos?: (opts: {
      llaves: readonly string[];
      inicial?: number;
      titulo?: string;
      subtitulo?: string;
    }) => void;
```

- [ ] **Step 6: Batería y commit**

```bash
npm run typecheck && npm run lint
npm run test:run > "$SCRATCH/task4.txt" 2>&1; grep -nE "^ *FAIL" "$SCRATCH/task4.txt"
git add src/taller/visorFotos.ts src/api/cloudWire.ts src/api/cloudHydrate.ts tests/tallerVisorFotos.test.ts
git commit -m "feat(taller): visor de fotos del proveedor, reutilizable"
```

---

### Task 5: Bloque "Proveedor" en el registro — liga y estado del taller

**Files:**
- Modify: `Control de flotilla.html` (markup del modal tras la sección "Identificación de la unidad"; función `openTallerModal`; mover los dos botones de liga del pie al bloque)
- Modify: `src/api/cloudWire.ts` (puentes `window.__estadoLiga`, `window.__promesaTaller`, `window.__etiquetaDistintivo`)
- Modify: `nginx.conf` (regenerado por `csp:sync`)
- Test: `tests/tallerBloqueProveedor.test.ts` (crear)

**Interfaces:**
- Consumes: `estadoLiga`, `promesaTaller` (Tarea 2).
- Produces: en el monolito, `_provPintar(e)` (pinta todo el bloque para una visita) y el contenedor `#tf-proveedor`. La Tarea 6 cuelga la lista de partidas de `#tf-prov-partidas`.

- [ ] **Step 1: Escribir la prueba estructural que falla**

Crear `tests/tallerBloqueProveedor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");

describe("bloque Proveedor en el registro de la unidad", () => {
  it("existe bajo el apagador y después de la identificación", () => {
    const iIdent = html.indexOf(">Identificación de la unidad<");
    const iProv = html.indexOf('id="tf-proveedor"');
    const iMant = html.indexOf(">Mantenimiento<");
    expect(iIdent).toBeGreaterThan(-1);
    expect(iProv).toBeGreaterThan(iIdent);
    expect(iProv).toBeLessThan(iMant);
    const tag = html.slice(html.lastIndexOf("<div", iProv), iProv + 200);
    expect(tag).toContain("needs-hibrido");
  });

  it("los botones de liga viven en el bloque, ya no en el pie del modal", () => {
    const iProv = html.indexOf('id="tf-proveedor"');
    const iFin = html.indexOf('id="tf-prov-partidas"', iProv);
    const bloque = html.slice(iProv, iFin);
    expect(bloque).toContain('id="btn-liga-copiar"');
    expect(bloque).toContain('id="btn-liga-revocar"');
    const pie = html.slice(html.indexOf('class="tl-mftr"'));
    expect(pie).not.toContain('id="btn-liga-copiar"');
  });

  it("los botones de liga conservan needs-liga y needs-hibrido", () => {
    for (const id of ["btn-liga-copiar", "btn-liga-revocar"]) {
      const i = html.indexOf(`id="${id}"`);
      const tag = html.slice(html.lastIndexOf("<button", i), html.indexOf(">", i));
      expect(tag, id).toContain("needs-liga");
      expect(tag, id).toContain("needs-hibrido");
    }
  });

  it("_provPintar usa la capa pura y NUNCA recalcula fechas a mano", () => {
    const i = html.indexOf("function _provPintar(");
    expect(i).toBeGreaterThan(-1);
    const cuerpo = html.slice(i, html.indexOf("\nfunction ", i + 10));
    expect(cuerpo).toContain("window.__estadoLiga(");
    expect(cuerpo).toContain("window.__promesaTaller(");
    // Nada de aritmética de fechas inline en el monolito.
    expect(cuerpo).not.toMatch(/24\s*\*\s*60\s*\*\s*60/);
  });

  it("pinta con textContent, nunca con innerHTML", () => {
    const i = html.indexOf("function _provPintar(");
    const cuerpo = html.slice(i, html.indexOf("\nfunction ", i + 10));
    expect(cuerpo).not.toContain(".innerHTML");
  });

  it("openTallerModal llama a _provPintar solo con una visita persistida", () => {
    const i = html.indexOf("function openTallerModal(");
    const cuerpo = html.slice(i, html.indexOf("\nfunction closeTallerModal", i));
    expect(cuerpo).toContain("_provPintar(e)");
    expect(cuerpo).toMatch(/if\s*\(\s*e\s*\)\s*_provPintar\(e\)|e\s*\?\s*_provPintar\(e\)/);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/tallerBloqueProveedor.test.ts`
Expected: FAIL — no existe `#tf-proveedor`.

- [ ] **Step 3: Publicar los puentes de la capa pura**

En `src/api/cloudWire.ts`, junto al puente del visor (Tarea 4):

```ts
  // Capa pura del seguimiento del proveedor: el monolito PINTA, no calcula.
  window.__estadoLiga = (e) => estadoLiga(e, new Date().toISOString());
  window.__promesaTaller = (e) => promesaTaller(e, new Date().toISOString().slice(0, 10));
  window.__etiquetaDistintivo = etiquetaDistintivo;
```

Import correspondiente:

```ts
import { estadoLiga, promesaTaller, etiquetaDistintivo } from "../taller/seguimiento";
```

Y sus tipos en el `declare global` de `cloudHydrate.ts` (junto al del visor), usando los tipos exportados por `seguimiento.ts`.

- [ ] **Step 4: Insertar el markup del bloque**

En `Control de flotilla.html`, inmediatamente **después** del `<div id="tf-identidad-hint" ...>` y **antes** del `<div class="tl-sec">Mantenimiento</div>`:

```html
      <!-- Seguimiento del proveedor (Plan 2, bloque 1). Todo lo que muestra ya
           se guarda hoy: liga (columnas ligaCreadaEn/Por, ligaRevocada*) y lo
           que el taller reporta desde su liga (estadoOperativo, km, fsalidaEst
           y su compromiso). Riesgos VE y DECIDE; el taller REPORTA. -->
      <div class="tl-sec needs-hibrido">Proveedor</div>
      <div id="tf-proveedor" class="tl-field full needs-hibrido" style="display:none;flex-direction:column;gap:8px;padding:12px 14px;background:var(--bg2);border:var(--card-bd);border-radius:8px">
        <div id="tf-prov-liga" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"></div>
        <div id="tf-prov-liga-meta" style="font-size:10.5px;color:var(--s2)"></div>
        <div id="tf-prov-taller" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"></div>
        <div id="tf-prov-taller-nota" style="font-size:10px;color:var(--s2)">Estado, km y fecha prometida los reporta el proveedor desde su liga.</div>
        <div id="tf-prov-partidas"></div>
      </div>
```

Mover los dos `<button id="btn-liga-copiar">` y `<button id="btn-liga-revocar">` desde `.tl-mftr` hasta dentro de `#tf-prov-liga` (conservando clases `tl-exp-btn needs-liga needs-hibrido` y sus `onclick`).

- [ ] **Step 5: Escribir `_provPintar`**

En el script inline del monolito, junto a las demás funciones del taller (después de `_partidasConfiables`), agregar:

```js
// Pinta el bloque Proveedor de una visita YA persistida. Todo el cálculo vive
// en la capa pura (src/taller/seguimiento.ts): aquí solo se traduce a DOM.
// XSS: createElement + textContent, nunca innerHTML.
function _provPintar(e){
  const cont = document.getElementById("tf-proveedor");
  if(!cont) return;
  if(!e || typeof window.__estadoLiga !== "function"){ cont.style.display = "none"; return; }
  cont.style.display = "flex";

  const liga = window.__estadoLiga(e);
  const prom = window.__promesaTaller(e);

  // ── Fila 1: la liga
  const filaLiga = document.getElementById("tf-prov-liga");
  const meta = document.getElementById("tf-prov-liga-meta");
  for(const n of Array.from(filaLiga.childNodes)){
    if(n.id !== "btn-liga-copiar" && n.id !== "btn-liga-revocar") n.remove();
  }
  const pill = document.createElement("span");
  pill.className = "tl-pill " + (liga.kind === "activa" ? "repar" : liga.kind === "revocada" ? "pendiente" : "");
  pill.textContent = liga.kind === "activa" ? "Liga activa"
    : liga.kind === "revocada" ? "Liga revocada"
    : liga.kind === "vencida" ? "Liga vencida" : "Sin liga";
  const detalle = document.createElement("span");
  detalle.style.cssText = "font-size:12px;color:var(--w1);font-weight:600";
  detalle.textContent = liga.kind === "activa" ? `Vence en ${liga.diasRestantes} días` : "";
  filaLiga.prepend(detalle);
  filaLiga.prepend(pill);

  meta.textContent = liga.kind === "activa"
    ? `Emitida por ${liga.emitidaPor || "desconocido"} · ${fmtDate(liga.emitidaEn)} · vence el ${fmtDate(liga.venceEn)}`
    : liga.kind === "revocada"
      ? `Revocada por ${liga.revocadaPor || "desconocido"} · ${fmtDate(liga.revocadaEn)}`
      : liga.kind === "vencida"
        ? `Emitida por ${liga.emitidaPor || "desconocido"} · venció el ${fmtDate(liga.vencioEn)}`
        : "Sin liga emitida para esta visita.";

  // ── Fila 2: lo que reporta el taller
  const filaT = document.getElementById("tf-prov-taller");
  filaT.textContent = "";
  const ETIQ = { revisando:"REVISANDO", reparando:"REPARANDO", esperandoRefaccion:"ESPERANDO REFACCIÓN", lista:"LISTA" };
  const CLS  = { revisando:"diag", reparando:"repar", esperandoRefaccion:"porrec", lista:"listo" };
  if(e.estadoOperativo){
    const p = document.createElement("span");
    p.className = "tl-pill " + (CLS[e.estadoOperativo] || "");
    p.textContent = ETIQ[e.estadoOperativo] || e.estadoOperativo;
    filaT.appendChild(p);
  }
  if(typeof e.kmTaller === "number"){
    const km = document.createElement("span");
    km.style.cssText = "font-size:12px;color:var(--w1)";
    km.textContent = `km del taller ${e.kmTaller.toLocaleString("es-MX")}`;
    filaT.appendChild(km);
  }
  if(prom.kind !== "sin-promesa"){
    const f = document.createElement("span");
    f.style.cssText = "font-size:12px;color:var(--w1)";
    f.textContent = `· promete salida ${fmtDate(prom.fecha)}`;
    filaT.appendChild(f);
    if(prom.compromisoOriginal){
      const o = document.createElement("span");
      o.style.cssText = "font-size:10.5px;color:var(--s2)";
      o.textContent = `(había prometido ${fmtDate(prom.compromisoOriginal)})`;
      filaT.appendChild(o);
    }
    if(prom.kind === "vencida"){
      const v = document.createElement("span");
      v.className = "tl-pill pendiente";
      v.style.marginLeft = "auto";
      v.textContent = `PROMESA VENCIDA · ${prom.diasVencida} días`;
      filaT.appendChild(v);
    }
  }
  if(!filaT.childNodes.length){
    const nada = document.createElement("span");
    nada.style.cssText = "font-size:12px;color:var(--s2)";
    nada.textContent = "El taller aún no ha reportado estado.";
    filaT.appendChild(nada);
  }
}
```

En `openTallerModal`, donde hoy se resuelve `ligaOfrecible`, agregar al final del bloque:

```js
    if(e) _provPintar(e); else document.getElementById("tf-proveedor").style.display = "none";
```

- [ ] **Step 6: CSP, batería y commit**

```bash
npm run csp:sync
npm run audit:csp
npm run audit:xss
npm run typecheck && npm run lint
npx vitest run tests/tallerBloqueProveedor.test.ts
npm run test:run > "$SCRATCH/task5.txt" 2>&1; grep -nE "^ *FAIL" "$SCRATCH/task5.txt"
git add "Control de flotilla.html" nginx.conf src/api/cloudWire.ts src/api/cloudHydrate.ts tests/tallerBloqueProveedor.test.ts
git commit -m "feat(taller): bloque Proveedor en el registro — liga y estado del taller"
```

---

### Task 6: Partidas en el registro — historial y decisión inline

**Files:**
- Modify: `Control de flotilla.html` (`_provPartidas(e)` dentro de `#tf-prov-partidas`; reusar `_bnPartida`)
- Modify: `nginx.conf`
- Test: `tests/tallerPartidasEnRegistro.test.ts` (crear)

**Interfaces:**
- Consumes: `_provPintar` (Tarea 5), `resumenPartidas` (Tarea 3), `_bnPartida`, `_bnAutorizar`, `_bnRechazar`, `__guardarDecisionPartida`, `_partidasConfiables`, `_partidasDeVisita` (todos ya en el monolito).
- Produces: `_provPartidas(e)` y `_provFiltro` (estado del filtro: `"todas" | "pendientes" | "autorizadas" | "rechazadas"`).

- [ ] **Step 1: Escribir la prueba estructural que falla**

Crear `tests/tallerPartidasEnRegistro.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");
const cuerpo = (nombre: string): string => {
  const i = html.indexOf(`function ${nombre}(`);
  expect(i, `no existe ${nombre}`).toBeGreaterThan(-1);
  return html.slice(i, html.indexOf("\nfunction ", i + 10));
};

describe("partidas dentro del registro de la unidad", () => {
  it("_provPartidas reusa la fila de la bandeja, no reimplementa la decisión", () => {
    const c = cuerpo("_provPartidas");
    expect(c).toContain("_bnPartida(");
    expect(c).not.toContain("__guardarDecisionPartida(");
  });

  it("los cuatro filtros existen con sus conteos de la capa pura", () => {
    const c = cuerpo("_provPartidas");
    expect(c).toContain("window.__resumenPartidas(");
    for (const f of ["Todas", "Pendientes", "Autorizadas", "Rechazadas"]) {
      expect(c, `falta el filtro ${f}`).toContain(f);
    }
  });

  it("con el tri-estado en duda NO se pinta la lista ni se permite decidir", () => {
    const c = cuerpo("_provPartidas");
    expect(c).toContain("_partidasConfiables()");
    expect(c).toContain("No se pudieron cargar las partidas");
  });

  it("el historial declara quién decidió, cuándo y el motivo", () => {
    const c = cuerpo("_provPartidas");
    expect(c).toContain("decididoPor");
    expect(c).toContain("decididoEn");
    expect(c).toContain("motivoRechazo");
  });

  it("los borradores del taller se muestran sin botones de decisión", () => {
    const c = cuerpo("_provPartidas");
    expect(c).toContain("Borrador del taller");
  });

  it("tras decidir se repinta el bloque, la tabla y el contador — sin recargar", () => {
    const c = cuerpo("_bnRepintar");
    expect(c).toContain("_provPartidas");
    expect(c).toContain("renderTaller");
    expect(c).toContain("updateTallerBadge");
  });

  it("pinta con textContent, nunca innerHTML", () => {
    expect(cuerpo("_provPartidas")).not.toContain(".innerHTML");
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/tallerPartidasEnRegistro.test.ts`
Expected: FAIL — no existe `_provPartidas`.

- [ ] **Step 3: Publicar `resumenPartidas` al monolito**

En `src/api/cloudWire.ts` (junto a los puentes de la Tarea 5):

```ts
  window.__resumenPartidas = resumenPartidas;
```

Import: agregar `resumenPartidas` a la línea de import de `../taller/seguimiento`. Tipo en `declare global` de `cloudHydrate.ts`.

- [ ] **Step 4: Implementar `_provPartidas` en el monolito**

```js
// Filtro activo de la lista de partidas del registro. "pendientes" por defecto
// cuando hay algo esperando firma; si no, "todas".
let _provFiltro = "pendientes";

// Lista completa de partidas de la visita, con su historial y la decisión
// INLINE. Reusa _bnPartida (la MISMA fila de la bandeja, con sus botones y su
// menú de motivos): aquí solo cambia dónde se pinta.
function _provPartidas(e){
  const cont = document.getElementById("tf-prov-partidas");
  if(!cont) return;
  cont.textContent = "";
  if(!e) return;

  if(!_partidasConfiables()){
    const aviso = document.createElement("div");
    aviso.style.cssText = "padding:12px;color:var(--s2);font-size:12px";
    aviso.textContent = "No se pudieron cargar las partidas. Reintenta en unos segundos.";
    cont.appendChild(aviso);
    return;
  }

  const ps = _partidasDeVisita(e) || [];
  const r = window.__resumenPartidas(ps);
  if(r.pendientes.n === 0 && _provFiltro === "pendientes") _provFiltro = "todas";

  // ── Filtros
  const barra = document.createElement("div");
  barra.style.cssText = "display:flex;align-items:center;gap:6px;padding-top:8px;border-top:1px solid var(--ln);flex-wrap:wrap";
  const titulo = document.createElement("span");
  titulo.style.cssText = "font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--s1);margin-right:4px";
  titulo.textContent = "Partidas";
  barra.appendChild(titulo);
  const defs = [
    ["todas", "Todas", ps.length],
    ["pendientes", "Pendientes", r.pendientes.n],
    ["autorizadas", "Autorizadas", r.autorizadas.n],
    ["rechazadas", "Rechazadas", r.rechazadas.n],
  ];
  for(const [clave, etiqueta, n] of defs){
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tl-exp-btn";
    if(_provFiltro === clave){ b.style.background = "var(--ac)"; b.style.color = "#fff"; }
    b.textContent = `${etiqueta} · ${n}`;
    b.addEventListener("click", () => { _provFiltro = clave; _provPartidas(e); });
    barra.appendChild(b);
  }
  const totales = document.createElement("span");
  totales.style.cssText = "margin-left:auto;font-size:10.5px;color:var(--s2)";
  totales.textContent = `Autorizado ${_fmtMon2(r.autorizadas.monto)} · Esperando ${_fmtMon2(r.pendientes.monto)}`;
  barra.appendChild(totales);
  cont.appendChild(barra);

  // ── Lista
  const lista = document.createElement("div");
  lista.style.cssText = "display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--ln);border-radius:8px;overflow:hidden;margin-top:8px";
  const visibles = ps.filter((p) =>
    _provFiltro === "todas" ? true
    : _provFiltro === "pendientes" ? p.estado === "propuesta"
    : _provFiltro === "autorizadas" ? p.estado === "autorizada"
    : p.estado === "rechazada");

  if(!visibles.length){
    const vacio = document.createElement("div");
    vacio.style.cssText = "padding:16px;color:var(--s2);font-size:12px;text-align:center";
    vacio.textContent = "No hay partidas en este filtro.";
    lista.appendChild(vacio);
  }
  const fila = { visitaKey: window.__visitaKeyDe(e), entry: e };
  for(const p of visibles){
    if(p.estado === "propuesta"){
      // La MISMA fila de la bandeja: botones, motivos y repintado incluidos.
      lista.appendChild(_bnPartida(fila, p, window.__MOTIVOS_RECHAZO));
      continue;
    }
    lista.appendChild(_provFilaHistorial(p));
  }
  cont.appendChild(lista);
}

// Una partida ya decidida (o un borrador del taller): sin botones, con su
// rastro completo — quién, cuándo y por qué.
function _provFilaHistorial(p){
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:10px;padding:10px 12px;border-bottom:1px solid var(--ln);align-items:center";
  row.appendChild(_bnThumb(p));

  const info = document.createElement("div");
  info.style.cssText = "flex:1;min-width:0;display:flex;flex-direction:column;gap:2px";
  const linea1 = document.createElement("div");
  linea1.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap";
  const desc = document.createElement("span");
  desc.style.cssText = "font-size:12.5px;color:var(--w1);font-weight:600";
  if(p.estado === "rechazada"){ desc.style.textDecoration = "line-through"; desc.style.color = "var(--s1)"; }
  desc.textContent = p.descripcion || "(sin descripción)";
  const badge = document.createElement("span");
  badge.className = "tl-pill " + (p.estado === "autorizada" ? "listo" : p.estado === "rechazada" ? "pendiente" : "");
  const esDelTaller = String(p.creadoPor || "").indexOf("liga:") === 0;
  badge.textContent = p.estado === "autorizada" ? "AUTORIZADA"
    : p.estado === "rechazada" ? "RECHAZADA"
    : p.estado === "cancelada" ? "CANCELADA"
    : esDelTaller ? "Borrador del taller" : "Borrador";
  linea1.append(desc, badge);

  const precio = document.createElement("div");
  precio.style.cssText = "font-size:12px;font-weight:700;color:" + (p.estado === "autorizada" ? "var(--w1)" : "var(--s1)");
  const monto = p.estado === "autorizada" ? p.precioAutorizado : p.precio;
  precio.textContent = `${_fmtMon2(typeof monto === "number" && isFinite(monto) ? monto : 0)} · ${p.tipo === "manoObra" ? "mano de obra" : "refacción"}`;

  const rastro = document.createElement("div");
  rastro.style.cssText = "font-size:10.5px;color:var(--s2)";
  if(p.estado === "autorizada"){
    rastro.textContent = `Autorizada por ${p.decididoPor || "desconocido"} · ${fmtDate(p.decididoEn)}`;
  }else if(p.estado === "rechazada"){
    const nota = p.motivoRechazoNota ? ` — ${p.motivoRechazoNota}` : "";
    rastro.textContent = `Rechazada por ${p.decididoPor || "desconocido"} · ${fmtDate(p.decididoEn)} · ${p.motivoRechazo || "sin motivo"}${nota}`;
  }else{
    rastro.textContent = esDelTaller ? "Capturada por el taller, aún sin enviar" : "Capturada por GPA, aún sin enviar";
  }
  info.append(linea1, precio, rastro);
  row.appendChild(info);
  return row;
}
```

En `_bnRepintar`, agregar el repintado del bloque cuando el modal está abierto:

```js
  if(_tallerEditId && document.getElementById("taller-modal").classList.contains("open")){
    const e = tallerEntries.find(x => x.id === _tallerEditId);
    if(e){ _provPintar(e); _provPartidas(e); }
  }
```

Y en `_provPintar`, al final, llamar `_provPartidas(e)`.

- [ ] **Step 5: Correr, CSP y batería**

```bash
npx vitest run tests/tallerPartidasEnRegistro.test.ts
npm run csp:sync && npm run audit:csp && npm run audit:xss
npm run typecheck && npm run lint
npm run test:run > "$SCRATCH/task6.txt" 2>&1; grep -nE "^ *FAIL" "$SCRATCH/task6.txt"
```

- [ ] **Step 6: 🔴 Verificación MANUAL con una cuenta del rol operativo**

No es opcional ni sustituible por pruebas: dos defectos en producción (el `fieldName` del resolver y la firma bloqueada de `operativo`) nacieron de contratos que las pruebas no ejecutan.

1. Entrar a la app con la cuenta de Administración de Riesgos (grupo `operativo`, **no** admin).
2. Abrir una visita con una partida pendiente → autorizarla desde el registro.
3. Confirmar, **sin recargar**: la fila pasa a "AUTORIZADA" con su rastro, los conteos de los filtros cambian, el subtotal del formulario se actualiza y el contador de la pestaña baja.
4. Rechazar otra partida con un motivo del catálogo y confirmar lo mismo.
5. Si algo falla, capturar la línea `[bandeja] autorizar:` de la consola antes de tocar nada.

- [ ] **Step 7: Commit**

```bash
git add "Control de flotilla.html" nginx.conf src/api/cloudWire.ts src/api/cloudHydrate.ts tests/tallerPartidasEnRegistro.test.ts
git commit -m "feat(taller): historial y firma de partidas dentro del registro de la unidad"
```

---

### Task 7: Distintivo "Proveedor" en la tabla de Taller

**Files:**
- Modify: `Control de flotilla.html` (columnas de la tabla de visitas y su pintado)
- Modify: `nginx.conf`
- Test: `tests/tallerDistintivoTabla.test.ts` (crear)

**Interfaces:**
- Consumes: `distintivoProveedor`, `etiquetaDistintivo`, `resumenPartidas`, `estadoLiga`, `promesaTaller` (Tareas 2 y 3).
- Produces: `window.__distintivoProveedor(e, ps)` en `cloudWire.ts` y la columna en la tabla.

- [ ] **Step 1: Escribir la prueba que falla**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");

describe("distintivo del proveedor en la tabla de Taller", () => {
  it("la columna existe en el arreglo de columnas y está bajo el apagador", () => {
    expect(html).toContain('{lbl:"Proveedor", key:"proveedor"');
    const i = html.indexOf('{lbl:"Proveedor", key:"proveedor"');
    expect(html.slice(i, i + 200)).toContain("needs-hibrido");
  });

  it("la celda usa la capa pura, no una regla propia", () => {
    const i = html.indexOf("function _provCelda(");
    expect(i).toBeGreaterThan(-1);
    const c = html.slice(i, html.indexOf("\nfunction ", i + 10));
    expect(c).toContain("window.__distintivoProveedor(");
    expect(c).toContain("window.__etiquetaDistintivo(");
    expect(c).not.toContain(".innerHTML");
  });

  it("con las partidas en duda la celda queda vacía — no miente con un cero", () => {
    const i = html.indexOf("function _provCelda(");
    const c = html.slice(i, html.indexOf("\nfunction ", i + 10));
    expect(c).toContain("_partidasConfiables()");
  });
});
```

- [ ] **Step 2: Correr y ver fallar.** Run: `npx vitest run tests/tallerDistintivoTabla.test.ts` → FAIL.

- [ ] **Step 3: Puente**

En `cloudWire.ts`:

```ts
  window.__distintivoProveedor = (e, ps) => {
    const ahora = new Date().toISOString();
    return distintivoProveedor(
      estadoLiga(e, ahora),
      promesaTaller(e, ahora.slice(0, 10)),
      resumenPartidas(ps),
    );
  };
```

- [ ] **Step 4: Columna y celda en el monolito**

Agregar al arreglo de columnas de la tabla de Taller (donde están `{lbl:"Días", key:"dias"}` y `{lbl:"F. Salida Est.", ...}`), después de "Días":

```js
      {lbl:"Proveedor", key:"proveedor", cls:"needs-hibrido"},
```

Y la celda:

```js
// Una sola señal por visita, la más urgente (capa pura). Con las partidas en
// duda la celda se deja VACÍA: un "sin liga" ahí sería una mentira con formato
// de dato.
function _provCelda(e){
  const td = document.createElement("td");
  td.className = "needs-hibrido";
  if(!_partidasConfiables() || typeof window.__distintivoProveedor !== "function") return td;
  const d = window.__distintivoProveedor(e, _partidasDeVisita(e) || []);
  const CLS = { "promesa-vencida":"pendiente", "esperando-firma":"diag", "liga-activa":"repar", "liga-revocada":"", "sin-liga":"" };
  const span = document.createElement("span");
  span.className = "tl-pill " + (CLS[d.kind] || "");
  span.textContent = window.__etiquetaDistintivo(d);
  td.appendChild(span);
  return td;
}
```

- [ ] **Step 5: CSP, batería y commit**

```bash
npm run csp:sync && npm run audit:csp && npm run audit:xss
npm run typecheck && npm run lint
npm run test:run > "$SCRATCH/task7.txt" 2>&1; grep -nE "^ *FAIL" "$SCRATCH/task7.txt"
git add "Control de flotilla.html" nginx.conf src/api/cloudWire.ts src/api/cloudHydrate.ts tests/tallerDistintivoTabla.test.ts
git commit -m "feat(taller): distintivo del proveedor por renglon en la tabla"
```

---

### Task 8: La pestaña pasa a "Pendientes de firma" (bandeja de entrada)

**Files:**
- Modify: `Control de flotilla.html` (etiqueta de la pestaña y `renderBandeja`)
- Modify: `nginx.conf`
- Test: `tests/tallerBandejaEntrada.test.ts` (crear)

**Interfaces:**
- Consumes: `filasPendientes` (Tarea 3), `openTallerModal` (monolito).
- Produces: `window.__filasPendientes` en `cloudWire.ts`.

- [ ] **Step 1: Prueba que falla**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");
const cuerpo = (n: string) => {
  const i = html.indexOf(`function ${n}(`);
  expect(i, n).toBeGreaterThan(-1);
  return html.slice(i, html.indexOf("\nfunction ", i + 10));
};

describe("pestaña Pendientes de firma", () => {
  it("la pestaña se llama Pendientes de firma", () => {
    const i = html.indexOf('id="tltab-bandeja"');
    expect(html.slice(i, i + 300)).toContain("Pendientes de firma");
  });

  it("renderBandeja lista por UNIDAD y ya no pinta botones de decisión", () => {
    const c = cuerpo("renderBandeja");
    expect(c).toContain("window.__filasPendientes(");
    expect(c).toContain("Abrir registro");
    expect(c).not.toContain("_bnPartida(");
  });

  it("el botón abre el registro con el filtro en pendientes", () => {
    const c = cuerpo("renderBandeja");
    expect(c).toContain("openTallerModal(");
    expect(c).toContain('_provFiltro = "pendientes"');
  });

  it("vacío honesto", () => {
    expect(cuerpo("renderBandeja")).toContain("No hay partidas esperando tu firma");
  });
});
```

- [ ] **Step 2: Correr y ver fallar.**

- [ ] **Step 3: Puente + renombre + `renderBandeja`**

Puente en `cloudWire.ts`:

```ts
  window.__filasPendientes = (entries, porVisita) =>
    filasPendientes(entries, porVisita, new Date().toISOString());
```

En el markup, cambiar el texto de la pestaña `#tltab-bandeja` de "Bandeja de firmas" a "Pendientes de firma".

Reescribir `renderBandeja` para que, tras la franja de resumen que ya existe, pinte una fila por unidad con: eco · placa, marca · sucursal · ingreso, el distintivo, "N partidas · $monto", "la más antigua espera desde …", y un botón **Abrir registro** de 44 px que hace `_provFiltro = "pendientes"; openTallerModal(fila.entry.id);`. Todo con `createElement`/`textContent`.

- [ ] **Step 4: CSP, batería y commit**

```bash
npm run csp:sync && npm run audit:csp && npm run audit:xss
npm run typecheck && npm run lint
npm run test:run > "$SCRATCH/task8.txt" 2>&1; grep -nE "^ *FAIL" "$SCRATCH/task8.txt"
git add "Control de flotilla.html" nginx.conf src/api/cloudWire.ts src/api/cloudHydrate.ts tests/tallerBandejaEntrada.test.ts
git commit -m "feat(taller): la pestana pasa a bandeja de entrada de pendientes"
```

---

### Task 9: Las partidas salen en el Excel

**Files:**
- Modify: `src/taller/exportExcel.ts`
- Test: `tests/tallerExcelPartidas.test.ts` (crear)

**Interfaces:**
- Consumes: `resumenPartidas` (Tarea 3), `window.__tallerPartidas` (mapa por visita).
- Produces: hoja "Partidas" en el libro de Taller.

- [ ] **Step 1: Prueba que falla**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "..", "src", "taller", "exportExcel.ts"), "utf8");

describe("Excel de Taller — hoja Partidas", () => {
  it("existe la hoja con sus encabezados exactos", () => {
    expect(src).toContain('addWorksheet("Partidas")');
    for (const h of [
      "Unidad", "Placa", "Ingreso", "Descripción", "Tipo", "Precio propuesto",
      "Estado", "Precio autorizado", "Decidido por", "Decidido el",
      "Motivo de rechazo", "Nota", "Origen", "Fotos",
    ]) {
      expect(src, `falta el encabezado ${h}`).toContain(`"${h}"`);
    }
  });

  it("las canceladas se exportan etiquetadas, no se ocultan", () => {
    expect(src).toContain("cancelada");
  });
});
```

- [ ] **Step 2: Correr y ver fallar.**

- [ ] **Step 3: Implementar la hoja** en `exportExcel.ts`, siguiendo el patrón ExcelJS que ya usa el archivo (encabezados en negritas, congelar la primera fila, fechas con `utcWallClock`). Una fila por partida de las visitas exportadas; `Origen` = "Taller" si `creadoPor` empieza con `liga:`, si no "GPA"; `Fotos` = `p.fotos.length`.

- [ ] **Step 4: Batería y commit**

```bash
npm run typecheck && npm run lint
npm run test:run > "$SCRATCH/task9.txt" 2>&1; grep -nE "^ *FAIL" "$SCRATCH/task9.txt"
git add src/taller/exportExcel.ts tests/tallerExcelPartidas.test.ts
git commit -m "feat(taller): las partidas con su estado y motivo salen en el Excel"
```

---

## Cierre del bloque

- [ ] **Batería completa final:** `npm run test:run` (capturado a archivo), `npm run typecheck`, `npm run lint`, `npm run audit:xss`, `npm run audit:csp`, `npm run build`, y e2e local (`node scripts/gen-fixture-mensual.mjs && npx playwright test -c playwright.local.config.ts`) comparando contra la referencia de 60/67 con los 7 ambientales conocidos.
- [ ] **Revisión de rama** con `superpowers:requesting-code-review` (modelo capaz: toca dinero, permisos y el monolito).
- [ ] **Verificación manual** de la Tarea 6 con la cuenta de Riesgos, más el repintado sin recargar y el visor de fotos en un celular.
- [ ] **Cierre** con `superpowers:finishing-a-development-branch`. **Sin desplegar:** el push y el merge los hace Navares, y el merge despliega.

## Lo que NO entra en este plan

El bloque 2 (cámara en la liga, reglas de mano de obra, factura CFDI) tiene su propia spec — `docs/superpowers/specs/2026-09-15-taller-evidencia-proveedor-design.md` — y su propio plan, que se escribe cuando este bloque esté fusionado. Toca el portal público y el esquema, así que lleva revisión de seguridad obligatoria.
