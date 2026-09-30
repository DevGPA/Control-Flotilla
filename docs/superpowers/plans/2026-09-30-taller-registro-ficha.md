# Registro de Taller como ficha (opción A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que al abrir una visita de Taller ya guardada se vea primero una ficha de solo lectura (estado GPA vs lo que reporta el taller, días, salida, costo, liga con el NOMBRE de quien la emitió), debajo los hallazgos del taller agrupados, y al final el formulario de hoy plegado tras "Editar datos", con Guardar encendido solo si cambiaste algo.

**Architecture:** Solo presentación (una excepción: el orden de dos líneas en `reingresoTaller`, decisión 26). Las cuentas nuevas viven en funciones puras de `src/taller/` (`ficha.ts`, `nombreUsuario.ts`, `cambiosFormulario.ts`, `ordenarHallazgos` en `seguimiento.ts`) y se publican como puentes `window.__*` desde `src/api/cloudWire.ts`. El monolito solo pinta (`_fichaPintar`) con `createElement` + `textContent`. Los ids `tf-*` no cambian, solo de lugar: `saveTallerEntry`, la liga, la firma, la anulación y la guarda de la llave siguen leyendo lo mismo. El nombre de quien emitió la liga sale de una lectura pasiva y en caché del modelo `UserProfile`.

**Tech Stack:** Vite + TypeScript vanilla, vitest (happy-dom ya configurado en `vite.config.ts:61`), Playwright con Chrome del sistema (`playwright.local.config.ts`), monolito `Control de flotilla.html` con `<script>` en línea (CSP por hash ⇒ `csp:sync`), Amplify Gen 2 (solo lectura de `UserProfile`).

**Spec:** `docs/superpowers/specs/2026-09-30-taller-registro-ficha-design.md` (decisiones 1–26, §4–§8; respuestas de Navares en §9).

## Global Constraints

- **Worktree y rama:** `C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha`, rama `feat/taller-registro-ficha` (sale de `feat/taller-antes-despues` `0081d0b`). Verifica con `git -C "<worktree>" branch --show-current` antes de cada commit. `amplify_outputs.json` ya está copiado y `npm ci` ya corrió.
- **REGLA DE SHELL (obligatoria):** No uses `cd "<carpeta>" && …` para leer o buscar: usa las herramientas Read y Grep, o rutas absolutas. Para git usa `git -C "<worktree>" …`. Para pruebas: `cd "<worktree>" && npx vitest run <archivos> | tail -20` SIN `2>&1`, `2>/dev/null` ni `> archivo`. Batería completa: `cd "<worktree>" && npx vitest run --reporter=default --reporter=json --outputFile="<scratchpad>/bateria.json" | tail -40`.
- **Stagea solo tus rutas:** `git -C "<worktree>" add <ruta> <ruta>`. Nunca `add -A` ni `add .`. Nada de push ni PR.
- **Repo PÚBLICO:** datos ficticios (placas `PRB0006`/`AAA111`, tenant `demo`/`acme`, correos `@ejemplo.test`, nombres inventados como "Ana López", subs con forma de GUID inventados como `11111111-2222-4333-8444-555555555555`). Nunca un sub real ni ids de infraestructura.
- **Sin `innerHTML` con datos** en `src/` ni en el monolito: `createElement` + `textContent`. Guarda: `npm run audit:xss` (ya sale 1 por un sospechoso preexistente de llantas en `Control de flotilla.html` ~L4532, que NO es de este frente; no debe aparecer ninguno nuevo).
- **CSP del monolito:** todo cambio a un `<script>` en línea de `Control de flotilla.html` ⇒ `cd "<worktree>" && npm run csp:sync`, re-stagear `Control de flotilla.html` y `nginx.conf`; tras el commit, `cd "<worktree>" && npm run audit:csp` (el hook reformatea).
- **Funciones NUEVAS del monolito van en su propio bloque, NUNCA entre `function openTallerModal(` y `function closeTallerModal(`** (`tests/tallerBloqueProveedor.test.ts:60-65` corta `openTallerModal` hasta `\nfunction closeTallerModal`; otras pruebas cortan cada función en el siguiente `\nfunction ` o `\nasync function `). Tampoco agregues `getElementById` dentro del bloque del candado B-C4 de `openTallerModal` (`tests/tallerOlaHonestidadUi.test.ts:286-335` lo ejecuta con un `document` falso de 4 ids), ni toques el texto de `saveTallerEntry` antes de `// Validaci` (`tests/tallerSaveEntryGastoCandado.test.ts:30-37`).
- **`_provPintar` conserva** `window.__estadoLiga(`, `window.__promesaTaller(`, los textos "km del taller" y "km ingreso", sin `.innerHTML` ni `24*60*60` (`tests/tallerBloqueProveedor.test.ts:44-74`); `openTallerModal` conserva `if(e) _provPintar(e)`.
- **`_provPartidas` conserva** los textos "No se pudieron cargar las partidas. Reintenta en unos segundos." y "Esta visita no tiene partidas del proveedor.", las llamadas `_bnPartida(`, `window.__resumenPartidas(` y `_partidasConfiables()`; `_bnRepintar` sigue llamando `_tfGastoPintar`, `_provPintar(e)`, `renderTaller` y `updateTallerBadge`, y NO `_provPartidas(` (`tests/tallerPartidasEnRegistro.test.ts`).
- **`_provFilaHistorial` sigue ejecutable con `new Function("window","_bnThumb","_fmtMon2","fmtDate", cuerpo)`** y con `window = {}` (`tests/tallerAntesDespuesMonolito.test.ts:36-62`): todo puente nuevo se lee de `window.*` con guarda `typeof … === "function"`, nunca por parámetro nuevo. El chip "Sin foto del después" conserva la clase exacta `tl-pill diag`.
- **Ids que no cambian:** todos los `tf-*` de hoy, `tf-prov-liga`, `tf-prov-liga-meta`, `tf-prov-taller`, `tf-prov-taller-nota`, `tf-prov-partidas`, `tf-proveedor`, `btn-liga-copiar`, `btn-liga-revocar`, `btn-reingreso`, `btn-finalizar`, `btn-expediente`, `tl-mttl`, `tf-identidad-hint`, `tf-gasto-hint`. `_provPintar` borra los hijos de `#tf-prov-liga` salvo los dos botones (`HTML:7851-7853`): **nada nuevo va dentro de `#tf-prov-liga`**.
- **Ids nuevos (exactos):** `tl-msub`, `tf-aviso-firma`, `tf-ficha`, `tf-ficha-gpa`, `tf-ficha-taller`, `tf-ficha-dias`, `tf-ficha-salida`, `tf-ficha-costo`, `tf-ficha-liga`, `tf-datos`, `tf-datos-resumen`, `tf-datos-campos`, `tf-sin-cambios`, `btn-guardar-taller`. Clases CSS nuevas con prefijo `tl-ficha-` y `tl-datos-`; no se tocan `.tl-mcard`, `.tl-mbody`, `.tl-mftr`, `.tl-sec` en general (los usan otros modales): lo propio de este modal se acota con `#taller-modal …`. Tema oscuro en `:root[data-theme="dark"]`.
- **Visibilidad del aviso de firma con el atributo `hidden`**, nunca con `style.display` (`#tf-aviso-firma[hidden]{display:none!important}` y en ≥769 px `#tf-aviso-firma{display:none!important}`).
- **Fechas:** los días en taller usan la fórmula de la tabla `Math.round((fin − Date.parse(fentrada)) / 86400000)` (medianoche UTC), extraída a `ficha.ts`; NO se importa `exportExcel.ts`. `fsalidaEst` (GPA) y `fsalidaEstTaller` (taller) nunca se mezclan ni se renombran.
- **Textos exactos de la ficha:** "Cómo va" · "Estado · GPA" / "lo decides tú" · "Estado · TALLER" / "desde su liga" · "nombre según GPA" · "Se cambia en Datos del registro" · "Mientras haya hallazgos sin firmar, la lista del Taller marca esta unidad «Esperando firma»" · "El taller aún no ha reportado estado." · "Ingresó el dd/mm/aaaa" · "Salió el dd/mm/aaaa · estuvo N días" · "Estimada por GPA" · "El taller promete" · "(había prometido dd/mm/aaaa)" · "PROMESA VENCIDA · N días" · "Salida estimada vencida hace N días" · "N día(s) después de lo estimado" · "Autorizado" · "Esperando tu firma" · "El subtotal es la suma de los hallazgos autorizados" · "Capturado por GPA" · "No se pudieron cargar los hallazgos" · "verificando…" · "Liga del proveedor activa · vence en N días · emitida por NOMBRE el dd/mm/aaaa" · "Liga revocada por NOMBRE el dd/mm/aaaa" · "Liga vencida el dd/mm/aaaa" · "Se cerró junto con la visita (NOMBRE) el dd/mm/aaaa" · "Liga cerrada con la visita" · "Sin liga" · "Emitir liga y copiar" · "Copiar liga" · "Copiar vuelve a emitir: la liga queda a tu nombre y vence en 90 días" · "Hallazgos del taller (N)" · "N espera(n) tu firma" · "Esperan tu firma" · "Autorizados · suman $X" · "No autorizados" · "Autorizar y No autorizar se guardan solos; no necesitas Guardar." · "Datos del registro" · "Guardado:" · "Editar datos" / "Ocultar" / "Ver datos" · "Guardar, abajo, se resalta en cuanto cambias algo de este bloque." · "Sin cambios" · "N hallazgo(s) espera(n) tu firma · $Y · Ver →" · "¿Descartar los cambios?" · "un usuario de GPA" · "(tú)".
- **Medición en prod (2026-09-30, solo lectura):** `ligaCreadaPor` = sub de Cognito en las 4 filas; `ligaRevocadaPor` = 1 sub y 1 TEXTO LIBRE ("revocacion manual (CLI admin) por incidente…"). `nombreDeUsuario` cubre el texto libre con el respaldo "un usuario de GPA".
- **Commits en español** estilo `feat(taller): …` / `fix(taller): …` / `test(taller): …` con el trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **Compuerta:** Navares lo ve en local dentro de Fleet (`?e2e=1&demo=registro-ficha`) ANTES del PR; el PR además espera a que `feat/taller-antes-despues` esté en `main`.

## Review Focus

1. **`ligaRevocadaPor` con texto libre** (existe en prod): la ficha debe decir "Liga revocada por un usuario de GPA el …", nunca el texto crudo ni un GUID. → Task 2 (`nombreDeUsuario`) y Task 5 (pintado).
2. **Firmar no debe encender Guardar ni apagarlo cuando sí había cambios:** `_bnRepintar → _tfGastoPintar` reescribe `#tf-gasto` y cambia su `readOnly`. → Task 2 (`hayCambios` excluye `readOnly`) y Task 8 (recálculo al final de `_fichaPintar`).
3. **El foco inicial nunca cae en un botón que escribe** ("Emitir liga y copiar"/"Copiar liga" emiten; "✓ Autorizar" firma): la bandeja abre el registro con Enter y un Enter de más lo activaría. → Task 7 (`data-autofocus` en `#tl-mttl`).
4. **Visita cerrada, viewer y alta:** una visita cerrada muestra "Salió el …" y sin "✓ Finalizar"; el viewer ve la ficha y "Ver datos" con campos deshabilitados (nunca `readOnly`, para no tocar la señal de `#tf-gasto`); el alta abre con el formulario desplegado, Guardar encendido y sin ficha. → Task 7 y Task 10 (e2e).
5. **Celular a 390 px:** cinco botones en el pie (una visita abierta muestra Cerrar · + Reingresar · Expediente · ✓ Finalizar · Guardar) sin scroll horizontal y de al menos 44 px; el `<fieldset>` sin `min-inline-size:0` provoca scroll horizontal. → Task 4 (CSS) y Task 10 (e2e a 390 px).

## Mapa de archivos

| Archivo                                     | Acción    | Responsabilidad                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/taller/ficha.ts`                       | Crear     | Cuentas puras de la ficha: días (fórmula de la tabla), señal de salida, costo tri-estado, línea "Esperando firma".                                                                                                                                                                                                                                           |
| `src/taller/seguimiento.ts`                 | Modificar | `ordenarHallazgos(ps)` (tres grupos, orden estable).                                                                                                                                                                                                                                                                                                         |
| `src/taller/nombreUsuario.ts`               | Crear     | `esGuid`, `nombreDeUsuario`, `describirRevocadaPor` (sub/correo/`cierre:`/texto libre → nombre legible, nunca GUID).                                                                                                                                                                                                                                         |
| `src/taller/cambiosFormulario.ts`           | Crear     | `hayCambios(foto, actual)` excluyendo `readOnly`.                                                                                                                                                                                                                                                                                                            |
| `src/api/directorioUsuarios.ts`             | Crear     | Lectura pasiva, una vez por sesión y paginada, de `UserProfile` (`cognitoSub`, `email`, `nombre`); `yoActual()`.                                                                                                                                                                                                                                             |
| `src/api/cloudWire.ts`                      | Modificar | Puentes `window.__fichaRegistro`, `__ordenarHallazgos`, `__nombreDeUsuario`, `__describirRevocadaPor`, `__hayCambios`, `__directorioUsuarios`, junto a los de `:583-598`.                                                                                                                                                                                    |
| `src/api/cloudHydrate.ts`                   | Modificar | Declaraciones de los puentes nuevos en `interface Window`.                                                                                                                                                                                                                                                                                                   |
| `Control de flotilla.html`                  | Modificar | Markup de `#taller-modal` (`~L1313-1459`); `_fichaPintar` y helpers nuevos en su propio bloque; ajustes en `_provPintar`, `_provPartidas`, `_provFilaHistorial`, `openTallerModal`, `openModal`, `_markInvalid`, `clearTallerEntryFields`, `reingresoTaller`, `tlAcSelect`, `tlAcSelectNew`, `finalizarDesdeModal`, `expedienteDesdeModal`, el fondo y el ✕. |
| `nginx.conf`                                | Modificar | Lo reescribe `csp:sync`.                                                                                                                                                                                                                                                                                                                                     |
| `src/styles/main.css`                       | Modificar | Clases `tl-ficha-*`, `tl-datos-*`, `#taller-modal .tl-mcard{max-width:760px}`, pie en dos renglones ≤768 px, tema oscuro.                                                                                                                                                                                                                                    |
| `src/dev/demoRegistroFicha.ts`              | Crear     | Demo solo-dev (`?e2e=1&demo=registro-ficha`): 5 visitas, selector admin/riesgos/viewer, apagador, dobles de guardado, firma y directorio.                                                                                                                                                                                                                    |
| `src/main.ts`                               | Modificar | Guarda literal `import.meta.env.DEV` + `demo=registro-ficha` con `import()` dinámico, junto a la de `antes-despues` (`:1100-1109`).                                                                                                                                                                                                                          |
| `tests/tallerFicha.test.ts`                 | Crear     | Pruebas puras de `ficha.ts` y `ordenarHallazgos`.                                                                                                                                                                                                                                                                                                            |
| `tests/tallerNombreUsuario.test.ts`         | Crear     | Pruebas puras de `nombreUsuario.ts` y `cambiosFormulario.ts`.                                                                                                                                                                                                                                                                                                |
| `tests/directorioUsuarios.test.ts`          | Crear     | Caché, paginación, fallo silencioso, sin `ensureSession`, puentes publicados.                                                                                                                                                                                                                                                                                |
| `tests/tallerBloqueProveedor.test.ts`       | Modificar | Orden nuevo del modal; botones de liga en `#tf-prov-liga`.                                                                                                                                                                                                                                                                                                   |
| `tests/tallerPartidasEnRegistro.test.ts`    | Modificar | La línea de totales se mueve a la ficha.                                                                                                                                                                                                                                                                                                                     |
| `tests/tallerRegistroFichaMonolito.test.ts` | Crear     | Estructura y literales ejecutados del monolito: `_fichaPintar`, hallazgos, autofoco, pliegue, Guardar con cambios, cerrar con aviso, reingreso, directorio al llegar.                                                                                                                                                                                        |
| `tests/e2e/registro-ficha.spec.ts`          | Crear     | Chrome real sobre la demo: ficha, foco, Guardar, nombre, autorizar, alta, 390 px, descartar cambios, reingreso.                                                                                                                                                                                                                                              |
| `tests/e2e/antes-despues.spec.ts`           | Modificar | Solo el comentario de la línea 18 (el registro abre en "Todas").                                                                                                                                                                                                                                                                                             |

## Interfaces (las firmas exactas que comparten las tareas)

<!-- prettier-ignore-start -->
```ts
// src/taller/ficha.ts  (Task 1)
export type EstadoCosto =
  | { kind: "partidas"; autorizado: number; pendiente: number }
  | { kind: "capturado"; monto: number; verificando: boolean }
  | { kind: "sin-datos" };
export type SenalSalida =
  | { kind: "promesa-vencida"; dias: number }
  | { kind: "estimada-vencida"; dias: number }
  | { kind: "despues-de-estimada"; dias: number }
  | { kind: "ninguna" };
export type FichaRegistro = {
  estadoGpa: string;
  tipo: string;
  esperandoFirma: boolean;
  dias: { n: number; cerrada: boolean; inicio: string | null; fin: string | null; tono: "normal" | "ambar" | "rojo" };
  salida: { estimadaGpa: string | null; prometida: string | null; compromisoOriginal: string | null; senal: SenalSalida };
  costo: EstadoCosto;
  tallerNombre: string | null;
};
export function diasEnTallerTabla(fentrada: string, finMs: number): number;
export function diferenciaDiasCiviles(desde: string, hasta: string): number | null;
export function fichaRegistro(
  e: Partial<TallerEntry>,
  ps: readonly Partida[],
  opts: { ahora: string; hibrido: boolean | undefined; confiables: boolean },
): FichaRegistro;

// src/taller/seguimiento.ts  (Task 1)
export type GruposHallazgos = { esperanFirma: Partida[]; autorizados: Partida[]; noAutorizados: Partida[] };
export function ordenarHallazgos(ps: readonly Partida[]): GruposHallazgos;

// src/taller/nombreUsuario.ts  (Task 2)
export type EntradaDirectorio = { cognitoSub: string; email: string; nombre?: string | null };
export type Directorio = ReadonlyMap<string, EntradaDirectorio>;   // clave = cognitoSub
export type Yo = { sub: string | null; email: string | null };
export function esGuid(s: string): boolean;
export function nombreDeUsuario(crudo: string | null | undefined, directorio: Directorio | null, yo: Yo): string;
export function describirRevocadaPor(crudo: string | null | undefined, directorio: Directorio | null, yo: Yo): { porCierre: boolean; nombre: string | null };

// src/taller/cambiosFormulario.ts  (Task 2)
export type FotoCampos = Record<string, { valor: string; readOnly: boolean }>;
export function hayCambios(foto: FotoCampos, actual: FotoCampos): boolean;

// src/api/directorioUsuarios.ts  (Task 3)
export function cargarDirectorio(): Promise<Directorio | null>;   // una vez por sesión; null si falla; nunca ensureSession
export function directorioEnCache(): Directorio | null;
export function yoActual(): Promise<Yo>;                            // getCurrentUser().userId + email de __cloudSession; guarda en caché
export function yoEnCache(): Yo;

// src/api/cloudWire.ts — puentes (Task 3), junto a window.__filasPendientes (:604)
window.__fichaRegistro = (e, ps, opts: { hibrido: boolean | undefined; confiables: boolean }) => FichaRegistro;
window.__ordenarHallazgos = ordenarHallazgos;
window.__nombreDeUsuario = (crudo) => string;
window.__describirRevocadaPor = (crudo) => { porCierre: boolean; nombre: string | null };
window.__hayCambios = hayCambios;
window.__directorioUsuarios = { cargar: () => Promise<boolean> };  // true si cargó (o ya estaba); false si falló

// Monolito — funciones NUEVAS, cada una en su propio bloque (Tasks 5, 7, 8, 9)
function _fichaPintar(e)            // pinta #tl-msub, #tf-ficha (todas sus piezas), #tf-datos-resumen y #tf-aviso-firma; registra nodos de nombre en _tfNombres (WeakMap nodo → {crudo, plantilla}) y _tfNodosNombre (Set); termina con _tfRecalcularCambios()
function _tfAutofoco(id)            // quita [data-autofocus] de donde esté en #taller-modal y lo pone en #id
function _tfTomarFoto()             // devuelve la foto {id: {valor, readOnly}} de los controles con id dentro de #tf-datos-campos
function _tfRecalcularCambios()     // habilita/deshabilita #btn-guardar-taller y muestra/oculta #tf-sin-cambios con window.__hayCambios
function _tallerCerrarConAviso()    // si hay cambios: confirm("¿Descartar los cambios?"); si acepta o no hay cambios: closeTallerModal(); devuelve true si cerró
function _tfNombresRefrescar()      // al llegar el directorio: reescribe por textContent los nodos registrados en _tfNodosNombre
function _tfAvisoFirmaIr()          // pone _provFiltro = "pendientes", _provPartidas(e), scrollIntoView a la primera fila
```
<!-- prettier-ignore-end -->

---

### Task 1: Capa pura de la ficha y el orden de hallazgos

**Files:**

- Create: `src/taller/ficha.ts`
- Modify: `src/taller/seguimiento.ts` (al final del archivo)
- Test: `tests/tallerFicha.test.ts` (nuevo)

**Interfaces:**

- Consumes: `promesaTaller`, `resumenPartidas`, `distintivoProveedor` (`src/taller/seguimiento.ts`); `estadoLiga`, `visitaCerrada`, `DIA_MS` (`src/taller/liga.ts`); `gastoDerivado`, `gastoTotalDe`, `montoPendienteDeFirma` (`src/taller/partidas.ts`); `diasVencida` (`src/taller/tallerStore.ts:50`).
- Produces: `diasEnTallerTabla`, `diferenciaDiasCiviles`, `fichaRegistro`, tipos `EstadoCosto`, `SenalSalida`, `FichaRegistro` (ficha.ts); `ordenarHallazgos`, `GruposHallazgos` (seguimiento.ts). Firmas exactas en "Interfaces" arriba.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `tests/tallerFicha.test.ts`:

