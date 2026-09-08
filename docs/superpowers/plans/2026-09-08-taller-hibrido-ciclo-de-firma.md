# Taller híbrido · Plan 1 — El ciclo de firma

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Administración de Riesgos dé el ingreso y genere una liga, que el proveedor cotice cada hallazgo con foto y precio sin tener cuenta, y que ella autorice partida por partida — con el gasto de la visita calculado como la suma de lo firmado.

**Architecture:** Un modelo nuevo `TallerPartida` (un registro por hallazgo, no un blob) y cuatro columnas nuevas en `Taller` para lo que escribe el proveedor, de modo que dos escritores concurrentes no se pisen. Un Lambda dedicado `taller-portal` con Function URL sirve la página del proveedor y recibe sus escrituras, autenticado por firma HMAC del token de la liga (fail-closed, patrón `opsgpa-receptor`). La UI de Riesgos vive en el monolito `Control de flotilla.html`; la lógica de negocio vive en `src/taller/partidas.ts` con tests.

**Tech Stack:** Vite + TypeScript vanilla · AWS Amplify Gen 2 (AppSync/DynamoDB, S3, Lambda) · vitest · ExcelJS (no `xlsx` community para formato).

**Spec:** [`docs/superpowers/specs/2026-09-04-taller-esquema-hibrido-proveedor-design.md`](../specs/2026-09-04-taller-esquema-hibrido-proveedor-design.md)

**Alcance de este plan:** el ciclo de firma completo, punta a punta. **Fuera de este plan** (van en el Plan 2, dentro de la misma Fase 1): reloj de cumplimiento con pausa y `estadoHistorial`, galería de fotos a pantalla completa, vista híbrida responsiva, PDF de cotización, próximo servicio, recotización en otro taller, y la hoja de instrucciones para talleres.

## Global Constraints

- **Rama y worktree:** `feat/taller-esquema-hibrido` en `../Control-Flotilla-wt-taller-hibrido`, ya rebasada sobre `origin/main` (`0894b90`). **Verificar la rama antes de cada commit** (`git branch --show-current`) y **stagear solo las rutas de este plan** — nunca `git add -A`. Varias sesiones comparten worktrees de este repo.
- **El repo es PÚBLICO** (`github.com/DevGPA/Control-Flotilla`): ningún secreto, ninguna URL de infraestructura, ningún identificador de cuenta AWS en el código ni en los tests.
- **XSS:** nada de `innerHTML` con datos. La descripción de la partida la escribe un tercero no autenticado. `npm run audit:xss` debe quedar en verde.
- **Anulación, nunca borrado:** las partidas se cancelan con tombstone. Jamás `delete` físico.
- **CSP:** si se toca cualquier `<script>` inline de `Control de flotilla.html`, correr `npm run csp:sync`. Este plan **no** toca scripts inline nuevos: la página del proveedor la sirve el Lambda.
- **Íconos:** cualquier ícono Lucide nuevo exige `node scripts/gen-lucide-subset.mjs`.
- **Precios sin IVA**, en todo el sistema. La etiqueta visible al proveedor es literalmente `Precio sin IVA`.
- **Motivos de rechazo** (menú cerrado, exactamente estos cinco): `No es necesario ahora` · `Precio alto — recotizar` · `Se repara en otro lado` · `No corresponde a esta unidad` · `Otro`.
- **Estados de partida** (exactamente estos seis): `borrador` · `propuesta` · `autorizada` · `rechazada` · `terminada` · `cancelada`.
- **Estados operativos del proveedor** (exactamente estos cuatro): `revisando` · `reparando` · `esperandoRefaccion` · `lista`.
- **Áreas canónicas** (exactamente estas cinco, con acento y Title Case, tomadas de `#cf-area` en el monolito): `Logística` · `Almacén` · `Servicio Técnico` · `Mantenimiento` · `Administración`.
- **Topes:** 6 fotos por partida · 60 partidas por visita · caducidad de liga 90 días.
- **La autorización es un registro, no una bandera.** `decididoPor` + `decididoEn` + `precioAutorizado` por partida. La pregunta de la segunda firma sigue abierta con gerencia: **no simplificar la decisión a un booleano**, porque añadir un segundo nivel después debe ser agregar un registro, no rehacer el módulo.
- **Comandos:** `npm run test:run` (vitest) · `npm run typecheck` · `npm run lint` · `npm run build`.
- Español en UI y en mensajes de commit, estilo `feat(modulo): descripción`.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/taller/types.ts` *(modificar)* | Tipos del módulo. Se le agregan las áreas canónicas y su normalización. |
| `src/taller/partidas.ts` *(crear)* | **Toda** la lógica pura de partidas: transiciones, editabilidad, totales, estado compuesto de la visita, motivos. Sin DOM, sin red. |
| `amplify/data/resource.ts` *(modificar)* | Modelo `TallerPartida` + 4 columnas nuevas en `Taller` + grant IAM al Lambda del portal. |
| `amplify/functions/taller-portal/resource.ts` *(crear)* | Declaración del Lambda y su secreto. |
| `amplify/functions/taller-portal/token.ts` *(crear)* | Firmar y verificar el token de la liga. Módulo puro, testeable sin AWS. |
| `amplify/functions/taller-portal/handler.ts` *(crear)* | Rutas del portal: GET visita, POST partida, POST datos de la camioneta, POST url de subida. |
| `amplify/functions/taller-portal/pagina.ts` *(crear)* | El HTML autocontenido que ve el proveedor, como plantilla de string. |
| `amplify/backend.ts` *(modificar)* | Function URL, permisos de S3 y variables de entorno del portal. |
| `src/api/cloudHydrate.ts` *(modificar)* | Cargar `TallerPartida` y sellar el área de Taller desde el catálogo. |
| `src/api/tallerPartidas.ts` *(crear)* | Lectura y escritura de partidas desde la app (AppSync). Separado de `batchUpload.ts`, que ya es grande. |
| `Control de flotilla.html` *(modificar)* | Bandeja de firmas, botón de liga, badge, y el área/subtotal del modal. |
| `src/taller/exportExcel.ts` *(modificar)* | Columnas de cotizado/autorizado/rechazado y el desglose real Ref/MO. |

---

### Task 1: El área deja de perderse

Arreglo independiente: se puede entregar y desplegar solo, sin nada del resto del plan. Hoy el autocompletado del modal de taller **sí** intenta poner el área, pero falla en silencio porque el catálogo de flota guarda `Logística` (con acento) y el menú de Taller solo acepta `LOGISTICA` (mayúsculas, sin acento). Asignar a un `<select>` un valor que no está entre sus opciones lo deja vacío, sin error.

**Files:**
- Modify: `src/taller/types.ts`
- Modify: `src/api/cloudHydrate.ts` (hidratación de taller, cerca de la línea 649)
- Modify: `Control de flotilla.html:1307-1316` (`#tf-area`) y `:643-650` (`#tl-filt-area`)
- Test: `tests/tallerArea.test.ts` *(crear)*

**Interfaces:**
- Consumes: nada.
- Produces: `AREAS_CANONICAS: readonly string[]`, `normalizeArea(v: unknown): string` — devuelve la grafía canónica, o `""` si no reconoce el valor.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tallerArea.test.ts
import { describe, it, expect } from "vitest";
import { AREAS_CANONICAS, normalizeArea } from "../src/taller/types";

