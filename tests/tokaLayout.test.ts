import { describe, expect, it } from "vitest";
import {
  buildTokaLayout,
  tokaLayoutToAoa,
  ecoKey,
  TOKA_HEADER,
  TOKA_ID_CLIENTE,
} from "../src/fuel/tokaLayout";
import type { FuelEntry } from "../src/fuel/types";

const DIESEL = "TOKA COMBUSTIBLE DIESEL CHIP";
const MAGNA = "TOKA COMBUSTIBLE MAGNA CHIP";
const GASLP = "TOKA COMBUSTIBLE GAS LP CHIP";

/** Solicitud mínima con montoEstimado (= "monto a cargar"). */
function sol(
  eco: string,
  montoEstimado: number,
  producto: string,
  over: Partial<FuelEntry> = {},
): FuelEntry {
  return {
    loadId: `${eco}|solicitud|${over.eventoId ?? montoEstimado}`,
    tipo: "solicitud",
    eco,
    eventoId: String(over.eventoId ?? montoEstimado),
    sucursal: "Guadalajara",
    fecha: "2026-06-01",
    montoEstimado,
    producto,
    photos: [],
    ...over,
  };
}

/** Carga (sin montoEstimado; trae montoTotal). No debe sumar al MONTO DESEADO. */
function carga(eco: string, producto: string, over: Partial<FuelEntry> = {}): FuelEntry {
  return {
    loadId: `${eco}|carga|${over.eventoId ?? "c"}`,
    tipo: "carga",
    eco,
    eventoId: String(over.eventoId ?? "c"),
    sucursal: "Guadalajara",
    fecha: "2026-06-02",
    monto: 1500,
    litros: 50,
    producto,
    photos: [],
    ...over,
  };
}

describe("ecoKey (clave canónica de económico)", () => {
  it("numérico puro sin ceros a la izquierda", () => {
    expect(ecoKey("06")).toBe("6");
    expect(ecoKey("44")).toBe("44");
    expect(ecoKey(" 02 ")).toBe("2");
  });
  it("no numérico → trim + mayúsculas", () => {
    expect(ecoKey("stock 1")).toBe("STOCK 1");
    expect(ecoKey("tr_72")).toBe("TR_72");
  });
  it("vacío/nulo → cadena vacía", () => {
    expect(ecoKey("")).toBe("");
    expect(ecoKey(null)).toBe("");
    expect(ecoKey(undefined)).toBe("");
  });
});

describe("buildTokaLayout — estructura Toka", () => {
  it("header y constante de cliente exactos", () => {
    expect([...TOKA_HEADER]).toEqual([
      "ID CLIENTE",
      "Nómina",
      "MONTO DESEADO",
      "Producto",
      "OBSERVACIONES",
    ]);
    expect(TOKA_ID_CLIENTE).toBe(20780);
    const r = buildTokaLayout([sol("6", 1000, DIESEL)]);
    expect(r.rows[0]).toEqual({
      idCliente: 20780,
      nomina: 6,
      montoDeseado: 1000,
      producto: DIESEL,
      observaciones: "",
    });
  });

  it("aoa = header + filas en orden exacto", () => {
    const r = buildTokaLayout([sol("6", 1000, DIESEL)]);
    const aoa = tokaLayoutToAoa(r);
    expect(aoa[0]).toEqual([...TOKA_HEADER]);
    expect(aoa[1]).toEqual([20780, 6, 1000, DIESEL, ""]);
  });
});

describe("buildTokaLayout — consolidación por unidad", () => {
  it("una fila por unidad; MONTO = suma del monto a cargar del período", () => {
    const r = buildTokaLayout([
      sol("6", 100, DIESEL, { eventoId: "a" }),
      sol("6", 200, DIESEL, { eventoId: "b" }),
      sol("6", 50, DIESEL, { eventoId: "c" }),
    ]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.nomina).toBe(6);
    expect(r.rows[0]!.montoDeseado).toBe(350);
    expect(r.totalUnidades).toBe(1);
    expect(r.totalMonto).toBe(350);
  });

  it("las cargas (montoTotal) NO suman al monto deseado", () => {
    const r = buildTokaLayout([sol("6", 800, DIESEL), carga("6", DIESEL)]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.montoDeseado).toBe(800); // 1500 de la carga no cuenta
  });
});

describe("buildTokaLayout — transformación de nómina", () => {
  it("strip de ceros a la izquierda: '06'→6, '02'→2, '59'→59", () => {
    const r = buildTokaLayout([sol("06", 1, DIESEL), sol("02", 1, DIESEL), sol("59", 1, DIESEL)]);
    expect(r.rows.map((x) => x.nomina)).toEqual([2, 6, 59]); // ordenado asc
  });

  it("nómina no numérica (STOCK) pasa tal cual + advertencia", () => {
    const r = buildTokaLayout([sol("STOCK 1", 500, MAGNA)]);
    expect(r.rows[0]!.nomina).toBe("STOCK 1");
    expect(r.warnings.some((w) => w.tipo === "nomina-no-numerica")).toBe(true);
  });
});