<!-- prettier-ignore-start -->
```ts
// Registro como ficha (spec 2026-09-30 §4.2): las cuentas viven en src/, el monolito pinta.
import { describe, expect, it } from "vitest";
import { diasEnTallerTabla, diferenciaDiasCiviles, fichaRegistro } from "../src/taller/ficha";
import { ordenarHallazgos } from "../src/taller/seguimiento";
import type { Partida } from "../src/taller/partidas";
import type { TallerEntry } from "../src/taller/types";

// 10:00 en CST del 30/09: la fórmula de la tabla (medianoche UTC) da 6 con entrada 25/09;
// el Excel (medianoche local) daría 5. Manda la tabla (§2 #25).
const AHORA = "2026-09-30T16:00:00.000Z";
const OPTS = { ahora: AHORA, hibrido: true as boolean | undefined, confiables: true };

const P = (s: Partial<Partida> = {}): Partida =>
  ({
    partidaId: "p",
    visitaKey: "vk",
    descripcion: "Balatas",
    estado: "propuesta",
    tipo: "refaccion",
    fotos: [],
    precio: 2400,
    creadoEn: "2026-09-25T16:00:00.000Z",
    ...s,
  }) as Partida;

const E = (s: Partial<TallerEntry> = {}): Partial<TallerEntry> => ({
  estado: "En Reparación",
  tipo: "Correctivo",
  fentrada: "2026-09-25",
  fsalidaEst: "2026-09-30",
  ...s,
});

describe("diasEnTallerTabla — la MISMA cuenta que la tabla", () => {
  it("entrada 25/09 y ahora 30/09 10:00 CST ⇒ 6", () => {
    expect(diasEnTallerTabla("2026-09-25", Date.parse(AHORA))).toBe(6);
  });
  it("fecha inválida ⇒ 0, nunca NaN", () => {
    expect(diasEnTallerTabla("", Date.parse(AHORA))).toBe(0);
    expect(diasEnTallerTabla("no-es-fecha", Date.parse(AHORA))).toBe(0);
  });
});

describe("diferenciaDiasCiviles — días de calendario, sin huso", () => {
  it("30/09 → 01/10 ⇒ 1; 01/10 → 30/09 ⇒ -1; inválida ⇒ null", () => {
    expect(diferenciaDiasCiviles("2026-09-30", "2026-10-01")).toBe(1);
    expect(diferenciaDiasCiviles("2026-10-01", "2026-09-30")).toBe(-1);
    expect(diferenciaDiasCiviles("2026-09-30", "")).toBeNull();
  });
});

describe("fichaRegistro — días", () => {
  it("visita abierta: 6 días, tono ámbar (>3), 'Ingresó' el 25/09", () => {
    const f = fichaRegistro(E(), [], OPTS);
    expect(f.dias).toEqual({ n: 6, cerrada: false, inicio: "2026-09-25", fin: null, tono: "ambar" });
  });
  it("más de 7 días ⇒ rojo; 3 o menos ⇒ normal", () => {
    expect(fichaRegistro(E({ fentrada: "2026-09-20" }), [], OPTS).dias.tono).toBe("rojo");
    expect(fichaRegistro(E({ fentrada: "2026-09-28" }), [], OPTS).dias.tono).toBe("normal");
  });
  it("visita cerrada: cuenta hasta la salida real y el tono es normal", () => {
    const f = fichaRegistro(E({ estado: "Finalizado", fsalidaReal: "2026-09-29" }), [], OPTS);
    expect(f.dias).toEqual({ n: 4, cerrada: true, inicio: "2026-09-25", fin: "2026-09-29", tono: "normal" });
  });
});

describe("fichaRegistro — salida (una sola señal, por prioridad)", () => {
  it("promesa del taller vencida gana", () => {
    const f = fichaRegistro(E({ fsalidaEst: "2026-09-28", fsalidaEstTaller: "2026-09-27" }), [], OPTS);
    expect(f.salida.senal).toEqual({ kind: "promesa-vencida", dias: 3 });
    expect(f.salida.prometida).toBe("2026-09-27");
  });
  it("sin promesa y estimada de GPA vencida ⇒ 'estimada-vencida'", () => {
    const f = fichaRegistro(E({ fsalidaEst: "2026-09-27" }), [], OPTS);
    expect(f.salida.senal.kind).toBe("estimada-vencida");
  });
  it("promesa vigente un día después de la estimada ⇒ 'despues-de-estimada' 1", () => {
    const f = fichaRegistro(E({ fsalidaEst: "2026-10-05", fsalidaEstTaller: "2026-10-06" }), [], OPTS);
    expect(f.salida.senal).toEqual({ kind: "despues-de-estimada", dias: 1 });
    expect(f.salida.estimadaGpa).toBe("2026-10-05");
  });
  it("promesa igual o antes de la estimada ⇒ ninguna; 'había prometido' viaja", () => {
    const f = fichaRegistro(
      E({ fsalidaEst: "2026-10-05", fsalidaEstTaller: "2026-10-05", fsalidaEstCompromiso: "2026-10-03" }),
      [],
      OPTS,
    );
    expect(f.salida.senal).toEqual({ kind: "ninguna" });
    expect(f.salida.compromisoOriginal).toBe("2026-10-03");
  });
  it("cerrada: nunca vencida", () => {
    const f = fichaRegistro(E({ estado: "Finalizado", fsalidaReal: "2026-09-29", fsalidaEst: "2026-09-27" }), [], OPTS);
    expect(f.salida.senal).toEqual({ kind: "ninguna" });
  });
});

describe("fichaRegistro — costo (tri-estado del apagador)", () => {
  const ps = [P({ estado: "autorizada", precioAutorizado: 1850 }), P({ estado: "propuesta", precio: 2400 })];
  it("híbrido ON, confiables y con partidas ⇒ autorizado y pendiente de la capa pura", () => {
    expect(fichaRegistro(E(), ps, OPTS).costo).toEqual({ kind: "partidas", autorizado: 1850, pendiente: 2400 });
  });
  it("híbrido ON, confiables, sin partidas ⇒ capturado por GPA", () => {
    expect(fichaRegistro(E({ gastoRef: 100, gastoMO: 50 }), [], OPTS).costo).toEqual({ kind: "capturado", monto: 150, verificando: false });
  });
  it("híbrido ON y NO confiables ⇒ sin datos, nunca $0", () => {
    const c = fichaRegistro(E(), [], { ...OPTS, confiables: false }).costo;
    expect(c).toEqual({ kind: "sin-datos" });
  });
  it("híbrido OFF ⇒ capturado aunque haya partidas", () => {
    expect(fichaRegistro(E({ gasto: 999 }), ps, { ...OPTS, hibrido: false }).costo).toEqual({ kind: "capturado", monto: 999, verificando: false });
  });
  it("híbrido desconocido ⇒ capturado · verificando", () => {
    expect(fichaRegistro(E({ gasto: 999 }), ps, { ...OPTS, hibrido: undefined }).costo).toEqual({ kind: "capturado", monto: 999, verificando: true });
  });
});

describe("fichaRegistro — estado GPA y la línea 'Esperando firma' (§2 #14)", () => {
  it("copia estado y tipo; con pendientes y promesa vigente ⇒ esperandoFirma", () => {
    const f = fichaRegistro(E({ fsalidaEstTaller: "2026-10-06" }), [P()], OPTS);
    expect(f.estadoGpa).toBe("En Reparación");
    expect(f.tipo).toBe("Correctivo");
    expect(f.esperandoFirma).toBe(true);
  });
  it("con la promesa vencida la lista marca «Promesa vencida»: la línea NO sale", () => {
    expect(fichaRegistro(E({ fsalidaEstTaller: "2026-09-27" }), [P()], OPTS).esperandoFirma).toBe(false);
  });
  it("sin pendientes, con el apagador apagado o sin partidas confiables ⇒ false", () => {
    expect(fichaRegistro(E(), [], OPTS).esperandoFirma).toBe(false);
    expect(fichaRegistro(E(), [P()], { ...OPTS, hibrido: false }).esperandoFirma).toBe(false);
    expect(fichaRegistro(E(), [P()], { ...OPTS, confiables: false }).esperandoFirma).toBe(false);
  });
  it("tallerNombre sale de 'Técnico asignado' (§2 #16), vacío ⇒ null", () => {
    expect(fichaRegistro(E({ tecnico: "  Taller Frenos del Bajío " }), [], OPTS).tallerNombre).toBe("Taller Frenos del Bajío");
    expect(fichaRegistro(E({ tecnico: "  " }), [], OPTS).tallerNombre).toBeNull();
  });
});

describe("ordenarHallazgos — tres grupos, orden estable (§2 #18)", () => {
  it("propuestas → autorizadas/terminadas → el resto, cada grupo en el orden de llegada", () => {
    const a = P({ partidaId: "a", estado: "autorizada" });
    const b = P({ partidaId: "b", estado: "propuesta" });
    const c = P({ partidaId: "c", estado: "rechazada" });
    const d = P({ partidaId: "d", estado: "terminada" });
    const e = P({ partidaId: "e", estado: "propuesta" });
    const f = P({ partidaId: "f", estado: "borrador" });
    const g = ordenarHallazgos([a, b, c, d, e, f]);
    expect(g.esperanFirma.map((p) => p.partidaId)).toEqual(["b", "e"]);
    expect(g.autorizados.map((p) => p.partidaId)).toEqual(["a", "d"]);
    expect(g.noAutorizados.map((p) => p.partidaId)).toEqual(["c", "f"]);
  });
  it("vacío ⇒ tres grupos vacíos", () => {
    expect(ordenarHallazgos([])).toEqual({ esperanFirma: [], autorizados: [], noAutorizados: [] });
  });
});
```
<!-- prettier-ignore-end -->

- [ ] **Step 2: Correr y ver que fallan**

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npx vitest run tests/tallerFicha.test.ts | tail -20`
Expected: FAIL — `Failed to resolve import "../src/taller/ficha"` y `ordenarHallazgos` no exportada.

- [ ] **Step 3: Implementar `src/taller/ficha.ts`**

<!-- prettier-ignore-start -->
```ts
/**
 * Registro como ficha — capa PURA (sin DOM, sin red). Spec 2026-09-30 §4.2.
 *
 * Todo sale de columnas que ya existen y de las reglas que ya usan la tabla y el
 * registro (promesaTaller, diasVencida, gastoDerivado, distintivoProveedor). El
 * monolito (`_fichaPintar`) solo traduce este objeto a nodos.
 */
import type { TallerEntry, TallerEstado } from "./types";
import type { Partida } from "./partidas";
import { gastoDerivado, gastoTotalDe, montoPendienteDeFirma } from "./partidas";
import { DIA_MS, estadoLiga, visitaCerrada } from "./liga";
import { distintivoProveedor, promesaTaller, resumenPartidas } from "./seguimiento";
import { diasVencida } from "./tallerStore";

export type EstadoCosto =
  | { kind: "partidas"; autorizado: number; pendiente: number }
  | { kind: "capturado"; monto: number; verificando: boolean }
  | { kind: "sin-datos" };

export type SenalSalida =
  | { kind: "promesa-vencida"; dias: number }
  | { kind: "estimada-vencida"; dias: number }
  | { kind: "despues-de-estimada"; dias: number }
  | { kind: "ninguna" };

export type FichaRegistro = {
  estadoGpa: string;
  tipo: string;
  esperandoFirma: boolean;
  dias: {
    n: number;
    cerrada: boolean;
    inicio: string | null;
    fin: string | null;
    tono: "normal" | "ambar" | "rojo";
  };
  salida: {
    estimadaGpa: string | null;
    prometida: string | null;
    compromisoOriginal: string | null;
    senal: SenalSalida;
  };
  costo: EstadoCosto;
  tallerNombre: string | null;
};

const dia = (s: unknown): string | null => {
  const v = String(s ?? "").trim().slice(0, 10);
  return v ? v : null;
};

/**
 * La MISMA cuenta que la tabla de Operaciones Activas (`Date.now() - new Date(fentrada)`,
 * medianoche UTC). Decisión 25: la ficha no puede contradecir a la tabla que Navares ya lee.
 * El Excel (`diasEnTaller`, medianoche local) difiere 1 día entre 06:00 y 12:00 en México
 * y queda anotado como defecto previo (spec §3).
 */
export function diasEnTallerTabla(fentrada: string, finMs: number): number {
  const ini = Date.parse(String(fentrada ?? "").slice(0, 10));
  if (!Number.isFinite(ini) || !Number.isFinite(finMs)) return 0;
  return Math.max(0, Math.round((finMs - ini) / DIA_MS));
}

