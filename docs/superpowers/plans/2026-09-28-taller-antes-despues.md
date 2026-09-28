# Taller · Antes y después por hallazgo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando Riesgos autoriza un hallazgo, el taller sube desde la liga la foto del trabajo terminado dentro de ese mismo hallazgo, y Fleet muestra antes y después lado a lado (visor A+), con un aviso sin bloqueo al cerrar una visita a la que le faltan fotos del después.

**Architecture:** Toda la regla vive en capas puras: `validacion.ts` del portal (`decidirTerminacion`, `proyectarPartidaParaTaller`) y `src/taller/partidas.ts` de Fleet (`refaccionesSinDespues`, `avisoSinDespues`). El portal gana una ruta `POST /api/terminar` que cruza el mismo portón que las demás. La página de la liga y el monolito solo pintan y llaman. No hay cambios de esquema: se usan `evidenciaFinal`, `terminada` y `terminadoEn`, reservados desde el Plan 1. Dos vistas locales (liga simulada y demo de Fleet) permiten que Navares lo vea antes del PR.

**Tech Stack:** TypeScript, Vite 7, Vitest 4 (happy-dom), Playwright (Chrome del sistema), AWS Amplify Gen 2 (Lambda `taller-portal`, AppSync/DynamoDB, S3), monolito `Control de flotilla.html` (script en línea, ES2020), página de la liga en ES5.

**Spec:** `docs/superpowers/specs/2026-09-28-taller-antes-despues-design.md` (decisiones 1–11). Léelo antes de la Task 1.

## Global Constraints

- **Rama y worktree:** `feat/taller-antes-despues` en `C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla-wt-antes-despues` (sale de `feat/taller-liga-cierre` `e85bcda`). Verifica con `git branch --show-current` antes de cada commit.
- **Stagea solo tus rutas:** `git add <ruta> <ruta>`. Nunca `git add -A` ni `git add .`.
- **Repo PÚBLICO:** solo datos ficticios en pruebas, scripts y demo (tenant `acme` o `demo`, placas `AAA111`/`PRB0006`, correos `@ejemplo.invalid` o `@ejemplo.test`). Nada de ids de infraestructura.
- **Sin `innerHTML` con datos**, ni en `src/` ni en la página de la liga (`createElement` + `textContent`). Guardas: `npm run audit:xss` y `PATRON_SINK_PELIGROSO` de `tests/tallerPortalPagina.test.ts`.
- **Página de la liga (`pagina.ts`) = ES5 dentro de un literal de plantilla de TypeScript.** En el `<script>` servido: prohibidos `=>`, `const`, `let`, `class`, comillas invertidas, `?.`, `??`, `...` (tres puntos, incluso en comentarios del script). No escribas `${` ni barras invertidas dentro del script: el literal de TS las interpretaría.
- **CSP del monolito:** todo cambio a un `<script>` en línea de `Control de flotilla.html` ⇒ `npm run csp:sync` y re-stagear **`Control de flotilla.html` y `nginx.conf`**. Tras el commit, corre `npm run audit:csp` otra vez (el hook reformatea).
- **CSP de la liga** es `'unsafe-inline'` sin hash: editar `pagina.ts` no requiere `csp:sync`.
- **El servidor pone estado, fechas y autoría.** Nada de lo que mande el cliente en esos campos se escribe.
- **Respuestas del portal proyectadas**, jamás la fila cruda (patrón A-1).
- **El dinero no cambia:** `precioAutorizado` y `totalesVisita` no se tocan.
- **Tope de fotos del después = `TOPE_FOTOS_PARTIDA` (6).**
- **Commits en español** estilo `feat(taller): …`, con el trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Pruebas:** `npx vitest run <archivo>`. La batería completa (`npm run test:run`) se captura COMPLETA a archivo, nunca con `| tail`. El único intermitente conocido es `fuelOpsGuardHandlers › handleKmDetectado`: se descarta por nombre. Cualquier otro fallo se investiga.
- **Nada de push ni PR** hasta que Navares vea todo en local y diga que está bien (Task 10, decisión 11). El push lo corre Navares desde este worktree.

## Review Focus

Condiciones que el spec implica y que ninguna prueba "natural" cubre. Cada una tiene su prueba en la tarea indicada.

1. **El total "Autorizado" de la liga no puede bajar cuando un hallazgo pasa a Terminado.** Hoy `actualizarTotalesYPie` solo suma `autorizada`. Un taller que ve bajar su total al terminar el trabajo pierde la confianza en la pantalla. → Task 3, prueba "totales".
2. **Mala señal: el servidor escribió pero la respuesta se perdió.** El reintento con las mismas llaves debe dar 200 sin escribir (no 409), y la página no debe volver a subir fotos que ya tienen llave. → Task 2 ("reintento idéntico") y Task 3 (estructural `subirFotos(items)`).
3. **Fechas en la leyenda del visor A+:** una fecha sola (`YYYY-MM-DD`) no debe correrse un día en México, y una fecha ausente o inválida (partidas capturadas por GPA sin `creadoEn`) no debe pintar "Invalid Date". → Task 6 (`fechaCorta`).
4. **Salida por el modal:** guardar la "Fecha real de salida" cierra la visita (`batchUpload.ts` deriva `estatus: "cerrado"`) y mata la liga, así que debe avisar igual que "✓ Finalizar". Volver a guardar una visita ya cerrada no debe preguntar otra vez. → Task 7.
5. **Mano de obra terminada sin foto:** en la liga, el lado DESPUÉS dice "Sin foto". En Fleet, el visor pinta "Sin foto" en el lado vacío sin romperse, y si no hay ninguna foto de ningún lado, el botón "🖼 Antes y después" no aparece. → Tasks 3, 6 y 7.

---

### Task 1: Capa pura del portal — decidir la terminación y proyectar la partida

**Files:**

- Modify: `amplify/functions/taller-portal/validacion.ts` (agregar después de `llaveFotoValida`, línea ~136)
- Test: `tests/tallerPortalHandler.test.ts` (agregar al final; ampliar el `import` de la línea 3)

**Interfaces:**

- Produces:
  - `class ErrorConflicto extends Error` (NO extiende `ErrorEntrada`)
  - `type PartidaTerminable = { estado?: string | null; tipo?: string | null; evidenciaFinal?: readonly (string | null)[] | null; version?: number | null }`
  - `type CambiosTerminacion = { estado: "terminada"; evidenciaFinal: string[]; terminadoEn: string; version: number }`
  - `decidirTerminacion(tenantId: string, visitaKey: string, partida: PartidaTerminable | null | undefined, fotos: unknown, ahoraIso: string): CambiosTerminacion | null` — `null` = reintento idéntico, no escribir. Lanza `ErrorEntrada` (400) o `ErrorConflicto` (409).
  - `type FilaPartidaProyectable` y `proyectarPartidaParaTaller(p: FilaPartidaProyectable): PartidaParaTaller` con exactamente las llaves `partidaId, descripcion, tipo, precio, precioAutorizado, estado, motivoRechazo, fotos, evidenciaFinal, terminadoEn`.

- [ ] **Step 1: Escribir las pruebas que fallan**

En `tests/tallerPortalHandler.test.ts`, amplía el import de `../amplify/functions/taller-portal/validacion` agregando `ErrorConflicto`, `ErrorEntrada`, `decidirTerminacion` y `proyectarPartidaParaTaller`. Luego agrega al final del archivo:

```ts
describe("decidirTerminacion — el después lo decide el SERVIDOR (spec 2026-09-28 §4.2)", () => {
  const T = "acme";
  const V = "AAA111|2026-09-01";
  const k = (n: string) => llaveFoto(T, V, n, "image/jpeg");
  const AHORA = "2026-09-16T15:00:00.000Z";
  const autorizada = (sobre: Record<string, unknown> = {}) => ({
    estado: "autorizada",
    tipo: "refaccion",
    evidenciaFinal: [] as string[],
    version: 3,
    ...sobre,
  });

  it("refacción autorizada con foto: terminada, con sus fotos, la hora del servidor y versión + 1", () => {
    expect(decidirTerminacion(T, V, autorizada(), [k("d1")], AHORA)).toEqual({
      estado: "terminada",
      evidenciaFinal: [k("d1")],
      terminadoEn: AHORA,
      version: 4,
    });
  });

  it("refacción sin foto ⇒ se rechaza con el mensaje del spec", () => {
    expect(() => decidirTerminacion(T, V, autorizada(), [], AHORA)).toThrow(
      "Una refacción necesita al menos una foto del trabajo terminado",
    );
    expect(() => decidirTerminacion(T, V, autorizada(), undefined, AHORA)).toThrow(ErrorEntrada);
  });

  it("una fila vieja SIN tipo se trata como refacción: sin foto no pasa", () => {
    expect(() => decidirTerminacion(T, V, autorizada({ tipo: null }), [], AHORA)).toThrow(
      "Una refacción necesita al menos una foto",
    );
  });

  it("mano de obra se termina sin foto", () => {
    expect(decidirTerminacion(T, V, autorizada({ tipo: "manoObra" }), [], AHORA)).toEqual({
      estado: "terminada",
      evidenciaFinal: [],
      terminadoEn: AHORA,
      version: 4,
    });
  });

  it("mano de obra también acepta fotos (opcionales)", () => {
    const r = decidirTerminacion(T, V, autorizada({ tipo: "manoObra" }), [k("d1")], AHORA);
    expect(r?.evidenciaFinal).toEqual([k("d1")]);
  });

  it.each(["borrador", "propuesta"])("%s ⇒ todavía no está autorizado", (estado) => {
    expect(() => decidirTerminacion(T, V, autorizada({ estado }), [k("d1")], AHORA)).toThrow(
      "Este hallazgo todavía no está autorizado",
    );
  });

  it("sin estado (fila vieja) se trata como borrador, nunca como autorizada", () => {
    expect(() => decidirTerminacion(T, V, autorizada({ estado: null }), [k("d1")], AHORA)).toThrow(
      "todavía no está autorizado",
    );
  });

  it.each(["rechazada", "cancelada", "inventado"])("%s ⇒ no fue autorizado", (estado) => {
    expect(() => decidirTerminacion(T, V, autorizada({ estado }), [k("d1")], AHORA)).toThrow(
      "Este hallazgo no fue autorizado",
    );
  });

  it("partida que no está en esta visita ⇒ no existe", () => {
    expect(() => decidirTerminacion(T, V, undefined, [k("d1")], AHORA)).toThrow(
      "Este hallazgo no existe en esta visita",
    );
  });

  it(`más de ${TOPE_FOTOS_PARTIDA} fotos ⇒ 400`, () => {
    const demas = Array.from({ length: TOPE_FOTOS_PARTIDA + 1 }, (_, i) => k(`d${i}`));
    expect(() => decidirTerminacion(T, V, autorizada(), demas, AHORA)).toThrow(
      `Máximo ${TOPE_FOTOS_PARTIDA} fotos por hallazgo`,
    );
  });

  it("llave de otra visita o con forma inválida ⇒ 400", () => {
    const otra = llaveFoto(T, "BBB222|2026-09-02", "d1", "image/jpeg");
    expect(() => decidirTerminacion(T, V, autorizada(), [otra], AHORA)).toThrow(
      "llave de foto no válida",
    );
    expect(() => decidirTerminacion(T, V, autorizada(), ["cualquier/cosa.jpg"], AHORA)).toThrow(
      "llave de foto no válida",
    );
  });

  it("fotos repetidas ⇒ 400 (el conjunto se compara al reintentar)", () => {
    expect(() => decidirTerminacion(T, V, autorizada(), [k("d1"), k("d1")], AHORA)).toThrow(
      "fotos repetidas",
    );
  });

  it("fotos que no son arreglo ⇒ 400", () => {
    expect(() => decidirTerminacion(T, V, autorizada(), "x", AHORA)).toThrow("fotos no válidas");
  });

  it("ya terminada + las MISMAS llaves (en otro orden) ⇒ null: es un reintento, no se escribe", () => {
    const ya = autorizada({ estado: "terminada", evidenciaFinal: [k("d1"), k("d2")] });
    expect(decidirTerminacion(T, V, ya, [k("d2"), k("d1")], AHORA)).toBeNull();
  });

  it("mano de obra terminada sin foto + reintento sin foto ⇒ null", () => {
    const ya = autorizada({ tipo: "manoObra", estado: "terminada", evidenciaFinal: [] });
    expect(decidirTerminacion(T, V, ya, [], AHORA)).toBeNull();
  });

  it("ya terminada + llaves DISTINTAS ⇒ ErrorConflicto (409), que NO es ErrorEntrada", () => {
    const ya = autorizada({ estado: "terminada", evidenciaFinal: [k("d1")] });
    let err: unknown;
    try {
      decidirTerminacion(T, V, ya, [k("otra")], AHORA);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ErrorConflicto);
    expect(err).not.toBeInstanceOf(ErrorEntrada);
    expect((err as Error).message).toBe(
      "Este hallazgo ya se marcó como terminado y no se puede cambiar",
    );
  });

  it("versión ausente cuenta como 1", () => {
    const r = decidirTerminacion(T, V, autorizada({ version: null }), [k("d1")], AHORA);
    expect(r?.version).toBe(2);
  });
});

describe("proyectarPartidaParaTaller — lo único que el taller ve de cada hallazgo", () => {
  const fila = {
    partidaId: "p-1",
    descripcion: "Balatas",
    tipo: "refaccion",
    precio: 1850,
    precioAutorizado: 1850,
    estado: "terminada",
    motivoRechazo: null,
    fotos: ["a.jpg", null],
    evidenciaFinal: ["b.jpg"],
    terminadoEn: "2026-09-16T15:00:00.000Z",
    // Internos: jamás salen.
    creadoPor: "liga:AAA111|2026-09-01",
    decididoPor: "riesgos@ejemplo.invalid",
    motivoRechazoNota: "NOTA-INTERNA",
    tenantId: "tenant-interno",
    version: 4,
  };

  it("devuelve EXACTAMENTE estas llaves", () => {
    expect(Object.keys(proyectarPartidaParaTaller(fila)).sort()).toEqual([
      "descripcion",
      "estado",
      "evidenciaFinal",
      "fotos",
      "motivoRechazo",
      "partidaId",
      "precio",
      "precioAutorizado",
      "terminadoEn",
      "tipo",
    ]);
  });

  it("tira los nulos de los arreglos y rellena ausentes con null o []", () => {
    const p = proyectarPartidaParaTaller({
      partidaId: "p-2",
      descripcion: "x",
      precio: 1,
      fotos: null,
    });
    expect(p.fotos).toEqual([]);
    expect(p.evidenciaFinal).toEqual([]);
    expect(p.terminadoEn).toBeNull();
    expect(p.precioAutorizado).toBeNull();
    expect(p.tipo).toBeNull();
    expect(p.estado).toBeNull();
    expect(proyectarPartidaParaTaller(fila).fotos).toEqual(["a.jpg"]);
  });

  it("ningún campo interno viaja", () => {
    const txt = JSON.stringify(proyectarPartidaParaTaller(fila));
    for (const m of ["liga:", "riesgos@", "NOTA-INTERNA", "tenant-interno"]) {
      expect(txt).not.toContain(m);
    }
  });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/tallerPortalHandler.test.ts`
Expected: FAIL — `decidirTerminacion` / `proyectarPartidaParaTaller` / `ErrorConflicto` no se exportan.

- [ ] **Step 3: Implementar en `validacion.ts`**

Agrega justo después de la función `llaveFotoValida`:

