import { describe, expect, it } from "vitest";
import {
  parseNum,
  parseKm,
  normSucursal,
  normText,
  pickEco,
  pickResponsable,
  pickEconomicoId,
} from "../src/fuel/parse";

describe("parseNum", () => {
  it("parsea moneda formato US con miles y decimales", () => {
    expect(parseNum("$3,599.96")).toBe(3599.96);
    expect(parseNum("$27.00")).toBe(27);
    expect(parseNum("$473")).toBe(473);
  });

  it("acepta number nativo (litros)", () => {
    expect(parseNum(133.332)).toBe(133.332);
    expect(parseNum(43)).toBe(43);
  });

  it("devuelve undefined para vacío/no numérico/NaN/Infinity", () => {
    expect(parseNum("")).toBeUndefined();
    expect(parseNum(null)).toBeUndefined();
    expect(parseNum(undefined)).toBeUndefined();
    expect(parseNum("abc")).toBeUndefined();
    expect(parseNum("$")).toBeUndefined();
    expect(parseNum(NaN)).toBeUndefined();
    expect(parseNum(Infinity)).toBeUndefined();
  });
});

describe("parseKm", () => {
  it("redondea a entero", () => {
    expect(parseKm(2924.4)).toBe(2924);
    expect(parseKm(65070)).toBe(65070);
    expect(parseKm("128,540 km")).toBe(128540);
  });
  it("undefined si no hay número", () => {
    expect(parseKm("")).toBeUndefined();
    expect(parseKm(null)).toBeUndefined();
  });
});

describe("normText", () => {
  it("trim + sin acentos + minúsculas", () => {
    expect(normText("  Ciudad de México ")).toBe("ciudad de mexico");
    expect(normText("CANCÚN")).toBe("cancun");
  });
});

describe("normSucursal", () => {
  it("resuelve variantes al canónico (acentos, mayúsculas, espacios)", () => {
    expect(normSucursal("Cancún")).toBe("Cancun");
    expect(normSucursal("CANCUN ")).toBe("Cancun");
    expect(normSucursal("  cancun")).toBe("Cancun");
    expect(normSucursal("Ciudad de México")).toBe("Ciudad de Mexico");
    expect(normSucursal("Monterrey")).toBe("Monterrey");
    expect(normSucursal("guadalajara")).toBe("Guadalajara");
  });
  it("pasa el crudo (trim) si no está en el catálogo", () => {
    expect(normSucursal("Otra Sucursal")).toBe("Otra Sucursal");
    expect(normSucursal("  Tijuana  ")).toBe("Tijuana");
  });
  it("vacío → ''", () => {
    expect(normSucursal("")).toBe("");
    expect(normSucursal(null)).toBe("");
  });
});

describe("pickEco", () => {
  it("usa economico (solicitud) o search (carga)", () => {
    expect(pickEco({ economico: { id: "57", PLACAS: "G25NXP57" } })).toEqual({
      id: "57",
      PLACAS: "G25NXP57",
    });
    expect(pickEco({ search: { id: "77", PLACAS: "PP5516B" } })).toEqual({
      id: "77",
      PLACAS: "PP5516B",
    });
  });
  it("{} si no hay lookup", () => {
    expect(pickEco({})).toEqual({});
    expect(pickEco({ economico: null as unknown as object })).toEqual({});
  });
});

describe("pickResponsable", () => {
  it("extrae RESPONSABLE del registrador (solicitud) o de la carga", () => {
    expect(
      pickResponsable({
        nombreDelChoferQueRegistraDatos: { RESPONSABLE: "ADAME CABALLERO MISAEL" },
      }),
    ).toBe("ADAME CABALLERO MISAEL");
    expect(
      pickResponsable({ responsableDeCarga: { RESPONSABLE: "PALOMO CASTILLO JOSE MANUEL" } }),
    ).toBe("PALOMO CASTILLO JOSE MANUEL");
  });
  it("'' si falta", () => {
    expect(pickResponsable({})).toBe("");
  });
});

describe("pickEconomicoId", () => {
  it("usa eco.id cuando existe", () => {
    expect(pickEconomicoId({ id: "57", PLACAS: "G25NXP57" })).toEqual({
      economicoId: "57",
      faltante: false,
    });
  });
  it("cae a PLACA:<placas> y marca faltante si no hay id", () => {
    expect(pickEconomicoId({ PLACAS: "PP5516B" })).toEqual({
      economicoId: "PLACA:PP5516B",
      faltante: true,
    });
  });
  it("'' faltante si no hay ni id ni placa", () => {
    expect(pickEconomicoId({})).toEqual({ economicoId: "", faltante: true });
  });
});
