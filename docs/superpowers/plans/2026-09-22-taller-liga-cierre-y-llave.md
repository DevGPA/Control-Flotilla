# Taller — la liga muere con la visita y ninguna visita hereda a otra · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una visita de Taller nunca sobrescriba ni herede otra (llave repetida bloqueada), que su liga muera al cerrarla o anularla, que el portal rechace visitas anuladas, que la fecha de salida se borre de verdad y que el bloque Proveedor diga la verdad en visitas cerradas.

**Architecture:** Dos reglas puras nuevas (`llaveEnUso` en `src/taller/llaveVisita.ts`; `revocacionPorCierre` + estado `cerrada` en `src/taller/seguimiento.ts`) que el monolito solo consume vía puentes `window.__*`. El chokepoint de subida (`uploadTallerToCloud`) incluye la revocación en el MISMO upsert al cerrar. El portón único del portal (`cargarVisitaVigente`) consulta `Anulacion` por su llave. Sin cambios de esquema.

**Tech Stack:** Vite + TypeScript vanilla · monolito `Control de flotilla.html` (scripts inline, CSP por hash) · AWS Amplify Gen 2 (AppSync/DynamoDB; Lambda `taller-portal`) · vitest.

**Spec:** `docs/superpowers/specs/2026-09-22-taller-liga-cierre-y-llave-design.md`

## Global Constraints

