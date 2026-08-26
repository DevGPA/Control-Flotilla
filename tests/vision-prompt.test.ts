import { describe, expect, it } from "vitest";
import { buildVisionPrompt, ETIQUETA_FOTO, TOOL_LECTURA } from "../src/vision/prompt";

// El schema del tool es el contrato con Bedrock: strict + additionalProperties:false
// garantizan que la respuesta valida contra la forma que fusion.ts espera.
describe("TOOL_LECTURA: contrato de salida estructurada", () => {
  it("es strict y cierra additionalProperties en todos los niveles", () => {
    expect(TOOL_LECTURA.strict).toBe(true);
    const schema = TOOL_LECTURA.input_schema as {
      additionalProperties?: boolean;
      properties: Record<string, { additionalProperties?: boolean }>;
    };
    expect(schema.additionalProperties).toBe(false);
    for (const [nombre, sub] of Object.entries(schema.properties)) {
      if (nombre === "notas") continue; // string simple
      expect(sub.additionalProperties, nombre).toBe(false);
    }
  });

  it("cada evidencia declara estado ok|ilegible|no-corresponde — 'faltante' NO es del modelo", () => {
    const schema = TOOL_LECTURA.input_schema as {
      properties: Record<string, { properties?: Record<string, { enum?: string[] }> }>;
    };
    for (const ev of ["ticket", "bomba", "tanqueAntes", "tanqueDespues"]) {
      const estados = schema.properties[ev]?.properties?.estado?.enum;
      expect(estados, ev).toEqual(["ok", "ilegible", "no-corresponde"]);
    }
  });

  it("el nivel de tanque es un enum cerrado (vocabulario del drawer)", () => {
    const schema = TOOL_LECTURA.input_schema as {
      properties: Record<string, { properties?: Record<string, { enum?: unknown[] }> }>;
    };
    const niveles = schema.properties.tanqueDespues?.properties?.nivel?.enum;
    expect(niveles).toContain("lleno");
    expect(niveles).toContain("1/2");
    expect(niveles).toContain(null); // ilegible → null, jamás adivinar
  });
});

describe("buildVisionPrompt: la IA lee a ciegas y solo lo que sí llegó", () => {
  it("etiqueta únicamente las fotos presentes, en su orden", () => {
    const p = buildVisionPrompt(["fotoTicket", "fotoDespues"]);
    expect(p.texto).toContain(ETIQUETA_FOTO.fotoTicket);
    expect(p.texto).toContain(ETIQUETA_FOTO.fotoDespues);
    expect(p.texto).not.toContain(ETIQUETA_FOTO.fotoBomba);
    expect(p.texto).not.toContain(ETIQUETA_FOTO.fotoAntes);
  });

  it("prohíbe adivinar y NO contiene ningún valor capturado (lectura a ciegas)", () => {
    const p = buildVisionPrompt(["fotoTicket"]);
    expect(`${p.system} ${p.texto}`).toMatch(/no adivin|jamás adivin/i);
    // El builder ni siquiera acepta valores capturados como parámetro: el sesgo de
    // confirmación queda imposible por construcción (este test documenta la decisión).
    expect(buildVisionPrompt.length).toBe(1);
  });
});
