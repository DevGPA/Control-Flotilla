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
