# Fase 1 — Ruido de indicadores de Combustible: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los chips de Combustible cuenten solo trabajo accionable — apagando 5,884 alarmas que
no son trabajo — sin cambiar ningún cálculo, y bloqueando la corrupción de datos que hoy es posible
al validar a mano un registro que Operaciones-GPA aún no ha resuelto.

**Architecture:** Cuatro cambios sobre módulos que ya existen y son puros. `buildKpisFuel`
(`renderKpis.ts`) decide **qué se cuenta** en cada tarjeta: se le cambia el criterio, no el motor.
`mapEntry.ts` promueve dos campos que hoy están enterrados en `datos` (`fuente`, `opsStatus`) para que
la UI pueda distinguir el origen de un registro. Un módulo nuevo y puro, `opsGuard.ts`, concentra los
candados de escritura, y `renderDetalleCarga.ts` los aplica. Nada toca `computeFuelMetrics`,
`computeRecorridos`, el gasto ni el dataset.

**Tech Stack:** TypeScript estricto · Vite · vitest (+happy-dom para los render) · DOM API directa
(sin framework, sin `innerHTML`) · AWS Amplify Gen 2 para los datos.

**Spec:** [2026-07-30-ruido-indicadores-combustible-design.md](../specs/2026-07-30-ruido-indicadores-combustible-design.md)
— este plan implementa **C1, C2, C3 y C5b** (fase 1). El resto de los cambios (C4–C12) es fase 2+.

**Base:** rama `feat/ruido-indicadores-fase1`, creada desde **`origin/main` (22dd5c6)**, en el worktree
aislado `C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla-wt-ruido`. **No** se trabaja en
`feat/opsgpa-mensual`: esa rama está 28 commits atrás y su `renderKpis.ts` **no tiene** el trabajo
"Producto Vivo" ya mergeado en main (66 líneas de diferencia). Implementar allí habría revertido en
silencio los deltas de KPI.

## Lo que `renderKpis.ts` YA tiene en main — no lo reinventes

Leer esto antes de tocar el archivo:

- **`FuelKpiCard.grupo: "nucleo" | "estado"` es un campo REQUERIDO.** Es la jerarquía visual que ya
  existe: `nucleo` = métricas grandes con el valor en tinta (Cargas, Litros, Rendimiento, Gasto);
  `estado` = chips compactos que encienden color solo cuando hay algo que atender. **Toda tarjeta
  nueva debe declararlo** o el typecheck falla.
- **`renderKpisFuel` pinta DOS filas**, no una: `rowNucleo` (`.kpi-row.kpi-row-nucleo`) y `rowEstado`
  (`.kpi-row.kpi-chips`), y reparte con `c.grupo === "nucleo" ? rowNucleo : rowEstado` (última línea
  de la función).
- **`FuelKpiCard.delta`** y el 6.º parámetro `prev` de `buildKpisFuel` existen (comparación con el
  periodo anterior). Es opcional: llamar con 5 argumentos es válido y no hay que tocarlo.
- La "capa de contexto" de esta fase **se implementa extendiendo `grupo` con un tercer valor**, no
  con un campo nuevo. Dos mecanismos paralelos para la misma jerarquía es exactamente la duplicación
  que hay que evitar.

## Global Constraints

- **Ningún total del universo puede cambiar.** Criterio de aceptación del spec §7: al re-correr la
  auditoría, `Cargas`, `Litros cargados`, `Gasto` y `Rendimiento flota` deben quedar **idénticos**. Si
  uno se mueve, el cambio dejó de ser de presentación y hay que revertirlo.
- **Prohibido `innerHTML`** (regla del proyecto contra XSS): todo DOM se construye con
  `document.createElement` + `textContent`, como el código existente.
- **Worktree compartido entre sesiones.** Nunca `git add -A` ni `git add .`: stagear **solo las rutas
  explícitas** de cada tarea. Verificar la rama antes del primer commit (`git branch --show-current`).
- **Los tests que fallan de `tests/e2e/**` son ajenos** (specs de Playwright de worktrees hermanos que
  vitest recoge por un `exclude` mal anclado). El conteo propio de referencia es **190/190 archivos**.
  Un fallo ahí no es tuyo.
- **`npm run lint` NO cubre `amplify/**` ni `tests/**`** — es literalmente `eslint "src/**/*.{ts,js}"`.
  El typecheck (`npm run typecheck`) sí cubre todo.
- **Statuses de Ops: comparar por prefijo, nunca por igualdad.** Conviven `Aprobada` y `Aprobado`
  (355 y 164 registros en producción), y `Por corregir` vs `Por corrección` comparten solo el prefijo
  `corre`. Cualquier `=== "Aprobada"` deja fuera cientos de registros.
- **Mensajes de commit en español**, con el formato del repo (`feat(fuel): …`, `fix(fuel): …`), y
  terminando con:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```
- **No desplegar.** Este plan termina en commits locales. El deploy es decisión de Navares.

---

## File Structure

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `src/fuel/types.ts` | Añadir `fuente` y `opsStatus` a `FuelEntry` | 1 |
| `src/fuel/mapEntry.ts` | Promover `datos.fuente` y `datos.opsStatus` a campos de primera clase | 1 |
| `src/fuel/opsGuard.ts` | **NUEVO.** Módulo puro: ¿se puede validar/corregir este registro? Y el motivo legible | 5 |
| `src/fuel/renderKpis.ts` | Qué cuenta cada tarjeta (C1, C2, C3) + render de la línea de contexto | 2, 3, 4 |
| `src/fuel/renderDetalleCarga.ts` | Aplicar los candados y explicar al usuario por qué está bloqueado | 5 |
| `src/styles/main.css` | Estilo de la línea de contexto `.kpi-contexto` y del aviso de bloqueo | 3, 5 |
| `tests/fuelOpsOrigen.test.ts` | **NUEVO.** Promoción de `fuente`/`opsStatus` | 1 |
| `tests/fuelKpisRuido.test.ts` | **NUEVO.** C1, C2, C3 sobre `buildKpisFuel` | 2, 3, 4 |
| `tests/fuelOpsGuard.test.ts` | **NUEVO.** Candados puros + su aplicación en el detalle | 5 |

**Orden obligatorio:** la tarea 1 es prerrequisito de la 5 (los candados necesitan los campos). Las
tareas 2, 3 y 4 son independientes entre sí y de la 1.

---

### Task 1: Promover `fuente` y `opsStatus` a `FuelEntry`

Hoy el origen de un registro (MoreApp vs el puente de Ops) y su status vivo en Ops existen **solo
dentro del blob `datos`**, así que ninguna parte de la aplicación puede distinguirlos. Sin esto, la
tarea 5 es imposible. Es exactamente el mismo patrón que se usó para `solicitudFolio`
(`mapEntry.ts:278`): el dato existía en `datos` pero no existía *para la aplicación*.

**Files:**
- Modify: `src/fuel/types.ts` (bloque de campos de `FuelEntry`)
- Modify: `src/fuel/mapEntry.ts:274-279` (dentro del `return` de `mapCargaToFuelEntry`)
- Test: `tests/fuelOpsOrigen.test.ts` (crear)

**Interfaces:**
- Consumes: nada.
- Produces: `FuelEntry.fuente?: string` (valor real en producción: `"ops-gpa"`, o `undefined` para
  MoreApp) y `FuelEntry.opsStatus?: string` (`"Aprobada"` | `"Aprobado"` | `"Rechazada"` |
  `"Pendiente"` | `"Por corregir"` | `undefined`). La tarea 5 los consume.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/fuelOpsOrigen.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapCargaToFuelEntry, type CargaRow } from "../src/fuel/mapEntry";

const base: CargaRow = {
  economicoId: "45",
  tipo: "carga",
  eventoId: "OPS-abc123",
  fecha: "2026-07-20",
  sucursal: "Monterrey",
};

describe("origen del registro promovido a FuelEntry (spec 2026-07-30 §2.5)", () => {
  it("promueve datos.fuente y datos.opsStatus del puente de Ops", () => {
    const e = mapCargaToFuelEntry({
      ...base,
      datos: { fuente: "ops-gpa", opsStatus: "Pendiente" },
    });
    expect(e.fuente).toBe("ops-gpa");
    expect(e.opsStatus).toBe("Pendiente");
  });

  it("un registro de MoreApp queda sin fuente ni opsStatus (undefined, no cadena vacía)", () => {
    const e = mapCargaToFuelEntry({ ...base, datos: { producto: "MAGNA" } });
    expect(e.fuente).toBeUndefined();
    expect(e.opsStatus).toBeUndefined();
  });

  it("recorta espacios y trata la cadena vacía como ausente", () => {
    const e = mapCargaToFuelEntry({
      ...base,
      datos: { fuente: "  ops-gpa  ", opsStatus: "   " },
    });
    expect(e.fuente).toBe("ops-gpa");
    expect(e.opsStatus).toBeUndefined();
  });

  it("tolera datos ausente por completo", () => {
    const e = mapCargaToFuelEntry(base);
    expect(e.fuente).toBeUndefined();
    expect(e.opsStatus).toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/fuelOpsOrigen.test.ts`