- **Rama y worktree:** `feat/taller-liga-cierre` en `C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla-wt-taller-seguimiento` (base `main` = `7e5a593`). Verificar `git branch --show-current` antes de cada commit.
- **Repo PÚBLICO:** ni un correo real, RFC, identificador de AWS, nombre de tabla ni hostname en código, pruebas o mensajes de commit. Datos de prueba inventados (`@ejemplo.test`, placas `PRB-…`).
- **Stagear por ruta** (`git add <archivo>`), nunca `git add -A`. Nunca `git push`. Nunca `ampx sandbox` / `npm run amplify:sandbox` (cuenta de PROD). Nunca `npm install` (el worktree ya tiene `node_modules`).
- **CSP:** toda edición de un `<script>` inline de `Control de flotilla.html` exige `npm run csp:sync` ANTES del commit e incluir `nginx.conf` y el `<meta>` del HTML en ESE MISMO commit; verificar con `npm run audit:csp` antes Y después del commit (el hook reformatea).
- **XSS:** nada de `innerHTML` con datos. `createElement` + `textContent`. Guardia: `npm run audit:xss` (único hallazgo tolerado: el `${alertMin}` preexistente de `main`).
- **Dinero:** ninguna aritmética nueva; la única fórmula del gasto es `gastoDerivado`/`gastoTotalDe`.
- **Una sola regla de "liga vigente":** `estadoLiga()` (`src/taller/seguimiento.ts`). Nada recalcula fechas ni versiones por su cuenta.
- **Anulación, nunca borrado.** Nada borra filas.
- **Orden de estados de `estadoLiga`:** `sin-liga` → `revocada` → `vencida` → `cerrada` → `activa`.
- **Verificación por tarea:** las pruebas del PROPIO archivo con `npx vitest run <archivos>`; la suite completa (`npm run test:run > <archivo> 2>&1` + `grep -nE "^ *FAIL|Test Files|Tests " <archivo>`, NUNCA `| tail`) la corre el controller al cierre de cada ola. Único fallo intermitente tolerado: `tests/fuelOpsGuardHandlers.test.ts › handleKmDetectado`. Baseline al arrancar: **175 archivos / 2290 casos** (más las ~30 pruebas del PR #21; medir antes de la ola 1).
- **Ejecución en paralelo (autorizada por Navares):** las Tareas 1–4 tocan archivos DISJUNTOS y corren a la vez en el MISMO worktree: **sus implementadores NO commitean ni corren typecheck/lint/suite completa** (otro agente puede tener un archivo a medias); el controller commitea cada tarea por ruta al cerrar la ola. Las Tareas 5 y 6 corren en fila y sí commitean.

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `src/taller/llaveVisita.ts` (**crear**) | Regla pura: ¿la llave (unitUid+fechaEntrada) de una visita candidata ya está en uso por una vigente o una anulada? | 1 |
| `tests/tallerLlaveVisita.test.ts` (**crear**) | Pruebas puras de `llaveEnUso`. | 1 |
| `src/taller/seguimiento.ts` (modificar) | `EstadoLiga` gana `cerrada`; `estadoLiga` la calcula; `revocacionPorCierre` decide los tres campos de revocación al cerrar. | 2 |
| `tests/tallerSeguimientoEstado.test.ts` (modificar) | Pruebas de `cerrada` y `revocacionPorCierre`; `distintivoProveedor` con `cerrada`. | 2 |
| `src/api/batchUpload.ts` (modificar) | `fechaSalida: null` explícito (T3); parámetro `quien` + campos de revocación en el upsert al cerrar (T5). | 3, 5 |
| `src/api/client.ts` (modificar) | `TallerInput.fechaSalida: string \| null` (T3); campos `ligaVersion/ligaRevocadaEn/ligaRevocadaPor` (T5). | 3, 5 |
| `src/api/cloudHydrate.ts` (modificar) | `fsalidaReal` sin fallback a la columna. | 3 |
| `tests/tallerFechaSalida.test.ts` (**crear**) | Contrato de subida (`null`) + estructural de la hidratación. | 3 |
| `amplify/functions/taller-portal/handler.ts` (modificar) | `cargarVisitaVigente` rechaza visitas con tombstone activo. | 4 |
| `tests/tallerPortalHandler.test.ts` (modificar) | Estructurales del portón (anulación). | 4 |
| `src/api/cloudWire.ts` (modificar) | Puente `window.__llaveEnUso`; pasa el correo de sesión a `uploadTallerToCloud`. | 5 |
| `tests/tallerCierreRevocaLiga.test.ts` (**crear**) | Contrato de subida: los tres campos viajan SOLO al cerrar con liga vigente. | 5 |
| `Control de flotilla.html` + `nginx.conf` (modificar) | Guarda del alta en `saveTallerEntry`; revocar antes de anular; `_provPintar` pinta `cerrada`. | 6 |
| `tests/tallerLigaCierreUi.test.ts` (**crear**) | Estructurales del monolito. | 6 |

**Olas:** Ola 1 = Tareas 1, 2, 3, 4 **en paralelo** (archivos disjuntos). Ola 2 = Tarea 5 (cablea 1+2 en `src/`). Ola 3 = Tarea 6 (monolito, un solo CSP). Cierre = revisión final + revisión de seguridad **en paralelo**, una ola de arreglo, batería completa.

---

### Task 1: Regla pura — ¿la llave de la visita ya está en uso?

**Files:**
- Create: `src/taller/llaveVisita.ts`
- Test: `tests/tallerLlaveVisita.test.ts`

**Interfaces:**
- Consumes: `refIdTaller(unitUid, fechaEntrada)` de `src/anulacion/anulacion.ts` (ya existe: `` `taller|${unitUid}|${fechaEntrada}` ``).
- Produces: `llaveEnUso(candidata, vigentes, anuladas): LlaveEnUso` y el tipo `LlaveEnUso`. La Tarea 5 la expone como `window.__llaveEnUso`; la Tarea 6 la consume.

- [ ] **Step 1: Escribir la prueba que falla**

```ts
// tests/tallerLlaveVisita.test.ts
import { describe, it, expect } from "vitest";
import { llaveEnUso } from "../src/taller/llaveVisita";
import { refIdTaller } from "../src/anulacion/anulacion";

const vigentes = [
  { id: "tl_1", unitUid: "PRB001A", fechaEntrada: "2026-09-14" },
  { id: "tl_2", unitUid: "PRB002B", fechaEntrada: "2026-09-18" },
];
const anuladas = new Map([[refIdTaller("PRB003C", "2026-09-10"), { ts: "2026-09-12T10:00:00.000Z" }]]);

describe("llaveEnUso — ninguna visita pisa a otra", () => {
  it("una llave nueva está libre", () => {
    expect(llaveEnUso({ id: "tl_9", unitUid: "PRB001A", fechaEntrada: "2026-09-22" }, vigentes, anuladas))
      .toEqual({ kind: "libre" });
  });

  it("misma unidad y misma fecha que una visita VIGENTE ⇒ en uso, con su id", () => {
    expect(llaveEnUso({ id: "tl_9", unitUid: "PRB001A", fechaEntrada: "2026-09-14" }, vigentes, anuladas))
      .toEqual({ kind: "vigente", id: "tl_1", fentrada: "2026-09-14" });
  });

  it("la PROPIA visita (mismo id) no choca consigo misma al editarse", () => {
    expect(llaveEnUso({ id: "tl_1", unitUid: "PRB001A", fechaEntrada: "2026-09-14" }, vigentes, anuladas))
      .toEqual({ kind: "libre" });
  });

  it("misma llave que una visita ANULADA ⇒ en uso (anulada), con la fecha de anulación", () => {
    expect(llaveEnUso({ id: "tl_9", unitUid: "PRB003C", fechaEntrada: "2026-09-10" }, vigentes, anuladas))
      .toEqual({ kind: "anulada", fentrada: "2026-09-10", anuladaEn: "2026-09-12T10:00:00.000Z" });
  });

  it("el refId de la anulada se compone con refIdTaller, no con una cadena a mano", () => {
    const soloRefId = new Map([["taller|PRB004D|2026-09-01", {}]]);
    expect(llaveEnUso({ unitUid: "PRB004D", fechaEntrada: "2026-09-01" }, [], soloRefId).kind).toBe("anulada");
  });

  it("sin id en la candidata (alta nueva) una vigente con la misma llave sí choca", () => {
    expect(llaveEnUso({ unitUid: "PRB002B", fechaEntrada: "2026-09-18" }, vigentes, anuladas).kind).toBe("vigente");
  });

  it("la vigente gana sobre la anulada si ambas existen (la vigente es la que se pisaría)", () => {
    const ambas = new Map([[refIdTaller("PRB001A", "2026-09-14"), {}]]);
    expect(llaveEnUso({ unitUid: "PRB001A", fechaEntrada: "2026-09-14" }, vigentes, ambas).kind).toBe("vigente");
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/tallerLlaveVisita.test.ts`
Expected: FAIL — `Failed to resolve import "../src/taller/llaveVisita"`.

- [ ] **Step 3: Implementar**

```ts
// src/taller/llaveVisita.ts
/**
 * Regla PURA (sin DOM, sin red): ¿la identidad de una visita de Taller —
 * unidad + fecha de atención, la llave real del registro (`tallerCloudKey`)—
 * ya la usa otra visita?
 *
 * Por qué existe: la llave del modelo `Taller` es `unitUid|fechaEntrada`. Un
 * alta con la misma llave que una visita existente hace UPSERT sobre el mismo
 * registro: los `datos` anteriores desaparecen sin aviso, y la nueva hereda la
 * anulación (tombstone por la misma llave), la liga y las partidas de la vieja.
 * Incidente real 2026-09-22 (unidades de prueba 06/70). El arreglo de fondo es
 * una identidad sin fecha (frente #11); esta guarda cierra la puerta hoy.
 *
 * Ver spec docs/superpowers/specs/2026-09-22-taller-liga-cierre-y-llave-design.md §4.1
 */
import { refIdTaller } from "../anulacion/anulacion";

export type LlaveVisita = { id?: string; unitUid: string; fechaEntrada: string };

export type LlaveEnUso =
  | { kind: "libre" }
  /** Otra visita VISIBLE ya tiene esa llave. */
  | { kind: "vigente"; id: string; fentrada: string }
  /** Una visita ANULADA tiene esa llave: el alta heredaría su tombstone. */
  | { kind: "anulada"; fentrada: string; anuladaEn?: string };

export function llaveEnUso(
  candidata: LlaveVisita,
  vigentes: readonly LlaveVisita[],
  /** window.__anuladasActivas: refId → info (solo anulaciones ACTIVAS). */
  anuladas: ReadonlyMap<string, { ts?: string }>,
): LlaveEnUso {
  const vigente = vigentes.find(
    (v) =>
      v.unitUid === candidata.unitUid &&
      v.fechaEntrada === candidata.fechaEntrada &&
      // Editar la propia visita sin mover su llave no es una colisión.
      !(candidata.id && v.id === candidata.id),
  );
  if (vigente) return { kind: "vigente", id: String(vigente.id ?? ""), fentrada: vigente.fechaEntrada };

  const info = anuladas.get(refIdTaller(candidata.unitUid, candidata.fechaEntrada));
  if (info) return { kind: "anulada", fentrada: candidata.fechaEntrada, anuladaEn: info.ts };

  return { kind: "libre" };
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run tests/tallerLlaveVisita.test.ts`
Expected: PASS 7/7.

- [ ] **Step 5: NO commitear (ola paralela).** Reportar los archivos tocados; el controller commitea por ruta al cerrar la ola con:
`git add src/taller/llaveVisita.ts tests/tallerLlaveVisita.test.ts && git commit -m "feat(taller): regla pura — la llave de una visita no puede pisar a otra"`

---

### Task 2: Estado `cerrada` de la liga y la regla "el cierre revoca"

**Files:**
- Modify: `src/taller/seguimiento.ts` (`EstadoLiga` ~L21, `estadoLiga` ~L33, `visitaCerrada` ~L66, `distintivoProveedor` ~L139)
- Test: `tests/tallerSeguimientoEstado.test.ts` (agregar al final)

**Interfaces:**
- Consumes: `TallerEntry` (`ligaVersion?`, `ligaCreadaEn?`, `ligaCreadaPor?`, `ligaRevocadaEn?`, `ligaRevocadaPor?`, `fsalidaReal?`, `estado`).
- Produces: `EstadoLiga` con `{ kind: "cerrada"; emitidaEn: string; emitidaPor: string }`; `revocacionPorCierre(e, ahoraISO, quien): { ligaVersion; ligaRevocadaEn; ligaRevocadaPor } | null`. La Tarea 5 la llama desde `uploadTallerToCloud`; la Tarea 6 pinta `cerrada`.

- [ ] **Step 1: Escribir las pruebas que fallan** (al final de `tests/tallerSeguimientoEstado.test.ts`; agregar `revocacionPorCierre, distintivoProveedor` al import y `import type { ResumenPartidas } from "../src/taller/seguimiento";` si no está)

```ts
describe("estadoLiga — 'cerrada': liga vigente en una visita cerrada", () => {
  const AHORA = "2026-09-15T12:00:00.000Z";
  it("con fsalidaReal, una liga vigente pasa a 'cerrada' (no 'activa')", () => {
    const r = estadoLiga({ ligaCreadaEn: EMITIDA, ligaCreadaPor: POR, fsalidaReal: "2026-09-14" }, AHORA);
    expect(r).toEqual({ kind: "cerrada", emitidaEn: EMITIDA, emitidaPor: POR });
  });
  it("con estado Finalizado también", () => {
    expect(estadoLiga({ ligaCreadaEn: EMITIDA, ligaCreadaPor: POR, estado: "Finalizado" }, AHORA).kind).toBe("cerrada");
  });
  it("revocada gana sobre cerrada", () => {
    const r = estadoLiga(
      { ligaCreadaEn: EMITIDA, ligaRevocadaEn: "2026-09-10T00:00:00.000Z", ligaRevocadaPor: POR, fsalidaReal: "2026-09-14" },
      AHORA,
    );
    expect(r.kind).toBe("revocada");
  });
  it("vencida gana sobre cerrada (una liga vencida ya no hay que revocarla)", () => {
    expect(estadoLiga({ ligaCreadaEn: EMITIDA, ligaCreadaPor: POR, fsalidaReal: "2026-12-01" }, "2026-12-15T00:00:00.000Z").kind).toBe("vencida");
  });
  it("abierta sigue siendo 'activa'", () => {
    expect(estadoLiga({ ligaCreadaEn: EMITIDA, ligaCreadaPor: POR, estado: "En Reparación" }, AHORA).kind).toBe("activa");
  });
  it("el distintivo trata 'cerrada' como 'sin-liga'", () => {
    const resumen: ResumenPartidas = { pendientes: { n: 0, monto: 0 }, autorizadas: { n: 0, monto: 0 }, rechazadas: { n: 0, monto: 0 }, borradoresTaller: 0 };
    expect(distintivoProveedor({ kind: "cerrada", emitidaEn: EMITIDA, emitidaPor: POR }, { kind: "sin-promesa" }, resumen)).toEqual({ kind: "sin-liga" });
  });
});

describe("revocacionPorCierre — al cerrar, el mismo guardado revoca la liga", () => {
  const AHORA = "2026-09-22T18:00:00.000Z";
  it("visita cerrada con liga vigente ⇒ versión +1 y rastro 'cierre:<quien>'", () => {
    expect(revocacionPorCierre({ ligaCreadaEn: EMITIDA, ligaCreadaPor: POR, ligaVersion: 3, fsalidaReal: "2026-09-22" }, AHORA, "riesgos@ejemplo.test"))
      .toEqual({ ligaVersion: 4, ligaRevocadaEn: AHORA, ligaRevocadaPor: "cierre:riesgos@ejemplo.test" });
  });
  it("sin ligaVersion en la fila, la versión implícita es 1 ⇒ pasa a 2 (misma regla que el portal)", () => {
    expect(revocacionPorCierre({ ligaCreadaEn: EMITIDA, fsalidaReal: "2026-09-22" }, AHORA, "x@ejemplo.test")?.ligaVersion).toBe(2);
  });
  it("visita ABIERTA ⇒ null (nada viaja)", () => {
    expect(revocacionPorCierre({ ligaCreadaEn: EMITIDA, estado: "En Reparación" }, AHORA, "x@ejemplo.test")).toBeNull();
  });
  it("cerrada pero SIN liga ⇒ null", () => {
    expect(revocacionPorCierre({ fsalidaReal: "2026-09-22" }, AHORA, "x@ejemplo.test")).toBeNull();
  });
  it("cerrada con liga YA revocada ⇒ null (no se re-revoca en cada guardado)", () => {
    expect(revocacionPorCierre({ ligaCreadaEn: EMITIDA, ligaRevocadaEn: "2026-09-21T00:00:00.000Z", fsalidaReal: "2026-09-22" }, AHORA, "x@ejemplo.test")).toBeNull();
  });
  it("cerrada con liga VENCIDA ⇒ null (ya no sirve; no hay nada que matar)", () => {
    expect(revocacionPorCierre({ ligaCreadaEn: EMITIDA, fsalidaReal: "2026-12-10" }, "2026-12-15T00:00:00.000Z", "x@ejemplo.test")).toBeNull();
  });
  it("sin quien ⇒ rastro 'cierre:desconocido' (nunca vacío)", () => {
    expect(revocacionPorCierre({ ligaCreadaEn: EMITIDA, fsalidaReal: "2026-09-22" }, AHORA, "")?.ligaRevocadaPor).toBe("cierre:desconocido");
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/tallerSeguimientoEstado.test.ts`
Expected: FAIL — `revocacionPorCierre is not a function` y `kind` "activa" donde se espera "cerrada".

- [ ] **Step 3: Implementar en `src/taller/seguimiento.ts`**

(a) `EstadoLiga` (~L21): agregar la variante

```ts
  /** Liga vigente (emitida, no revocada, no vencida) en una visita YA CERRADA: el portal la
   *  rechaza y el siguiente guardado la revoca (revocacionPorCierre). Solo la alcanzan las
   *  visitas cerradas ANTES de que el cierre revocara. */
  | { kind: "cerrada"; emitidaEn: string; emitidaPor: string }
```

(b) `estadoLiga` (~L33): entre el chequeo de `vencida` y el `return { kind: "activa" … }`, insertar

```ts
  if (visitaCerrada(e)) return { kind: "cerrada", emitidaEn, emitidaPor };
```

(`visitaCerrada` ya existe más abajo en el archivo, ~L66; las funciones de módulo se izan, no hay que moverla.)

(c) Después de `promesaTaller` (o al final de la sección de liga), agregar:

```ts
/**
 * Decisión 2 (spec §4.2): al CERRAR una visita cuya liga sigue vigente, el MISMO guardado la
 * revoca — no una segunda llamada que pueda fallar ni un permiso que 3 de 4 operativos no
 * tienen (`revocarLigaTaller` es admin/riesgos). Reabrir no la resucita.
 * Devuelve los tres campos a incluir en el upsert, o null si no hay nada que revocar.
 * `(e.ligaVersion ?? 1) + 1` es la MISMA regla que `revocarLiga` en el portal.
 */
export function revocacionPorCierre(
  e: Partial<TallerEntry>,
  ahoraISO: string,
  quien: string,
): { ligaVersion: number; ligaRevocadaEn: string; ligaRevocadaPor: string } | null {
  // "cerrada" = liga vigente en visita cerrada: exactamente el caso a revocar.
  if (estadoLiga(e, ahoraISO).kind !== "cerrada") return null;
  return {
    ligaVersion: (e.ligaVersion ?? 1) + 1,
    ligaRevocadaEn: ahoraISO,
    ligaRevocadaPor: `cierre:${(quien ?? "").trim() || "desconocido"}`,
  };
}
```

(d) `distintivoProveedor`: no requiere cambio (el `return { kind: "sin-liga" }` final ya absorbe `cerrada`); actualizar el comentario: `// Una liga vencida o cerrada con la visita ya no sirve: se lee igual que no tenerla.`

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run tests/tallerSeguimientoEstado.test.ts tests/tallerSeguimientoDistintivo.test.ts tests/tallerBloqueProveedor.test.ts`
Expected: PASS todos (las pruebas previas de `activa` siguen verdes: ninguna usa `fsalidaReal`/`Finalizado`; si alguna sí, es un hallazgo — reportarlo, no ajustarla a ciegas).

- [ ] **Step 5: NO commitear (ola paralela).** Commit del controller:
`git add src/taller/seguimiento.ts tests/tallerSeguimientoEstado.test.ts && git commit -m "feat(taller): la liga se declara cerrada con la visita y el cierre la revoca (regla pura)"`

---

### Task 3: La fecha de salida se borra de verdad

**Files:**
- Modify: `src/api/batchUpload.ts:514` (`fechaSalida: e.fsalidaReal || undefined`)
- Modify: `src/api/client.ts:130` (`fechaSalida?: string;`)
- Modify: `src/api/cloudHydrate.ts:1070` (`fsalidaReal: String(datos.fsalidaReal ?? t.fechaSalida ?? "")`)
- Test: `tests/tallerFechaSalida.test.ts` (crear)

**Interfaces:**
- Consumes: `uploadTallerToCloud(entries, tenantId, partidasDe?)` y `upsertTaller(TallerInput)` (mock, patrón de `tests/tallerGastoNoPersiste.test.ts:87-95`).
- Produces: `TallerInput.fechaSalida?: string | null`.

- [ ] **Step 1: Escribir la prueba que falla**

```ts
// tests/tallerFechaSalida.test.ts
// Decisión 4 (spec §4.4): la columna `fechaSalida` no se podía borrar — `|| undefined` la dejaba
// como estaba en el upsert y la hidratación la REVIVÍA con `datos.fsalidaReal ?? t.fechaSalida`.
// Una visita reabierta cargaba una salida fantasma (fila real: datos.fsalidaReal NULL,
// fechaSalida 2026-09-22).
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

type Upsert = { fechaSalida?: string | null; estatus: string };
const upserts: Upsert[] = [];
vi.mock("../src/api/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/api/client")>();
  return { ...real, upsertTaller: (arg: Upsert) => { upserts.push(arg); return Promise.resolve({}); } };
});
const { uploadTallerToCloud } = await import("../src/api/batchUpload");

