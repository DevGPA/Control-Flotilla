import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLUMNAS_PARTIDAS, filasPartidas, type ContextoExport } from "../src/taller/exportExcel";
import { buildActivasWorkbook, buildHistorialWorkbook } from "../src/taller/tallerExcel";
import type { Partida } from "../src/taller/partidas";
import type { TallerEntry } from "../src/taller/types";

/**
 * Hoja "Partidas" del Excel de Taller (Task 9): el ciclo de firma completo de cada
 * partida —qué se propuso, qué se autorizó, quién decidió y por qué se rechazó—
 * sale como una fila propia, en las DOS hojas donde antes solo salía el agregado
 * por visita ("Activas en Taller" e Historial → "Detalle").
 *
 * Por qué una hoja propia y no una columna más: una visita puede traer varias
 * partidas, y "Detalle"/"Activas" son una fila por visita. Canceladas y borradores
 * se exportan igual (etiquetadas) — ocultarlas borraría el rastro de qué se
 * propuso y no llegó a autorizarse.
 */

const HOY = new Date("2026-09-17T12:00:00Z");

const FILA_HEADER = 4; // título, subtítulo, separador, encabezado — igual que las demás hojas

const TITULOS_ESPERADOS = [
  "Unidad",
  "Placa",
  "Ingreso",
  "Descripción",
  "Tipo",
  "Precio propuesto",
  "Estado",
  "Precio autorizado",
  "Decidido por",
  "Decidido el",
  "Motivo de rechazo",
  "Nota",
  "Origen",
  "Fotos",
];

const entry = (over: Partial<TallerEntry> = {}): TallerEntry => ({
  id: "t1",
  estado: "En Reparación",
  eco: "54",
  plate: "ABC-123",
  fentrada: "2026-09-01",
  ...over,
});

const partida = (over: Partial<Partida> = {}): Partida => ({
  partidaId: "p1",
  visitaKey: "54|2026-09-01",
  descripcion: "Balatas delanteras",
  estado: "autorizada",
  fotos: [],
  ...over,
});

describe("estructura — la hoja Partidas existe en los dos libros", () => {
  it("tallerExcel.ts agrega la hoja Partidas en las dos construcciones de libro", () => {
    const src = readFileSync(join(__dirname, "..", "src", "taller", "tallerExcel.ts"), "utf8");
    const ocurrencias = src.match(/addWorksheet\("Partidas"\)/g) ?? [];
    expect(ocurrencias).toHaveLength(2);
  });

  it("exportExcel.ts trae los 14 encabezados exactos y etiqueta las canceladas", () => {
    const src = readFileSync(join(__dirname, "..", "src", "taller", "exportExcel.ts"), "utf8");
    for (const h of TITULOS_ESPERADOS) {
      expect(src, `falta el encabezado ${h}`).toContain(`"${h}"`);
    }
    expect(src).toContain("cancelada");
  });
});

