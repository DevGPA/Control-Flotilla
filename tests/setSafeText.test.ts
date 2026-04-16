import { describe, expect, it } from "vitest";
import { setSafeText } from "../src/dom/safeHTML";

describe("setSafeText", () => {
  it("asigna textContent al elemento", () => {
    const el = document.createElement("div");
    setSafeText(el, "hola mundo");
    expect(el.textContent).toBe("hola mundo");
  });

  it("null → string vacío (sin lanzar)", () => {
    const el = document.createElement("div");
    setSafeText(el, null);
    expect(el.textContent).toBe("");
  });

  it("undefined → string vacío", () => {
    const el = document.createElement("div");
    setSafeText(el, undefined);
    expect(el.textContent).toBe("");
  });

  it("numérico se convierte a string", () => {
    const el = document.createElement("span");
    setSafeText(el, 42);
    expect(el.textContent).toBe("42");
  });

  it("HTML en input NO se interpreta (textContent safe)", () => {
    const el = document.createElement("div");
    setSafeText(el, '<img src=x onerror=alert(1)>');
    expect(el.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(el.children.length).toBe(0);
    expect(el.querySelector("img")).toBeNull();
  });

  it("el = null → no-op sin error", () => {
    expect(() => setSafeText(null, "test")).not.toThrow();
  });

  it("reemplaza contenido previo", () => {
    const el = document.createElement("div");
    el.textContent = "original";
    setSafeText(el, "nuevo");
    expect(el.textContent).toBe("nuevo");
  });

  it("boolean se convierte a string", () => {
    const el = document.createElement("div");
    setSafeText(el, true as unknown as string);
    expect(el.textContent).toBe("true");
  });

  it("objeto complejo → [object Object] (preservado como texto)", () => {
    const el = document.createElement("div");
    setSafeText(el, { a: 1 } as unknown as string);
    expect(el.textContent).toBe("[object Object]");
    // Lo importante: NO se crea DOM interno
    expect(el.children.length).toBe(0);
  });
});