```ts
/**
 * Error de CONFLICTO: la petición tiene buena forma pero choca con el estado actual
 * (p. ej., terminar con OTRAS fotos un hallazgo que ya está terminado). El handler lo
 * traduce a 409. No extiende ErrorEntrada a propósito: el catch de ErrorEntrada
 * respondería 400, y el taller no se enteraría de que su hallazgo YA quedó terminado.
 */
export class ErrorConflicto extends Error {}

/** Lo que el servidor necesita de una partida para decidir si se puede terminar. */
export type PartidaTerminable = {
  estado?: string | null;
  tipo?: string | null;
  evidenciaFinal?: readonly (string | null)[] | null;
  version?: number | null;
};

export type CambiosTerminacion = {
  estado: "terminada";
  evidenciaFinal: string[];
  terminadoEn: string;
  version: number;
};

/**
 * Antes y después (spec 2026-09-28 §4.2): decide qué hacer con el "trabajo terminado"
 * que manda el taller. Pura: no escribe nada.
 *
 * - Devuelve los cambios EXACTOS a escribir, o `null` cuando no hay que escribir
 *   (reintento idéntico sobre una partida ya terminada: el taller tiene mala señal).
 * - Lanza ErrorEntrada (400) o ErrorConflicto (409).
 *
 * Solo una partida `autorizada` se termina. Una refacción exige al menos una foto; la
 * mano de obra no (decisión 3). Una fila vieja sin `tipo` cuenta como refacción, que es
 * el caso estricto. La hora la pone el servidor (`ahoraIso`), nunca el cliente.
 */
export function decidirTerminacion(
  tenantId: string,
  visitaKey: string,
  partida: PartidaTerminable | null | undefined,
  fotos: unknown,
  ahoraIso: string,
): CambiosTerminacion | null {
  if (!partida) throw new ErrorEntrada("Este hallazgo no existe en esta visita");

  if (fotos !== undefined && !Array.isArray(fotos)) throw new ErrorEntrada("fotos no válidas");
  const llaves = Array.isArray(fotos) ? fotos.map(String) : [];
  if (llaves.length > TOPE_FOTOS_PARTIDA) {
    throw new ErrorEntrada(`Máximo ${TOPE_FOTOS_PARTIDA} fotos por hallazgo`);
  }
  if (new Set(llaves).size !== llaves.length) throw new ErrorEntrada("fotos repetidas");
  for (const k of llaves) {
    if (!llaveFotoValida(tenantId, visitaKey, k)) throw new ErrorEntrada("llave de foto no válida");
  }

  const estado = partida.estado ?? "borrador";
  if (estado === "terminada") {
    const previas = (partida.evidenciaFinal ?? []).filter(
      (k): k is string => typeof k === "string",
    );
    if (mismoConjunto(previas, llaves)) return null;
    throw new ErrorConflicto("Este hallazgo ya se marcó como terminado y no se puede cambiar");
  }
  if (estado === "borrador" || estado === "propuesta") {
    throw new ErrorEntrada("Este hallazgo todavía no está autorizado");
  }
  if (estado !== "autorizada") {
    // rechazada, cancelada o un valor desconocido: nunca se termina.
    throw new ErrorEntrada("Este hallazgo no fue autorizado");
  }
  if (partida.tipo !== "manoObra" && llaves.length === 0) {
    throw new ErrorEntrada("Una refacción necesita al menos una foto del trabajo terminado");
  }
  return {
    estado: "terminada",
    evidenciaFinal: llaves,
    terminadoEn: ahoraIso,
    version: (typeof partida.version === "number" ? partida.version : 1) + 1,
  };
}

/** Mismo conjunto de llaves, sin importar el orden. Las repetidas ya se rechazaron. */
function mismoConjunto(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((k) => s.has(k));
}

/** Lo que se lee de una fila de `TallerPartida` para proyectarla al taller. */
export type FilaPartidaProyectable = {
  partidaId: string;
  descripcion: string;
  tipo?: string | null;
  precio: number;
  precioAutorizado?: number | null;
  estado?: string | null;
  motivoRechazo?: string | null;
  fotos?: readonly (string | null)[] | null;
  evidenciaFinal?: readonly (string | null)[] | null;
  terminadoEn?: string | null;
};

export type PartidaParaTaller = {
  partidaId: string;
  descripcion: string;
  tipo: string | null;
  precio: number;
  precioAutorizado: number | null;
  estado: string | null;
  motivoRechazo: string | null;
  fotos: string[];
  evidenciaFinal: string[];
  terminadoEn: string | null;
};

/**
 * Lo ÚNICO que el taller ve de cada partida (propiedad 12 del arnés: lista blanca
 * exacta). Un campo nuevo del modelo NO viaja hasta que se agregue aquí a propósito.
 *
 * `precioAutorizado` va congelado desde la firma (Task 8 del Plan 1): la página suma
 * "Autorizado" con lo REALMENTE firmado, no con la cotización original.
 */
export function proyectarPartidaParaTaller(p: FilaPartidaProyectable): PartidaParaTaller {
  const soloTexto = (xs: readonly (string | null)[] | null | undefined): string[] =>
    (xs ?? []).filter((k): k is string => typeof k === "string");
  return {
    partidaId: p.partidaId,
    descripcion: p.descripcion,
    tipo: p.tipo ?? null,
    precio: p.precio,
    precioAutorizado: p.precioAutorizado ?? null,
    estado: p.estado ?? null,
    motivoRechazo: p.motivoRechazo ?? null,
    fotos: soloTexto(p.fotos),
    evidenciaFinal: soloTexto(p.evidenciaFinal),
    terminadoEn: p.terminadoEn ?? null,
  };
}
```

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run tests/tallerPortalHandler.test.ts`
Expected: PASS (todas, incluidas las anteriores del archivo).

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # feat/taller-antes-despues
git add amplify/functions/taller-portal/validacion.ts tests/tallerPortalHandler.test.ts
git commit -m "feat(taller): la regla del después vive en la capa pura del portal" -m "decidirTerminacion (autorizada + refacción con foto; reintento idéntico = no escribir; otras llaves sobre una terminada = conflicto) y proyectarPartidaParaTaller (lista blanca exacta, ahora con evidenciaFinal y terminadoEn)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Ruta `POST /api/terminar` y proyección con el después

**Files:**

- Modify: `amplify/functions/taller-portal/handler.ts` (import de `./validacion` en la línea ~42; ruta nueva tras `/api/enviar` en la línea ~391; `catch` en la línea ~422; `leerVisita` en la línea ~703; función nueva tras `enviarAAutorizacion`)
- Test: `tests/tallerPortalHarness.test.ts`

**Interfaces:**

- Consumes: `decidirTerminacion`, `proyectarPartidaParaTaller`, `ErrorConflicto` (Task 1).
- Produces: `POST /api/terminar?t=<token>` con cuerpo `{ partidaId: string, fotos: string[] }` → 200 `{ partidaId, estado: "terminada", evidenciaFinal: string[], terminadoEn: string }` · 400 `{ error }` · 409 `{ error }` · 401 opaco. `GET /api/visita` proyecta cada partida con `evidenciaFinal` y `terminadoEn`.

- [ ] **Step 1: Escribir las pruebas del arnés que fallan**

En `tests/tallerPortalHarness.test.ts`:

(a) En el comentario de cabecera, bajo la propiedad 17, agrega:

```
 * 18. `POST /api/terminar` (antes y después, spec 2026-09-28): solo una partida
 *     `autorizada` DE ESTA visita (ni de otra visita ni de otro tenant, aunque la
 *     consulta dejara de acotar); refacción sin foto ⇒ 400; llaves fuera del prefijo
 *     o de más ⇒ 400; el SERVIDOR pone `terminada`, la hora y `version + 1`; el
 *     reintento idéntico ⇒ 200 sin escribir; otras llaves sobre una terminada ⇒ 409;
 *     el acuse es una proyección; la bitácora va después de escribir.
```

y cambia "LAS 17 PROPIEDADES" por "LAS 18 PROPIEDADES".

(b) En `RUTAS_PUBLICAS`, cambia el comentario "Las siete rutas públicas" por "Las ocho rutas públicas" y agrega al final del arreglo:

```ts
  {
    nombre: "POST /api/terminar",
    ruta: "/api/terminar",
    metodo: "POST",
    body: { partidaId: "p-1", fotos: [LLAVE_PROPIA] },
  },