/** Días de calendario entre dos fechas `AAAA-MM-DD`, sin huso. `null` si alguna no es fecha. */
export function diferenciaDiasCiviles(desde: string, hasta: string): number | null {
  const a = Date.parse(`${String(desde ?? "").slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(hasta ?? "").slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DIA_MS);
}

export function fichaRegistro(
  e: Partial<TallerEntry>,
  ps: readonly Partida[],
  opts: { ahora: string; hibrido: boolean | undefined; confiables: boolean },
): FichaRegistro {
  const ahoraMs = Date.parse(opts.ahora);
  const hoyISO = opts.ahora.slice(0, 10);
  const lista = Array.from(ps);

  // ── Días
  const cerrada = visitaCerrada(e);
  const inicio = dia(e.fentrada);
  const fin = cerrada ? dia(e.fsalidaReal) : null;
  const finMs = fin ? Date.parse(fin) : ahoraMs;
  const n = inicio ? diasEnTallerTabla(inicio, finMs) : 0;
  const tono = cerrada ? "normal" : n > 7 ? "rojo" : n > 3 ? "ambar" : "normal";

  // ── Salida: una sola señal, por prioridad (§4.2). El "hoy" de la promesa es el mismo
  //    que usa la tabla (__promesaTaller: fecha UTC del instante).
  const prom = promesaTaller(e, hoyISO);
  const estimadaGpa = dia(e.fsalidaEst);
  const prometida = prom.kind === "sin-promesa" ? null : prom.fecha;
  const compromisoOriginal = prom.kind !== "sin-promesa" && prom.compromisoOriginal ? prom.compromisoOriginal : null;
  let senal: SenalSalida = { kind: "ninguna" };
  if (prom.kind === "vencida") {
    senal = { kind: "promesa-vencida", dias: prom.diasVencida };
  } else {
    const vencida = diasVencida(
      {
        estado: (e.estado ?? "En Diagnóstico") as TallerEstado,
        fsalidaEst: e.fsalidaEst,
        fsalidaReal: e.fsalidaReal,
      },
      new Date(ahoraMs),
    );
    if (vencida != null) {
      senal = { kind: "estimada-vencida", dias: vencida };
    } else if (estimadaGpa && prometida) {
      const d = diferenciaDiasCiviles(estimadaGpa, prometida);
      if (d != null && d > 0) senal = { kind: "despues-de-estimada", dias: d };
    }
  }

  // ── Costo: la misma fuente que #tf-gasto (gastoDerivado / montoPendienteDeFirma, §2 #19)
  const capturado = gastoTotalDe(e);
  let costo: EstadoCosto;
  if (opts.hibrido === true) {
    if (!opts.confiables) costo = { kind: "sin-datos" };
    else if (lista.length) {
      costo = {
        kind: "partidas",
        autorizado: gastoDerivado(e, lista).gasto,
        pendiente: montoPendienteDeFirma(lista),
      };
    } else costo = { kind: "capturado", monto: capturado, verificando: false };
  } else if (opts.hibrido === false) {
    costo = { kind: "capturado", monto: capturado, verificando: false };
  } else {
    costo = { kind: "capturado", monto: capturado, verificando: true };
  }

  // ── "Esperando firma" solo si es la señal que pinta la lista (§2 #14): misma función.
  const dist = distintivoProveedor(estadoLiga(e, opts.ahora), prom, resumenPartidas(lista));
  const esperandoFirma = opts.hibrido === true && opts.confiables && dist.kind === "esperando-firma";

  const tecnico = String(e.tecnico ?? "").trim();
  return {
    estadoGpa: String(e.estado ?? ""),
    tipo: String(e.tipo ?? ""),
    esperandoFirma,
    dias: { n, cerrada, inicio, fin, tono },
    salida: { estimadaGpa, prometida, compromisoOriginal, senal },
    costo,
    tallerNombre: tecnico || null,
  };
}
```
<!-- prettier-ignore-end -->

Y al FINAL de `src/taller/seguimiento.ts`:

<!-- prettier-ignore-start -->
```ts

// ── Registro como ficha (spec 2026-09-30 §2 #18) ─────────────────────────────
export type GruposHallazgos = {
  esperanFirma: Partida[];
  autorizados: Partida[];
  noAutorizados: Partida[];
};

/** Los tres grupos del registro, en el orden en que llegan (estable). El monolito
 *  solo pinta los subtítulos; los filtros "Pendientes/Autorizadas/Rechazadas" siguen
 *  mostrando un solo grupo. */
export function ordenarHallazgos(ps: readonly Partida[]): GruposHallazgos {
  const g: GruposHallazgos = { esperanFirma: [], autorizados: [], noAutorizados: [] };
  for (const p of ps) {
    if (p.estado === "propuesta") g.esperanFirma.push(p);
    else if (p.estado === "autorizada" || p.estado === "terminada") g.autorizados.push(p);
    else g.noAutorizados.push(p);
  }
  return g;
}
```
<!-- prettier-ignore-end -->

- [ ] **Step 4: Correr y ver que pasan**

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npx vitest run tests/tallerFicha.test.ts tests/tallerSeguimientoDistintivo.test.ts tests/tallerSeguimientoEstado.test.ts | tail -20`
Expected: PASS.
Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npm run typecheck | tail -10`
Expected: sin errores. Si `visitaCerrada` o `promesaTaller` tienen otra firma que la usada, ajusta la llamada (no la función existente).

- [ ] **Step 5: Commit**

<!-- prettier-ignore-start -->
```bash
git -C "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" add src/taller/ficha.ts src/taller/seguimiento.ts tests/tallerFicha.test.ts
git -C "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" commit -m "feat(taller): la ficha del registro se calcula en la capa pura (días, salida, costo, orden de hallazgos)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
<!-- prettier-ignore-end -->

---

### Task 2: Nombre de usuario y detección de cambios (capa pura)

**Files:**

- Create: `src/taller/nombreUsuario.ts`
- Create: `src/taller/cambiosFormulario.ts`
- Test: `tests/tallerNombreUsuario.test.ts` (nuevo)

**Interfaces:**

- Consumes: nada del repo.
- Produces: `esGuid`, `nombreDeUsuario`, `describirRevocadaPor`, tipos `EntradaDirectorio`, `Directorio`, `Yo` (nombreUsuario.ts); `hayCambios`, tipo `FotoCampos` (cambiosFormulario.ts). Firmas exactas en "Interfaces".

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `tests/tallerNombreUsuario.test.ts`:

<!-- prettier-ignore-start -->
```ts
// "Emitida por": el nombre, nunca el id (spec 2026-09-30 §4.7) + Guardar solo con cambios (§4.5).
import { describe, expect, it } from "vitest";
import {
  describirRevocadaPor,
  esGuid,
  nombreDeUsuario,
  type Directorio,
  type Yo,
} from "../src/taller/nombreUsuario";
import { hayCambios, type FotoCampos } from "../src/taller/cambiosFormulario";

const SUB_ANA = "11111111-2222-4333-8444-555555555555";
const SUB_SIN_NOMBRE = "22222222-2222-4333-8444-555555555555";
const SUB_AJENO = "33333333-2222-4333-8444-555555555555";
const SUB_YO = "44444444-2222-4333-8444-555555555555";
const DIR: Directorio = new Map([
  [SUB_ANA, { cognitoSub: SUB_ANA, email: "ana@ejemplo.test", nombre: "Ana López" }],
  [SUB_SIN_NOMBRE, { cognitoSub: SUB_SIN_NOMBRE, email: "luis@ejemplo.test", nombre: "" }],
  [SUB_YO, { cognitoSub: SUB_YO, email: "yo@ejemplo.test", nombre: "Navares" }],
]);
const YO: Yo = { sub: SUB_YO, email: "yo@ejemplo.test" };
const NADIE: Yo = { sub: null, email: null };
// Existe en prod (medición 2026-09-30): un ligaRevocadaPor con texto libre.
const TEXTO_LIBRE = "revocacion manual (CLI admin) por incidente 2026-09-22, autorizada por Navares";

describe("esGuid", () => {
  it("reconoce un sub de Cognito y nada más", () => {
    expect(esGuid(SUB_ANA)).toBe(true);
    expect(esGuid("ana@ejemplo.test")).toBe(false);
    expect(esGuid(TEXTO_LIBRE)).toBe(false);
  });
});

describe("nombreDeUsuario — la cadena de respaldo (§4.7)", () => {
  it("sub en el directorio ⇒ el nombre", () => {
    expect(nombreDeUsuario(SUB_ANA, DIR, NADIE)).toBe("Ana López");
  });
  it("perfil sin nombre ⇒ el correo sin dominio", () => {
    expect(nombreDeUsuario(SUB_SIN_NOMBRE, DIR, NADIE)).toBe("luis");
  });
  it("un correo crudo ⇒ sin dominio, aunque no haya directorio", () => {
    expect(nombreDeUsuario("riesgos@ejemplo.test", null, NADIE)).toBe("riesgos");
  });
  it("mi propio sub o correo ⇒ '(tú)' con nombre, o 'tú' sin nada más", () => {
    expect(nombreDeUsuario(SUB_YO, DIR, YO)).toBe("Navares (tú)");
    expect(nombreDeUsuario("yo@ejemplo.test", null, YO)).toBe("yo (tú)");
    expect(nombreDeUsuario(SUB_YO, null, YO)).toBe("tú");
  });
  it("'desconocido', vacío, null, un sub que no está o texto libre ⇒ 'un usuario de GPA'", () => {
    for (const crudo of ["desconocido", "", null, undefined, SUB_AJENO, TEXTO_LIBRE]) {
      expect(nombreDeUsuario(crudo, DIR, NADIE)).toBe("un usuario de GPA");
    }
  });
  it("la salida NUNCA parece un GUID", () => {
    for (const crudo of [SUB_ANA, SUB_SIN_NOMBRE, SUB_AJENO, SUB_YO]) {
      expect(esGuid(nombreDeUsuario(crudo, DIR, YO))).toBe(false);
      expect(esGuid(nombreDeUsuario(crudo, null, NADIE))).toBe(false);
    }
  });
});

describe("describirRevocadaPor — el prefijo 'cierre:'", () => {
  it("cierre:correo ⇒ porCierre con el nombre resuelto", () => {
    expect(describirRevocadaPor("cierre:ana@ejemplo.test", DIR, NADIE)).toEqual({ porCierre: true, nombre: "Ana López" });
  });
  it("cierre:desconocido ⇒ porCierre sin nombre", () => {
    expect(describirRevocadaPor("cierre:desconocido", DIR, NADIE)).toEqual({ porCierre: true, nombre: null });
  });
  it("sin prefijo ⇒ revocación normal con su nombre (o el respaldo)", () => {
    expect(describirRevocadaPor(SUB_ANA, DIR, NADIE)).toEqual({ porCierre: false, nombre: "Ana López" });
    expect(describirRevocadaPor(TEXTO_LIBRE, DIR, NADIE)).toEqual({ porCierre: false, nombre: "un usuario de GPA" });
  });
});

describe("hayCambios — Guardar solo con cambios (§4.5)", () => {
  const foto: FotoCampos = {
    "tf-km": { valor: "85000", readOnly: false },
    "tf-gasto": { valor: "3850", readOnly: true },
    "tf-tecnico": { valor: "Taller X", readOnly: false },
  };
  it("sin cambios ⇒ false", () => {
    expect(hayCambios(foto, { ...foto })).toBe(false);
  });
  it("cambiar un campo editable ⇒ true", () => {
    expect(hayCambios(foto, { ...foto, "tf-km": { valor: "86000", readOnly: false } })).toBe(true);
  });
  it("#tf-gasto repintado por _tfGastoPintar (readOnly, otro valor) ⇒ NO cuenta", () => {
    expect(hayCambios(foto, { ...foto, "tf-gasto": { valor: "5200", readOnly: true } })).toBe(false);
  });
  it("un campo que pasó a readOnly después de la foto tampoco cuenta", () => {
    expect(hayCambios(foto, { ...foto, "tf-km": { valor: "0", readOnly: true } })).toBe(false);
  });
  it("campos que solo están en uno de los dos lados se ignoran", () => {
    expect(hayCambios(foto, { "tf-km": foto["tf-km"] })).toBe(false);
  });
});
```
<!-- prettier-ignore-end -->

- [ ] **Step 2: Correr y ver que fallan**

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npx vitest run tests/tallerNombreUsuario.test.ts | tail -20`
Expected: FAIL — los dos módulos no existen.

- [ ] **Step 3: Implementar**

`src/taller/nombreUsuario.ts`:

<!-- prettier-ignore-start -->
```ts
/**
 * "Emitida por": el nombre, nunca el id (spec 2026-09-30 §4.7). Capa PURA.
 *
 * `ligaCreadaPor`/`ligaRevocadaPor` guardan hoy el `sub` de Cognito (medido en prod
 * 2026-09-30), a veces `"desconocido"`, `cierre:<correo>` (liga-cierre) o incluso texto
 * libre de una revocación manual. Las firmas guardan el correo. Todo entra aquí y sale
 * legible. Un GUID jamás llega al DOM: ni en el texto ni en un `title`.
 */
export type EntradaDirectorio = { cognitoSub: string; email: string; nombre?: string | null };
/** Clave = cognitoSub. */
export type Directorio = ReadonlyMap<string, EntradaDirectorio>;
export type Yo = { sub: string | null; email: string | null };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORREO = /^[^\s@]+@[^\s@]+$/;
const RESPALDO = "un usuario de GPA";

export function esGuid(s: string): boolean {
  return GUID.test(String(s ?? "").trim());
}

const sinDominio = (correo: string): string => correo.split("@")[0] ?? correo;

function buscar(directorio: Directorio | null, crudo: string): EntradaDirectorio | null {
  if (!directorio) return null;
  const porSub = directorio.get(crudo);
  if (porSub) return porSub;
  const c = crudo.toLowerCase();
  for (const e of directorio.values()) {
    if ((e.email ?? "").toLowerCase() === c) return e;
  }
  return null;
}

/** nombre → correo sin dominio → "tú" → "un usuario de GPA". */
export function nombreDeUsuario(
  crudo: string | null | undefined,
  directorio: Directorio | null,
  yo: Yo,
): string {
  const c = String(crudo ?? "").trim();
  if (!c || c === "desconocido") return RESPALDO;
  const soyYo =
    (!!yo.sub && c === yo.sub) || (!!yo.email && c.toLowerCase() === yo.email.toLowerCase());
  const entrada = buscar(directorio, c);
  const nombre = String(entrada?.nombre ?? "").trim();
  if (nombre) return soyYo ? `${nombre} (tú)` : nombre;
  const correo = CORREO.test(c) ? c : String(entrada?.email ?? "");
  if (correo && CORREO.test(correo)) {
    const corto = sinDominio(correo);
    return soyYo ? `${corto} (tú)` : corto;
  }
  if (soyYo) return "tú";
  return RESPALDO;
}

/** `cierre:<quien>` ⇒ "Se cerró junto con la visita (quien)"; `cierre:desconocido` ⇒ sin nombre. */
export function describirRevocadaPor(
  crudo: string | null | undefined,
  directorio: Directorio | null,
  yo: Yo,
): { porCierre: boolean; nombre: string | null } {
  const c = String(crudo ?? "").trim();
  if (c.startsWith("cierre:")) {
    const resto = c.slice("cierre:".length).trim();
    if (!resto || resto === "desconocido") return { porCierre: true, nombre: null };
    return { porCierre: true, nombre: nombreDeUsuario(resto, directorio, yo) };
  }
  return { porCierre: false, nombre: nombreDeUsuario(c, directorio, yo) };
}
```
<!-- prettier-ignore-end -->

`src/taller/cambiosFormulario.ts`:

<!-- prettier-ignore-start -->
```ts
/**
 * Guardar solo con cambios (spec 2026-09-30 §4.5). Capa PURA.
 *
 * Un control `readOnly` no cuenta, ni en la foto ni al comparar: `_bnRepintar →
 * _tfGastoPintar` reescribe `#tf-gasto` con el derivado y lo pasa de editable a
 * readOnly (o al revés) sin que la persona toque nada; si contara, Guardar se
 * encendería solo después de firmar o se quedaría encendido con el valor ya revertido.
 */
export type FotoCampos = Record<string, { valor: string; readOnly: boolean }>;

export function hayCambios(foto: FotoCampos, actual: FotoCampos): boolean {
  for (const id of Object.keys(foto)) {
    const a = foto[id];
    const b = actual[id];
    if (!a || !b) continue;
    if (a.readOnly || b.readOnly) continue;
    if (a.valor !== b.valor) return true;
  }
  return false;
}
```
<!-- prettier-ignore-end -->

- [ ] **Step 4: Correr y ver que pasan**

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npx vitest run tests/tallerNombreUsuario.test.ts | tail -20`
Expected: PASS.
Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npm run typecheck | tail -10`
Expected: sin errores.

- [ ] **Step 5: Commit**

<!-- prettier-ignore-start -->
```bash
git -C "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" add src/taller/nombreUsuario.ts src/taller/cambiosFormulario.ts tests/tallerNombreUsuario.test.ts
git -C "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" commit -m "feat(taller): quién emitió la liga se lee por nombre, nunca por id; y se sabe si el formulario cambió" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
<!-- prettier-ignore-end -->

---

### Task 3: Directorio de usuarios y puentes `window.__*`

**Files:**

- Create: `src/api/directorioUsuarios.ts`
- Modify: `src/api/cloudWire.ts` (imports; puentes justo después del bloque `window.__filasPendientes` ~`:604-605`)
- Modify: `src/api/cloudHydrate.ts` (`interface Window`, después de `__distintivoProveedor` ~`:293`)
- Test: `tests/directorioUsuarios.test.ts` (nuevo)

**Interfaces:**

- Consumes: `getClient` (`src/api/amplifyClient`), `getCurrentUser` (`aws-amplify/auth`), `window.__cloudSession` (`AuthSession` con `username`, `email`, `tenantId`, `groups`), `fichaRegistro`/`ordenarHallazgos`/`nombreDeUsuario`/`describirRevocadaPor`/`hayCambios` (Tasks 1–2).
- Produces: `cargarDirectorio`, `directorioEnCache`, `yoActual`, `yoEnCache` y los seis puentes `window.__*` (firmas exactas en "Interfaces").

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `tests/directorioUsuarios.test.ts`:

<!-- prettier-ignore-start -->
```ts
// Directorio de usuarios para "Emitida por NOMBRE" (spec 2026-09-30 §4.7): lectura
// PASIVA (nunca ensureSession), UNA vez por sesión, paginada, y que se calla si falla.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.fn();
vi.mock("../src/api/amplifyClient", () => ({
  getClient: () => ({ models: { UserProfile: { list } } }),
}));
vi.mock("aws-amplify/auth", () => ({
  getCurrentUser: vi.fn(async () => ({ userId: "44444444-2222-4333-8444-555555555555" })),
}));

const SUB_ANA = "11111111-2222-4333-8444-555555555555";
const pagina = (data: unknown[], nextToken: string | null) => ({ data, nextToken, errors: undefined });

describe("directorioUsuarios", () => {
  beforeEach(() => {
    vi.resetModules();
    list.mockReset();
    (window as unknown as { __cloudSession: unknown }).__cloudSession = {
      username: "yo@ejemplo.test",
      email: "yo@ejemplo.test",
      tenantId: "demo",
      groups: ["operativo"],
    };
  });

  it("pagina con nextToken y arma el mapa por cognitoSub", async () => {
    list
      .mockResolvedValueOnce(pagina([{ cognitoSub: SUB_ANA, email: "ana@ejemplo.test", nombre: "Ana López" }], "t1"))
      .mockResolvedValueOnce(pagina([{ cognitoSub: "22222222-2222-4333-8444-555555555555", email: "luis@ejemplo.test", nombre: null }], null));
    const m = await import("../src/api/directorioUsuarios");
    const d = await m.cargarDirectorio();
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[1]![0]).toMatchObject({ nextToken: "t1" });
    expect(d?.get(SUB_ANA)?.nombre).toBe("Ana López");
    expect(m.directorioEnCache()).toBe(d);
  });

  it("pide una sola vez aunque se llame dos veces (una por sesión)", async () => {
    list.mockResolvedValue(pagina([], null));
    const m = await import("../src/api/directorioUsuarios");
    await Promise.all([m.cargarDirectorio(), m.cargarDirectorio()]);
    await m.cargarDirectorio();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("sin sesión ⇒ null sin llamar a la nube; con error ⇒ null sin lanzar", async () => {
    (window as unknown as { __cloudSession: unknown }).__cloudSession = null;
    const m = await import("../src/api/directorioUsuarios");
    expect(await m.cargarDirectorio()).toBeNull();
    expect(list).not.toHaveBeenCalled();
    (window as unknown as { __cloudSession: unknown }).__cloudSession = { tenantId: "demo", username: "x@ejemplo.test", email: "x@ejemplo.test", groups: [] };
    list.mockRejectedValueOnce(new Error("red"));
    expect(await m.cargarDirectorio()).toBeNull();
  });

  it("yoActual: sub de getCurrentUser y correo de la sesión, en caché", async () => {
    const m = await import("../src/api/directorioUsuarios");
    expect(await m.yoActual()).toEqual({ sub: "44444444-2222-4333-8444-555555555555", email: "yo@ejemplo.test" });
    expect(m.yoEnCache().sub).toBe("44444444-2222-4333-8444-555555555555");
  });

  it("nunca llama a ensureSession (lectura pasiva, B-I5)", () => {
    const src = readFileSync(join(__dirname, "..", "src", "api", "directorioUsuarios.ts"), "utf8");
    expect(src).not.toContain("ensureSession");
  });

  it("cloudWire publica los seis puentes y cloudHydrate los declara", () => {
    const wire = readFileSync(join(__dirname, "..", "src", "api", "cloudWire.ts"), "utf8");
    const hyd = readFileSync(join(__dirname, "..", "src", "api", "cloudHydrate.ts"), "utf8");
    for (const p of ["__fichaRegistro", "__ordenarHallazgos", "__nombreDeUsuario", "__describirRevocadaPor", "__hayCambios", "__directorioUsuarios"]) {
      expect(wire, p).toContain(`window.${p} =`);
      expect(hyd, p).toContain(`${p}?:`);
    }
  });
});
```
<!-- prettier-ignore-end -->

- [ ] **Step 2: Correr y ver que fallan**

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npx vitest run tests/directorioUsuarios.test.ts | tail -20`
Expected: FAIL — el módulo no existe y los puentes no están.

- [ ] **Step 3: Implementar `src/api/directorioUsuarios.ts`**

<!-- prettier-ignore-start -->
```ts
/**
 * Directorio de usuarios para "Emitida por NOMBRE" (spec 2026-09-30 §4.7).
 *
 * Lee `UserProfile` del tenant UNA vez por sesión, con el selectionSet mínimo, paginando.
 * Cualquier miembro del tenant puede leerlo (`allow.groupDefinedIn("tenantId").to(["read"])`,
 * amplify/data/resource.ts:572): la misma regla que ya le deja ver el Taller. PASIVA: usa la
 * sesión que exista y NUNCA llama `ensureSession` (B-I5: el login encima del modal). Si falla,
 * se calla y la pantalla queda con el respaldo "un usuario de GPA".
 */
import { getCurrentUser } from "aws-amplify/auth";
import { getClient } from "./amplifyClient";
import type { Directorio, EntradaDirectorio, Yo } from "../taller/nombreUsuario";

let promesa: Promise<Directorio | null> | null = null;
let cache: Directorio | null = null;
let yo: Yo = { sub: null, email: null };

export function directorioEnCache(): Directorio | null {
  return cache;
}

export function yoEnCache(): Yo {
  return yo;
}

/** El sub sale de `getCurrentUser().userId` (como __crearPartidaManual, src/main.ts); el
 *  correo, de la sesión. Sin sesión ⇒ {null, null}. */
export async function yoActual(): Promise<Yo> {
  const s = window.__cloudSession;
  const email = s?.email || s?.username || null;
  let sub: string | null = null;
  try {
    sub = s ? (await getCurrentUser()).userId : null;
  } catch {
    sub = null;
  }
  yo = { sub, email };
  return yo;
}

export function cargarDirectorio(): Promise<Directorio | null> {
  if (promesa) return promesa;
  promesa = (async () => {
    const tenantId = window.__cloudSession?.tenantId;
    if (!tenantId) return null;
    try {
      const c = getClient();
      const mapa = new Map<string, EntradaDirectorio>();
      let token: string | null = null;
      let pages = 0;
      do {
        const r: {
          data?: Array<{ cognitoSub?: string | null; email?: string | null; nombre?: string | null }> | null;
          nextToken?: string | null;
          errors?: unknown[];
        } = await c.models.UserProfile.list({
          filter: { tenantId: { eq: tenantId } },
          limit: 1000,
          nextToken: token ?? undefined,
          selectionSet: ["cognitoSub", "email", "nombre"],
        });
        if (r.errors && r.errors.length) return null;
        for (const u of r.data ?? []) {
          if (!u.cognitoSub) continue;
          mapa.set(u.cognitoSub, { cognitoSub: u.cognitoSub, email: u.email ?? "", nombre: u.nombre ?? null });
        }
        token = r.nextToken ?? null;
        pages++;
      } while (token && pages < 100);
      cache = mapa;
      return mapa;
    } catch {
      return null;
    }
  })().then((d) => {
    // Si falló, la próxima apertura del registro puede volver a intentarlo.
    if (d === null) promesa = null;
    return d;
  });
  return promesa;
}
```
<!-- prettier-ignore-end -->

Si `typecheck` reclama el tipo de `c.models.UserProfile.list` (por el `selectionSet`), quita la anotación de `r` y deja que lo infiera; si reclama que `window.__cloudSession` no existe en `Window`, ya está declarado en `cloudHydrate.ts` (búscalo con Grep) — importa el tipo con `import type {} from "./cloudHydrate"` solo si hace falta.

- [ ] **Step 4: Publicar los puentes en `cloudWire.ts` y declararlos en `cloudHydrate.ts`**

En `src/api/cloudWire.ts`, junto a los imports de `../taller/*` (~`:34-46`), agrega:

<!-- prettier-ignore-start -->
```ts
import { fichaRegistro } from "../taller/ficha";
import { ordenarHallazgos } from "../taller/seguimiento";
import { describirRevocadaPor, nombreDeUsuario } from "../taller/nombreUsuario";
import { hayCambios } from "../taller/cambiosFormulario";
import { cargarDirectorio, directorioEnCache, yoActual, yoEnCache } from "./directorioUsuarios";
```
<!-- prettier-ignore-end -->

(Si `ordenarHallazgos` ya viene de un import existente de `../taller/seguimiento`, súmalo a ese import en vez de duplicar la línea.)

Justo DESPUÉS de este bloque (viejo, literal):

<!-- prettier-ignore-start -->
```ts
  window.__filasPendientes = (entries, porVisita) =>
    filasPendientes(entries, porVisita, new Date().toISOString());
```
<!-- prettier-ignore-end -->

agrega (nuevo):

<!-- prettier-ignore-start -->
```ts

  // ── Registro como ficha (spec 2026-09-30 §4.2, §4.3, §4.5, §4.7): el monolito pinta,
  //    src/ calcula. El "ahora" es el mismo instante que usan __estadoLiga/__promesaTaller.
  window.__fichaRegistro = (e, ps, opts) =>
    fichaRegistro(e, ps, {
      ahora: new Date().toISOString(),
      hibrido: opts.hibrido,
      confiables: opts.confiables,
    });
  window.__ordenarHallazgos = ordenarHallazgos;
  window.__nombreDeUsuario = (crudo) => nombreDeUsuario(crudo, directorioEnCache(), yoEnCache());
  window.__describirRevocadaPor = (crudo) =>
    describirRevocadaPor(crudo, directorioEnCache(), yoEnCache());
  window.__hayCambios = hayCambios;
  // Lectura pasiva y en caché del directorio (nunca ensureSession). Devuelve si hay
  // directorio; el monolito reescribe entonces SOLO los nodos de nombre (§4.7).
  window.__directorioUsuarios = {
    cargar: async () => {
      await yoActual();
      return (await cargarDirectorio()) !== null;
    },
  };
```
<!-- prettier-ignore-end -->

En `src/api/cloudHydrate.ts`, dentro de `interface Window`, después de la declaración de `__distintivoProveedor` (viejo, literal):

<!-- prettier-ignore-start -->
```ts
    __distintivoProveedor?: (e: Partial<TallerEntry>, ps: Partida[]) => Distintivo;
```
<!-- prettier-ignore-end -->

agrega (nuevo):

<!-- prettier-ignore-start -->
```ts
    /** Registro como ficha (spec 2026-09-30): cuentas puras de src/taller/ficha.ts. */
    __fichaRegistro?: (
      e: Partial<TallerEntry>,
      ps: readonly Partida[],
      opts: { hibrido: boolean | undefined; confiables: boolean },
    ) => import("../taller/ficha").FichaRegistro;
    __ordenarHallazgos?: (ps: readonly Partida[]) => import("../taller/seguimiento").GruposHallazgos;
    /** "Emitida por NOMBRE", nunca un id (§4.7). */
    __nombreDeUsuario?: (crudo: string | null | undefined) => string;
    __describirRevocadaPor?: (crudo: string | null | undefined) => { porCierre: boolean; nombre: string | null };
    /** Guardar solo con cambios (§4.5). */
    __hayCambios?: (
      foto: import("../taller/cambiosFormulario").FotoCampos,
      actual: import("../taller/cambiosFormulario").FotoCampos,
    ) => boolean;
    __directorioUsuarios?: { cargar: () => Promise<boolean> };
```
<!-- prettier-ignore-end -->

- [ ] **Step 5: Correr y ver que pasan**

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npx vitest run tests/directorioUsuarios.test.ts tests/tallerNombreUsuario.test.ts tests/tallerFicha.test.ts | tail -20`
Expected: PASS.
Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npm run typecheck | tail -10` y `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npm run lint | tail -10`
Expected: sin errores.

- [ ] **Step 6: Commit**

<!-- prettier-ignore-start -->
```bash
git -C "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" add src/api/directorioUsuarios.ts src/api/cloudWire.ts src/api/cloudHydrate.ts tests/directorioUsuarios.test.ts
git -C "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" commit -m "feat(taller): el directorio de usuarios se lee una vez por sesión y la ficha tiene sus puentes" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
<!-- prettier-ignore-end -->

---

### Task 4: Markup, CSS y ayudantes del registro (mismos ids, orden nuevo)

**Files:**

- Modify: `Control de flotilla.html` — el markup de `#taller-modal` (desde `<div id="taller-modal" onclick=` hasta el `</div>` que cierra antes del comentario `<!-- ═══ ACCESORIOS`), y un bloque NUEVO de script insertado justo antes del comentario `// Pinta el bloque Proveedor de una visita YA persistida.` (el que precede a `function _provPintar(e){`).
- Modify: `nginx.conf` (lo reescribe `csp:sync`).
- Modify: `src/styles/main.css` (al final del archivo).
- Modify: `tests/tallerBloqueProveedor.test.ts` (las dos primeras pruebas).
- Test: `tests/tallerRegistroFichaMonolito.test.ts` (nuevo; las tareas 5–8 le agregan casos).

**Interfaces:**

- Consumes: `closeTallerModal`, `_provPartidas`, `_provFiltro`, `_tallerEditId`, `tallerEntries` (globales del monolito); `window.__hayCambios`, `window.__nombreDeUsuario`, `window.__describirRevocadaPor` (Task 3, con guarda).
- Produces (bloque "Registro como ficha — estado y ayudantes"): `_tfNombres` (WeakMap), `_tfNodosNombre` (Set), `_tfNombreRespaldo(crudo)`, `_tfNombreDe(reg)`, `_tfRegistrarNombre(nodo, crudo, plantilla, cierre)`, `_tfFotoCampos`, `_tfTocado`, `_tfTomarFoto()`, `_tfRecalcularCambios()`, `_tfHayCambiosSinGuardar()`, `_tallerCerrarConAviso()`, `_tfAutofoco(id)`, `_tfAvisoFirmaIr()`, `_tfNombresRefrescar()`, `_tfCablear()`. Ids nuevos del markup (ver Global Constraints).

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `tests/tallerRegistroFichaMonolito.test.ts`:

<!-- prettier-ignore-start -->
```ts
// Registro como ficha (spec 2026-09-30): estructura del modal y ayudantes del monolito,
// ejecutando los literales REALES del HTML (patrón de tests/tallerAntesDespuesMonolito.test.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hayCambios } from "../src/taller/cambiosFormulario";

const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");
const INI = "// ── Registro como ficha — estado y ayudantes";
const FIN = "// ── fin registro como ficha";
const bloque = (): string => {
  const i = html.indexOf(INI);
  const j = html.indexOf(FIN, i);
  expect(i, "falta el bloque de ayudantes").toBeGreaterThan(-1);
  expect(j, "falta el cierre del bloque").toBeGreaterThan(i);
  return html.slice(i, j);
};

type Ayudantes = {
  _tfTomarFoto: () => Record<string, { valor: string; readOnly: boolean }>;
  _tfRecalcularCambios: () => void;
  _tallerCerrarConAviso: () => boolean;
  _tfAutofoco: (id: string) => void;
  _tfRegistrarNombre: (n: HTMLElement, crudo: string, p: (s: string | null) => string, cierre?: boolean) => HTMLElement;
  _tfNombresRefrescar: () => void;
  _tfCablear: () => void;
  setFoto: (f: unknown) => void;
  setTocado: (v: boolean) => void;
  getTocado: () => boolean;
};

/** Ejecuta el bloque real con dobles de los globales que usa. */
function ayudantes(win: Record<string, unknown>, extra: Record<string, unknown> = {}): Ayudantes {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- se ejecuta el literal real
  const fabrica = new Function(
    "window", "document", "tallerEntries", "closeTallerModal", "_provPartidas", "confirm", "_tallerEditId", "_provFiltro",
    `${bloque()}
    return { _tfTomarFoto, _tfRecalcularCambios, _tallerCerrarConAviso, _tfAutofoco, _tfRegistrarNombre, _tfNombresRefrescar, _tfCablear,
      setFoto: (f) => { _tfFotoCampos = f; }, setTocado: (v) => { _tfTocado = v; }, getTocado: () => _tfTocado };`,
  );
  return fabrica(
    win, document, extra.tallerEntries ?? [], extra.closeTallerModal ?? vi.fn(), extra._provPartidas ?? vi.fn(),
    extra.confirm ?? vi.fn(() => true), extra._tallerEditId ?? null, "todas",
  ) as Ayudantes;
}

const formulario = (): void => {
  // eslint-disable-next-line no-restricted-syntax -- armado de prueba, literal controlado
  document.body.innerHTML = `
    <div id="taller-modal"><div class="tl-mttl" id="tl-mttl" tabindex="-1">T</div>
      <details id="tf-datos"><fieldset id="tf-datos-campos">
        <input id="tf-km" value="85000"><input id="tf-gasto" value="3850" readonly><input id="tf-tecnico" value="Taller X">
      </fieldset></details>
      <button id="btn-liga-copiar">Copiar</button>
      <span id="tf-sin-cambios" hidden>Sin cambios</span><button id="btn-guardar-taller">Guardar</button>
      <div id="tf-prov-partidas"></div>
    </div>`;
};

beforeEach(formulario);

describe("markup del registro (§4.1)", () => {
  it("orden: ficha → hallazgos → Datos del registro (formulario intacto dentro del fieldset)", () => {
    const iFicha = html.indexOf('id="tf-ficha"');
    const iProv = html.indexOf('id="tf-proveedor"');
    const iDatos = html.indexOf('id="tf-datos"');
    const iCampos = html.indexOf('id="tf-datos-campos"');
    const iIdent = html.indexOf(">Identificación de la unidad<");
    const iMant = html.indexOf('<div class="tl-sec">Mantenimiento</div>');
    const iNotas = html.indexOf('<div class="tl-sec">Notas</div>');
    const iFieldsetFin = html.indexOf("</fieldset>", iCampos);
    expect(iFicha).toBeGreaterThan(-1);
    expect(iProv).toBeGreaterThan(iFicha);
    expect(iDatos).toBeGreaterThan(iProv);
    expect(iCampos).toBeGreaterThan(iDatos);
    expect(iIdent).toBeGreaterThan(iCampos);
    expect(iMant).toBeGreaterThan(iIdent);
    expect(iNotas).toBeGreaterThan(iMant);
    expect(iFieldsetFin).toBeGreaterThan(html.indexOf('id="tf-comentario"'));
    expect(html).not.toContain('<div class="tl-sec needs-hibrido">Proveedor</div>');
  });
  it("ids nuevos, título enfocable, Guardar con id, Reingresar/Finalizar con needs-write", () => {
    for (const id of ["tl-msub", "tf-aviso-firma", "tf-ficha-gpa", "tf-ficha-taller", "tf-ficha-dias", "tf-ficha-salida", "tf-ficha-costo", "tf-ficha-liga", "tf-datos-resumen", "tf-sin-cambios", "btn-guardar-taller"]) {
      expect(html, id).toContain(`id="${id}"`);
    }
    const ttl = html.slice(html.lastIndexOf("<div", html.indexOf('id="tl-mttl"')), html.indexOf(">", html.indexOf('id="tl-mttl"')));
    expect(ttl).toContain('tabindex="-1"');
    for (const id of ["btn-reingreso", "btn-finalizar"]) {
      const i = html.indexOf(`id="${id}"`);
      expect(html.slice(html.lastIndexOf("<button", i), html.indexOf(">", i)), id).toContain("needs-write");
    }
  });
  it("el fondo, el ✕ y Cerrar pasan por _tallerCerrarConAviso; el aviso de firma se oculta con hidden", () => {
    expect(html).toContain(`if(event.target.id==='taller-modal')_tallerCerrarConAviso()`);
    expect(html).toContain('aria-label="Cerrar modal de taller" style="position:static" onclick="_tallerCerrarConAviso()"');
    expect(html).toContain('<button class="tl-cancel" onclick="_tallerCerrarConAviso()">Cerrar</button>');
    const i = html.indexOf('id="tf-aviso-firma"');
    expect(html.slice(html.lastIndexOf("<button", i), html.indexOf(">", i))).toContain(" hidden");
  });
  it("el bloque de ayudantes vive fuera de openTallerModal…closeTallerModal", () => {
    const iOpen = html.indexOf("function openTallerModal(");
    const iClose = html.indexOf("\nfunction closeTallerModal", iOpen);
    const iBloque = html.indexOf(INI);
    expect(iBloque < iOpen || iBloque > iClose).toBe(true);
  });
});

describe("Guardar solo con cambios (§4.5)", () => {
  it("sin cambios ⇒ Guardar apagado y 'Sin cambios' visible; teclear en Km lo enciende", () => {
    const a = ayudantes({ __hayCambios: hayCambios });
    a.setFoto(a._tfTomarFoto());
    a._tfRecalcularCambios();
    const btn = document.getElementById("btn-guardar-taller") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect((document.getElementById("tf-sin-cambios") as HTMLElement).hidden).toBe(false);
    (document.getElementById("tf-km") as HTMLInputElement).value = "86000";
    a._tfRecalcularCambios();
    expect(btn.disabled).toBe(false);
    expect((document.getElementById("tf-sin-cambios") as HTMLElement).hidden).toBe(true);
  });
  it("#tf-gasto repintado (readOnly) no enciende Guardar", () => {
    const a = ayudantes({ __hayCambios: hayCambios });
    a.setFoto(a._tfTomarFoto());
    (document.getElementById("tf-gasto") as HTMLInputElement).value = "5200";
    a._tfRecalcularCambios();
    expect((document.getElementById("btn-guardar-taller") as HTMLButtonElement).disabled).toBe(true);
  });
  it("alta o reingreso (sin foto) ⇒ Guardar siempre encendido", () => {
    const a = ayudantes({ __hayCambios: hayCambios });
    a.setFoto(null);
    a._tfRecalcularCambios();
    expect((document.getElementById("btn-guardar-taller") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("_tallerCerrarConAviso (§2 #23)", () => {
  it("con cambios y confirm=false ⇒ no cierra; confirm=true ⇒ cierra", () => {
    const cerrar = vi.fn();
    const confirmar = vi.fn(() => false);
    const a = ayudantes({ __hayCambios: hayCambios }, { closeTallerModal: cerrar, confirm: confirmar });
    a.setFoto(a._tfTomarFoto());
    (document.getElementById("tf-km") as HTMLInputElement).value = "1";
    expect(a._tallerCerrarConAviso()).toBe(false);
    expect(confirmar).toHaveBeenCalledWith("¿Descartar los cambios?");
    expect(cerrar).not.toHaveBeenCalled();
    confirmar.mockReturnValue(true);
    expect(a._tallerCerrarConAviso()).toBe(true);
    expect(cerrar).toHaveBeenCalledTimes(1);
  });
  it("sin cambios ⇒ cierra sin preguntar; en el alta pregunta solo si se tecleó algo", () => {
    const cerrar = vi.fn();
    const confirmar = vi.fn(() => false);
    const a = ayudantes({ __hayCambios: hayCambios }, { closeTallerModal: cerrar, confirm: confirmar });
    a.setFoto(a._tfTomarFoto());
    expect(a._tallerCerrarConAviso()).toBe(true);
    expect(confirmar).not.toHaveBeenCalled();
    a.setFoto(null);
    a.setTocado(false);
    expect(a._tallerCerrarConAviso()).toBe(true);
    a.setTocado(true);
    expect(a._tallerCerrarConAviso()).toBe(false);
    expect(confirmar).toHaveBeenCalledTimes(1);
  });
  it("_tfCablear: teclear en Datos marca tocado y recalcula", () => {
    const a = ayudantes({ __hayCambios: hayCambios });
    a._tfCablear();
    a.setFoto(a._tfTomarFoto());
    const km = document.getElementById("tf-km") as HTMLInputElement;
    km.value = "2";
    km.dispatchEvent(new Event("input", { bubbles: true }));
    expect(a.getTocado()).toBe(true);
    expect((document.getElementById("btn-guardar-taller") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("autofoco y nombres", () => {
  it("_tfAutofoco mueve el atributo y nunca lo deja en un botón de liga", () => {
    const a = ayudantes({});
    a._tfAutofoco("btn-liga-copiar");
    a._tfAutofoco("tl-mttl");
    expect(document.getElementById("tl-mttl")?.hasAttribute("data-autofocus")).toBe(true);
    expect(document.getElementById("btn-liga-copiar")?.hasAttribute("data-autofocus")).toBe(false);
  });
  it("_tfRegistrarNombre pinta con el puente o con el respaldo, nunca el GUID; refrescar reescribe", () => {
    const GUID = "11111111-2222-4333-8444-555555555555";
    const win: Record<string, unknown> = {};
    const a = ayudantes(win);
    const nodo = document.createElement("span");
    document.body.appendChild(nodo);
    a._tfRegistrarNombre(nodo, GUID, (n) => `emitida por ${n}`);
    expect(nodo.textContent).toBe("emitida por un usuario de GPA");
    win.__nombreDeUsuario = () => "Ana López";
    a._tfNombresRefrescar();
    expect(nodo.textContent).toBe("emitida por Ana López");
    expect(document.body.innerHTML).not.toContain(GUID);
  });
  it("cierre: usa __describirRevocadaPor y sin nombre deja la frase sola", () => {
    const win: Record<string, unknown> = { __describirRevocadaPor: () => ({ porCierre: true, nombre: null }) };
    const a = ayudantes(win);
    const nodo = document.createElement("span");
    document.body.appendChild(nodo);
    a._tfRegistrarNombre(nodo, "cierre:desconocido", (n) => (n ? `Se cerró junto con la visita (${n})` : "Se cerró junto con la visita"), true);
    expect(nodo.textContent).toBe("Se cerró junto con la visita");
  });
});
```
<!-- prettier-ignore-end -->

Y en `tests/tallerBloqueProveedor.test.ts` reemplaza las DOS primeras pruebas (`"existe bajo el apagador y después de la identificación"` y `"los botones de liga viven en el bloque, ya no en el pie del modal"`) por:

<!-- prettier-ignore-start -->
```ts
  it("registro como ficha (spec 2026-09-30 §4.1): ficha → hallazgos (bajo el apagador) → datos", () => {
    const iFicha = html.indexOf('id="tf-ficha"');
    const iProv = html.indexOf('id="tf-proveedor"');
    const iDatos = html.indexOf('id="tf-datos"');
    const iIdent = html.indexOf(">Identificación de la unidad<");
    const iMant = html.indexOf('<div class="tl-sec">Mantenimiento</div>');
    expect(iFicha).toBeGreaterThan(-1);
    expect(iProv).toBeGreaterThan(iFicha);
    expect(iDatos).toBeGreaterThan(iProv);
    expect(iIdent).toBeGreaterThan(iDatos);
    expect(iMant).toBeGreaterThan(iIdent);
    const tag = html.slice(html.lastIndexOf("<div", iProv), iProv + 200);
    expect(tag).toContain("needs-hibrido");
    // #tf-ficha NO lleva needs-hibrido (días, salida y costo se ven con el apagador apagado);
    // las piezas del taller que viven dentro sí.
    const tagFicha = html.slice(html.lastIndexOf("<section", iFicha), html.indexOf(">", iFicha));
    expect(tagFicha).not.toContain("needs-hibrido");
    for (const id of ["tf-prov-liga", "tf-prov-taller", "tf-ficha-taller", "tf-ficha-liga"]) {
      const i = html.indexOf(`id="${id}"`);
      expect(html.slice(html.lastIndexOf("<div", i), html.indexOf(">", i)), id).toContain("needs-hibrido");
    }
    expect(html).not.toContain('<div class="tl-sec needs-hibrido">Proveedor</div>');
  });

  it("los botones de liga viven en la fila de la liga de la ficha, no en el pie del modal", () => {
    const iLiga = html.indexOf('id="tf-prov-liga"');
    const iFin = html.indexOf('id="tf-prov-liga-meta"', iLiga);
    const bloque = html.slice(iLiga, iFin);
    expect(bloque).toContain('id="btn-liga-copiar"');
    expect(bloque).toContain('id="btn-liga-revocar"');
    const pie = html.slice(html.indexOf('class="tl-mftr"', html.indexOf('id="tf-prov-partidas"')));
    expect(pie).not.toContain('id="btn-liga-copiar"');
  });
```
<!-- prettier-ignore-end -->

- [ ] **Step 2: Correr y ver que fallan**

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npx vitest run tests/tallerRegistroFichaMonolito.test.ts tests/tallerBloqueProveedor.test.ts | tail -30`
Expected: FAIL — no existe `id="tf-ficha"` ni el bloque de ayudantes.

- [ ] **Step 3: Reescribir el markup de `#taller-modal`**

Reemplaza TODO el bloque que empieza en `<div id="taller-modal" onclick="if(event.target.id==='taller-modal')closeTallerModal()">` y termina en el `</div>` de cierre justo antes de `<!-- ═══ ACCESORIOS: historial por unidad + captura` por el siguiente. Las secciones del formulario (Identificación → Mantenimiento → Fechas → Costos y responsable → Notas) se copian TAL CUAL del archivo actual, con sus comentarios, ids, `datalist`, `option`s y leyendas; solo cambian de sitio (dentro del `<fieldset>`), y se quita el `<div class="tl-sec needs-hibrido">Proveedor</div>` con su `#tf-proveedor` de hoy (sus piezas se reparten como se ve abajo).

<!-- prettier-ignore-start -->
```html
<div id="taller-modal" onclick="if(event.target.id==='taller-modal')_tallerCerrarConAviso()">
  <div class="tl-mcard">
    <div class="tl-mhdr">
      <div class="tl-ficha-cabecera">
        <div class="tl-mttl" id="tl-mttl" tabindex="-1">Agregar unidad al taller</div>
        <div id="tl-msub" class="tl-ficha-sub"></div>
      </div>
      <button class="dcls" aria-label="Cerrar modal de taller" style="position:static" onclick="_tallerCerrarConAviso()">✕</button>
    </div>
    <div class="tl-mbody">
      <!-- Registro como ficha (spec 2026-09-30 §4.1): ficha de solo lectura → hallazgos del
           taller → "Datos del registro" (el formulario de hoy, plegado). Los ids tf-* NO
           cambian, solo de lugar: saveTallerEntry, la liga, la firma y la anulación leen lo
           mismo. _fichaPintar pinta la ficha; _provPintar sigue escribiendo en #tf-prov-*. -->
      <button type="button" id="tf-aviso-firma" class="tl-ficha-aviso needs-write needs-hibrido" hidden onclick="_tfAvisoFirmaIr()"></button>
      <section id="tf-ficha" class="tl-ficha" aria-label="Cómo va">
        <div class="tl-ficha-titulo">Cómo va</div>
        <div class="tl-ficha-estados">
          <div id="tf-ficha-gpa" class="tl-ficha-caja tl-ficha-caja-gpa"></div>
          <div id="tf-ficha-taller" class="tl-ficha-caja tl-ficha-caja-taller needs-hibrido">
            <div class="tl-ficha-rotulo"><span class="tl-ficha-etq tl-ficha-etq-taller">TALLER</span><span class="tl-ficha-sub">Estado · desde su liga</span><span id="tf-ficha-taller-nombre" class="tl-ficha-sub"></span></div>
            <div id="tf-prov-taller" class="needs-hibrido" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"></div>
            <div id="tf-prov-taller-nota" class="needs-hibrido" style="font-size:10px;color:var(--s2)">Estado, km y fecha prometida los reporta el proveedor desde su liga.</div>
          </div>
        </div>
        <div class="tl-ficha-cifras">
          <div id="tf-ficha-dias" class="tl-ficha-cifra"></div>
          <div id="tf-ficha-salida" class="tl-ficha-cifra"></div>
          <div id="tf-ficha-costo" class="tl-ficha-cifra tl-ficha-costo"></div>
        </div>
        <div id="tf-ficha-liga" class="tl-ficha-liga needs-hibrido">
          <div id="tf-prov-liga" class="needs-hibrido" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <button class="tl-exp-btn needs-liga needs-hibrido" id="btn-liga-copiar" style="display:none;padding:8px 14px;font-size:12px" onclick="copiarLigaProveedor()">Copiar liga</button>
            <button class="tl-exp-btn needs-liga needs-hibrido" id="btn-liga-revocar" style="display:none;padding:8px 14px;font-size:12px;color:#b91c1c" onclick="revocarLigaProveedor()">Revocar liga</button>
          </div>
          <div id="tf-prov-liga-meta" style="font-size:10.5px;color:var(--s2)"></div>
        </div>
      </section>
      <div id="tf-proveedor" class="tl-ficha-hallazgos needs-hibrido" style="display:none;flex-direction:column;gap:8px;padding:12px 14px;background:var(--bg2);border:var(--card-bd);border-radius:8px">
        <div id="tf-prov-partidas"></div>
      </div>
      <details id="tf-datos" class="tl-datos">
        <summary class="tl-datos-summary">
          <span class="tl-datos-titulo">Datos del registro</span>
          <span id="tf-datos-resumen" class="tl-datos-resumen"></span>
          <span class="tl-datos-ver tl-exp-btn">Editar datos</span><span class="tl-datos-ocultar tl-exp-btn">Ocultar</span>
        </summary>
        <p class="tl-datos-nota">Guardar, abajo, se resalta en cuanto cambias algo de este bloque.</p>
        <fieldset id="tf-datos-campos" class="tl-datos-grid">
          <!-- ⬇ AQUÍ VAN, TAL CUAL, las secciones de hoy: desde
               <div class="tl-sec">Identificación de la unidad</div> (con #tf-identidad-hint,
               #tf-eco + #tl-ac-drop, #tf-plate, #tf-brand, #tf-branch + datalist, #tf-area)
               hasta el último campo de Notas (#tf-comentario). Sin el encabezado "Proveedor"
               ni el #tf-proveedor viejo, que ya viven arriba. ⬆ -->
        </fieldset>
      </details>
    </div>
    <div class="tl-mftr">
      <button class="tl-cancel" onclick="_tallerCerrarConAviso()">Cerrar</button>
      <button class="tl-reingreso needs-write" id="btn-reingreso" style="display:none" onclick="reingresoTaller()">+ Reingresar al Taller</button>
      <button class="tl-fin-btn needs-write" id="btn-finalizar" style="display:none;padding:8px 14px;font-size:12px" onclick="finalizarDesdeModal()">✓ Finalizar</button>
      <button class="tl-exp-btn"  id="btn-expediente" style="display:none;padding:8px 14px;font-size:12px" onclick="expedienteDesdeModal()">Expediente</button>
      <span id="tf-sin-cambios" class="tl-datos-sincambios" hidden>Sin cambios</span>
      <button class="tl-save needs-write" id="btn-guardar-taller" onclick="saveTallerEntry()">Guardar</button>
    </div>
  </div>
</div>
```
<!-- prettier-ignore-end -->

Nota: el texto inicial de `#btn-liga-copiar` pasa de "Copiar liga para el proveedor" a "Copiar liga"; `_provPintar` (Task 5) lo cambia a "Emitir liga y copiar" cuando no hay liga activa. Comprueba con Grep que ninguna prueba busque el texto viejo (`grep -rn "Copiar liga para el proveedor" tests/`); si alguna lo hace, actualízala a "Copiar liga".

- [ ] **Step 4: Insertar el bloque de ayudantes en el `<script>`**

Justo ANTES de este comentario (viejo, literal):

<!-- prettier-ignore-start -->
```js
// Pinta el bloque Proveedor de una visita YA persistida. Todo el cálculo vive
// en la capa pura (src/taller/seguimiento.ts): aquí solo se traduce a DOM.
// XSS: createElement + textContent, nunca innerHTML.
function _provPintar(e){
```
<!-- prettier-ignore-end -->

inserta (nuevo):

<!-- prettier-ignore-start -->
```js
// ── Registro como ficha — estado y ayudantes (spec 2026-09-30 §4.4, §4.5, §4.7, §2 #23) ──
// Bloque PROPIO (fuera de openTallerModal…closeTallerModal: las pruebas cortan esas
// funciones por su nombre). Todo aquí es DOM y estado de pantalla; las cuentas viven en
// src/taller/* y llegan por window.__* con guarda, para que la demo y las pruebas que
// ejecutan literales con `window = {}` no revienten.
const _tfNombres = new WeakMap();      // nodo → { crudo, plantilla, cierre }
const _tfNodosNombre = new Set();      // los mismos nodos, iterables para refrescar
let _tfFotoCampos = null;              // foto de #tf-datos-campos al abrir una visita GUARDADA; null en alta/reingreso
let _tfTocado = false;                 // la persona tecleó en "Datos del registro" desde que se abrió

// Respaldo sin directorio: correo sin dominio o "un usuario de GPA". Nunca un GUID.
function _tfNombreRespaldo(crudo){
  const c = String(crudo || "").trim();
  return /^[^\s@]+@[^\s@]+$/.test(c) ? c.split("@")[0] : "un usuario de GPA";
}
function _tfNombreDe(reg){
  if(reg.cierre){
    const d = typeof window.__describirRevocadaPor === "function" ? window.__describirRevocadaPor(reg.crudo) : { nombre: null };
    return d.nombre;
  }
  return typeof window.__nombreDeUsuario === "function" ? window.__nombreDeUsuario(reg.crudo) : _tfNombreRespaldo(reg.crudo);
}
// Un nodo que muestra un nombre se registra para reescribirlo cuando llegue el directorio
// (§4.7): el crudo vive en JS, jamás en el DOM.
function _tfRegistrarNombre(nodo, crudo, plantilla, cierre){
  const reg = { crudo, plantilla, cierre: !!cierre };
  _tfNombres.set(nodo, reg);
  _tfNodosNombre.add(nodo);
  nodo.textContent = plantilla(_tfNombreDe(reg));
  return nodo;
}
function _tfNombresRefrescar(){
  for(const nodo of Array.from(_tfNodosNombre)){
    if(!nodo.isConnected){ _tfNodosNombre.delete(nodo); continue; }
    const reg = _tfNombres.get(nodo);
    if(reg) nodo.textContent = reg.plantilla(_tfNombreDe(reg));
  }
}

function _tfTomarFoto(){
  const foto = {};
  const campos = document.getElementById("tf-datos-campos");
  if(!campos) return foto;
  for(const c of campos.querySelectorAll("input[id],select[id],textarea[id]")){
    foto[c.id] = { valor: String(c.value ?? ""), readOnly: !!c.readOnly };
  }
  return foto;
}
function _tfHayCambiosSinGuardar(){
  if(_tfFotoCampos){
    return typeof window.__hayCambios === "function" ? window.__hayCambios(_tfFotoCampos, _tfTomarFoto()) : false;
  }
  return _tfTocado;
}
// Guardar solo con cambios (§4.5). En el alta y los reingresos no hay foto: siempre encendido.
function _tfRecalcularCambios(){
  const btn = document.getElementById("btn-guardar-taller");
  if(!btn) return;
  const cambios = _tfFotoCampos
    ? (typeof window.__hayCambios === "function" ? window.__hayCambios(_tfFotoCampos, _tfTomarFoto()) : true)
    : true;
  btn.disabled = !cambios;
  btn.classList.toggle("tl-save-apagado", !cambios);
  const sin = document.getElementById("tf-sin-cambios");
  if(sin) sin.hidden = cambios;
}
// Cerrar con cambios pregunta (§2 #23). Lo llaman ✕, Cerrar, el fondo, Escape, Finalizar y
// Expediente. Los cierres del código (reingreso, tras guardar) siguen usando closeTallerModal.
function _tallerCerrarConAviso(){
  if(_tfHayCambiosSinGuardar() && !confirm("¿Descartar los cambios?")) return false;
  closeTallerModal();
  return true;
}
// El foco inicial nunca cae en un control que escribe (§2 #24): openModal respeta [data-autofocus].
function _tfAutofoco(id){
  const modal = document.getElementById("taller-modal");
  if(modal) for(const n of modal.querySelectorAll("[data-autofocus]")) n.removeAttribute("data-autofocus");
  const el = document.getElementById(id);
  if(el) el.setAttribute("data-autofocus", "");
}
// Aviso tocable del celular (§4.6): lleva a los hallazgos que esperan firma.
function _tfAvisoFirmaIr(){
  const e = tallerEntries.find(x => x.id === _tallerEditId);
  if(!e) return;
  _provFiltro = "pendientes";
  _provPartidas(e);
  const lista = document.getElementById("tf-prov-partidas");
  if(lista && typeof lista.scrollIntoView === "function") lista.scrollIntoView({ behavior: "smooth", block: "start" });
}
function _tfCablear(){
  const m = document.getElementById("taller-modal");
  if(!m || m.__fichaCableado) return;
  m.__fichaCableado = true;
  // Escape pasa por la pregunta y por closeTallerModal (limpia _tallerEditId). Se detiene aquí,
  // en captura, para que el _trapFocus de openModal no cierre por su cuenta.
  m.addEventListener("keydown", (ev) => {
    if(ev.key !== "Escape") return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    _tallerCerrarConAviso();
  }, true);
  const datos = document.getElementById("tf-datos");
  if(datos){
    const marcar = () => { _tfTocado = true; _tfRecalcularCambios(); };
    datos.addEventListener("input", marcar);
    datos.addEventListener("change", marcar);
  }
}
document.addEventListener("DOMContentLoaded", _tfCablear);
// ── fin registro como ficha ──────────────────────────────────────────────────

```
<!-- prettier-ignore-end -->

- [ ] **Step 5: CSS**

Al FINAL de `src/styles/main.css` agrega:

<!-- prettier-ignore-start -->
```css
/* ── Registro de Taller como ficha (spec 2026-09-30) ─────────────────────────────
   Acotado a #taller-modal: .tl-mcard/.tl-mbody/.tl-mftr los comparten otros modales. */
:root {
  --tl-ficha-gpa-bg: rgba(30, 79, 163, 0.06);
  --tl-ficha-gpa-fg: #1e4fa3;
  --tl-ficha-taller-bg: rgba(8, 145, 178, 0.06);
  --tl-ficha-taller-fg: #0e7490;
  --tl-ficha-taller-bd: #67e8f9;
}
:root[data-theme="dark"] {
  --tl-ficha-gpa-bg: rgba(96, 165, 250, 0.1);
  --tl-ficha-gpa-fg: #93c5fd;
  --tl-ficha-taller-bg: rgba(34, 211, 238, 0.08);
  --tl-ficha-taller-fg: #67e8f9;
  --tl-ficha-taller-bd: #155e75;
}
#taller-modal .tl-mcard { max-width: 760px; }
#taller-modal .tl-ficha-cabecera { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
#taller-modal .tl-ficha-sub { font-size: 10.5px; color: var(--s2); }
#tf-ficha, #tf-proveedor, #tf-datos, #tf-aviso-firma { grid-column: 1 / -1; }
#tf-ficha { display: flex; flex-direction: column; gap: 10px; }
.tl-ficha-titulo, .tl-ficha-etiqueta { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: var(--s1); }
.tl-ficha-estados { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.tl-ficha-caja { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 8px; min-width: 0; }
.tl-ficha-caja-gpa { background: var(--tl-ficha-gpa-bg); border: 1px solid transparent; }
.tl-ficha-caja-taller { background: var(--tl-ficha-taller-bg); border: 1px dashed var(--tl-ficha-taller-bd); }
.tl-ficha-rotulo, .tl-ficha-fila { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; color: var(--w1); }
.tl-ficha-etq { font-size: 9px; font-weight: 800; letter-spacing: 0.5px; padding: 1px 6px; border-radius: 4px; }
.tl-ficha-etq-gpa { background: var(--tl-ficha-gpa-fg); color: #fff; }
.tl-ficha-etq-taller { background: var(--tl-ficha-taller-fg); color: #fff; }
.tl-ficha-nota { font-size: 10.5px; color: var(--s2); }
.tl-ficha-cifras { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
.tl-ficha-cifra { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1px solid var(--ln); border-radius: 8px; background: var(--bg); min-width: 0; }
.tl-ficha-num { font-size: 20px; font-weight: 800; color: var(--w1); }
.tl-ficha-num span { font-size: 12px; font-weight: 500; color: var(--s1); }
.tl-ficha-tono-ambar { color: var(--A); }
.tl-ficha-tono-rojo { color: var(--R); }
.tl-ficha-verde { color: #047857; }
.tl-ficha-ambar { color: var(--A); }
.tl-ficha-liga { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--ln); border-radius: 8px; background: var(--bg2); }
.tl-ficha-grupo { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: var(--s1); padding: 8px 12px 2px; }
.tl-ficha-grupo-nota { padding: 0 12px 6px; }
.tl-ficha-aviso { display: none; align-items: center; justify-content: space-between; gap: 8px; width: 100%; min-height: 44px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--A); border-left-width: 4px; background: var(--Ad); color: var(--tl-warn-fg); font: 700 12px inherit; font-family: inherit; cursor: pointer; text-align: left; }
#tf-aviso-firma[hidden] { display: none !important; }
#tf-datos { border: 1px solid var(--ln); border-radius: 8px; background: var(--bg); }
#tf-datos > summary { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 12px; cursor: pointer; list-style: none; }
#tf-datos > summary::-webkit-details-marker { display: none; }
.tl-datos-titulo { font-size: 12px; font-weight: 700; color: var(--w1); }
.tl-datos-resumen { flex: 1 1 200px; font-size: 10.5px; color: var(--s2); min-width: 0; }
.tl-datos-ver, .tl-datos-ocultar { padding: 6px 12px; font-size: 11.5px; }
#tf-datos[open] .tl-datos-ver { display: none; }
#tf-datos:not([open]) .tl-datos-ocultar { display: none; }
.tl-datos-nota { margin: 0; padding: 0 12px 6px; font-size: 10.5px; color: var(--s2); }
#tf-datos-campos { border: 0; padding: 0 12px 12px; margin: 0; min-width: 0; min-inline-size: 0; }
.tl-datos-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
#tf-datos-campos:disabled { opacity: 0.85; }
.tl-datos-sincambios { align-self: center; font-size: 11px; color: var(--s2); }
#taller-modal .tl-save.tl-save-apagado { background: var(--bg3); color: var(--s2); cursor: default; }
@media (max-width: 768px) {
  .tl-ficha-estados { grid-template-columns: 1fr; }
  .tl-ficha-cifras { grid-template-columns: 1fr 1fr; }
  .tl-ficha-costo { grid-column: 1 / -1; }
  .tl-datos-grid { grid-template-columns: 1fr; }
  #tf-aviso-firma { display: flex; }
  /* Pie en dos renglones (§4.6): arriba Guardar (con "Sin cambios") y ✓ Finalizar; abajo el resto. */
  #taller-modal .tl-mftr { flex-wrap: wrap; gap: 8px; }
  #taller-modal .tl-mftr > * { order: 2; flex: 1 1 30%; min-height: 44px; }
  #taller-modal .tl-mftr #btn-guardar-taller, #taller-modal .tl-mftr #tf-sin-cambios, #taller-modal .tl-mftr #btn-finalizar { order: 1; }
  #taller-modal .tl-mftr #btn-guardar-taller { flex: 2 1 45%; }
  #taller-modal .tl-mftr #tf-sin-cambios { flex: 0 0 auto; min-height: 0; }
  #tf-datos > summary, .tl-datos-ver, .tl-datos-ocultar { min-height: 44px; }
}
@media (min-width: 769px) {
  #tf-aviso-firma { display: none !important; }
}
```
<!-- prettier-ignore-end -->

- [ ] **Step 6: Sincronizar la CSP y correr**

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npm run csp:sync | tail -5`
Expected: `[csp] Updated Control de flotilla.html` y `[csp] Updated nginx.conf`.
Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npx vitest run tests/tallerRegistroFichaMonolito.test.ts tests/tallerBloqueProveedor.test.ts tests/tallerOlaHonestidadUi.test.ts tests/tallerLigaCierreUi.test.ts tests/tallerSaveEntryGastoCandado.test.ts tests/tallerPartidasEnRegistro.test.ts tests/tallerAntesDespuesMonolito.test.ts | tail -30`
Expected: PASS. Si `tallerPartidasEnRegistro` falla por el texto "Autorizado … · Esperando …", es la Task 6 quien lo mueve: déjalo en rojo SOLO si el fallo es ese y anótalo en el reporte.
Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npm run audit:xss | tail -8`
Expected: solo el sospechoso preexistente de llantas.

- [ ] **Step 7: Commit y volver a revisar la CSP**

<!-- prettier-ignore-start -->
```bash
git -C "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" add "Control de flotilla.html" nginx.conf src/styles/main.css tests/tallerRegistroFichaMonolito.test.ts tests/tallerBloqueProveedor.test.ts
git -C "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" commit -m "feat(taller): el registro se reordena como ficha (mismos ids) y gana sus ayudantes de pantalla" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
<!-- prettier-ignore-end -->

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npm run audit:csp | tail -3`
Expected: `✓ CSP sync con inline scripts actuales`. Si sale rojo (el hook reformateó): `npm run csp:sync`, re-stagea los dos archivos y haz un commit `fix(csp): huellas tras el reformateo`.

---

### Task 5: `_fichaPintar` y la fila de la liga con nombre

**Files:**

- Modify: `Control de flotilla.html` — nueva `function _fichaPintar(e)` en su propio bloque justo DESPUÉS de `// ── fin registro como ficha ──…` (Task 4) y ANTES del comentario `// Pinta el bloque Proveedor…`; ediciones dentro de `function _provPintar(e){`.
- Modify: `nginx.conf` (`csp:sync`).
- Test: `tests/tallerRegistroFichaMonolito.test.ts` (agregar un `describe`).

**Interfaces:**

- Consumes: `window.__fichaRegistro`, `window.__nombreDeUsuario`, `window.__describirRevocadaPor`, `window.__pendientesDeFirma`, `window.__montoPendienteDeFirma`, `window.__tallerHibrido` (con guarda); `_partidasDeVisita`, `_partidasConfiables`, `fmtDate`, `_fmtMon2`, `_tfRegistrarNombre`, `_tfNodosNombre`, `_tfRecalcularCambios` (Task 4).
- Produces: `_fichaPintar(e)`; `_provPintar` llama `_fichaPintar(e)` en su primera línea y pinta la liga con nombre.

- [ ] **Step 1: Escribir las pruebas que fallan**

Agrega al final de `tests/tallerRegistroFichaMonolito.test.ts`:

<!-- prettier-ignore-start -->
```ts
describe("_fichaPintar y la liga con nombre (§4.2, §4.7)", () => {
  const GUID = "11111111-2222-4333-8444-555555555555";
  const cuerpo = (nombre: string): string => {
    const i = html.indexOf(`function ${nombre}(`);
    expect(i, `no existe ${nombre}`).toBeGreaterThan(-1);
    return html.slice(i, html.indexOf("\nfunction ", i + 10));
  };
  const dom = (): void => {
    // eslint-disable-next-line no-restricted-syntax -- armado de prueba, literal controlado
    document.body.innerHTML = `
      <div id="tl-mttl"></div><div id="tl-msub"></div><button id="tf-aviso-firma" hidden></button>
      <section id="tf-ficha"><div id="tf-ficha-gpa"></div><div id="tf-ficha-taller"><span id="tf-ficha-taller-nombre"></span>
      <div id="tf-prov-taller"></div><div id="tf-prov-taller-nota"></div></div>
      <div id="tf-ficha-dias"></div><div id="tf-ficha-salida"></div><div id="tf-ficha-costo"></div>
      <div id="tf-ficha-liga"><div id="tf-prov-liga"><button id="btn-liga-copiar">Copiar liga</button><button id="btn-liga-revocar">Revocar</button></div>
      <div id="tf-prov-liga-meta"></div></div></section>
      <div id="tf-proveedor"><div id="tf-prov-partidas"></div></div><span id="tf-datos-resumen"></span>`;
  };
  const FICHA = {
    estadoGpa: "En Reparación", tipo: "Correctivo", esperandoFirma: true,
    dias: { n: 5, cerrada: false, inicio: "2026-09-25", fin: null, tono: "ambar" },
    salida: { estimadaGpa: "2026-09-30", prometida: "2026-10-01", compromisoOriginal: null, senal: { kind: "despues-de-estimada", dias: 1 } },
    costo: { kind: "partidas", autorizado: 3850, pendiente: 2400 },
    tallerNombre: "Taller Frenos del Bajío",
  };
  /** Ejecuta _fichaPintar + _provPintar reales con dobles. */
  function pintar(e: Record<string, unknown>, win: Record<string, unknown>, ficha: unknown = FICHA): void {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- se ejecutan los literales reales
    const fabrica = new Function(
      "window", "document", "_partidasDeVisita", "_partidasConfiables", "fmtDate", "_fmtMon2",
      "_tfRegistrarNombre", "_tfNodosNombre", "_tfRecalcularCambios", "_tfNombreRespaldo", "_provPartidas",
      `${cuerpo("_fichaPintar")}\n${cuerpo("_provPintar")}\nreturn { _fichaPintar, _provPintar };`,
    );
    const registrar = (nodo: HTMLElement, crudo: string, plantilla: (n: string | null) => string, cierre?: boolean) => {
      const n = cierre
        ? (win.__describirRevocadaPor as ((c: string) => { nombre: string | null }) | undefined)?.(crudo).nombre ?? null
        : typeof win.__nombreDeUsuario === "function" ? (win.__nombreDeUsuario as (c: string) => string)(crudo) : "un usuario de GPA";
      nodo.textContent = plantilla(n);
      return nodo;
    };
    const fns = fabrica(
      { ...win, __fichaRegistro: () => ficha }, document, () => (e.__ps as unknown[]) ?? [], () => true,
      (d: unknown) => String(d ?? "").slice(0, 10).split("-").reverse().join("/"), (n: number) => `$${n.toFixed(2)}`,
      registrar, new Set(), vi.fn(), (c: string) => (/@/.test(String(c)) ? String(c).split("@")[0] : "un usuario de GPA"), vi.fn(),
    ) as { _provPintar: (e: unknown) => void };
    fns._provPintar(e);
  }
  const E = (s: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: "e1", eco: "06", plate: "PRB0006", brand: "Nissan NP300", sucursal: "GDL", area: "Mantenimiento",
    estado: "En Reparación", tipo: "Correctivo", km: 85000, tecnico: "Taller Frenos del Bajío", ...s,
  });

  beforeEach(dom);

  it("pinta subtítulo, GPA/TALLER, días, salida y costo con los textos exactos", () => {
    const liga = { kind: "activa", diasRestantes: 88, emitidaPor: GUID, emitidaEn: "2026-09-24", venceEn: "2026-12-23" };
    pintar(E(), { __estadoLiga: () => liga, __promesaTaller: () => ({ kind: "sin-promesa" }), __tallerHibrido: true, __nombreDeUsuario: () => "Ana López" });
    const t = document.body.textContent ?? "";
    expect(document.getElementById("tl-msub")?.textContent).toBe("Nissan NP300 · GDL · Mantenimiento");
    for (const s of ["Cómo va", "GPA", "lo decides tú", "En Reparación", "Se cambia en Datos del registro",
      "marca esta unidad «Esperando firma»", "TALLER", "desde su liga", "Taller Frenos del Bajío", "nombre según GPA",
      "5", "Ingresó el 25/09/2026", "Estimada por GPA", "30/09/2026", "El taller promete", "01/10/2026", "1 día después de lo estimado",
      "Autorizado", "$3850.00", "Esperando tu firma", "$2400.00", "El subtotal es la suma de los hallazgos autorizados",
      "Liga del proveedor activa · vence en 88 días · emitida por Ana López el 24/09/2026",
      "Copiar vuelve a emitir: la liga queda a tu nombre y vence en 90 días", "Guardado: Km al ingreso 85,000"]) {
      expect(t, s).toContain(s);
    }
    expect(t).not.toContain(GUID);
    expect(document.getElementById("btn-liga-copiar")?.textContent).toBe("Copiar liga");
  });
  it("sin directorio: revocada por un GUID ⇒ 'un usuario de GPA'; texto libre igual; sin 'Revocar'", () => {
    const liga = { kind: "revocada", revocadaPor: "revocacion manual (CLI admin) por incidente", revocadaEn: "2026-09-22", emitidaPor: GUID };
    pintar(E(), { __estadoLiga: () => liga, __promesaTaller: () => ({ kind: "sin-promesa" }), __tallerHibrido: true });
    expect(document.getElementById("tf-prov-liga-meta")?.textContent).toContain("Liga revocada por un usuario de GPA el 22/09/2026");
    expect(document.body.textContent).not.toContain("CLI admin");
    expect(document.getElementById("btn-liga-copiar")?.textContent).toBe("Emitir liga y copiar");
    expect((document.getElementById("btn-liga-revocar") as HTMLElement).style.display).toBe("none");
  });
  it("cierre: ⇒ 'Se cerró junto con la visita (Ana López) el …'", () => {
    const liga = { kind: "revocada", revocadaPor: "cierre:ana@ejemplo.test", revocadaEn: "2026-09-29" };
    pintar(E({ estado: "Finalizado", fsalidaReal: "2026-09-29" }), {
      __estadoLiga: () => liga, __promesaTaller: () => ({ kind: "sin-promesa" }), __tallerHibrido: true,
      __describirRevocadaPor: () => ({ porCierre: true, nombre: "Ana López" }),
    }, { ...FICHA, dias: { n: 4, cerrada: true, inicio: "2026-09-25", fin: "2026-09-29", tono: "normal" } });
    expect(document.getElementById("tf-prov-liga-meta")?.textContent).toContain("Se cerró junto con la visita (Ana López) el 29/09/2026");
    expect(document.getElementById("tf-ficha-dias")?.textContent).toContain("Salió el 29/09/2026 · estuvo 4 días");
  });
  it("costo sin datos no pinta $0; capturado con 'verificando…' cuando el apagador no se sabe", () => {
    const liga = { kind: "sin-liga" };
    pintar(E(), { __estadoLiga: () => liga, __promesaTaller: () => ({ kind: "sin-promesa" }) }, { ...FICHA, costo: { kind: "sin-datos" } });
    expect(document.getElementById("tf-ficha-costo")?.textContent).toContain("No se pudieron cargar los hallazgos");
    expect(document.getElementById("tf-ficha-costo")?.textContent).not.toContain("$0");
    pintar(E(), { __estadoLiga: () => liga, __promesaTaller: () => ({ kind: "sin-promesa" }) }, { ...FICHA, costo: { kind: "capturado", monto: 999, verificando: true } });
    expect(document.getElementById("tf-ficha-costo")?.textContent).toContain("Capturado por GPA");
    expect(document.getElementById("tf-ficha-costo")?.textContent).toContain("verificando…");
  });
  it("aviso de firma: texto exacto y solo con pendientes, confiables y apagador encendido", () => {
    const liga = { kind: "activa", diasRestantes: 88, emitidaPor: "x@ejemplo.test", emitidaEn: "2026-09-24" };
    const ps = [{ estado: "propuesta", precio: 2400 }];
    pintar(E({ __ps: ps }), { __estadoLiga: () => liga, __promesaTaller: () => ({ kind: "sin-promesa" }), __tallerHibrido: true, __pendientesDeFirma: () => 1, __montoPendienteDeFirma: () => 2400 });
    const aviso = document.getElementById("tf-aviso-firma") as HTMLElement;
    expect(aviso.hidden).toBe(false);
    expect(aviso.textContent).toBe("1 hallazgo espera tu firma · $2400.00 · Ver →");
    pintar(E({ __ps: ps }), { __estadoLiga: () => liga, __promesaTaller: () => ({ kind: "sin-promesa" }), __tallerHibrido: false, __pendientesDeFirma: () => 1 });
    expect(aviso.hidden).toBe(true);
  });
  it("estructura: _provPintar empieza con _fichaPintar(e) y conserva sus obligaciones", () => {
    const c = cuerpo("_provPintar");
    expect(c.indexOf("_fichaPintar(e)")).toBeLessThan(c.indexOf("getElementById"));
    for (const s of ["window.__estadoLiga(", "window.__promesaTaller(", "km del taller", "km ingreso", "El taller aún no ha reportado estado."]) expect(c).toContain(s);
    expect(c).not.toContain(".innerHTML");
    expect(c).not.toContain("promete salida");
    expect(cuerpo("_fichaPintar")).not.toContain(".innerHTML");
  });
});
```
<!-- prettier-ignore-end -->

- [ ] **Step 2: Correr y ver que fallan**

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npx vitest run tests/tallerRegistroFichaMonolito.test.ts | tail -30`
Expected: FAIL — `no existe _fichaPintar`.

- [ ] **Step 3: Implementar `_fichaPintar`**

Justo DESPUÉS de la línea `// ── fin registro como ficha ──…` (Task 4) y ANTES del comentario `// Pinta el bloque Proveedor de una visita YA persistida.`, inserta:

<!-- prettier-ignore-start -->
```js
// ── Registro como ficha — el pintado (spec 2026-09-30 §4.2) ─────────────────
// _provPintar la llama en su PRIMERA línea, así los cuatro lugares que ya repintan
// (_bnRepintar, abrir, emitir, revocar) refrescan la ficha sin tocarlos. Todo sale de
// window.__fichaRegistro (src/taller/ficha.ts); aquí solo hay nodos. XSS: textContent.
function _fichaPintar(e){
  const ficha = document.getElementById("tf-ficha");
  if(!ficha) return;
  const sub = document.getElementById("tl-msub");
  const aviso = document.getElementById("tf-aviso-firma");
  if(!e){
    ficha.style.display = "none";
    if(sub) sub.textContent = "";
    if(aviso) aviso.hidden = true;
    return;
  }
  ficha.style.display = "";
  if(sub) sub.textContent = [e.brand, e.sucursal, e.area].filter(Boolean).join(" · ");
  const ps = _partidasDeVisita(e) || [];
  const confiables = _partidasConfiables();
  const f = typeof window.__fichaRegistro === "function"
    ? window.__fichaRegistro(e, ps, { hibrido: window.__tallerHibrido, confiables })
    : null;
  if(!f) return;
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if(cls) n.className = cls; if(txt != null) n.textContent = txt; return n; };
  const dias = (n) => `${n} ${n === 1 ? "día" : "días"}`;
  _tfNodosNombre.clear();

  // Estado · GPA (lo decides tú)
  const gpa = document.getElementById("tf-ficha-gpa");
  gpa.textContent = "";
  const rot = el("div", "tl-ficha-rotulo");
  rot.append(el("span", "tl-ficha-etq tl-ficha-etq-gpa", "GPA"), el("span", "tl-ficha-sub", "Estado · lo decides tú"));
  gpa.appendChild(rot);
  const CLS = { "En Diagnóstico": "diag", "En Reparación": "repar", "Cotización": "cotiz", "Por recuperar": "porrec", "Finalizado": "listo", "Listo": "listo" };
  const filaG = el("div", "tl-ficha-fila");
  filaG.appendChild(el("span", "tl-pill " + (CLS[f.estadoGpa] || ""), f.estadoGpa || "—"));
  if(f.tipo) filaG.appendChild(el("span", "tl-tipo " + (f.tipo === "Correctivo" ? "correctivo" : f.tipo === "Preventivo" ? "preventivo" : ""), `Mtto ${f.tipo}`));
  gpa.appendChild(filaG);
  gpa.appendChild(el("div", "tl-ficha-nota", "Se cambia en Datos del registro"));
  if(f.esperandoFirma) gpa.appendChild(el("div", "tl-ficha-nota", "Mientras haya hallazgos sin firmar, la lista del Taller marca esta unidad «Esperando firma»"));

  // Estado · TALLER: el nombre según GPA (§2 #16); el reporte lo pinta _provPintar en #tf-prov-taller
  const tn = document.getElementById("tf-ficha-taller-nombre");
  if(tn) tn.textContent = f.tallerNombre ? `· ${f.tallerNombre} · nombre según GPA` : "";

  // En taller
  const cd = document.getElementById("tf-ficha-dias");
  cd.textContent = "";
  cd.appendChild(el("div", "tl-ficha-etiqueta", "En taller"));
  const num = el("div", "tl-ficha-num tl-ficha-tono-" + f.dias.tono);
  num.append(el("b", null, String(f.dias.n)), el("span", null, ` ${f.dias.n === 1 ? "día" : "días"}`));
  cd.appendChild(num);
  cd.appendChild(el("div", "tl-ficha-nota", f.dias.cerrada
    ? `Salió el ${fmtDate(f.dias.fin)} · estuvo ${dias(f.dias.n)}`
    : `Ingresó el ${fmtDate(f.dias.inicio)}`));

  // Salida: fila GPA, fila TALLER y UNA señal
  const cs = document.getElementById("tf-ficha-salida");
  cs.textContent = "";
  cs.appendChild(el("div", "tl-ficha-etiqueta", "Salida"));
  const fg = el("div", "tl-ficha-fila");
  fg.append(el("span", "tl-ficha-etq tl-ficha-etq-gpa", "GPA"), el("span", null, "Estimada por GPA"), el("b", null, f.salida.estimadaGpa ? fmtDate(f.salida.estimadaGpa) : "—"));
  cs.appendChild(fg);
  const ft = el("div", "tl-ficha-fila needs-hibrido");
  ft.appendChild(el("span", "tl-ficha-etq tl-ficha-etq-taller", "TALLER"));
  if(f.salida.prometida){
    ft.append(el("span", null, "El taller promete"), el("b", null, fmtDate(f.salida.prometida)));
    if(f.salida.compromisoOriginal) ft.appendChild(el("span", "tl-ficha-nota", `(había prometido ${fmtDate(f.salida.compromisoOriginal)})`));
  } else {
    ft.appendChild(el("span", "tl-ficha-nota", "sin fecha prometida"));
  }
  cs.appendChild(ft);
  const s = f.salida.senal;
  if(s.kind === "promesa-vencida") cs.appendChild(el("span", "tl-pill pendiente", `PROMESA VENCIDA · ${dias(s.dias)}`));
  else if(s.kind === "estimada-vencida") cs.appendChild(el("span", "tl-pill pendiente", `Salida estimada vencida hace ${dias(s.dias)}`));
  else if(s.kind === "despues-de-estimada") cs.appendChild(el("span", "tl-pill diag", `${dias(s.dias)} después de lo estimado`));

  // Costo (§2 #19): la misma fuente que #tf-gasto
  const cc = document.getElementById("tf-ficha-costo");
  cc.textContent = "";
  cc.appendChild(el("div", "tl-ficha-etiqueta", "Costo"));
  if(f.costo.kind === "partidas"){
    const a = el("div", "tl-ficha-fila");
    a.append(el("span", null, "Autorizado"), el("b", "tl-ficha-verde", _fmtMon2(f.costo.autorizado)));
    cc.appendChild(a);
    if(f.costo.pendiente > 0){
      const p = el("div", "tl-ficha-fila");
      p.append(el("span", null, "Esperando tu firma"), el("b", "tl-ficha-ambar", _fmtMon2(f.costo.pendiente)));
      cc.appendChild(p);
    }
    cc.appendChild(el("div", "tl-ficha-nota", "El subtotal es la suma de los hallazgos autorizados"));
  } else if(f.costo.kind === "sin-datos"){
    cc.appendChild(el("div", "tl-ficha-nota", "No se pudieron cargar los hallazgos"));
  } else {
    const a = el("div", "tl-ficha-fila");
    a.append(el("span", null, "Capturado por GPA"), el("b", null, _fmtMon2(f.costo.monto)));
    if(f.costo.verificando) a.appendChild(el("span", "tl-ficha-nota", "· verificando…"));
    cc.appendChild(a);
  }

  // Aviso tocable del celular (§4.6): solo con pendientes, partidas confiables y apagador ON.
  if(aviso){
    const n = typeof window.__pendientesDeFirma === "function" ? window.__pendientesDeFirma(ps) : ps.filter(p => p.estado === "propuesta").length;
    const mostrar = n > 0 && confiables && window.__tallerHibrido === true;
    aviso.hidden = !mostrar;
    if(mostrar){
      const y = typeof window.__montoPendienteDeFirma === "function" ? window.__montoPendienteDeFirma(ps) : 0;
      aviso.textContent = `${n} ${n === 1 ? "hallazgo espera" : "hallazgos esperan"} tu firma · ${_fmtMon2(y)} · Ver →`;
    }
  }

  // Resumen "Guardado:" del pliegue (§4.4) — lo guardado, no lo que se está tecleando.
  const res = document.getElementById("tf-datos-resumen");
  if(res){
    const km = Number(e.km);
    res.textContent = "Guardado: " + [
      `Km al ingreso ${Number.isFinite(km) && km > 0 ? km.toLocaleString("es-MX") : "sin capturar"}`,
      `Técnico: ${String(e.tecnico || "").trim() || "sin capturar"}`,
      `Pedido ERP: ${String(e.pedidoErp || "").trim() || "sin capturar"}`,
    ].join(" · ");
  }
  if(typeof _tfRecalcularCambios === "function") _tfRecalcularCambios();
}

```
<!-- prettier-ignore-end -->

- [ ] **Step 4: Editar `_provPintar`**

(a) Viejo:

<!-- prettier-ignore-start -->
```js
function _provPintar(e){
  const cont = document.getElementById("tf-proveedor");
  if(!cont) return;
  if(!e || typeof window.__estadoLiga !== "function"){ cont.style.display = "none"; return; }
  cont.style.display = "flex";
```
<!-- prettier-ignore-end -->

Nuevo:

<!-- prettier-ignore-start -->
```js
function _provPintar(e){
  // Registro como ficha (spec 2026-09-30 §4.1): una sola ruta de repintado.
  _fichaPintar(e);
  const cont = document.getElementById("tf-proveedor");
  if(!cont) return;
  if(!e || typeof window.__estadoLiga !== "function"){
    cont.style.display = "none";
    // Sin la capa pura tampoco hay nada del taller que mostrar en la ficha.
    for(const id of ["tf-ficha-taller","tf-ficha-liga"]){ const n = document.getElementById(id); if(n) n.style.display = "none"; }
    return;
  }
  cont.style.display = "flex";
```
<!-- prettier-ignore-end -->

(b) Viejo (la pastilla y el detalle de la liga):

<!-- prettier-ignore-start -->
```js
  const detalle = document.createElement("span");
  detalle.style.cssText = "font-size:12px;color:var(--w1);font-weight:600";
  detalle.textContent = liga.kind === "activa" ? `Vence en ${liga.diasRestantes} días` : "";
  filaLiga.prepend(detalle);
  filaLiga.prepend(pill);

  meta.textContent = liga.kind === "activa"
    ? `Emitida por ${liga.emitidaPor || "desconocido"} · ${fmtDate(liga.emitidaEn)} · vence el ${fmtDate(liga.venceEn)}`
    : liga.kind === "revocada"
      ? `Revocada por ${liga.revocadaPor || "desconocido"} · ${fmtDate(liga.revocadaEn)}`
      : liga.kind === "cerrada"
        ? `Liga cerrada con la visita · emitida por ${liga.emitidaPor || "desconocido"} · ${fmtDate(liga.emitidaEn)}`
      : liga.kind === "vencida"
        ? `Emitida por ${liga.emitidaPor || "desconocido"} · venció el ${fmtDate(liga.vencioEn)}`
        : "Sin liga emitida para esta visita.";
```
<!-- prettier-ignore-end -->

Nuevo:

<!-- prettier-ignore-start -->
```js
  filaLiga.prepend(pill);

  // La liga dice el NOMBRE de quien la emitió o revocó (§4.7), nunca el id. El texto nuevo
  // va en #tf-prov-liga-meta (dentro de #tf-prov-liga solo sobreviven los dos botones).
  meta.textContent = "";
  const linea = document.createElement("span");
  const fe = fmtDate(liga.emitidaEn);
  if(liga.kind === "activa"){
    _tfRegistrarNombre(linea, liga.emitidaPor, (n) => `Liga del proveedor activa · vence en ${liga.diasRestantes} días · emitida por ${n} el ${fe}`);
  } else if(liga.kind === "revocada"){
    const fr = fmtDate(liga.revocadaEn);
    const esCierre = String(liga.revocadaPor || "").indexOf("cierre:") === 0;
    _tfRegistrarNombre(linea, liga.revocadaPor, esCierre
      ? (n) => (n ? `Se cerró junto con la visita (${n}) el ${fr}` : `Se cerró junto con la visita el ${fr}`)
      : (n) => `Liga revocada por ${n} el ${fr}`, esCierre);
  } else if(liga.kind === "cerrada"){
    _tfRegistrarNombre(linea, liga.emitidaPor, (n) => `Liga cerrada con la visita · emitida por ${n} el ${fe}`);
  } else if(liga.kind === "vencida"){
    linea.textContent = `Liga vencida el ${fmtDate(liga.vencioEn)}`;
  } else {
    linea.textContent = "Sin liga";
  }
  meta.appendChild(linea);
  if(liga.kind === "activa"){
    const nota = document.createElement("div");
    nota.className = "tl-ficha-nota";
    nota.textContent = "Copiar vuelve a emitir: la liga queda a tu nombre y vence en 90 días";
    meta.appendChild(nota);
  }
  // §2 #20: los botones dicen la verdad. copiarLigaProveedor SIEMPRE emite.
  const btnCopiar = document.getElementById("btn-liga-copiar");
  if(btnCopiar) btnCopiar.textContent = liga.kind === "activa" ? "Copiar liga" : "Emitir liga y copiar";
  const btnRevocar = document.getElementById("btn-liga-revocar");
  if(btnRevocar && liga.kind !== "activa") btnRevocar.style.display = "none";
```
<!-- prettier-ignore-end -->

(c) Viejo (la promesa dentro de la fila del taller — ahora vive en la ficha, fila "Salida"):

<!-- prettier-ignore-start -->
```js
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
```
<!-- prettier-ignore-end -->

Nuevo:

<!-- prettier-ignore-start -->
```js
  // La promesa de salida y "PROMESA VENCIDA" viven en la fila "Salida" de la ficha (§4.2);
  // aquí solo queda su huella para quien inspeccione el nodo.
  filaT.dataset.promesa = prom.kind;
```
<!-- prettier-ignore-end -->

- [ ] **Step 5: Correr y ver que pasan**

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npm run csp:sync | tail -3`
Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npx vitest run tests/tallerRegistroFichaMonolito.test.ts tests/tallerBloqueProveedor.test.ts tests/tallerLigaCierreUi.test.ts tests/tallerPartidasEnRegistro.test.ts | tail -30`
Expected: PASS (salvo el texto de totales de `tallerPartidasEnRegistro`, que mueve la Task 6). Si `tallerLigaCierreUi` busca "Liga cerrada con la visita" en `_provPintar`, sigue estando.
Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npm run audit:xss | tail -6`

- [ ] **Step 6: Commit**

<!-- prettier-ignore-start -->
```bash
git -C "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" add "Control de flotilla.html" nginx.conf tests/tallerRegistroFichaMonolito.test.ts
git -C "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" commit -m "feat(taller): la ficha del registro se pinta desde la capa pura y la liga dice quién la emitió" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
<!-- prettier-ignore-end -->

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npm run audit:csp | tail -3` ⇒ verde (si no: `csp:sync` + commit `fix(csp): …`).

---

### Task 6: Hallazgos agrupados, título nuevo, nombres en las firmas y miniaturas

**Files:**

- Modify: `Control de flotilla.html` — `let _provFiltro = "pendientes";`, `function _provPartidas(e){`, `function _provFilaHistorial(p){`.
- Modify: `nginx.conf` (`csp:sync`).
- Modify: `tests/e2e/antes-despues.spec.ts` (solo el comentario de la línea 18).
- Test: `tests/tallerRegistroFichaMonolito.test.ts` (agregar un `describe`). `tests/tallerPartidasEnRegistro.test.ts` NO cambia (verificado: no afirma el texto de los totales).

**Interfaces:**

- Consumes: `window.__ordenarHallazgos`, `window.__gastoDerivado`, `window.__nombreDeUsuario` (con guarda), `_tfRegistrarNombre` (Task 4, con `typeof`), `_bnPartida`, `_bnThumb`, `window.__abrirVisorAntesDespues`.
- Produces: el registro abre en "Todas" agrupado; firmas con nombre; miniaturas de una terminada abren el A+.

- [ ] **Step 1: Escribir las pruebas que fallan**

Agrega al final de `tests/tallerRegistroFichaMonolito.test.ts`:

<!-- prettier-ignore-start -->
```ts
describe("hallazgos del taller agrupados y firmas con nombre (§4.3)", () => {
  const cuerpo = (nombre: string): string => {
    const i = html.indexOf(`function ${nombre}(`);
    expect(i, `no existe ${nombre}`).toBeGreaterThan(-1);
    return html.slice(i, html.indexOf("\nfunction ", i + 10));
  };
  const P = (s: Record<string, unknown> = {}): Record<string, unknown> => ({
    partidaId: "p", visitaKey: "vk", descripcion: "Balatas", estado: "autorizada", tipo: "refaccion", fotos: ["a.jpg"],
    precio: 1850, precioAutorizado: 1850, creadoEn: "2026-09-14T16:00:00.000Z",
    decididoPor: "11111111-2222-4333-8444-555555555555", decididoEn: "2026-09-15T10:00:00.000Z", ...s,
  });
  function filaDe(p: Record<string, unknown>, win: Record<string, unknown> = {}): HTMLElement {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- se ejecuta el literal real
    const fabrica = new Function("window", "_bnThumb", "_fmtMon2", "fmtDate", `${cuerpo("_provFilaHistorial")}\nreturn _provFilaHistorial;`);
    const fn = fabrica(win, () => document.createElement("button"), (n: number) => `$${n.toFixed(2)}`, (d: unknown) => String(d ?? "").slice(0, 10)) as (p: unknown) => HTMLElement;
    return fn(p);
  }
  it("estructura: abre en 'Todas', tres subtítulos, título nuevo, sin la línea de totales", () => {
    expect(html).toContain('let _provFiltro = "todas";');
    const c = cuerpo("_provPartidas");
    for (const s of ["Hallazgos del taller (", "espera", "tu firma", "Esperan tu firma", "Autorizados · suman ", "No autorizados",
      "Autorizar y No autorizar se guardan solos; no necesitas Guardar.", "window.__ordenarHallazgos", "_bnPartida(", "window.__resumenPartidas(",
      "_partidasConfiables()", "No se pudieron cargar las partidas", "Esta visita no tiene partidas del proveedor.", "terminada", "e.tecnico"]) {
      expect(c, s).toContain(s);
    }
    expect(c).not.toContain("Autorizado ${");
    expect(c).not.toContain('_provFiltro = "pendientes"; }');
    expect(c).not.toContain(".innerHTML");
  });
  it("_provFilaHistorial con window = {} ⇒ 'Autorizada por un usuario de GPA', sin GUID ni excepción", () => {
    const t = filaDe(P()).textContent ?? "";
    expect(t).toContain("Autorizada por un usuario de GPA");
    expect(t).not.toContain("11111111-2222");
  });
  it("con el puente ⇒ 'Autorizada por Ana López'; rechazada y terminada igual", () => {
    const win = { __nombreDeUsuario: () => "Ana López" };
    expect(filaDe(P(), win).textContent).toContain("Autorizada por Ana López");
    expect(filaDe(P({ estado: "rechazada", motivoRechazo: "Precio alto" }), win).textContent).toContain("Rechazada por Ana López");
    expect(filaDe(P({ estado: "terminada", terminadoEn: "2026-09-16" }), win).textContent).toContain("Autorizada por Ana López");
  });
  it("una terminada con fotos: tocar la miniatura abre el A+ (misma llamada que el botón)", () => {
    const abrir = vi.fn();
    const fila = filaDe(P({ estado: "terminada", evidenciaFinal: ["b.jpg"], terminadoEn: "2026-09-16" }), { __abrirVisorAntesDespues: abrir });
    (fila.querySelector("button") as HTMLButtonElement).click();
    expect(abrir).toHaveBeenCalledTimes(1);
    expect(abrir.mock.calls[0]![0]).toMatchObject({ antes: { llaves: ["a.jpg"] }, despues: { llaves: ["b.jpg"] } });
  });
});
```
<!-- prettier-ignore-end -->

- [ ] **Step 2: Correr y ver que fallan**

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npx vitest run tests/tallerRegistroFichaMonolito.test.ts | tail -30`
Expected: FAIL en el `describe` nuevo.

- [ ] **Step 3: Filtro inicial "todas" (§2 #18)**

Viejo:

<!-- prettier-ignore-start -->
```js
let _provFiltro = "pendientes";
let _provFiltroId = null;
```
<!-- prettier-ignore-end -->

Nuevo:

<!-- prettier-ignore-start -->
```js
// Registro como ficha (spec 2026-09-30 §2 #18): abre en "todas", agrupado. "pendientes" queda
// para el salto desde la bandeja, que fija _provFiltro y _provFiltroId juntos.
let _provFiltro = "todas";
let _provFiltroId = null;
```
<!-- prettier-ignore-end -->

Y dentro de `_provPartidas`, viejo: `  if(_provFiltroId !== e.id){ _provFiltroId = e.id; _provFiltro = "pendientes"; }` → nuevo: `  if(_provFiltroId !== e.id){ _provFiltroId = e.id; _provFiltro = "todas"; }`.

- [ ] **Step 4: Título, sin totales y lista agrupada en `_provPartidas`**

(a) Viejo:

<!-- prettier-ignore-start -->
```js
  titulo.textContent = "Partidas";
  barra.appendChild(titulo);
```
<!-- prettier-ignore-end -->

Nuevo:

<!-- prettier-ignore-start -->
```js
  titulo.textContent = `Hallazgos del taller (${ps.length})`;
  barra.appendChild(titulo);
  if(r.pendientes.n > 0){
    const pend = document.createElement("span");
    pend.className = "tl-ficha-ambar";
    pend.style.cssText = "font-size:10.5px;font-weight:700;margin-right:6px";
    pend.textContent = `${r.pendientes.n} ${r.pendientes.n === 1 ? "espera" : "esperan"} tu firma`;
    barra.appendChild(pend);
  }
```
<!-- prettier-ignore-end -->

(b) Viejo (la línea de totales; la ficha ya lo dice con la misma fuente, §2 #19):

<!-- prettier-ignore-start -->
```js
  const totales = document.createElement("span");
  totales.style.cssText = "margin-left:auto;font-size:10.5px;color:var(--s2)";
  totales.textContent = `Autorizado ${_fmtMon2(r.autorizadas.monto)} · Esperando ${_fmtMon2(r.pendientes.monto)}`;
  barra.appendChild(totales);
  cont.appendChild(barra);
```
<!-- prettier-ignore-end -->

Nuevo:

<!-- prettier-ignore-start -->
```js
  cont.appendChild(barra);
```
<!-- prettier-ignore-end -->

(c) Viejo (toda la sección de la lista):

<!-- prettier-ignore-start -->
```js
  const visibles = ps.filter((p) =>
    _provFiltro === "todas" ? true
    : _provFiltro === "pendientes" ? p.estado === "propuesta"
    : _provFiltro === "autorizadas" ? (p.estado === "autorizada" || p.estado === "terminada")
    : p.estado === "rechazada");

  if(!visibles.length){
    const vacio = document.createElement("div");
    vacio.style.cssText = "padding:16px;color:var(--s2);font-size:12px;text-align:center";
    vacio.textContent = "No hay partidas en este filtro.";
    lista.appendChild(vacio);
  }
  const fila = { visitaKey: window.__visitaKeyDe(e), proveedor: String(e.tecnico ?? "") };
  for(const p of visibles){
    if(p.estado === "propuesta"){
      // La MISMA fila de la bandeja: botones, motivos y repintado incluidos.
      const filaPend = _bnPartida(fila, p, window.__MOTIVOS_RECHAZO);
      filaPend.style.background = "var(--Al)";
      lista.appendChild(filaPend);
      continue;
    }
    lista.appendChild(_provFilaHistorial(p));
  }
  if(visibles.length > 6){ lista.style.maxHeight = "360px"; lista.style.overflowY = "auto"; }
```
<!-- prettier-ignore-end -->

Nuevo:

<!-- prettier-ignore-start -->
```js
  const fila = { visitaKey: window.__visitaKeyDe(e), proveedor: String(e.tecnico ?? "") };
  const pintarFila = (p) => {
    if(p.estado === "propuesta"){
      // La MISMA fila de la bandeja: botones, motivos y repintado incluidos.
      const filaPend = _bnPartida(fila, p, window.__MOTIVOS_RECHAZO);
      filaPend.style.background = "var(--Al)";
      lista.appendChild(filaPend);
      return;
    }
    lista.appendChild(_provFilaHistorial(p));
  };
  const subtitulo = (texto, nota) => {
    lista.appendChild(Object.assign(document.createElement("div"), { className: "tl-ficha-grupo", textContent: texto }));
    if(nota) lista.appendChild(Object.assign(document.createElement("div"), { className: "tl-ficha-nota tl-ficha-grupo-nota", textContent: nota }));
  };
  let visibles;
  if(_provFiltro === "todas"){
    // Registro como ficha (spec 2026-09-30 §2 #18): tres grupos, los que esperan firma primero.
    // El orden lo decide la capa pura; aquí solo se pintan los subtítulos.
    const g = typeof window.__ordenarHallazgos === "function"
      ? window.__ordenarHallazgos(ps)
      : { esperanFirma: ps.filter(p => p.estado === "propuesta"),
          autorizados: ps.filter(p => p.estado === "autorizada" || p.estado === "terminada"),
          noAutorizados: ps.filter(p => p.estado !== "propuesta" && p.estado !== "autorizada" && p.estado !== "terminada") };
    const sumaAutorizados = typeof window.__gastoDerivado === "function" ? window.__gastoDerivado(e, ps).gasto : r.autorizadas.monto;
    if(g.esperanFirma.length){ subtitulo("Esperan tu firma", "Autorizar y No autorizar se guardan solos; no necesitas Guardar."); g.esperanFirma.forEach(pintarFila); }
    if(g.autorizados.length){ subtitulo(`Autorizados · suman ${_fmtMon2(sumaAutorizados)}`); g.autorizados.forEach(pintarFila); }
    if(g.noAutorizados.length){ subtitulo("No autorizados"); g.noAutorizados.forEach(pintarFila); }
    visibles = ps;
  } else {
    visibles = ps.filter((p) =>
      _provFiltro === "pendientes" ? p.estado === "propuesta"
      : _provFiltro === "autorizadas" ? (p.estado === "autorizada" || p.estado === "terminada")
      : p.estado === "rechazada");
    if(!visibles.length){
      const vacio = document.createElement("div");
      vacio.style.cssText = "padding:16px;color:var(--s2);font-size:12px;text-align:center";
      vacio.textContent = "No hay partidas en este filtro.";
      lista.appendChild(vacio);
    }
    visibles.forEach(pintarFila);
  }
  if(visibles.length > 6){ lista.style.maxHeight = "360px"; lista.style.overflowY = "auto"; }
```
<!-- prettier-ignore-end -->

- [ ] **Step 5: Nombres y miniaturas en `_provFilaHistorial`**

(a) Viejo: `  row.appendChild(_bnThumb(p));` → nuevo:

<!-- prettier-ignore-start -->
```js
  const thumb = _bnThumb(p);
  row.appendChild(thumb);
```
<!-- prettier-ignore-end -->

(b) Viejo:

<!-- prettier-ignore-start -->
```js
  if(p.estado === "autorizada"){
    rastro.textContent = `Autorizada por ${p.decididoPor || "desconocido"} · ${fmtDate(p.decididoEn)}`;
  }else if(p.estado === "terminada"){
    let txt = `Autorizada por ${p.decididoPor || "desconocido"} · ${fmtDate(p.decididoEn)}`;
    if(p.terminadoEn) txt += ` · terminada el ${fmtDate(p.terminadoEn)}`;
    rastro.textContent = txt;
  }else if(p.estado === "rechazada"){
    const nota = p.motivoRechazoNota ? ` — ${p.motivoRechazoNota}` : "";
    rastro.textContent = `Rechazada por ${p.decididoPor || "desconocido"} · ${fmtDate(p.decididoEn)} · ${p.motivoRechazo || "sin motivo"}${nota}`;
  }else if(p.estado === "cancelada"){
```
<!-- prettier-ignore-end -->

Nuevo:

<!-- prettier-ignore-start -->
```js
  // Registro como ficha (spec 2026-09-30 §4.7 punto 4): quién firmó, por NOMBRE. Todo se lee
  // de window con guarda: esta función se ejecuta en pruebas con window = {} y en la demo.
  const quien = (crudo) => {
    if(typeof window.__nombreDeUsuario === "function") return window.__nombreDeUsuario(crudo);
    const c = String(crudo || "").trim();
    return /^[^\s@]+@[^\s@]+$/.test(c) ? c.split("@")[0] : "un usuario de GPA";
  };
  const registrar = (nodo, crudo, plantilla) => {
    if(typeof _tfRegistrarNombre === "function") return _tfRegistrarNombre(nodo, crudo, plantilla);
    nodo.textContent = plantilla(quien(crudo));
    return nodo;
  };
  if(p.estado === "autorizada"){
    registrar(rastro, p.decididoPor, (n) => `Autorizada por ${n} · ${fmtDate(p.decididoEn)}`);
  }else if(p.estado === "terminada"){
    registrar(rastro, p.decididoPor, (n) => `Autorizada por ${n} · ${fmtDate(p.decididoEn)}` + (p.terminadoEn ? ` · terminada el ${fmtDate(p.terminadoEn)}` : ""));
  }else if(p.estado === "rechazada"){
    const nota = p.motivoRechazoNota ? ` — ${p.motivoRechazoNota}` : "";
    registrar(rastro, p.decididoPor, (n) => `Rechazada por ${n} · ${fmtDate(p.decididoEn)} · ${p.motivoRechazo || "sin motivo"}${nota}`);
  }else if(p.estado === "cancelada"){
```
<!-- prettier-ignore-end -->

(c) Viejo (el botón del A+):

<!-- prettier-ignore-start -->
```js
  if(p.estado === "terminada" && (fotosAntes.length || fotosDespues.length)){
    const verAD = document.createElement("button");
    verAD.type = "button";
    verAD.textContent = "🖼 Antes y después";
    verAD.style.cssText = "align-self:flex-start;margin-top:4px;min-height:32px;padding:4px 10px;border-radius:6px;border:1px solid var(--ln);background:var(--bg2);color:var(--w1);font-size:11.5px;font-weight:600;cursor:pointer";
    verAD.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if(typeof window.__abrirVisorAntesDespues === "function"){
        const tipoTxtV = p.tipo === "manoObra" ? "Mano de obra" : "Refacción";
        let subtitulo = tipoTxtV;
        if(Number.isFinite(p.precioAutorizado)) subtitulo += ` · ${_fmtMon2(p.precioAutorizado)}`;
        if(p.terminadoEn) subtitulo += ` · terminada el ${fmtDate(p.terminadoEn)}`;
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
<!-- prettier-ignore-end -->

Nuevo:

<!-- prettier-ignore-start -->
```js
  if(p.estado === "terminada" && (fotosAntes.length || fotosDespues.length)){
    const abrirAD = () => {
      if(typeof window.__abrirVisorAntesDespues !== "function") return;
      const tipoTxtV = p.tipo === "manoObra" ? "Mano de obra" : "Refacción";
      let subtitulo = tipoTxtV;
      if(Number.isFinite(p.precioAutorizado)) subtitulo += ` · ${_fmtMon2(p.precioAutorizado)}`;
      if(p.terminadoEn) subtitulo += ` · terminada el ${fmtDate(p.terminadoEn)}`;
      window.__abrirVisorAntesDespues({
        antes: { llaves: fotosAntes, fecha: p.creadoEn },
        despues: { llaves: fotosDespues, fecha: p.terminadoEn },
        titulo: p.descripcion || "(sin descripción)",
        subtitulo,
      });
    };
    const verAD = document.createElement("button");
    verAD.type = "button";
    verAD.textContent = "🖼 Antes y después";
    verAD.style.cssText = "align-self:flex-start;margin-top:4px;min-height:32px;padding:4px 10px;border-radius:6px;border:1px solid var(--ln);background:var(--bg2);color:var(--w1);font-size:11.5px;font-weight:600;cursor:pointer";
    verAD.addEventListener("click", (ev) => { ev.stopPropagation(); abrirAD(); });
    info.appendChild(verAD);
    // §2 #17: en una terminada, la miniatura abre el MISMO visor A+ (en captura, antes del
    // visor simple que _bnThumb le cuelga a la miniatura).
    thumb.style.cursor = "pointer";
    thumb.addEventListener("click", (ev) => { ev.stopImmediatePropagation(); ev.preventDefault(); abrirAD(); }, true);
  }
```
<!-- prettier-ignore-end -->

- [ ] **Step 6: El comentario de la e2e**

En `tests/e2e/antes-despues.spec.ts` línea 18, viejo: `    // La lista de hallazgos abre en "Pendientes": las autorizadas y terminadas viven en "Autorizadas".` → nuevo: `    // El registro abre en "Todas" (agrupado); el filtro "Autorizadas" sigue existiendo y aísla ese grupo.`

- [ ] **Step 7: Correr y ver que pasan**

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npm run csp:sync | tail -3`
Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npx vitest run tests/tallerRegistroFichaMonolito.test.ts tests/tallerPartidasEnRegistro.test.ts tests/tallerAntesDespuesMonolito.test.ts tests/tallerBandejaEntrada.test.ts tests/tallerPanelRechazoVisibilidad.test.ts | tail -30`
Expected: PASS.

- [ ] **Step 8: Commit**

<!-- prettier-ignore-start -->
```bash
git -C "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" add "Control de flotilla.html" nginx.conf tests/tallerRegistroFichaMonolito.test.ts tests/e2e/antes-despues.spec.ts
git -C "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" commit -m "feat(taller): los hallazgos del registro abren agrupados, las firmas dicen el nombre y la miniatura abre el A+" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
<!-- prettier-ignore-end -->

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npm run audit:csp | tail -3` ⇒ verde.

---

### Task 7: Apertura del registro: título, pliegue, viewer, foco, alta, reingreso y cierres

**Files:**

- Modify: `Control de flotilla.html` — `function openModal(id){`, `function _markInvalid(id){`, `function clearTallerEntryFields(){`, `function reingresoTaller(){`, `function openTallerModal(id){`, `function finalizarDesdeModal(){`, `function expedienteDesdeModal(){`, `function tlAcSelect(idx){`, `function tlAcSelectNew(val){`.
- Modify: `nginx.conf` (`csp:sync`).
- Test: `tests/tallerRegistroFichaMonolito.test.ts` (agregar un `describe`).

**Interfaces:**

- Consumes: `_fichaPintar` (Task 5), `_tfAutofoco`, `_tfTomarFoto`, `_tfRecalcularCambios`, `_tfFotoCampos`, `_tfTocado`, `_tallerCerrarConAviso` (Task 4), `isViewer()` (`HTML:2715`).
- Produces: el registro abre plegado/desplegado según el caso, con el foco en el título; viewer con campos deshabilitados; Finalizar/Expediente/cierres pasan por la pregunta; el reingreso desde el registro conserva el historial (decisión 26).

- [ ] **Step 1: Escribir las pruebas que fallan**

Agrega al final de `tests/tallerRegistroFichaMonolito.test.ts`:

<!-- prettier-ignore-start -->
```ts
describe("apertura del registro (§4.4, §2 #9, #12, #21, #22, #24, #26)", () => {
  const cuerpo = (nombre: string, fin = "\nfunction "): string => {
    const i = html.indexOf(`function ${nombre}(`);
    expect(i, `no existe ${nombre}`).toBeGreaterThan(-1);
    return html.slice(i, html.indexOf(fin, i + 10));
  };
  it("openModal enfoca [data-autofocus] dentro del setTimeout; si no hay, el primer control", () => {
    const c = cuerpo("openModal");
    expect(c).toContain('querySelector("[data-autofocus]")');
    expect(c.indexOf("setTimeout")).toBeLessThan(c.indexOf('querySelector("[data-autofocus]")'));
  });
  it("openTallerModal: título con la unidad, pliegue según el caso, viewer deshabilita el fieldset, foco en el título", () => {
    const c = cuerpo("openTallerModal", "\nfunction closeTallerModal");
    expect(c).toContain('`Unidad ${e.eco||e.plate||"?"} · ${e.plate||"sin placas"}`');
    expect(c).toContain("datos.open = !e");
    expect(c).toContain("campos.disabled");
    expect(c).toContain('_tfAutofoco(e ? "tl-mttl" : "tf-eco")');
    expect(c).toContain("_tfFotoCampos = e ? _tfTomarFoto() : null");
    expect(c).toContain("_tfTocado = false");
    expect(c).toContain("_tfRecalcularCambios()");
    expect(c).toMatch(/if\s*\(\s*e\s*\)\s*_provPintar\(e\)/);
    expect(c).toContain("_fichaPintar(null)");
    // El bloque del candado B-C4 no gana getElementById nuevos (lo ejecuta una prueba con 4 ids).
    const candado = c.slice(c.indexOf("const idDudoso"), c.indexOf("idHint.style.display = idLock"));
    expect((candado.match(/getElementById/g) ?? []).length).toBe(2);
    // "Revocar" solo si la nube confirma Y la copia local dice activa (§2 #20).
    expect(c).toContain('window.__estadoLiga(e).kind === "activa"');
  });
  it("_markInvalid abre el pliegue antes de enfocar; clearTallerEntryFields limpia la ficha y despliega", () => {
    expect(cuerpo("_markInvalid")).toContain('el.closest("details")');
    const c = cuerpo("clearTallerEntryFields");
    for (const s of ["_fichaPintar(null)", "datos.open = true", "_tfFotoCampos = null", "_tfTocado = false", '_tfAutofoco("tf-freporte")', "_tfRecalcularCambios()"]) expect(c, s).toContain(s);
  });
  it("Finalizar, Expediente y los reingresos: los dos primeros preguntan; el reingreso no", () => {
    expect(cuerpo("finalizarDesdeModal")).toContain("if(!_tallerCerrarConAviso()) return;");
    expect(cuerpo("expedienteDesdeModal")).toContain("if(!_tallerCerrarConAviso()) return;");
    expect(cuerpo("reingresoTaller")).not.toContain("_tallerCerrarConAviso");
    expect(cuerpo("tlAcSelect")).toContain("_tfRecalcularCambios()");
    expect(cuerpo("tlAcSelectNew")).toContain("_tfRecalcularCambios()");
  });
  it("decisión 26: reingresar desde el registro conserva el unitKey de origen (RED antes del arreglo)", () => {
    // eslint-disable-next-line no-restricted-syntax -- armado de prueba, literal controlado
    document.body.innerHTML = `<div id="tl-mttl"></div>${["tf-eco", "tf-plate", "tf-brand", "tf-branch", "tf-area", "tf-estado", "tf-tipo", "tf-freporte"].map((id) => `<input id="${id}">`).join("")}<button id="btn-reingreso"></button>`;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- se ejecuta el literal real
    const fabrica = new Function(
      "document", "tallerEntries", "_tallerEditId", "_tallerReingresoKey", "closeTallerModal", "clearTallerEntryFields", "openModal",
      `${cuerpo("reingresoTaller")}\nreingresoTaller();\nreturn _tallerReingresoKey;`,
    );
    const src = { id: "v1", unitKey: "unidad-06", eco: "06", plate: "PRB0006" };
    let clave: string | null = null;
    const cerrar = () => { clave = null; }; // closeTallerModal pone _tallerReingresoKey en null
    const resultado = fabrica(document, [src], "v1", clave, () => { cerrar(); }, vi.fn(), vi.fn()) as string | null;
    // Con el orden viejo (fijar la llave ANTES de cerrar) el literal devolvería lo que dejó closeTallerModal.
    expect(resultado).toBe("unidad-06");
    const c = cuerpo("reingresoTaller");
    expect(c.indexOf("closeTallerModal();")).toBeLessThan(c.indexOf("_tallerReingresoKey = src.unitKey || src.id;"));
  });
});
```
<!-- prettier-ignore-end -->

Nota sobre la última prueba: como `closeTallerModal` es un parámetro que NO puede reasignar `_tallerReingresoKey` del literal, la afirmación de comportamiento se apoya en la de orden (`closeTallerModal();` antes de la asignación). Ambas deben pasar.

- [ ] **Step 2: Correr y ver que fallan**

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npx vitest run tests/tallerRegistroFichaMonolito.test.ts | tail -30`
Expected: FAIL en el `describe` nuevo.

- [ ] **Step 3: `openModal` y `_markInvalid`**

Viejo:

<!-- prettier-ignore-start -->
```js
  const f=el.querySelector('input,select,textarea,button:not([aria-label^="Cerrar"])');
  if(f)setTimeout(()=>f.focus(),30);
}
function closeModal(id){
```
<!-- prettier-ignore-end -->

Nuevo:

<!-- prettier-ignore-start -->
```js
  const f=el.querySelector('input,select,textarea,button:not([aria-label^="Cerrar"])');
  // Registro como ficha (spec 2026-09-30 §2 #24): si el modal marca un [data-autofocus], el foco
  // va ahí (el título, nunca un botón que emite o firma). Los demás modales no lo usan: igual que hoy.
  setTimeout(()=>{const af=el.querySelector("[data-autofocus]");if(af)af.focus();else if(f)f.focus();},30);
}
function closeModal(id){
```
<!-- prettier-ignore-end -->

Viejo (en `_markInvalid`): `  el.addEventListener("input",clear);el.addEventListener("change",clear);\n  el.focus();` → nuevo:

<!-- prettier-ignore-start -->
```js
  el.addEventListener("input",clear);el.addEventListener("change",clear);
  // Registro como ficha (§2 #22): con "Datos del registro" plegado, el aviso apuntaría a un campo oculto.
  const det=el.closest&&el.closest("details");if(det)det.open=true;
  el.focus();
```
<!-- prettier-ignore-end -->

- [ ] **Step 4: `clearTallerEntryFields` y `reingresoTaller`**

Viejo (final de `clearTallerEntryFields`):

<!-- prettier-ignore-start -->
```js
  const idHint = document.getElementById("tf-identidad-hint");
  if(idHint) idHint.style.display = "none";
}

function reingresoTaller(){
  const src = tallerEntries.find(x=>x.id===_tallerEditId);
  if(!src) return;
  _tallerReingresoKey = src.unitKey || src.id;
  closeTallerModal();
  _tallerEditId = null;
```
<!-- prettier-ignore-end -->

Nuevo:

<!-- prettier-ignore-start -->
```js
  const idHint = document.getElementById("tf-identidad-hint");
  if(idHint) idHint.style.display = "none";
  // Registro como ficha (spec 2026-09-30 §2 #21): un reingreso es una visita NUEVA — nada de la
  // anterior se queda pintado, "Datos del registro" abre desplegado y Guardar encendido.
  _fichaPintar(null);
  const prov = document.getElementById("tf-proveedor"); if(prov) prov.style.display = "none";
  const datos = document.getElementById("tf-datos"); if(datos) datos.open = true;
  const campos = document.getElementById("tf-datos-campos"); if(campos) campos.disabled = false;
  for(const id of ["btn-finalizar","btn-expediente"]){ const b = document.getElementById(id); if(b) b.style.display = "none"; }
  _tfFotoCampos = null;
  _tfTocado = false;
  _tfAutofoco("tf-freporte");
  _tfRecalcularCambios();
}

function reingresoTaller(){
  const src = tallerEntries.find(x=>x.id===_tallerEditId);
  if(!src) return;
  closeTallerModal();
  // Decisión 26 (spec 2026-09-30): closeTallerModal pone _tallerReingresoKey en null, así que la
  // llave de la unidad de origen se fija DESPUÉS de cerrar. Antes se perdía y la visita nueva
  // abría un historial aparte.
  _tallerReingresoKey = src.unitKey || src.id;
  _tallerEditId = null;
```
<!-- prettier-ignore-end -->

- [ ] **Step 5: `openTallerModal`**

(a) Viejo: `  document.getElementById("tl-mttl").textContent = e ? "Editar registro" : "Agregar unidad al taller";` → nuevo:

<!-- prettier-ignore-start -->
```js
  document.getElementById("tl-mttl").textContent = e ? `Unidad ${e.eco||e.plate||"?"} · ${e.plate||"sin placas"}` : "Agregar unidad al taller";
  // Registro como ficha (spec 2026-09-30 §4.4): visita guardada ⇒ "Datos del registro" plegado;
  // alta ⇒ desplegado. Viewer: campos deshabilitados (nunca readOnly: esa es la señal de #tf-gasto).
  {
    const esViewer = typeof isViewer === "function" && isViewer();
    const datos = document.getElementById("tf-datos"); if(datos) datos.open = !e;
    const campos = document.getElementById("tf-datos-campos"); if(campos) campos.disabled = esViewer;
    const ver = document.querySelector("#tf-datos .tl-datos-ver"); if(ver) ver.textContent = esViewer ? "Ver datos" : "Editar datos";
  }
```
<!-- prettier-ignore-end -->

(b) Viejo: `          if(_tallerEditId===id && st && st.generada) btnRevocarLiga.style.display = "";` → nuevo:

<!-- prettier-ignore-start -->
```js
          // §2 #20: la nube confirma Y la copia local dice activa; si no, "Revocar" no se ofrece.
          if(_tallerEditId===id && st && st.generada && typeof window.__estadoLiga === "function" && window.__estadoLiga(e).kind === "activa") btnRevocarLiga.style.display = "";
```
<!-- prettier-ignore-end -->

(c) Viejo:

<!-- prettier-ignore-start -->
```js
  if(e) _provPintar(e); else document.getElementById("tf-proveedor").style.display = "none";

  buildTallerSucOptions();
  openModal("taller-modal");
  document.getElementById("tf-eco").focus();
}
```
<!-- prettier-ignore-end -->

Nuevo:

<!-- prettier-ignore-start -->
```js
  if(e) _provPintar(e); else { document.getElementById("tf-proveedor").style.display = "none"; _fichaPintar(null); }

  buildTallerSucOptions();
  // §2 #24: en una visita guardada el foco va al título; en el alta, al campo de la unidad.
  _tfAutofoco(e ? "tl-mttl" : "tf-eco");
  openModal("taller-modal");
  if(!e) document.getElementById("tf-eco").focus();
  // §4.5: la foto de "Datos del registro" solo en una visita guardada; en el alta Guardar va encendido.
  _tfFotoCampos = e ? _tfTomarFoto() : null;
  _tfTocado = false;
  _tfRecalcularCambios();
}
```
<!-- prettier-ignore-end -->

- [ ] **Step 6: Pie y autocompletado**

Viejo:

<!-- prettier-ignore-start -->
```js
function finalizarDesdeModal(){
  const id = _tallerEditId;
  closeTallerModal();
  finalizarUnidad(id);
}
function expedienteDesdeModal(){
  const e = tallerEntries.find(x=>x.id===_tallerEditId);
  if(!e) return;
  const key = e.unitKey||e.id;
  closeTallerModal();
  openHistorialModal(key);
}
```
<!-- prettier-ignore-end -->

Nuevo:

<!-- prettier-ignore-start -->
```js
function finalizarDesdeModal(){
  const id = _tallerEditId;
  if(!_tallerCerrarConAviso()) return;
  finalizarUnidad(id);
}
function expedienteDesdeModal(){
  const e = tallerEntries.find(x=>x.id===_tallerEditId);
  if(!e) return;
  const key = e.unitKey||e.id;
  if(!_tallerCerrarConAviso()) return;
  openHistorialModal(key);
}
```
<!-- prettier-ignore-end -->

En `tlAcSelect`, viejo: `  document.getElementById("tl-ac-drop").style.display="none";\n  document.getElementById("tf-tipo").focus();\n}` → nuevo (misma cola con la llamada antes de cerrar la función):

<!-- prettier-ignore-start -->
```js
  document.getElementById("tl-ac-drop").style.display="none";
  document.getElementById("tf-tipo").focus();
  _tfRecalcularCambios();
}
```
<!-- prettier-ignore-end -->

En `tlAcSelectNew`, viejo: `  document.getElementById("tl-ac-drop").style.display="none";\n  document.getElementById("tf-plate").focus();\n}` → nuevo:

<!-- prettier-ignore-start -->
```js
  document.getElementById("tl-ac-drop").style.display="none";
  document.getElementById("tf-plate").focus();
  _tfRecalcularCambios();
}
```
<!-- prettier-ignore-end -->

- [ ] **Step 7: Correr y ver que pasan**

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npm run csp:sync | tail -3`
Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npx vitest run tests/tallerRegistroFichaMonolito.test.ts tests/tallerBloqueProveedor.test.ts tests/tallerOlaHonestidadUi.test.ts tests/tallerLigaCierreUi.test.ts tests/tallerSaveEntryGastoCandado.test.ts tests/tallerPartidasEnRegistro.test.ts | tail -30`
Expected: PASS.

- [ ] **Step 8: Commit**

<!-- prettier-ignore-start -->
```bash
git -C "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" add "Control de flotilla.html" nginx.conf tests/tallerRegistroFichaMonolito.test.ts
git -C "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" commit -m "feat(taller): el registro abre en la ficha con el foco a salvo, pregunta antes de descartar cambios y el reingreso conserva el historial" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
<!-- prettier-ignore-end -->

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npm run audit:csp | tail -3` ⇒ verde.

---

### Task 8: Los nombres llegan cuando llega el directorio

**Files:**

- Modify: `Control de flotilla.html` — dentro de `function openTallerModal(id){`, justo después de `  if(e) _provPintar(e); else { … _fichaPintar(null); }`.
- Modify: `nginx.conf` (`csp:sync`).
- Test: `tests/tallerRegistroFichaMonolito.test.ts` (agregar un `describe`).

**Interfaces:**

- Consumes: `window.__directorioUsuarios.cargar()` (Task 3), `_tfNombresRefrescar` (Task 4).
- Produces: al abrir una visita guardada con liga o partidas se pide el directorio; cuando llega, solo se reescriben los nodos de nombre.

- [ ] **Step 1: Escribir la prueba que falla**

<!-- prettier-ignore-start -->
```ts
describe("el directorio llega después y solo reescribe nombres (§4.7)", () => {
  it("openTallerModal pide el directorio y, al llegar, refresca nombres sin repintar", () => {
    const i = html.indexOf("function openTallerModal(");
    const c = html.slice(i, html.indexOf("\nfunction closeTallerModal", i));
    expect(c).toContain("window.__directorioUsuarios.cargar()");
    const then = c.slice(c.indexOf("window.__directorioUsuarios.cargar()"), c.indexOf("_tfNombresRefrescar()") + 30);
    expect(then).toContain("_tallerEditId===idAbierto");
    expect(then).not.toContain("_provPintar(");
    expect(then).not.toContain("_provPartidas(");
  });
});
```
<!-- prettier-ignore-end -->

- [ ] **Step 2: Correr y ver que falla**

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npx vitest run tests/tallerRegistroFichaMonolito.test.ts | tail -20`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Viejo (de la Task 7): `  if(e) _provPintar(e); else { document.getElementById("tf-proveedor").style.display = "none"; _fichaPintar(null); }` → nuevo:

<!-- prettier-ignore-start -->
```js
  if(e) _provPintar(e); else { document.getElementById("tf-proveedor").style.display = "none"; _fichaPintar(null); }
  // §4.7: el directorio se pide la primera vez que se abre un registro con liga o partidas. Cuando
  // llega, se reescriben SOLO los nodos de nombre: nunca _provPintar/_provPartidas (borrarían un
  // "No autorizar" a medio escribir, el foco y las firmas de las miniaturas).
  if(e && (e.ligaCreadaEn || _partidasDeVisita(e).length) && window.__directorioUsuarios && typeof window.__directorioUsuarios.cargar === "function"){
    const idAbierto = id;
    window.__directorioUsuarios.cargar().then(ok => {
      if(ok && _tallerEditId===idAbierto && document.getElementById("taller-modal")?.classList.contains("open")) _tfNombresRefrescar();
    }).catch(()=>{});
  }
```
<!-- prettier-ignore-end -->

- [ ] **Step 4: Correr, sincronizar y commitear**

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npm run csp:sync | tail -3`
Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npx vitest run tests/tallerRegistroFichaMonolito.test.ts tests/tallerBloqueProveedor.test.ts tests/tallerOlaHonestidadUi.test.ts | tail -20`
Expected: PASS.

<!-- prettier-ignore-start -->
```bash
git -C "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" add "Control de flotilla.html" nginx.conf tests/tallerRegistroFichaMonolito.test.ts
git -C "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" commit -m "feat(taller): cuando llega el directorio, el registro pone los nombres sin repintar" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
<!-- prettier-ignore-end -->

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npm run audit:csp | tail -3` ⇒ verde.

---

### Task 9: Demo local `?e2e=1&demo=registro-ficha` (solo `npm run dev`)

**Files:**

- Create: `src/dev/demoRegistroFicha.ts`
- Modify: `src/main.ts` (junto a la rama de `demo=antes-despues`, `~:1100-1109`)
- Test: se prueba con la e2e de la Task 10 y con el Step 4 (la demo no viaja al build).

**Interfaces:**

- Consumes: el patrón de `src/dev/demoAntesDespues.ts` (`llamar`, `dibujo`, `esperar`, `cortarRedExterna`, `avisoDemo`, dobles de guardado); las funciones reales `visitaKeyDe`, `MOTIVOS_RECHAZO`, `gastoDerivado`, `montoPendienteDeFirma`, `pendientesDeFirma`, `autorizar`, `rechazar` (`src/taller/partidas.ts`), `nombreDeUsuario`, `describirRevocadaPor` (Task 2), `fichaRegistro` (Task 1), `ordenarHallazgos` (Task 1), `hayCambios` (Task 2).
- Produces: `montarDemo()`; el elemento `#demo-registro-ficha` (aviso) y `#demo-rol` (selector); `window.__directorioUsuarios.cargar` simulado que resuelve tras 2 s.

- [ ] **Step 1: Crear `src/dev/demoRegistroFicha.ts`**

Copia `src/dev/demoAntesDespues.ts` como base (mismo `llamar`, `dibujo`, `gastado`/`nuevo`, `esperar`, `cortarRedExterna` — cambia el texto del error a `[demo registro-ficha]`) y reemplaza desde `function avisoDemo()` hasta el final por:

<!-- prettier-ignore-start -->
```ts
import {
  MOTIVOS_RECHAZO,
  autorizar,
  gastoDerivado,
  montoPendienteDeFirma,
  pendientesDeFirma,
  rechazar,
  type Partida,
} from "../taller/partidas";
import { fichaRegistro } from "../taller/ficha";
import { ordenarHallazgos } from "../taller/seguimiento";
import { hayCambios } from "../taller/cambiosFormulario";
import { describirRevocadaPor, nombreDeUsuario, type Directorio } from "../taller/nombreUsuario";

// (los imports de arriba van con los de visitaKeyDe al inicio del archivo; sin duplicar)

const SUB_ANA = "11111111-2222-4333-8444-555555555555";
const SUB_LUIS = "22222222-2222-4333-8444-555555555555";
const SUB_YO = "44444444-2222-4333-8444-555555555555";
const SUB_NADIE = "33333333-2222-4333-8444-555555555555";
const DIRECTORIO: Directorio = new Map([
  [SUB_ANA, { cognitoSub: SUB_ANA, email: "ana@ejemplo.test", nombre: "Ana López" }],
  [SUB_LUIS, { cognitoSub: SUB_LUIS, email: "luis@ejemplo.test", nombre: "" }],
  [SUB_YO, { cognitoSub: SUB_YO, email: "demo@ejemplo.test", nombre: "Navares" }],
]);
const YO = { sub: SUB_YO, email: "demo@ejemplo.test" };
const hoy = new Date();
const dia = (d: number): string => new Date(hoy.getTime() + d * 86400000).toISOString().slice(0, 10);

function avisoDemo(): void {
  const b = document.createElement("div");
  b.id = "demo-registro-ficha";
  b.setAttribute("role", "status");
  b.style.cssText =
    "position:fixed;left:50%;top:0;transform:translateX(-50%);z-index:10000;max-width:calc(100vw - 24px);pointer-events:none;background:#b45309;color:#fff;font:600 11px system-ui;padding:3px 12px;border-radius:0 0 8px 8px;box-shadow:0 4px 12px rgba(0,0,0,.25)";
  b.textContent = "MODO DEMO · datos inventados · nada se guarda · registro como ficha";
  document.body.appendChild(b);
}

// Selector fijo: rol y apagador. Cambia la sesión de mentira y repinta el registro abierto.
function selectorDemo(): void {
  const box = document.createElement("div");
  box.id = "demo-rol";
  box.style.cssText =
    "position:fixed;right:12px;top:8px;z-index:10000;display:flex;gap:6px;align-items:center;background:#0f172a;color:#fff;font:600 11px system-ui;padding:4px 8px;border-radius:8px";
  const rol = document.createElement("select");
  rol.id = "demo-rol-sel";
  for (const [v, t] of [["admin", "Admin"], ["riesgos", "Riesgos"], ["viewer", "Viewer"]]) {
    const o = document.createElement("option");
    o.value = v!;
    o.textContent = t!;
    rol.appendChild(o);
  }
  const apag = document.createElement("label");
  const chk = document.createElement("input");
  chk.type = "checkbox";
  chk.id = "demo-apagador";
  chk.checked = true;
  apag.append(chk, document.createTextNode(" esquema híbrido"));
  const aplicar = (): void => {
    const grupos = rol.value === "admin" ? ["admin"] : rol.value === "riesgos" ? ["operativo", "riesgos"] : ["viewer"];
    (w.__cloudSession as Record<string, unknown>).groups = grupos;
    w.__tallerHibrido = chk.checked;
    llamar("applyRolePermissions");
    llamar("applyTallerHibridoGate");
    llamar("renderTaller");
    const abierto = w._tallerEditId;
    if (typeof abierto === "string") llamar("openTallerModal", abierto);
  };
  rol.addEventListener("change", aplicar);
  chk.addEventListener("change", aplicar);
  box.append(document.createTextNode("Ver como:"), rol, apag);
  document.body.appendChild(box);
}

export async function montarDemo(): Promise<void> {
  const lista = await esperar(
    () =>
      typeof w.renderTaller === "function" &&
      typeof w.openTallerModal === "function" &&
      typeof w.__fichaRegistro === "function" &&
      typeof w.__abrirVisorAntesDespues === "function",
  );
  if (!lista) {
    console.error("[demo registro-ficha] la app no terminó de cargar");
    return;
  }
  if (w.__cloudSession) {
    console.warn("[demo registro-ficha] hay una sesión real abierta: la demo no corre");
    return;
  }
  cortarRedExterna();
  w.saveTallerDB = async () => {};
  w.__cloudReplaceTaller = async () => {};
  w.__cloudSyncTaller = async (arr: unknown[]) => ({ ok: arr.length, errors: [] });
  w.__cloudHydrate = async () => ({});
  w.__urlFotoPartida = async (k: string) => FOTOS[k] ?? null;
  w.__cloudSession = { username: "demo@ejemplo.test", email: "demo@ejemplo.test", tenantId: "demo", groups: ["admin"], sucursal: "" };
  llamar("applyRolePermissions");
  w.__visitaKeyDe = visitaKeyDe;
  w.__MOTIVOS_RECHAZO = MOTIVOS_RECHAZO;
  w.__gastoDerivado = gastoDerivado;
  w.__montoPendienteDeFirma = montoPendienteDeFirma;
  w.__pendientesDeFirma = pendientesDeFirma;
  w.__ordenarHallazgos = ordenarHallazgos;
  w.__hayCambios = hayCambios;
  w.__fichaRegistro = (e: unknown, ps: Partida[], o: { hibrido: boolean | undefined; confiables: boolean }) =>
    fichaRegistro(e as Parameters<typeof fichaRegistro>[0], ps, { ahora: new Date().toISOString(), hibrido: o.hibrido, confiables: o.confiables });
  // El directorio "llega" 2 s después, como en la nube: primero se ve el respaldo y luego el nombre.
  let directorio: Directorio | null = null;
  w.__nombreDeUsuario = (c: string) => nombreDeUsuario(c, directorio, YO);
  w.__describirRevocadaPor = (c: string) => describirRevocadaPor(c, directorio, YO);
  w.__directorioUsuarios = {
    cargar: () =>
      new Promise<boolean>((r) => setTimeout(() => { directorio = DIRECTORIO; r(true); }, 2000)),
  };
  // Doble LOCAL de la firma: cambia la partida en memoria y repinta (la demo del antes y después
  // no lo permitía; aquí hace falta para ver que Autorizar actualiza la ficha).
  w.__guardarDecisionPartida = async (p: Partida, decision: "autorizar" | "rechazar", motivo?: string, nota?: string) => {
    const mapa = w.__tallerPartidas as Map<string, Partida[]>;
    const ps = mapa.get(p.visitaKey) ?? [];
    const i = ps.findIndex((x) => x.partidaId === p.partidaId);
    if (i < 0) return p;
    const cuando = new Date().toISOString();
    ps[i] = decision === "autorizar" ? autorizar(ps[i]!, "demo@ejemplo.test", cuando) : rechazar(ps[i]!, "demo@ejemplo.test", cuando, motivo ?? "Otro", nota);
    llamar("_bnRepintar");
    return ps[i];
  };
  w.__tallerHibrido = true;
  w.__tallerHibridoDesconocido = false;
  w.__tallerPartidasCargadas = true;
  w.__anuladasActivas = new Map();
  llamar("applyTallerHibridoGate");

  const base = { brand: "Nissan NP300 (demo)", sucursal: "GDL", area: "Mantenimiento", tipo: "Correctivo", km: 85000, tecnico: "Taller Frenos del Bajío (demo)", comentario: "DEMO — datos inventados", updatedAt: new Date().toISOString() };
  const visitas = [
    { ...base, id: "demo-v1", unitKey: "demo-u06", eco: "06", plate: "PRB0006", estado: "En Reparación", fentrada: dia(-5), freporte: dia(-5), fsalidaEst: dia(1), fsalidaReal: "",
      estadoOperativo: "reparando", kmTaller: 85120, fsalidaEstTaller: dia(2), ligaVersion: 1, ligaCreadaEn: new Date(hoy.getTime() - 5 * 86400000).toISOString(), ligaCreadaPor: SUB_ANA },
    { ...base, id: "demo-v2", unitKey: "demo-u07", eco: "07", plate: "PRB0007", estado: "En Diagnóstico", fentrada: dia(-1), freporte: dia(-1), fsalidaEst: "", fsalidaReal: "", tecnico: "" },
    { ...base, id: "demo-v3", unitKey: "demo-u08", eco: "08", plate: "PRB0008", estado: "Finalizado", fentrada: dia(-12), freporte: dia(-12), fsalidaEst: dia(-8), fsalidaReal: dia(-7),
      ligaVersion: 2, ligaCreadaEn: new Date(hoy.getTime() - 12 * 86400000).toISOString(), ligaCreadaPor: SUB_ANA, ligaRevocadaEn: new Date(hoy.getTime() - 7 * 86400000).toISOString(), ligaRevocadaPor: "cierre:ana@ejemplo.test" },
    { ...base, id: "demo-v4", unitKey: "demo-u09", eco: "09", plate: "PRB0009", estado: "En Reparación", fentrada: dia(-9), freporte: dia(-9), fsalidaEst: dia(-2), fsalidaReal: "",
      estadoOperativo: "esperandoRefaccion", kmTaller: 120400, fsalidaEstTaller: dia(-1), fsalidaEstCompromiso: dia(-3), ligaVersion: 2, ligaCreadaEn: new Date(hoy.getTime() - 9 * 86400000).toISOString(), ligaCreadaPor: SUB_LUIS, ligaRevocadaEn: new Date(hoy.getTime() - 86400000).toISOString(), ligaRevocadaPor: SUB_ANA },
    { ...base, id: "demo-v5", unitKey: "demo-u10", eco: "10", plate: "PRB0010", estado: "Finalizado", fentrada: dia(-40), freporte: dia(-40), fsalidaEst: dia(-35), fsalidaReal: dia(-34),
      ligaVersion: 1, ligaCreadaEn: new Date(hoy.getTime() - 40 * 86400000).toISOString(), ligaCreadaPor: SUB_NADIE },
  ];
  w.tallerEntries = visitas;
  const vk = (v: unknown): string => llamar("__visitaKeyDe", v) as string;
  const pb = (v: (typeof visitas)[number], id: string, s: Partial<Partida>): Partida =>
    ({ visitaKey: vk(v), creadoPor: `liga:${v.plate}|${v.fentrada}`, creadoEn: new Date(hoy.getTime() - 4 * 86400000).toISOString(), propuestoEn: new Date(hoy.getTime() - 4 * 86400000).toISOString(),
      decididoPor: SUB_ANA, decididoEn: new Date(hoy.getTime() - 3 * 86400000).toISOString(), evidenciaFinal: [], partidaId: id, ...s }) as Partida;
  const v1 = visitas[0]!;
  const v4 = visitas[3]!;
  w.__tallerPartidas = new Map<string, Partida[]>([
    [vk(v1), [
      pb(v1, "d-1", { descripcion: "Balatas delanteras desgastadas", tipo: "refaccion", precio: 1850, precioAutorizado: 1850, estado: "autorizada", fotos: ["demo/antes-balatas-delanteras.png"] }),
      pb(v1, "d-2", { descripcion: "Balatas traseras", tipo: "refaccion", precio: 1650, precioAutorizado: 1650, estado: "terminada", fotos: ["demo/antes-balatas-traseras.png"], evidenciaFinal: ["demo/despues-balatas-traseras-1.png", "demo/despues-balatas-traseras-2.png"], terminadoEn: new Date(hoy.getTime() - 2 * 86400000).toISOString() }),
      pb(v1, "d-3", { descripcion: "Ajuste de freno de mano", tipo: "manoObra", precio: 350, precioAutorizado: 350, estado: "terminada", fotos: [], terminadoEn: new Date(hoy.getTime() - 2 * 86400000).toISOString() }),
      pb(v1, "d-4", { descripcion: "Amortiguador trasero con fuga", tipo: "refaccion", precio: 2400, estado: "propuesta", fotos: ["demo/antes-amortiguador.png"], decididoPor: undefined, decididoEn: undefined }),
    ]],
    [vk(v4), [
      pb(v4, "d-5", { descripcion: "Bomba de agua", tipo: "refaccion", precio: 3100, estado: "propuesta", fotos: ["demo/antes-amortiguador.png"], decididoPor: undefined, decididoEn: undefined }),
    ]],
  ]);

  const nav = document.getElementById("mainnav");
  if (nav) nav.style.display = "flex";
  const ldr = document.getElementById("ldr");
  if (ldr) ldr.style.display = "none";
  const dz = document.getElementById("dz");
  if (dz) dz.style.display = "none";
  avisoDemo();
  selectorDemo();
  llamar("showView", "taller");
  llamar("tlSwitch", "activas");
  llamar("renderTaller");
  llamar("openTallerModal", v1.id);
}
```
<!-- prettier-ignore-end -->

Si `autorizar`/`rechazar` tienen otra firma (léelas en `src/taller/partidas.ts:77` y `:100`), ajusta la llamada del doble, no las funciones. Si `__guardarDecisionPartida` espera otra forma (búscala en `src/api/cloudHydrate.ts` y en `_bnAutorizar`/`_bnRechazar`, `HTML:~8787-8823`), adapta el doble a esa forma: es un doble, no una regla.

- [ ] **Step 2: La guarda en `src/main.ts`**

Justo DESPUÉS de este bloque (viejo, literal):

<!-- prettier-ignore-start -->
```ts
if (
  import.meta.env.DEV &&
  window.location.search.includes("e2e=1") &&
  window.location.search.includes("demo=antes-despues")
) {
  void import("./dev/demoAntesDespues").then((m) => m.montarDemo());
}
```
<!-- prettier-ignore-end -->

agrega:

<!-- prettier-ignore-start -->
```ts
// ─── Vista local "registro como ficha" (spec 2026-09-30 §8) — SOLO `npm run dev` ───
if (
  import.meta.env.DEV &&
  window.location.search.includes("e2e=1") &&
  window.location.search.includes("demo=registro-ficha")
) {
  void import("./dev/demoRegistroFicha").then((m) => m.montarDemo());
}
```
<!-- prettier-ignore-end -->

- [ ] **Step 3: Verla una vez**

Run: `netstat -ano | grep LISTEN | grep ":5173 "` ⇒ vacío (si algo escucha, usa el puerto que Vite imprima al arrancar).
Run (en segundo plano): `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npm run dev`
Abre `http://localhost:5173/Control%20de%20flotilla.html?e2e=1&demo=registro-ficha` con Playwright o Chrome: debe verse el registro de la unidad 06 con la ficha. Corrige lo que truene (consola) antes de seguir. Apaga el servidor al terminar (y confirma que 5173 quedó libre).

- [ ] **Step 4: La demo NO viaja al build**

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npm run build | tail -5`
Run: `grep -rl --exclude=*.map "demoRegistroFicha\|registro como ficha\|MODO DEMO" "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha\dist\" || echo limpio` ⇒ `limpio`. Run: `ls "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha\dist\assets" | grep -ci demo` ⇒ `0`.
Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npm run typecheck | tail -5` y `npm run lint | tail -5` ⇒ limpios.

- [ ] **Step 5: Commit**

<!-- prettier-ignore-start -->
```bash
git -C "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" add src/dev/demoRegistroFicha.ts src/main.ts
git -C "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" commit -m "chore(taller): demo local del registro como ficha (solo npm run dev)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
<!-- prettier-ignore-end -->

---

### Task 10: Prueba e2e en Chrome real sobre la demo

**Files:**

- Create: `tests/e2e/registro-ficha.spec.ts`

**Interfaces:**

- Consumes: la demo de la Task 9 (`#demo-registro-ficha`, `#demo-rol-sel`), los ids del modal (Task 4), el aviso `#tf-aviso-firma`.

- [ ] **Step 1: Escribir la prueba**

<!-- prettier-ignore-start -->
```ts
import { test, expect, type Page } from "@playwright/test";

// Registro como ficha (spec 2026-09-30 §6/§8): la demo siembra 5 visitas inventadas y abre la
// unidad 06 con las funciones REALES de la app. Red externa bloqueada.
const URL_DEMO = "/Control%20de%20flotilla.html?e2e=1&demo=registro-ficha";
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function abrir(page: Page): Promise<void> {
  await page.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.protocol === "data:" || u.protocol === "blob:") return r.continue();
    return ["localhost", "127.0.0.1"].includes(u.hostname) ? r.continue() : r.abort();
  });
  await page.goto(URL_DEMO);
  await expect(page.locator("#demo-registro-ficha")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#taller-modal.open")).toBeVisible();
}

test.describe("registro como ficha — demo local", () => {
  test.beforeEach(async ({ page }) => { await abrir(page); });

  test("abre en la ficha: cómo va, datos plegados y hallazgos en Todas con los de firma primero", async ({ page }) => {
    const m = page.locator("#taller-modal");
    await expect(m.locator("#tl-mttl")).toHaveText(/Unidad 06 · PRB0006/);
    await expect(m.locator("#tf-ficha")).toBeVisible();
    await expect(m.locator("#tf-ficha")).toContainText("Cómo va");
    await expect(m.locator("#tf-ficha-gpa")).toContainText("En Reparación");
    await expect(m.locator("#tf-ficha-taller")).toContainText("REPARANDO");
    await expect(m.locator("#tf-ficha-dias")).toContainText("5 días");
    await expect(m.locator("#tf-ficha-salida")).toContainText("1 día después de lo estimado");
    await expect(m.locator("#tf-ficha-costo")).toContainText("Esperando tu firma");
    await expect(m.locator("#tf-datos")).not.toHaveAttribute("open", "");
    const grupos = m.locator("#tf-prov-partidas .tl-ficha-grupo");
    await expect(grupos.first()).toHaveText("Esperan tu firma");
    await expect(grupos.nth(1)).toContainText("Autorizados · suman");
  });

  test("el foco inicial está en el título, no en un botón que emite o firma", async ({ page }) => {
    await page.waitForTimeout(200);
    const id = await page.evaluate(() => document.activeElement?.id ?? "");
    expect(id).toBe("tl-mttl");
  });

  test("Guardar apagado hasta que cambias algo en Datos del registro", async ({ page }) => {
    const m = page.locator("#taller-modal");
    await expect(m.locator("#btn-guardar-taller")).toBeDisabled();
    await expect(m.locator("#tf-sin-cambios")).toBeVisible();
    await m.locator("#tf-datos > summary").click();
    await m.locator("#tf-km").fill("86000");
    await expect(m.locator("#btn-guardar-taller")).toBeEnabled();
    await expect(m.locator("#tf-sin-cambios")).toBeHidden();
  });

  test("la liga dice un nombre en cuanto llega el directorio, y nunca un GUID", async ({ page }) => {
    const meta = page.locator("#tf-prov-liga-meta");
    await expect(meta).toContainText("emitida por un usuario de GPA");
    await expect(meta).toContainText("emitida por Ana López", { timeout: 10_000 });
    expect(await page.locator("#taller-modal").innerText()).not.toMatch(GUID);
    await expect(page.locator("#btn-liga-copiar")).toHaveText("Copiar liga");
  });

  test("autorizar un hallazgo actualiza la ficha y no enciende Guardar", async ({ page }) => {
    const m = page.locator("#taller-modal");
    await expect(m.locator("#tf-ficha-costo")).toContainText("$2,400.00");
    await m.locator("#tf-prov-partidas").getByRole("button", { name: /Autorizar/ }).first().click();
    await expect(m.locator("#tf-ficha-costo")).not.toContainText("Esperando tu firma");
    await expect(m.locator("#tf-ficha-costo")).toContainText("$6,250.00");
    await expect(m.locator("#btn-guardar-taller")).toBeDisabled();
  });

  test("el alta abre con el formulario desplegado, sin ficha y con Guardar encendido", async ({ page }) => {
    await page.locator("#taller-modal .tl-cancel").click();
    await page.getByRole("button", { name: /Agregar unidad/ }).first().click();
    const m = page.locator("#taller-modal.open");
    await expect(m.locator("#tl-mttl")).toHaveText("Agregar unidad al taller");
    await expect(m.locator("#tf-ficha")).toBeHidden();
    await expect(m.locator("#tf-datos")).toHaveAttribute("open", "");
    await expect(m.locator("#btn-guardar-taller")).toBeEnabled();
  });

  test("cerrar con cambios pregunta; cancelar deja lo tecleado", async ({ page }) => {
    const m = page.locator("#taller-modal");
    await m.locator("#tf-datos > summary").click();
    await m.locator("#tf-km").fill("90000");
    let pregunta = "";
    page.once("dialog", async (d) => { pregunta = d.message(); await d.dismiss(); });
    await page.locator('#taller-modal button[aria-label="Cerrar modal de taller"]').click();
    expect(pregunta).toBe("¿Descartar los cambios?");
    await expect(m).toHaveClass(/open/);
    await expect(m.locator("#tf-km")).toHaveValue("90000");
  });

  test("viewer: ve la ficha, 'Ver datos' con campos deshabilitados y sin firmar", async ({ page }) => {
    await page.selectOption("#demo-rol-sel", "viewer");
    const m = page.locator("#taller-modal");
    await expect(m.locator("#tf-ficha")).toBeVisible();
    await expect(m.locator("#tf-datos .tl-datos-ver")).toHaveText("Ver datos");
    await expect(m.locator("#tf-datos-campos")).toBeDisabled();
    await expect(m.locator("#tf-prov-partidas").getByRole("button", { name: /Autorizar/ })).toHaveCount(0);
  });

  test("reingresar desde el registro deja las dos visitas en el historial de la unidad (decisión 26)", async ({ page }) => {
    await page.locator("#btn-reingreso").click();
    const m = page.locator("#taller-modal.open");
    await expect(m.locator("#tl-mttl")).toHaveText("Reingresar al Taller");
    await m.locator("#tf-tipo").selectOption("Correctivo");
    await m.locator("#tf-km").fill("85500");
    await m.locator("#btn-guardar-taller").click();
    const claves = await page.evaluate(() =>
      (window as unknown as { tallerEntries: { unitKey?: string; eco?: string }[] }).tallerEntries
        .filter((e) => e.eco === "06").map((e) => e.unitKey),
    );
    expect(claves).toEqual(["demo-u06", "demo-u06"]);
  });
});

test.describe("registro como ficha — celular (390 px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("aviso tocable, cinco botones de al menos 44 px y sin scroll horizontal", async ({ page }) => {
    await abrir(page);
    const aviso = page.locator("#tf-aviso-firma");
    await expect(aviso).toBeVisible();
    await expect(aviso).toHaveText(/1 hallazgo espera tu firma · \$2,400\.00 · Ver →/);
    await aviso.click();
    await expect(page.locator("#tf-prov-partidas").getByRole("button", { name: /Autorizar/ }).first()).toBeInViewport();
    for (const sel of [".tl-cancel", "#btn-reingreso", "#btn-expediente", "#btn-finalizar", "#btn-guardar-taller"]) {
      const b = page.locator(`#taller-modal ${sel}`);
      await expect(b).toBeVisible();
      expect((await b.boundingBox())!.height, sel).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
```
<!-- prettier-ignore-end -->

- [ ] **Step 2: Correr en Chrome real**

Run: `netstat -ano | grep LISTEN | grep ":5190 "` ⇒ vacío (Playwright reutiliza un servidor existente y probaría OTRO worktree).
Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npx playwright test -c playwright.local.config.ts tests/e2e/registro-ficha.spec.ts | tail -40`
Expected: 10 passed. Los montos salen con `_fmtMon2` ("$2,400.00"); si el separador difiere, ajusta la prueba al formato real, no la app. Si el nombre del botón "Agregar unidad" no coincide, búscalo en el HTML (`grep -n "Agregar unidad" "…/Control de flotilla.html"`).

- [ ] **Step 3: Commit**

<!-- prettier-ignore-start -->
```bash
git -C "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" add tests/e2e/registro-ficha.spec.ts
git -C "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" commit -m "test(taller): el registro como ficha se prueba en Chrome real sobre la demo" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
<!-- prettier-ignore-end -->

---

### Task 11: Batería completa, revisión final y la compuerta de Navares

**Files:** ninguno nuevo.

- [ ] **Step 1: Batería completa**

Run: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npx vitest run --reporter=default --reporter=json --outputFile="<scratchpad>/registro-ficha-vitest.json" | tail -40` ⇒ todo verde (el único intermitente conocido es `fuelOpsGuardHandlers › handleKmDetectado`: aislarlo y descartarlo por nombre; cualquier otro fallo se investiga; los nombres van en el JSON con `"status":"failed"`).
Run: `npm run typecheck`, `npm run lint`, `npm run build`, `npm run audit:csp`, `npm run audit:xss` (solo el sospechoso preexistente de llantas), cada uno con `cd "<worktree>" && … | tail -10`.
Run (con 5190 libre): `cd "<worktree>" && node scripts/gen-fixture-mensual.mjs | tail -3` y `cd "<worktree>" && npx playwright test -c playwright.local.config.ts | tail -80` ⇒ referencia: 7 ambientales conocidos (ENOENT taller.xlsx en E/WF5/WF6, ENOENT semanal.zip en F, `#tf-area` en WF1, WF2/WF3 atados al fixture) + `kpi-taller.spec.ts:89` que ya falla en `main`; las 4 de `antes-despues.spec.ts` y las 10 de `registro-ficha.spec.ts` pasan. Cualquier otro fallo: A/B contra la base `0081d0b` antes de culpar al cambio.
Arneses de Chrome en `.scratch` que tecleen campos de una visita guardada deben abrir `#tf-datos` primero (`details.open = true`); si alguno se corre, ajustarlo.

- [ ] **Step 2: Revisión final de la rama**

Un revisor nuevo, en el modelo más capaz, sobre `git -C "<worktree>" diff 0081d0b..HEAD` contra el spec (decisiones 1–26, §4, §5, §6, Review Focus del plan) y contra la bitácora de la ejecución. Una sola ola de correcciones; repetir el Step 1 sobre el árbol final. No hay ruta pública nueva ni Lambda tocado: no aplica la revisión de seguridad del portal.

- [ ] **Step 3: La compuerta — Navares lo ve en local (decisión 7, spec §8)**

Levantar: `cd "C:\CLAUDE ANTIGRAVITY\PROJECTS\Control-Flotilla\.claude\worktrees\registro-ficha" && npm run dev` (si 5173 está ocupado, Vite imprime otro puerto: darle ese). Decirle, en 3–6 renglones y en llano:

1. Abre `http://localhost:5173/Control%20de%20flotilla.html?e2e=1&demo=registro-ficha`.
2. Qué revisar: (1) al abrir la unidad 06, ¿entiendes "cómo va" sin bajar?; (2) ¿se distingue a la primera lo que dice GPA de lo que dice el taller?; (3) ¿la liga dice un nombre y no un código raro?; (4) autoriza un hallazgo: ¿cambia el costo de arriba y Guardar sigue apagado?; (5) cambia el Km en "Editar datos": ¿se enciende Guardar?; (6) en la unidad 09, ¿la ficha y la tabla dicen lo mismo («Promesa vencida»)?; (7) "Agregar unidad" y "+ Reingresar": ¿se ven como hoy, con el formulario abierto?; (8) achica la ventana a celular (o abre en el teléfono en la misma red): ¿el aviso de firma te lleva al hallazgo y los botones de abajo se leen bien? Con el selector de arriba a la derecha puede verse como Riesgos o como viewer y apagar el esquema híbrido.
3. Qué es simulado: la nube completa (guardar, firmar, liga, directorio). Qué es real: la pantalla, los estilos y las funciones de la app.

Él decide si le conviene. **Sin su "está bien" no hay PR ni push.** Si pide cambios, vuelven como tareas nuevas de este plan.

- [ ] **Step 4: Tras su visto bueno — preparar el PR (sin empujar)**

1. Confirmar que `feat/taller-antes-despues` ya está en `origin/main` (`git -C "<worktree>" fetch origin` y `git -C "<worktree>" merge-base --is-ancestor 0081d0b origin/main`). Si no, se detiene aquí (§10: esta rama va después).
2. `git -C "<worktree>" merge origin/main` (merge, no rebase); si chocan las huellas CSP, `npm run csp:sync` y commit del merge. Repetir el Step 1 completo.
3. Navares corre desde el worktree: `git push -u origin feat/taller-registro-ficha --no-verify`.
4. Abrir el PR con `gh pr create --base main --head feat/taller-registro-ficha` con el resumen de las decisiones y la batería; terminar la descripción con `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
5. Humo en producción tras el merge: con el apagador apagado, la ficha muestra solo lo de GPA; si se prende, repetir la visita 1 con la cuenta de Riesgos.
