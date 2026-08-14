import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAMPOS_OMITIDOS,
  COLUMNAS_TALLER,
  COLUMNAS_RESUMEN,
  filasDe,
  gastoTotalDe,
  diasEnTaller,
} from "../src/taller/exportExcel";
import type { TallerEntry } from "../src/taller/types";

/**
 * Exportación a Excel del módulo Taller.
 *
 * Lo que faltaba antes (auditado contra `TallerEntry`): la hoja de Activas no llevaba
 * `fsalidaReal` ni `fcierre` ni el id/unitKey ni las marcas de tiempo; la hoja de Detalle del
 * historial ADEMÁS se comía `refacciones` y `freporte` — o sea que el historial no decía qué
 * refacciones se usaron, que es media razón de existir de un historial de taller.
 *
 * El guard importante es "cobertura": si alguien agrega un campo a `TallerEntry` y no lo
 * exporta, el primer test falla. Sin eso, este arreglo se vuelve a degradar en tres meses.
 */
const HOY = new Date("2026-08-14T12:00:00Z");

const entry = (over: Partial<TallerEntry> = {}): TallerEntry => ({
  id: "t1",
  estado: "En Reparación",
  ...over,
});

describe("cobertura — ningún campo del modelo se queda fuera", () => {
  /** Nombres de los campos de `TallerEntry`, leídos del propio archivo de tipos. */
  const camposDelModelo = (): string[] => {
    const src = readFileSync(join(__dirname, "..", "src", "taller", "types.ts"), "utf8");
    const bloque = /export type TallerEntry = \{([\s\S]*?)\n\};/.exec(src)?.[1];
    if (!bloque) throw new Error("No se encontró el tipo TallerEntry");
    return [...bloque.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]!);
  };

  it("cada campo está exportado o declarado como omitido, con su razón", () => {
    const campos = camposDelModelo();
    expect(campos.length).toBeGreaterThan(15); // sanidad del parser
    const exportados = new Set(COLUMNAS_TALLER.map((c) => c.campo));
    const sinCubrir = campos.filter((f) => !exportados.has(f) && !(f in CAMPOS_OMITIDOS));
    expect(sinCubrir, `campos sin exportar ni justificar: ${sinCubrir.join(", ")}`).toEqual([]);
  });

  it("los omitidos traen una razón escrita (no una lista vacía de excusas)", () => {
    for (const [campo, razon] of Object.entries(CAMPOS_OMITIDOS)) {
      expect(razon.length, campo).toBeGreaterThan(20);
    }
  });

  it("no declara omitido un campo que sí se exporta (contradicción)", () => {
    const exportados = new Set(COLUMNAS_TALLER.map((c) => c.campo));
    for (const campo of Object.keys(CAMPOS_OMITIDOS)) expect(exportados.has(campo)).toBe(false);
  });
});

describe("formato — Excel tiene que poder ordenar y sumar", () => {
  it("toda columna define título y ancho", () => {
    for (const c of [...COLUMNAS_TALLER, ...COLUMNAS_RESUMEN]) {
      expect(c.titulo.length, JSON.stringify(c)).toBeGreaterThan(0);
      expect(c.ancho, c.titulo).toBeGreaterThan(3);
    }
  });

  // Antes las fechas salían como texto ("14/08/2026") y Excel no las ordenaba: al filtrar
  // por rango o ordenar por entrada, el resultado era el orden alfabético del string.
  it("las fechas salen como Date, no como texto", () => {
    const [fila] = filasDe([entry({ fentrada: "2026-08-01" })], COLUMNAS_TALLER, { hoy: HOY });
    const i = COLUMNAS_TALLER.findIndex((c) => c.campo === "fentrada");
    expect(fila![i]).toBeInstanceOf(Date);
  });

  it("las columnas de fecha traen formato de fecha de Excel", () => {
    for (const c of COLUMNAS_TALLER.filter((c) => c.campo.startsWith("f") && c.campo !== "fcierre"))
      if (c.tipo === "fecha") expect(c.formato, c.titulo).toMatch(/d|m|y/);
  });

  it("los montos salen numéricos y con formato de moneda", () => {
    const [fila] = filasDe([entry({ gastoRef: 1234.5 })], COLUMNAS_TALLER, { hoy: HOY });
    const i = COLUMNAS_TALLER.findIndex((c) => c.campo === "gastoRef");
    expect(typeof fila![i]).toBe("number");
    expect(COLUMNAS_TALLER[i]!.formato).toContain("$");
  });

  it("una fecha inválida o ausente no rompe ni escribe 'Invalid Date'", () => {
    const [fila] = filasDe([entry({ fentrada: "no-es-fecha", fsalidaReal: undefined })], COLUMNAS_TALLER, { hoy: HOY });
    const iE = COLUMNAS_TALLER.findIndex((c) => c.campo === "fentrada");
    const iS = COLUMNAS_TALLER.findIndex((c) => c.campo === "fsalidaReal");
    expect(fila![iE]).toBe("");
    expect(fila![iS]).toBe("");
  });

  it("un campo de texto ausente sale vacío, nunca 'undefined'", () => {
    const [fila] = filasDe([entry()], COLUMNAS_TALLER, { hoy: HOY });
    expect(fila!.some((v) => String(v).includes("undefined"))).toBe(false);
  });
});

describe("gastoTotalDe — el desglose manda, el legacy es respaldo", () => {
  it("suma refacciones + mano de obra cuando hay desglose", () => {
    expect(gastoTotalDe(entry({ gastoRef: 100, gastoMO: 50 }))).toBe(150);
  });

  // Registros anteriores al desglose: sin este respaldo el total salía en $0 (audit 2026-06-04).
  it("cae al campo legacy `gasto` cuando no hay desglose", () => {
    expect(gastoTotalDe(entry({ gasto: 700 }))).toBe(700);
  });

  it("el desglose gana sobre el legacy si ambos existen", () => {
    expect(gastoTotalDe(entry({ gastoRef: 100, gastoMO: 50, gasto: 999 }))).toBe(150);
  });

  it("sin ningún gasto devuelve 0", () => {
    expect(gastoTotalDe(entry())).toBe(0);
  });
});

describe("diasEnTaller", () => {
  it("cuenta desde la entrada hasta hoy si sigue abierta", () => {
    expect(diasEnTaller(entry({ fentrada: "2026-08-01" }), HOY)).toBe(13);
  });

  it("cuenta hasta la salida real si ya salió", () => {
    expect(diasEnTaller(entry({ fentrada: "2026-08-01", fsalidaReal: "2026-08-05" }), HOY)).toBe(4);
  });

  it("sin fecha de entrada no inventa un número", () => {
    expect(diasEnTaller(entry(), HOY)).toBe("");
  });

  it("nunca devuelve negativo aunque las fechas vengan al revés", () => {
    expect(diasEnTaller(entry({ fentrada: "2026-08-10", fsalidaReal: "2026-08-01" }), HOY)).toBe(0);
  });
});

describe("filasDe", () => {
  it("respeta el orden de las columnas y produce una fila por entry", () => {
    const filas = filasDe([entry({ eco: "54" }), entry({ eco: "12" })], COLUMNAS_TALLER, { hoy: HOY });
    expect(filas).toHaveLength(2);
    const i = COLUMNAS_TALLER.findIndex((c) => c.campo === "eco");
    expect(filas.map((f) => f[i])).toEqual(["54", "12"]);
  });

  it("lista vacía → sin filas (el llamador decide si avisa)", () => {
    expect(filasDe([], COLUMNAS_TALLER, { hoy: HOY })).toEqual([]);
  });
});