```

(c) Los dos títulos que dicen "7 rutas" pasan a contarlas:

- `` `secreto ${etiqueta}: las 7 rutas públicas responden 401 aun con un token bien firmado` `` → `` `secreto ${etiqueta}: las ${RUTAS_PUBLICAS.length} rutas públicas responden 401 aun con un token bien firmado` ``
- `"apagado ⇒ 401 opaco en las 7 rutas públicas"` → `` `apagado ⇒ 401 opaco en las ${RUTAS_PUBLICAS.length} rutas públicas` ``

(d) En P12, "el conjunto de llaves es exactamente el permitido…", el arreglo esperado de llaves de la partida pasa a:

```ts
expect(Object.keys(primero(partidas)).sort()).toEqual([
  "descripcion",
  "estado",
  "evidenciaFinal",
  "fotos",
  "motivoRechazo",
  "partidaId",
  "precio",
  "precioAutorizado",
  "terminadoEn",
  "tipo",
]);
```

(e) Agrega al final del archivo:

```ts
// ════════════════════════════════════════════════════════════════════════════
// P18 — POST /api/terminar: antes y después por hallazgo (spec 2026-09-28 §4, §7)
// ════════════════════════════════════════════════════════════════════════════
describe("P18 — POST /api/terminar: el después lo decide el SERVIDOR", () => {
  const LLAVE_DESPUES = `${PREFIJO}despues-uno.jpg`;
  const LLAVE_DESPUES_2 = `${PREFIJO}despues-dos.jpg`;
  const AHORA = "2026-09-16T15:00:00.000Z";

  async function terminar(handler: Handler, body: unknown, token: string = acunar()) {
    return http(await handler(eventoHttp({ ruta: "/api/terminar", metodo: "POST", token, body })));
  }

  it("refacción autorizada ⇒ terminada con su foto, la hora del SERVIDOR y versión + 1; el estado y la fecha que mande el cliente se ignoran", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(AHORA));
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({
      partidaId: "p-1",
      estado: "autorizada",
      precioAutorizado: 1850,
      fotos: [LLAVE_PROPIA],
      version: 3,
    });

    const res = await terminar(handler, {
      partidaId: "p-1",
      fotos: [LLAVE_DESPUES],
      estado: "autorizada",
      terminadoEn: "1999-01-01T00:00:00.000Z",
      version: 99,
    });

    expect(res.statusCode).toBe(200);
    expect(cuerpo(res)).toEqual({
      partidaId: "p-1",
      estado: "terminada",
      evidenciaFinal: [LLAVE_DESPUES],
      terminadoEn: AHORA,
    });
    expect(g.actualizacionesPartida).toEqual([
      {
        tenantId: TENANT,
        visitaKey: VISITA_KEY,
        partidaId: "p-1",
        estado: "terminada",
        evidenciaFinal: [LLAVE_DESPUES],
        terminadoEn: AHORA,
        version: 4,
      },
    ]);
    // El dinero no cambia (decisión 8).
    expect(g.partidas.get(`${TENANT}|${VISITA_KEY}|p-1`)?.precioAutorizado).toBe(1850);
  });

  it("mano de obra se termina SIN foto", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({ partidaId: "mo-1", tipo: "manoObra", precio: 350, estado: "autorizada" });
    const res = await terminar(handler, { partidaId: "mo-1", fotos: [] });
    expect(res.statusCode).toBe(200);
    expect(cuerpo(res).evidenciaFinal).toEqual([]);
    expect(primero(g.actualizacionesPartida).estado).toBe("terminada");
  });

  it("refacción sin foto ⇒ 400 con el mensaje del spec y NADA se escribe", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({ partidaId: "p-1", estado: "autorizada" });
    const res = await terminar(handler, { partidaId: "p-1", fotos: [] });
    expect(res.statusCode).toBe(400);
    expect(cuerpo(res)).toEqual({
      error: "Una refacción necesita al menos una foto del trabajo terminado",
    });
    expect(g.actualizacionesPartida).toEqual([]);
  });

  it("una partida de OTRA visita no existe para esta liga — aunque la consulta dejara de acotar", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({ partidaId: "ajena", visitaKey: VISITA_KEY_AJENA, estado: "autorizada" });
    g.listaIgnoraAlcance = true; // peor caso: el backend deja de acotar por sort key
    const res = await terminar(handler, { partidaId: "ajena", fotos: [LLAVE_DESPUES] });
    expect(res.statusCode).toBe(400);
    expect(cuerpo(res)).toEqual({ error: "Este hallazgo no existe en esta visita" });
    expect(g.actualizacionesPartida).toEqual([]);
    expect(g.partidas.get(`${TENANT}|${VISITA_KEY_AJENA}|ajena`)?.estado).toBe("autorizada");
  });

  it("una partida de OTRO tenant, con la misma visita y el mismo id, tampoco existe", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({ tenantId: TENANT_AJENO, partidaId: "p-1", estado: "autorizada" });
    const res = await terminar(handler, { partidaId: "p-1", fotos: [LLAVE_DESPUES] });
    expect(res.statusCode).toBe(400);
    expect(g.actualizacionesPartida).toEqual([]);
  });

  it("sin partidaId ⇒ 400", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({ partidaId: "p-1", estado: "autorizada" });
    const res = await terminar(handler, { fotos: [LLAVE_DESPUES] });
    expect(res.statusCode).toBe(400);
    expect(g.actualizacionesPartida).toEqual([]);
  });

  it.each([
    ["borrador", "Este hallazgo todavía no está autorizado"],
    ["propuesta", "Este hallazgo todavía no está autorizado"],
    ["rechazada", "Este hallazgo no fue autorizado"],
    ["cancelada", "Este hallazgo no fue autorizado"],
  ])("partida %s ⇒ 400 y nada se escribe", async (estado, mensaje) => {
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({ partidaId: "p-1", estado });
    const res = await terminar(handler, { partidaId: "p-1", fotos: [LLAVE_DESPUES] });
    expect(res.statusCode).toBe(400);
    expect(cuerpo(res)).toEqual({ error: mensaje });
    expect(g.actualizacionesPartida).toEqual([]);
  });

  it.each([
    ["de otra visita", LLAVE_OTRA_VISITA],
    ["de otro tenant", LLAVE_OTRO_TENANT],
    ["de inspecciones", LLAVE_INSPECCIONES],
    ["con travesía (..)", LLAVE_TRAVESIA],
  ])("llave %s ⇒ 400 y nada se escribe", async (_nombre, llave) => {
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({ partidaId: "p-1", estado: "autorizada" });
    const res = await terminar(handler, { partidaId: "p-1", fotos: [llave] });
    expect(res.statusCode).toBe(400);
    expect(cuerpo(res)).toEqual({ error: "llave de foto no válida" });
    expect(g.actualizacionesPartida).toEqual([]);
  });

  it(`más de ${TOPE_FOTOS_PARTIDA} fotos ⇒ 400`, async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({ partidaId: "p-1", estado: "autorizada" });
    const demas = Array.from({ length: TOPE_FOTOS_PARTIDA + 1 }, (_, i) => `${PREFIJO}d${i}.jpg`);
    const res = await terminar(handler, { partidaId: "p-1", fotos: demas });
    expect(res.statusCode).toBe(400);
    expect(g.actualizacionesPartida).toEqual([]);
  });

  it("reintento idéntico (la respuesta se perdió por mala señal) ⇒ 200 con el mismo acuse y CERO escrituras", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({
      partidaId: "p-1",
      estado: "terminada",
      evidenciaFinal: [LLAVE_DESPUES, LLAVE_DESPUES_2],
      terminadoEn: AHORA,
    });
    const res = await terminar(handler, {
      partidaId: "p-1",
      fotos: [LLAVE_DESPUES_2, LLAVE_DESPUES],
    });
    expect(res.statusCode).toBe(200);
    expect(cuerpo(res)).toEqual({
      partidaId: "p-1",
      estado: "terminada",
      evidenciaFinal: [LLAVE_DESPUES, LLAVE_DESPUES_2],
      terminadoEn: AHORA,
    });
    expect(g.actualizacionesPartida).toEqual([]);
    expect(bitacoras.some((l) => l.includes('"accion":"terminar-partida-reintento"'))).toBe(true);
  });

  it("cambiar el después de una terminada ⇒ 409 y cero escrituras", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({ partidaId: "p-1", estado: "terminada", evidenciaFinal: [LLAVE_DESPUES] });
    const res = await terminar(handler, { partidaId: "p-1", fotos: [LLAVE_DESPUES_2] });
    expect(res.statusCode).toBe(409);
    expect(cuerpo(res)).toEqual({
      error: "Este hallazgo ya se marcó como terminado y no se puede cambiar",
    });
    expect(g.actualizacionesPartida).toEqual([]);
  });

  it("el acuse no trae nada interno aunque la fila lo tenga", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({
      partidaId: "p-1",
      estado: "autorizada",
      creadoPor: "liga:AAA111|2026-09-01",
      decididoPor: "quien.emitio@ejemplo.invalid",
      motivoRechazoNota: "NOTA-INTERNA-DE-RIESGOS",
    });
    const res = await terminar(handler, { partidaId: "p-1", fotos: [LLAVE_DESPUES] });
    expect(res.statusCode).toBe(200);
    for (const m of MARCADORES_INTERNOS) expect(res.body).not.toContain(m);
    expect(Object.keys(cuerpo(res)).sort()).toEqual([
      "estado",
      "evidenciaFinal",
      "partidaId",
      "terminadoEn",
    ]);
  });

  it("la bitácora va DESPUÉS de escribir: si la escritura falla ⇒ 500 genérico y ninguna línea 'terminar-partida'", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({ partidaId: "p-1", estado: "autorizada" });
    g.fallas.add("TallerPartida.update");
    const res = await terminar(handler, { partidaId: "p-1", fotos: [LLAVE_DESPUES] });
    expect(res.statusCode).toBe(500);
    expect(cuerpo(res)).toEqual({ error: "error interno" });
    expect(bitacoras.some((l) => l.includes('"accion":"terminar-partida"'))).toBe(false);
  });

  it("la línea de bitácora lleva IP y huella, nunca el token", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({ partidaId: "p-1", estado: "autorizada" });
    const token = acunar();
    await terminar(handler, { partidaId: "p-1", fotos: [LLAVE_DESPUES] }, token);
    const linea = bitacoras.find((l) => l.includes('"accion":"terminar-partida"'));
    expect(linea).toBeDefined();
    expect(linea).toContain(IP);
    expect(linea).toContain('"liga8"');
    expect(linea).not.toContain(token);
  });

  it.each([null, [], 5, "texto", true])(
    "cuerpo que no es objeto (%j) ⇒ 400 y nada se escribe",
    async (body) => {
      const handler = await cargarHandler();
      sembrarVisita();
      sembrarPartida({ partidaId: "p-1", estado: "autorizada" });
      const res = await terminar(handler, body);
      expect(res.statusCode).toBe(400);
      expect(g.actualizacionesPartida).toEqual([]);
    },
  );

  it("visita cerrada ⇒ 401 opaco y nada se escribe (el portón va primero)", async () => {
    const handler = await cargarHandler();
    sembrarVisita({ estatus: "cerrado" });
    sembrarPartida({ partidaId: "p-1", estado: "autorizada" });
    const res = await terminar(handler, { partidaId: "p-1", fotos: [LLAVE_DESPUES] });
    expect(res.statusCode).toBe(401);
    expect(res.body).toBe(CUERPO_OPACO);
    expect(g.actualizacionesPartida).toEqual([]);
  });

  it("un evento con un fieldName desconocido no alcanza /api/terminar: cae al perímetro y sin liga da 401", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({ partidaId: "p-1", estado: "autorizada" });
    const res = http(
      await handler({
        fieldName: "terminarPartida",
        rawPath: "/api/terminar",
        requestContext: { http: { method: "POST", sourceIp: IP } },
        body: JSON.stringify({ partidaId: "p-1", fotos: [LLAVE_DESPUES] }),
      }),
    );
    expect(res.statusCode).toBe(401);
    expect(g.actualizacionesPartida).toEqual([]);
  });

  it("después de terminar, GET /api/visita le muestra al taller su antes y su después", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({ partidaId: "p-1", estado: "autorizada", fotos: [LLAVE_PROPIA] });
    const token = acunar();
    await terminar(handler, { partidaId: "p-1", fotos: [LLAVE_DESPUES] }, token);
    const v = cuerpo(await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token })));
    const p = primero(v.partidas as Fila[]);
    expect(p.fotos).toEqual([LLAVE_PROPIA]);
    expect(p.evidenciaFinal).toEqual([LLAVE_DESPUES]);
    expect(p.estado).toBe("terminada");
    expect(typeof p.terminadoEn).toBe("string");
  });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/tallerPortalHarness.test.ts`
Expected: FAIL — P18 recibe 404 (la ruta no existe) y P12 no encuentra `evidenciaFinal`/`terminadoEn`.

- [ ] **Step 3: Implementar en `handler.ts`**

(a) En el import de `./validacion`, agrega `ErrorConflicto`, `decidirTerminacion` y `proyectarPartidaParaTaller`.

(b) Justo después del bloque `if (metodo === "POST" && ruta === "/api/enviar") { … }`, agrega:

```ts
if (metodo === "POST" && ruta === "/api/terminar") {
  // Antes y después (spec 2026-09-28 §4.1): el taller sube la foto del trabajo
  // hecho DENTRO del hallazgo autorizado. Las reglas son del servidor
  // (decidirTerminacion, pura, validacion.ts); la página solo es cortesía.
  const body = parseBody(event);
  return json(200, await terminarPartida(tk, visitaKey, body, rastro));
}
```

(c) En el `catch` del handler, ANTES de `if (e instanceof ErrorEntrada) {`, agrega:

```ts
if (e instanceof ErrorConflicto) {
  bitacora("rechazado-conflicto", tk, { ...rastro, motivo: e.message });
  return json(409, { error: e.message });
}
```

(d) En `leerVisita`, reemplaza el `.map((p) => ({ partidaId: p.partidaId, … fotos: p.fotos ?? [] }))` completo (con su comentario de `precioAutorizado`, que ahora vive en `proyectarPartidaParaTaller`) por:

```ts
    partidas: partidas
      .filter((p) => p.estado !== "cancelada")
      .map((p) => proyectarPartidaParaTaller(p)),
```

(e) Agrega esta función justo después de `enviarAAutorizacion`:

```ts
/**
 * Antes y después (spec 2026-09-28 §4.1): marca un hallazgo AUTORIZADO de ESTA visita
 * como terminado, con la evidencia del trabajo hecho. La partida se busca DENTRO de
 * las de la visita (`listarPartidasDeVisita`, con su cinturón por visitaKey): nunca
 * por id suelto, así que una partida de otra visita o de otro tenant no existe para
 * esta liga. La decisión es de `decidirTerminacion` (pura). El acuse es una
 * proyección, jamás la fila cruda (A-1), y la bitácora va DESPUÉS de escribir.
 */
async function terminarPartida(
  tk: PortalToken,
  visitaKey: string,
  body: Record<string, unknown>,
  rastro: Record<string, unknown>,
) {
  const partidaId = String(body.partidaId ?? "");
  const partidas = await listarPartidasDeVisita(tk.t, visitaKey);
  const partida = partidaId ? partidas.find((p) => p.partidaId === partidaId) : undefined;
  const cambios = decidirTerminacion(
    tk.t,
    visitaKey,
    partida,
    body.fotos,
    new Date().toISOString(),
  );
  // decidirTerminacion ya lanzó si la partida no es de esta visita.
  const fila = partida!;

  if (!cambios) {
    // Reintento idéntico (mala señal): ya estaba así; no se escribe nada.
    bitacora("terminar-partida-reintento", tk, { ...rastro, partidaId });
    const p = proyectarPartidaParaTaller(fila);
    return {
      partidaId: p.partidaId,
      estado: p.estado,
      evidenciaFinal: p.evidenciaFinal,
      terminadoEn: p.terminadoEn,
    };
  }

  const client = await getDataClient();
  const { errors } = await client.models.TallerPartida.update({
    tenantId: tk.t,
    visitaKey,
    partidaId: fila.partidaId,
    ...cambios,
  });
  if (errors) throw new Error(`TallerPartida.update: ${JSON.stringify(errors)}`);
  bitacora("terminar-partida", tk, { ...rastro, partidaId, fotos: cambios.evidenciaFinal.length });
  return {
    partidaId: fila.partidaId,
    estado: cambios.estado,
    evidenciaFinal: cambios.evidenciaFinal,
    terminadoEn: cambios.terminadoEn,
  };
}
```

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run tests/tallerPortalHarness.test.ts tests/tallerPortalHandler.test.ts`
Expected: PASS (P1–P18).

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add amplify/functions/taller-portal/handler.ts tests/tallerPortalHarness.test.ts
git commit -m "feat(taller): POST /api/terminar — el taller sube el después dentro del hallazgo autorizado" -m "Cruza el mismo portón; la partida se busca dentro de la visita; 409 si ya terminada con otras fotos; reintento idéntico sin escribir. GET /api/visita proyecta evidenciaFinal y terminadoEn. Arnés P18 (propiedades ejecutadas)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: La página de la liga — botón, panel y par Antes | Después

**Files:**

- Modify: `amplify/functions/taller-portal/pagina.ts`
- Test: `tests/tallerPortalPaginaDespues.test.ts` (nuevo) y `tests/tallerPortalPagina.test.ts` (una prueba estructural)

**Interfaces:**

- Consumes: `POST /api/terminar` y la proyección con `evidenciaFinal`/`terminadoEn` (Task 2).
- Produces: en el DOM de la liga, `button` "📷 Subir foto del trabajo terminado" (refacción autorizada), "✓ Marcar como terminado" y "+ Agregar foto (opcional)" (mano de obra autorizada), "Marcar como terminado" dentro del panel, `figure` con `figcaption` "ANTES"/"DESPUÉS" (terminada), textos "Este hallazgo ya no se puede cambiar." y "El botón del después aparece cuando GPA lo autorice.".

**Recordatorio:** todo lo que agregues al `<script>` va DENTRO del literal de plantilla de `paginaProveedor`. ES5 estricto (ver Global Constraints). Sin comillas invertidas, sin `${`, sin barras invertidas.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `tests/tallerPortalPaginaDespues.test.ts`:

```ts
// Antes y después en la LIGA (spec 2026-09-28 §5): se EJECUTA el <script> real que
// sirve paginaProveedor() dentro de happy-dom, con fetch simulado. Nada de copias del
// script: si la página cambia, esta prueba ve el cambio.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { paginaProveedor } from "../amplify/functions/taller-portal/pagina";

type P = Record<string, unknown>;

const PAGINA = paginaProveedor("tok");
const SCRIPT = PAGINA.slice(PAGINA.indexOf("<script>") + 8, PAGINA.lastIndexOf("</script>"));
const META = /<meta id="pt-token"[^>]*>/.exec(PAGINA)![0];
const CUERPO = PAGINA.slice(PAGINA.indexOf("<body>") + 6, PAGINA.indexOf("<script>"));

let llamadas: { url: string; metodo: string; body: unknown }[] = [];
let respuestaTerminar: { status: number; body: unknown } = { status: 200, body: {} };
const fetchOriginal = globalThis.fetch;

const partida = (sobre: P): P => ({
  partidaId: "p-1",
  descripcion: "Balatas delanteras",
  tipo: "refaccion",
  precio: 1850,
  precioAutorizado: 1850,
  estado: "autorizada",
  motivoRechazo: null,
  fotos: ["k-antes.jpg"],
  evidenciaFinal: [],
  terminadoEn: null,
  ...sobre,
});

async function asentar() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

async function montar(partidas: P[]) {
  const datos = {
    unidad: { eco: "E-01", placa: "AAA111", submarca: "X", sucursal: "Y", area: "Z" },
    visita: {
      tipo: "Correctivo",
      fechaEntrada: "2026-09-01",
      km: 85000,
      estadoOperativo: "reparando",
      fsalidaEst: "2026-09-20",
    },
    partidas,
  };
  // eslint-disable-next-line no-restricted-syntax -- montaje de prueba con el HTML REAL servido
  document.head.innerHTML = META;
  // eslint-disable-next-line no-restricted-syntax -- idem
  document.body.innerHTML = CUERPO;
  globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const metodo = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    llamadas.push({ url: u, metodo, body });
    const resp = (b: unknown, status = 200) =>
      ({ ok: status < 400, status, json: async () => b }) as unknown as Response;
    if (u.startsWith("/api/visita")) return resp(datos);
    if (u.startsWith("/api/foto")) return resp({ url: "https://ejemplo.test/foto.jpg" });
    if (u.startsWith("/api/terminar"))
      return resp(respuestaTerminar.body, respuestaTerminar.status);
    return resp({ error: "no encontrado" }, 404);
  }) as unknown as typeof fetch;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- se ejecuta el script REAL servido
  new Function(SCRIPT)();
  await asentar();
}

const tarjeta = (desc: string): HTMLElement => {
  const t = Array.from(document.querySelectorAll<HTMLElement>(".hallazgo")).find((n) =>
    (n.textContent ?? "").includes(desc),
  );
  if (!t) throw new Error(`no hay tarjeta "${desc}"`);
  return t;
};
const boton = (raiz: ParentNode, texto: string) =>
  Array.from(raiz.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    (b.textContent ?? "").includes(texto),
  );

beforeEach(() => {
  llamadas = [];
  respuestaTerminar = { status: 200, body: {} };
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe("liga · refacción autorizada", () => {
  it("ofrece subir la foto del trabajo terminado, no un 'terminar' directo", async () => {
    await montar([partida({})]);
    const t = tarjeta("Balatas delanteras");
    expect(boton(t, "Subir foto del trabajo terminado")).toBeDefined();
    expect(boton(t, "Marcar como terminado")).toBeUndefined();
  });

  it("al abrir el panel, 'Marcar como terminado' nace deshabilitado y la regla se ve", async () => {
    await montar([partida({})]);
    boton(tarjeta("Balatas delanteras"), "Subir foto del trabajo terminado")!.click();
    const t = tarjeta("Balatas delanteras");
    expect(boton(t, "Marcar como terminado")!.disabled).toBe(true);
    expect(t.textContent).toContain("Una refacción necesita al menos una foto de la pieza nueva.");
  });
});

describe("liga · mano de obra autorizada", () => {
  const mo = () =>
    partida({
      partidaId: "mo-1",
      descripcion: "Ajuste de freno de mano",
      tipo: "manoObra",
      precio: 350,
      precioAutorizado: 350,
      fotos: [],
    });

  it("ofrece terminar directo y la foto como opcional", async () => {
    await montar([mo()]);
    const t = tarjeta("Ajuste de freno");
    expect(boton(t, "Marcar como terminado")).toBeDefined();
    expect(boton(t, "Agregar foto (opcional)")).toBeDefined();
  });

  it("terminar manda POST /api/terminar con fotos vacías y la tarjeta queda Terminada", async () => {
    respuestaTerminar = {
      status: 200,
      body: {
        partidaId: "mo-1",
        estado: "terminada",
        evidenciaFinal: [],
        terminadoEn: "2026-09-16T15:00:00.000Z",
      },
    };
    await montar([mo()]);
    boton(tarjeta("Ajuste de freno"), "Marcar como terminado")!.click();
    await asentar();
    const post = llamadas.find((l) => l.url.startsWith("/api/terminar"));
    expect(post?.metodo).toBe("POST");
    expect(post?.body).toEqual({ partidaId: "mo-1", fotos: [] });
    const t = tarjeta("Ajuste de freno");
    expect(t.textContent).toContain("Terminada");
    expect(t.textContent).toContain("Este hallazgo ya no se puede cambiar.");
    // Sin foto del después: el lado DESPUÉS lo dice.
    expect(t.textContent).toContain("Sin foto");
  });

  it("409 ⇒ avisa que ya estaba terminado y recarga la visita", async () => {
    respuestaTerminar = { status: 409, body: { error: "ya terminado" } };
    await montar([mo()]);
    const antes = llamadas.filter((l) => l.url.startsWith("/api/visita")).length;
    boton(tarjeta("Ajuste de freno"), "Marcar como terminado")!.click();
    await asentar();
    expect(llamadas.filter((l) => l.url.startsWith("/api/visita")).length).toBe(antes + 1);
  });

  it("falla de red ⇒ 'No se pudo enviar' y el botón se puede volver a tocar", async () => {
    respuestaTerminar = { status: 500, body: { error: "error interno" } };
    await montar([mo()]);
    const b = boton(tarjeta("Ajuste de freno"), "Marcar como terminado")!;
    b.click();
    await asentar();
    expect(tarjeta("Ajuste de freno").textContent).toContain("No se pudo enviar");
    expect(b.disabled).toBe(false);
  });
});

describe("liga · terminada, propuesta y demás estados", () => {
  it("terminada muestra ANTES y DESPUÉS y que ya no se puede cambiar", async () => {
    await montar([
      partida({
        estado: "terminada",
        evidenciaFinal: ["k-despues.jpg"],
        terminadoEn: "2026-09-16T15:00:00.000Z",
      }),
    ]);
    const t = tarjeta("Balatas delanteras");
    const pies = Array.from(t.querySelectorAll("figcaption")).map((f) => f.textContent);
    expect(pies).toEqual(["ANTES", "DESPUÉS"]);
    expect(t.textContent).toContain("Este hallazgo ya no se puede cambiar.");
    expect(boton(t, "Subir foto")).toBeUndefined();
    // Se pidió la URL firmada de la foto del después.
    expect(llamadas.some((l) => l.url.includes("key=k-despues.jpg"))).toBe(true);
  });

  it("propuesta explica que el botón aparece cuando GPA lo autorice", async () => {
    await montar([partida({ estado: "propuesta", precioAutorizado: null })]);
    const t = tarjeta("Balatas delanteras");
    expect(t.textContent).toContain("El botón del después aparece cuando GPA lo autorice.");
    expect(boton(t, "Subir foto")).toBeUndefined();
  });

  it.each(["borrador", "rechazada"])("%s no trae nada del después", async (estado) => {
    await montar([partida({ estado, precioAutorizado: null })]);
    const t = tarjeta("Balatas delanteras");
    expect(boton(t, "Subir foto")).toBeUndefined();
    expect(boton(t, "Marcar como terminado")).toBeUndefined();
    expect(t.querySelector("figcaption")).toBeNull();
  });
});

describe("liga · totales (Review Focus 1)", () => {
  it("terminar un hallazgo NO baja el total Autorizado", async () => {
    respuestaTerminar = {
      status: 200,
      body: {
        partidaId: "mo-1",
        estado: "terminada",
        evidenciaFinal: [],
        terminadoEn: "2026-09-16T15:00:00.000Z",
      },
    };
    await montar([
      partida({
        partidaId: "mo-1",
        descripcion: "Ajuste de freno de mano",
        tipo: "manoObra",
        precio: 350,
        precioAutorizado: 350,
        fotos: [],
      }),
      partida({
        partidaId: "p-2",
        descripcion: "Balatas traseras",
        estado: "terminada",
        precio: 1650,
        precioAutorizado: 1650,
        evidenciaFinal: ["k.jpg"],
      }),
    ]);
    const autorizado = () => document.getElementById("tot-autorizado")!.textContent;
    expect(autorizado()).toBe("$2,000.00");
    boton(tarjeta("Ajuste de freno"), "Marcar como terminado")!.click();
    await asentar();
    expect(autorizado()).toBe("$2,000.00");
  });
});
```

Y en `tests/tallerPortalPagina.test.ts`, dentro de `describe("conformidad ES5 del <script> servido (A-6)", …)`, agrega:

```ts
it("el panel del después reusa subirFotos: un reintento no vuelve a subir lo que ya tiene llave (Review Focus 2)", () => {
  expect(script).toContain("subirFotos(items)");
  expect(script).toContain("RUTA_TERMINAR");
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/tallerPortalPaginaDespues.test.ts tests/tallerPortalPagina.test.ts`
Expected: FAIL — no existen los botones ni los textos del después; el total baja a `$1,650.00`.

- [ ] **Step 3: Implementar en `pagina.ts`**

(a) **CSS.** Justo antes de `</style>`, agrega:

```css
.despues {
  margin-top: 10px;
}
.despues-panel {
  margin-top: 10px;
  padding: 10px;
  border: 1px dashed rgba(30, 79, 163, 0.45);
  border-radius: var(--r1);
  background: rgba(30, 79, 163, 0.04);
}
.despues-lbl {
  font-size: 12px;
  font-weight: 700;
  color: var(--ink2);
  margin: 0 0 6px;
}
.despues-regla {
  font-size: 12px;
  color: var(--a);
  margin: 4px 0 0;
}
.btn-despues {
  width: 100%;
  margin-top: 8px;
  font-size: 14px;
}
.btn-link {
  background: none;
  border: none;
  color: var(--ac);
  font-weight: 600;
  font-size: 13px;
  padding: 6px 0;
  min-height: 0;
  cursor: pointer;
}
.par {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.par figure {
  margin: 0;
  text-align: center;
}
.par-foto {
  width: 72px;
  height: 72px;
  border-radius: 8px;
  overflow: hidden;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--ink3);
}
.par-foto img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.par figcaption {
  font-size: 10px;
  font-weight: 800;
  color: var(--ink3);
  letter-spacing: 0.05em;
  margin-top: 2px;
}
.msg-ok-despues {
  font-size: 12px;
  color: var(--g);
  margin: 6px 0 0;
}
.espera-despues {
  font-size: 12px;
  color: var(--ink3);
  font-style: italic;
  margin: 6px 0 0;
}
```

(b) **HTML.** Justo después de `<input id="in-foto" type="file" accept="image/*" capture="environment" hidden>`, agrega:

```html
<input id="in-foto-despues" type="file" accept="image/*" capture="environment" hidden />
```

(c) **Script — variables.** Después de `var RUTA_FOTO = "/api/foto";` agrega `var RUTA_TERMINAR = "/api/terminar";`. Después de la línea de `var previewsLocal = {};` agrega:

```js
// Antes y después (spec 2026-09-28 §5): un solo panel abierto a la vez.
// despues = { partidaId, tipo, fotos: [{ file, key }], error } — key se llena al
// subir y un reintento no vuelve a subir lo que ya tiene key (igual que fotosDraft).
var despues = null;
var previewsDespues = {}; // partidaId -> object URL de la primera foto del después
```

(d) **Script — funciones nuevas.** Justo antes de `function tarjetaPartida(p) {`, agrega:

```js
// Miniatura de UNA llave: la previa local si existe; si no, URL firmada por demanda.
function pintarLlave(cont, llave, previa, alt) {
  if (previa) {
    var img0 = el("img", null);
    img0.src = previa;
    img0.alt = alt;
    cont.appendChild(img0);
    return;
  }
  if (!llave) {
    cont.appendChild(document.createTextNode("Sin foto"));
    return;
  }
  fetch(conToken(RUTA_FOTO) + "&key=" + encodeURIComponent(llave))
    .then(function (res) {
      if (!res.ok) throw new Error("http-" + res.status);
      return res.json();
    })
    .then(function (datos) {
      if (!datos || !datos.url) throw new Error("sin-url");
      var img = el("img", null);
      img.src = datos.url;
      img.alt = alt;
      cont.textContent = "";
      cont.appendChild(img);
    })
    .catch(function () {
      // Firma fallida: el recuadro se queda vacío; nunca rompe la tarjeta.
    });
}

function parAntesDespues(p) {
  var par = el("div", "par");
  var fotosAntes = p.fotos || [];
  var fotosDespues = p.evidenciaFinal || [];
  var lados = [
    ["ANTES", fotosAntes[0], previewsLocal[p.partidaId], "Foto de antes"],
    ["DESPUÉS", fotosDespues[0], previewsDespues[p.partidaId], "Foto de después"],
  ];
  for (var i = 0; i < lados.length; i++) {
    var fig = el("figure", null);
    var caja = el("div", "par-foto");
    pintarLlave(caja, lados[i][1], lados[i][2], lados[i][3]);
    fig.appendChild(caja);
    fig.appendChild(el("figcaption", null, lados[i][0]));
    par.appendChild(fig);
  }
  return par;
}

function abrirDespues(p) {
  if (!despues || despues.partidaId !== p.partidaId) {
    despues = { partidaId: p.partidaId, tipo: p.tipo, fotos: [], error: null };
  }
  pintarPartidas();
}

function enviarDespues(p, msg, boton) {
  var items = despues && despues.partidaId === p.partidaId ? despues.fotos : [];
  if (p.tipo !== "manoObra" && items.length === 0) {
    msg.textContent = "Una refacción necesita al menos una foto de la pieza nueva.";
    return;
  }
  boton.disabled = true;
  msg.textContent = "Enviando…";
  subirFotos(items)
    .then(function (claves) {
      return peticionJson(RUTA_TERMINAR, { partidaId: p.partidaId, fotos: claves });
    })
    .catch(function (err) {
      if (err && err.message === "http-409") {
        msg.textContent = "Este hallazgo ya se había marcado como terminado.";
        despues = null;
        cargar();
      } else {
        msg.textContent = "No se pudo enviar. Revisa tu señal e intenta de nuevo.";
        boton.disabled = false;
      }
      throw new Error("terminar");
    })
    .then(function (acuse) {
      try {
        p.estado = "terminada";
        p.evidenciaFinal = (acuse && acuse.evidenciaFinal) || [];
        p.terminadoEn = (acuse && acuse.terminadoEn) || null;
        if (items[0] && items[0].file) {
          previewsDespues[p.partidaId] = URL.createObjectURL(items[0].file);
        }
        despues = null;
        pintarPartidas();
      } catch (e) {
        msg.textContent = "Se envió, pero no se pudo actualizar la lista. Recarga la página.";
      }
    })
    .catch(function () {
      // El re-throw de arriba aterriza aquí: ya avisó.
    });
}

function bloqueDespues(p) {
  var cont = el("div", "despues");
  var msg = el("p", "msg");
  msg.setAttribute("aria-live", "polite");
  var esRefaccion = p.tipo !== "manoObra";
  var abierto = despues && despues.partidaId === p.partidaId;

  if (!abierto) {
    if (esRefaccion) {
      var abrir = el(
        "button",
        "btn btn-primario btn-despues",
        "📷 Subir foto del trabajo terminado",
      );
      abrir.type = "button";
      abrir.addEventListener("click", function () {
        abrirDespues(p);
        document.getElementById("in-foto-despues").click();
      });
      cont.appendChild(abrir);
    } else {
      var directo = el("button", "btn btn-despues", "✓ Marcar como terminado");
      directo.type = "button";
      directo.addEventListener("click", function () {
        enviarDespues(p, msg, directo);
      });
      cont.appendChild(directo);
      var opcional = el("button", "btn-link", "+ Agregar foto (opcional)");
      opcional.type = "button";
      opcional.addEventListener("click", function () {
        abrirDespues(p);
        document.getElementById("in-foto-despues").click();
      });
      cont.appendChild(opcional);
    }
    cont.appendChild(msg);
    return cont;
  }

  var panel = el("div", "despues-panel");
  panel.appendChild(el("p", "despues-lbl", "Foto del trabajo terminado"));
  var tira = el("div", "draft-fotos");
  despues.fotos.forEach(function (item, idx) {
    var chip = el("div", "draft-foto");
    var img = document.createElement("img");
    img.src = URL.createObjectURL(item.file);
    img.alt = "Foto " + (idx + 1) + " del trabajo terminado";
    chip.appendChild(img);
    tira.appendChild(chip);
  });
  panel.appendChild(tira);
  if (despues.fotos.length < TOPE_FOTOS) {
    var tomar = el(
      "button",
      "btn btn-sec btn-despues",
      despues.fotos.length ? "+ Otra foto" : "📷 Tomar foto",
    );
    tomar.type = "button";
    tomar.addEventListener("click", function () {
      document.getElementById("in-foto-despues").click();
    });
    panel.appendChild(tomar);
  }
  if (despues.error) {
    panel.appendChild(el("p", "despues-regla", despues.error));
    despues.error = null;
  }
  if (esRefaccion && despues.fotos.length === 0) {
    panel.appendChild(
      el("p", "despues-regla", "Una refacción necesita al menos una foto de la pieza nueva."),
    );
  }
  var enviar = el("button", "btn btn-primario btn-despues", "Marcar como terminado");
  enviar.type = "button";
  enviar.disabled = esRefaccion && despues.fotos.length === 0;
  enviar.addEventListener("click", function () {
    enviarDespues(p, msg, enviar);
  });
  panel.appendChild(enviar);
  var cancelar = el("button", "btn-link", "Cancelar");
  cancelar.type = "button";
  cancelar.addEventListener("click", function () {
    despues = null;
    pintarPartidas();
  });
  panel.appendChild(cancelar);
  panel.appendChild(msg);
  cont.appendChild(panel);
  return cont;
}
```

(e) **Script — `tarjetaPartida`.** Justo después del bloque `if (p.estado === "rechazada" && p.motivoRechazo) { … }` y antes de `card.appendChild(cuerpo);`, agrega:

```js
// Antes y después (spec 2026-09-28 §5).
if (p.estado === "autorizada") {
  cuerpo.appendChild(bloqueDespues(p));
} else if (p.estado === "terminada") {
  cuerpo.appendChild(parAntesDespues(p));
  cuerpo.appendChild(el("p", "msg-ok-despues", "Este hallazgo ya no se puede cambiar."));
} else if (p.estado === "propuesta") {
  cuerpo.appendChild(
    el("p", "espera-despues", "El botón del después aparece cuando GPA lo autorice."),
  );
}
```

(f) **Script — `actualizarTotalesYPie`.** Cambia las dos condiciones para que `terminada` cuente igual que `autorizada`:

```js
if (
  p.estado === "propuesta" ||
  p.estado === "autorizada" ||
  p.estado === "terminada" ||
  p.estado === "rechazada"
) {
  cot += p.precio || 0;
}
// A-6: ternario, nunca coalescencia nula (ver tarjetaPartida). Terminar un
// hallazgo no le quita nada a lo autorizado (Review Focus 1, spec 2026-09-28).
if (p.estado === "autorizada" || p.estado === "terminada")
  aut += (p.precioAutorizado != null ? p.precioAutorizado : p.precio) || 0;
```

(g) **Script — foto del después.** Justo después del listener de `document.getElementById("in-foto").addEventListener("change", …)`, agrega:

```js
document.getElementById("in-foto-despues").addEventListener("change", function (ev) {
  var input = ev.target;
  var f = input.files && input.files[0];
  input.value = "";
  if (!f || !despues) return;
  if (despues.fotos.length >= TOPE_FOTOS) return;
  var err = validarArchivo(f);
  if (err) {
    despues.error = err;
    pintarPartidas();
    return;
  }
  despues.fotos.push({ file: f, key: null });
  pintarPartidas();
});
```

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run tests/tallerPortalPaginaDespues.test.ts tests/tallerPortalPagina.test.ts`
Expected: PASS, incluidas las pruebas de conformidad ES5 y de sinks peligrosos.

- [ ] **Step 5: Commit**

```bash
git add amplify/functions/taller-portal/pagina.ts tests/tallerPortalPaginaDespues.test.ts tests/tallerPortalPagina.test.ts
git commit -m "feat(taller): la liga ofrece subir el después en los hallazgos autorizados" -m "Refacción: botón + panel con foto obligatoria; mano de obra: terminar directo o con foto opcional; terminada: par ANTES | DESPUÉS y congelado. El total Autorizado ya no baja al terminar. Prueba que ejecuta el script real servido." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Vista local de la liga (servidor simulado con las mismas reglas)

**Files:**

- Create: `scripts/preview-liga-local.mjs`
- Modify: `package.json` (script `preview:liga`)

**Interfaces:**

- Consumes: `paginaProveedor` (Task 3) y, de `validacion.ts`: `decidirTerminacion`, `proyectarPartidaParaTaller`, `validarPartidaEntrante`, `validarTamanoFoto`, `llaveFoto`, `llaveFotoValida`, `esKmValido`, `MIMES_FOTO`, `ErrorEntrada`, `ErrorConflicto`.
- Produces: `npm run preview:liga` → `http://localhost:5180/` (la liga) y `http://localhost:5180/__panel` (Riesgos simulado). `--red` la expone al celular en la misma red. `--smoke` se prueba solo y sale con 0 o 1.

- [ ] **Step 1: Escribir el script con su modo de autoprueba**

Crea `scripts/preview-liga-local.mjs`:

```js
// Vista LOCAL de la liga del proveedor — antes y después por hallazgo
// (spec docs/superpowers/specs/2026-09-28-taller-antes-despues-design.md §8.1).
//
// Sirve la página REAL (amplify/functions/taller-portal/pagina.ts) contra un servidor
// SIMULADO en memoria que usa las MISMAS reglas puras del portal (validacion.ts). Nada
// sale a internet ni toca AWS. Datos inventados (repo público).
//
//   npm run preview:liga                                 → http://localhost:5180 y /__panel
//   node scripts/preview-liga-local.mjs --red            → también desde el celular (misma red)
//   node scripts/preview-liga-local.mjs --smoke          → se prueba solo y sale (0 = bien)
//
// Lo que NO replica (y lo dice): la firma HMAC de la liga, el apagador, el portón de
// visita cerrada o anulada, la CSP del portal y S3 (las fotos viven en memoria).
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createServer as crearVite } from "vite";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUERTO = Number(process.env.PUERTO_LIGA || 5180);
const EN_RED = process.argv.includes("--red");
const SMOKE = process.argv.includes("--smoke");

const vite = await crearVite({
  root: RAIZ,
  configFile: false,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true, hmr: false },
});
const { paginaProveedor } = await vite.ssrLoadModule("/amplify/functions/taller-portal/pagina.ts");
const V = await vite.ssrLoadModule("/amplify/functions/taller-portal/validacion.ts");

const TENANT = "demo";
const UNIDAD = "PRB0006";
const FECHA = "2026-09-14";
const VISITA_KEY = `${UNIDAD}|${FECHA}`;

// ── Fotos de ejemplo (dibujos SVG de un disco de freno) ──────────────────────
function dibujo(fondo, disco, grosor, texto, colorTexto) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120">` +
      `<rect width="160" height="120" fill="${fondo}"/>` +
      `<circle cx="72" cy="62" r="50" fill="${disco}"/><circle cx="72" cy="62" r="17" fill="#1f2937"/>` +
      `<rect x="112" y="30" width="30" height="64" rx="7" fill="#b91c1c"/>` +
      `<rect x="${112 - grosor}" y="38" width="${grosor}" height="48" rx="2" fill="#a8a29e"/>` +
      `<text x="80" y="114" font-size="8" fill="${colorTexto}" text-anchor="middle" font-family="sans-serif">${texto}</text>` +
      `</svg>`,
  );
}
const GASTADO = dibujo("#3f3a36", "#8a5a33", 4, "balata 2 mm · disco rayado", "#fca5a5");
const NUEVO = dibujo("#334155", "#cbd5e1", 12, "balata nueva 12 mm", "#bbf7d0");