Expected: FAIL — `expected undefined to be 'ops-gpa'` (los campos no existen todavía). Si además
TypeScript se queja de que `fuente` no está en `FuelEntry`, es la misma causa.

- [ ] **Step 3: Añadir los campos al tipo**

En `src/fuel/types.ts`, dentro del tipo `FuelEntry`, justo **después** del campo `solicitudFolio`
(para que los campos de procedencia queden juntos), añadir:

```ts
  /**
   * Origen del registro: "ops-gpa" cuando lo escribió el puente de Operaciones-GPA;
   * `undefined` para los de MoreApp (que nunca estamparon `datos.fuente`).
   * Lo consume opsGuard: de él depende quién manda en el veredicto y en el odómetro.
   */
  fuente?: string;
  /**
   * Status VIVO del registro en Operaciones-GPA ("Aprobada"/"Aprobado"/"Rechazada"/
   * "Pendiente"/"Por corregir"). Solo existe en registros del puente. Comparar SIEMPRE
   * por prefijo: conviven las dos grafías de género.
   */
  opsStatus?: string;
```

- [ ] **Step 4: Promover los campos en el mapeo**

En `src/fuel/mapEntry.ts`, en el `return` de `mapCargaToFuelEntry`, justo después de la línea
`solicitudFolio: str(datos.solicitudFolio),` añadir:

```ts
    // Procedencia del registro (spec 2026-07-30 §2.5): sin promoverlos, la aplicación no
    // puede distinguir un registro del puente de uno de MoreApp, y los candados de
    // escritura de opsGuard serían imposibles. `str()` ya recorta y colapsa "" → undefined.
    fuente: str(datos.fuente),
    opsStatus: str(datos.opsStatus),
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run tests/fuelOpsOrigen.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6: Verificar que nada más se rompió**

Run: `npx vitest run tests/fuelParse.test.ts tests/fuelRechazadas.test.ts tests/fuelSolicitudEnlace.test.ts && npm run typecheck`
Expected: PASS y typecheck limpio. (Añadir campos opcionales no puede romper consumidores, pero
`mapEntry` lo usan muchos tests: conviene confirmarlo antes de commitear.)

- [ ] **Step 7: Commit**

```bash
git add src/fuel/types.ts src/fuel/mapEntry.ts tests/fuelOpsOrigen.test.ts
git commit -m "$(cat <<'EOF'
feat(fuel): promover fuente y opsStatus del puente a FuelEntry

Los dos campos vivian solo dentro del blob `datos`, asi que la aplicacion no
podia distinguir un registro de Operaciones-GPA de uno de MoreApp. Es el
prerrequisito de los candados de escritura (spec 2026-07-30 §2.5).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: C1 — "Sin rendimiento 635" → "Errores de captura 32" + "Cobertura de km/l"

El chip actual cuenta **todas** las cargas sin km/l (635 en producción) cuando solo **32** son trabajo:
el resto son huecos estructurales correctos (343 cargas parciales que suman a una ventana abierta, 157
montacargas cuyo km es horómetro, 41 primeras cargas, 35 llenados partidos, 27 sin lleno previo). El
predicado que los separa —`MOTIVO_SIN_KMPL_ACCIONABLE`— **ya existe** y ya se usa para la sub-línea; el
cambio es cuál de los dos números va en el `value`.

El chip de errores **se auto-oculta en 0** (mismo patrón que `Histórico` y `Rechazadas`, `renderKpis.ts:129`
y `:150`): es deuda finita de la era MoreApp, no un KPI permanente (spec §2.5-1).

**Files:**
- Modify: `src/fuel/renderKpis.ts:107-119` (la tarjeta `sin-rendimiento`)
- Test: `tests/fuelKpisRuido.test.ts` (crear)

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: dos claves de tarjeta que las tareas 3 y 4 no deben pisar: `"errores-captura"` (solo
  presente si hay ≥1) y `"cobertura-kmpl"` (siempre presente). Desaparece la clave
  `"sin-rendimiento"`.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/fuelKpisRuido.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { buildKpisFuel, renderKpisFuel } from "../src/fuel/renderKpis";
import { buildFleetBaseline, type RecorridoInfo } from "../src/fuel/fuelAnalysis";
import type { FuelEntry, FuelMetrics, FleetBaseline } from "../src/fuel/types";

/** loadId determinista: un contador, para que un fallo sea reproducible. */
let seq = 0;

/** Carga mínima viable; `over` sobreescribe lo que el test necesite. */
function entry(over: Partial<FuelEntry> = {}): FuelEntry {
  return {
    loadId: `${over.eco ?? "10"}|carga|E${++seq}`,
    tipo: "carga",
    eco: "10",
    eventoId: "E1",
    sucursal: "Guadalajara",
    fecha: "2026-07-15",
    tipoUnidad: "Gasolina Magna",
    esMontacargas: false,
    photos: [],
    ...over,
  } as FuelEntry;
}

