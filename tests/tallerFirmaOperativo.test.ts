// tests/tallerFirmaOperativo.test.ts
//
// 🔴 DEFECTO EN PROD (2026-09-15): Administración de Riesgos (grupo `operativo`)
// no podía autorizar ni rechazar ninguna partida — "No se pudo autorizar" en
// cada clic — mientras `admin` firmaba sin problema.
//
// Causa, confirmada leyendo la autorización DESPLEGADA de AppSync:
//   1. La ola de fixes hizo que `guardarDecisionPartida` mandara SIEMPRE
//      `motivoRechazo: null` y `motivoRechazoNota: null` (para no dejar el
//      rastro de un rechazo anterior pegado a una fila ya autorizada).
//   2. En la MISMA ola, R92 le quitó la operación `delete` a `operativo` sobre
//      `TallerPartida` (borrado físico sobre la única copia del dinero).
//   3. En la plantilla que Amplify genera, escribir `null` en un campo ES la
//      operación de borrado de ese campo: la regla de `operativo` quedó con
//      `nullAllowedFields: []`, así que cada firma suya moría con
//      `Unauthorized on [motivoRechazo, motivoRechazoNota]`.
//      (`admin` tiene `isAuthorizedOnAllFields: true` y nunca lo vio.)
//
// Dos decisiones correctas por separado que juntas rompieron la firma. Ninguna
// prueba lo atrapó porque la autorización real de AppSync no se ejecuta aquí.
// La defensa que queda es esta: el payload no manda `null` si no hay nada que
// borrar. Misma familia que el defecto del `fieldName` — un contrato externo
// que solo se ve ejecutándolo.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { camposDeDecision } from "../src/api/tallerPartidas";
import { autorizar, rechazar, type Partida } from "../src/taller/partidas";

const P = (o: Partial<Partida> = {}): Partida => ({
  partidaId: "p1",
  visitaKey: "JB4479A|2026-09-14",
  descripcion: "Balatas",
  tipo: "refaccion",
  precio: 550,
  estado: "propuesta",
  fotos: [],
  ...o,
});

const QUIEN = "riesgos@ejemplo.test";
const CUANDO = "2026-09-15T18:00:00.000Z";

describe("camposDeDecision — el payload no pide borrar lo que no existe", () => {
  it("AUTORIZAR una propuesta limpia NO manda motivoRechazo ni motivoRechazoNota", () => {
    const actual = P();
    const campos = camposDeDecision(actual, autorizar(actual, QUIEN, CUANDO));
    // La clave ni siquiera viaja: con `null` AppSync exigiría permiso de borrado.
    expect(Object.prototype.hasOwnProperty.call(campos, "motivoRechazo")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(campos, "motivoRechazoNota")).toBe(false);
    // Lo que sí cambia, sí viaja.
    expect(campos.precioAutorizado).toBe(550);
  });

  it("RECHAZAR con un motivo del catálogo manda el motivo y NO manda la nota", () => {
    const actual = P();
    const campos = camposDeDecision(
      actual,
      rechazar(actual, "No es necesario ahora", undefined, QUIEN, CUANDO),
    );
    expect(campos.motivoRechazo).toBe("No es necesario ahora");
    // Solo el motivo "Otro" lleva nota (src/taller/partidas.ts): sin ella, la
    // clave no viaja — mandar `null` aquí era justo lo que rompía a `operativo`.
    expect(Object.prototype.hasOwnProperty.call(campos, "motivoRechazoNota")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(campos, "precioAutorizado")).toBe(false);
  });

  it('RECHAZAR con "Otro" manda motivo y nota, sin ningún null', () => {
    const actual = P();
    const campos = camposDeDecision(
      actual,
      rechazar(actual, "Otro", "Cotizar con el otro taller", QUIEN, CUANDO),
    );
    expect(campos.motivoRechazo).toBe("Otro");
    expect(campos.motivoRechazoNota).toBe("Cotizar con el otro taller");
    expect(Object.values(campos)).not.toContain(null);
  });

  it("ningún payload de decisión normal contiene un null", () => {
    const actual = P();
    const casos = [
      autorizar(actual, QUIEN, CUANDO),
      rechazar(actual, "No corresponde a esta unidad", undefined, QUIEN, CUANDO),
      rechazar(actual, "Precio alto — recotizar", undefined, QUIEN, CUANDO),
      rechazar(actual, "Otro", "detalle", QUIEN, CUANDO),
    ];
    for (const nueva of casos) {
      expect(Object.values(camposDeDecision(actual, nueva))).not.toContain(null);
    }
  });

  it("dato corrupto (una propuesta que arrastra motivo) SÍ pide borrarlo — la limpieza no se pierde", () => {
    // Inalcanzable por la capa pura (autorizar exige estado "propuesta" y una
    // propuesta no lleva motivo), pero si el dato llegara sucio hay que limpiarlo.
    const sucia = P({ motivoRechazo: "rastro viejo", motivoRechazoNota: "nota vieja" });
    const campos = camposDeDecision(sucia, autorizar(sucia, QUIEN, CUANDO));
    expect(campos.motivoRechazo).toBeNull();
    expect(campos.motivoRechazoNota).toBeNull();
  });

  it("lo que no cambia no se manda: re-aplicar la misma decisión da un payload vacío", () => {
    const yaAutorizada = P({
      estado: "autorizada",
      precioAutorizado: 550,
      decididoPor: QUIEN,
      decididoEn: CUANDO,
    });
    expect(camposDeDecision(yaAutorizada, yaAutorizada)).toEqual({});
  });
});

describe("guardarDecisionPartida — estructural: no vuelve el null incondicional", () => {
  const src = readFileSync(join(__dirname, "..", "src", "api", "tallerPartidas.ts"), "utf8");
  const bloque = (() => {
    const i = src.indexOf("export async function guardarDecisionPartida");
    expect(i).toBeGreaterThan(-1);
    const fin = src.indexOf("\n}", src.indexOf("TallerPartida.update(", i));
    expect(fin).toBeGreaterThan(i);
    return src.slice(i, fin);
  })();

  it("el update usa el diff, no `?? null` incondicional", () => {
    expect(bloque).toContain("...camposDeDecision(actual, nueva)");
    expect(bloque).not.toContain("motivoRechazo: nueva.motivoRechazo ?? null");
    expect(bloque).not.toContain("motivoRechazoNota: nueva.motivoRechazoNota ?? null");
  });

  it("sigue re-leyendo la fila REAL antes de decidir (B-C3 intacto)", () => {
    expect(bloque).toContain("TallerPartida.get(");
    expect(bloque.indexOf("TallerPartida.get(")).toBeLessThan(
      bloque.indexOf("TallerPartida.update("),
    );
  });
});

describe("esquema — por qué `operativo` no puede escribir un null (R92 sigue en pie)", () => {
  const schema = readFileSync(join(__dirname, "..", "amplify", "data", "resource.ts"), "utf8");
  const bloque = (() => {
    const i = schema.indexOf("TallerPartida: a");
    expect(i).toBeGreaterThan(-1);
    const fin = schema.indexOf(".secondaryIndexes(", i);
    expect(fin).toBeGreaterThan(i);
    return schema.slice(i, fin);
  })();

  it("`operativo` conserva create y update, y NO delete", () => {
    expect(bloque).toContain('allow.group("operativo").to(["create", "update"])');
    expect(bloque).not.toContain('allow.group("operativo").to(["create", "update", "delete"])');
  });

  it("`admin` mantiene acceso completo (por eso nunca vio el defecto)", () => {
    expect(bloque).toContain('allow.group("admin")');
  });
});
