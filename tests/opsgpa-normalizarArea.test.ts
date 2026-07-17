import { describe, expect, it } from "vitest";
import { normalizarArea } from "../src/opsgpa/contract";

// "Área automática desde Ops" (2026-07-17): el catálogo CAT#VEHICLE guarda `responsable`
// en MAYÚSCULAS sin acentos; el receptor lo estampa en Unit.area con la grafía de FC.
describe("normalizarArea (MAYÚS de Ops → grafía de FC)", () => {
  it("mapea las 5 áreas oficiales de Ops", () => {
    expect(normalizarArea("LOGISTICA")).toBe("Logística");
    expect(normalizarArea("ALMACEN")).toBe("Almacén");
    expect(normalizarArea("SERVICIO TECNICO")).toBe("Servicio Técnico");
    expect(normalizarArea("MANTENIMIENTO")).toBe("Mantenimiento");
    expect(normalizarArea("ADMINISTRACION")).toBe("Administración");
  });

  it("tolera espacios y minúsculas", () => {
    expect(normalizarArea("  logistica ")).toBe("Logística");
    expect(normalizarArea("Servicio Tecnico")).toBe("Servicio Técnico");
  });

  it("devuelve '' para desconocidos/vacíos (nunca inventa área)", () => {
    expect(normalizarArea("")).toBe("");
    expect(normalizarArea(null)).toBe("");
    expect(normalizarArea(undefined)).toBe("");
    expect(normalizarArea("VENTAS")).toBe("");
    expect(normalizarArea("Postventa")).toBe(""); // valor viejo de FC, ya no está en Ops
  });
});
