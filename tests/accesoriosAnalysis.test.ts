/**
 * Rollup por unidad del módulo de Accesorios: qué batería/limpiabrisas trae HOY cada
 * unidad, su historial y el gasto acumulado. El "vigente" NO se persiste — se deriva de la
 * fecha de compra más reciente, para que no quede obsoleto con el tiempo.
 */
import { describe, expect, it } from "vitest";
import {
  buildKpisAccesorios,
  filterAndSortAccesorios,
  mergeConFlota,
  resumirPorUnidad,
  toAccesorioEntry,
} from "../src/accesorios/accesoriosAnalysis";
import type { AccesorioDoc } from "../src/accesorios/types";

const HOY = "2026-09-02";

function doc(over: Partial<AccesorioDoc> = {}): AccesorioDoc {
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

function entry(over: Partial<AccesorioDoc> = {}, info?: { placa?: string; sucursal?: string }) {
  return toAccesorioEntry(doc(over), HOY, info);
}

describe("toAccesorioEntry", () => {
  it("deriva la antigüedad en meses y arrastra placa/sucursal de la unidad", () => {
    const e = entry({}, { placa: "JV98698", sucursal: "GDL" });
    expect(e.antiguedadMeses).toBe(5);
    expect(e.placa).toBe("JV98698");
    expect(e.sucursal).toBe("GDL");
  });

  it("antigüedad null cuando no hay fecha de compra", () => {
    expect(entry({ fechaCompra: undefined }).antiguedadMeses).toBeNull();
  });
});

describe("resumirPorUnidad", () => {
  it("el vigente de cada tipo es el de fecha de compra más reciente", () => {
    const unidades = resumirPorUnidad([
      entry({ accesorioId: "bateria#VIEJA", numeroSerie: "VIEJA", fechaCompra: "2024-01-10" }),
      entry({ accesorioId: "bateria#NUEVA", numeroSerie: "NUEVA", fechaCompra: "2026-03-15" }),
      entry({
        accesorioId: "limpiabrisas#2026-08-01",
        tipo: "limpiabrisas",
        marca: "Bosch",
        numeroSerie: undefined,
        fechaCompra: "2026-08-01",
        costo: 480,
      }),
    ]);
    expect(unidades).toHaveLength(1);
    const u = unidades[0]!;
    expect(u.vigentes.bateria?.numeroSerie).toBe("NUEVA");
    expect(u.vigentes.limpiabrisas?.marca).toBe("Bosch");
    expect(u.cambios).toBe(3);
    expect(u.gastoTotal).toBe(3200 + 3200 + 480);
  });

  it("el historial va del cambio más reciente al más viejo", () => {
    const u = resumirPorUnidad([
      entry({ accesorioId: "bateria#A", numeroSerie: "A", fechaCompra: "2024-01-10" }),
      entry({ accesorioId: "bateria#C", numeroSerie: "C", fechaCompra: "2026-03-15" }),
      entry({ accesorioId: "bateria#B", numeroSerie: "B", fechaCompra: "2025-05-01" }),
    ])[0]!;
    expect(u.historial.map((h) => h.numeroSerie)).toEqual(["C", "B", "A"]);
  });

  it("empate de fecha de compra: gana el capturado más recientemente", () => {
    const u = resumirPorUnidad([
      entry({
        accesorioId: "bateria#A",
        numeroSerie: "A",
        ultimaActualizacion: "2026-03-16T10:00:00.000Z",
      }),
      entry({
        accesorioId: "bateria#B",
        numeroSerie: "B",
        ultimaActualizacion: "2026-03-17T10:00:00.000Z",
      }),
    ])[0]!;
    expect(u.vigentes.bateria?.numeroSerie).toBe("B");
  });

  it("un registro sin fecha de compra no desplaza a uno que sí la tiene", () => {
    const u = resumirPorUnidad([
      entry({ accesorioId: "bateria#CON", numeroSerie: "CON", fechaCompra: "2025-01-01" }),
      entry({ accesorioId: "bateria#SIN", numeroSerie: "SIN", fechaCompra: undefined }),
    ])[0]!;
    expect(u.vigentes.bateria?.numeroSerie).toBe("CON");
  });

  it("separa unidades distintas y hereda placa/sucursal del registro que la traiga", () => {
    const unidades = resumirPorUnidad([
      entry({ economicoId: "78" }, { placa: "JV98698", sucursal: "GDL" }),
      entry(
        { economicoId: "104", accesorioId: "bateria#Z", numeroSerie: "Z" },
        { sucursal: "MTY" },
      ),
    ]);
    expect(unidades.map((u) => u.economicoId)).toEqual(["78", "104"]);
    expect(unidades[0]?.sucursal).toBe("GDL");
    expect(unidades[1]?.sucursal).toBe("MTY");
  });

  it("costos ausentes cuentan como cero en el gasto acumulado", () => {
    const u = resumirPorUnidad([entry({ costo: undefined })])[0]!;
    expect(u.gastoTotal).toBe(0);
  });
});

describe("mergeConFlota", () => {
  const catalogo = [
    { eco: "78", placa: "JV98698", sucursal: "GDL" },
    { eco: "104", placa: "JW11111", sucursal: "MTY" },
  ];

  it("incluye unidades de la flota SIN accesorios capturados", () => {
    const out = mergeConFlota(resumirPorUnidad([entry({ economicoId: "78" })]), catalogo);
    expect(out.map((u) => u.economicoId)).toEqual(["78", "104"]);
    const sinRegistro = out.find((u) => u.economicoId === "104")!;
    expect(sinRegistro.cambios).toBe(0);
    expect(sinRegistro.vigentes.bateria).toBeUndefined();
    expect(sinRegistro.placa).toBe("JW11111");
  });

  it("completa placa/sucursal desde el catálogo cuando el registro no las trae", () => {
    const out = mergeConFlota(resumirPorUnidad([entry({ economicoId: "78" })]), catalogo);
    expect(out[0]?.placa).toBe("JV98698");
    expect(out[0]?.sucursal).toBe("GDL");
  });

  it("no pierde registros de unidades que ya no están en el catálogo", () => {
    const out = mergeConFlota(resumirPorUnidad([entry({ economicoId: "999" })]), catalogo);
    expect(out.map((u) => u.economicoId)).toContain("999");
  });

  it("ignora ecos duplicados del catálogo", () => {
    const out = mergeConFlota([], [...catalogo, { eco: "78" }]);
    expect(out.filter((u) => u.economicoId === "78")).toHaveLength(1);
  });
});

describe("filterAndSortAccesorios", () => {
  const unidades = mergeConFlota(
    resumirPorUnidad([
      entry({ economicoId: "78" }, { placa: "JV98698", sucursal: "GDL" }),
      entry(
        {
          economicoId: "9",
          accesorioId: "limpiabrisas#2026-08-01",
          tipo: "limpiabrisas",
          marca: "Bosch",
          numeroSerie: undefined,
          fechaCompra: "2026-08-01",
          costo: 480,
        },
        { placa: "JX22222", sucursal: "MTY" },
      ),
    ]),
    [
      { eco: "78", placa: "JV98698", sucursal: "GDL" },
      { eco: "9", placa: "JX22222", sucursal: "MTY" },
      { eco: "104", placa: "JW11111", sucursal: "GDL" },
    ],
  );
  const TODO = { vista: "all" as const, sucursal: "", search: "" };

  it("ordena por económico numéricamente, no como texto", () => {
    const out = filterAndSortAccesorios(unidades, TODO, "eco", 1);
    expect(out.map((u) => u.economicoId)).toEqual(["9", "78", "104"]);
  });

  it("filtra por sucursal", () => {
    const out = filterAndSortAccesorios(unidades, { ...TODO, sucursal: "GDL" }, "eco", 1);
    expect(out.map((u) => u.economicoId)).toEqual(["78", "104"]);
  });

  it("vista conRegistro deja fuera a las unidades sin captura", () => {
    const out = filterAndSortAccesorios(unidades, { ...TODO, vista: "conRegistro" }, "eco", 1);
    expect(out.map((u) => u.economicoId)).toEqual(["9", "78"]);
  });

  it("vista sinBateria responde a quién falta capturar", () => {
    const out = filterAndSortAccesorios(unidades, { ...TODO, vista: "sinBateria" }, "eco", 1);
    expect(out.map((u) => u.economicoId)).toEqual(["9", "104"]);
  });

  it("vista sinLimpiabrisas hace lo propio", () => {
    const out = filterAndSortAccesorios(unidades, { ...TODO, vista: "sinLimpiabrisas" }, "eco", 1);
    expect(out.map((u) => u.economicoId)).toEqual(["78", "104"]);
  });

  it("busca por placa, marca y número de serie, sin importar mayúsculas", () => {
    const porPlaca = filterAndSortAccesorios(unidades, { ...TODO, search: "jv986" }, "eco", 1);
    expect(porPlaca.map((u) => u.economicoId)).toEqual(["78"]);
    const porMarca = filterAndSortAccesorios(unidades, { ...TODO, search: "bosch" }, "eco", 1);
    expect(porMarca.map((u) => u.economicoId)).toEqual(["9"]);
    const porSerie = filterAndSortAccesorios(unidades, { ...TODO, search: "ab1234" }, "eco", 1);
    expect(porSerie.map((u) => u.economicoId)).toEqual(["78"]);
  });

  it("búsqueda de solo dígitos = económico exacto (9 no matchea 104 ni 78)", () => {
    const out = filterAndSortAccesorios(unidades, { ...TODO, search: "9" }, "eco", 1);
    expect(out.map((u) => u.economicoId)).toEqual(["9"]);
  });

  it("ordena por gasto descendente", () => {
    const out = filterAndSortAccesorios(unidades, TODO, "gasto", -1);
    expect(out[0]?.economicoId).toBe("78");
  });

  it("ordena por antigüedad de la batería y deja al final a las unidades sin batería", () => {
    const out = filterAndSortAccesorios(unidades, TODO, "bateria", -1);
    expect(out[0]?.economicoId).toBe("78");
    expect(out.at(-1)?.vigentes.bateria).toBeUndefined();
  });

  it("no muta el arreglo recibido", () => {
    const antes = unidades.map((u) => u.economicoId);
    filterAndSortAccesorios(unidades, TODO, "gasto", -1);
    expect(unidades.map((u) => u.economicoId)).toEqual(antes);
  });
});

describe("buildKpisAccesorios", () => {
  it("cuenta cobertura, cambios y gasto sobre las unidades filtradas", () => {
    const unidades = mergeConFlota(
      resumirPorUnidad([
        entry({ economicoId: "78" }),
        entry({
          economicoId: "78",
          accesorioId: "limpiabrisas#2026-08-01",
          tipo: "limpiabrisas",
          numeroSerie: undefined,
          fechaCompra: "2026-08-01",
          costo: 480,
        }),
      ]),
      [{ eco: "78" }, { eco: "104" }],
    );
    const k = buildKpisAccesorios(unidades);
    expect(k.unidades).toBe(2);
    expect(k.conBateria).toBe(1);
    expect(k.conLimpiabrisas).toBe(1);
    expect(k.sinRegistro).toBe(1);
    expect(k.cambios).toBe(2);
    expect(k.gastoTotal).toBe(3680);
  });

  it("flota vacía no revienta", () => {
    const k = buildKpisAccesorios([]);
    expect(k).toEqual({
      unidades: 0,
      conBateria: 0,
      conLimpiabrisas: 0,
      sinRegistro: 0,
      cambios: 0,
      gastoTotal: 0,
    });
  });
});
