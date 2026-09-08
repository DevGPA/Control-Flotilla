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
    // Acota el bloque de TallerPartida: el siguiente modelo de nivel superior
    // marca el fin de su declaración. Regresión: si la búsqueda fallara, esto
    // debería revisarse; si el bound fuera incorrecto, veremos strings que NO
    // pertenecen a TallerPartida.
    const inicio = schema.indexOf("TallerPartida: a");
    const resto = schema.slice(inicio);
    // Patrón: salto de línea + 4 espacios + palabra + ": a" + salto/espacios + ".model("
    const fin = resto.search(/\n {4}\w+: a\n?\s*\.model\(/);
    const bloque = fin === -1 ? resto : resto.slice(0, fin);

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
});