let fotos; // llave -> { mime, bytes }
let partidas; // partidaId -> fila
let visita;

const llave = (nombre) => V.llaveFoto(TENANT, VISITA_KEY, nombre, "image/png");

function reiniciar() {
  fotos = new Map();
  const kA1 = llave("antes-balatas-delanteras");
  const kA2 = llave("antes-balatas-traseras");
  const kD2 = llave("despues-balatas-traseras");
  const kA4 = llave("antes-amortiguador");
  const kA5 = llave("antes-rotula");
  for (const k of [kA1, kA2, kA4, kA5]) fotos.set(k, { mime: "image/svg+xml", bytes: GASTADO });
  fotos.set(kD2, { mime: "image/svg+xml", bytes: NUEVO });
  const base = {
    tenantId: TENANT,
    visitaKey: VISITA_KEY,
    motivoRechazo: null,
    evidenciaFinal: [],
    terminadoEn: null,
    precioAutorizado: null,
    version: 2,
  };
  partidas = new Map(
    [
      {
        ...base,
        partidaId: "p-balatas-del",
        descripcion: "Balatas delanteras desgastadas",
        tipo: "refaccion",
        precio: 1850,
        precioAutorizado: 1850,
        estado: "autorizada",
        fotos: [kA1],
      },
      {
        ...base,
        partidaId: "p-freno-mano",
        descripcion: "Ajuste de freno de mano",
        tipo: "manoObra",
        precio: 350,
        precioAutorizado: 350,
        estado: "autorizada",
        fotos: [],
      },
      {
        ...base,
        partidaId: "p-balatas-tra",
        descripcion: "Balatas traseras",
        tipo: "refaccion",
        precio: 1650,
        precioAutorizado: 1650,
        estado: "terminada",
        fotos: [kA2],
        evidenciaFinal: [kD2],
        terminadoEn: "2026-09-16T15:00:00.000Z",
        version: 3,
      },
      {
        ...base,
        partidaId: "p-amortiguador",
        descripcion: "Amortiguador trasero con fuga",
        tipo: "refaccion",
        precio: 2400,
        estado: "propuesta",
        fotos: [kA4],
        version: 1,
      },
      {
        ...base,
        partidaId: "p-rotula",
        descripcion: "Rótula delantera",
        tipo: "refaccion",
        precio: 980,
        estado: "rechazada",
        motivoRechazo: "Precio alto — recotizar",
        fotos: [kA5],
      },
    ].map((p) => [p.partidaId, p]),
  );
  visita = {
    eco: "06",
    submarca: "Nissan NP300 (demo)",
    sucursal: "Guadalajara",
    area: "Mantenimiento",
    tipo: "Correctivo",
    km: 85000,
    estadoOperativo: "reparando",
    fsalidaEst: "2026-09-20",
  };
}
reiniciar();

function leerVisita() {
  return {
    unidad: {
      eco: visita.eco,
      placa: UNIDAD,
      submarca: visita.submarca,
      sucursal: visita.sucursal,
      area: visita.area,
    },
    visita: {
      tipo: visita.tipo,
      fechaEntrada: FECHA,
      km: visita.km,
      estadoOperativo: visita.estadoOperativo,
      fsalidaEst: visita.fsalidaEst,
    },
    partidas: [...partidas.values()]
      .filter((p) => p.estado !== "cancelada")
      .map((p) => V.proyectarPartidaParaTaller(p)),
  };
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
const leerCuerpo = (req) =>
  new Promise((ok, mal) => {
    const partes = [];
    req.on("data", (c) => partes.push(c));
    req.on("end", () => ok(Buffer.concat(partes)));
    req.on("error", mal);
  });

function cuerpoObjeto(buf) {
  let v;
  try {
    v = JSON.parse(buf.toString() || "{}");
  } catch {
    throw new V.ErrorEntrada("cuerpo JSON inválido");
  }
  if (v === null || typeof v !== "object" || Array.isArray(v))
    throw new V.ErrorEntrada("cuerpo JSON inválido");
  return v;
}

const json = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
};
const html = (res, status, cuerpo) => {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(cuerpo);
};
const redirigir = (res, a) => {
  res.writeHead(303, { location: a });
  res.end();
};
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