describe("normalizeArea — una sola grafía para Taller y el catálogo", () => {
  it("traduce la grafía vieja de Taller (mayúsculas sin acento)", () => {
    expect(normalizeArea("LOGISTICA")).toBe("Logística");
    expect(normalizeArea("SERVICIO TECNICO")).toBe("Servicio Técnico");
    expect(normalizeArea("ALMACEN")).toBe("Almacén");
    expect(normalizeArea("ADMINISTRACION")).toBe("Administración");
    expect(normalizeArea("MANTENIMIENTO")).toBe("Mantenimiento");
  });

  it("deja pasar la grafía del catálogo sin tocarla", () => {
    for (const a of AREAS_CANONICAS) expect(normalizeArea(a)).toBe(a);
  });

  it("tolera espacios, minúsculas y acentos faltantes", () => {
    expect(normalizeArea("  logistica ")).toBe("Logística");
    expect(normalizeArea("Servicio tecnico")).toBe("Servicio Técnico");
  });

  it("devuelve cadena vacía para lo que no reconoce, nunca inventa", () => {
    expect(normalizeArea("VENTAS")).toBe("");
    expect(normalizeArea("")).toBe("");
    expect(normalizeArea(undefined)).toBe("");
    expect(normalizeArea(null)).toBe("");
  });

  it("expone exactamente las cinco áreas del catálogo", () => {
    expect(AREAS_CANONICAS).toEqual([
      "Logística",
      "Almacén",
      "Servicio Técnico",
      "Mantenimiento",
      "Administración",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tallerArea.test.ts`
Expected: FAIL — `normalizeArea is not a function` / no export named `AREAS_CANONICAS`.

- [ ] **Step 3: Write minimal implementation**

Agregar al final de `src/taller/types.ts`:

```ts
/** Áreas operativas canónicas. Fuente de verdad: el catálogo de unidades
 *  (`#cf-area` en el monolito). Taller usaba MAYÚSCULAS SIN ACENTO, lo que
 *  hacía que el autocompletado dejara el select vacío en silencio. */
export const AREAS_CANONICAS = [
  "Logística",
  "Almacén",
  "Servicio Técnico",
  "Mantenimiento",
  "Administración",
] as const;

function sinAcentos(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

const AREA_INDEX = new Map<string, string>(
  AREAS_CANONICAS.map((a) => [sinAcentos(a), a]),
);

/** Devuelve la grafía canónica del área, o "" si el valor no corresponde a
 *  ninguna de las cinco. Nunca inventa un área. */
export function normalizeArea(v: unknown): string {
  if (v === null || v === undefined) return "";
  return AREA_INDEX.get(sinAcentos(String(v))) ?? "";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tallerArea.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Sellar el área desde el catálogo al hidratar**

En `src/api/cloudHydrate.ts`, la hidratación de taller construye la entry con `area: String(datos.area ?? "")` (cerca de la línea 649). El mapa `unidadPorEco` —que ya resuelve exactamente este problema para Combustible— se arma más abajo en el mismo archivo (cerca de la línea 741) y se consume en `src/fuel/mapEntry.ts:272`.

Dos cambios:

1. Importar el normalizador arriba del archivo:

```ts
import { normalizeArea } from "../taller/types";
```

2. En la construcción de la entry de taller, reemplazar la línea del área por:

```ts
        // El área SIEMPRE sale del catálogo de la unidad (misma fuente que
        // Combustible); lo capturado a mano queda como respaldo normalizado.
        area: normalizeArea(unidadPorEco.get(String(datos.eco ?? "").trim())?.area)
          || normalizeArea(datos.area),
```

**Importante:** `unidadPorEco` hoy se construye *después* de la hidratación de taller en ese archivo. Mover su construcción **antes** del bloque de taller (no cambiar su lógica, solo su posición), y verificar que Combustible siga recibiendo el mismo mapa.

- [ ] **Step 6: Unificar la grafía en el monolito**

En `Control de flotilla.html`, el `<select id="tf-area">` (línea ~1307) — reemplazar sus cinco `<option>` por:

```html
          <option value="">— Sin area —</option>
          <option value="Logística">Logística</option>
          <option value="Almacén">Almacén</option>
          <option value="Servicio Técnico">Servicio Técnico</option>
          <option value="Mantenimiento">Mantenimiento</option>
          <option value="Administración">Administración</option>
```

Y el filtro `<select id="tl-filt-area">` (línea ~643) — mismos `value`, conservando `<option value="all">Todas las áreas</option>` como primera opción.

- [ ] **Step 7: Verificar y commitear**

Run: `npm run test:run && npm run typecheck && npm run lint`
Expected: todo verde. Si algún test que no tocaste falla, valida A/B contra `origin/main` antes de asumir que es tuyo — hay un test flaky preexistente en `tests/fuelOpsGuardHandlers.test.ts` bajo carga.

```bash
git branch --show-current   # debe decir feat/taller-esquema-hibrido
git add src/taller/types.ts src/api/cloudHydrate.ts "Control de flotilla.html" tests/tallerArea.test.ts
git commit -m "fix(taller): el area no se llenaba — dos catalogos con grafia distinta

El autocompletado del modal si intentaba ponerla, pero el select de Taller
solo aceptaba MAYUSCULAS SIN ACENTO y el catalogo guarda 'Logistica' con
acento: asignar un valor ausente deja el select vacio, sin error. Ahora el
area sale del mismo mapa unidadPorEco que ya usa Combustible.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: El modelo de datos

Las partidas van como registros propios, **no** dentro del blob `datos` de `Taller`: el proveedor escribe desde el taller al mismo tiempo que Riesgos tiene el registro abierto, y un blob JSON se lee-modifica-escribe completo, así que dos escritores concurrentes hacen que el último gane y las partidas del otro desaparezcan sin aviso.

Por la misma razón, los cuatro campos que escribe el proveedor se promueven de `datos` a **columnas reales**: DynamoDB las actualiza independientes.

**Files:**
- Modify: `amplify/data/resource.ts` (modelo `Taller` cerca de la línea 66; grants de schema cerca de la línea 481)
- Test: `tests/tallerPartidaSchema.test.ts` *(crear)*

**Interfaces:**
- Consumes: nada.
- Produces: modelo `TallerPartida` con identifier `["tenantId","visitaKey","partidaId"]`; columnas `km`, `estadoOperativo`, `fsalidaEst`, `fsalidaEstCompromiso` en `Taller`.

- [ ] **Step 1: Write the failing test**

Este test no habla con AWS: valida que el schema **declara** lo que el resto del plan asume, para que un cambio accidental en `resource.ts` se atrape en CI.

```ts
// tests/tallerPartidaSchema.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const schema = readFileSync("amplify/data/resource.ts", "utf8");

describe("schema — TallerPartida y las columnas nuevas de Taller", () => {
  it("declara el modelo TallerPartida", () => {
    expect(schema).toContain("TallerPartida: a");
  });

  it("usa la llave natural (tenantId, visitaKey, partidaId)", () => {
    expect(schema).toMatch(/identifier\(\["tenantId", ?"visitaKey", ?"partidaId"\]\)/);
  });

  it("declara los seis estados de partida", () => {
    for (const e of [
      "borrador",
      "propuesta",
      "autorizada",
      "rechazada",
      "terminada",
      "cancelada",
    ]) {
      expect(schema).toContain(`"${e}"`);
    }
  });

  it("promueve a columnas los cuatro campos que escribe el proveedor", () => {
    for (const c of ["km:", "estadoOperativo:", "fsalidaEst:", "fsalidaEstCompromiso:"]) {
      expect(schema).toContain(c);
    }
  });

  it("declara los cuatro estados operativos", () => {
    for (const e of ["revisando", "reparando", "esperandoRefaccion", "lista"]) {
      expect(schema).toContain(`"${e}"`);
    }
  });

  it("viewer no escribe partidas: la escritura es de operativo y admin", () => {
    const bloque = schema.slice(schema.indexOf("TallerPartida: a"));
    expect(bloque).toContain('allow.groupDefinedIn("tenantId").to(["read"])');
    expect(bloque).toContain('allow.group("operativo")');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tallerPartidaSchema.test.ts`
Expected: FAIL — no encuentra `TallerPartida: a`.

- [ ] **Step 3: Agregar las columnas a `Taller`**

En `amplify/data/resource.ts`, dentro del modelo `Taller`, **antes** de `datos: a.json()`:

```ts
        // Promovidos de `datos` a columnas (2026-09-08): los escribe el
        // PROVEEDOR desde la liga mientras Riesgos puede tener el registro
        // abierto. Como columnas, DynamoDB las actualiza independientes; dentro
        // del blob `datos` un escritor pisaría al otro sin aviso.
        // Migración: leer la columna y, si viene vacía, caer a `datos.<campo>`.
        km: a.integer(),
        estadoOperativo: a.enum(["revisando", "reparando", "esperandoRefaccion", "lista"]),
        fsalidaEst: a.string(),
        /** Primera fecha prometida. Se escribe UNA sola vez: es contra esta que
         *  se mide el incumplimiento, así que el taller no la puede reescribir. */
        fsalidaEstCompromiso: a.string(),
```

- [ ] **Step 4: Agregar el modelo `TallerPartida`**

En el mismo archivo, inmediatamente después del modelo `Taller`:

```ts
    /**
     * Una partida = un hallazgo cotizado por el proveedor: su evidencia, su
     * precio y su propia decisión de autorización.
     *
     * `visitaKey` = `${unitUid}|${fechaEntrada}` — empata con la llave natural
     * de `Taller` y con la que compone `tallerCloudKey()` en
     * src/api/batchUpload.ts.
     *
     * `descripcion` la escribe un TERCERO NO AUTENTICADO (el taller, desde la
     * liga). Nunca pintarla con innerHTML.
     */
    TallerPartida: a
      .model({
        tenantId: a.string().required(),
        visitaKey: a.string().required(),
        partidaId: a.string().required(),

        descripcion: a.string().required(),
        tipo: a.enum(["refaccion", "manoObra"]),
        /** Sin IVA. */
        precio: a.float(),
        estado: a.enum([
          "borrador",
          "propuesta",
          "autorizada",
          "rechazada",
          "terminada",
          "cancelada",
        ]),
        motivoRechazo: a.string(),
        /** Solo cuando el motivo es "Otro". Es lo que dice qué opción falta
         *  en el menú (decisión 19 del spec). */
        motivoRechazoNota: a.string(),
        fotos: a.string().array(),
        evidenciaFinal: a.string().array(),
        /** Congelado en el momento de la firma: se autoriza un precio, no una idea. */
        precioAutorizado: a.float(),
        /** partidaId de la partida que se está recotizando (Plan 2). */
        recotizaDe: a.string(),
        /** Quién cotizó ESTA partida; puede diferir del proveedor de la visita. */
        proveedorNombre: a.string(),
        /** "liga:<hash8>" | "user:<sub>" */
        creadoPor: a.string(),
        creadoEn: a.string(),
        propuestoEn: a.string(),
        decididoEn: a.string(),
        decididoPor: a.string(),
        terminadoEn: a.string(),
        version: a.integer().default(1),
      })
      .identifier(["tenantId", "visitaKey", "partidaId"])
      .authorization((allow) => [
        // Lectura aislada por tenant (incluye viewer). Escritura operativo/admin;
        // el Lambda del portal escribe por IAM vía el grant de schema, abajo.
        allow.groupDefinedIn("tenantId").to(["read"]),
        allow.group("operativo").to(["create", "update", "delete"]),
        allow.group("admin"),
      ])
      .secondaryIndexes((index) => [
        // Para contar lo pendiente de firma sin recorrer toda la tabla.
        index("tenantId").sortKeys(["estado"]).name("byTenantAndEstado"),
      ]),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/tallerPartidaSchema.test.ts && npm run typecheck`
Expected: PASS (6 tests) y typecheck limpio.

- [ ] **Step 6: Commit**

```bash
git branch --show-current
git add amplify/data/resource.ts tests/tallerPartidaSchema.test.ts
git commit -m "feat(taller): modelo TallerPartida y columnas del proveedor

Las partidas van como registros propios y no dentro del blob \`datos\`: el
proveedor escribe desde el taller al mismo tiempo que Riesgos tiene el
registro abierto, y un blob JSON se lee-modifica-escribe completo (el ultimo
en guardar borra las partidas del otro). Por lo mismo, km/estadoOperativo/
fsalidaEst/fsalidaEstCompromiso se promueven a columnas.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: La lógica pura de partidas

Todo lo que decide qué se puede hacer con una partida y cuánto suma una visita. Sin DOM y sin red, para que se pueda probar de verdad — el monolito la consume.

**Files:**
- Create: `src/taller/partidas.ts`
- Test: `tests/tallerPartidas.test.ts` *(crear)*

**Interfaces:**
- Consumes: `TallerEstado`, `TallerEntry` de `src/taller/types.ts`.
- Produces:
  - `type PartidaEstado = "borrador"|"propuesta"|"autorizada"|"rechazada"|"terminada"|"cancelada"`
  - `type PartidaTipo = "refaccion"|"manoObra"`
  - `type Partida` (forma en cliente)
  - `MOTIVOS_RECHAZO: readonly string[]`
  - `esEditablePorProveedor(p: Partida): boolean`
  - `puedeCancelar(p: Partida, actor: "proveedor"|"riesgos"): boolean`
  - `autorizar(p: Partida, quien: string, cuando: string): Partida`
  - `rechazar(p: Partida, motivo: string, nota: string | undefined, quien: string, cuando: string): Partida`
  - `totalesVisita(ps: Partida[]): TotalesVisita`
  - `pendientesDeFirma(ps: Partida[]): number`
  - `estadoCompuesto(entry, ps): TallerEstado`

- [ ] **Step 1: Write the failing test**

```ts
// tests/tallerPartidas.test.ts
import { describe, it, expect } from "vitest";
import {
  MOTIVOS_RECHAZO,
  autorizar,
  esEditablePorProveedor,
  estadoCompuesto,
  pendientesDeFirma,
  puedeCancelar,
  rechazar,
  totalesVisita,
  type Partida,
} from "../src/taller/partidas";

const P = (o: Partial<Partida> = {}): Partida => ({
  partidaId: "p1",
  visitaKey: "JV98698|2026-09-01",
  descripcion: "Balatas delanteras",
  tipo: "refaccion",
  precio: 1850,
  estado: "borrador",
  fotos: [],
  ...o,
});

describe("editabilidad — una partida enviada se congela", () => {
  it("el proveedor edita solo en borrador", () => {
    expect(esEditablePorProveedor(P({ estado: "borrador" }))).toBe(true);
    for (const e of ["propuesta", "autorizada", "rechazada", "terminada", "cancelada"] as const) {
      expect(esEditablePorProveedor(P({ estado: e }))).toBe(false);
    }
  });

  it("el proveedor cancela mientras no haya firma; después solo Riesgos", () => {
    expect(puedeCancelar(P({ estado: "borrador" }), "proveedor")).toBe(true);
    expect(puedeCancelar(P({ estado: "propuesta" }), "proveedor")).toBe(true);
    expect(puedeCancelar(P({ estado: "autorizada" }), "proveedor")).toBe(false);
    expect(puedeCancelar(P({ estado: "autorizada" }), "riesgos")).toBe(true);
    expect(puedeCancelar(P({ estado: "cancelada" }), "riesgos")).toBe(false);
  });
});

describe("firma — se autoriza un precio, no una idea", () => {
  it("congela el precio autorizado y registra quién y cuándo", () => {
    const r = autorizar(P({ estado: "propuesta", precio: 1850 }), "user:abc", "2026-09-03T10:00:00Z");
    expect(r.estado).toBe("autorizada");
    expect(r.precioAutorizado).toBe(1850);
    expect(r.decididoPor).toBe("user:abc");
    expect(r.decididoEn).toBe("2026-09-03T10:00:00Z");
  });

  it("no autoriza un borrador que nunca se envió", () => {
    expect(() => autorizar(P({ estado: "borrador" }), "user:abc", "2026-09-03T10:00:00Z")).toThrow();
  });

  it("rechazar exige un motivo del menú cerrado", () => {
    const r = rechazar(P({ estado: "propuesta" }), "No es necesario ahora", undefined, "user:abc", "x");
    expect(r.estado).toBe("rechazada");
    expect(r.motivoRechazo).toBe("No es necesario ahora");
    expect(r.precioAutorizado).toBeUndefined();
    expect(() => rechazar(P({ estado: "propuesta" }), "porque no", undefined, "u", "x")).toThrow();
  });

  it('"Otro" exige la nota — es lo que dice qué opción falta en el menú', () => {
    expect(() => rechazar(P({ estado: "propuesta" }), "Otro", "   ", "u", "x")).toThrow();
    const r = rechazar(P({ estado: "propuesta" }), "Otro", "La unidad se da de baja", "u", "x");
    expect(r.motivoRechazoNota).toBe("La unidad se da de baja");
  });

  it("los cinco motivos son exactamente los del spec", () => {
    expect(MOTIVOS_RECHAZO).toEqual([
      "No es necesario ahora",
      "Precio alto — recotizar",
      "Se repara en otro lado",
      "No corresponde a esta unidad",
      "Otro",
    ]);
  });
});

describe("totales — el gasto es la suma de lo firmado", () => {
  const ps = [
    P({ partidaId: "a", estado: "autorizada", precio: 1850, precioAutorizado: 1850, tipo: "refaccion" }),
    P({ partidaId: "b", estado: "autorizada", precio: 2400, precioAutorizado: 2400, tipo: "manoObra" }),
    P({ partidaId: "c", estado: "rechazada", precio: 980, tipo: "refaccion" }),
    P({ partidaId: "d", estado: "propuesta", precio: 500, tipo: "refaccion" }),
    P({ partidaId: "e", estado: "borrador", precio: 9999, tipo: "refaccion" }),
    P({ partidaId: "f", estado: "cancelada", precio: 7777, tipo: "refaccion" }),
  ];

  it("autorizado usa el precio congelado, no el capturado", () => {
    const t = totalesVisita([
      P({ estado: "autorizada", precio: 9999, precioAutorizado: 1850, tipo: "refaccion" }),
    ]);
    expect(t.autorizado).toBe(1850);
  });

  it("cotizado cuenta lo propuesto y lo ya decidido, nunca borradores ni canceladas", () => {
    const t = totalesVisita(ps);
    expect(t.cotizado).toBe(1850 + 2400 + 980 + 500);
    expect(t.autorizado).toBe(1850 + 2400);
    expect(t.rechazado).toBe(980);
  });

  it("el desglose Ref/MO sale solo — hoy el Excel reporta $0 en el 100%", () => {
    const t = totalesVisita(ps);
    expect(t.gastoRef).toBe(1850);
    expect(t.gastoMO).toBe(2400);
    expect(t.gastoRef + t.gastoMO).toBe(t.autorizado);
  });

  it("una visita sin partidas da ceros, no NaN", () => {
    const t = totalesVisita([]);
    expect(t).toEqual({ cotizado: 0, autorizado: 0, rechazado: 0, gastoRef: 0, gastoMO: 0 });
  });

  it("cuenta lo que espera firma", () => {
    expect(pendientesDeFirma(ps)).toBe(1);
    expect(pendientesDeFirma([])).toBe(0);
  });
});

describe("estado compuesto — el estado de la visita no puede mentir", () => {
  const base = { estado: "En Diagnóstico" as const, estadoOperativo: "reparando" as const };

  it("si hay partidas esperando firma, gana Cotización", () => {
    expect(estadoCompuesto(base, [P({ estado: "propuesta" })])).toBe("Cotización");
  });

  it("sin pendientes, refleja lo que el taller está haciendo", () => {
    expect(estadoCompuesto({ ...base, estadoOperativo: "revisando" }, [])).toBe("En Diagnóstico");
    expect(estadoCompuesto({ ...base, estadoOperativo: "reparando" }, [])).toBe("En Reparación");
    expect(estadoCompuesto({ ...base, estadoOperativo: "esperandoRefaccion" }, [])).toBe("En Reparación");
    expect(estadoCompuesto({ ...base, estadoOperativo: "lista" }, [])).toBe("Por recuperar");
  });

  it("Finalizado gana sobre todo, incluso con pendientes", () => {
    expect(estadoCompuesto({ estado: "Finalizado" }, [P({ estado: "propuesta" })])).toBe("Finalizado");
  });

  it("una visita vieja sin estadoOperativo conserva su estado capturado", () => {
    expect(estadoCompuesto({ estado: "Por recuperar" }, [])).toBe("Por recuperar");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tallerPartidas.test.ts`
Expected: FAIL — `Cannot find module '../src/taller/partidas'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/taller/partidas.ts
// Lógica pura de partidas de taller: qué se puede hacer con cada una y cuánto
// suma una visita. Sin DOM, sin red — el monolito la consume.

import type { TallerEstado } from "./types";

export type PartidaEstado =
  | "borrador"
  | "propuesta"
  | "autorizada"
  | "rechazada"
  | "terminada"
  | "cancelada";

export type PartidaTipo = "refaccion" | "manoObra";

export type EstadoOperativo = "revisando" | "reparando" | "esperandoRefaccion" | "lista";

export type Partida = {
  partidaId: string;
  visitaKey: string;
  /** La escribe un tercero NO autenticado. Nunca pintarla con innerHTML. */
  descripcion: string;
  tipo?: PartidaTipo;
  /** Sin IVA. */
  precio?: number;
  estado: PartidaEstado;
  motivoRechazo?: string;
  motivoRechazoNota?: string;
  fotos: string[];
  /** Congelado al firmar. */
  precioAutorizado?: number;
  recotizaDe?: string;
  proveedorNombre?: string;
  creadoPor?: string;
  creadoEn?: string;
  propuestoEn?: string;
  decididoEn?: string;
  decididoPor?: string;
  terminadoEn?: string;
};

/** Menú CERRADO. Un campo libre no se llena: en combustible, 0 de 6 rechazos
 *  traían motivo escrito. El orden es el que ve el usuario. */
export const MOTIVOS_RECHAZO = [
  "No es necesario ahora",
  "Precio alto — recotizar",
  "Se repara en otro lado",
  "No corresponde a esta unidad",
  "Otro",
] as const;

/** Una partida enviada se congela: si el proveedor pudiera cambiar el precio
 *  después de la firma, la autorización no valdría nada. */
export function esEditablePorProveedor(p: Partida): boolean {
  return p.estado === "borrador";
}

export function puedeCancelar(p: Partida, actor: "proveedor" | "riesgos"): boolean {
  if (p.estado === "cancelada" || p.estado === "terminada") return false;
  if (actor === "proveedor") return p.estado === "borrador" || p.estado === "propuesta";
  return true;
}

export function autorizar(p: Partida, quien: string, cuando: string): Partida {
  if (p.estado !== "propuesta") {
    throw new Error(`No se puede autorizar una partida en estado "${p.estado}"`);
  }
  return {
    ...p,
    estado: "autorizada",
    // Se autoriza un PRECIO: queda congelado aquí.
    precioAutorizado: p.precio ?? 0,
    decididoPor: quien,
    decididoEn: cuando,
  };
}

export function rechazar(
  p: Partida,
  motivo: string,
  nota: string | undefined,
  quien: string,
  cuando: string,
): Partida {
  if (p.estado !== "propuesta") {
    throw new Error(`No se puede rechazar una partida en estado "${p.estado}"`);
  }
  if (!(MOTIVOS_RECHAZO as readonly string[]).includes(motivo)) {
    throw new Error(`Motivo de rechazo no válido: "${motivo}"`);
  }
  const limpia = (nota ?? "").trim();
  if (motivo === "Otro" && !limpia) {
    throw new Error('El motivo "Otro" exige una nota');
  }
  return {
    ...p,
    estado: "rechazada",
    motivoRechazo: motivo,
    motivoRechazoNota: motivo === "Otro" ? limpia : undefined,
    decididoPor: quien,
    decididoEn: cuando,
  };
}

export type TotalesVisita = {
  cotizado: number;
  autorizado: number;
  rechazado: number;
  gastoRef: number;
  gastoMO: number;
};

/** El gasto de la visita NO se captura: es la suma de lo firmado. Y de aquí
 *  sale el desglose Ref/MO que hoy el Excel reporta en $0 en el 100%. */
export function totalesVisita(ps: Partida[]): TotalesVisita {
  const t: TotalesVisita = { cotizado: 0, autorizado: 0, rechazado: 0, gastoRef: 0, gastoMO: 0 };
  for (const p of ps) {
    if (p.estado === "borrador" || p.estado === "cancelada") continue;
    const cotizado = p.precio ?? 0;
    t.cotizado += cotizado;
    if (p.estado === "rechazada") {
      t.rechazado += cotizado;
      continue;
    }
    if (p.estado === "autorizada" || p.estado === "terminada") {
      const firmado = p.precioAutorizado ?? 0;
      t.autorizado += firmado;
      if (p.tipo === "manoObra") t.gastoMO += firmado;
      else t.gastoRef += firmado;
    }
  }
  return t;
}

export function pendientesDeFirma(ps: Partida[]): number {
  return ps.reduce((n, p) => (p.estado === "propuesta" ? n + 1 : n), 0);
}

const OPERATIVO_A_ESTADO: Record<EstadoOperativo, TallerEstado> = {
  revisando: "En Diagnóstico",
  reparando: "En Reparación",
  esperandoRefaccion: "En Reparación",
  lista: "Por recuperar",
};

/**
 * El `estado` que pinta la tabla y alimenta los filtros se COMPONE, para que no
 * pueda mentir: si hay partidas esperando firma es "Cotización" (eso es lo
 * urgente para Riesgos y el taller no lo puede apagar); si no, refleja lo que
 * el taller declaró estar haciendo. "Finalizado" gana sobre todo — el cierre
 * del gasto no lo firma el proveedor.
 */
export function estadoCompuesto(
  visita: { estado: TallerEstado; estadoOperativo?: EstadoOperativo },
  ps: Partida[],
): TallerEstado {
  if (visita.estado === "Finalizado") return "Finalizado";
  if (pendientesDeFirma(ps) > 0) return "Cotización";
  if (visita.estadoOperativo) return OPERATIVO_A_ESTADO[visita.estadoOperativo];
  return visita.estado;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tallerPartidas.test.ts && npm run typecheck`
Expected: PASS (14 tests) y typecheck limpio.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add src/taller/partidas.ts tests/tallerPartidas.test.ts
git commit -m "feat(taller): logica pura de partidas — transiciones, totales y estado compuesto

Tres reglas que hacen que la firma valga algo: la partida enviada se congela,
se autoriza un precio (no una idea) y el estado de la visita se compone en vez
de capturarse, para que no pueda ocultar lo pendiente de firma.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: El token de la liga

La liga es la única superficie sin autenticar del sistema, y el repo es público. La autenticación **es** la firma: sin el secreto configurado, todo request responde 401 (patrón `opsgpa-receptor`). El token no se guarda en la base: se valida por firma, y se revoca subiendo `ligaVersion` en el registro de la visita.

**Files:**
- Create: `amplify/functions/taller-portal/token.ts`
- Test: `tests/tallerPortalToken.test.ts` *(crear)*

**Interfaces:**
- Consumes: nada (solo `node:crypto`).
- Produces:
  - `type PortalToken = { t: string; u: string; f: string; v: number; exp: number; p?: string }`
  - `firmarToken(payload: PortalToken, secreto: string): string`
  - `verificarToken(token: string, secreto: string, ahora?: number): PortalToken` — lanza `ErrorToken` con `.motivo` en todo caso inválido.
  - `class ErrorToken extends Error { motivo: MotivoToken }`
  - `type MotivoToken = "sin-secreto"|"malformado"|"firma-invalida"|"expirado"|"alcance-no-soportado"`
  - `VIGENCIA_LIGA_MS = 90 * 24 * 60 * 60 * 1000`

- [ ] **Step 1: Write the failing test**

```ts
// tests/tallerPortalToken.test.ts
import { describe, it, expect } from "vitest";
import {
  ErrorToken,
  VIGENCIA_LIGA_MS,
  firmarToken,
  verificarToken,
  type PortalToken,
} from "../amplify/functions/taller-portal/token";

const SECRETO = "secreto-de-prueba-no-real";
const AHORA = Date.parse("2026-09-08T12:00:00Z");

const payload = (o: Partial<PortalToken> = {}): PortalToken => ({
  t: "gpa",
  u: "JV98698",
  f: "2026-09-01",
  v: 1,
  exp: AHORA + VIGENCIA_LIGA_MS,
  ...o,
});

function motivo(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof ErrorToken ? e.motivo : `otro:${String(e)}`;
  }
  return "no-lanzo";
}

describe("token de la liga", () => {
  it("ida y vuelta: lo firmado se verifica", () => {
    const t = firmarToken(payload(), SECRETO);
    expect(verificarToken(t, SECRETO, AHORA)).toEqual(payload());
  });

  it("FAIL-CLOSED: sin secreto no valida nada, ni un token bien firmado", () => {
    const t = firmarToken(payload(), SECRETO);
    expect(motivo(() => verificarToken(t, "", AHORA))).toBe("sin-secreto");
    expect(motivo(() => firmarToken(payload(), ""))).toBe("sin-secreto");
  });

  it("rechaza firma ajena — el payload no manda solo", () => {
    const t = firmarToken(payload(), "otro-secreto");
    expect(motivo(() => verificarToken(t, SECRETO, AHORA))).toBe("firma-invalida");
  });

  it("rechaza un payload manipulado aunque conserve la firma original", () => {
    const t = firmarToken(payload(), SECRETO);
    const [cuerpo, firma] = t.split(".");
    const alterado = Buffer.from(
      JSON.stringify({ ...payload(), u: "OTRA-PLACA" }),
      "utf8",
    ).toString("base64url");
    expect(motivo(() => verificarToken(`${alterado}.${firma}`, SECRETO, AHORA))).toBe(
      "firma-invalida",
    );
    expect(cuerpo).not.toBe(alterado);
  });

  it("rechaza basura y formas raras", () => {
    for (const malo of ["", "sinpunto", "a.b.c", "....", "x."]) {
      expect(motivo(() => verificarToken(malo, SECRETO, AHORA))).toMatch(
        /malformado|firma-invalida/,
      );
    }
  });

  it("rechaza expirado", () => {
    const t = firmarToken(payload({ exp: AHORA - 1000 }), SECRETO);
    expect(motivo(() => verificarToken(t, SECRETO, AHORA))).toBe("expirado");
  });

  it("el Plan 1 no soporta alcance por partida: lo rechaza en vez de ignorarlo", () => {
    const t = firmarToken(payload({ p: "p1" }), SECRETO);
    expect(motivo(() => verificarToken(t, SECRETO, AHORA))).toBe("alcance-no-soportado");
  });

  it("la vigencia por defecto son 90 días", () => {
    expect(VIGENCIA_LIGA_MS).toBe(90 * 24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tallerPortalToken.test.ts`
Expected: FAIL — `Cannot find module '../amplify/functions/taller-portal/token'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// amplify/functions/taller-portal/token.ts
// Token de la liga del proveedor. La AUTENTICACIÓN ES LA FIRMA: sin secreto
// configurado no se valida nada (fail-closed, igual que opsgpa-receptor).
// El token NO se guarda en la base: se verifica por firma y se revoca subiendo
// `ligaVersion` en el registro de la visita.

import { createHmac, timingSafeEqual } from "node:crypto";

export const VIGENCIA_LIGA_MS = 90 * 24 * 60 * 60 * 1000;

export type PortalToken = {
  /** tenantId */
  t: string;
  /** unitUid */
  u: string;
  /** fechaEntrada */
  f: string;
  /** ligaVersion — subirla en la visita revoca todos los tokens anteriores */
  v: number;
  /** epoch ms */
  exp: number;
  /** partidaId: alcance de recotización. Plan 2. */
  p?: string;
};

export type MotivoToken =
  | "sin-secreto"
  | "malformado"
  | "firma-invalida"
  | "expirado"
  | "alcance-no-soportado";

export class ErrorToken extends Error {
  motivo: MotivoToken;
  constructor(motivo: MotivoToken) {
    super(`Token inválido: ${motivo}`);
    this.name = "ErrorToken";
    this.motivo = motivo;
  }
}

function firma(cuerpo: string, secreto: string): string {
  return createHmac("sha256", secreto).update(cuerpo).digest("base64url");
}

export function firmarToken(payload: PortalToken, secreto: string): string {
  if (!secreto) throw new ErrorToken("sin-secreto");
  const cuerpo = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${cuerpo}.${firma(cuerpo, secreto)}`;
}

export function verificarToken(
  token: string,
  secreto: string,
  ahora: number = Date.now(),
): PortalToken {
  if (!secreto) throw new ErrorToken("sin-secreto");

  const partes = String(token || "").split(".");
  if (partes.length !== 2 || !partes[0] || !partes[1]) throw new ErrorToken("malformado");
  const [cuerpo, dada] = partes;

  const esperada = firma(cuerpo, secreto);
  const a = Buffer.from(dada, "utf8");
  const b = Buffer.from(esperada, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ErrorToken("firma-invalida");

  let payload: PortalToken;
  try {
    payload = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8")) as PortalToken;
  } catch {
    throw new ErrorToken("malformado");
  }

  if (!payload || typeof payload !== "object" || !payload.t || !payload.u || !payload.f) {
    throw new ErrorToken("malformado");
  }
  if (typeof payload.exp !== "number" || payload.exp <= ahora) throw new ErrorToken("expirado");
  // El alcance por partida (recotización) llega en el Plan 2. Rechazarlo
  // explícitamente es más seguro que ignorar el campo y servir la visita completa.
  if (payload.p) throw new ErrorToken("alcance-no-soportado");

  return payload;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tallerPortalToken.test.ts && npm run typecheck`
Expected: PASS (8 tests).

- [ ] **Step 5: Declarar el Lambda y su secreto**

Create `amplify/functions/taller-portal/resource.ts`:

```ts
import { defineFunction, secret } from "@aws-amplify/backend";

/**
 * Portal del proveedor de taller. Sirve la página que ve el taller y recibe sus
 * escrituras (partidas, precios, km, estado, fecha). No hay cuentas: la
 * autenticación es la firma HMAC del token de la liga.
 *
 * Fail-closed: sin TALLER_PORTAL_SECRET configurado, todo request responde 401.
 *   sandbox: npx ampx sandbox secret set TALLER_PORTAL_SECRET
 *   branch:  Amplify console → Secrets (mismo nombre)
 */
export const tallerPortal = defineFunction({
  name: "taller-portal",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  environment: {
    TALLER_PORTAL_SECRET: secret("TALLER_PORTAL_SECRET"),
    TALLER_TENANT_ID: "gpa",
  },
});
```

- [ ] **Step 6: Commit**

```bash
git branch --show-current
git add amplify/functions/taller-portal/token.ts amplify/functions/taller-portal/resource.ts tests/tallerPortalToken.test.ts
git commit -m "feat(taller): token firmado de la liga del proveedor, fail-closed

La liga es la unica superficie sin autenticar del sistema y el repo es publico:
la autenticacion ES la firma HMAC, sin secreto configurado no pasa nada. El
token no se guarda en la base (se verifica por firma) y se revoca subiendo
ligaVersion. El alcance por partida se rechaza explicitamente hasta el Plan 2.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: El portal — leer la visita y recibir partidas

El handler toma `tenantId`/`unitUid`/`fechaEntrada` **del token**, nunca del body. No existe ningún endpoint que liste ni busque: quien tenga una liga no puede ver otra unidad ni el resto de la flota.

**Files:**
- Create: `amplify/functions/taller-portal/handler.ts`
- Modify: `amplify/data/resource.ts` (grant de schema, cerca de la línea 481)
- Modify: `amplify/backend.ts`
- Test: `tests/tallerPortalHandler.test.ts` *(crear)*

**Interfaces:**
- Consumes: `verificarToken`, `ErrorToken` de `./token`.
- Produces: `handler(event)` con las rutas `GET /?t=<token>` (página), `GET /api/visita?t=`, `POST /api/partida?t=`, `POST /api/visita?t=`, `POST /api/subida?t=`. Exporta además, para tests: `llaveFoto(tenantId, visitaKey, uuid, mime)`, `validarPartidaEntrante(body)`, `MIMES_FOTO`, `TOPE_FOTOS_PARTIDA`, `TOPE_PARTIDAS_VISITA`.

> ⚠️ **La Function URL de este Lambda es pública** (`authType: NONE`) y solo la protege la firma del token. Por eso **aquí no existe ninguna ruta que EMITA ligas**: si la emisión viviera en esta URL, cualquiera en internet podría acuñar una liga para cualquier unidad. La emisión va por una mutación de AppSync con permiso de grupo — Task 11.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tallerPortalHandler.test.ts
import { describe, it, expect } from "vitest";
import {
  MIMES_FOTO,
  TOPE_FOTOS_PARTIDA,
  TOPE_PARTIDAS_VISITA,
  llaveFoto,
  validarPartidaEntrante,
} from "../amplify/functions/taller-portal/handler";

describe("llaveFoto — la ruta la genera el SERVIDOR", () => {
  it("vive bajo el prefijo de partidas de taller, con el tenant primero", () => {
    const k = llaveFoto("gpa", "JV98698|2026-09-01", "abc123", "image/jpeg");
    expect(k).toBe("photos/gpa/taller-partidas/JV98698_2026-09-01/abc123.jpg");
  });

  it("no deja escapar del prefijo con ../ ni con barras en la visitaKey", () => {
    const k = llaveFoto("gpa", "../../otra|2026-01-01", "id", "image/png");
    expect(k.startsWith("photos/gpa/taller-partidas/")).toBe(true);
    expect(k).not.toContain("..");
    expect(k.split("/").length).toBe(5);
  });

  it("la extensión sale del mime permitido, no de lo que mande el cliente", () => {
    expect(llaveFoto("gpa", "v", "i", "image/webp").endsWith(".webp")).toBe(true);
    expect(() => llaveFoto("gpa", "v", "i", "application/pdf")).toThrow();
    expect(() => llaveFoto("gpa", "v", "i", "text/html")).toThrow();
  });

  it("solo tres mimes de imagen en el Plan 1", () => {
    expect(MIMES_FOTO).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });
});

describe("validarPartidaEntrante — el texto lo escribe un tercero", () => {
  const ok = { descripcion: "Balatas delanteras", tipo: "refaccion", precio: 1850 };

  it("acepta una partida bien formada", () => {
    expect(validarPartidaEntrante(ok)).toEqual({
      descripcion: "Balatas delanteras",
      tipo: "refaccion",
      precio: 1850,
    });
  });

  it("exige descripción no vacía y la recorta", () => {
    expect(() => validarPartidaEntrante({ ...ok, descripcion: "   " })).toThrow();
    expect(validarPartidaEntrante({ ...ok, descripcion: "  x  " }).descripcion).toBe("x");
  });

  it("acota la descripción — no es un canal para subir kilobytes", () => {
    const larga = "a".repeat(1000);
    expect(validarPartidaEntrante({ ...ok, descripcion: larga }).descripcion.length).toBe(500);
  });

  it("rechaza tipo fuera del enum", () => {
    expect(() => validarPartidaEntrante({ ...ok, tipo: "otro" })).toThrow();
  });

  it("rechaza precios negativos, no numéricos y absurdos", () => {
    expect(() => validarPartidaEntrante({ ...ok, precio: -1 })).toThrow();
    expect(() => validarPartidaEntrante({ ...ok, precio: "1850" })).toThrow();
    expect(() => validarPartidaEntrante({ ...ok, precio: NaN })).toThrow();
    expect(() => validarPartidaEntrante({ ...ok, precio: 1e12 })).toThrow();
  });

  it("no deja que el cliente decida el estado ni la autoría", () => {
    const r = validarPartidaEntrante({ ...ok, estado: "autorizada", creadoPor: "user:jefe" });
    expect("estado" in r).toBe(false);
    expect("creadoPor" in r).toBe(false);
  });

  it("los topes son los del spec", () => {
    expect(TOPE_FOTOS_PARTIDA).toBe(6);
    expect(TOPE_PARTIDAS_VISITA).toBe(60);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tallerPortalHandler.test.ts`
Expected: FAIL — módulo no encontrado.

- [ ] **Step 3: Write the handler**

```ts
// amplify/functions/taller-portal/handler.ts
// Portal del proveedor: sirve la página y recibe sus escrituras.
//
// Reglas que no se negocian:
// - tenantId/unitUid/fechaEntrada salen del TOKEN, nunca del body.
// - No hay endpoint que liste ni busque nada.
// - La llave de S3 la genera el servidor; el cliente nunca elige ruta.
// - Todo texto entrante se valida aquí, no solo en el navegador.

import { randomUUID } from "node:crypto";
import { ErrorToken, verificarToken, type PortalToken } from "./token";

export const MIMES_FOTO = ["image/jpeg", "image/png", "image/webp"] as const;
export const TOPE_FOTOS_PARTIDA = 6;
export const TOPE_PARTIDAS_VISITA = 60;
const LARGO_DESCRIPCION = 500;
const PRECIO_MAX = 10_000_000;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Un segmento seguro de ruta S3: sin barras, sin puntos dobles, acotado. */
function segmento(s: string): string {
  return String(s)
    .replace(/[^A-Za-z0-9_.:@+-]/g, "_")
    .replace(/\.{2,}/g, "_")
    .slice(0, 120);
}

export function llaveFoto(tenantId: string, visitaKey: string, uuid: string, mime: string): string {
  const ext = EXT[mime];
  if (!ext) throw new Error(`Tipo de archivo no permitido: ${mime}`);
  return `photos/${segmento(tenantId)}/taller-partidas/${segmento(visitaKey)}/${segmento(uuid)}.${ext}`;
}

export type PartidaEntrante = {
  descripcion: string;
  tipo: "refaccion" | "manoObra";
  precio: number;
};

export function validarPartidaEntrante(body: unknown): PartidaEntrante {
  const b = (body ?? {}) as Record<string, unknown>;

  const descripcion = String(b.descripcion ?? "").trim().slice(0, LARGO_DESCRIPCION);
  if (!descripcion) throw new Error("La descripción del hallazgo es obligatoria");

  const tipo = b.tipo;
  if (tipo !== "refaccion" && tipo !== "manoObra") {
    throw new Error(`Tipo no válido: ${String(tipo)}`);
  }

  const precio = b.precio;
  if (typeof precio !== "number" || !Number.isFinite(precio) || precio < 0 || precio > PRECIO_MAX) {
    throw new Error(`Precio no válido: ${String(precio)}`);
  }

  // Nada más se toma del cliente: el estado, la autoría y las fechas los pone
  // el servidor. Un cliente NO puede mandar una partida ya autorizada.
  return { descripcion, tipo, precio };
}

const SECRETO = process.env.TALLER_PORTAL_SECRET ?? "";

function json(status: number, body: unknown) {
  return {
    statusCode: status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

function html(status: number, cuerpo: string) {
  return {
    statusCode: status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    body: cuerpo,
  };
}

/** Cada apertura y cada escritura se registra (§7.6 del spec). No se loggea el
 *  token completo: solo un prefijo, suficiente para correlacionar. */
function bitacora(accion: string, tk: PortalToken | null, extra: Record<string, unknown> = {}) {
  console.info(
    JSON.stringify({
      canal: "taller-portal",
      accion,
      liga: tk ? `liga:${tk.u}|${tk.f}|v${tk.v}` : "liga:invalida",
      ...extra,
    }),
  );
}

export const handler = async (event: any) => {
  const ruta = String(event?.rawPath ?? "/");
  const metodo = String(event?.requestContext?.http?.method ?? "GET").toUpperCase();
  const token = String(event?.queryStringParameters?.t ?? "");

  let tk: PortalToken;
  try {
    tk = verificarToken(token, SECRETO);
  } catch (e) {
    const motivo = e instanceof ErrorToken ? e.motivo : "malformado";
    bitacora("rechazado", null, { motivo });
    // Una liga vencida o revocada merece una explicación humana, no un 401 seco.
    if (ruta === "/" && metodo === "GET") {
      return html(
        401,
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
         <title>Liga no válida</title>
         <div style="font:16px/1.6 system-ui;max-width:34em;margin:12vh auto;padding:0 1.5em;color:#0f172a">
         <h1 style="font-size:1.4em">Esta liga ya no sirve</h1>
         <p>Puede haber vencido o haber sido cancelada. Pídele una nueva a Administración de Riesgos de GPA.</p>
         </div>`,
      );
    }
    return json(401, { error: "liga no válida" });
  }

  const visitaKey = `${tk.u}|${tk.f}`;

  if (metodo === "GET" && ruta === "/") {
    bitacora("abrir", tk);
    const { paginaProveedor } = await import("./pagina");
    return html(200, paginaProveedor(token));
  }

  if (metodo === "GET" && ruta === "/api/visita") {
    bitacora("leer", tk);
    return json(200, await leerVisita(tk, visitaKey));
  }

  if (metodo === "POST" && ruta === "/api/partida") {
    const body = JSON.parse(event?.body ?? "{}");
    const datos = validarPartidaEntrante(body);
    bitacora("crear-partida", tk);
    return json(200, await crearPartida(tk, visitaKey, datos, body.fotos));
  }

  if (metodo === "POST" && ruta === "/api/visita") {
    const body = JSON.parse(event?.body ?? "{}");
    bitacora("actualizar-visita", tk);
    return json(200, await actualizarVisita(tk, body));
  }

  if (metodo === "POST" && ruta === "/api/subida") {
    const body = JSON.parse(event?.body ?? "{}");
    const mime = String(body?.mime ?? "");
    if (!(MIMES_FOTO as readonly string[]).includes(mime)) {
      return json(400, { error: "tipo de archivo no permitido" });
    }
    const key = llaveFoto(tk.t, visitaKey, randomUUID(), mime);
    bitacora("firmar-subida", tk, { key });
    return json(200, await firmarSubida(key, mime));
  }

  return json(404, { error: "no encontrado" });
};
```

Las cuatro funciones de datos (`leerVisita`, `crearPartida`, `actualizarVisita`, `firmarSubida`) se implementan en el siguiente paso.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tallerPortalHandler.test.ts`
Expected: PASS (12 tests). Los tests solo tocan las funciones puras exportadas; no invocan `handler`.

- [ ] **Step 5: Implementar el acceso a datos**

Agregar al final de `handler.ts`. Sigue el mismo patrón de cliente AppSync por IAM que `amplify/functions/opsgpa-receptor/handler.ts` — **leer ese archivo y copiar su forma de resolver el endpoint y firmar las peticiones**, en lugar de inventar una nueva.

```ts
// ── Datos ──────────────────────────────────────────────────────────────────
// Mismo patrón de cliente AppSync por IAM que opsgpa-receptor/handler.ts.

import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const s3 = new S3Client({});
const BUCKET = process.env.CAPTURE_BUCKET ?? "";

async function firmarSubida(key: string, mime: string) {
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: mime }),
    { expiresIn: 300 }, // minutos, no horas
  );
  return { url, key };
}

async function leerVisita(tk: PortalToken, visitaKey: string) {
  const visita = await gql(GET_TALLER, { tenantId: tk.t, unitUid: tk.u, fechaEntrada: tk.f });
  if (!visita?.getTaller) throw new Error("visita no encontrada");
  const v = visita.getTaller;
  // Revocación: un token con ligaVersion vieja muere aquí.
  const vActual = Number(JSON.parse(v.datos ?? "{}")?.ligaVersion ?? 1);
  if (vActual !== tk.v) throw new Error("liga revocada");

  const partidas = await gql(LIST_PARTIDAS, { tenantId: tk.t, visitaKey });
  const d = JSON.parse(v.datos ?? "{}");
  return {
    // Solo lo que el taller necesita ver. Nada del resto de la flota.
    unidad: { eco: d.eco ?? "", placa: tk.u, submarca: d.brand ?? "", sucursal: d.sucursal ?? "", area: d.area ?? "" },
    visita: {
      tipo: d.tipo ?? "",
      fechaEntrada: tk.f,
      km: v.km ?? d.km ?? null,
      estadoOperativo: v.estadoOperativo ?? null,
      fsalidaEst: v.fsalidaEst ?? d.fsalidaEst ?? null,
      comentario: d.comentario ?? "",
    },
    partidas: (partidas?.listTallerPartidas?.items ?? [])
      .filter((p: any) => p.estado !== "cancelada")
      .map((p: any) => ({
        partidaId: p.partidaId,
        descripcion: p.descripcion,
        tipo: p.tipo,
        precio: p.precio,
        estado: p.estado,
        motivoRechazo: p.motivoRechazo ?? null,
        fotos: p.fotos ?? [],
      })),
  };
}

async function crearPartida(
  tk: PortalToken,
  visitaKey: string,
  datos: PartidaEntrante,
  fotos: unknown,
) {
  const existentes = await gql(LIST_PARTIDAS, { tenantId: tk.t, visitaKey });
  const vivas = (existentes?.listTallerPartidas?.items ?? []).filter(
    (p: any) => p.estado !== "cancelada",
  );
  if (vivas.length >= TOPE_PARTIDAS_VISITA) {
    throw new Error(`Esta visita ya tiene ${TOPE_PARTIDAS_VISITA} hallazgos`);
  }

  const llaves = Array.isArray(fotos) ? fotos.map(String) : [];
  if (llaves.length > TOPE_FOTOS_PARTIDA) {
    throw new Error(`Máximo ${TOPE_FOTOS_PARTIDA} fotos por hallazgo`);
  }
  // Una llave que el servidor no generó no entra: debe vivir bajo el prefijo
  // de ESTA visita.
  const prefijo = `photos/${segmento(tk.t)}/taller-partidas/${segmento(visitaKey)}/`;
  for (const k of llaves) {
    if (!k.startsWith(prefijo)) throw new Error("llave de foto no válida");
  }

  const ahora = new Date().toISOString();
  return gql(CREATE_PARTIDA, {
    input: {
      tenantId: tk.t,
      visitaKey,
      partidaId: randomUUID(),
      ...datos,
      // El estado y la autoría los pone el SERVIDOR, siempre.
      estado: "borrador",
      fotos: llaves,
      creadoPor: `liga:${tk.u}|${tk.f}`,
      creadoEn: ahora,
      version: 1,
    },
  });
}

async function actualizarVisita(tk: PortalToken, body: any) {
  const input: Record<string, unknown> = {
    tenantId: tk.t,
    unitUid: tk.u,
    fechaEntrada: tk.f,
  };

  if (body.km !== undefined) {
    const km = Number(body.km);
    if (!Number.isInteger(km) || km < 1 || km > 3_000_000) throw new Error("Kilometraje no válido");
    input.km = km;
  }

  if (body.estadoOperativo !== undefined) {
    const permitidos = ["revisando", "reparando", "esperandoRefaccion", "lista"];
    if (!permitidos.includes(String(body.estadoOperativo))) throw new Error("Estado no válido");
    input.estadoOperativo = body.estadoOperativo;
  }

  if (body.fsalidaEst !== undefined) {
    const f = String(body.fsalidaEst).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw new Error("Fecha no válida");
    input.fsalidaEst = f;
    // El COMPROMISO se escribe una sola vez: es contra esta fecha que se mide
    // el incumplimiento, así que el taller no la puede reescribir para borrar
    // su propio retraso.
    const actual = await gql(GET_TALLER, { tenantId: tk.t, unitUid: tk.u, fechaEntrada: tk.f });
    if (!actual?.getTaller?.fsalidaEstCompromiso) input.fsalidaEstCompromiso = f;
  }

  return gql(UPDATE_TALLER, { input });
}
```

Definir las cuatro consultas GraphQL (`GET_TALLER`, `LIST_PARTIDAS`, `CREATE_PARTIDA`, `UPDATE_TALLER`) y el helper `gql()` copiando la forma que ya usa `opsgpa-receptor/handler.ts`.

- [ ] **Step 6: Conectar el Lambda en el backend**

En `amplify/data/resource.ts`, agregar el import arriba y el grant en el bloque de `allow.resource` (cerca de la línea 481):

```ts
import { tallerPortal } from "../functions/taller-portal/resource";
```
```ts
    // taller-portal: la liga del proveedor escribe TallerPartida y actualiza las
    // columnas de Taller que captura el taller. Mismo rol IAM que las otras ingestas.
    allow.resource(tallerPortal).to(["query", "mutate"]),
```

En `amplify/backend.ts`: agregar `tallerPortal` al `defineBackend({...})` y, después del bloque del receptor de Ops:

```ts
// ── Portal del proveedor de taller (2026-09-08) ───────────────────────────────
// Function URL pública: el taller abre la liga en su celular. La autenticación
// es la firma del token (fail-closed sin secreto). Sirve la página y recibe las
// partidas; emite PUT prefirmados para las fotos, con la llave generada por el
// servidor bajo photos/<tenant>/taller-partidas/.
const portalFn = backend.tallerPortal.resources.lambda;
const portalUrl = portalFn.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE,
  cors: { allowedOrigins: ["*"], allowedMethods: [HttpMethod.GET, HttpMethod.POST] },
});
bucket.grantReadWrite(portalFn);
(portalFn as LambdaFunction).addEnvironment("CAPTURE_BUCKET", bucket.bucketName);

backend.addOutput({ custom: { tallerPortalUrl: portalUrl.url } });
```

- [ ] **Step 7: Verificar y commitear**

Run: `npm run test:run && npm run typecheck && npm run lint`
Expected: verde.

```bash
git branch --show-current
git add amplify/functions/taller-portal/handler.ts amplify/data/resource.ts amplify/backend.ts tests/tallerPortalHandler.test.ts
git commit -m "feat(taller): portal del proveedor — leer la visita y recibir partidas

El handler toma tenant/unidad/fecha del TOKEN, nunca del body, y no expone
ningun endpoint que liste o busque: quien tenga una liga no ve otra unidad.
La llave de S3 la genera el servidor (sin traversal, sin pisar fotos de
inspecciones) y la fecha de compromiso se escribe una sola vez.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: La página que ve el proveedor

Una sola pantalla con scroll, móvil primero, sin navegación — el patrón de uso real es **volver a entrar varias veces al día**, no llenar un formulario una vez. La sirve el propio Lambda: así no toca `Control de flotilla.html` (no dispara la re-sincronización de hashes CSP) y no arrastra el JS de la app al celular del taller.

**Files:**
- Create: `amplify/functions/taller-portal/pagina.ts`
- Test: `tests/tallerPortalPagina.test.ts` *(crear)*

**Interfaces:**
- Consumes: nada.
- Produces: `paginaProveedor(token: string): string` — documento HTML completo, autocontenido. `escaparHtml(s: unknown): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tallerPortalPagina.test.ts
import { describe, it, expect } from "vitest";
import { escaparHtml, paginaProveedor } from "../amplify/functions/taller-portal/pagina";

describe("escaparHtml — el texto del taller nunca se pinta como HTML", () => {
  it("neutraliza los cinco caracteres peligrosos", () => {
    expect(escaparHtml('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
    expect(escaparHtml("a & b")).toBe("a &amp; b");
    expect(escaparHtml("it's")).toBe("it&#39;s");
  });

  it("no truena con valores raros", () => {
    expect(escaparHtml(undefined)).toBe("");
    expect(escaparHtml(null)).toBe("");
    expect(escaparHtml(42)).toBe("42");
  });
});

describe("paginaProveedor", () => {
  const p = paginaProveedor("TOKEN.FIRMA");

  it("es un documento completo y responsivo", () => {
    expect(p.startsWith("<!doctype html>")).toBe(true);
    expect(p).toContain('name="viewport"');
    expect(p).toContain("width=device-width");
  });

  it("dice explícitamente que el precio va sin IVA", () => {
    expect(p).toContain("Precio sin IVA");
  });

  it("ofrece los cuatro estados operativos en el idioma del taller", () => {
    for (const t of ["Estoy revisando", "Ya estoy reparando", "Esperando la refacción", "Ya está lista"]) {
      expect(p).toContain(t);
    }
  });

  it("no filtra el secreto ni URLs de infraestructura", () => {
    expect(p).not.toMatch(/TALLER_PORTAL_SECRET|amazonaws\.com|lambda-url/);
  });

  it("lleva el token para sus propias llamadas, sin volver a pedirlo", () => {
    expect(p).toContain("TOKEN.FIRMA");
  });

  it("no usa innerHTML en su propio script", () => {
    expect(p).not.toContain("innerHTML");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tallerPortalPagina.test.ts`
Expected: FAIL — módulo no encontrado.

- [ ] **Step 3: Escribir la página**

`amplify/functions/taller-portal/pagina.ts` exporta `paginaProveedor(token)`. Requisitos concretos, todos verificables:

```ts
export function escaparHtml(s: unknown): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

El documento que devuelve `paginaProveedor(token)`:

- **Tokens de diseño en línea**, copiados de `src/styles/main.css` con un comentario que la señale como fuente de verdad: tinta `#0f172a`, fondo `#eff1f5`, tarjeta `#fff`, azul `#1e4fa3`, cian de marca `#29abe2`, verde `#047857`, ámbar `#b45309`, rosa `#e11d48`, violeta de cotización `#5b21b6` sobre `#ede9fe`, radios 6px y 12px, familia `"Inter", system-ui, -apple-system, sans-serif` con fallback real (**no** cargar fuentes externas: el taller puede tener mala señal).
- **Estructura**, de arriba a abajo:
  1. Barra oscura con `GPA · Control de Flotilla`.
  2. Identificación de la unidad, **solo lectura**: eco, placas, submarca, sucursal, área, tipo, fecha de ingreso.
  3. Banner ámbar cuando falta algo para enviar: *"Falta el kilometraje. Puedes seguir subiendo hallazgos."*
  4. **La camioneta**: kilometraje (numérico), ¿cómo va? (los cuatro estados), estará lista (fecha).
  5. **Hallazgos**: una tarjeta por partida con miniatura, descripción, tipo, precio y **su estado visible** — esperando autorización en violeta, autorizada en verde, no autorizada tachada **con el motivo entre comillas**.
  6. Botón `📷 Agregar hallazgo` que abre `<input type="file" accept="image/*" capture="environment">` **directo**, sin pantalla intermedia. Después, tres preguntas: qué encontraste · qué es (dos botones, Refacción / Mano de obra) · cuánto cuesta, con la etiqueta literal `Precio sin IVA`. Guarda en **borrador**.
  7. Pie fijo: *Cotizado* y *Autorizado* (dos números, no uno) + `Enviar N a autorización`, **deshabilitado** con el motivo escrito debajo mientras falten km o fecha.
- **Todo el DOM se construye con `document.createElement` y `textContent`.** Cero `innerHTML` — la descripción y el motivo los escribe un tercero.
- Subida de foto: `POST /api/subida` para obtener la URL firmada, `PUT` de los bytes a esa URL, y la llave devuelta se manda en `POST /api/partida`.
- Cada `fetch` lleva `?t=<token>`; el token se inserta una sola vez, escapado, en una constante del script.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tallerPortalPagina.test.ts && npm run audit:xss`
Expected: PASS (8 tests) y el guard de XSS en verde.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add amplify/functions/taller-portal/pagina.ts tests/tallerPortalPagina.test.ts
git commit -m "feat(taller): la pantalla del proveedor — lista viva con la camara de una

Una sola pantalla con scroll: el uso real es volver a entrar varias veces al
dia, no llenar un formulario una vez. La sirve el propio Lambda, asi que no
toca el monolito (ni los hashes CSP) ni arrastra el JS de la app al celular.
Todo el DOM se arma con textContent: la descripcion la escribe un tercero.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Hidratar partidas y prender el badge

El badge rojo que **ya existe** en la pestaña Taller (`Control de flotilla.html:144`) pasa a contar partidas esperando firma. Cero infraestructura de notificación, y es donde Riesgos ya voltea a ver.

**Files:**
- Create: `src/api/tallerPartidas.ts`
- Modify: `src/api/batchUpload.ts:364` — la interfaz `LegacyTallerEntry` **no está exportada** hoy; agregarle `export` (una palabra, sin tocar nada más) para poder tiparla desde el módulo nuevo.
- Modify: `src/api/cloudHydrate.ts`
- Modify: `Control de flotilla.html` (`renderTaller()` en ~7580)
- Test: `tests/tallerPartidasApi.test.ts` *(crear)*

**Interfaces:**
- Consumes: `Partida`, `pendientesDeFirma`, `totalesVisita` de `src/taller/partidas.ts`; `tallerCloudKey` y `LegacyTallerEntry` de `src/api/batchUpload.ts`.
- Produces:
  - `visitaKeyDe(e: LegacyTallerEntry): string` — `${unitUid}|${fechaEntrada}`, derivado de `tallerCloudKey` para que nunca divergan.
  - `agruparPorVisita(ps: Partida[]): Map<string, Partida[]>`
  - `fetchPartidas(tenantId: string): Promise<Partida[]>`
  - `window.__tallerPartidas: Map<string, Partida[]>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/tallerPartidasApi.test.ts
import { describe, it, expect } from "vitest";
import { agruparPorVisita, visitaKeyDe } from "../src/api/tallerPartidas";
import { tallerCloudKey } from "../src/api/batchUpload";
import type { Partida } from "../src/taller/partidas";

const P = (visitaKey: string, partidaId: string, estado: Partida["estado"]): Partida => ({
  partidaId,
  visitaKey,
  descripcion: "x",
  estado,
  fotos: [],
});

describe("visitaKeyDe — una sola llave, derivada de la que ya existe", () => {
  it("es exactamente unitUid|fechaEntrada de tallerCloudKey", () => {
    const e = { id: "tl_1", plate: "JV98698", fentrada: "2026-09-01" } as any;
    const k = tallerCloudKey(e);
    expect(visitaKeyDe(e)).toBe(`${k.unitUid}|${k.fechaEntrada}`);
    expect(visitaKeyDe(e)).toBe("JV98698|2026-09-01");
  });

  it("hereda los mismos fallbacks (eco, unitKey, id) sin reimplementarlos", () => {
    expect(visitaKeyDe({ id: "tl_2", eco: "42", fentrada: "2026-09-02" } as any)).toBe(
      "42|2026-09-02",
    );
    const sinFecha = { id: "tl_3", eco: "9" } as any;
    expect(visitaKeyDe(sinFecha)).toBe(`9|${tallerCloudKey(sinFecha).fechaEntrada}`);
  });
});

describe("agruparPorVisita", () => {
  it("agrupa por visitaKey", () => {
    const g = agruparPorVisita([
      P("a|1", "p1", "propuesta"),
      P("a|1", "p2", "autorizada"),
      P("b|2", "p3", "propuesta"),
    ]);
    expect(g.get("a|1")?.length).toBe(2);
    expect(g.get("b|2")?.length).toBe(1);
  });

  it("deja fuera las canceladas — se conservan en la base, no en la vista", () => {
    const g = agruparPorVisita([P("a|1", "p1", "cancelada"), P("a|1", "p2", "propuesta")]);
    expect(g.get("a|1")?.map((p) => p.partidaId)).toEqual(["p2"]);
  });

  it("un set vacío da un mapa vacío, no undefined", () => {
    expect(agruparPorVisita([]).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tallerPartidasApi.test.ts`
Expected: FAIL — módulo no encontrado.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/api/tallerPartidas.ts
// Lectura y escritura de partidas de taller desde la app. Archivo aparte:
// batchUpload.ts ya es grande y tiene otra responsabilidad.

import { tallerCloudKey, type LegacyTallerEntry } from "./batchUpload";
import type { Partida } from "../taller/partidas";

/** La llave de la visita se DERIVA de tallerCloudKey para que las dos nunca
 *  divergan: si cambia la regla de la clave cloud, esta la sigue sola. */
export function visitaKeyDe(e: LegacyTallerEntry): string {
  const { unitUid, fechaEntrada } = tallerCloudKey(e);
  return `${unitUid}|${fechaEntrada}`;
}

export function agruparPorVisita(ps: Partida[]): Map<string, Partida[]> {
  const g = new Map<string, Partida[]>();
  for (const p of ps) {
    if (p.estado === "cancelada") continue;
    const arr = g.get(p.visitaKey) ?? [];
    arr.push(p);
    g.set(p.visitaKey, arr);
  }
  return g;
}
```

Agregar `fetchPartidas(tenantId)` siguiendo el patrón de paginado de las otras lecturas de `src/api/cloudHydrate.ts` (`listTallerPartidas` con `nextToken` hasta agotar).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tallerPartidasApi.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Cargar en la hidratación y prender el badge**

En `src/api/cloudHydrate.ts`, después de hidratar taller (cerca de la línea 643, donde ya se filtra con `esTallerAnulado`), cargar las partidas y publicarlas agrupadas:

```ts
    const partidas = await fetchPartidas(tenantId);
    window.__tallerPartidas = agruparPorVisita(partidas);
```

En `Control de flotilla.html`, dentro de `renderTaller()` (~7580), actualizar el badge que ya existe:

```js
  // El badge de la pestaña Taller pasa a contar lo que espera TU firma.
  const _pend = [...(window.__tallerPartidas?.values() ?? [])]
    .reduce((n, ps) => n + ps.filter(p => p.estado === "propuesta").length, 0);
  const _bdg = document.getElementById("taller-badge");
  if (_bdg) {
    _bdg.textContent = _pend ? String(_pend) : "";
    _bdg.style.display = _pend ? "" : "none";
    _bdg.title = _pend ? `${_pend} partida(s) esperando tu autorización` : "";
  }
```

- [ ] **Step 6: Verificar y commitear**

Run: `npm run test:run && npm run typecheck && npm run lint`

```bash
git branch --show-current
git add src/api/tallerPartidas.ts src/api/cloudHydrate.ts "Control de flotilla.html" tests/tallerPartidasApi.test.ts
git commit -m "feat(taller): hidratar partidas y contar lo pendiente en el badge

El badge de la pestana Taller ya existia: ahora cuenta partidas esperando
firma, que es donde Riesgos ya voltea a ver. La llave de visita se deriva de
tallerCloudKey para que las dos nunca divergan.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: La bandeja de firmas

Una sub-pestaña **Por autorizar** junto a Activas e Historial. Se agrupa **por visita, no por partida suelta**, porque autorizar partidas aisladas ciega al conjunto: se pueden firmar cuatro de $1,800 sin notar que van $7,200 en una unidad que ya lleva $38 mil en el año.

**Files:**
- Modify: `Control de flotilla.html` (barra en ~639; `renderTaller()` en ~7580)
- Modify: `src/api/tallerPartidas.ts` (mutaciones)
- Test: `tests/tallerBandeja.test.ts` *(crear)*

**Interfaces:**
- Consumes: `autorizar`, `rechazar`, `totalesVisita`, `MOTIVOS_RECHAZO` de `src/taller/partidas.ts`; `agruparPorVisita`, `visitaKeyDe`.
- Produces:
  - `filasBandeja(entries, partidasPorVisita, gastoAnualPorUnidad): FilaBandeja[]`
  - `type FilaBandeja = { visitaKey, eco, placa, submarca, sucursal, area, tipo, proveedor, fechaEntrada, fsalidaEst, km, totales, pendientes, gastoAnual, visitasAnual }`
  - `window.__guardarDecisionPartida(partidaId, visitaKey, decision, motivo?, nota?)`

- [ ] **Step 1: Write the failing test**

```ts
// tests/tallerBandeja.test.ts
import { describe, it, expect } from "vitest";
import { filasBandeja } from "../src/api/tallerPartidas";
import type { Partida } from "../src/taller/partidas";

const P = (o: Partial<Partida>): Partida => ({
  partidaId: "p",
  visitaKey: "JV98698|2026-09-01",
  descripcion: "x",
  estado: "propuesta",
  fotos: [],
  ...o,
});

const entry = {
  id: "tl_1",
  plate: "JV98698",
  eco: "42",
  fentrada: "2026-09-01",
  brand: "NP 300",
  sucursal: "Cancún",
  area: "Logística",
  tipo: "Correctivo",
  tecnico: "Frenos GDL",
  estado: "En Diagnóstico",
} as any;

describe("filasBandeja — solo visitas que esperan firma", () => {
  it("omite las visitas sin partidas propuestas", () => {
    const g = new Map([["JV98698|2026-09-01", [P({ estado: "autorizada", precioAutorizado: 100 })]]]);
    expect(filasBandeja([entry], g, new Map())).toEqual([]);
  });

  it("arma la fila con los tres números que hacen la firma una decisión", () => {
    const g = new Map([
      [
        "JV98698|2026-09-01",
        [
          P({ partidaId: "a", estado: "propuesta", precio: 1850, tipo: "refaccion" }),
          P({ partidaId: "b", estado: "autorizada", precio: 2400, precioAutorizado: 2400, tipo: "manoObra" }),
        ],
      ],
    ]);
    const [fila] = filasBandeja([entry], g, new Map([["42", { gasto: 38400, visitas: 4 }]]));
    expect(fila.eco).toBe("42");
    expect(fila.proveedor).toBe("Frenos GDL");
    expect(fila.pendientes).toBe(1);
    expect(fila.totales.cotizado).toBe(1850 + 2400);
    expect(fila.totales.autorizado).toBe(2400);
    expect(fila.gastoAnual).toBe(38400);
    expect(fila.visitasAnual).toBe(4);
  });

  it("sin historial anual, la fila existe con ceros y no truena", () => {
    const g = new Map([["JV98698|2026-09-01", [P({ precio: 500 })]]]);
    const [fila] = filasBandeja([entry], g, new Map());
    expect(fila.gastoAnual).toBe(0);
    expect(fila.visitasAnual).toBe(0);
  });

  it("ordena primero lo que lleva más tiempo esperando firma", () => {
    const otra = { ...entry, plate: "JT44219", eco: "17", fentrada: "2026-08-28" };
    const g = new Map([
      ["JV98698|2026-09-01", [P({ propuestoEn: "2026-09-05T10:00:00Z" })]],
      ["JT44219|2026-08-28", [P({ visitaKey: "JT44219|2026-08-28", propuestoEn: "2026-09-02T10:00:00Z" })]],
    ]);
    expect(filasBandeja([entry, otra], g, new Map()).map((f) => f.eco)).toEqual(["17", "42"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tallerBandeja.test.ts`
Expected: FAIL — `filasBandeja` no exportado.

- [ ] **Step 3: Write minimal implementation**

Agregar a `src/api/tallerPartidas.ts`:

```ts
import { pendientesDeFirma, totalesVisita, type TotalesVisita } from "../taller/partidas";

export type FilaBandeja = {
  visitaKey: string;
  eco: string;
  placa: string;
  submarca: string;
  sucursal: string;
  area: string;
  tipo: string;
  proveedor: string;
  fechaEntrada: string;
  fsalidaEst: string;
  km: number | null;
  totales: TotalesVisita;
  pendientes: number;
  /** Contexto que convierte la firma en decisión: lo que esa unidad ya gastó. */
  gastoAnual: number;
  visitasAnual: number;
  esperandoDesde: string;
};

export function filasBandeja(
  entries: LegacyTallerEntry[],
  porVisita: Map<string, Partida[]>,
  anualPorEco: Map<string, { gasto: number; visitas: number }>,
): FilaBandeja[] {
  const filas: FilaBandeja[] = [];
  for (const e of entries) {
    const visitaKey = visitaKeyDe(e);
    const ps = porVisita.get(visitaKey) ?? [];
    const pendientes = pendientesDeFirma(ps);
    if (!pendientes) continue;

    const anual = anualPorEco.get(String(e.eco ?? "")) ?? { gasto: 0, visitas: 0 };
    const esperas = ps
      .filter((p) => p.estado === "propuesta")
      .map((p) => p.propuestoEn ?? p.creadoEn ?? "")
      .filter(Boolean)
      .sort();

    filas.push({
      visitaKey,
      eco: String(e.eco ?? ""),
      placa: String(e.plate ?? ""),
      submarca: String(e.brand ?? ""),
      sucursal: String(e.sucursal ?? ""),
      area: String(e.area ?? ""),
      tipo: String(e.tipo ?? ""),
      proveedor: String(e.tecnico ?? ""),
      fechaEntrada: String(e.fentrada ?? ""),
      fsalidaEst: String((e as any).fsalidaEst ?? ""),
      km: typeof (e as any).km === "number" ? (e as any).km : null,
      totales: totalesVisita(ps),
      pendientes,
      gastoAnual: anual.gasto,
      visitasAnual: anual.visitas,
      esperandoDesde: esperas[0] ?? "",
    });
  }
  // Lo que lleva más tiempo esperando tu firma, primero.
  filas.sort((a, b) => (a.esperandoDesde || "9").localeCompare(b.esperandoDesde || "9"));
  return filas;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tallerBandeja.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Pintar la bandeja en el monolito**

En `Control de flotilla.html`:

1. Agregar la sub-pestaña `Por autorizar` junto a Activas e Historial, con el conteo de pendientes.
2. Un contenedor `<div id="tl-bandeja"></div>` y una función `renderBandeja()` llamada desde `renderTaller()`.
3. Por cada fila: encabezado con eco, placas, sucursal, área, proveedor, fechas, y **las tres etiquetas de contexto** — `Cotizado $X` · `Ya autorizado $Y` · `Esta unidad: $Z en <año> · N visitas`.
4. Por cada partida propuesta: miniatura, descripción, tipo, precio, autoría (`Subió <proveedor> · <fecha> · desde la liga`) y los botones `✓ Autorizar` / `✕ No autorizar`.
5. El rechazo abre el menú con los cinco motivos de `MOTIVOS_RECHAZO`; `Otro` habilita un campo de texto y **no deja confirmar vacío**.
6. Pie del grupo: *"Si firmas las N, lo autorizado de esta visita pasa a $X"* + `✓ Autorizar las N` + `Abrir expediente`.
7. **Todo con `createElement`/`textContent`.** La descripción y la nota del motivo las escribió un tercero.
8. Botones de firma con `min-height:44px` en móvil (queda cubierto por la vista híbrida del Plan 2, pero el mínimo se pone aquí).

- [ ] **Step 6: Verificar y commitear**

Run: `npm run test:run && npm run typecheck && npm run lint && npm run audit:xss`

```bash
git branch --show-current
git add "Control de flotilla.html" src/api/tallerPartidas.ts tests/tallerBandeja.test.ts
git commit -m "feat(taller): bandeja de firmas agrupada por visita

Agrupar por visita es deliberado: autorizar partidas sueltas ciega al conjunto
— se pueden firmar cuatro de \$1,800 sin notar que van \$7,200 en una unidad que
ya lleva \$38 mil en el ano. Las tres etiquetas de contexto (cotizado, ya
autorizado, gasto anual de la unidad) convierten la firma en una decision.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: El gasto se calcula y el Excel deja de mentir

Hoy el formulario captura un solo "Subtotal ($)" y guarda refacciones y mano de obra en $0 fijos: las columnas de desglose del Excel salen en cero en el **100%** de los registros. Con partidas, el desglose sale solo.

**Files:**
- Modify: `Control de flotilla.html` (`#tf-gasto` en ~1359; `saveTallerEntry()` en ~9442)
- Modify: `src/taller/exportExcel.ts`
- Test: `tests/tallerExportExcel.test.ts` *(modificar — tiene el guard de cobertura)*

**Interfaces:**
- Consumes: `totalesVisita` de `src/taller/partidas.ts`; `visitaKeyDe`.
- Produces: `gastoDerivado(entry, partidas)` → `{ gasto, gastoRef, gastoMO, cotizado, rechazado }`.

- [ ] **Step 1: Write the failing test**

Agregar a `tests/tallerExportExcel.test.ts`:

```ts
import { gastoDerivado } from "../src/taller/partidas";

describe("gastoDerivado — el gasto no se captura, se calcula", () => {
  const entry = { id: "tl_1", gasto: 9999, gastoRef: 0, gastoMO: 0 } as any;

  it("con partidas, el gasto es la suma de lo AUTORIZADO", () => {
    const r = gastoDerivado(entry, [
      { partidaId: "a", visitaKey: "v", descripcion: "x", estado: "autorizada", precio: 1850, precioAutorizado: 1850, tipo: "refaccion", fotos: [] },
      { partidaId: "b", visitaKey: "v", descripcion: "y", estado: "autorizada", precio: 2400, precioAutorizado: 2400, tipo: "manoObra", fotos: [] },
      { partidaId: "c", visitaKey: "v", descripcion: "z", estado: "rechazada", precio: 980, tipo: "refaccion", fotos: [] },
    ]);
    expect(r.gasto).toBe(4250);
    expect(r.gastoRef).toBe(1850);
    expect(r.gastoMO).toBe(2400);
    expect(r.cotizado).toBe(5230);
    expect(r.rechazado).toBe(980);
  });

  it("SIN partidas conserva lo capturado — las visitas historicas no se tocan", () => {
    const r = gastoDerivado({ ...entry, gasto: 7000, gastoRef: 100, gastoMO: 200 }, []);
    expect(r.gasto).toBe(7000);
    expect(r.gastoRef).toBe(100);
    expect(r.gastoMO).toBe(200);
    expect(r.cotizado).toBe(0);
  });

  it("el desglose siempre cuadra con el total", () => {
    const r = gastoDerivado(entry, [
      { partidaId: "a", visitaKey: "v", descripcion: "x", estado: "autorizada", precio: 500, precioAutorizado: 500, tipo: "refaccion", fotos: [] },
    ]);
    expect(r.gastoRef + r.gastoMO).toBe(r.gasto);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tallerExportExcel.test.ts`
Expected: FAIL — `gastoDerivado` no existe.

- [ ] **Step 3: Write minimal implementation**

Agregar a `src/taller/partidas.ts`:

```ts
/**
 * El gasto de una visita con partidas es la suma de lo FIRMADO — nunca un
 * número tecleado. Si el proveedor tecleara un subtotal y además precios por
 * partida, van a discrepar y no habría forma de saber cuál es verdad.
 *
 * Las visitas históricas (sin partidas) conservan lo que se capturó a mano.
 */
export function gastoDerivado(
  entry: { gasto?: number; gastoRef?: number; gastoMO?: number },
  ps: Partida[],
): { gasto: number; gastoRef: number; gastoMO: number; cotizado: number; rechazado: number } {
  if (!ps.length) {
    const ref = entry.gastoRef ?? 0;
    const mo = entry.gastoMO ?? 0;
    return {
      gasto: entry.gasto ?? ref + mo,
      gastoRef: ref,
      gastoMO: mo,
      cotizado: 0,
      rechazado: 0,
    };
  }
  const t = totalesVisita(ps);
  return {
    gasto: t.autorizado,
    gastoRef: t.gastoRef,
    gastoMO: t.gastoMO,
    cotizado: t.cotizado,
    rechazado: t.rechazado,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tallerExportExcel.test.ts`
Expected: PASS.

- [ ] **Step 5: Quitar el subtotal de la captura y agregar las columnas**

1. En `Control de flotilla.html`, el campo `#tf-gasto` (~1359) deja de ser capturable cuando la visita tiene partidas: mostrar el derivado en solo lectura con la leyenda *"Suma de las partidas autorizadas"*. Sin partidas, sigue editable (visitas históricas y captura manual).
2. En `saveTallerEntry()` (~9442), no escribir `gasto` cuando hay partidas: el valor se deriva al pintar y al exportar.
3. En `src/taller/exportExcel.ts`, agregar las columnas **Cotizado**, **Autorizado** y **Rechazado**, y alimentar Refacciones / Mano de Obra desde `gastoDerivado`. **El guard de cobertura de ese archivo va a fallar** hasta que cada campo nuevo se exporte o se justifique en `CAMPOS_OMITIDOS` — eso es lo que se quiere. Usar **ExcelJS**, no `xlsx` community.

- [ ] **Step 6: Verificar y commitear**

Run: `npm run test:run && npm run typecheck && npm run lint`

```bash
git branch --show-current
git add src/taller/partidas.ts src/taller/exportExcel.ts "Control de flotilla.html" tests/tallerExportExcel.test.ts
git commit -m "feat(taller): el gasto es la suma de lo firmado, y sale el desglose Ref/MO

El formulario pedia un solo Subtotal y guardaba refacciones y mano de obra en
\$0 fijos: las columnas de desglose del Excel salian en cero en el 100% de los
registros y mentian en apariencia. Con partidas el desglose sale solo. Las
visitas historicas conservan lo capturado a mano.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: El apagador

Se prende para toda la flota y todos los talleres a la vez (decisión 21, contra la recomendación de un piloto). Sin ensayo, el freno de mano no es opcional: si el primer día sale mal, Taller vuelve al comportamiento actual **sin volver a desplegar**, y lo ya capturado se conserva.

**Files:**
- Modify: `amplify/data/resource.ts` (modelo `AppConfig` si no existe; si existe uno equivalente, usarlo)
- Modify: `src/api/cloudHydrate.ts`
- Modify: `Control de flotilla.html`
- Test: `tests/tallerApagador.test.ts` *(crear)*

**Interfaces:**
- Consumes: nada.
- Produces: `esquemaHibridoActivo(config: unknown): boolean` en `src/taller/partidas.ts`; `window.__tallerHibrido: boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tallerApagador.test.ts
import { describe, it, expect } from "vitest";
import { esquemaHibridoActivo } from "../src/taller/partidas";

describe("esquemaHibridoActivo — freno de mano", () => {
  it("apagado por omisión: nada se prende por accidente", () => {
    expect(esquemaHibridoActivo(undefined)).toBe(false);
    expect(esquemaHibridoActivo(null)).toBe(false);
    expect(esquemaHibridoActivo({})).toBe(false);
  });

  it("se prende solo con el valor booleano exacto", () => {
    expect(esquemaHibridoActivo({ tallerHibrido: true })).toBe(true);
    expect(esquemaHibridoActivo({ tallerHibrido: "true" })).toBe(false);
    expect(esquemaHibridoActivo({ tallerHibrido: 1 })).toBe(false);
    expect(esquemaHibridoActivo({ tallerHibrido: false })).toBe(false);
  });

  it("no truena con basura", () => {
    expect(esquemaHibridoActivo("sí")).toBe(false);
    expect(esquemaHibridoActivo(42)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tallerApagador.test.ts`
Expected: FAIL — `esquemaHibridoActivo` no exportado.

- [ ] **Step 3: Write minimal implementation**

Agregar a `src/taller/partidas.ts`:

```ts
/** Apagado por omisión, y solo el booleano exacto lo prende: una config
 *  corrupta o ausente NO debe encender el esquema en toda la flota. */
export function esquemaHibridoActivo(config: unknown): boolean {
  if (!config || typeof config !== "object") return false;
  return (config as Record<string, unknown>).tallerHibrido === true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tallerApagador.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Conectar el apagador**

1. Leer la config en la hidratación y publicar `window.__tallerHibrido = esquemaHibridoActivo(config)`.
2. En el monolito, **con la bandera apagada**: ocultar la sub-pestaña `Por autorizar`, ocultar el botón de generar liga, dejar `#tf-gasto` editable y el badge en su comportamiento anterior. Las partidas ya capturadas **siguen visibles** en el expediente — apagar no esconde datos.
3. El Lambda del portal no se apaga con esta bandera: para cerrar la puerta se revoca la liga (subir `ligaVersion`). Documentarlo con un comentario donde se lee la bandera.

- [ ] **Step 6: Verificar y commitear**

Run: `npm run test:run && npm run typecheck && npm run lint && npm run build`

```bash
git branch --show-current
git add src/taller/partidas.ts src/api/cloudHydrate.ts "Control de flotilla.html" amplify/data/resource.ts tests/tallerApagador.test.ts
git commit -m "feat(taller): apagador del esquema hibrido

Se prende para toda la flota de una, sin piloto (decision 21), asi que el
freno de mano no es opcional: si el primer dia sale mal, Taller vuelve al
comportamiento actual sin volver a desplegar y lo ya capturado se conserva.
Apagado por omision, y solo el booleano exacto lo prende.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

---

### Task 11: Emitir, copiar y revocar la liga

**Esta es la tarea que arranca el ciclo:** sin ella Riesgos no puede crear una liga y nada de lo anterior sirve en la vida real. No depende de las Tasks 7–10, así que se puede adelantar si el ejecutor lo prefiere; va al final solo porque necesita el token (Task 4) y el portal (Task 5) ya en pie.

**La emisión NO va en la Function URL pública del portal.** Esa URL solo la protege la firma del token; una ruta de emisión ahí permitiría a cualquiera en internet acuñar una liga para cualquier unidad. Va por una **mutación de AppSync con permiso de grupo**, exactamente el patrón que ya usan `adminCreateUser` / `adminSetEnabled` en `amplify/data/resource.ts:470-496`.

**Decisión 20 del spec:** solo Administración de Riesgos y `admin` emiten o revocan. El grupo `viewer` no, y `operativo` tampoco por sí solo. La restricción se aplica **en AppSync** (no solo en la UI), y cada liga guarda quién la generó y cuándo, para que una liga filtrada tenga un responsable identificable.

**Files:**
- Modify: `amplify/data/resource.ts` (mutaciones custom, junto a las de `adminUsers`)
- Modify: `amplify/functions/taller-portal/handler.ts` (rama de invocación por AppSync)
- Modify: `Control de flotilla.html` (`openTallerModal` en ~9088 y `saveTallerEntry` en ~9442)
- Test: `tests/tallerLiga.test.ts` *(crear)*

**Interfaces:**
- Consumes: `firmarToken`, `VIGENCIA_LIGA_MS` de `amplify/functions/taller-portal/token.ts`.
- Produces:
  - Mutación `generarLigaTaller(unitUid, fechaEntrada)` → `{ url, expira }`
  - Mutación `revocarLigaTaller(unitUid, fechaEntrada)` → `{ ligaVersion }`
  - `mensajeWhatsApp(fila: { eco: string; placa: string; url: string }): string` en `src/taller/partidas.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/tallerLiga.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mensajeWhatsApp } from "../src/taller/partidas";
import { VIGENCIA_LIGA_MS, firmarToken, verificarToken } from "../amplify/functions/taller-portal/token";

const schema = readFileSync("amplify/data/resource.ts", "utf8");

describe("la emisión de ligas NO cuelga de la URL pública", () => {
  it("existe como mutación de AppSync", () => {
    expect(schema).toContain("generarLigaTaller: a");
    expect(schema).toContain("revocarLigaTaller: a");
  });

  it("solo admin y el grupo de Riesgos pueden emitir — verificado en AppSync", () => {
    const bloque = schema.slice(schema.indexOf("generarLigaTaller: a"));
    expect(bloque).toContain('allow.group("admin")');
    expect(bloque).not.toContain('allow.group("viewer")');
  });

  it("el handler del portal no expone ninguna ruta HTTP de emisión", () => {
    const h = readFileSync("amplify/functions/taller-portal/handler.ts", "utf8");
    expect(h).not.toContain('"/api/liga"');
    expect(h).not.toContain("firmarToken");
  });
});

describe("la liga emitida", () => {
  it("caduca a los 90 días y apunta a la visita del token", () => {
    const exp = Date.parse("2026-09-08T12:00:00Z") + VIGENCIA_LIGA_MS;
    const t = firmarToken({ t: "gpa", u: "JV98698", f: "2026-09-01", v: 1, exp }, "s");
    const p = verificarToken(t, "s", Date.parse("2026-09-08T12:00:00Z"));
    expect(p.u).toBe("JV98698");
    expect(p.f).toBe("2026-09-01");
    expect(p.exp - Date.parse("2026-09-08T12:00:00Z")).toBe(VIGENCIA_LIGA_MS);
  });
});

describe("mensajeWhatsApp", () => {
  const m = mensajeWhatsApp({ eco: "42", placa: "JV98698", url: "https://x/?t=TOK" });

  it("nombra la unidad para que el taller sepa de cuál se trata", () => {
    expect(m).toContain("42");
    expect(m).toContain("JV98698");
  });

  it("incluye la liga completa, sin cortarla", () => {
    expect(m).toContain("https://x/?t=TOK");
  });

  it("dice qué se espera del taller, no solo 'hola'", () => {
    expect(m.toLowerCase()).toContain("foto");
    expect(m.toLowerCase()).toContain("precio");
  });

  it("no promete lo que el sistema no hace: nada de 'responde este mensaje'", () => {
    expect(m.toLowerCase()).not.toContain("responde este mensaje");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tallerLiga.test.ts`
Expected: FAIL — `generarLigaTaller` no está en el schema y `mensajeWhatsApp` no existe.

- [ ] **Step 3: Declarar las mutaciones**

En `amplify/data/resource.ts`, junto a las mutaciones de `adminUsers` (~470):

```ts
    /** Emite la liga del proveedor para UNA visita. No vive en la Function URL
     *  pública del portal a propósito: ahí cualquiera podría acuñar ligas. */
    generarLigaTaller: a
      .mutation()
      .arguments({ unitUid: a.string().required(), fechaEntrada: a.string().required() })
      .returns(a.json())
      .handler(a.handler.function(tallerPortal))
      .authorization((allow) => [allow.group("admin"), allow.group("operativo")]),

    /** Revoca todas las ligas de una visita subiendo su ligaVersion. */
    revocarLigaTaller: a
      .mutation()
      .arguments({ unitUid: a.string().required(), fechaEntrada: a.string().required() })
      .returns(a.json())
      .handler(a.handler.function(tallerPortal))
      .authorization((allow) => [allow.group("admin"), allow.group("operativo")]),
```

> **Nota de deuda técnica, ya asentada en el spec §7.7:** `operativo` es hoy un grupo GLOBAL de escritura, no "Administración de Riesgos" específicamente. Con un solo tenant (`gpa`) el efecto práctico es el correcto. Si más adelante se quiere un grupo dedicado, se agrega en `amplify/auth/resource.ts` y se cambia solo esta línea. **No dejar `viewer` en la lista bajo ninguna circunstancia.**

- [ ] **Step 4: Atender la invocación en el handler**

En `handler.ts`, **antes** de la verificación del token (una invocación de AppSync no trae `?t=`), atender el evento de resolver:

```ts
  // Invocación por AppSync (mutación con permiso de grupo), no por la URL pública.
  // AppSync ya validó el grupo del usuario: aquí solo se emite o se revoca.
  const campo = event?.info?.fieldName;
  if (campo === "generarLigaTaller" || campo === "revocarLigaTaller") {
    if (!SECRETO) return json(401, { error: "portal no configurado" });
    const { unitUid, fechaEntrada } = event.arguments ?? {};
    const sub = event?.identity?.sub ?? "desconocido";
    return campo === "generarLigaTaller"
      ? json(200, await emitirLiga(String(unitUid), String(fechaEntrada), sub))
      : json(200, await revocarLiga(String(unitUid), String(fechaEntrada), sub));
  }
```

Y las dos funciones, al final del archivo:

```ts
import { VIGENCIA_LIGA_MS, firmarToken } from "./token";

const TENANT = process.env.TALLER_TENANT_ID ?? "gpa";
const PORTAL_URL = process.env.TALLER_PORTAL_URL ?? "";

async function emitirLiga(unitUid: string, fechaEntrada: string, quien: string) {
  const actual = await gql(GET_TALLER, { tenantId: TENANT, unitUid, fechaEntrada });
  if (!actual?.getTaller) throw new Error("La visita no existe");

  const d = JSON.parse(actual.getTaller.datos ?? "{}");
  const ligaVersion = Number(d.ligaVersion ?? 1);
  const ahora = Date.now();

  await gql(UPDATE_TALLER, {
    input: {
      tenantId: TENANT,
      unitUid,
      fechaEntrada,
      // Quién la generó y cuándo: una liga filtrada tiene responsable.
      datos: JSON.stringify({
        ...d,
        ligaVersion,
        ligaCreadaEn: new Date(ahora).toISOString(),
        ligaCreadaPor: quien,
      }),
    },
  });

  const token = firmarToken(
    { t: TENANT, u: unitUid, f: fechaEntrada, v: ligaVersion, exp: ahora + VIGENCIA_LIGA_MS },
    SECRETO,
  );
  bitacora("emitir-liga", null, { unitUid, fechaEntrada, quien });
  return { url: `${PORTAL_URL}?t=${encodeURIComponent(token)}`, expira: ahora + VIGENCIA_LIGA_MS };
}

async function revocarLiga(unitUid: string, fechaEntrada: string, quien: string) {
  const actual = await gql(GET_TALLER, { tenantId: TENANT, unitUid, fechaEntrada });
  if (!actual?.getTaller) throw new Error("La visita no existe");
  const d = JSON.parse(actual.getTaller.datos ?? "{}");
  const nueva = Number(d.ligaVersion ?? 1) + 1;
  await gql(UPDATE_TALLER, {
    input: {
      tenantId: TENANT,
      unitUid,
      fechaEntrada,
      datos: JSON.stringify({
        ...d,
        ligaVersion: nueva,
        ligaRevocadaEn: new Date().toISOString(),
        ligaRevocadaPor: quien,
      }),
    },
  });
  bitacora("revocar-liga", null, { unitUid, fechaEntrada, quien, nueva });
  return { ligaVersion: nueva };
}
```

En `amplify/backend.ts`, pasarle al Lambda su propia URL (se conoce después de crearla):

```ts
(portalFn as LambdaFunction).addEnvironment("TALLER_PORTAL_URL", portalUrl.url);
```

- [ ] **Step 5: El mensaje y el botón**

Agregar a `src/taller/partidas.ts`:

```ts
/** El mensaje que Riesgos pega en WhatsApp. Dice qué se espera del taller:
 *  un "hola, aquí está la liga" no logra que alguien la use. */
export function mensajeWhatsApp(f: { eco: string; placa: string; url: string }): string {
  const unidad = f.eco ? `unidad ${f.eco} (${f.placa})` : `unidad ${f.placa}`;
  return [
    `Hola. Para la ${unidad} que está en su taller, por favor use esta liga de GPA:`,
    "",
    f.url,
    "",
    "Ahí puede subir cada hallazgo con su foto y su precio (sin IVA), y ver qué reparaciones le autorizamos. No necesita cuenta ni instalar nada.",
  ].join("\n");
}
```

En `Control de flotilla.html`, en el pie del modal de taller (junto a los botones que ya existen, ~9088 en adelante):

1. Botón **"Copiar liga para el proveedor"** — llama `generarLigaTaller`, arma el mensaje con `mensajeWhatsApp` y lo copia con `navigator.clipboard.writeText`. Confirmación visible: *"Liga copiada. Pégala en WhatsApp."* Si el portapapeles falla (permiso denegado), mostrar el texto en un `<textarea>` seleccionable — nunca dejar al usuario sin salida.
2. Botón **"Revocar liga"**, con confirmación, visible solo si ya se generó una.
3. Ambos con la clase `needs-write` que el monolito ya usa para el gate de rol, **además** del permiso real en AppSync.

- [ ] **Step 6: Verificar y commitear**

Run: `npm run test:run && npm run typecheck && npm run lint`

```bash
git branch --show-current
git add amplify/data/resource.ts amplify/functions/taller-portal/handler.ts amplify/backend.ts src/taller/partidas.ts "Control de flotilla.html" tests/tallerLiga.test.ts
git commit -m "feat(taller): emitir, copiar y revocar la liga del proveedor

La emision va por una mutacion de AppSync con permiso de grupo, NO por la
Function URL publica del portal: esa URL solo la protege la firma del token,
asi que una ruta de emision ahi permitiria a cualquiera acunar una liga para
cualquier unidad. Cada liga guarda quien la genero; revocar sube ligaVersion.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Capturar partidas a mano (la salida de emergencia)

Va a pasar el primer día: un taller que no quiere o no puede usar la liga y manda su cotización por WhatsApp. Sin esta salida el módulo se atora — y con el arranque **sin piloto** (decisión 21) el primer día incluye a todos los talleres a la vez, así que no hay margen para descubrirlo en campo.

Mismo modelo y mismas reglas; lo único que cambia es el autor: `user:<sub>` en vez de `liga:<...>`.

**Files:**
- Modify: `src/api/tallerPartidas.ts`
- Modify: `Control de flotilla.html` (expediente de la visita)
- Test: `tests/tallerCapturaManual.test.ts` *(crear)*

**Interfaces:**
- Consumes: `validarPartidaManual` (nuevo), `Partida` de `src/taller/partidas.ts`.
- Produces: `partidaManual(datos, visitaKey, autorSub, ahora): Partida`

- [ ] **Step 1: Write the failing test**

```ts
// tests/tallerCapturaManual.test.ts
import { describe, it, expect } from "vitest";
import { partidaManual } from "../src/taller/partidas";

const datos = { descripcion: "Balatas delanteras", tipo: "refaccion" as const, precio: 1850 };

describe("partidaManual — misma regla, distinto autor", () => {
  it("nace en borrador, como la del proveedor", () => {
    const p = partidaManual(datos, "JV98698|2026-09-01", "abc", "2026-09-08T10:00:00Z");
    expect(p.estado).toBe("borrador");
  });

  it("la autoría dice que la capturó una persona de GPA, no la liga", () => {
    const p = partidaManual(datos, "v|1", "abc", "2026-09-08T10:00:00Z");
    expect(p.creadoPor).toBe("user:abc");
    expect(p.creadoPor.startsWith("liga:")).toBe(false);
  });

  it("genera un id propio y no lo acepta del formulario", () => {
    const a = partidaManual(datos, "v|1", "abc", "2026-09-08T10:00:00Z");
    const b = partidaManual(datos, "v|1", "abc", "2026-09-08T10:00:00Z");
    expect(a.partidaId).not.toBe(b.partidaId);
    expect(a.partidaId.length).toBeGreaterThan(8);
  });

  it("aplica las mismas validaciones que la liga", () => {
    expect(() => partidaManual({ ...datos, descripcion: "  " }, "v|1", "a", "x")).toThrow();
    expect(() => partidaManual({ ...datos, precio: -5 }, "v|1", "a", "x")).toThrow();
    expect(() => partidaManual({ ...datos, tipo: "otro" as any }, "v|1", "a", "x")).toThrow();
  });

  it("una partida capturada a mano puede no traer foto — el taller mandó texto", () => {
    const p = partidaManual(datos, "v|1", "abc", "2026-09-08T10:00:00Z");
    expect(p.fotos).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tallerCapturaManual.test.ts`
Expected: FAIL — `partidaManual` no exportado.

- [ ] **Step 3: Write minimal implementation**

Agregar a `src/taller/partidas.ts`:

```ts
/**
 * Partida capturada a mano por Riesgos: el taller mandó su cotización por
 * WhatsApp en vez de usar la liga. Mismas reglas y mismo ciclo de firma; lo
 * único distinto es el autor, que queda como `user:<sub>` para que el rastro
 * diga quién la metió.
 */
export function partidaManual(
  datos: { descripcion: string; tipo: PartidaTipo; precio: number },
  visitaKey: string,
  autorSub: string,
  ahora: string,
): Partida {
  const descripcion = String(datos.descripcion ?? "").trim().slice(0, 500);
  if (!descripcion) throw new Error("La descripción del hallazgo es obligatoria");
  if (datos.tipo !== "refaccion" && datos.tipo !== "manoObra") {
    throw new Error(`Tipo no válido: ${String(datos.tipo)}`);
  }
  const precio = Number(datos.precio);
  if (!Number.isFinite(precio) || precio < 0 || precio > 10_000_000) {
    throw new Error(`Precio no válido: ${String(datos.precio)}`);
  }
  return {
    partidaId: crypto.randomUUID(),
    visitaKey,
    descripcion,
    tipo: datos.tipo,
    precio,
    estado: "borrador",
    fotos: [],
    creadoPor: `user:${autorSub}`,
    creadoEn: ahora,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tallerCapturaManual.test.ts && npm run typecheck`
Expected: PASS (5 tests).

- [ ] **Step 5: El formulario en el expediente**

En `Control de flotilla.html`, dentro del expediente de la visita, un bloque **"Agregar hallazgo a mano"** con los mismos tres campos que ve el proveedor (descripción · Refacción/Mano de obra · Precio sin IVA), más un campo opcional de fotos por si Riesgos tiene las imágenes que le mandaron. Detalles que importan:

- La partida nace en **borrador** y hay que enviarla a autorización explícitamente, igual que las del proveedor: así una captura a medias no aparece esperando firma.
- Debajo del bloque, la leyenda: *"Úsalo cuando el taller mandó la cotización por fuera. Queda registrado que la capturaste tú."* — que nadie crea que es lo normal.
- En la bandeja, una partida con autor `user:` muestra **"Capturada por GPA"** en lugar de "desde la liga", para que la evidencia sea distinguible de la que subió el proveedor.

- [ ] **Step 6: Verificar y commitear**

Run: `npm run test:run && npm run typecheck && npm run lint && npm run audit:xss`

```bash
git branch --show-current
git add src/taller/partidas.ts src/api/tallerPartidas.ts "Control de flotilla.html" tests/tallerCapturaManual.test.ts
git commit -m "feat(taller): captura manual de partidas — la salida de emergencia

Va a pasar el primer dia: un taller que manda su cotizacion por WhatsApp. Sin
esta salida el modulo se atora, y con el arranque sin piloto el primer dia
incluye a todos los talleres a la vez. Mismas reglas y mismo ciclo de firma;
la autoria queda como user:<sub> para que la evidencia sea distinguible.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Cierre del Plan 1

Al terminar la Task 12, el ciclo funciona de punta a punta: Riesgos da el ingreso, el proveedor cotiza con evidencia desde su celular sin tener cuenta, Riesgos autoriza partida por partida con el contexto del gasto anual de la unidad enfrente, y el gasto de la visita es la suma de lo firmado — con el desglose Ref/MO que hoy reporta $0.

**Antes de considerar el plan terminado:**

- [ ] `npm run test:run && npm run typecheck && npm run lint && npm run build` en verde.
- [ ] `npm run audit:all` (deps + xss + baseline + csp) en verde.
- [ ] e2e local: `node scripts/gen-fixture-mensual.mjs && npx playwright test -c playwright.local.config.ts`. Referencia **47/54**; 7 fallos ambientales conocidos. **Validar A/B contra `origin/main`** antes de culpar a un cambio de este plan.
- [ ] Probar el portal en el sandbox (`npm run amplify:sandbox`) con una visita de prueba. ⚠️ **El sandbox corre en la cuenta AWS de PROD.**
- [ ] Configurar el secreto: `npx ampx sandbox secret set TALLER_PORTAL_SECRET` y, para la rama, en la consola de Amplify con el mismo nombre.
- [ ] **No desplegar.** El deploy lo aprueba Navares explícitamente y el push lo corre él.

**Lo que sigue en el Plan 2** (misma Fase 1): reloj de cumplimiento con pausa y `estadoHistorial`, galería de fotos a pantalla completa, vista híbrida celular/computadora, PDF de cotización, próximo servicio, recotización en otro taller, y la hoja de instrucciones para los talleres.
