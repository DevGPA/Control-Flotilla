import { describe, expect, it } from "vitest";
import type ExcelJS from "exceljs";
import {
  buildActivasWorkbook,
  buildHistorialWorkbook,
  resumenPorUnidad,
} from "../src/taller/tallerExcel";
import { COLUMNAS_TALLER, COLUMNAS_RESUMEN } from "../src/taller/exportExcel";
import type { TallerEntry } from "../src/taller/types";

/**
 * Formato PROFESIONAL del Excel de Taller, con ExcelJS — la MISMA librería y el mismo
 * lenguaje visual que el export "Solicitudes (Excel)" de Combustible (título con fondo
 * teal, encabezado en negritas CONGELADO, autofiltro, zebra, formatos de moneda/fecha y
 * fila TOTAL con fórmula SUM viva).
 *
 * Por qué existe: el primer arreglo (PR #8) completó los CAMPOS pero se quedó con la
 * edición community de `xlsx`, que no escribe estilos — y el usuario señaló, con razón,
 * que Solicitudes SÍ sale con formato. La respuesta correcta era usar la librería que el
 * proyecto ya tiene para eso, no declarar el límite.
 */
const HOY = new Date("2026-08-14T12:00:00Z");

const entry = (over: Partial<TallerEntry> = {}): TallerEntry => ({
  id: `t-${Math.abs(JSON.stringify(over).length)}-${over.eco ?? "x"}`,
  estado: "En Reparación",
  ...over,
});

const cerrada = (over: Partial<TallerEntry> = {}): TallerEntry =>
  entry({ estado: "Finalizado", ...over });

// ── resumenPorUnidad (agrupación movida del monolito a código puro) ─────────────
describe("resumenPorUnidad", () => {
  it("agrupa por unitKey y solo las visitas cerradas cuentan", () => {
    const r = resumenPorUnidad(
      [
        cerrada({ unitKey: "54", eco: "54", gastoRef: 100, gastoMO: 50, fentrada: "2026-07-01", fsalidaReal: "2026-07-03" }),
        cerrada({ unitKey: "54", eco: "54", gasto: 700, fentrada: "2026-08-01", fsalidaReal: "2026-08-02" }),
        entry({ unitKey: "54", eco: "54" }), // abierta: no cuenta
      ],
      HOY,
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.visitas).toBe(2);
    expect(r[0]!.gastoTotal).toBe(850); // 150 del desglose + 700 legacy
  });

  it("primer ingreso y última salida son el MIN y el MAX reales", () => {
    const [u] = resumenPorUnidad(
      [
        cerrada({ unitKey: "12", fentrada: "2026-06-10", fsalidaReal: "2026-06-12" }),
        cerrada({ unitKey: "12", fentrada: "2026-05-01", fsalidaReal: "2026-05-03" }),
      ],
      HOY,
    );
    expect(u!.primerIngreso).toBe("2026-05-01");
    expect(u!.ultimaSalida).toBe("2026-06-12");
  });

  it("días promedio sobre las visitas cerradas", () => {
    const [u] = resumenPorUnidad(
      [
        cerrada({ unitKey: "12", fentrada: "2026-06-10", fsalidaReal: "2026-06-12" }), // 2
        cerrada({ unitKey: "12", fentrada: "2026-05-01", fsalidaReal: "2026-05-05" }), // 4
      ],
      HOY,
    );
    expect(u!.diasPromedio).toBe(3);
  });

  it("una unidad sin visitas cerradas no aparece", () => {
    expect(resumenPorUnidad([entry({ unitKey: "9" })], HOY)).toEqual([]);
  });

  it("ordena por gasto total descendente (las más caras primero)", () => {
    const r = resumenPorUnidad(
      [
        cerrada({ unitKey: "a", eco: "a", gasto: 100 }),
        cerrada({ unitKey: "b", eco: "b", gasto: 900 }),
      ],
      HOY,
    );
    expect(r.map((u) => u.eco)).toEqual(["b", "a"]);
  });
});

// ── El workbook con formato ─────────────────────────────────────────────────────
const FILA_HEADER = 4; // título, subtítulo, separador, encabezado — igual que Solicitudes

async function activas(): Promise<ExcelJS.Worksheet> {
  const wb = await buildActivasWorkbook(
    [
      entry({ eco: "54", plate: "PW9237A", fentrada: "2026-08-02", gastoRef: 12500.5, gastoMO: 3800, refacciones: "Balatas" }),
      entry({ eco: "12", fentrada: "2026-08-10", gasto: 700 }),
    ],
    { hoy: HOY },
  );
  return wb.getWorksheet("Activas en Taller")!;
}

