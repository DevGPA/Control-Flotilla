/**
 * Llave natural, validación de captura y antigüedad del módulo de Accesorios.
 *
 * La llave es lo delicado: de ella depende que recapturar la MISMA batería actualice el
 * registro en vez de duplicarlo (mismo contrato que `docId` en Cumplimiento). Si la
 * normalización de la serie cambia, la unidad termina con dos filas de la misma batería.
 */
import { describe, expect, it } from "vitest";
import {
  buildAccesorioId,
  mesesDesde,
  normalizaSerie,
  validarCaptura,
} from "../src/accesorios/accesoriosAnalysis";
import type { CapturaAccesorioFields } from "../src/accesorios/types";

function captura(over: Partial<CapturaAccesorioFields> = {}): CapturaAccesorioFields {
  return {
    economicoId: "78",
    tipo: "bateria",
    marca: "LTH",
    numeroSerie: "AB-1234",
    fechaCompra: "2026-03-15",
    ...over,
  };
}

describe("normalizaSerie", () => {
  it("sube a mayúsculas y quita espacios internos", () => {
    expect(normalizaSerie(" ab 12 34 ")).toBe("AB1234");
  });

  it("quita el '#' — es el separador de la llave y la partiría", () => {
    expect(normalizaSerie("AB#12")).toBe("AB12");
  });

  it("devuelve cadena vacía para nulos", () => {
    expect(normalizaSerie(undefined)).toBe("");
    expect(normalizaSerie("   ")).toBe("");
  });
});

describe("buildAccesorioId", () => {
  it("batería: se identifica por número de serie", () => {
    expect(buildAccesorioId("bateria", { numeroSerie: "ab-1234", fechaCompra: "2026-03-15" })).toBe(
      "bateria#AB-1234",
    );
  });

  it("batería: la misma serie escrita distinto produce la MISMA llave (no duplica)", () => {
    const a = buildAccesorioId("bateria", { numeroSerie: "ab 1234", fechaCompra: "2026-03-15" });
    const b = buildAccesorioId("bateria", { numeroSerie: "AB1234", fechaCompra: "2026-08-01" });
    expect(a).toBe(b);
  });

  it("batería sin serie: cae a la fecha de compra", () => {
    expect(buildAccesorioId("bateria", { fechaCompra: "2026-03-15" })).toBe("bateria#2026-03-15");
  });

  it("limpiabrisas: se identifica por fecha de compra", () => {
    expect(buildAccesorioId("limpiabrisas", { marca: "Bosch", fechaCompra: "2026-03-15" })).toBe(
      "limpiabrisas#2026-03-15",
    );
  });

  it("sin serie ni fecha no hay identidad posible", () => {
    expect(buildAccesorioId("limpiabrisas", {})).toBe("");
    expect(buildAccesorioId("bateria", {})).toBe("");
  });
});

describe("validarCaptura", () => {
  it("acepta una captura completa de batería", () => {
    expect(validarCaptura(captura())).toEqual([]);
  });

  it("acepta limpiabrisas sin número de serie", () => {
    expect(
      validarCaptura(captura({ tipo: "limpiabrisas", marca: "Bosch", numeroSerie: undefined })),
    ).toEqual([]);
  });

  it("exige la unidad", () => {
    expect(validarCaptura(captura({ economicoId: "  " }))).toContain(
      "Indica el número de unidad (económico).",
    );
  });

  it("exige la marca en ambos accesorios", () => {
    expect(validarCaptura(captura({ marca: "" }))).toContain("La marca es obligatoria.");
    expect(validarCaptura(captura({ tipo: "limpiabrisas", marca: "" }))).toContain(
      "La marca es obligatoria.",
    );
  });

  it("exige la fecha de compra en ambos accesorios", () => {
    expect(validarCaptura(captura({ fechaCompra: "" }))).toContain(
      "La fecha de compra es obligatoria.",
    );
    expect(validarCaptura(captura({ tipo: "limpiabrisas", fechaCompra: "" }))).toContain(
      "La fecha de compra es obligatoria.",
    );
  });

  it("exige el número de serie SOLO en batería", () => {
    expect(validarCaptura(captura({ numeroSerie: "" }))).toContain(
      "El número de serie es obligatorio en la batería.",
    );
    expect(validarCaptura(captura({ tipo: "limpiabrisas", numeroSerie: "" }))).toEqual([]);
  });

  it("rechaza fechas con formato inválido", () => {
    expect(validarCaptura(captura({ fechaCompra: "15/03/2026" }))).toContain(
      "La fecha de compra debe ser una fecha válida (año-mes-día).",
    );
  });

  it("rechaza una fecha de compra futura contra el hoy inyectado", () => {
    expect(validarCaptura(captura({ fechaCompra: "2026-09-30" }), "2026-09-02")).toContain(
      "La fecha de compra no puede ser futura.",
    );
  });

  it("rechaza costos negativos", () => {
    expect(validarCaptura(captura({ costo: -1 }))).toContain("El costo no puede ser negativo.");
  });

  it("rechaza un tipo de accesorio desconocido", () => {
    expect(
      validarCaptura(captura({ tipo: "llantas" as unknown as CapturaAccesorioFields["tipo"] })),
    ).toContain("Tipo de accesorio no reconocido.");
  });
});

describe("mesesDesde", () => {
  it("cuenta meses cumplidos", () => {
    expect(mesesDesde("2026-03-15", "2026-09-02")).toBe(5);
    expect(mesesDesde("2026-03-15", "2026-09-15")).toBe(6);
  });

  it("cruza el año correctamente", () => {
    expect(mesesDesde("2024-09-02", "2026-09-02")).toBe(24);
  });

  it("el mismo día es cero, no uno", () => {
    expect(mesesDesde("2026-09-02", "2026-09-02")).toBe(0);
  });

  it("no usa la hora local: la fecha ISO se compara por componentes (sin off-by-one)", () => {
    // Con new Date("2026-03-01") + getMonth() local, un huso negativo devolvía febrero.
    expect(mesesDesde("2026-03-01", "2026-04-01")).toBe(1);
  });

  it("una fecha futura no da meses negativos", () => {
    expect(mesesDesde("2026-12-01", "2026-09-02")).toBe(0);
  });

  it("null si la fecha falta o es inválida", () => {
    expect(mesesDesde("", "2026-09-02")).toBeNull();
    expect(mesesDesde("no-es-fecha", "2026-09-02")).toBeNull();
  });
});
