import { describe, expect, it } from "vitest";
import { esMontacargasProducto } from "../src/api/cloudHydrate";

describe("esMontacargasProducto (Gas LP ⇒ montacargas)", () => {
  it("marca true para productos Gas LP (Toka y EASYGAS)", () => {
    expect(esMontacargasProducto("TOKA COMBUSTIBLE GAS LP CHIP")).toBe(true);
    expect(esMontacargasProducto("EASYGAS LP CHIP")).toBe(true);
    expect(esMontacargasProducto("gas lp")).toBe(true);
  });

  it("marca false para combustibles de vehículo", () => {
    expect(esMontacargasProducto("TOKA COMBUSTIBLE DIESEL CHIP")).toBe(false);
    expect(esMontacargasProducto("TOKA COMBUSTIBLE PREMIUM CHIP")).toBe(false);
    expect(esMontacargasProducto("TOKA COMBUSTIBLE MAGNA CHIP")).toBe(false);
    expect(esMontacargasProducto("EASYGAS DISEL CHIP")).toBe(false);
  });

  it("marca false para vacío / null / undefined", () => {
    expect(esMontacargasProducto("")).toBe(false);
    expect(esMontacargasProducto(null)).toBe(false);
    expect(esMontacargasProducto(undefined)).toBe(false);
  });
});