/** Métrica de una carga: `kmPorLitro: null` + motivo = "sin rendimiento". */
function metric(loadId: string, motivo?: FuelMetrics["motivoSinKmpl"]): FuelMetrics {
  return {
    loadId,
    eco: "10",
    fecha: "2026-07-15",
    kmPorLitro: motivo ? null : 8,
    motivoSinKmpl: motivo,
  } as FuelMetrics;
}

const BASELINE: FleetBaseline = buildFleetBaseline([], []);
const card = (cards: ReturnType<typeof buildKpisFuel>, key: string) =>
  cards.find((c) => c.key === key);

describe("C1 — el chip cuenta errores de captura, no huecos estructurales", () => {
  it("cuenta SOLO los motivos accionables, no las 5 estructurales", () => {
    // 2 accionables (odómetro retrocede, salto) + 3 estructurales (ventana, montacargas, 1ª carga)
    const es = [entry(), entry(), entry(), entry(), entry()];
    const ms = [
      metric(es[0]!.loadId, "odometro_retroceso"),
      metric(es[1]!.loadId, "salto_improbable"),
      metric(es[2]!.loadId, "parcial_en_ventana"),
      metric(es[3]!.loadId, "montacargas"),
      metric(es[4]!.loadId, "primera_carga"),
    ];
    const cards = buildKpisFuel(es, ms, BASELINE, []);
    expect(card(cards, "errores-captura")?.value).toBe("2");
    expect(card(cards, "sin-rendimiento")).toBeUndefined();
  });

  it("se auto-oculta cuando no hay errores accionables", () => {
    const e = entry();
    const cards = buildKpisFuel([e], [metric(e.loadId, "montacargas")], BASELINE, []);
    expect(card(cards, "errores-captura")).toBeUndefined();
  });

  it("la cobertura de km/l reporta el porcentaje CON rendimiento y su desglose", () => {
    const es = [entry(), entry(), entry(), entry()];
    const ms = [
      metric(es[0]!.loadId), // con km/l
      metric(es[1]!.loadId), // con km/l
      metric(es[2]!.loadId), // con km/l
      metric(es[3]!.loadId, "montacargas"),
    ];
    const cards = buildKpisFuel(es, ms, BASELINE, []);
    const cob = card(cards, "cobertura-kmpl");
    expect(cob?.value).toBe("75 %");
    expect(cob?.sub).toBe("3 de 4 cargas");
    expect(cob?.title).toContain("Montacargas: 1");
  });

  it("sin métricas no divide por cero", () => {
    const cards = buildKpisFuel([], [], BASELINE, []);
    expect(card(cards, "cobertura-kmpl")?.value).toBe("—");
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/fuelKpisRuido.test.ts`
Expected: FAIL — `expected undefined to be '2'` (la clave `errores-captura` no existe todavía).

- [ ] **Step 3: Reemplazar la tarjeta**

En `src/fuel/renderKpis.ts`, **sustituir** el bloque de la tarjeta `sin-rendimiento` (líneas 107-119,
desde `{` de `key: "sin-rendimiento"` hasta su `},`) por:

```ts
    // C1 (spec 2026-07-30 §2.5-1): el chip cuenta SOLO lo accionable. Los huecos
    // estructurales (ventana, montacargas, 1ª carga, llenado partido) son correctos y no
    // son trabajo: su sitio es el desglose de "Cobertura de km/l". Se auto-oculta en 0
    // porque es deuda FINITA de la era MoreApp, no un KPI permanente.
    ...(porRevisar > 0
      ? [
          {
            key: "errores-captura",
            grupo: "estado" as const,
            label: "Errores de captura",
            value: NUM.format(porRevisar),
            sub: "odómetro por corregir",
            tone: "a" as const,
            title: desgloseSinRend || undefined,
          } as FuelKpiCard,
        ]
      : []),
    {
      key: "cobertura-kmpl",
      // Salud, no alerta: una tasa va en el núcleo con el valor en tinta.
      grupo: "nucleo",
      label: "Cobertura de km/l",
      value: metrics.length ? `${((conKmpl / metrics.length) * 100).toFixed(0)} %` : "—",
      sub: `${NUM.format(conKmpl)} de ${NUM.format(metrics.length)} cargas`,
      tone: "n",
      // El desglose completo (cuántas por cada motivo) explica el hueco sin gritar.
      title: desgloseSinRend || undefined,
    },
```

Y añadir el contador que falta, justo **después** de la línea `const porRevisar = sinKmpl.filter(...)` (`renderKpis.ts:75-77`):

```ts
  // Cargas que SÍ tienen km/l — numerador de la cobertura.
  const conKmpl = metrics.length - sinKmpl.length;
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/fuelKpisRuido.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Verificar que no se rompió el resto**

Run: `npx vitest run tests/fuelRechazadas.test.ts tests/renderTableCombustible.test.ts && npm run typecheck && npm run lint`
Expected: PASS. Si algún test buscaba la clave `"sin-rendimiento"`, actualízalo a `"errores-captura"`
— es un cambio deliberado de contrato, no una regresión.

- [ ] **Step 6: Commit**

```bash
git add src/fuel/renderKpis.ts tests/fuelKpisRuido.test.ts
git commit -m "$(cat <<'EOF'
feat(fuel): el chip cuenta errores de captura, no huecos estructurales

"Sin rendimiento" mostraba 635 cuando solo 32 eran trabajo: 603 eran huecos
correctos (ventana, montacargas, 1a carga, llenado partido). Ahora el chip
cuenta los accionables y se auto-oculta en 0; los estructurales pasan al
desglose de "Cobertura de km/l". Cero cambios en el calculo de km/l.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: C2 — El histórico deja de ser un chip y pasa a línea de contexto

4,261 registros —el **70 % del universo**— son anteriores al corte de validación (`2026-06-01`) y por
diseño nadie los va a validar retroactivamente. Como chip pesan igual que "Discrepancias 9", que sí
es trabajo. Pasan a una línea de contexto bajo las tarjetas, **conservando el clic al filtro
`historico` que ya existe**. No se borra ni se oculta ningún dato: es un cambio de jerarquía visual.

**Files:**
- Modify: `src/fuel/renderKpis.ts` (union `grupo`, la tarjeta `historico`, y el reparto de filas al
  final de `renderKpisFuel`)
- Modify: `src/styles/main.css` (clase `.kpi-contexto`)
- Test: `tests/fuelKpisRuido.test.ts` (añadir describe)

**Interfaces:**
- Consumes: la tarea 2 ya modificó `renderKpis.ts`; aquí se toca otro bloque del mismo archivo.
- Produces: `FuelKpiCard.grupo` acepta un tercer valor, **`"contexto"`**. Una tarjeta de ese grupo
  **no** se pinta como `.kc`: `renderKpisFuel` la agrupa en una línea `.kpi-contexto` al final del
  contenedor, después de las dos filas. La tarea 4 reutiliza este mecanismo para los montacargas.

- [ ] **Step 1: Escribir el test que falla**

Añadir al final de `tests/fuelKpisRuido.test.ts`. **No añadas imports nuevos**: `renderKpisFuel` y
`// @vitest-environment happy-dom` ya están en la cabecera que escribiste en la tarea 2 (un `import` a
media página rompe la regla `import/first` de eslint).

```ts
describe("C2 — el histórico es contexto, no una alarma", () => {
  it("la tarjeta de histórico viene marcada como contexto y conserva su filtro", () => {
    // Pendiente + fecha < corte (2026-06-01) ⇒ displayVerdict "historico"
    const viejo = entry({ fecha: "2026-03-10" });
    const cards = buildKpisFuel([viejo], [], BASELINE, []);
    const h = cards.find((c) => c.key === "historico");
    expect(h?.value).toBe("1");
    expect(h?.grupo).toBe("contexto");
    expect(h?.filter).toBe("historico");
  });

  it("renderKpisFuel NO pinta las de contexto como tarjeta .kc", () => {
    const viejo = entry({ fecha: "2026-03-10" });
    const cont = document.createElement("div");
    renderKpisFuel(cont, buildKpisFuel([viejo], [], BASELINE, []));
    const etiquetas = [...cont.querySelectorAll(".kc .klbl")].map((n) => n.textContent);
    expect(etiquetas).not.toContain("Histórico");
    const linea = cont.querySelector(".kpi-contexto");
    expect(linea?.textContent).toContain("1");
    expect(linea?.textContent).toContain("istórico");
  });

  it("la línea de contexto es accionable (dispara el filtro con teclado y ratón)", () => {
    const viejo = entry({ fecha: "2026-03-10" });
    const cont = document.createElement("div");
    const vistos: string[] = [];
    renderKpisFuel(cont, buildKpisFuel([viejo], [], BASELINE, []), (f) => vistos.push(f));
    const btn = cont.querySelector<HTMLElement>(".kpi-contexto [role=button]");
    expect(btn).not.toBeNull();
    btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    btn!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(vistos).toEqual(["historico", "historico"]);
  });

  it("sin histórico no se pinta ninguna línea de contexto", () => {
    const cont = document.createElement("div");
    renderKpisFuel(cont, buildKpisFuel([entry()], [], BASELINE, []));
    expect(cont.querySelector(".kpi-contexto")).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/fuelKpisRuido.test.ts`
Expected: FAIL — `expected 'estado' to be 'contexto'` en `h?.grupo`.

- [ ] **Step 3: Extender la jerarquía que ya existe**

En `src/fuel/renderKpis.ts`, en el tipo `FuelKpiCard`, **sustituir** la línea del campo `grupo`:

```ts
  /**
   * Jerarquía: núcleo (métricas grandes) vs estado (chips de alerta) vs contexto (archivo y
   * huecos estructurales — spec 2026-07-30 C2/C3: datos que NO se esconden pero que no deben
   * pesar como trabajo pendiente; van en una línea al pie, no como tarjeta).
   */
  grupo: "nucleo" | "estado" | "contexto";
```

- [ ] **Step 4: Mover la tarjeta de histórico al grupo de contexto**

En la tarjeta `historico` (dentro del `...(historicos > 0 ? [...] : [])`), cambiar **solo** el grupo:

```ts
            key: "historico",
            // C2: 70 % del universo y nadie lo validará retroactivamente → contexto, no alerta.
            grupo: "contexto" as const,
```

- [ ] **Step 5: Pintar las de contexto como línea**

En `renderKpisFuel`, **sustituir la última línea de la función** (el reparto de filas):

```ts
  for (const c of cards) (c.grupo === "nucleo" ? rowNucleo : rowEstado).appendChild(make(c));
```

por:

```ts
  // C2/C3: lo que es archivo o estructural no compite con el trabajo pendiente. No se
  // esconde: baja a una línea al pie, conservando su clic al filtro.
  const contexto = cards.filter((c) => c.grupo === "contexto");
  for (const c of cards) {
    if (c.grupo === "contexto") continue;
    (c.grupo === "nucleo" ? rowNucleo : rowEstado).appendChild(make(c));
  }
  if (contexto.length) {
    const linea = document.createElement("div");
    linea.className = "kpi-contexto";
    contexto.forEach((c, i) => {
      if (i > 0) linea.appendChild(document.createTextNode(" · "));
      const txt = `${c.value} ${c.label.toLowerCase()}${c.sub ? ` (${c.sub})` : ""}`;
      if (c.filter && onFilter) {
        // Accionable: mismo contrato de a11y que las tarjetas (role + Enter/Espacio).
        const b = document.createElement("span");
        b.className = "kpi-contexto-link";
        b.textContent = txt;
        b.setAttribute("role", "button");
        b.tabIndex = 0;
        b.setAttribute("aria-label", `Filtrar por ${c.label}`);
        const h = () => onFilter(c.filter!);
        b.addEventListener("click", h);
        b.addEventListener("keydown", (ev) => {
          const k = (ev as KeyboardEvent).key;
          if (k === "Enter" || k === " ") {
            ev.preventDefault();
            h();
          }
        });
        linea.appendChild(b);
      } else {
        linea.appendChild(document.createTextNode(txt));
      }
    });
    container.appendChild(linea);
  }
```

- [ ] **Step 6: Añadir el estilo**

Al final de `src/styles/main.css`:

```css
/* Línea de contexto bajo los KPIs (spec 2026-07-30 C2): archivo y huecos
   estructurales — datos que NO se esconden pero que no deben pesar como pendientes. */
.kpi-contexto {
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--s2);
  line-height: 1.5;
}
.kpi-contexto-link {
  cursor: pointer;
  text-decoration: underline dotted;
  text-underline-offset: 2px;
}
.kpi-contexto-link:hover,
.kpi-contexto-link:focus-visible {
  color: var(--ac);
}
```

- [ ] **Step 7: Correr el test y verificar que pasa**

Run: `npx vitest run tests/fuelKpisRuido.test.ts`
Expected: PASS — 8 tests (4 de la tarea 2 + 4 de esta).

- [ ] **Step 8: Verificar el resto y commitear**

Run: `npx vitest run tests/renderTableCombustible.test.ts tests/fuelRechazadas.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add src/fuel/renderKpis.ts src/styles/main.css tests/fuelKpisRuido.test.ts
git commit -m "$(cat <<'EOF'
feat(fuel): el historico pasa de chip a linea de contexto

4,261 registros previos al corte de validacion (70% del universo) pesaban
visualmente igual que "Discrepancias 9", que si es trabajo. Ahora van en una
linea al pie, conservando el clic al filtro `historico` que ya existia. No se
oculta ni se borra ningun dato.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: C3 — "Solicitudes sin carga" → tasa de comprobación, sin montacargas

El chip mezcla dos poblaciones incomparables: **1,020 solicitudes de montacargas Gas LP** (9 unidades
que por naturaleza no emiten reporte de carga con odómetro — su km es horómetro) con **1,912 de
vehículos** ($1,799,011), que sí deberían tenerlo. Y su valor absoluto (2,932) es incomprensible: el
dato útil es la **tasa** y el dinero.

El predicado que los separa —`esMontacargas`— **ya existe** y se deriva de `producto` (`"TOKA
COMBUSTIBLE GAS LP CHIP"`), que es el campo fiable: los montacargas traen `combustible: "Gasolina"`,
así que filtrar por combustible sería un error (`mapEntry.ts:92-105`).

> **Alcance:** el spec incluye en C3 ignorar solicitudes duplicadas del mismo económico el mismo día.
> **Eso NO va en esta fase**: exige modificar `computeRecorridos`, que es un cálculo compartido, y la
> restricción global de la fase 1 es no cambiar ningún cálculo. Queda como **C3b para la fase 2**.

**Files:**
- Modify: `src/fuel/renderKpis.ts:39-47` (cálculo de `sinCarga`) y `:162-172` (la tarjeta)
- Test: `tests/fuelKpisRuido.test.ts` (añadir describe)

**Interfaces:**
- Consumes: `FuelKpiCard.contexto` de la tarea 3.
- Produces: claves `"tasa-comprobacion"` (siempre que haya `recorridosByLoad`) y
  `"montacargas-sin-carga"` (contexto, solo si hay ≥1). Desaparece la clave `"sin-carga"`.

- [ ] **Step 1: Escribir el test que falla**

Añadir al final de `tests/fuelKpisRuido.test.ts` (`RecorridoInfo` ya está importado en la cabecera de
la tarea 2 — no añadas imports a media página):

```ts
/** Ciclo CERRADO sin carga de por medio = solicitud sin comprobante de consumo. */
const CERRADO_SIN_CARGA = { cerrado: true, viaCarga: false } as RecorridoInfo;

describe("C3 — tasa de comprobación separando montacargas de vehículos", () => {
  it("la tasa se calcula solo con vehículos y reporta el dinero sin comprobante", () => {
    const solVeh = entry({ tipo: "solicitud", montoEstimado: 1000 });
    const solVeh2 = entry({ tipo: "solicitud", montoEstimado: 500 });
    const cargaVeh = entry({ tipo: "carga" });
    const rec = new Map([
      [solVeh.loadId, CERRADO_SIN_CARGA],
      [solVeh2.loadId, CERRADO_SIN_CARGA],
    ]);
    const cards = buildKpisFuel([solVeh, solVeh2, cargaVeh], [], BASELINE, [], rec);
    const t = card(cards, "tasa-comprobacion");
    // 1 carga de vehículo / 2 solicitudes de vehículo = 50 %. Un decimal: la tasa real de
    // producción es 42.5 % y redondearla a entero borra el movimiento mes a mes.
    expect(t?.value).toBe("50.0 %");
    expect(t?.sub).toContain("2 sin reporte");
    expect(t?.sub).toContain("$1,500");
    expect(card(cards, "sin-carga")).toBeUndefined();
  });

  it("los montacargas NO entran en la tasa: van a contexto con su propio monto", () => {
    const mc = entry({ tipo: "solicitud", esMontacargas: true, montoEstimado: 700 });
    const sol = entry({ tipo: "solicitud", montoEstimado: 1000 });
    const carga = entry({ tipo: "carga" });
    const rec = new Map([
      [mc.loadId, CERRADO_SIN_CARGA],
      [sol.loadId, CERRADO_SIN_CARGA],
    ]);
    const cards = buildKpisFuel([mc, sol, carga], [], BASELINE, [], rec);
    // La tasa ignora al montacargas: 1 carga / 1 solicitud de vehículo = 100 %
    expect(card(cards, "tasa-comprobacion")?.value).toBe("100.0 %");
    expect(card(cards, "tasa-comprobacion")?.sub).toContain("1 sin reporte");
    const mcCard = card(cards, "montacargas-sin-carga");
    expect(mcCard?.value).toBe("1");
    expect(mcCard?.grupo).toBe("contexto");
    expect(mcCard?.tone).toBe("n");
  });

  it("un ciclo en curso (no cerrado) o con carga no cuenta como sin comprobante", () => {
    const enCurso = entry({ tipo: "solicitud", montoEstimado: 900 });
    const conCarga = entry({ tipo: "solicitud", montoEstimado: 900 });
    const rec = new Map([
      [enCurso.loadId, { cerrado: false, viaCarga: false } as RecorridoInfo],
      [conCarga.loadId, { cerrado: true, viaCarga: true } as RecorridoInfo],
    ]);
    const cards = buildKpisFuel([enCurso, conCarga], [], BASELINE, [], rec);
    expect(card(cards, "tasa-comprobacion")?.sub).toContain("0 sin reporte");
    expect(card(cards, "montacargas-sin-carga")).toBeUndefined();
  });

  it("sin datos de recorrido la métrica se omite por completo", () => {
    const cards = buildKpisFuel([entry({ tipo: "solicitud" })], [], BASELINE, []);
    expect(card(cards, "tasa-comprobacion")).toBeUndefined();
    expect(card(cards, "montacargas-sin-carga")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/fuelKpisRuido.test.ts`
Expected: FAIL — `expected undefined to be '50 %'`.

- [ ] **Step 3: Reemplazar el cálculo**

En `src/fuel/renderKpis.ts`, **sustituir** el bloque `const sinCarga = recorridosByLoad ? ... : null;`
(líneas 42-47, junto a su comentario de las líneas 39-41) por:

```ts
  // Solicitudes con ciclo CERRADO (hay una solicitud posterior) y SIN carga de por medio:
  // dinero autorizado sin comprobante de consumo. La última solicitud de cada unidad
  // (ciclo en curso) no cuenta. Si no hay datos de recorrido, la métrica se omite.
  //
  // C3 (spec 2026-07-30 §2.5): montacargas y vehículos NO se mezclan. Un montacargas Gas LP
  // no emite reporte de carga con odómetro (su km es horómetro), así que contarlo como
  // incumplimiento es ruido: 1,020 de los 2,932 en producción. `esMontacargas` se deriva de
  // `producto`, el campo fiable — los montacargas traen combustible "Gasolina".
  const sinComprobante = (e: FuelEntry): boolean => {
    const r = recorridosByLoad?.get(e.loadId);
    return r != null && r.cerrado && !r.viaCarga;
  };
  const solVehiculos = solicitudes.filter((e) => !e.esMontacargas);
  const sinCargaVeh = recorridosByLoad ? solVehiculos.filter(sinComprobante) : null;
  const sinCargaMc = recorridosByLoad
    ? solicitudes.filter((e) => e.esMontacargas).filter(sinComprobante)
    : null;
  // El dinero de una solicitud vive en montoEstimado (montoTotal es de la carga).
  const montoAutorizado = (arr: readonly FuelEntry[]): number =>
    arr.reduce((a, e) => a + (e.montoEstimado ?? 0), 0);
  const cargasVeh = cargas.filter((e) => !e.esMontacargas).length;
```

- [ ] **Step 4: Reemplazar la tarjeta**

**Sustituir** el bloque `...(sinCarga !== null ? [...] : [])` (líneas 162-172) por:

```ts
    ...(sinCargaVeh !== null
      ? [
          {
            key: "tasa-comprobacion",
            // Salud: una tasa pertenece al núcleo, no a los chips de alerta.
            grupo: "nucleo" as const,
            label: "Tasa de comprobación",
            value: solVehiculos.length
              ? `${((cargasVeh / solVehiculos.length) * 100).toFixed(1)} %`
              : "—",
            sub: `${NUM.format(sinCargaVeh.length)} sin reporte · ${PESO.format(montoAutorizado(sinCargaVeh))}`,
            tone: "n",
          } as FuelKpiCard,
        ]
      : []),
    ...(sinCargaMc && sinCargaMc.length > 0
      ? [
          {
            key: "montacargas-sin-carga",
            // Estructural: no es incumplimiento, es que un montacargas no lleva odómetro.
            grupo: "contexto" as const,
            label: "Montacargas sin reporte",
            value: NUM.format(sinCargaMc.length),
            sub: `${PESO.format(montoAutorizado(sinCargaMc))} · estructural (horómetro)`,
            tone: "n",
          } as FuelKpiCard,
        ]
      : []),
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run tests/fuelKpisRuido.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 6: Verificar el resto y commitear**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: 190/190 archivos propios (los de `tests/e2e/**` son ajenos).

```bash
git add src/fuel/renderKpis.ts tests/fuelKpisRuido.test.ts
git commit -m "$(cat <<'EOF'
feat(fuel): tasa de comprobacion en vez de "solicitudes sin carga"

El chip mezclaba 1,020 solicitudes de montacargas Gas LP (que por naturaleza no
emiten reporte de carga: su km es horometro) con 1,912 de vehiculos. Ahora la
tasa se calcula solo con vehiculos y muestra el dinero sin comprobante; los
montacargas van a la linea de contexto con su propio monto.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: C5b — Candado contra congelar veredictos y contra la divergencia del odómetro

Dos formas de corromper datos que **hoy son posibles** y que la limpieza operativa de la fase 3
dispararía:

1. **Congelar un veredicto.** Validar a mano un registro que Ops aún no ha resuelto escribe
   `fuenteDeteccion: "manual"`, y la regla de no-pisado del receptor
   (`amplify/functions/opsgpa-receptor/handler.ts:188`) hace que el puente **jamás** vuelva a tocar ese
   veredicto: la aprobación de Ops nunca entraría. En producción hay **20 registros** en ese estado.
2. **Divergencia silenciosa del odómetro (R10).** Ops tiene su propio override con autoría
   (`kmForzadoPor`, usado 3 veces por Administración, las 3 en registros ya aprobados) y **sí llega a
   FC**. Pero si Tesorería ya había corregido con `kmDetectado`, la corrección oficial posterior pisa
   `kmCapturado` mientras `kmDetectado` **sigue ganando** en `computeFuelMetrics`: el km/l se
   calcularía con el valor viejo y nadie lo vería.

Los statuses no-finales se detectan **por negación** (todo lo que no empiece por `aproba`/`rechaza`),
para que `Por corregir` —desplegado y sin casos vivos— y cualquier status futuro de Ops queden
cubiertos sin tocar código.

**Files:**
- Create: `src/fuel/opsGuard.ts`
- Modify: `src/fuel/renderDetalleCarga.ts:285` (derivar `canWrite`) y `:470` (guardia del odómetro)
- Modify: `src/styles/main.css` (aviso `.fv-bloqueo`)
- Test: `tests/fuelOpsGuard.test.ts` (crear)

**Interfaces:**
- Consumes: `FuelEntry.fuente` y `FuelEntry.opsStatus` de la **tarea 1**.
- Produces: `esOrigenOps(e)`, `opsStatusEsFinal(e)`, `puedeValidarManual(e)`, `puedeCorregirKm(e)`,
  `motivoBloqueo(e)` — todas puras, todas aceptan un `Pick<FuelEntry, …>`.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/fuelOpsGuard.test.ts`. La cabecera ya incluye lo que necesita el paso 7 (el render
exige DOM), para no añadir imports a media página después:

```ts
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderDetalleCarga } from "../src/fuel/renderDetalleCarga";
import type { FuelEntry } from "../src/fuel/types";
import {
  esOrigenOps,
  opsStatusEsFinal,
  puedeValidarManual,
  puedeCorregirKm,
  motivoBloqueo,
} from "../src/fuel/opsGuard";

describe("origen y finalidad del status", () => {
  it("reconoce el origen del puente y trata la ausencia como MoreApp", () => {
    expect(esOrigenOps({ fuente: "ops-gpa" })).toBe(true);
    expect(esOrigenOps({ fuente: undefined })).toBe(false);
    expect(esOrigenOps({ fuente: "moreapp" })).toBe(false);
  });

  it("tolera las DOS grafías de género de los statuses finales", () => {
    expect(opsStatusEsFinal({ opsStatus: "Aprobada" })).toBe(true);
    expect(opsStatusEsFinal({ opsStatus: "Aprobado" })).toBe(true);
    expect(opsStatusEsFinal({ opsStatus: "Rechazada" })).toBe(true);
    expect(opsStatusEsFinal({ opsStatus: "Rechazado" })).toBe(true);
  });

  it("todo lo demás NO es final, incluido un status que Ops no ha inventado aún", () => {
    expect(opsStatusEsFinal({ opsStatus: "Pendiente" })).toBe(false);
    expect(opsStatusEsFinal({ opsStatus: "Por corregir" })).toBe(false);
    expect(opsStatusEsFinal({ opsStatus: "Por corrección" })).toBe(false);
    expect(opsStatusEsFinal({ opsStatus: "En revisión de flotilla" })).toBe(false);
    expect(opsStatusEsFinal({ opsStatus: undefined })).toBe(false);
  });
});

describe("candado de validación manual (no congelar el veredicto de Ops)", () => {
  it("bloquea mientras Ops no haya decidido", () => {
    expect(puedeValidarManual({ fuente: "ops-gpa", opsStatus: "Pendiente" })).toBe(false);
    expect(puedeValidarManual({ fuente: "ops-gpa", opsStatus: "Por corregir" })).toBe(false);
  });

  it("permite cuando Ops ya decidió: el no-pisado existe para proteger ese override humano", () => {
    expect(puedeValidarManual({ fuente: "ops-gpa", opsStatus: "Aprobada" })).toBe(true);
    expect(puedeValidarManual({ fuente: "ops-gpa", opsStatus: "Rechazada" })).toBe(true);
  });

  it("los registros de MoreApp nunca se bloquean: nadie más los va a validar", () => {
    expect(puedeValidarManual({ fuente: undefined, opsStatus: undefined })).toBe(true);
  });

  it("explica el motivo del bloqueo, y no dice nada cuando no hay bloqueo", () => {
    expect(motivoBloqueo({ fuente: "ops-gpa", opsStatus: "Pendiente" })).toContain("Pendiente");
    expect(motivoBloqueo({ fuente: "ops-gpa", opsStatus: "Aprobada" })).toBe("");
    expect(motivoBloqueo({ fuente: undefined, opsStatus: undefined })).toBe("");
  });
});

describe("candado del odómetro (R10: divergencia silenciosa)", () => {
  it("NUNCA se corrige en FC un registro de Ops, ni siquiera ya aprobado", () => {
    expect(puedeCorregirKm({ fuente: "ops-gpa" })).toBe(false);
  });

  it("los de MoreApp sí: son los 32 errores reales y Ops no los puede tocar", () => {
    expect(puedeCorregirKm({ fuente: undefined })).toBe(true);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/fuelOpsGuard.test.ts`
Expected: FAIL — `Cannot find module '../src/fuel/opsGuard'`.

- [ ] **Step 3: Crear el módulo**

Crear `src/fuel/opsGuard.ts`:

```ts
/**
 * Candados de ESCRITURA para registros originados en Operaciones-GPA (spec 2026-07-30 §2.5).
 *
 * No son permisos —el enforcement real es AppSync—: son candados contra CORROMPER datos.
 * Puro, sin DOM ni red → testeable con vitest.
 */
import type { FuelEntry } from "./types";

/**
 * Statuses de Ops que ya son FINALES: no llegará otro veredicto por el puente.
 * Por PREFIJO y sin distinguir género: en producción conviven "Aprobada"/"Aprobado" y
 * "Rechazada"/"Rechazado". Un `=== "Aprobada"` dejaría fuera cientos de registros.
 */
const OPS_STATUS_FINAL = /^(aproba|rechaza)/i;

/** ¿Lo escribió el puente de Ops? Sin `fuente` ⇒ MoreApp (nunca la estampó). */
export function esOrigenOps(e: Pick<FuelEntry, "fuente">): boolean {
  return e.fuente === "ops-gpa";
}

/** ¿El status de Ops ya es definitivo? Se decide por NEGACIÓN de la lista de finales. */
export function opsStatusEsFinal(e: Pick<FuelEntry, "opsStatus">): boolean {
  return OPS_STATUS_FINAL.test(String(e.opsStatus ?? "").trim());
}

/**
 * ¿Se puede validar a mano? NO mientras Ops no haya decidido.
 *
 * La validación manual escribe `fuenteDeteccion: "manual"`, y la regla de no-pisado del
 * receptor (amplify/functions/opsgpa-receptor/handler.ts:188) hace que el puente JAMÁS
 * vuelva a tocar ese veredicto: el registro quedaría congelado y la aprobación de Ops
 * nunca entraría. Cubre "Pendiente", "Por corregir" y cualquier status futuro.
 *
 * Cuando Ops YA decidió sí se permite: el no-pisado existe precisamente para que el
 * criterio humano de tesorería tenga la última palabra sobre el veredicto del puente.
 */
export function puedeValidarManual(e: Pick<FuelEntry, "fuente" | "opsStatus">): boolean {
  return !esOrigenOps(e) || opsStatusEsFinal(e);
}

/**
 * ¿Se puede corregir el odómetro en FC? NO para registros de Ops, en ningún status.
 *
 * Ops es la fuente de verdad y ya tiene su propio override con autoría (`kmForzadoPor`),
 * que además llega a FC. Si además se corrigiera aquí, una corrección posterior de Ops
 * pisaría `kmCapturado` mientras `kmDetectado` seguiría ganando en computeFuelMetrics
 * (fuelAnalysis.ts:196-202) → el km/l se calcularía con el valor viejo y nadie lo vería.
 * Costo operativo de este candado: cero — los 32 errores vivos son todos de MoreApp.
 */
export function puedeCorregirKm(e: Pick<FuelEntry, "fuente">): boolean {
  return !esOrigenOps(e);
}

/** Motivo legible del bloqueo de validación para la UI. Cadena vacía = no hay bloqueo. */
export function motivoBloqueo(e: Pick<FuelEntry, "fuente" | "opsStatus">): string {
  if (puedeValidarManual(e)) return "";
  return `Esperando a Operaciones-GPA (${e.opsStatus ?? "sin status"}). El veredicto llega por el puente: validar aquí lo congelaría y la decisión de Ops ya no entraría.`;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/fuelOpsGuard.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Aplicar el candado en el detalle de la carga**

En `src/fuel/renderDetalleCarga.ts`:

**(a)** Añadir el import junto a los demás del módulo:

```ts
import { puedeCorregirKm, puedeValidarManual, motivoBloqueo } from "./opsGuard";
```

**(b)** Reemplazar la línea 285:

```ts
  const { body, load, metrics, onValidate } = deps;
  // C5b (spec 2026-07-30 §2.5-2): mientras Ops no decida, NADA de escritura de veredicto.
  // Un `canWrite` derivado apaga de una vez los tres bloques que lo consultan (:418, :470, :541)
  // en vez de repetir la condición en cada uno y arriesgar que un sitio quede sin candado.
  const bloqueo = motivoBloqueo(load);
  const canWrite = deps.canWrite && puedeValidarManual(load);
```

**(c)** En la condición del corrector de odómetro (línea 470), añadir la guardia:

```ts
    if (
      slot.kind === "odometro" &&
      load.tipo === "carga" &&
      canWrite &&
      puedeCorregirKm(load) &&
      deps.onKmDetectado
    ) {
```

**(d)** Y justo **después** de ese bloque `if` (tras su `}`), el caso contrario para que el usuario no
crea que la herramienta desapareció:

```ts
    // Registro de Ops: la corrección de odómetro se pide a Ops (kmForzadoPor), que es la
    // fuente de verdad y deja autoría. Corregir aquí crearía una divergencia invisible (R10).
    if (slot.kind === "odometro" && load.tipo === "carga" && !puedeCorregirKm(load)) {
      const h = document.createElement("div");
      h.className = "fv-hint";
      h.textContent =
        "El odómetro de un registro de Operaciones-GPA se corrige en Ops (km forzado), no aquí.";
      formCol.appendChild(h);
    }
```

**(e)** Y el aviso general del bloqueo. En el `body`, justo **antes** del banner de anulación
(la cadena de `if (deps.esAdmin …)` que empieza en la línea 329), añadir:

```ts
  if (bloqueo) {
    const av = document.createElement("div");
    av.className = "fv-bloqueo";
    av.textContent = bloqueo;
    body.appendChild(av);
  }
```

- [ ] **Step 6: Añadir el estilo del aviso**

Al final de `src/styles/main.css`:

```css
/* Aviso de escritura bloqueada por el candado de Ops (spec 2026-07-30 C5b). */
.fv-bloqueo {
  margin: 8px 0;
  padding: 8px 10px;
  border: 1px solid var(--ln);
  border-left: 3px solid var(--A);
  border-radius: 6px;
  background: var(--bg2);
  font-size: 12px;
  color: var(--s2);
}
```

- [ ] **Step 7: Escribir el test de integración del detalle**

Añadir al final de `tests/fuelOpsGuard.test.ts` (sin imports nuevos: ya están en la cabecera del
paso 1):

```ts
function carga(over: Partial<FuelEntry> = {}): FuelEntry {
  return {
    loadId: "45|carga|OPS-abc",
    tipo: "carga",
    eco: "45",
    eventoId: "OPS-abc",
    sucursal: "Monterrey",
    fecha: "2026-07-29",
    tipoUnidad: "Gasolina Magna",
    esMontacargas: false,
    km: 1000,
    litros: 40,
    photos: [],
    ...over,
  } as FuelEntry;
}

function render(load: FuelEntry): HTMLElement {
  const body = document.createElement("div");
  renderDetalleCarga({
    body,
    load,
    canWrite: true,
    resolveUrl: () => null,
    onValidate: () => {},
    onKmDetectado: () => {},
  } as never);
  return body;
}

describe("aplicación del candado en el detalle de la carga", () => {
  it("un registro de Ops pendiente muestra el aviso y no ofrece corregir el odómetro", () => {
    const body = render(carga({ fuente: "ops-gpa", opsStatus: "Pendiente" }));
    expect(body.querySelector(".fv-bloqueo")?.textContent).toContain("Operaciones-GPA");
    expect(body.textContent).not.toContain("Odómetro real (según foto)");
  });

  it("un registro de Ops aprobado permite validar, pero el odómetro sigue siendo de Ops", () => {
    const body = render(carga({ fuente: "ops-gpa", opsStatus: "Aprobada" }));
    expect(body.querySelector(".fv-bloqueo")).toBeNull();
    expect(body.textContent).not.toContain("Odómetro real (según foto)");
    expect(body.textContent).toContain("se corrige en Ops");
  });

  it("un registro de MoreApp conserva el corrector de odómetro intacto", () => {
    const body = render(carga({ loadId: "45|carga|3809", eventoId: "3809" }));
    expect(body.querySelector(".fv-bloqueo")).toBeNull();
    expect(body.textContent).toContain("Odómetro real (según foto)");
  });
});
```

- [ ] **Step 8: Correr el test y verificar que pasa**

Run: `npx vitest run tests/fuelOpsGuard.test.ts`
Expected: PASS — 13 tests. Si el render exige alguna dep que el objeto de prueba no trae, añádela al
literal (no cambies el código de producción para acomodar el test).

- [ ] **Step 9: Verificar que no se rompió la validación existente y commitear**

Run: `npx vitest run tests/fuelKmDetectado.test.ts tests/fuelEvidence.test.ts tests/fuelRechazadas.test.ts && npm run typecheck && npm run lint`
Expected: PASS. `fuelKmDetectado.test.ts` es el que más riesgo tiene: si sus fixtures no declaran
`fuente`, cuentan como MoreApp y deben seguir pasando sin cambios.

```bash
git add src/fuel/opsGuard.ts src/fuel/renderDetalleCarga.ts src/styles/main.css tests/fuelOpsGuard.test.ts
git commit -m "$(cat <<'EOF'
feat(fuel): candado contra congelar veredictos de Ops y divergencia de odometro

Dos corrupciones posibles hoy: (1) validar a mano un registro que Ops aun no
resuelve escribe fuenteDeteccion "manual" y la regla de no-pisado del receptor
impide que el veredicto de Ops entre jamas (20 registros en ese estado);
(2) corregir kmDetectado en un registro de Ops crea una divergencia invisible,
porque una correccion posterior de Ops pisa kmCapturado pero kmDetectado sigue
ganando en computeFuelMetrics.

Los statuses no finales se detectan por negacion, asi que "Por corregir" y
cualquier status futuro de Ops quedan cubiertos sin tocar codigo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Verificación de no-regresión contra producción

La restricción global de esta fase es que **ningún total del universo cambie**. Esta tarea lo
demuestra con datos reales, no con fixtures.

**Files:**
- Modify: `tests/fixtures/audit-kpis.ts` (adaptar a las claves nuevas; ruta gitignoreada, **no se
  commitea**)

**Interfaces:**
- Consumes: las claves de tarjeta de las tareas 2, 3 y 4.
- Produces: nada de código. Produce la evidencia de aceptación.

- [ ] **Step 1: Capturar la línea base ANTES de tus cambios**

```bash
git stash && node_modules/.bin/tsx tests/fixtures/audit-kpis.ts 2026-01-01 2026-07-30 > /tmp/kpis-antes.txt; git stash pop
```

Si ya commiteaste las tareas 1-5, usa `git worktree add` sobre el commit anterior en vez de `stash`.
Guarda de ese archivo los cuatro totales: `Cargas`, `Litros cargados`, `Gasto`, `Rendimiento flota`.

- [ ] **Step 2: Correr la auditoría con tus cambios**

```bash
node_modules/.bin/tsx tests/fixtures/audit-kpis.ts 2026-01-01 2026-07-30 > /tmp/kpis-despues.txt
diff /tmp/kpis-antes.txt /tmp/kpis-despues.txt
```

- [ ] **Step 3: Comprobar los criterios de aceptación**

Expected en el `diff`:

| Debe | Comprobación |
|---|---|
| **NO cambiar** | `Cargas`, `Litros cargados`, `Gasto`, `Rendimiento flota` — idénticos al carácter |
| **Desaparecer** | la tarjeta `Sin rendimiento` (635) y la tarjeta `Histórico` (4,261) de la lista de chips |
| **Aparecer** | `Errores de captura` ≈ 32 · `Cobertura de km/l` ≈ 60 % · `Tasa de comprobación` ≈ 42.5 % |
| **Bajar** | `Solicitudes sin carga` 2,932 → `Tasa de comprobación` con ≈1,912 sin reporte |

Los números exactos **se mueven en horas** (los pendientes bajaron 44 → 42 en una tarde porque Ops
aprobó 3): valida el **sentido** del cambio y la **invariancia de los cuatro totales**, no los valores
absolutos.

Si algún total cambió: **revierte**. Significa que un cambio dejó de ser de presentación.

- [ ] **Step 4: Suite completa y typecheck**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: 190/190 archivos propios en verde. Los fallos de `tests/e2e/**` son de worktrees hermanos.

- [ ] **Step 5: Confirmar que el árbol solo tiene lo tuyo**

```bash
git status --short
git log --oneline -5
```
Expected: 5 commits nuevos y **ningún archivo ajeno** en staging. `tests/fixtures/audit-kpis.ts` está
gitignoreado y no debe aparecer.

---

## Qué queda fuera de esta fase

- **C3b** — ignorar solicitudes duplicadas del mismo económico el mismo día en `computeRecorridos`.
  Cambia un cálculo compartido; la restricción global de la fase 1 lo prohíbe. **Fase 2.**
- **C4, C5, C6, C8, C9** — afinado de la bandeja (dinero y antigüedad en rechazadas, partir pendientes
  por origen, discrepancias por dinero, sacar las 179 anomalías blandas, reordenar en tres capas).
- **C7** — dedup de causa raíz en anomalías (parejas salto→retroceso).
- **C10** — aviso de datos viejos (>60 min sin hidratar).
- **C11** — chip de duplicados sospechosos.
- **C12** — detector de deriva Ops↔FC como script recurrente.
- **Todo el trabajo operativo** (L1-L8): son decisiones y correcciones en la app, no código.
- **El deploy.** Este plan termina en commits locales.
