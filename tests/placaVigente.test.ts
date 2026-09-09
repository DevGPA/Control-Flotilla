import { describe, it, expect } from "vitest";
import {
  placaVigente,
  normalizaPlaca,
  esPlacaRetirada,
  PLACAS_SUSTITUIDAS,
} from "../src/fleet/placaVigente";

describe("placaVigente — identidad de unidad", () => {
  it("traduce la placa retirada a la vigente (las 11 unidades reemplazadas)", () => {
    expect(placaVigente("JV50090")).toBe("JB4255A"); // eco 21
    expect(placaVigente("JY38151")).toBe("KF2558A"); // eco 76
    expect(placaVigente("JU30222")).toBe("JB3943A"); // eco 12
    expect(Object.keys(PLACAS_SUSTITUIDAS)).toHaveLength(11);
  });

  it("es idempotente: una placa vigente se devuelve igual", () => {
    for (const vigente of Object.values(PLACAS_SUSTITUIDAS)) {
      expect(placaVigente(vigente)).toBe(vigente);
      expect(placaVigente(placaVigente(vigente))).toBe(vigente);
    }
  });

  it("ninguna placa vigente es a su vez una placa retirada (sin cadenas)", () => {
    for (const vigente of Object.values(PLACAS_SUSTITUIDAS)) {
      expect(esPlacaRetirada(vigente)).toBe(false);
    }
  });

  it("no hay dos unidades apuntando a la misma placa vigente", () => {
    const vigentes = Object.values(PLACAS_SUSTITUIDAS);
    expect(new Set(vigentes).size).toBe(vigentes.length);
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

  it("un objeto NO es una placa (MoreApp manda {} cuando el campo va vacio)", () => {
    expect(placaVigente({})).toBe("");
    expect(placaVigente({ value: "JB4255A" })).toBe("");
    expect(placaVigente([])).toBe("");
    expect(normalizaPlaca({})).toBe("");
  });

  it("esPlacaRetirada distingue retiradas de vigentes", () => {
    expect(esPlacaRetirada("JV50090")).toBe(true);
    expect(esPlacaRetirada("jv50090")).toBe(true);
    expect(esPlacaRetirada("JB4255A")).toBe(false);
    expect(esPlacaRetirada("")).toBe(false);
  });
});
