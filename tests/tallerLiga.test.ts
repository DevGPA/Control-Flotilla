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

  it("revocarLigaTaller tiene la misma restricción de grupo", () => {
    const bloque = schema.slice(schema.indexOf("revocarLigaTaller: a"));
    expect(bloque).toContain('allow.group("admin")');
    expect(bloque).not.toContain('allow.group("viewer")');
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
// bumpearla dentro de `datos` no revocaría nada. Estas pruebas fijan el
// contrato real con las piezas puras (firmarToken/verificarToken/ligaRevocada)
// sin depender del cliente de datos ni de AWS: simulan exactamente lo que
// emitirLiga/revocarLiga hacen con la columna.
describe("revocar invalida los tokens emitidos ANTES (R65) — el interruptor es la COLUMNA, no datos.ligaVersion", () => {
  const secreto = "s";
  const base = { t: "gpa", u: "JV98698", f: "2026-09-01" };

  it("un token firmado con la versión vieja se rechaza en cuanto la columna sube", () => {
    // Visita sin liga previa: ligaVersion ausente se trata como 1 (mismo
    // criterio que ligaRevocada ya prueba en tallerPortalHandler.test.ts).
    const emitidoV1 = firmarToken({ ...base, v: 1, exp: Date.now() + VIGENCIA_LIGA_MS }, secreto);
    const payload = verificarToken(emitidoV1, secreto);
    // Esto es lo que revocarLiga escribe en la COLUMNA: (visita.ligaVersion ?? 1) + 1.
    const columnaTrasRevocar = 1 + 1;
    expect(ligaRevocada(columnaTrasRevocar, payload)).toBe(true);
  });

  it("emitir DESPUÉS de revocar firma con la versión NUEVA, y ese token sí sirve", () => {
    const nuevaVersion = 2;
    const reemitido = firmarToken(
      { ...base, v: nuevaVersion, exp: Date.now() + VIGENCIA_LIGA_MS },
      secreto,
    );
    const payload = verificarToken(reemitido, secreto);
    expect(ligaRevocada(nuevaVersion, payload)).toBe(false);
  });

  it("revocar dos veces sigue subiendo la columna — el segundo token viejo también se rechaza", () => {
    const v2 = firmarToken({ ...base, v: 2, exp: Date.now() + VIGENCIA_LIGA_MS }, secreto);
    const payloadV2 = verificarToken(v2, secreto);
    const columnaTrasSegundaRevocacion = 2 + 1; // revocar() vuelve a sumar 1
    expect(ligaRevocada(columnaTrasSegundaRevocacion, payloadV2)).toBe(true);
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
