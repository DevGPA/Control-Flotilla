/**
 * Mapeo nube ↔ front del módulo de Accesorios. Las filas de DynamoDB traen los opcionales
 * como null y el económico puede venir con espacios; si la normalización falla, el registro
 * queda huérfano (no empata con el catálogo de flota y la unidad aparece "sin accesorios").
 */
import { describe, expect, it } from "vitest";
import {
  buildAccesorioDoc,
  buildAccesorioEntries,
  type AccesorioRow,
} from "../src/accesorios/mapEntry";
import type { CapturaAccesorioFields } from "../src/accesorios/types";

const HOY = "2026-09-02";
const AHORA = "2026-09-02T18:30:00.000Z";

function row(over: Partial<AccesorioRow> = {}): AccesorioRow {
  return {
    tenantId: "gpa",
    economicoId: "78",
    accesorioId: "bateria#AB1234",
    tipo: "bateria",
    marca: "LTH",
    numeroSerie: "AB1234",
    fechaCompra: "2026-03-15",
    costo: 3200,
    ...over,
  };
}

describe("buildAccesorioEntries", () => {
  it("mapea una fila cruda a entry con antigüedad derivada", () => {
    const out = buildAccesorioEntries([row()], HOY);
    expect(out).toHaveLength(1);
    expect(out[0]?.tipo).toBe("bateria");
    expect(out[0]?.antiguedadMeses).toBe(5);
  });

  it("los opcionales en null no se copian como null", () => {
    const out = buildAccesorioEntries(
      [row({ marca: null, numeroSerie: null, fechaCompra: null, costo: null, nota: null })],
      HOY,
    );
    expect(out[0]?.marca).toBeUndefined();
    expect(out[0]?.numeroSerie).toBeUndefined();
    expect(out[0]?.costo).toBeUndefined();
    expect(out[0]?.antiguedadMeses).toBeNull();
  });

  it("descarta filas sin identidad mínima", () => {
    expect(buildAccesorioEntries([row({ economicoId: null })], HOY)).toEqual([]);
    expect(buildAccesorioEntries([row({ accesorioId: "" })], HOY)).toEqual([]);
    expect(buildAccesorioEntries([row({ tipo: null })], HOY)).toEqual([]);
    expect(buildAccesorioEntries([row({ tenantId: null })], HOY)).toEqual([]);
  });

  it("descarta tipos que el front no conoce (dato de otra versión del esquema)", () => {
    expect(buildAccesorioEntries([row({ tipo: "llantas" })], HOY)).toEqual([]);
  });

  it("normaliza el económico con espacios para que empate el catálogo", () => {
    const unitsByEco = new Map([["78", { sucursal: "GDL", placa: "JV98698" }]]);
    const out = buildAccesorioEntries([row({ economicoId: "  78  " })], HOY, { unitsByEco });
    expect(out[0]?.economicoId).toBe("78");
    expect(out[0]?.sucursal).toBe("GDL");
    expect(out[0]?.placa).toBe("JV98698");
  });

  it("descarta costos negativos (dato corrupto), no los propaga al gasto", () => {
    expect(buildAccesorioEntries([row({ costo: -500 })], HOY)[0]?.costo).toBeUndefined();
  });
});

describe("buildAccesorioDoc", () => {
  function fields(over: Partial<CapturaAccesorioFields> = {}): CapturaAccesorioFields {
    return {
      economicoId: " 78 ",
      tipo: "bateria",
      marca: " LTH ",
      numeroSerie: " ab 1234 ",
      fechaCompra: "2026-03-15",
      costo: 3200,
      ...over,
    };
  }

  it("arma la llave de batería con la serie normalizada y recorta los textos", () => {
    const doc = buildAccesorioDoc("gpa", fields(), AHORA, "riesgos@gpa.com");
    expect(doc.economicoId).toBe("78");
    expect(doc.accesorioId).toBe("bateria#AB1234");
    expect(doc.numeroSerie).toBe("AB1234");
    expect(doc.marca).toBe("LTH");
    expect(doc.capturadoPor).toBe("riesgos@gpa.com");
    expect(doc.ultimaActualizacion).toBe(AHORA);
  });

  it("limpiabrisas: la llave es la fecha de compra y no guarda serie", () => {
    const doc = buildAccesorioDoc(
      "gpa",
      fields({ tipo: "limpiabrisas", marca: "Bosch", numeroSerie: "no-aplica" }),
      AHORA,
    );
    expect(doc.accesorioId).toBe("limpiabrisas#2026-03-15");
    expect(doc.numeroSerie).toBeUndefined();
  });

  it("no guarda costo cuando viene vacío o negativo", () => {
    expect(buildAccesorioDoc("gpa", fields({ costo: null }), AHORA).costo).toBeUndefined();
    expect(buildAccesorioDoc("gpa", fields({ costo: -1 }), AHORA).costo).toBeUndefined();
  });

  it("un costo de cero SÍ se guarda (accesorio en garantía, sin cargo)", () => {
    expect(buildAccesorioDoc("gpa", fields({ costo: 0 }), AHORA).costo).toBe(0);
  });

  it("omite la nota vacía", () => {
    expect(buildAccesorioDoc("gpa", fields({ nota: "   " }), AHORA).nota).toBeUndefined();
  });
});