function panel() {
  const filas = [...partidas.values()]
    .map((p) => {
      const miniatura = (k) =>
        k
          ? `<img src="/__foto?key=${encodeURIComponent(k)}" alt="" style="width:56px;height:42px;object-fit:cover;border-radius:6px">`
          : "—";
      const accion =
        p.estado === "propuesta"
          ? `<form method="post" action="/__panel/autorizar?partidaId=${encodeURIComponent(p.partidaId)}"><button>Autorizar como Riesgos</button></form>`
          : "";
      return `<tr><td>${esc(p.descripcion)}</td><td>${esc(p.tipo)}</td><td><b>${esc(p.estado)}</b></td><td>${miniatura((p.fotos || [])[0])}</td><td>${miniatura((p.evidenciaFinal || [])[0])}</td><td>${accion}</td></tr>`;
    })
    .join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Panel · Riesgos simulado</title>
<body style="font:14px/1.5 system-ui;max-width:900px;margin:24px auto;padding:0 16px;color:#0f172a">
<h1 style="font-size:18px">Riesgos simulado · vista local</h1>
<p>Esto <b>no</b> es Fleet: es solo para autorizar hallazgos de la demo y ver cómo cambia la liga. <a href="/" target="_blank">Abrir la liga</a></p>
<table style="border-collapse:collapse;width:100%" border="1" cellpadding="6"><tr><th>Hallazgo</th><th>Tipo</th><th>Estado</th><th>Antes</th><th>Después</th><th></th></tr>${filas}</table>
<form method="post" action="/__panel/reiniciar" style="margin-top:16px"><button>Reiniciar la demo</button></form>
</body>`;
}

async function atender(req, res) {
  const url = new URL(req.url, "http://local");
  const ruta = url.pathname;
  const metodo = String(req.method).toUpperCase();
  try {
    if (metodo === "GET" && ruta === "/") return html(res, 200, paginaProveedor("vista-local"));
    if (metodo === "GET" && ruta === "/api/visita") return json(res, 200, leerVisita());
    if (metodo === "GET" && ruta === "/api/foto") {
      const key = url.searchParams.get("key") || "";
      if (!V.llaveFotoValida(TENANT, VISITA_KEY, key))
        throw new V.ErrorEntrada("llave de foto no válida");
      return json(res, 200, { url: `/__foto?key=${encodeURIComponent(key)}` });
    }
    if (metodo === "GET" && ruta === "/__foto") {
      const f = fotos.get(url.searchParams.get("key") || "");
      if (!f) return json(res, 404, { error: "no encontrada" });
      res.writeHead(200, { "content-type": f.mime, "cache-control": "no-store" });
      return res.end(f.bytes);
    }
    if (metodo === "POST" && ruta === "/api/subida") {
      const b = cuerpoObjeto(await leerCuerpo(req));
      if (!V.MIMES_FOTO.includes(String(b.mime)))
        return json(res, 400, { error: "tipo de archivo no permitido" });
      V.validarTamanoFoto(b.tamano);
      const key = V.llaveFoto(TENANT, VISITA_KEY, randomUUID(), String(b.mime));
      return json(res, 200, { url: `/__subir?key=${encodeURIComponent(key)}`, key });
    }
    if (metodo === "PUT" && ruta === "/__subir") {
      const key = url.searchParams.get("key") || "";
      if (!V.llaveFotoValida(TENANT, VISITA_KEY, key))
        return json(res, 400, { error: "llave no válida" });
      fotos.set(key, {
        mime: String(req.headers["content-type"] || "image/jpeg"),
        bytes: await leerCuerpo(req),
      });
      res.writeHead(200);
      return res.end();
    }
    if (metodo === "POST" && ruta === "/api/partida") {
      const b = cuerpoObjeto(await leerCuerpo(req));
      const datos = V.validarPartidaEntrante(b);
      const llaves = Array.isArray(b.fotos) ? b.fotos.map(String) : [];
      for (const k of llaves)
        if (!V.llaveFotoValida(TENANT, VISITA_KEY, k))
          throw new V.ErrorEntrada("llave de foto no válida");
      const partidaId = randomUUID();
      partidas.set(partidaId, {
        tenantId: TENANT,
        visitaKey: VISITA_KEY,
        partidaId,
        ...datos,
        estado: "borrador",
        fotos: llaves,
        evidenciaFinal: [],
        terminadoEn: null,
        precioAutorizado: null,
        motivoRechazo: null,
        version: 1,
      });
      return json(res, 200, { partidaId, fotos: llaves });
    }
    if (metodo === "POST" && ruta === "/api/enviar") {
      let enviadas = 0;
      for (const p of partidas.values())
        if (p.estado === "borrador") {
          p.estado = "propuesta";
          enviadas++;
        }
      return json(res, 200, { enviadas });
    }
    if (metodo === "POST" && ruta === "/api/visita") {
      const b = cuerpoObjeto(await leerCuerpo(req));
      if (b.km !== undefined) {
        if (!V.esKmValido(b.km)) throw new V.ErrorEntrada("Kilometraje no válido");
        visita.km = Number(b.km);
      }
      if (b.fsalidaEst !== undefined) visita.fsalidaEst = String(b.fsalidaEst);
      if (b.estadoOperativo !== undefined) visita.estadoOperativo = String(b.estadoOperativo);
      return json(res, 200, { ok: true });
    }
    if (metodo === "POST" && ruta === "/api/terminar") {
      const b = cuerpoObjeto(await leerCuerpo(req));
      const p = partidas.get(String(b.partidaId ?? ""));
      const cambios = V.decidirTerminacion(
        TENANT,
        VISITA_KEY,
        p,
        b.fotos,
        new Date().toISOString(),
      );
      if (cambios) Object.assign(p, cambios);
      const proy = V.proyectarPartidaParaTaller(p);
      return json(res, 200, {
        partidaId: proy.partidaId,
        estado: proy.estado,
        evidenciaFinal: proy.evidenciaFinal,
        terminadoEn: proy.terminadoEn,
      });
    }
    if (metodo === "GET" && ruta === "/__panel") return html(res, 200, panel());
    if (metodo === "POST" && ruta === "/__panel/autorizar") {
      const p = partidas.get(url.searchParams.get("partidaId") || "");
      if (p && p.estado === "propuesta") {
        p.estado = "autorizada";
        p.precioAutorizado = p.precio;
      }
      return redirigir(res, "/__panel");
    }
    if (metodo === "POST" && ruta === "/__panel/reiniciar") {
      reiniciar();
      return redirigir(res, "/__panel");
    }
    return json(res, 404, { error: "no encontrado" });
  } catch (e) {
    if (e instanceof V.ErrorConflicto) return json(res, 409, { error: e.message });
    if (e instanceof V.ErrorEntrada) return json(res, 400, { error: e.message });
    console.error("[preview-liga]", e);
    return json(res, 500, { error: "error interno" });
  }
}

const servidor = http.createServer((req, res) => {
  void atender(req, res);
});
await new Promise((ok) => servidor.listen(PUERTO, EN_RED ? "0.0.0.0" : "127.0.0.1", ok));

async function cerrar(codigo) {
  servidor.close();
  await vite.close();
  process.exit(codigo);
}

if (SMOKE) {
  const base = `http://127.0.0.1:${PUERTO}`;
  const pedir = async (ruta, metodo = "GET", body) => {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const tipo = r.headers.get("content-type") || "";
    return { status: r.status, body: tipo.includes("json") ? await r.json() : await r.text() };
  };
  const fallas = [];
  const espera = (nombre, ok) => {
    console.log(`${ok ? "✓" : "✗"} ${nombre}`);
    if (!ok) fallas.push(nombre);
  };
  const pag = await pedir("/");
  espera(
    "la página real de la liga se sirve",
    pag.status === 200 && String(pag.body).includes("Subir foto del trabajo terminado"),
  );
  const v = await pedir("/api/visita");
  espera(
    "la visita trae 5 hallazgos, todos con evidenciaFinal y terminadoEn",
    v.status === 200 &&
      v.body.partidas.length === 5 &&
      v.body.partidas.every((p) => "evidenciaFinal" in p && "terminadoEn" in p),
  );
  const mo = await pedir("/api/terminar", "POST", { partidaId: "p-freno-mano", fotos: [] });
  espera("mano de obra se termina sin foto", mo.status === 200 && mo.body.estado === "terminada");
  const mo2 = await pedir("/api/terminar", "POST", { partidaId: "p-freno-mano", fotos: [] });
  espera("el reintento idéntico responde 200", mo2.status === 200);
  const sinFoto = await pedir("/api/terminar", "POST", { partidaId: "p-balatas-del", fotos: [] });
  espera("refacción sin foto ⇒ 400", sinFoto.status === 400);
  const prop = await pedir("/api/terminar", "POST", { partidaId: "p-amortiguador", fotos: [] });
  espera("propuesta ⇒ 400", prop.status === 400);
  const firma = await pedir("/api/subida", "POST", { mime: "image/jpeg", tamano: 3 });
  const put = await fetch(base + firma.body.url, {
    method: "PUT",
    headers: { "content-type": "image/jpeg" },
    body: Buffer.from([1, 2, 3]),
  });
  espera("la subida simulada guarda la foto", firma.status === 200 && put.status === 200);
  const ok = await pedir("/api/terminar", "POST", {
    partidaId: "p-balatas-del",
    fotos: [firma.body.key],
  });
  espera(
    "refacción con foto se termina",
    ok.status === 200 && ok.body.evidenciaFinal[0] === firma.body.key,
  );
  const conflicto = await pedir("/api/terminar", "POST", { partidaId: "p-balatas-del", fotos: [] });
  espera("cambiar el después de una terminada ⇒ 409", conflicto.status === 409);
  await cerrar(fallas.length ? 1 : 0);
} else {
  console.log("\nVista local de la liga (datos inventados; nada sale de tu computadora):");
  console.log(`  Liga del taller:      http://localhost:${PUERTO}/`);
  console.log(`  Riesgos simulado:     http://localhost:${PUERTO}/__panel`);
  if (EN_RED) {
    for (const lista of Object.values(os.networkInterfaces())) {
      for (const i of lista || []) {
        if (i.family === "IPv4" && !i.internal)
          console.log(`  Desde el celular:     http://${i.address}:${PUERTO}/`);
      }
    }
  }
  console.log("\nCtrl+C para cerrar.");
  process.on("SIGINT", () => void cerrar(0));
}
```

- [ ] **Step 2: Agregar el script de npm**

En `package.json`, dentro de `"scripts"`, agrega (junto a `"dev"`):

```json
    "preview:liga": "node scripts/preview-liga-local.mjs",
```

- [ ] **Step 3: Correr la autoprueba**

Run: `node scripts/preview-liga-local.mjs --smoke`
Expected: 9 líneas con `✓` y código de salida 0. Si alguna sale `✗`, el servidor simulado se apartó de las reglas reales: corrige el script, no la regla.

- [ ] **Step 4: Probarlo a mano una vez**

Run: `npm run preview:liga` y abre `http://localhost:5180/`. Toca "✓ Marcar como terminado" en "Ajuste de freno de mano": debe quedar Terminada. En `http://localhost:5180/__panel`, autoriza "Amortiguador trasero con fuga" y recarga la liga: debe aparecer su botón "📷 Subir foto del trabajo terminado". Cierra con Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add scripts/preview-liga-local.mjs package.json
git commit -m "chore(taller): vista local de la liga con las mismas reglas del portal" -m "npm run preview:liga sirve la página real contra un servidor simulado en memoria (decidirTerminacion, proyectarPartidaParaTaller, validarPartidaEntrante) y un panel de Riesgos simulado; --red para el celular, --smoke se prueba solo." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Capa pura de Fleet — la partida trae su después y el aviso se calcula en `src/`

**Files:**

- Modify: `src/taller/partidas.ts` (tipo `Partida`, funciones nuevas tras `montoPendienteDeFirma`)
- Modify: `src/api/tallerPartidas.ts` (`rowToPartida`, línea ~229)
- Modify: `src/api/cloudHydrate.ts` (declaración en `interface Window`, junto a `__pendientesDeFirma`)
- Modify: `src/api/cloudWire.ts` (import de la línea 46; asignación junto a `window.__resumenPartidas`)
- Test: `tests/tallerAntesDespuesPuro.test.ts` (nuevo)

**Interfaces:**

- Produces:
  - `Partida.evidenciaFinal?: string[]`
  - `refaccionesSinDespues(ps: Partida[]): Partida[]`
  - `avisoSinDespues(ps: Partida[]): string` — `""` si no falta ninguna.
  - `window.__avisoSinDespues?: (ps: Partida[]) => string`, publicado en `cloudWire.ts`, que corre siempre, también con `?e2e=1`.

**Nota sobre el spec §6.1:** el spec proponía publicar `window.__refaccionesSinDespues` desde `cloudHydrate.ts`. Aquí se publica `window.__avisoSinDespues`, que devuelve el texto ya armado, y desde `cloudWire.ts`. Dos razones: el monolito no compone el texto (la regla y la redacción quedan en `src/`, con pruebas), y `cloudHydrate` solo publica sus puentes al hidratar desde la nube, lo que no pasa en la vista local (`?e2e=1`).

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `tests/tallerAntesDespuesPuro.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { avisoSinDespues, refaccionesSinDespues, type Partida } from "../src/taller/partidas";
import { mapPartidas } from "../src/api/tallerPartidas";

const P = (sobre: Partial<Partida> = {}): Partida => ({
  partidaId: "p",
  visitaKey: "vk",
  descripcion: "Balatas delanteras",
  estado: "autorizada",
  tipo: "refaccion",
  fotos: [],
  precioAutorizado: 1850,
  ...sobre,
});

describe("refaccionesSinDespues", () => {
  it("cuenta solo refacciones AUTORIZADAS", () => {
    const ps = [
      P({ partidaId: "a" }),
      P({ partidaId: "b", estado: "propuesta" }),
      P({ partidaId: "c", estado: "rechazada" }),
    ];
    expect(refaccionesSinDespues(ps).map((p) => p.partidaId)).toEqual(["a"]);
  });
  it("una fila vieja sin tipo cuenta como refacción (el caso estricto)", () => {
    const sinTipo: Partida = {
      partidaId: "v",
      visitaKey: "vk",
      descripcion: "Balatas",
      estado: "autorizada",
      fotos: [],
    };
    expect(refaccionesSinDespues([sinTipo])).toHaveLength(1);
  });
  it("mano de obra autorizada NO cuenta: su foto es opcional", () => {
    expect(refaccionesSinDespues([P({ tipo: "manoObra" })])).toEqual([]);
  });
  it("una terminada nunca cuenta", () => {
    expect(refaccionesSinDespues([P({ estado: "terminada", evidenciaFinal: ["x.jpg"] })])).toEqual(
      [],
    );
  });
});

describe("avisoSinDespues", () => {
  it("'' cuando no falta ninguna", () => {
    expect(avisoSinDespues([])).toBe("");
    expect(avisoSinDespues([P({ estado: "terminada" })])).toBe("");
  });
  it("una: la nombra con su monto firmado", () => {
    expect(avisoSinDespues([P()])).toBe(
      "⚠ 1 refacción autorizada no tiene foto del después: Balatas delanteras ($1,850.00).\nSi la finalizas, la liga del taller se cierra y ya no podrá subirla.",
    );
  });
  it("hasta tres se nombran; sin monto firmado, solo la descripción", () => {
    const sinMonto: Partida = {
      partidaId: "b",
      visitaKey: "vk",
      descripcion: "Amortiguador",
      estado: "autorizada",
      tipo: "refaccion",
      fotos: [],
    };
    const t = avisoSinDespues([
      P({ partidaId: "a" }),
      sinMonto,
      P({ partidaId: "c", descripcion: "Rótula", precioAutorizado: 980 }),
    ]);
    expect(t).toContain("⚠ 3 refacciones autorizadas no tienen foto del después: ");
    expect(t).toContain("Balatas delanteras ($1,850.00), Amortiguador, Rótula ($980.00).");
  });
  it("más de tres: solo el número", () => {
    const t = avisoSinDespues(["a", "b", "c", "d"].map((id) => P({ partidaId: id })));
    expect(t.startsWith("⚠ 4 refacciones autorizadas no tienen foto del después.\n")).toBe(true);
    expect(t).not.toContain("Balatas");
  });
  it("descripción vacía ⇒ (sin descripción)", () => {
    expect(avisoSinDespues([P({ descripcion: "" })])).toContain("(sin descripción)");
  });
});

describe("mapPartidas — evidenciaFinal llega a Fleet", () => {
  const fila = (sobre: Record<string, unknown>) =>
    ({
      tenantId: "demo",
      visitaKey: "vk",
      partidaId: "p",
      descripcion: "x",
      precio: 1,
      estado: "terminada",
      fotos: [],
      ...sobre,
    }) as unknown as Parameters<typeof mapPartidas>[0][number];

  it("mapea evidenciaFinal y tira nulos; ausente ⇒ []", () => {
    const [a, b] = mapPartidas([
      fila({ evidenciaFinal: ["d.jpg", null] }),
      fila({ evidenciaFinal: null }),
    ]);
    expect(a!.evidenciaFinal).toEqual(["d.jpg"]);
    expect(b!.evidenciaFinal).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/tallerAntesDespuesPuro.test.ts`
Expected: FAIL — `avisoSinDespues`/`refaccionesSinDespues` no existen y `evidenciaFinal` llega `undefined`.

- [ ] **Step 3: Implementar**

(a) En `src/taller/partidas.ts`, dentro de `type Partida`, justo después de `fotos: string[];`:

```ts
  /** Antes y después (spec 2026-09-28): llaves de la foto del trabajo terminado.
   *  Las sube el taller desde la liga al terminar un hallazgo autorizado. */
  evidenciaFinal?: string[];
```

Y después de `export function montoPendienteDeFirma(…) { … }`:

```ts
/**
 * Antes y después (spec 2026-09-28, decisiones 3 y 6): refacciones AUTORIZADAS que
 * todavía no tienen foto del trabajo terminado. Una `terminada` nunca cuenta (ya tiene
 * su después, o es mano de obra terminada sin foto) y la mano de obra autorizada
 * tampoco: su foto es opcional. Una partida sin `tipo` (fila vieja) cuenta como
 * refacción, el caso estricto, igual que el portal (`decidirTerminacion`).
 */
export function refaccionesSinDespues(ps: Partida[]): Partida[] {
  return ps.filter((p) => p.estado === "autorizada" && p.tipo !== "manoObra");
}

const fmtMontoAviso = (n: number): string =>
  "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * El renglón que se suma al confirm de "Finalizar" y al guardar la salida (spec §6.2):
 * avisa, no bloquea. `""` si no falta ninguna foto. Hasta 3 refacciones se nombran con
 * su monto firmado; con más, solo el número. El monolito solo PINTA este texto.
 */
export function avisoSinDespues(ps: Partida[]): string {
  const faltan = refaccionesSinDespues(ps);
  if (!faltan.length) return "";
  const n = faltan.length;
  const cabeza =
    n === 1
      ? "⚠ 1 refacción autorizada no tiene foto del después"
      : `⚠ ${n} refacciones autorizadas no tienen foto del después`;
  const detalle =
    n <= 3
      ? ": " +
        faltan
          .map((p) => {
            const d = p.descripcion || "(sin descripción)";
            const m = p.precioAutorizado;
            return typeof m === "number" && Number.isFinite(m) ? `${d} (${fmtMontoAviso(m)})` : d;
          })
          .join(", ")
      : "";
  return `${cabeza}${detalle}.\nSi la finalizas, la liga del taller se cierra y ya no podrá subirla.`;
}
```

(b) En `src/api/tallerPartidas.ts`, dentro de `rowToPartida`, justo después de la línea de `fotos:`:

```ts
    evidenciaFinal: (r.evidenciaFinal ?? []).filter((f): f is string => typeof f === "string"),
```

(c) En `src/api/cloudHydrate.ts`, dentro de `interface Window`, justo después de `__pendientesDeFirma?: (ps: Partida[]) => number;`:

```ts
    /** Antes y después (spec 2026-09-28 §6.2): el renglón del aviso al cerrar una visita
     *  con refacciones autorizadas sin foto del después ("" si no falta ninguna).
     *  Lo publica cloudWire.ts (corre siempre, también en ?e2e=1). */
    __avisoSinDespues?: (ps: Partida[]) => string;
```