describe("uploadTallerToCloud — la salida se manda como null explícito cuando no hay", () => {
  it("sin fsalidaReal ⇒ fechaSalida: null (no undefined) y estatus abierto", async () => {
    upserts.length = 0;
    await uploadTallerToCloud([{ id: "tl_1", plate: "PRB001A", fentrada: "2026-09-22", estado: "En Diagnóstico" }], "tenant-x");
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.fechaSalida).toBeNull();
    expect(upserts[0]!.estatus).toBe("abierto");
  });
  it("con fsalidaReal ⇒ viaja la fecha y estatus cerrado", async () => {
    upserts.length = 0;
    await uploadTallerToCloud([{ id: "tl_2", plate: "PRB001A", fentrada: "2026-09-22", fsalidaReal: "2026-09-25", estado: "Finalizado" }], "tenant-x");
    expect(upserts[0]!.fechaSalida).toBe("2026-09-25");
    expect(upserts[0]!.estatus).toBe("cerrado");
  });
});

describe("hidratación — fsalidaReal sale SOLO de datos, nunca de la columna vieja", () => {
  const src = readFileSync("src/api/cloudHydrate.ts", "utf8");
  it("la línea de fsalidaReal no cae a t.fechaSalida", () => {
    const linea = src.split("\n").find((l) => l.includes("fsalidaReal: String("));
    expect(linea, "no encontré la reconstrucción de fsalidaReal").toBeTruthy();
    expect(linea).not.toContain("t.fechaSalida");
    expect(linea).toContain('datos.fsalidaReal ?? ""');
  });
  it("fentrada conserva su fallback a la columna (es parte de la llave, siempre presente)", () => {
    expect(src).toContain("fentrada: String(datos.fentrada ?? t.fechaEntrada)");
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/tallerFechaSalida.test.ts`
Expected: FAIL — `expected undefined to be null` y `expected … not to contain "t.fechaSalida"`.

- [ ] **Step 3: Implementar**

`src/api/client.ts:130`: `fechaSalida?: string | null;`

`src/api/batchUpload.ts:514`:
```ts
        // Decisión 4 (spec §4.4): `null` EXPLÍCITO limpia la columna; `undefined` la dejaba
        // como estaba y la salida "revivía" al hidratar (salida fantasma, incidente 2026-09-22).
        fechaSalida: e.fsalidaReal || null,
```

`src/api/cloudHydrate.ts:1070`:
```ts
        // Decisión 4: la columna `fechaSalida` siempre se derivó de datos.fsalidaReal; cuando
        // difieren, la columna es la que está mal. Sin fallback: no se revive una salida borrada.
        fsalidaReal: String(datos.fsalidaReal ?? ""),
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run tests/tallerFechaSalida.test.ts tests/tallerGastoNoPersiste.test.ts tests/tallerCloudKeyPlacaVigente.test.ts`
Expected: PASS.

- [ ] **Step 5: NO commitear (ola paralela).** Commit del controller:
`git add src/api/batchUpload.ts src/api/client.ts src/api/cloudHydrate.ts tests/tallerFechaSalida.test.ts && git commit -m "fix(taller): la fecha de salida se borra de verdad — null explicito y sin fallback a la columna"`

---

### Task 4: El portal rechaza visitas anuladas

**Files:**
- Modify: `amplify/functions/taller-portal/handler.ts` (imports ~L34-40; `cargarVisitaVigente` ~L531-550)
- Test: `tests/tallerPortalHandler.test.ts` (agregar un `describe`)

**Interfaces:**
- Consumes: `refIdTaller`, `esAnulacionActiva` de `src/anulacion/anulacion.ts` (importables desde el Lambda con `../../../src/…`, como ya hace `opsgpa-receptor/handler.ts:21-29`); `client.models.Anulacion.get({ tenantId, refId })` (identifier `["tenantId","refId"]`, `resource.ts:~410`).
- Produces: `cargarVisitaVigente` lanza `ErrorLigaInvalida("visita anulada")`.

- [ ] **Step 1: Escribir la prueba que falla** (al final de `tests/tallerPortalHandler.test.ts`)

```ts
describe("decisión 3 (spec §4.3): el portón rechaza visitas ANULADAS", () => {
  const i = handlerSrc.indexOf("async function cargarVisitaVigente(");
  const cuerpo = handlerSrc.slice(i, handlerSrc.indexOf("\n}", i));
  it("consulta Anulacion por su llave (tenantId + refId compuesto con refIdTaller)", () => {
    expect(cuerpo).toContain("models.Anulacion.get(");
    expect(cuerpo).toContain("refIdTaller(tk.u, tk.f)");
  });
  it("una anulación ACTIVA (sin restauradaTs) tumba la liga con el mismo 401 opaco", () => {
    expect(cuerpo).toContain("esAnulacionActiva(");
    expect(cuerpo).toContain('ErrorLigaInvalida("visita anulada")');
  });
  it("el handler importa las reglas puras de anulación de src/, no las reimplementa", () => {
    expect(handlerSrc).toMatch(/import \{[^}]*refIdTaller[^}]*\} from "\.\.\/\.\.\/\.\.\/src\/anulacion\/anulacion"/);
  });
  it("el chequeo va DESPUÉS de leer la visita y ANTES de devolverla", () => {
    expect(cuerpo.indexOf("models.Anulacion.get(")).toBeGreaterThan(cuerpo.indexOf("models.Taller.get("));
    expect(cuerpo.indexOf('ErrorLigaInvalida("visita anulada")')).toBeLessThan(cuerpo.lastIndexOf("return v;"));
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/tallerPortalHandler.test.ts`
Expected: FAIL en los 4 casos nuevos.

- [ ] **Step 3: Implementar en `handler.ts`**

Import (junto a los demás, ~L35):
```ts
import { esAnulacionActiva, refIdTaller } from "../../../src/anulacion/anulacion";
```

En `cargarVisitaVigente`, después del `if (visitaCerrada(...)) { throw … }` y antes de `return v;`:
```ts
  // Decisión 3 (spec §4.3): una visita ANULADA por admin no es una visita. Sin este candado,
  // el taller seguía leyendo y escribiendo partidas en un tombstone (incidente 2026-09-22).
  // Mismo refId que compone el frontend (refIdTaller) y la misma regla de "activa"
  // (esAnulacionActiva: sin restauradaTs) — nunca una cadena ni un predicado a mano.
  const { data: tomb, errors: errTomb } = await client.models.Anulacion.get({
    tenantId: tk.t,
    refId: refIdTaller(tk.u, tk.f),
  });
  if (errTomb) throw new Error(`Anulacion.get: ${JSON.stringify(errTomb)}`);
  if (tomb && esAnulacionActiva(tomb)) throw new ErrorLigaInvalida("visita anulada");
  return v;
```

Actualizar el comentario de cabecera de `cargarVisitaVigente` ("Tres motivos de rechazo…") para listar el quinto: "o la visita fue ANULADA (decisión 3)".

- [ ] **Step 4: Correr y ver pasar + typecheck del Lambda**

Run: `npx vitest run tests/tallerPortalHandler.test.ts tests/tallerLiga.test.ts`
Expected: PASS. Además `npx tsc --noEmit -p amplify/tsconfig.json` si existe ese tsconfig (si no, `npm run typecheck` lo cubre y lo corre el controller al cerrar la ola — NO correrlo en la ola paralela).

- [ ] **Step 5: NO commitear (ola paralela).** Commit del controller:
`git add amplify/functions/taller-portal/handler.ts tests/tallerPortalHandler.test.ts && git commit -m "fix(portal): el porton rechaza visitas anuladas — mismo refId y misma regla que el frontend"`

---

### Task 5: Cablear en `src/`: la revocación viaja en el upsert y la guarda se publica al monolito

**Files:**
- Modify: `src/api/client.ts` (`TallerInput`, ~L126-135)
- Modify: `src/api/batchUpload.ts` (`uploadTallerToCloud`, ~L482-530)
- Modify: `src/api/cloudWire.ts` (`__cloudSyncTaller` ~L362-379; `__cloudReplaceTaller` ~L404-410; `declare global` ~L168-200; puentes de seguimiento ~L540-560)
- Test: `tests/tallerCierreRevocaLiga.test.ts` (crear)

**Interfaces:**
- Consumes: `revocacionPorCierre` (Tarea 2), `llaveEnUso`/`LlaveVisita`/`LlaveEnUso` (Tarea 1), `tallerCloudKey` (existe), `ensureSession()` (existe en cloudWire; devuelve `{ tenantId, email, … }`).
- Produces: `uploadTallerToCloud(entries, tenantId, partidasDe?, quien?)`; `window.__llaveEnUso(candidata: LegacyTallerEntry, vigentes: LegacyTallerEntry[]): LlaveEnUso`.

- [ ] **Step 1: Escribir la prueba que falla**

```ts
// tests/tallerCierreRevocaLiga.test.ts
// Decisión 2 (spec §4.2): el cierre revoca la liga EN EL MISMO upsert. Aquí se prueba el
// contrato de subida; la regla (revocacionPorCierre) ya tiene sus pruebas puras.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

type Upsert = { estatus: string; ligaVersion?: number; ligaRevocadaEn?: string; ligaRevocadaPor?: string };
const upserts: Upsert[] = [];
vi.mock("../src/api/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/api/client")>();
  return { ...real, upsertTaller: (arg: Upsert) => { upserts.push(arg); return Promise.resolve({}); } };
});
const { uploadTallerToCloud } = await import("../src/api/batchUpload");

const EMITIDA = "2026-09-15T10:00:00.000Z";
const base = { id: "tl_1", plate: "PRB001A", fentrada: "2026-09-14", ligaCreadaEn: EMITIDA, ligaCreadaPor: "r@ejemplo.test" };

describe("uploadTallerToCloud — el cierre revoca la liga en el mismo guardado", () => {
  it("visita cerrada con liga vigente ⇒ viajan ligaVersion+1, ligaRevocadaEn y 'cierre:<quien>'", async () => {
    upserts.length = 0;
    await uploadTallerToCloud([{ ...base, fsalidaReal: "2026-09-22", estado: "Finalizado", ligaVersion: 1 }], "tenant-x", undefined, "op@ejemplo.test");
    const u = upserts[0]!;
    expect(u.estatus).toBe("cerrado");
    expect(u.ligaVersion).toBe(2);
    expect(u.ligaRevocadaPor).toBe("cierre:op@ejemplo.test");
    expect(typeof u.ligaRevocadaEn).toBe("string");
  });
  it("visita abierta ⇒ NO viaja ningún campo de liga", async () => {
    upserts.length = 0;
    await uploadTallerToCloud([{ ...base, estado: "En Reparación" }], "tenant-x", undefined, "op@ejemplo.test");
    expect(upserts[0]).not.toHaveProperty("ligaVersion");
    expect(upserts[0]).not.toHaveProperty("ligaRevocadaEn");
  });
  it("cerrada con liga ya revocada ⇒ NO se re-revoca", async () => {
    upserts.length = 0;
    await uploadTallerToCloud([{ ...base, fsalidaReal: "2026-09-22", ligaRevocadaEn: "2026-09-21T00:00:00.000Z", ligaVersion: 2 }], "tenant-x", undefined, "op@ejemplo.test");
    expect(upserts[0]).not.toHaveProperty("ligaVersion");
  });
  it("sin quien (llamador viejo) ⇒ 'cierre:desconocido', nunca vacío", async () => {
    upserts.length = 0;
    await uploadTallerToCloud([{ ...base, fsalidaReal: "2026-09-22" }], "tenant-x");
    expect(upserts[0]!.ligaRevocadaPor).toBe("cierre:desconocido");
  });
});

describe("cloudWire — los llamadores pasan el correo de la sesión y publican la guarda", () => {
  const src = readFileSync("src/api/cloudWire.ts", "utf8");
  it("__cloudSyncTaller y __cloudReplaceTaller pasan session.email como 4º argumento", () => {
    const m = src.match(/uploadTallerToCloud\([^)]*session\.email\)/g) ?? [];
    expect(m.length, "faltan llamadores con session.email").toBe(2);
  });
  it("publica window.__llaveEnUso componiendo las llaves con tallerCloudKey", () => {
    const i = src.indexOf("window.__llaveEnUso =");
    expect(i).toBeGreaterThan(-1);
    const cuerpo = src.slice(i, i + 700);
    expect(cuerpo).toContain("tallerCloudKey(");
    expect(cuerpo).toContain("__anuladasActivas");
    expect(cuerpo).toContain("llaveEnUso(");
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/tallerCierreRevocaLiga.test.ts`
Expected: FAIL (sin `ligaVersion` en el upsert; sin `session.email`; sin `__llaveEnUso`).

- [ ] **Step 3: Implementar**

`src/api/client.ts` — `TallerInput` gana:
```ts
  /** Decisión 2 (spec §4.2): revocación por cierre en el MISMO upsert. Solo viajan al cerrar
   *  una visita con liga vigente (revocacionPorCierre); si no, no se mandan. */
  ligaVersion?: number;
  ligaRevocadaEn?: string;
  ligaRevocadaPor?: string;
```

`src/api/batchUpload.ts`:
- import: `import { revocacionPorCierre } from "../taller/seguimiento";`
- firma: agregar 4º parámetro `quien?: string` con doc: `/** Correo de la sesión, para el rastro "cierre:<quien>" (decisión 2). Ausente en el llamador de migración. */`
- dentro del `try`, antes del `await upsertTaller({…})`:
```ts
      // Decisión 2 (spec §4.2): si esta escritura CIERRA la visita y su liga sigue vigente,
      // la revocación viaja en el MISMO upsert — sin segunda llamada ni permiso extra
      // (revocarLigaTaller es admin/riesgos; cerrar es de cualquier operativo).
      const revocacion = estatus === "cerrado"
        ? revocacionPorCierre(e as Partial<TallerEntry>, new Date().toISOString(), quien ?? "")
        : null;
```
  y en el objeto del upsert: `...(revocacion ?? {}),` (después de `datos:`). Importar `type TallerEntry` de `../taller/types` si hace falta para el cast.

`src/api/cloudWire.ts`:
- `__cloudSyncTaller`: `uploadTallerToCloud(entries, session.tenantId, partidasDeEntry, session.email)`
- `__cloudReplaceTaller`: `uploadTallerToCloud([entry], session.tenantId, partidasDeEntry, session.email)`
- import: `import { llaveEnUso, type LlaveEnUso } from "../taller/llaveVisita";`
- `declare global` (junto a `__tallerCloudKey`):
```ts
    /** Decisión 1 (spec §4.1): ¿la llave (unitUid+fechaEntrada) de la visita candidata ya la usa
     *  otra visita vigente o una anulada? El monolito NO guarda si no es "libre". */
    __llaveEnUso?: (candidata: LegacyTallerEntry, vigentes: LegacyTallerEntry[]) => LlaveEnUso;
```
- puente (junto a `window.__tallerCloudKey = tallerCloudKey;`):
```ts
  // Decisión 1: la guarda del alta. Las llaves se componen con tallerCloudKey (la misma que
  // usa el registro, la liga y el tombstone) y las anuladas salen del mapa de la hidratación.
  window.__llaveEnUso = (candidata, vigentes) => {
    const k = (e: LegacyTallerEntry) => ({ id: String(e.id ?? ""), ...tallerCloudKey(e) });
    return llaveEnUso(k(candidata), vigentes.map(k), window.__anuladasActivas ?? new Map());
  };
```

- [ ] **Step 4: Correr y ver pasar + verificación completa (esta tarea SÍ corre en fila)**

Run: `npx vitest run tests/tallerCierreRevocaLiga.test.ts tests/tallerFechaSalida.test.ts tests/tallerGastoNoPersiste.test.ts tests/tallerSeguimientoEstado.test.ts tests/tallerLlaveVisita.test.ts` → PASS.
Run: `npm run typecheck && npm run lint` → limpios.
Run: `npm run test:run > "$TEMP/t5.txt" 2>&1; grep -nE "^ *FAIL|Test Files|Tests " "$TEMP/t5.txt"` → 0 FAIL.

- [ ] **Step 5: Commit**

```bash
git add src/api/client.ts src/api/batchUpload.ts src/api/cloudWire.ts tests/tallerCierreRevocaLiga.test.ts
git commit -m "feat(taller): el cierre revoca la liga en el mismo guardado; la guarda de llave llega al monolito"
```

---

### Task 6: Los tres enganches del monolito — guarda del alta, revocar antes de anular, "Liga cerrada"

**Files:**
- Modify: `Control de flotilla.html` (`saveTallerEntry` ~L11175-11275; anulación de Taller ~L11300-11312; `_provPintar` ~L7838-7862)
- Modify: `nginx.conf` (lo regenera `csp:sync`)
- Test: `tests/tallerLigaCierreUi.test.ts` (crear)

**Interfaces:**
- Consumes: `window.__llaveEnUso` (T5), `window.__estadoLiga` (existe, devuelve `EstadoLiga`, ahora con `cerrada`), `window.__tallerLiga.revocar(unitUid, fechaEntrada)` (existe), `window.__tallerCloudKey(e)` (existe), `window.__anulaciones.anular(refId, "taller", motivo)` (existe), `fmtDate`, `notify`, `_markInvalid`.
- Produces: comportamiento de UI; nada nuevo para otras tareas.

- [ ] **Step 1: Escribir la prueba que falla**

```ts
// tests/tallerLigaCierreUi.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");
const cuerpo = (nombre: string): string => {
  const i = html.indexOf(`function ${nombre}(`);
  expect(i, `no existe ${nombre}`).toBeGreaterThan(-1);
  return html.slice(i, html.indexOf("\nfunction ", i + 10));
};

describe("decisión 1 — la guarda del alta en saveTallerEntry", () => {
  const c = cuerpo("saveTallerEntry");
  it("consulta window.__llaveEnUso ANTES de meter la visita en tallerEntries", () => {
    const iGuarda = c.indexOf("window.__llaveEnUso(");
    expect(iGuarda).toBeGreaterThan(-1);
    expect(iGuarda).toBeLessThan(c.indexOf("tallerEntries.push(entry)"));
  });
  it("si la llave está en uso NO guarda y explica (vigente / anulada), con foco en la fecha", () => {
    expect(c).toContain("ya tiene una visita con fecha de atención");
    expect(c).toContain("Cambia la fecha o abre la existente");
    expect(c).toContain("restáurala desde Anulados");
    expect(c).toContain('_markInvalid("tf-fentrada")');
  });
});

describe("decisión 3 — anular revoca la liga PRIMERO", () => {
  const i = html.indexOf('window.__anulaciones.anular(window.__tallerRefId(e),"taller",motivo)');
  const bloque = html.slice(html.lastIndexOf("onConfirm:async(motivo)=>{", i), i + 60);
  it("revoca (si la liga está activa O cerrada-pero-vigente) antes de anular, y aborta si revocar falla", () => {
    expect(bloque).toContain("__estadoLiga(e)");
    expect(bloque).toContain('"cerrada"');
    expect(bloque).toContain("__tallerLiga.revocar(");
    expect(bloque.indexOf("__tallerLiga.revocar(")).toBeLessThan(bloque.indexOf("__anulaciones.anular("));
    expect(bloque).toContain("la visita no se anuló");
    expect(bloque).toMatch(/throw new Error\(/);
  });
});

describe("decisión 5 — el bloque Proveedor dice 'Liga cerrada con la visita'", () => {
  const c = cuerpo("_provPintar");
  it("pinta el estado 'cerrada' con su leyenda", () => {
    expect(c).toContain('liga.kind === "cerrada"');
    expect(c).toContain("Liga cerrada con la visita");
  });
  it("sigue sin innerHTML", () => {
    expect(c).not.toContain(".innerHTML");
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/tallerLigaCierreUi.test.ts`
Expected: FAIL en los 5 casos.

- [ ] **Step 3: Implementar en el monolito** (editar con un script Node de reemplazos anclados — cada ancla debe aparecer EXACTAMENTE una vez; `Read`/`Edit` pueden estar bloqueados en este worktree)

(a) **Guarda del alta.** En `saveTallerEntry`, justo ANTES de:
```js
  if(_tallerEditId){
    const idx=tallerEntries.findIndex(e=>e.id===_tallerEditId);
```
insertar:
```js
  // Decisión 1 (spec §4.1): la llave real de la visita es unidad + fecha de atención. Si otra
  // visita —vigente o ANULADA— ya la tiene, guardar la PISARÍA en silencio y la nueva heredaría
  // su anulación, su liga y sus partidas (incidente 2026-09-22). Se bloquea y se explica.
  if(typeof window.__llaveEnUso === "function"){
    const uso = window.__llaveEnUso(entry, tallerEntries);
    if(uso.kind !== "libre"){
      const quien = entry.eco ? `La unidad ${entry.eco}` : `La placa ${entry.plate}`;
      const msg = uso.kind === "anulada"
        ? `${quien} ya tiene una visita con fecha de atención ${fmtDate(uso.fentrada)} (anulada${uso.anuladaEn ? " el " + fmtDate(uso.anuladaEn) : ""}). Cambia la fecha, o restáurala desde Anulados si es la misma visita.`
        : `${quien} ya tiene una visita con fecha de atención ${fmtDate(uso.fentrada)} (vigente). Cambia la fecha o abre la existente.`;
      window.notify && window.notify(msg, "warn", 7000);
      _markInvalid("tf-fentrada");
      return;
    }
  }
```

(b) **Revocar antes de anular.** Reemplazar la línea
```js
        await window.__anulaciones.anular(window.__tallerRefId(e),"taller",motivo);
```
por:
```js
        // Decisión 3 (spec §4.3): una visita anulada no puede dejar una liga viva detrás.
        // PRIMERO revocar (admin sí puede), DESPUÉS anular: si anular falla, solo queda una
        // liga muerta — inofensivo. Si revocar falla, NO se anula (throw → el overlay lo
        // muestra y no cierra).
        const ligaE = typeof window.__estadoLiga === "function" ? window.__estadoLiga(e).kind : "sin-liga";
        // "activa" (visita abierta) o "cerrada" (visita cerrada con liga vigente): en ambos la
        // liga sigue viva para el portal si la visita se reabre — hay que matarla.
        if((ligaE === "activa" || ligaE === "cerrada")
           && window.__tallerLiga && typeof window.__tallerCloudKey === "function"){
          const { unitUid, fechaEntrada } = window.__tallerCloudKey(e);
          const r = await window.__tallerLiga.revocar(unitUid, fechaEntrada);
          if(!r || "error" in r){
            window.notify?.("No se pudo revocar la liga del proveedor; la visita no se anuló. Intenta de nuevo.","error",6000);
            throw new Error("liga no revocada");
          }
        }
        await window.__anulaciones.anular(window.__tallerRefId(e),"taller",motivo);
```

(c) **"Liga cerrada con la visita"** en `_provPintar`:
- clase de la pastilla: `pill.className = "tl-pill " + (liga.kind === "activa" ? "repar" : liga.kind === "revocada" ? "pendiente" : "");` (sin cambio: `cerrada` cae en `""`).
- texto: cambiar el ternario a
```js
  pill.textContent = liga.kind === "activa" ? "Liga activa"
    : liga.kind === "revocada" ? "Liga revocada"
    : liga.kind === "vencida" ? "Liga vencida"
    : liga.kind === "cerrada" ? "Liga cerrada" : "Sin liga";
```
- `meta.textContent`: agregar la rama antes de la de `vencida`:
```js
      : liga.kind === "cerrada"
        ? `Liga cerrada con la visita · emitida por ${liga.emitidaPor || "desconocido"} · ${fmtDate(liga.emitidaEn)}`
```

- [ ] **Step 4: CSP, guardias y batería (esta tarea SÍ corre en fila)**

```bash
npx vitest run tests/tallerLigaCierreUi.test.ts tests/tallerBloqueProveedor.test.ts tests/tallerPartidasEnRegistro.test.ts tests/tallerOlaHonestidadUi.test.ts tests/tallerSaveEntryGastoCandado.test.ts
npm run csp:sync && npm run audit:csp && npm run audit:xss
npm run typecheck && npm run lint
npm run test:run > "$TEMP/t6.txt" 2>&1; grep -nE "^ *FAIL|Test Files|Tests " "$TEMP/t6.txt"
```
Expected: todo verde; `audit:xss` solo el `${alertMin}` preexistente. Extraer los `<script>` inline y `node --check` cada uno.

- [ ] **Step 5: Commit (HTML + nginx.conf en el MISMO commit) y `audit:csp` otra vez sobre el commit hecho**

```bash
git add "Control de flotilla.html" nginx.conf tests/tallerLigaCierreUi.test.ts
git commit -m "feat(taller): el alta no pisa visitas, anular revoca la liga y el bloque dice 'Liga cerrada'"
npm run audit:csp
```

---

## Cierre del frente

- [ ] **Batería completa** sobre el HEAD final: `npm run test:run` (a archivo), `npm run typecheck`, `npm run lint`, `npm run audit:csp`, `npm run audit:xss`, `npm run build`, y e2e local (`node scripts/gen-fixture-mensual.mjs && npx playwright test -c playwright.local.config.ts`) contra la referencia **60/67** (7 ambientales conocidos).
- [ ] **Revisión final de toda la rama + revisión de SEGURIDAD, en paralelo** (modelo capaz). La de seguridad cubre: el portal lee `Anulacion` (nuevo camino de lectura con IAM); `ligaVersion` escrito por el cliente con el guardado normal; y deja constancia del riesgo PREEXISTENTE: la autorización de `Taller` es por modelo, cualquier `operativo` puede escribir `ligaVersion` por la API y bajarla para revivir un token.
- [ ] **Una sola ola de arreglo** con los hallazgos de ambas, una re-revisión acotada.
- [ ] **Prueba manual de Navares** (spec §6): (1) registrar la 06 con fecha 14/09 → bloqueado con el aviso; (2) registrar con fecha de hoy → nace sin liga ni partidas; emitir liga; (3) dar salida → el bloque dice "Liga revocada" y la liga en el celular ya no abre; (4) reabrir → sigue revocada; emitir nueva → abre vacía; (5) anular una visita con liga → la liga muere y la visita desaparece.
- [ ] **Cierre** con `superpowers:finishing-a-development-branch`. **Sin desplegar**: el push y el PR los hace Navares; el merge despliega.

## Lo que NO entra en este plan

- La identidad de la visita sin fecha (frente #11): este plan cierra la puerta con una guarda de cliente y lo documenta.
- Limpiar las columnas del proveedor al crear encima de otra visita (la guarda lo hace imposible).
- El Bloque 2 (cámara, mano de obra sin foto, factura CFDI).
