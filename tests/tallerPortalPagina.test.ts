import { describe, it, expect } from "vitest";
import { escaparHtml, paginaProveedor } from "../amplify/functions/taller-portal/pagina";

describe("escaparHtml — el texto del taller nunca se pinta como HTML", () => {
  it("neutraliza los cinco caracteres peligrosos", () => {
    expect(escaparHtml('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
    expect(escaparHtml("a & b")).toBe("a &amp; b");
    expect(escaparHtml("it's")).toBe("it&#39;s");
  });

  it("no truena con valores raros", () => {
    expect(escaparHtml(undefined)).toBe("");
    expect(escaparHtml(null)).toBe("");
    expect(escaparHtml(42)).toBe("42");
  });
});

describe("paginaProveedor", () => {
  const p = paginaProveedor("TOKEN.FIRMA");

  it("es un documento completo y responsivo", () => {
    expect(p.startsWith("<!doctype html>")).toBe(true);
    expect(p).toContain('name="viewport"');
    expect(p).toContain("width=device-width");
  });

  it("dice explícitamente que el precio va sin IVA", () => {
    expect(p).toContain("Precio sin IVA");
  });

  it("ofrece los cuatro estados operativos en el idioma del taller", () => {
    for (const t of [
      "Estoy revisando",
      "Ya estoy reparando",
      "Esperando la refacción",
      "Ya está lista",
    ]) {
      expect(p).toContain(t);
    }
  });

  it("no filtra el secreto ni URLs de infraestructura", () => {
    expect(p).not.toMatch(/TALLER_PORTAL_SECRET|amazonaws\.com|lambda-url/);
  });

  it("lleva el token para sus propias llamadas, sin volver a pedirlo", () => {
    expect(p).toContain("TOKEN.FIRMA");
  });

  it("no usa innerHTML en su propio script", () => {
    expect(p).not.toContain("innerHTML");
  });
});