(d) En `src/api/cloudWire.ts`, cambia `import { mensajeWhatsApp, type Partida } from "../taller/partidas";` por `import { avisoSinDespues, mensajeWhatsApp, type Partida } from "../taller/partidas";`, y justo después de `window.__resumenPartidas = resumenPartidas;` agrega:

```ts
// Antes y después (spec 2026-09-28 §6.2): el aviso al cerrar se calcula en src/.
window.__avisoSinDespues = avisoSinDespues;
```

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run tests/tallerAntesDespuesPuro.test.ts tests/tallerPartidas.test.ts tests/tallerPartidasApi.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/taller/partidas.ts src/api/tallerPartidas.ts src/api/cloudHydrate.ts src/api/cloudWire.ts tests/tallerAntesDespuesPuro.test.ts
git commit -m "feat(taller): Fleet recibe el después de cada hallazgo y calcula el aviso en la capa pura" -m "evidenciaFinal en Partida y en rowToPartida; refaccionesSinDespues y avisoSinDespues (nombra hasta 3 con su monto firmado), publicado como window.__avisoSinDespues." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Visor A+ — antes y después lado a lado

**Files:**

- Modify: `src/taller/visorFotos.ts` (exportar `fechaCorta`, `GrupoFotos` y `abrirVisorAntesDespues`)
- Modify: `src/api/cloudWire.ts` (import de la línea 34; puentes junto a `window.__abrirVisorFotos`, línea ~574)
- Modify: `src/api/cloudHydrate.ts` (declaración de `__abrirVisorAntesDespues` junto a `__abrirVisorFotos`)
- Test: `tests/tallerVisorAntesDespues.test.ts` (nuevo)

**Interfaces:**

- Consumes: `urlFotoPartida` (existente) y `window.__urlFotoPartida` (existente).
- Produces:
  - `type GrupoFotos = { llaves: readonly string[]; fecha?: string }`
  - `fechaCorta(iso: string | null | undefined): string` → `"14 sep"` o `""`
  - `abrirVisorAntesDespues(opts: { antes: GrupoFotos; despues: GrupoFotos; titulo?: string; subtitulo?: string; url: (llave: string) => Promise<string | null> }): void` — overlay `#taller-visor-antes-despues`.
  - `window.__abrirVisorAntesDespues?: (opts: { antes: GrupoFotos; despues: GrupoFotos; titulo?: string; subtitulo?: string }) => void`

**Nota sobre el spec §6.4:** el spec describe el A+ como "un modo" de `abrirVisorFotos`. Aquí va como función hermana en el mismo módulo, que comparte la instancia viva (`cerrarActual`). El comportamiento es el mismo, y las llamadas actuales a `abrirVisorFotos` no se tocan.

**Costura para la vista local (Task 9):** los dos puentes resuelven la URL con `window.__urlFotoPartida ?? urlFotoPartida`. En producción las dos referencias son la MISMA función (cloudHydrate publica `window.__urlFotoPartida = urlFotoPartida`), así que no cambia nada; en la demo local, el doble de `window.__urlFotoPartida` sirve dibujos en lugar de S3.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `tests/tallerVisorAntesDespues.test.ts`:

```ts
// Visor A+ (spec 2026-09-28 §6.4): se construye con createElement y vive en happy-dom.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { abrirVisorAntesDespues, abrirVisorFotos, fechaCorta } from "../src/taller/visorFotos";

const url = vi.fn(async (k: string) => `https://ejemplo.test/${k}`);

beforeEach(() => {
  // eslint-disable-next-line no-restricted-syntax -- limpieza de prueba, string literal controlado
  document.body.innerHTML = "";
  url.mockClear();
});

async function asentar() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

const abrir = (sobre: Partial<Parameters<typeof abrirVisorAntesDespues>[0]> = {}) =>
  abrirVisorAntesDespues({
    antes: { llaves: ["a1.jpg", "a2.jpg"], fecha: "2026-09-14" },
    despues: { llaves: ["d1.jpg"], fecha: "2026-09-16T15:00:00.000Z" },
    titulo: "Balatas traseras",
    subtitulo: "Refacción · $1,650.00 · terminada el 16/09/2026",
    url,
    ...sobre,
  });

const visor = () => document.querySelector<HTMLElement>("#taller-visor-antes-despues");
const imgs = () => Array.from(visor()!.querySelectorAll<HTMLImageElement>("img[data-lado]"));

describe("fechaCorta", () => {
  it("una fecha sola se lee tal cual (no se corre un día en México)", () => {
    expect(fechaCorta("2026-09-14")).toBe("14 sep");
  });
  it("un instante ISO usa el día local", () => {
    expect(fechaCorta("2026-09-16T15:00:00.000Z")).toBe("16 sep");
  });
  it.each([undefined, null, "", "basura", "2026-13-01"])("%j ⇒ '' (nunca 'Invalid Date')", (v) => {
    expect(fechaCorta(v as string | undefined)).toBe("");
  });
});

