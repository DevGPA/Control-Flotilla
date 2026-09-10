// Task 11: emitir, copiar y revocar la liga del proveedor.
//
// El handler real (handler.ts) importa $amplify/env/taller-portal (módulo
// virtual de Amplify) y el SDK de AWS — igual que el resto de los Lambdas de
// este repo (admin-users, opsgpa-receptor, vision-combustible), NINGUNO se
// importa/ejecuta directo en un test unitario. Por eso las pruebas de
// "qué rama alcanza qué" son estructurales (lectura de texto fuente), como ya
// hacía tallerPortalHandler.test.ts para /api/liga. Son pruebas honestas: cada
// una afirma algo concreto y falla si ese algo deja de ser cierto — no un
// `expect(true).toBe(true)` disfrazado.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mensajeWhatsApp } from "../src/taller/partidas";
import {
  VIGENCIA_LIGA_MS,
  firmarToken,
  verificarToken,
} from "../amplify/functions/taller-portal/token";
import { ligaRevocada } from "../amplify/functions/taller-portal/validacion";

const schema = readFileSync("amplify/data/resource.ts", "utf8");
const handlerSrc = readFileSync("amplify/functions/taller-portal/handler.ts", "utf8");

/**
 * Ronda 1 de review, Important 1: `schema.slice(indexOf(nombre))` SIN un
 * límite superior se extiende hasta el FINAL DEL ARCHIVO — así que
 * `bloque.toContain('allow.group("admin")')` lo satisface la restricción de
 * CUALQUIER mutación posterior, no la propia. Concretamente: si alguien
 * cambiara `generarLigaTaller` a `[allow.authenticated()]` y dejara
 * `revocarLigaTaller` intacta, la prueba seguía en verde (0 `viewer` en todo
 * el archivo, y el `admin` de la otra mutación "cuenta"). Esta función aísla
 * el bloque de UNA declaración hasta la SIGUIENTE declaración de nivel
 * superior del schema (4 espacios de indentación + `nombre: a`) — nunca hasta
 * el "próximo `: a`" a secas, que atraparía como falso corte cosas como
 * `unitUid: a.string()` dentro de `.arguments({...})` (6 espacios).
 */
function finDeBloque(texto: string, inicio: number): number {
  const resto = texto.slice(inicio + 1);
  const m = resto.match(/\n {4}[A-Za-z]+: a\b/);
  return m && m.index !== undefined ? inicio + 1 + m.index : texto.length;
}

describe("la emisión de ligas NO cuelga de la URL pública", () => {
  it("existe como mutación de AppSync", () => {
    expect(schema).toContain("generarLigaTaller: a");
    expect(schema).toContain("revocarLigaTaller: a");
  });

  it("solo admin y operativo pueden emitir/revocar — AISLADO por mutación, nunca 'viewer' ni auth genérica", () => {
    const inicioGenerar = schema.indexOf("generarLigaTaller: a");
    const inicioRevocar = schema.indexOf("revocarLigaTaller: a");
    expect(inicioGenerar).toBeGreaterThan(-1);
    expect(inicioRevocar).toBeGreaterThan(inicioGenerar);

    const bloqueGenerar = schema.slice(inicioGenerar, inicioRevocar);
    const bloqueRevocar = schema.slice(inicioRevocar, finDeBloque(schema, inicioRevocar));

    for (const [nombre, bloque] of [
      ["generarLigaTaller", bloqueGenerar],
      ["revocarLigaTaller", bloqueRevocar],
    ] as const) {
      expect(bloque, `${nombre}: falta allow.group("admin")`).toContain('allow.group("admin")');
      expect(bloque, `${nombre}: falta allow.group("operativo")`).toContain(
        'allow.group("operativo")',
      );
      expect(bloque, `${nombre}: NO debe permitir "viewer"`).not.toContain('allow.group("viewer")');
      expect(bloque, `${nombre}: NO debe degradar a allow.authenticated()`).not.toContain(
        "allow.authenticated",
      );
    }
  });

  it("el handler del portal no expone ninguna ruta HTTP de emisión", () => {
    expect(handlerSrc).not.toContain('"/api/liga"');
  });

  // R64: el test original de la ronda 1 del brief afirmaba
  // `expect(h).not.toContain("firmarToken")` a la vez que Step 4 hace
  // `import { firmarToken } from "./token"` dentro del propio handler — las
  // dos cosas no pueden ser ciertas a la vez. Lo que de verdad importa es que
  // emitirLiga/revocarLiga sean alcanzables SOLO desde la rama de
  // `event.info.fieldName` (la invocación de AppSync), nunca desde una de las
  // rutas `if (metodo === ... && ruta === ...)` de la URL pública.
  it("emitirLiga/revocarLiga solo se invocan desde la rama del fieldName de AppSync, nunca desde una ruta rawPath", () => {
    const inicioResolver = handlerSrc.indexOf("event?.info?.fieldName");
    const inicioRutas = handlerSrc.indexOf("const ruta = String(event?.rawPath");
    const finHandler = handlerSrc.indexOf("\n// ── Datos");
    expect(inicioResolver).toBeGreaterThan(-1);
    expect(inicioRutas).toBeGreaterThan(inicioResolver);
    expect(finHandler).toBeGreaterThan(inicioRutas);

    const bloqueResolver = handlerSrc.slice(inicioResolver, inicioRutas);
    const bloqueRutas = handlerSrc.slice(inicioRutas, finHandler);
    expect(bloqueResolver).toContain("emitirLiga(");
    expect(bloqueResolver).toContain("revocarLiga(");
    expect(bloqueRutas).not.toContain("emitirLiga(");
    expect(bloqueRutas).not.toContain("revocarLiga(");
  });
});

