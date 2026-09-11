import { describe, it, expect } from "vitest";
import { AREAS_CANONICAS, normalizeArea } from "../src/taller/types";

describe("normalizeArea — una sola grafía para Taller y el catálogo", () => {
  it("traduce la grafía vieja de Taller (mayúsculas sin acento)", () => {
    expect(normalizeArea("LOGISTICA")).toBe("Logística");
    expect(normalizeArea("SERVICIO TECNICO")).toBe("Servicio Técnico");
    expect(normalizeArea("ALMACEN")).toBe("Almacén");
    expect(normalizeArea("ADMINISTRACION")).toBe("Administración");
    expect(normalizeArea("MANTENIMIENTO")).toBe("Mantenimiento");
  });

  it("deja pasar la grafía del catálogo sin tocarla", () => {
    for (const a of AREAS_CANONICAS) expect(normalizeArea(a)).toBe(a);
  });

  it("tolera espacios, minúsculas y acentos faltantes", () => {
    expect(normalizeArea("  logistica ")).toBe("Logística");
    expect(normalizeArea("Servicio tecnico")).toBe("Servicio Técnico");
  });

  it("devuelve cadena vacía para lo que no reconoce, nunca inventa", () => {
    expect(normalizeArea("VENTAS")).toBe("");
    expect(normalizeArea("")).toBe("");
    expect(normalizeArea(undefined)).toBe("");
    expect(normalizeArea(null)).toBe("");
  });

  it("expone exactamente las cinco áreas del catálogo", () => {
    expect(AREAS_CANONICAS).toEqual([
      "Logística",
      "Almacén",
      "Servicio Técnico",
      "Mantenimiento",
      "Administración",
    ]);
  });
});
