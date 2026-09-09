import { describe, it, expect } from "vitest";
import {
  placaVigente,
  normalizaPlaca,
  PLACAS_SUSTITUIDAS,
  PLACAS_MAL_CAPTURADAS,
} from "../src/fleet/placaVigente";

const TODAS = { ...PLACAS_SUSTITUIDAS, ...PLACAS_MAL_CAPTURADAS };

describe("placaVigente — identidad de unidad", () => {
  it("traduce la placa retirada a la vigente (las 11 unidades reemplazadas)", () => {
    expect(placaVigente("JV50090")).toBe("JB4255A"); // eco 21
    expect(placaVigente("JY38151")).toBe("KF2558A"); // eco 76
    expect(placaVigente("JU30222")).toBe("JB3943A"); // eco 12
    expect(Object.keys(PLACAS_SUSTITUIDAS)).toHaveLength(11);
  });

  it("corrige la placa mal capturada de la eco 75 (un '1' de mas)", () => {
    expect(placaVigente("JY138152")).toBe("JY38152");
    // normalizaPlaca NO puede: no es separador ni mayuscula, es un caracter de mas.
    expect(normalizaPlaca("JY138152")).toBe("JY138152");
  });

  it("es idempotente: una placa vigente se devuelve igual", () => {
    for (const vigente of Object.values(TODAS)) {
      expect(placaVigente(vigente)).toBe(vigente);
      expect(placaVigente(placaVigente(vigente))).toBe(vigente);
    }
  });

  it("no hay cadenas: ninguna placa vigente es a su vez una llave del mapa", () => {
    for (const vigente of Object.values(TODAS)) {
      expect(Object.keys(TODAS)).not.toContain(vigente);
    }
  });

  it("no hay dos unidades apuntando a la misma placa vigente", () => {
    const vigentes = Object.values(TODAS);
    expect(new Set(vigentes).size).toBe(vigentes.length);
  });

  it("las LLAVES del mapa ya estan en forma canonica", () => {
    // Si alguien agrega "JB-1234-A" como llave, placaVigente buscaria "JB1234A" y la
    // entrada seria un no-op silencioso. Esta prueba lo impide.
    for (const llave of Object.keys(TODAS)) {
      expect(normalizaPlaca(llave)).toBe(llave);
    }
  });

  it("unifica las variantes de captura de la MISMA placa", () => {
    expect(placaVigente("jb4255a")).toBe("JB4255A");
    expect(placaVigente("JB-4255-A")).toBe("JB4255A");
    expect(placaVigente("  JB4255A  ")).toBe("JB4255A");
    expect(placaVigente("jv-50090")).toBe("JB4255A"); // retirada Y mal capturada
  });

  it("conserva los numeros de serie de montacargas y remolques", () => {
    for (const serie of ["G25NXP58", "560XM", "H50FT", "F2A25", "58N612", "GP25N"]) {
      expect(placaVigente(serie)).toBe(serie);
    }
  });

  it("no truena con vacio, null ni undefined", () => {
    expect(placaVigente("")).toBe("");
    expect(placaVigente(null)).toBe("");
    expect(placaVigente(undefined)).toBe("");
    expect(normalizaPlaca(undefined)).toBe("");
  });

  it("un objeto NO es una placa (la ingesta manda {} cuando el campo va vacio)", () => {
    expect(placaVigente({})).toBe("");
    expect(placaVigente({ value: "JB4255A" })).toBe("");
    expect(placaVigente([])).toBe("");
    expect(normalizaPlaca({})).toBe("");
  });

  it("un marcador de puntuacion normaliza a vacio, no a una identidad", () => {
    for (const basura of ["—", "-", " - ", "  ", "/"]) {
      expect(placaVigente(basura)).toBe("");
    }
  });
});