describe("hoja de Activas — formato", () => {
  it("el encabezado queda CONGELADO (scroll sin perder los títulos)", async () => {
    const ws = await activas();
    expect(ws.views?.[0]).toMatchObject({ state: "frozen", ySplit: FILA_HEADER });
  });

  it("autofiltro sobre la fila de encabezado", async () => {
    const ws = await activas();
    expect(ws.autoFilter).toBeTruthy();
  });

  it("título con fondo y negritas + encabezado en negritas blancas", async () => {
    const ws = await activas();
    expect(ws.getCell(1, 1).font?.bold).toBe(true);
    expect(ws.getCell(1, 1).fill).toMatchObject({ type: "pattern" });
    const h = ws.getRow(FILA_HEADER).getCell(1);
    expect(h.font?.bold).toBe(true);
    expect(h.fill).toMatchObject({ type: "pattern" });
  });

  it("las 24 columnas del modelo, en el orden canónico", async () => {
    const ws = await activas();
    const titulos = COLUMNAS_TALLER.map((c) => c.titulo);
    const fila = ws.getRow(FILA_HEADER);
    titulos.forEach((t, i) => expect(fila.getCell(i + 1).value, `col ${i + 1}`).toBe(t));
  });

  it("fechas como Date con formato, montos con formato de moneda", async () => {
    const ws = await activas();
    const iFecha = COLUMNAS_TALLER.findIndex((c) => c.campo === "fentrada") + 1;
    const iMonto = COLUMNAS_TALLER.findIndex((c) => c.campo === "gastoRef") + 1;
    const datos = ws.getRow(FILA_HEADER + 1);
    expect(datos.getCell(iFecha).value).toBeInstanceOf(Date);
    expect(datos.getCell(iFecha).numFmt).toContain("yyyy");
    expect(datos.getCell(iMonto).numFmt).toContain("$");
  });

  it("fila TOTAL con fórmula SUM viva sobre el gasto total", async () => {
    const ws = await activas();
    const iTotal = COLUMNAS_TALLER.findIndex((c) => c.campo === "_gastoTotal") + 1;
    const totalRow = ws.getRow(FILA_HEADER + 2 + 1); // header + 2 filas de datos + 1
    const v = totalRow.getCell(iTotal).value as { formula?: string };
    expect(v?.formula).toMatch(/^SUM\(/);
  });

  it("ordena por días en taller descendente (la más antigua primero)", async () => {
    const ws = await activas();
    const iEco = COLUMNAS_TALLER.findIndex((c) => c.campo === "eco") + 1;
    expect(ws.getRow(FILA_HEADER + 1).getCell(iEco).value).toBe("54"); // entró el 02-ago
    expect(ws.getRow(FILA_HEADER + 2).getCell(iEco).value).toBe("12"); // entró el 10-ago
  });
});

describe("workbook del Historial", () => {
  it("trae las hojas Resumen y Detalle, ambas con encabezado congelado", async () => {
    const wb = await buildHistorialWorkbook(
      [cerrada({ unitKey: "54", eco: "54", fentrada: "2026-07-01", fsalidaReal: "2026-07-03", gasto: 500 })],
      { hoy: HOY },
    );
    for (const nombre of ["Resumen", "Detalle"]) {
      const ws = wb.getWorksheet(nombre)!;
      expect(ws, nombre).toBeTruthy();
      expect(ws.views?.[0]?.state, nombre).toBe("frozen");
    }
  });

  it("el Resumen usa las columnas canónicas del resumen", async () => {
    const wb = await buildHistorialWorkbook(
      [cerrada({ unitKey: "54", eco: "54", gasto: 500 })],
      { hoy: HOY },
    );
    const fila = wb.getWorksheet("Resumen")!.getRow(FILA_HEADER);
    COLUMNAS_RESUMEN.forEach((c, i) => expect(fila.getCell(i + 1).value).toBe(c.titulo));
  });

  it("el Detalle solo lleva visitas cerradas", async () => {
    const wb = await buildHistorialWorkbook(
      [
        cerrada({ unitKey: "54", eco: "54", fentrada: "2026-07-01" }),
        entry({ unitKey: "54", eco: "54", fentrada: "2026-08-01" }), // abierta
      ],
      { hoy: HOY },
    );
    const ws = wb.getWorksheet("Detalle")!;
    const iEstado = COLUMNAS_TALLER.findIndex((c) => c.campo === "estado") + 1;
    expect(ws.getRow(FILA_HEADER + 1).getCell(iEstado).value).toBe("Finalizado");
    expect(ws.getRow(FILA_HEADER + 2).getCell(iEstado).value).not.toBe("En Reparación");
  });
});
