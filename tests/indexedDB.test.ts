import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

// Importamos DESPUÉS del polyfill para que `openDB` use el global parcheado.
const { dbPut, dbGet, dbDelete } = await import("../src/db/indexedDB");

// fake-indexeddb persiste entre tests por default; limpiamos a mano lo que tocamos.
async function cleanup() {
  // meta es el store que usamos en los tests; borrar las keys conocidas
  for (const k of ["k1", "k2", "objKey"]) {
    try {
      await dbDelete("meta", k);
    } catch {
      /* ignore */
    }
  }
}

describe("indexedDB wrapper", () => {
  beforeEach(cleanup);

  it("put + get round-trip con string", async () => {
    await dbPut("meta", "k1", "hola");
    const v = await dbGet<string>("meta", "k1");
    expect(v).toBe("hola");
  });

  it("put + get con objeto JSON", async () => {
    const obj = { eco: "A-117", risk: "Urgente", F: [{ cat: "Llantas", text: "piloto 3mm" }] };
    await dbPut("meta", "objKey", obj);
    const out = await dbGet<typeof obj>("meta", "objKey");
    expect(out).toEqual(obj);
  });

  it("get de key inexistente → undefined", async () => {
    const v = await dbGet("meta", "nope-missing");
    expect(v).toBeUndefined();
  });

  it("delete remueve el valor", async () => {
    await dbPut("meta", "k2", 42);
    expect(await dbGet("meta", "k2")).toBe(42);
    await dbDelete("meta", "k2");
    expect(await dbGet("meta", "k2")).toBeUndefined();
  });

  it("overwrite: put sobre key existente reemplaza", async () => {
    await dbPut("meta", "k1", "v1");
    await dbPut("meta", "k1", "v2");
    expect(await dbGet<string>("meta", "k1")).toBe("v2");
  });
});
