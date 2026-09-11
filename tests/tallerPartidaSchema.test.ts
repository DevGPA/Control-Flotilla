import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const schema = readFileSync("amplify/data/resource.ts", "utf8");

/**
 * D-M2 — acota UN modelo hasta la SIGUIENTE declaración de nivel superior.
 * Antes cada aserción de abajo corría contra el archivo COMPLETO: `"lista"` es
 * un literal genérico y `km:`/`fsalidaEst:` aparecen en otros modelos, así que
 * varias pruebas pasaban sin que el bloque de `TallerPartida` (o el de
 * `Taller`) las cumpliera.
 *
 * L108 — `fin === -1` significa "no encontré el cierre"; el código anterior lo
 * trataba como "toma todo hasta EOF", que es un falso-verde silencioso sobre
 * autorización. Ahora se afirma que el bound EXISTE.
 */
function bloqueDeModelo(nombre: string): string {
  const inicio = schema.indexOf(`${nombre}: a`);
  expect(inicio, `no se encontró el modelo ${nombre}`).toBeGreaterThan(-1);
  const resto = schema.slice(inicio);
  // Patrón: salto de línea + 4 espacios + palabra + ": a" + salto/espacios + ".model("
  const fin = resto.search(/\n {4}\w+: a\n?\s*\.model\(/);
  expect(fin, `el bound del bloque de ${nombre} no se encontró`).not.toBe(-1);
  return resto.slice(0, fin);
}

describe("schema — TallerPartida y las columnas nuevas de Taller", () => {
  it("declara el modelo TallerPartida", () => {
    expect(schema).toContain("TallerPartida: a");
  });

  it("usa la llave natural (tenantId, visitaKey, partidaId)", () => {
    expect(schema).toMatch(/identifier\(\["tenantId", ?"visitaKey", ?"partidaId"\]\)/);
  });

  it("declara los seis estados de partida — DENTRO del bloque de TallerPartida", () => {
    const bloque = bloqueDeModelo("TallerPartida");
    for (const e of [
      "borrador",
      "propuesta",
      "autorizada",
      "rechazada",
      "terminada",
      "cancelada",
    ]) {
      expect(bloque).toContain(`"${e}"`);
    }
  });

  it("promueve a columnas los cuatro campos que escribe el proveedor — DENTRO de Taller", () => {
    const bloque = bloqueDeModelo("Taller");
    // Guarda del propio bound: el bloque de `Taller` NO puede alcanzar el de
    // `TallerPartida`, que es el siguiente modelo de nivel superior.
    expect(bloque).not.toContain("TallerPartida: a");
    for (const c of ["km:", "estadoOperativo:", "fsalidaEst:", "fsalidaEstCompromiso:"]) {
      expect(bloque).toContain(c);
    }
  });

  it("promueve a columna el interruptor de revocación de la liga — DENTRO de Taller", () => {
    expect(bloqueDeModelo("Taller")).toContain("ligaVersion:");
  });

  it("declara los cuatro estados operativos — DENTRO de Taller", () => {
    const bloque = bloqueDeModelo("Taller");
    for (const e of ["revisando", "reparando", "esperandoRefaccion", "lista"]) {
      expect(bloque).toContain(`"${e}"`);
    }
  });

  it("viewer no escribe partidas: la escritura es de operativo y admin", () => {
    const bloque = bloqueDeModelo("TallerPartida");

    // Prueba que el bound funciona: el bloque NO debe contener "adminCreateUser",
    // que es un modelo posterior (Custom operations del módulo de Administración).
    expect(bloque).not.toContain("adminCreateUser");

    // Prueba central: viewer solo lee; escritura es operativo/admin.
    expect(bloque).toContain('allow.groupDefinedIn("tenantId").to(["read"])');
    expect(bloque).toContain('allow.group("operativo")');

    // Regresión crítica: viewer no tiene write. El 2026-06-18 un grant incorrecto
    // de viewer causó un incidente; este guard lo previene.
    expect(bloque).not.toContain('allow.group("viewer").to(["create", "update", "delete"])');
  });

  // R92 — dos huecos de integridad sobre "la única copia del dinero".
  it("`precio` es REQUERIDO — sin él, autorizar firmaba $0 en silencio (R92)", () => {
    expect(bloqueDeModelo("TallerPartida")).toMatch(/precio:\s*a\.float\(\)\.required\(\)/);
  });

  it("`operativo` NO tiene `delete` — el estándar es anulación, nunca borrado (R92)", () => {
    const bloque = bloqueDeModelo("TallerPartida");
    expect(bloque).toContain('allow.group("operativo").to(["create", "update"])');
    expect(bloque).not.toContain('allow.group("operativo").to(["create", "update", "delete"])');
  });
});