describe("visor A+ — antes y después", () => {
  it("abre con las dos columnas, su fecha y su conteo", async () => {
    abrir();
    await asentar();
    const v = visor();
    expect(v).not.toBeNull();
    expect(v!.getAttribute("role")).toBe("dialog");
    expect(v!.textContent).toContain("ANTES · 14 sep · 2 fotos");
    expect(v!.textContent).toContain("DESPUÉS · 16 sep · 1 foto");
    expect(v!.textContent).toContain("Balatas traseras");
  });

  it("pide la primera foto de cada lado y la pinta en su columna", async () => {
    abrir();
    await asentar();
    const [antes, despues] = imgs();
    expect(antes!.src).toBe("https://ejemplo.test/a1.jpg");
    expect(despues!.src).toBe("https://ejemplo.test/d1.jpg");
  });

  it("la tira cambia SOLO su lado", async () => {
    abrir();
    await asentar();
    const miniaturas = Array.from(
      visor()!.querySelectorAll<HTMLButtonElement>("button[data-miniatura]"),
    );
    const segundaAntes = miniaturas.find(
      (b) => b.getAttribute("aria-label") === "antes: foto 2 de 2",
    );
    expect(segundaAntes).toBeDefined();
    segundaAntes!.click();
    await asentar();
    const [antes, despues] = imgs();
    expect(antes!.src).toBe("https://ejemplo.test/a2.jpg");
    expect(despues!.src).toBe("https://ejemplo.test/d1.jpg");
  });

  it("un lado vacío (mano de obra sin foto) dice 'Sin foto' y no rompe nada", async () => {
    abrir({ despues: { llaves: [], fecha: "2026-09-16" } });
    await asentar();
    expect(visor()!.textContent).toContain("DESPUÉS · 16 sep · sin foto");
    expect(visor()!.textContent).toContain("Sin foto");
  });

  it("sin fecha, la leyenda no inventa una (Review Focus 3)", async () => {
    abrir({ antes: { llaves: ["a1.jpg"] } });
    await asentar();
    expect(visor()!.textContent).toContain("ANTES · 1 foto");
    expect(visor()!.textContent).not.toContain("Invalid");
  });

  it("sin ninguna foto de ningún lado no abre nada", () => {
    abrir({ antes: { llaves: [] }, despues: { llaves: [] } });
    expect(visor()).toBeNull();
  });

  it("Esc cierra y limpia el DOM", () => {
    abrir();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(visor()).toBeNull();
  });

  it("abrir el visor simple cierra el A+ (un solo visor vivo)", () => {
    abrir();
    abrirVisorFotos({ llaves: ["x.jpg"], url });
    expect(visor()).toBeNull();
    expect(document.querySelector("#taller-visor-fotos")).not.toBeNull();
  });

  it("el título viaja como texto, nunca como HTML", () => {
    abrir({ titulo: '<img src="x" onerror="alert(1)">' });
    expect(visor()!.querySelector('img[src="x"]')).toBeNull();
    expect(visor()!.textContent).toContain('<img src="x"');
  });

  it("el foco queda atrapado: Tab desde el último botón vuelve al primero", () => {
    abrir();
    const botones = Array.from(visor()!.querySelectorAll("button"));
    const ultimo = botones[botones.length - 1]!;
    ultimo.focus();
    const ev = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(botones[0]);
  });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/tallerVisorAntesDespues.test.ts`
Expected: FAIL — `abrirVisorAntesDespues`/`fechaCorta` no se exportan.

- [ ] **Step 3: Implementar en `visorFotos.ts`**

Agrega al final de `src/taller/visorFotos.ts`:

```ts
export type GrupoFotos = { llaves: readonly string[]; fecha?: string };

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * "14 sep" desde una fecha ISO. Una fecha SOLA (YYYY-MM-DD) se lee tal cual: `new Date`
 * la tomaría como medianoche UTC y en México saldría el día anterior. Un instante ISO usa
 * el día local. Ausente o inválida ⇒ "" (nunca "Invalid Date").
 */
export function fechaCorta(iso: string | null | undefined): string {
  const s = String(iso ?? "").trim();
  if (!s) return "";
  const sola = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (sola) {
    const mes = MESES[Number(sola[2]) - 1];
    return mes ? `${Number(sola[3])} ${mes}` : "";
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

const ID_ANTES_DESPUES = "taller-visor-antes-despues";

/** Una columna del A+: foto grande, leyenda y tira de miniaturas que cambia SOLO su lado. */
function columnaGrupo(
  etiqueta: "ANTES" | "DESPUÉS",
  color: string,
  g: GrupoFotos,
  url: (llave: string) => Promise<string | null>,
  alCerrar: Array<() => void>,
): HTMLElement {
  const lado = etiqueta === "ANTES" ? "antes" : "despues";
  const col = document.createElement("div");
  col.style.cssText = "display:flex;flex-direction:column;gap:8px;min-width:0";

  const marco = document.createElement("div");
  marco.style.cssText =
    "flex:1;min-height:240px;border-radius:10px;background:#1a2234;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative";
  const img = document.createElement("img");
  img.dataset.lado = lado;
  img.alt = `Foto de ${etiqueta === "ANTES" ? "antes" : "después"}`;
  img.style.cssText = "max-width:100%;max-height:70vh;object-fit:contain";
  const aviso = document.createElement("span");
  aviso.style.cssText = "font-size:12px;color:#94a3b8;position:absolute";
  marco.append(img, aviso);

  const n = g.llaves.length;
  const leyenda = document.createElement("div");
  leyenda.style.cssText = `font-size:11px;font-weight:800;letter-spacing:.05em;color:${color}`;
  leyenda.textContent = [
    etiqueta,
    fechaCorta(g.fecha),
    n ? `${n} foto${n === 1 ? "" : "s"}` : "sin foto",
  ]
    .filter(Boolean)
    .join(" · ");
  col.append(marco, leyenda);

  if (!n) {
    img.style.display = "none";
    aviso.textContent = "Sin foto";
    return col;
  }

  let generacion = 0;
  alCerrar.push(() => {
    generacion++; // invalida respuestas en vuelo
  });
  const pintar = (i: number): void => {
    const gen = ++generacion;
    img.removeAttribute("src");
    aviso.textContent = "Cargando…";
    void url(g.llaves[i] as string)
      .then((u) => {
        if (gen !== generacion) return;
        if (!u) {
          aviso.textContent = "Foto no disponible";
          return;
        }
        img.src = u;
        aviso.textContent = "";
      })
      .catch(() => {
        if (gen !== generacion) return;
        aviso.textContent = "Foto no disponible";
      });
  };
  img.onerror = () => {
    aviso.textContent = "Foto no disponible";
  };

  if (n > 1) {
    const tira = document.createElement("div");
    tira.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
    const botones: HTMLButtonElement[] = [];
    const marcar = (i: number): void => {
      botones.forEach((b, j) => {
        b.style.borderColor = j === i ? "#60a5fa" : "transparent";
        b.setAttribute("aria-pressed", j === i ? "true" : "false");
      });
    };
    g.llaves.forEach((llave, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.miniatura = lado;
      b.setAttribute(
        "aria-label",
        `${lado === "antes" ? "antes" : "después"}: foto ${i + 1} de ${n}`,
      );
      b.style.cssText =
        "width:56px;height:44px;padding:0;border-radius:8px;border:2px solid transparent;background:rgba(226,232,240,.12);color:#e2e8f0;cursor:pointer;overflow:hidden;font-weight:700";
      b.textContent = String(i + 1);
      void url(llave)
        .then((u) => {
          if (!u) return;
          const mini = document.createElement("img");
          mini.alt = "";
          mini.src = u;
          mini.style.cssText = "width:100%;height:100%;object-fit:cover;display:block";
          b.replaceChildren(mini);
        })
        .catch(() => {
          // Se queda el número: la miniatura es cortesía, la foto grande manda.
        });
      b.addEventListener("click", () => {
        marcar(i);
        pintar(i);
      });
      botones.push(b);
      tira.appendChild(b);
    });
    marcar(0);
    col.appendChild(tira);
  }
  pintar(0);
  return col;
}

/**
 * Visor A+ (spec 2026-09-28 §6.4, decisión 7): ANTES y DESPUÉS lado a lado, cada lado con
 * su foto grande, su leyenda ("ANTES · 14 sep · 2 fotos") y su tira de miniaturas. Es el
 * mismo overlay de pantalla completa que el visor simple (trampa de foco, Esc, un solo
 * visor vivo): abrir uno cierra el otro. Un lado sin fotos dice "Sin foto".
 * Reglas del repo: cero innerHTML; URLs firmadas por demanda con la misma `url`.
 */
export function abrirVisorAntesDespues(opts: {
  antes: GrupoFotos;
  despues: GrupoFotos;
  titulo?: string;
  subtitulo?: string;
  url: (llave: string) => Promise<string | null>;
}): void {
  const { antes, despues, titulo, subtitulo, url } = opts;
  if (!antes.llaves.length && !despues.llaves.length) return;
  cerrarActual?.();
  const devolverFoco = document.activeElement as HTMLElement | null;

  const overlay = document.createElement("div");
  overlay.id = ID_ANTES_DESPUES;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Antes y después del hallazgo");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:9999;background:rgba(11,15,25,.92);display:flex;flex-direction:column;gap:12px;padding:16px 24px;overflow:auto";

  const cabecera = document.createElement("div");
  cabecera.style.cssText =
    "display:flex;align-items:flex-start;justify-content:space-between;gap:12px";
  const textos = document.createElement("div");
  textos.style.cssText = "display:flex;flex-direction:column;gap:2px;min-width:0";
  const t1 = document.createElement("span");
  t1.style.cssText = "font-size:13px;font-weight:700;color:#e2e8f0";
  t1.textContent = titulo ?? "Antes y después";
  const t2 = document.createElement("span");
  t2.style.cssText = "font-size:11px;color:#94a3b8";
  t2.textContent = subtitulo ?? "";
  textos.append(t1, t2);
  const btnCerrar = document.createElement("button");
  btnCerrar.type = "button";
  btnCerrar.setAttribute("aria-label", "Cerrar");
  btnCerrar.textContent = "✕";
  btnCerrar.style.cssText =
    "min-width:44px;min-height:44px;border-radius:6px;border:1px solid rgba(148,170,205,.25);background:transparent;color:#e2e8f0;cursor:pointer;font-size:14px";
  cabecera.append(textos, btnCerrar);

  const alCerrar: Array<() => void> = [];
  const columnas = document.createElement("div");
  columnas.style.cssText =
    "display:grid;grid-template-columns:1fr 1fr;gap:16px;flex:1;min-height:0";
  columnas.append(
    columnaGrupo("ANTES", "#fda4af", antes, url, alCerrar),
    columnaGrupo("DESPUÉS", "#86efac", despues, url, alCerrar),
  );
  overlay.append(cabecera, columnas);

  function cerrar(): void {
    if (cerrarActual === cerrar) cerrarActual = null;
    alCerrar.forEach((f) => f());
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    devolverFoco?.focus?.();
  }
  cerrarActual = cerrar;

  function onKey(ev: KeyboardEvent): void {
    if (ev.key === "Escape") cerrar();
    else if (ev.key === "Tab") {
      const focos = Array.from(overlay.querySelectorAll("button"));
      if (!focos.length) return;
      const primero = focos[0]!;
      const ultimo = focos[focos.length - 1]!;
      const activo = document.activeElement;
      const dentro = activo != null && overlay.contains(activo);
      if (ev.shiftKey) {
        if (!dentro || activo === primero) {
          ev.preventDefault();
          ultimo.focus();
        }
      } else if (!dentro || activo === ultimo) {
        ev.preventDefault();
        primero.focus();
      }
    }
  }

  btnCerrar.addEventListener("click", cerrar);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) cerrar();
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  btnCerrar.focus();
}
```

- [ ] **Step 4: Publicar el puente**

(a) En `src/api/cloudWire.ts`, cambia `import { abrirVisorFotos } from "../taller/visorFotos";` por `import { abrirVisorAntesDespues, abrirVisorFotos } from "../taller/visorFotos";` y reemplaza el bloque del puente `window.__abrirVisorFotos = (opts) => abrirVisorFotos({ …, url: (llave) => urlFotoPartida(llave) });` por:

```ts
// Visor de fotos (bloque Proveedor y bandeja de entrada). La URL firmada sale
// del mismo puente que ya usa la miniatura: por demanda, nunca un índice.
// `window.__urlFotoPartida ?? urlFotoPartida`: en producción son la MISMA función
// (cloudHydrate publica una en la otra); la costura existe para que la vista local
// (spec 2026-09-28 §8.1) pueda servir dibujos en lugar de S3.
const urlFoto = (llave: string) => (window.__urlFotoPartida ?? urlFotoPartida)(llave);
window.__abrirVisorFotos = (opts) => abrirVisorFotos({ ...opts, url: urlFoto });
// Visor A+ antes|después (spec 2026-09-28 §6.4).
window.__abrirVisorAntesDespues = (opts) => abrirVisorAntesDespues({ ...opts, url: urlFoto });
```

(b) En `src/api/cloudHydrate.ts`, dentro de `interface Window`, justo después de la declaración de `__abrirVisorFotos`:

```ts
    /** Visor A+ antes|después (spec 2026-09-28 §6.4). Lo monta src/taller/visorFotos.ts. */
    __abrirVisorAntesDespues?: (opts: {
      antes: { llaves: readonly string[]; fecha?: string };
      despues: { llaves: readonly string[]; fecha?: string };
      titulo?: string;
      subtitulo?: string;
    }) => void;
```

- [ ] **Step 5: Correr y ver que pasan**

Run: `npx vitest run tests/tallerVisorAntesDespues.test.ts tests/tallerVisorFotos.test.ts`
Expected: PASS (el visor simple sigue verde).
Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/taller/visorFotos.ts src/api/cloudWire.ts src/api/cloudHydrate.ts tests/tallerVisorAntesDespues.test.ts
git commit -m "feat(taller): visor A+ — antes y después lado a lado, con su tira por lado" -m "abrirVisorAntesDespues comparte la instancia viva del visor simple; fechaCorta no corre fechas solas un día ni pinta Invalid Date; un lado vacío dice Sin foto. Puente window.__abrirVisorAntesDespues." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Monolito — la fila del registro y el aviso al cerrar

**Files:**

- Modify: `Control de flotilla.html` (`_partidasDeVisita` ~7800 → helper nuevo debajo; `_provFilaHistorial` ~8023; `finalizarUnidad` ~11046; `saveTallerEntry` ~11205, tras el bloque de `__llaveEnUso`)
- Modify: `nginx.conf` (lo reescribe `npm run csp:sync`)
- Test: `tests/tallerAntesDespuesMonolito.test.ts` (nuevo)

**Interfaces:**

- Consumes: `window.__avisoSinDespues` (Task 5), `window.__abrirVisorAntesDespues` (Task 6), `Partida.evidenciaFinal`.
- Produces: `function _avisoSinDespues(e)` en el monolito; chip "Sin foto del después"; botón "🖼 Antes y después".

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `tests/tallerAntesDespuesMonolito.test.ts`:

```ts
// Antes y después en el MONOLITO (spec 2026-09-28 §6.2–6.3). Se extraen y EJECUTAN los
// literales reales del HTML (new Function), como tests/tallerBadgePendientesDeFirma.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { avisoSinDespues, type Partida } from "../src/taller/partidas";

const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");
const cuerpo = (nombre: string): string => {
  const i = html.indexOf(`function ${nombre}(`);
  expect(i, `no existe ${nombre}`).toBeGreaterThan(-1);
  return html.slice(i, html.indexOf("\nfunction ", i + 10));
};

const P = (sobre: Partial<Partida> = {}): Partida => ({
  partidaId: "p",
  visitaKey: "vk",
  descripcion: "Balatas delanteras",
  estado: "autorizada",
  tipo: "refaccion",
  fotos: ["a.jpg"],
  precioAutorizado: 1850,
  creadoEn: "2026-09-14T16:00:00.000Z",
  decididoPor: "riesgos@ejemplo.test",
  decididoEn: "2026-09-15T10:00:00.000Z",
  ...sobre,
});

beforeEach(() => {
  // eslint-disable-next-line no-restricted-syntax -- limpieza de prueba, string literal controlado
  document.body.innerHTML = "";
});

/** Ejecuta el `_provFilaHistorial` REAL con dobles de sus ayudantes. */
function filaDe(p: Partida, win: Record<string, unknown> = {}): HTMLElement {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- se ejecuta el literal real
  const fabrica = new Function(
    "window",
    "_bnThumb",
    "_fmtMon2",
    "fmtDate",
    `${cuerpo("_provFilaHistorial")}\nreturn _provFilaHistorial;`,
  );
  const fn = fabrica(
    win,
    () => document.createElement("div"),
    (n: number) => `$${n.toFixed(2)}`,
    (d: unknown) => String(d ?? ""),
  ) as (p: Partida) => HTMLElement;
  return fn(p);
}

describe("_provFilaHistorial — la fila dice qué falta y abre el A+", () => {
  it("refacción autorizada ⇒ 'Sin foto del después'", () => {
    expect(filaDe(P()).textContent).toContain("Sin foto del después");
  });

  it("mano de obra autorizada ⇒ sin chip (su foto es opcional)", () => {
    expect(filaDe(P({ tipo: "manoObra" })).textContent).not.toContain("Sin foto del después");
  });

  it("terminada con fotos ⇒ botón 🖼 que abre el A+ con antes, después, fechas y título", () => {
    const abrir = vi.fn();
    const fila = filaDe(
      P({
        estado: "terminada",
        evidenciaFinal: ["d.jpg"],
        terminadoEn: "2026-09-16T15:00:00.000Z",
      }),
      { __abrirVisorAntesDespues: abrir },
    );
    expect(fila.textContent).not.toContain("Sin foto del después");
    const b = Array.from(fila.querySelectorAll("button")).find((x) =>
      (x.textContent ?? "").includes("Antes y después"),
    );
    expect(b).toBeDefined();
    b!.click();
    expect(abrir).toHaveBeenCalledTimes(1);
    const opts = abrir.mock.calls[0]![0];
    expect(opts.antes).toEqual({ llaves: ["a.jpg"], fecha: "2026-09-14T16:00:00.000Z" });
    expect(opts.despues).toEqual({ llaves: ["d.jpg"], fecha: "2026-09-16T15:00:00.000Z" });
    expect(opts.titulo).toBe("Balatas delanteras");
  });

  it("terminada SIN ninguna foto (mano de obra sin foto) ⇒ sin botón (Review Focus 5)", () => {
    const fila = filaDe(
      P({ tipo: "manoObra", estado: "terminada", fotos: [], evidenciaFinal: [] }),
    );
    expect(
      Array.from(fila.querySelectorAll("button")).some((x) =>
        (x.textContent ?? "").includes("Antes y después"),
      ),
    ).toBe(false);
  });

  it.each(["rechazada", "borrador", "propuesta", "cancelada"] as const)(
    "%s ⇒ ni chip ni botón",
    (estado) => {
      const fila = filaDe(P({ estado }));
      expect(fila.textContent).not.toContain("Sin foto del después");
      expect(fila.textContent).not.toContain("Antes y después");
    },
  );

  it("pinta con textContent, nunca innerHTML", () => {
    expect(cuerpo("_provFilaHistorial")).not.toContain(".innerHTML");
  });
});

/** Ejecuta el `finalizarUnidad` REAL hasta su confirm (que se niega: nada se guarda). */
function textoAlFinalizar(ps: Partida[]): string {
  const e = { id: "tl_1", eco: "06", plate: "PRB0006", estado: "En Reparación" };
  const textos: string[] = [];
  const win = {
    __tallerHibrido: true,
    __visitaKeyDe: () => "vk",
    __tallerPartidas: new Map([["vk", ps]]),
    __pendientesDeFirma: () => 0,
    __avisoSinDespues: avisoSinDespues,
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- se ejecutan los literales reales
  const fabrica = new Function(
    "window",
    "tallerEntries",
    "confirm",
    "saveTallerDB",
    `${cuerpo("_partidasDeVisita")}\n${cuerpo("_avisoSinDespues")}\n${cuerpo("finalizarUnidad")}\nreturn finalizarUnidad;`,
  );
  const fn = fabrica(
    win,
    [e],
    (t: string) => {
      textos.push(t);
      return false;
    },
    async () => {},
  ) as (id: string) => void;
  fn("tl_1");
  return textos.join("\n");
}

describe("finalizarUnidad — avisa, no bloquea (decisión 6)", () => {
  it("con una refacción autorizada sin después, el confirm lo dice con su nombre y monto", () => {
    const t = textoAlFinalizar([P()]);
    expect(t).toContain(
      "⚠ 1 refacción autorizada no tiene foto del después: Balatas delanteras ($1,850.00).",
    );
    expect(t).toContain("¿Finalizar el ingreso de Unidad 06?");
  });

  it("sin faltantes, el confirm no menciona el después", () => {
    expect(textoAlFinalizar([P({ estado: "terminada", evidenciaFinal: ["d.jpg"] })])).not.toContain(
      "foto del después",
    );
  });
});

describe("saveTallerEntry — guardar la salida real también avisa (Review Focus 4)", () => {
  const src = cuerpo("saveTallerEntry");

  it("pregunta SOLO cuando el guardado cierra la visita (no tenía salida y ahora sí)", () => {
    expect(src).toContain(
      "const cierraAhora = !!srcEntry && !srcEntry.fsalidaReal && !!entry.fsalidaReal;",
    );
    expect(src).toContain("_avisoSinDespues(srcEntry)");
  });

  it("el aviso va DESPUÉS de la guarda de llave y ANTES de tocar tallerEntries", () => {
    const iLlave = src.indexOf("__llaveEnUso");
    const iAviso = src.indexOf("const cierraAhora");
    const iEscribe = src.indexOf("tallerEntries[idx]=entry");
    expect(iLlave).toBeGreaterThan(-1);
    expect(iAviso).toBeGreaterThan(iLlave);
    expect(iEscribe).toBeGreaterThan(iAviso);
  });

  it("si la persona cancela, no se guarda nada (return antes de escribir)", () => {
    const bloque = src.slice(
      src.indexOf("const cierraAhora"),
      src.indexOf("tallerEntries[idx]=entry"),
    );
    expect(bloque).toMatch(/!confirm\([\s\S]*?\)\) return;/);
  });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/tallerAntesDespuesMonolito.test.ts`
Expected: FAIL — no existe `_avisoSinDespues`; la fila no trae el chip ni el botón.

- [ ] **Step 3: Implementar en `Control de flotilla.html`**

(a) Justo después de la función `_partidasDeVisita(e){ … }` (termina con `return vk ? (window.__tallerPartidas?.get(vk) || []) : [];` y `}`), agrega:

```js
// Antes y después (spec 2026-09-28 §6.2): el renglón del aviso al CERRAR una visita con
// refacciones autorizadas sin foto del después. La regla y el texto viven en
// src/taller/partidas.ts (avisoSinDespues); aquí solo se pregunta. "" = no avisar.
function _avisoSinDespues(e) {
  return typeof window.__avisoSinDespues === "function"
    ? window.__avisoSinDespues(_partidasDeVisita(e))
    : "";
}
```

(b) En `_provFilaHistorial(p)`, justo después de `linea1.append(desc, badge);`:

```js
// Antes y después (spec 2026-09-28 §6.3): una refacción autorizada sin foto del después
// lo dice en su fila (la mano de obra no: su foto es opcional).
if (p.estado === "autorizada" && p.tipo !== "manoObra") {
  const chip = document.createElement("span");
  chip.className = "tl-pill pendiente";
  chip.textContent = "Sin foto del después";
  linea1.appendChild(chip);
}
```

Y justo antes de `row.appendChild(info);` (después de `info.append(linea1, precio, rastro);`):

```js
// Una terminada con alguna foto ofrece ver antes y después lado a lado (visor A+).
const fotosAntes = p.fotos || [];
const fotosDespues = p.evidenciaFinal || [];
if (p.estado === "terminada" && (fotosAntes.length || fotosDespues.length)) {
  const verAD = document.createElement("button");
  verAD.type = "button";
  verAD.textContent = "🖼 Antes y después";
  verAD.style.cssText =
    "align-self:flex-start;margin-top:4px;min-height:32px;padding:4px 10px;border-radius:6px;border:1px solid var(--ln);background:var(--bg2);color:var(--w1);font-size:11.5px;font-weight:600;cursor:pointer";
  verAD.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (typeof window.__abrirVisorAntesDespues === "function") {
      const tipoTxtV = p.tipo === "manoObra" ? "Mano de obra" : "Refacción";
      let subtitulo = tipoTxtV;
      if (Number.isFinite(p.precioAutorizado)) subtitulo += ` · ${_fmtMon2(p.precioAutorizado)}`;
      if (p.terminadoEn) subtitulo += ` · terminada el ${fmtDate(p.terminadoEn)}`;
      window.__abrirVisorAntesDespues({
        antes: { llaves: fotosAntes, fecha: p.creadoEn },
        despues: { llaves: fotosDespues, fecha: p.terminadoEn },
        titulo: p.descripcion || "(sin descripción)",
        subtitulo,
      });
    }
  });
  info.appendChild(verAD);
}
```

(c) En `finalizarUnidad(id)`, justo después de la constante `avisoPartidas` (antes del `if(!confirm(…`), agrega:

```js
// Antes y después (spec 2026-09-28 decisión 6): mismo criterio que C-I5 — se DICE.
const avisoDespues = _avisoSinDespues(e);
```

y en el `confirm` inserta `${avisoDespues ? "\n\n" + avisoDespues : ""}` inmediatamente después de `${avisoPartidas}`:

```js
if (
  !confirm(
    `¿Finalizar el ingreso de ${nombre}?${avisoPartidas}${avisoDespues ? "\n\n" + avisoDespues : ""}\n\nEl registro pasará al Historial y desaparecerá de Operaciones Activas.\nPodrás reingresarla en cualquier momento desde el Historial.`,
  )
)
  return;
```

(conserva el resto del texto del confirm exactamente como está hoy).

(d) En `saveTallerEntry`, justo después del bloque completo `if(typeof window.__llaveEnUso === "function"){ … }` y antes de `if(_tallerEditId){`, agrega:

```js
// Antes y después (spec 2026-09-28 decisión 6): guardar con "Fecha real de salida" CIERRA la
// visita (batchUpload.ts deriva estatus "cerrado" de fsalidaReal) y la liga del taller muere.
// Si quedan refacciones autorizadas sin foto del después, se DICE, no se prohíbe. Solo al
// cerrar: una visita que ya estaba cerrada y se vuelve a guardar no pregunta otra vez.
const cierraAhora = !!srcEntry && !srcEntry.fsalidaReal && !!entry.fsalidaReal;
if (cierraAhora) {
  const avisoDespues = _avisoSinDespues(srcEntry);
  if (avisoDespues && !confirm(`${avisoDespues}\n\n¿Guardar la salida de todos modos?`)) return;
}
```

- [ ] **Step 4: Regenerar la CSP (trampa #1)**

Run: `npm run csp:sync`
Expected: `[csp] Updated Control de flotilla.html` y `[csp] Updated nginx.conf`.

- [ ] **Step 5: Correr y ver que pasan**

Run: `npx vitest run tests/tallerAntesDespuesMonolito.test.ts tests/tallerPartidasEnRegistro.test.ts tests/tallerBadgePendientesDeFirma.test.ts`
Expected: PASS.
Run: `npm run audit:csp`
Expected: `✓ CSP sync con inline scripts actuales`.

- [ ] **Step 6: Commit (y volver a revisar la CSP sobre el commit)**

```bash
git add "Control de flotilla.html" nginx.conf tests/tallerAntesDespuesMonolito.test.ts
git commit -m "feat(taller): el registro dice qué refacción no tiene su después y abre el A+; cerrar la visita avisa" -m "Chip 'Sin foto del después' en refacciones autorizadas; botón 🖼 Antes y después en terminadas con foto; aviso sin bloqueo en ✓ Finalizar y al guardar la salida real. CSP regenerada." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
npm run audit:csp
```

Expected: `audit:csp` en verde también después del commit (el hook reformatea con prettier). Si sale rojo: `npm run csp:sync`, re-stagea los dos archivos y haz un commit `fix(csp): …`.

---

### Task 8: Excel — "Fotos después" y "Terminado el"

**Files:**

- Modify: `src/taller/exportExcel.ts` (`COLUMNAS_PARTIDAS`, línea ~514, y su comentario "14 columnas")
- Test: `tests/tallerExcelPartidas.test.ts`

**Interfaces:**

- Consumes: `Partida.evidenciaFinal`, `Partida.terminadoEn`.
- Produces: 16 columnas; las dos nuevas al final.

- [ ] **Step 1: Escribir las pruebas que fallan**

En `tests/tallerExcelPartidas.test.ts`:

(a) Agrega `"Fotos después"` y `"Terminado el"` al final de `TITULOS_ESPERADOS`.

(b) Cambia los títulos `"exportExcel.ts trae los 14 encabezados exactos y etiqueta las canceladas"` → `"… los 16 encabezados …"` y `"son exactamente 14 columnas, en el orden esperado"` → `"… 16 columnas …"`.

(c) Agrega al final del archivo:

```ts
describe("antes y después en el Excel (spec 2026-09-28 §6.5)", () => {
  const iFD = () => COLUMNAS_PARTIDAS.findIndex((c) => c.titulo === "Fotos después");
  const iTE = () => COLUMNAS_PARTIDAS.findIndex((c) => c.titulo === "Terminado el");
  const ctx = (ps: Partida[]): ContextoExport => ({ partidasDe: () => ps }) as ContextoExport;

  it("una terminada trae cuántas fotos del después y cuándo se terminó", () => {
    const [fila] = filasPartidas(
      [entry()],
      ctx([
        partida({
          estado: "terminada",
          evidenciaFinal: ["a.jpg", "b.jpg"],
          terminadoEn: "2026-09-16T15:00:00.000Z",
        }),
      ]),
    );
    expect(fila![iFD()]).toBe(2);
    expect(fila![iTE()]).toBeInstanceOf(Date);
  });

  it("una terminada SIN foto (mano de obra) dice 0, no vacío", () => {
    const [fila] = filasPartidas(
      [entry()],
      ctx([partida({ tipo: "manoObra", estado: "terminada", evidenciaFinal: [] })]),
    );
    expect(fila![iFD()]).toBe(0);
  });

  it("mientras no esté terminada, las dos celdas van vacías (un 0 diría 'se terminó sin foto')", () => {
    const [fila] = filasPartidas([entry()], ctx([partida({ estado: "autorizada" })]));
    expect(fila![iFD()]).toBe("");
    expect(fila![iTE()]).toBe("");
  });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/tallerExcelPartidas.test.ts`
Expected: FAIL — 14 columnas en vez de 16.

- [ ] **Step 3: Implementar**

En `src/taller/exportExcel.ts`, cambia "14 columnas" por "16 columnas" en el comentario de `COLUMNAS_PARTIDAS` y agrega al final del arreglo, después de la columna `"Fotos"`:

```ts
  {
    titulo: "Fotos después",
    ancho: 10,
    tipo: "numero",
    formato: "0",
    // Vacío mientras la partida no esté terminada: un 0 diría "se terminó sin foto".
    valor: (_e, p) => (p.estado === "terminada" ? (p.evidenciaFinal?.length ?? 0) : ""),
  },
  {
    titulo: "Terminado el",
    ancho: 12,
    tipo: "fecha",
    formato: FMT_FECHA,
    valor: (_e, p) => fecha(p.terminadoEn),
  },
```

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run tests/tallerExcelPartidas.test.ts tests/tallerExcel*.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/taller/exportExcel.ts tests/tallerExcelPartidas.test.ts
git commit -m "feat(taller): la hoja Partidas del Excel dice cuántas fotos del después hay y cuándo se terminó" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Vista local de Fleet (demo solo de desarrollo) y su prueba en Chrome

**Files:**

- Create: `src/dev/demoAntesDespues.ts`
- Modify: `src/main.ts` (al final)
- Test: `tests/e2e/antes-despues.spec.ts` (nuevo)

**Interfaces:**

- Consumes: todo lo de las Tasks 5–7, por los puentes reales.
- Produces: `montarDemo(): Promise<void>`. URL de la demo: `http://localhost:5173/Control%20de%20flotilla.html?e2e=1&demo=antes-despues` (con `npm run dev`).

**Por qué así y no con Playwright en modo visible:** Playwright descarta solo los `confirm()` nativos, así que Navares nunca vería el aviso. La demo corre en su navegador normal, con diálogos reales. Todo lo que tocaría la nube o el disco es un doble que no escribe, y `saveTallerDB` se reemplaza para que la demo no se meta al IndexedDB local (que la app podría luego intentar subir a la nube).

- [ ] **Step 1: Escribir la prueba e2e que falla**

Crea `tests/e2e/antes-despues.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

// Vista local del frente antes/después (spec 2026-09-28 §8.1): la demo de desarrollo
// siembra una visita INVENTADA y abre su registro usando las funciones REALES de la app.
// Red externa bloqueada: nada sale de la máquina.
const URL_DEMO = "/Control%20de%20flotilla.html?e2e=1&demo=antes-despues";

test.describe("antes y después por hallazgo — registro de la unidad (demo local)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/*", (r) => {
      const u = new URL(r.request().url());
      if (u.protocol === "data:" || u.protocol === "blob:") return r.continue();
      return ["localhost", "127.0.0.1"].includes(u.hostname) ? r.continue() : r.abort();
    });
    await page.goto(URL_DEMO);
    await expect(page.locator("#demo-antes-despues")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#taller-modal.open")).toBeVisible();
    // La lista de hallazgos abre en "Pendientes": las autorizadas y terminadas viven en "Autorizadas".
    await page
      .locator("#tf-prov-partidas")
      .getByRole("button", { name: /Autorizadas/ })
      .click();
  });

  test("la refacción autorizada sin después lo dice en su fila", async ({ page }) => {
    await expect(page.locator("#tf-prov-partidas")).toContainText("Sin foto del después");
  });

  test("🖼 abre ANTES y DESPUÉS lado a lado; Esc lo cierra", async ({ page }) => {
    await page
      .getByRole("button", { name: /Antes y después/ })
      .first()
      .click();
    const visor = page.locator("#taller-visor-antes-despues");
    await expect(visor).toBeVisible();
    await expect(visor).toContainText("ANTES · 14 sep · 1 foto");
    await expect(visor).toContainText("DESPUÉS · 16 sep · 2 fotos");
    await page.keyboard.press("Escape");
    await expect(visor).toHaveCount(0);
  });

  test("finalizar con una refacción sin después avisa, y cancelar no cierra nada", async ({
    page,
  }) => {
    const textos: string[] = [];
    page.on("dialog", async (d) => {
      textos.push(d.message());
      await d.dismiss();
    });
    await page.evaluate(() =>
      (window as unknown as { finalizarUnidad: (id: string) => void }).finalizarUnidad(
        "demo-antes-despues",
      ),
    );
    expect(textos.join("\n")).toContain("1 refacción autorizada no tiene foto del después");
    expect(textos.join("\n")).toContain("Balatas delanteras desgastadas");
    const estado = await page.evaluate(
      () => (window as unknown as { tallerEntries: { estado: string }[] }).tallerEntries[0]!.estado,
    );
    expect(estado).toBe("En Reparación");
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx playwright test -c playwright.local.config.ts tests/e2e/antes-despues.spec.ts`
Expected: FAIL — `#demo-antes-despues` nunca aparece.

- [ ] **Step 3: Implementar la demo**

Crea `src/dev/demoAntesDespues.ts`:

```ts
// Vista LOCAL de Fleet — antes y después por hallazgo (spec 2026-09-28 §8.1).
//
// SOLO corre con `npm run dev` y la URL ?e2e=1&demo=antes-despues: main.ts la importa
// detrás de `import.meta.env.DEV`, así que nunca entra al build de producción. Siembra
// UNA visita INVENTADA con hallazgos en cada estado y abre su registro, para ver la
// fila, el visor A+ y el aviso al dar salida con las funciones REALES de la app.
// Todo lo que tocaría la nube o el disco es un doble que no escribe nada: ni DynamoDB,
// ni S3, ni el IndexedDB local.
//
// La ventana se trata como un diccionario a propósito: los globales del monolito
// (renderTaller, openTallerModal, saveTallerDB…) no tienen tipos, y los puentes que sí
// los tienen no deben obligar a la demo a fabricar objetos completos de producción.
const w = window as unknown as Record<string, unknown>;
const llamar = (nombre: string, ...args: unknown[]): unknown => {
  const f = w[nombre];
  return typeof f === "function" ? (f as (...a: unknown[]) => unknown)(...args) : undefined;
};

function dibujo(
  fondo: string,
  disco: string,
  grosor: number,
  texto: string,
  colorTexto: string,
): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120">` +
    `<rect width="160" height="120" fill="${fondo}"/>` +
    `<circle cx="72" cy="62" r="50" fill="${disco}"/><circle cx="72" cy="62" r="17" fill="#1f2937"/>` +
    `<rect x="112" y="30" width="30" height="64" rx="7" fill="#b91c1c"/>` +
    `<rect x="${112 - grosor}" y="38" width="${grosor}" height="48" rx="2" fill="#a8a29e"/>` +
    `<text x="80" y="114" font-size="8" fill="${colorTexto}" text-anchor="middle" font-family="sans-serif">${texto}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const GASTADO = dibujo("#3f3a36", "#8a5a33", 4, "balata 2 mm · disco rayado", "#fca5a5");
const NUEVO = dibujo("#334155", "#cbd5e1", 12, "balata nueva 12 mm", "#bbf7d0");
const FOTOS: Record<string, string> = {
  "demo/antes-balatas-delanteras.png": GASTADO,
  "demo/antes-balatas-traseras.png": GASTADO,
  "demo/despues-balatas-traseras-1.png": NUEVO,
  "demo/despues-balatas-traseras-2.png": NUEVO,
  "demo/antes-amortiguador.png": GASTADO,
};

async function esperar(cond: () => boolean, ms = 20_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function avisoDemo(): void {
  const b = document.createElement("div");
  b.id = "demo-antes-despues";
  b.setAttribute("role", "status");
  b.style.cssText =
    "position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:10000;background:#b45309;color:#fff;font:600 13px system-ui;padding:8px 14px;border-radius:999px;box-shadow:0 6px 18px rgba(0,0,0,.25)";
  b.textContent =
    "MODO DEMO · datos inventados · nada se guarda · abre «Autorizadas» en la lista de hallazgos";
  document.body.appendChild(b);
}

export async function montarDemo(): Promise<void> {
  const lista = await esperar(
    () =>
      typeof w.renderTaller === "function" &&
      typeof w.openTallerModal === "function" &&
      typeof w.__visitaKeyDe === "function" &&
      typeof w.__abrirVisorAntesDespues === "function" &&
      typeof w.__avisoSinDespues === "function",
  );
  if (!lista) {
    console.error("[demo antes-despues] la app no terminó de cargar");
    return;
  }
  if (w.__cloudSession) {
    console.warn("[demo antes-despues] hay una sesión real abierta: la demo no corre");
    return;
  }

  // Frontera con la nube y con el disco: dobles que NO escriben.
  w.saveTallerDB = async () => {};
  w.__cloudReplaceTaller = async () => {};
  w.__cloudSyncTaller = async (arr: unknown[]) => ({ ok: arr.length, errors: [] });
  w.__cloudHydrate = async () => ({});
  w.__urlFotoPartida = async (k: string) => FOTOS[k] ?? null;

  w.__cloudSession = {
    email: "demo@ejemplo.test",
    tenantId: "demo",
    groups: ["admin"],
    sucursal: "",
  };
  llamar("applyRolePermissions");
  w.__tallerHibrido = true;
  w.__tallerHibridoDesconocido = false;
  w.__tallerPartidasCargadas = true;
  w.__anuladasActivas = new Map();
  llamar("applyTallerHibridoGate");

  const entry = {
    id: "demo-antes-despues",
    unitKey: "demo-antes-despues",
    eco: "06",
    plate: "PRB0006",
    brand: "Nissan NP300 (demo)",
    sucursal: "GDL",
    area: "Mantenimiento",
    tipo: "Correctivo",
    estado: "En Reparación",
    km: 85000,
    fentrada: "2026-09-14",
    freporte: "2026-09-14",
    fsalidaEst: "2026-09-20",
    fsalidaReal: "",
    tecnico: "Taller de ejemplo",
    comentario: "DEMO — datos inventados",
    updatedAt: new Date().toISOString(),
  };
  w.tallerEntries = [entry];
  const vk = llamar("__visitaKeyDe", entry) as string;
  const base = {
    visitaKey: vk,
    creadoPor: "liga:PRB0006|2026-09-14",
    creadoEn: "2026-09-14T16:00:00.000Z",
    propuestoEn: "2026-09-14T17:00:00.000Z",
    decididoPor: "riesgos@ejemplo.test",
    decididoEn: "2026-09-15T10:00:00.000Z",
    evidenciaFinal: [] as string[],
  };
  w.__tallerPartidas = new Map([
    [
      vk,
      [
        {
          ...base,
          partidaId: "d-1",
          descripcion: "Balatas delanteras desgastadas",
          tipo: "refaccion",
          precio: 1850,
          precioAutorizado: 1850,
          estado: "autorizada",
          fotos: ["demo/antes-balatas-delanteras.png"],
        },
        {
          ...base,
          partidaId: "d-2",
          descripcion: "Balatas traseras",
          tipo: "refaccion",
          precio: 1650,
          precioAutorizado: 1650,
          estado: "terminada",
          fotos: ["demo/antes-balatas-traseras.png"],
          evidenciaFinal: [
            "demo/despues-balatas-traseras-1.png",
            "demo/despues-balatas-traseras-2.png",
          ],
          terminadoEn: "2026-09-16T15:00:00.000Z",
        },
        {
          ...base,
          partidaId: "d-3",
          descripcion: "Ajuste de freno de mano",
          tipo: "manoObra",
          precio: 350,
          precioAutorizado: 350,
          estado: "terminada",
          fotos: [],
          terminadoEn: "2026-09-16T16:00:00.000Z",
        },
        {
          ...base,
          partidaId: "d-4",
          descripcion: "Amortiguador trasero con fuga",
          tipo: "refaccion",
          precio: 2400,
          estado: "propuesta",
          fotos: ["demo/antes-amortiguador.png"],
          decididoPor: undefined,
          decididoEn: undefined,
        },
      ],
    ],
  ]);

  const nav = document.getElementById("mainnav");
  if (nav) nav.style.display = "flex";
  const ldr = document.getElementById("ldr");
  if (ldr) ldr.style.display = "none";
  const dz = document.getElementById("dz");
  if (dz) dz.style.display = "none";
  avisoDemo();
  llamar("showView", "taller");
  llamar("tlSwitch", "activas");
  llamar("renderTaller");
  llamar("openTallerModal", entry.id);
}
```

En `src/main.ts`, como PRIMERA línea del archivo (antes de cualquier `import`), agrega:

```ts
/// <reference types="vite/client" />
```

Es inofensiva si los tipos de Vite ya estaban cargados; sin ella, `tsc` no conoce `import.meta.env`. Usa la forma LITERAL `import.meta.env.DEV`: es el texto que Vite reemplaza en el build, y cualquier otra forma (un cast, un `?.`) dejaría la demo como chunk suelto en `dist/`.

Y al final de `src/main.ts`:

```ts
// ─── Vista local "antes y después" (spec 2026-09-28 §8.1) — SOLO `npm run dev` ───
// import.meta.env.DEV es `false` en el build: Rollup elimina la rama y el módulo de la
// demo nunca viaja a producción. Requiere ?e2e=1 (sin Cognito) y demo=antes-despues.
if (
  import.meta.env.DEV &&
  window.location.search.includes("e2e=1") &&
  window.location.search.includes("demo=antes-despues")
) {
  void import("./dev/demoAntesDespues").then((m) => m.montarDemo());
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx playwright test -c playwright.local.config.ts tests/e2e/antes-despues.spec.ts`
Expected: 3 passed.

- [ ] **Step 5: Confirmar que la demo NO viaja a producción**

Run: `npm run build`
Run: `grep -rl "MODO DEMO\|demoAntesDespues" dist/ || echo "limpio"`
Expected: `limpio`. Si aparece algún archivo, la guarda de `import.meta.env.DEV` no se eliminó: no sigas hasta entender por qué.

- [ ] **Step 6: Commit**

```bash
git add src/dev/demoAntesDespues.ts src/main.ts tests/e2e/antes-despues.spec.ts
git commit -m "chore(taller): demo local de antes y después en Fleet (solo npm run dev) y su prueba en Chrome" -m "?e2e=1&demo=antes-despues siembra una visita inventada con las funciones reales de la app; la nube, S3 y el IndexedDB son dobles que no escriben. El build de producción no la incluye." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Batería completa, revisión de seguridad y la compuerta de Navares

**Files:** ninguno nuevo (solo verificación y la entrega a Navares).

- [ ] **Step 1: Batería completa, capturada a archivo**

```bash
npm run test:run > "$TMPDIR/antes-despues-tests.txt" 2>&1; echo "salida: $?"
npm run typecheck
npm run lint
npm run build
npm run audit:csp
npm run audit:xss
node scripts/preview-liga-local.mjs --smoke
node scripts/gen-fixture-mensual.mjs && npx playwright test -c playwright.local.config.ts > "$TMPDIR/antes-despues-e2e.txt" 2>&1; echo "salida: $?"
```

Expected:

- Vitest: todo verde, salvo si acaso el intermitente conocido `fuelOpsGuardHandlers › handleKmDetectado` (se descarta por nombre; cualquier otro fallo se investiga). Lee el archivo completo, no solo la cola.
- typecheck, lint, build, audit:csp, audit:xss y la autoprueba de la liga: verdes.
- e2e: la referencia de `main` (60/67, 7 ambientales conocidos) + 3 nuevas = **63/70**. Si falla algo distinto de los 7 ambientales, compara A/B contra `origin/main` antes de culpar al cambio.

- [ ] **Step 2: Revisión de seguridad de la ruta nueva (obligatoria, trampa #5)**

Despacha un revisor NUEVO (modelo más capaz) sobre el diff `git diff e85bcda..HEAD -- amplify/` con el spec §7 en la mano. Debe confirmar, leyendo el código y el arnés P18:

1. que `/api/terminar` cruza `cargarVisitaVigente` antes de leer nada;
2. que la partida se busca solo dentro de `listarPartidasDeVisita(tk.t, visitaKey)`;
3. que ningún campo del cuerpo, fuera de `partidaId` y `fotos`, llega a la escritura;
4. que el 409 no filtra estado interno;
5. que la bitácora no lleva el token;
6. que la proyección de `leerVisita` sigue siendo una lista blanca;
7. la carrera del spec §4.3: que desde Fleet nada saca a una partida de `autorizada` mientras el taller la termina. Verificado al escribir este plan: `puedeCancelar` no tiene ningún caller en `src/` ni en el monolito, y `autorizar` exige `estado === "propuesta"` (comentario de `camposDeDecision`, `src/api/tallerPartidas.ts`). El revisor confirma además que `rechazar` también exige `propuesta`. Si alguna de las dos cosas no se sostiene, la escritura de `terminarPartida` pasa a condicionarse por `version`.

Cada hallazgo Critical o Important se corrige en su propio commit, con una prueba que lo ejecute.

- [ ] **Step 3: Revisión final de la rama**

Un revisor nuevo sobre `git diff e85bcda..HEAD` completo contra el spec (decisiones 1–11 y Review Focus). Una sola ola de correcciones; vuelve a correr el Step 1 sobre el árbol final.

- [ ] **Step 4: La compuerta — Navares lo ve en local (decisión 11)**

Dale a Navares, en 3–6 renglones y en lenguaje llano:

1. **La liga, como la ve el taller:** en una terminal, desde `C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla-wt-antes-despues`, `npm run preview:liga`, y abrir `http://localhost:5180/`. Para autorizar un hallazgo "como Riesgos": `http://localhost:5180/__panel`. Para probarla en el celular (misma red Wi-Fi): `node scripts/preview-liga-local.mjs --red` y abrir la dirección que imprime.
2. **Fleet, como lo ve Riesgos:** en otra terminal, desde la misma carpeta, `npm run dev`, y abrir `http://localhost:5173/Control%20de%20flotilla.html?e2e=1&demo=antes-despues`. En la lista de hallazgos tocar «Autorizadas».
3. **Qué es simulado** (dilo): en la liga, la firma de la liga y S3; en Fleet, la nube y el guardado. Las reglas y las pantallas son las reales.

**No abras PR ni pidas push hasta que Navares diga que está bien.** Si pide cambios, vuelven como tareas nuevas de este plan.

- [ ] **Step 5: Tras su visto bueno — preparar el PR (sin empujar)**

1. Confirma que `feat/taller-liga-cierre` ya está fusionada en `origin/main` (`git fetch origin && git branch -r --contains origin/feat/taller-liga-cierre` o su merge en `git log origin/main`). Si no lo está, se detiene aquí: esta rama se despliega DESPUÉS de ella (decisión 9).
2. `git merge origin/main` (merge, no rebase) y vuelve a correr el Step 1 completo.
3. Pídele a Navares el push desde este worktree: `git push -u origin feat/taller-antes-despues` (con `--no-verify` si el hook de pre-push se cae por el intermitente o por los e2e ambientales).
4. Abre el PR con `gh pr create --base main --head feat/taller-antes-despues`, con el resumen de las decisiones y la batería. Termina la descripción con `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
5. Después del merge (el deploy es automático): humo en producción con la prueba manual del spec §8 — visita real, liga emitida, celular del taller, autorizar con la cuenta de **Riesgos**, subir el después, verlo en A+, y finalizar una visita con una refacción sin después para ver el aviso.