describe("un evento de resolver de AppSync nunca cae en la página HTML de liga inválida (R44)", () => {
  it("la rama del fieldName está ANTES de leer rawPath — si no, un evento sin rawPath caería en esPagina===true", () => {
    const idxFieldName = handlerSrc.indexOf("event?.info?.fieldName");
    const idxRawPath = handlerSrc.indexOf("event?.rawPath");
    expect(idxFieldName).toBeGreaterThan(-1);
    expect(idxRawPath).toBeGreaterThan(-1);
    expect(idxFieldName).toBeLessThan(idxRawPath);
  });

  it("la rama del resolver nunca llama a html() ni sirve PAGINA_LIGA_INVALIDA — solo puede devolver el JSON crudo que espera a.json()", () => {
    const inicio = handlerSrc.indexOf("event?.info?.fieldName");
    const fin = handlerSrc.indexOf("const ruta = String(event?.rawPath");
    const bloque = handlerSrc.slice(inicio, fin);
    expect(bloque).not.toContain("html(");
    expect(bloque).not.toContain("PAGINA_LIGA_INVALIDA");
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

// R65: el brief leía/escribía `ligaVersion` dentro del blob `datos`, pero
// `ligaRevocada` (validacion.ts) compara contra la COLUMNA real de Taller —
// bumpearla dentro de `datos` no revocaría nada.
//
// Ronda 1 de review, Important 2: la versión anterior de estas pruebas hacía
// `const columnaTrasRevocar = 1 + 1` dentro del PROPIO test — es decir,
// RE-IMPLEMENTABA lo que se supone que revocarLiga hace, y solo volvía a
// probar `ligaRevocada` (ya cubierta en tallerPortalHandler.test.ts). Las
// tres pruebas seguirían en verde aunque `revocarLiga` escribiera
// `ligaVersion` DENTRO de `datos` vía `JSON.stringify` — el bug exacto que
// R65 existe para prevenir. La corrección es estructural, sobre el código
// REAL de handler.ts: verifica que `emitirLiga` lee la COLUMNA
// (`visita.ligaVersion`, nunca `datos.ligaVersion`/`d.ligaVersion`) y que
// tanto `emitirLiga` como `revocarLiga` pasan sus campos de liga en el 4º
// argumento de `actualizarVisita` — nunca dentro de un objeto `datos` ni via
// `JSON.stringify` (la firma real de la revocación, no una simulación).
describe("emitirLiga/revocarLiga tocan la COLUMNA a través de actualizarVisita, nunca datos/JSON.stringify (R65)", () => {
  it("emitirLiga lee ligaVersion de la COLUMNA de la visita, nunca de datos.ligaVersion, y escribe el rastro por actualizarVisita", () => {
    const inicioFn = handlerSrc.indexOf("async function emitirLiga(");
    const finFn = handlerSrc.indexOf("async function revocarLiga(");
    expect(inicioFn).toBeGreaterThan(-1);
    expect(finFn).toBeGreaterThan(inicioFn);
    const cuerpo = handlerSrc.slice(inicioFn, finFn);

    expect(cuerpo).toContain("visita.ligaVersion");
    expect(cuerpo).not.toContain("d.ligaVersion");
    expect(cuerpo).not.toContain("datos.ligaVersion");

    const inicioLlamada = cuerpo.indexOf("actualizarVisita(");
    expect(inicioLlamada).toBeGreaterThan(-1);
    const llamada = cuerpo.slice(inicioLlamada, cuerpo.indexOf(");", inicioLlamada));
    expect(llamada).toContain("ligaCreadaEn");
    expect(llamada).toContain("ligaCreadaPor");
    expect(llamada).not.toContain("datos");
    expect(llamada).not.toContain("JSON.stringify");
  });

  it("revocarLiga sube ligaVersion en el 4º argumento de actualizarVisita — nunca dentro de datos/JSON.stringify", () => {
    const inicioFn = handlerSrc.indexOf("async function revocarLiga(");
    expect(inicioFn).toBeGreaterThan(-1);
    const cuerpo = handlerSrc.slice(inicioFn);

    const inicioLlamada = cuerpo.indexOf("actualizarVisita(");
    expect(inicioLlamada).toBeGreaterThan(-1);
    const llamada = cuerpo.slice(inicioLlamada, cuerpo.indexOf(");", inicioLlamada));
    expect(llamada).toContain("ligaVersion: nueva");
    expect(llamada).toContain("ligaRevocadaEn");
    expect(llamada).toContain("ligaRevocadaPor");
    expect(llamada).not.toContain("datos");
    expect(llamada).not.toContain("JSON.stringify");
  });

  // Se conservan las pruebas de ida y vuelta del token puro (firmarToken/
  // verificarToken/ligaRevocada) — no re-implementan revocarLiga, solo fijan
  // que el interruptor de versión sigue funcionando como pieza aislada.
  it("un token firmado con una versión ya no vigente se rechaza (ligaRevocada, pieza real)", () => {
    const t = firmarToken(
      { t: "gpa", u: "JV98698", f: "2026-09-01", v: 1, exp: Date.now() + VIGENCIA_LIGA_MS },
      "s",
    );
    const payload = verificarToken(t, "s");
    expect(ligaRevocada(2, payload)).toBe(true);
  });

  it("un token firmado con la versión vigente actual se acepta (ligaRevocada, pieza real)", () => {
    const t = firmarToken(
      { t: "gpa", u: "JV98698", f: "2026-09-01", v: 2, exp: Date.now() + VIGENCIA_LIGA_MS },
      "s",
    );
    const payload = verificarToken(t, "s");
    expect(ligaRevocada(2, payload)).toBe(false);
  });
});

// R76 (ruling del controlador, ronda 1 de review): dos Minors del revisor se
// elevan a este round por estar en la ruta que acuña ligas.
describe("el resolver falla cerrado sin identidad o sin autor identificable (R76)", () => {
  // Región de la rama de resolver ANTES de la llamada real a emitirLiga — es
  // donde deben vivir los dos candados: si estuvieran después, ya habrían
  // leído/escrito la visita antes de rechazar.
  const inicioResolver = handlerSrc.indexOf("event?.info?.fieldName");
  const inicioLlamadaEmitir = handlerSrc.indexOf("emitirLiga(", inicioResolver);
  const bloqueAntesDeEmitir = handlerSrc.slice(inicioResolver, inicioLlamadaEmitir);

  it("existe la región a revisar (guarda contra un refactor que mueva los marcadores)", () => {
    expect(inicioResolver).toBeGreaterThan(-1);
    expect(inicioLlamadaEmitir).toBeGreaterThan(inicioResolver);
  });

  it('sin event.identity o sin tenantId resuelto, la rama rechaza con "no autorizado" ANTES de leer la visita', () => {
    expect(bloqueAntesDeEmitir).toMatch(/!event\?\.identity/);
    expect(bloqueAntesDeEmitir).toContain("no autorizado");
  });

  it('quien === "desconocido" nunca acuña ni revoca — una liga sin responsable identificable viola la decisión 20 del spec', () => {
    expect(bloqueAntesDeEmitir).toContain('quien === "desconocido"');
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

  it("sin eco, nombra la unidad solo por placa", () => {
    const sinEco = mensajeWhatsApp({ eco: "", placa: "JV98698", url: "https://x/?t=TOK" });
    expect(sinEco).toContain("JV98698");
    expect(sinEco).not.toContain("unidad  (");
  });
});