describe("COLUMNAS_PARTIDAS / filasPartidas — capa pura", () => {
  it("son exactamente 14 columnas, en el orden esperado", () => {
    expect(COLUMNAS_PARTIDAS.map((c) => c.titulo)).toEqual(TITULOS_ESPERADOS);
  });

  it("toda columna define título y ancho razonable", () => {
    for (const c of COLUMNAS_PARTIDAS) {
      expect(c.titulo.length, JSON.stringify(c)).toBeGreaterThan(0);
      expect(c.ancho, c.titulo).toBeGreaterThan(3);
    }
  });

  it("una fila por partida, en dos visitas distintas", () => {
    const e1 = entry({ eco: "54" });
    const e2 = entry({ eco: "12", id: "t2" });
    const ps1 = [partida({ partidaId: "a" }), partida({ partidaId: "b" })];
    const ps2 = [partida({ partidaId: "c" })];
    const ctx: ContextoExport = {
      hoy: HOY,
      partidasDe: (e) => (e.eco === "54" ? ps1 : e.eco === "12" ? ps2 : undefined),
    };
    const filas = filasPartidas([e1, e2], ctx);
    expect(filas).toHaveLength(3);
  });

  it("sin partidasDe, o con partidasDe que devuelve [], no hay filas", () => {
    expect(filasPartidas([entry()], { hoy: HOY })).toEqual([]);
    expect(filasPartidas([entry()], { hoy: HOY, partidasDe: () => [] })).toEqual([]);
    expect(filasPartidas([entry()], { hoy: HOY, partidasDe: () => undefined })).toEqual([]);
  });

  it("una partida cancelada se exporta etiquetada, no se oculta", () => {
    const ctx: ContextoExport = { hoy: HOY, partidasDe: () => [partida({ estado: "cancelada" })] };
    const [fila] = filasPartidas([entry()], ctx);
    const i = COLUMNAS_PARTIDAS.findIndex((c) => c.titulo === "Estado");
    expect(fila![i]).toBe("Cancelada");
  });

  it("un borrador también se exporta (etiquetado, no oculto)", () => {
    const ctx: ContextoExport = { hoy: HOY, partidasDe: () => [partida({ estado: "borrador" })] };
    const [fila] = filasPartidas([entry()], ctx);
    const i = COLUMNAS_PARTIDAS.findIndex((c) => c.titulo === "Estado");
    expect(fila![i]).toBe("Borrador");
  });

  it("Origen: Taller cuando creadoPor empieza con liga:, GPA en cualquier otro caso", () => {
    const iOrigen = COLUMNAS_PARTIDAS.findIndex((c) => c.titulo === "Origen");
    const conLiga = filasPartidas([entry()], {
      hoy: HOY,
      partidasDe: () => [partida({ creadoPor: "liga:abc123" })],
    })[0]!;
    const conUsuario = filasPartidas([entry()], {
      hoy: HOY,
      partidasDe: () => [partida({ creadoPor: "user:navares" })],
    })[0]!;
    const sinCreador = filasPartidas([entry()], { hoy: HOY, partidasDe: () => [partida({})] })[0]!;
    expect(conLiga[iOrigen]).toBe("Taller");
    expect(conUsuario[iOrigen]).toBe("GPA");
    expect(sinCreador[iOrigen]).toBe("GPA");
  });

  it("Fotos = cantidad de fotos de la partida", () => {
    const iFotos = COLUMNAS_PARTIDAS.findIndex((c) => c.titulo === "Fotos");
    const [fila] = filasPartidas([entry()], {
      hoy: HOY,
      partidasDe: () => [partida({ fotos: ["a.jpg", "b.jpg", "c.jpg"] })],
    });
    expect(fila![iFotos]).toBe(3);
  });

  it("Ingreso y Decidido el salen como Date; sin fecha o inválida, salen como ''", () => {
    const iIngreso = COLUMNAS_PARTIDAS.findIndex((c) => c.titulo === "Ingreso");
    const iDecididoEl = COLUMNAS_PARTIDAS.findIndex((c) => c.titulo === "Decidido el");
    const [conFechas] = filasPartidas([entry({ fentrada: "2026-08-01" })], {
      hoy: HOY,
      partidasDe: () => [partida({ decididoEn: "2026-08-05" })],
    });
    expect(conFechas![iIngreso]).toBeInstanceOf(Date);
    expect(conFechas![iDecididoEl]).toBeInstanceOf(Date);

    const [sinFechas] = filasPartidas([entry({ fentrada: undefined })], {
      hoy: HOY,
      partidasDe: () => [partida({ decididoEn: undefined })],
    });
    expect(sinFechas![iIngreso]).toBe("");
    expect(sinFechas![iDecididoEl]).toBe("");
  });

  it("Precio propuesto / Precio autorizado: number con formato $, '' sin precio, 0 finito se exporta como 0", () => {
    const iProp = COLUMNAS_PARTIDAS.findIndex((c) => c.titulo === "Precio propuesto");
    const iAut = COLUMNAS_PARTIDAS.findIndex((c) => c.titulo === "Precio autorizado");
    expect(COLUMNAS_PARTIDAS[iProp]!.formato).toContain("$");
    expect(COLUMNAS_PARTIDAS[iAut]!.formato).toContain("$");

    const [conPrecio] = filasPartidas([entry()], {
      hoy: HOY,
      partidasDe: () => [partida({ precio: 1500, precioAutorizado: 1200 })],
    });
    expect(conPrecio![iProp]).toBe(1500);
    expect(conPrecio![iAut]).toBe(1200);

    const [sinPrecio] = filasPartidas([entry()], {
      hoy: HOY,
      partidasDe: () => [partida({ precio: undefined, precioAutorizado: undefined })],
    });
    expect(sinPrecio![iProp]).toBe("");
    expect(sinPrecio![iAut]).toBe("");

    const [precioCero] = filasPartidas([entry()], {
      hoy: HOY,
      partidasDe: () => [partida({ precio: 0, precioAutorizado: 0 })],
    });
    expect(precioCero![iProp]).toBe(0);
    expect(precioCero![iAut]).toBe(0);
  });

  it("Tipo: Refacción / Mano de obra / vacío", () => {
    const iTipo = COLUMNAS_PARTIDAS.findIndex((c) => c.titulo === "Tipo");
    const ctxDe = (tipo: Partida["tipo"]) => ({
      hoy: HOY,
      partidasDe: () => [partida({ tipo })],
    });
    expect(filasPartidas([entry()], ctxDe("refaccion"))[0]![iTipo]).toBe("Refacción");
    expect(filasPartidas([entry()], ctxDe("manoObra"))[0]![iTipo]).toBe("Mano de obra");
    expect(filasPartidas([entry()], ctxDe(undefined))[0]![iTipo]).toBe("");
  });
});