describe("buildTokaLayout — omisiones (skips)", () => {
  it("omite unidad sin monto a cargar (solo cargas)", () => {
    const r = buildTokaLayout([carga("6", DIESEL)]);
    expect(r.rows).toHaveLength(0);
    expect(r.skipped).toEqual([
      { eco: "6", montoDeseado: 0, producto: DIESEL, motivo: "monto-cero" },
    ]);
    expect(r.totalUnidades).toBe(1);
  });

  it("omite unidad sin producto", () => {
    const r = buildTokaLayout([sol("6", 500, "")]);
    expect(r.rows).toHaveLength(0);
    expect(r.skipped[0]!.motivo).toBe("producto-ausente");
  });

  it("omite producto fuera del catálogo Toka", () => {
    const r = buildTokaLayout([sol("6", 500, "GASOLINA NORMAL")]);
    expect(r.rows).toHaveLength(0);
    expect(r.skipped[0]!.motivo).toBe("producto-desconocido");
  });
});

describe("buildTokaLayout — casos borde", () => {
  it("conflicto de producto: elige el del registro de mayor monto + advierte", () => {
    const r = buildTokaLayout([
      sol("6", 100, MAGNA, { eventoId: "a" }),
      sol("6", 300, DIESEL, { eventoId: "b" }),
    ]);
    expect(r.rows[0]!.producto).toBe(DIESEL);
    expect(r.rows[0]!.montoDeseado).toBe(400);
    expect(r.warnings.some((w) => w.tipo === "producto-conflicto")).toBe(true);
  });

  it("montacargas (Gas LP) se incluye", () => {
    const r = buildTokaLayout([sol("52", 700, GASLP, { esMontacargas: true })]);
    expect(r.rows[0]!.producto).toBe(GASLP);
    expect(r.rows[0]!.nomina).toBe(52);
  });

  it("redondea a 2 decimales", () => {
    const r = buildTokaLayout([
      sol("6", 33.333, DIESEL, { eventoId: "a" }),
      sol("6", 11.111, DIESEL, { eventoId: "b" }),
    ]);
    expect(r.rows[0]!.montoDeseado).toBe(44.44);
  });

  it("input vacío → sin filas", () => {
    const r = buildTokaLayout([]);
    expect(r.rows).toHaveLength(0);
    expect(r.totalUnidades).toBe(0);
    expect(r.totalMonto).toBe(0);
  });

  it("override del catálogo manda sobre el producto de MoreApp", () => {
    const r = buildTokaLayout([sol("44", 500, DIESEL)], {
      productoOverride: new Map([["44", "EASYGAS DIESEL CHIP"]]),
    });
    expect(r.rows[0]!.producto).toBe("EASYGAS DIESEL CHIP");
    expect(r.rows[0]!.nomina).toBe(44);
  });

  it("override aplica pese al padding de ceros: carga '06' vs clave '6' (bug 🔴 corregido)", () => {
    const r = buildTokaLayout([sol("06", 500, DIESEL)], {
      productoOverride: new Map([["6", "EASYGAS DIESEL CHIP"]]),
    });
    expect(r.rows[0]!.producto).toBe("EASYGAS DIESEL CHIP");
    expect(r.rows[0]!.nomina).toBe(6);
  });

  it("override fuera del catálogo conocido → se usa pero advierte (no bloquea)", () => {
    const r = buildTokaLayout([sol("9", 500, DIESEL)], {
      productoOverride: new Map([["9", "EASYGAS MAGNA"]]), // sin "CHIP" → errata típica
    });
    expect(r.rows[0]!.producto).toBe("EASYGAS MAGNA");
    expect(r.warnings.some((w) => w.tipo === "producto-override-desconocido")).toBe(true);
  });

  it("override se usa tal cual aunque NO esté en el catálogo validado (variante nueva)", () => {
    const r = buildTokaLayout([sol("7", 300, "")], {
      productoOverride: new Map([["7", "EASYGAS PREMIUM CHIP"]]),
    });
    expect(r.rows).toHaveLength(1); // no se omite por producto-desconocido
    expect(r.rows[0]!.producto).toBe("EASYGAS PREMIUM CHIP");
  });

  it("override vacío/ausente → cae al producto de MoreApp", () => {
    const r = buildTokaLayout([sol("8", 300, MAGNA)], {
      productoOverride: new Map([["8", "   "]]),
    });
    expect(r.rows[0]!.producto).toBe(MAGNA);
  });

  it("orden de salida: numéricas por valor, luego strings A-Z", () => {
    const r = buildTokaLayout([
      sol("STOCK 2", 1, MAGNA),
      sol("10", 1, MAGNA),
      sol("2", 1, MAGNA),
      sol("STOCK 1", 1, MAGNA),
    ]);
    expect(r.rows.map((x) => x.nomina)).toEqual([2, 10, "STOCK 1", "STOCK 2"]);
  });
});