describe("workbook — hoja Partidas en Activas e Historial", () => {
  const ctx = (partidas: Partida[]): ContextoExport => ({ hoy: HOY, partidasDe: () => partidas });

  it("buildActivasWorkbook: la hoja Partidas existe, encabezado correcto, congelada, una fila por partida", async () => {
    const ps = [partida({ partidaId: "a" }), partida({ partidaId: "b", estado: "rechazada" })];
    const wb = await buildActivasWorkbook([entry()], ctx(ps));
    const ws = wb.getWorksheet("Partidas")!;
    expect(ws).toBeTruthy();
    expect(ws.views?.[0]).toMatchObject({ state: "frozen", ySplit: FILA_HEADER });
    const fila = ws.getRow(FILA_HEADER);
    TITULOS_ESPERADOS.forEach((t, i) => expect(fila.getCell(i + 1).value, `col ${i + 1}`).toBe(t));
    expect(ws.getRow(FILA_HEADER + 1).getCell(1).value).toBe("54");
    expect(ws.getRow(FILA_HEADER + 2).getCell(1).value).toBe("54");
    expect(ws.getRow(FILA_HEADER + 3).getCell(1).value).toBeNull(); // solo 2 filas
  });

  it("buildHistorialWorkbook: la hoja Partidas existe con las partidas de las visitas cerradas", async () => {
    const cerrada = entry({ estado: "Finalizado", eco: "77" });
    const ps = [partida({ partidaId: "z", precio: 900, precioAutorizado: 900 })];
    const wb = await buildHistorialWorkbook([cerrada], ctx(ps));
    const ws = wb.getWorksheet("Partidas")!;
    expect(ws).toBeTruthy();
    expect(ws.getRow(FILA_HEADER + 1).getCell(1).value).toBe("77");
  });

  it("sin partidasDe, las dos hojas Partidas existen igual (solo encabezados, T9-2)", async () => {
    const sinCtx: ContextoExport = { hoy: HOY };
    const wbActivas = await buildActivasWorkbook([entry()], sinCtx);
    const wsActivas = wbActivas.getWorksheet("Partidas")!;
    expect(wsActivas).toBeTruthy();
    expect(wsActivas.getRow(FILA_HEADER + 1).getCell(1).value).toBeNull();

    const wbHistorial = await buildHistorialWorkbook([entry({ estado: "Finalizado" })], sinCtx);
    const wsHistorial = wbHistorial.getWorksheet("Partidas")!;
    expect(wsHistorial).toBeTruthy();
    expect(wsHistorial.getRow(FILA_HEADER + 1).getCell(1).value).toBeNull();
  });
});
