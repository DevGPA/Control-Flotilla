/**
 * Render del Excel de Taller con FORMATO profesional (ExcelJS) — el MISMO lenguaje
 * visual que el export "Solicitudes (Excel)" de Combustible: título con fondo teal,
 * subtítulo con el contexto del export, encabezado en negritas CONGELADO con autofiltro,
 * zebra, formatos de moneda/fecha por columna y fila TOTAL con fórmula SUM viva.
 *
 * Qué pone cada quién:
 *  - `exportExcel.ts` define QUÉ se exporta (las 24 columnas canónicas + el guard de
 *    cobertura contra campos olvidados). Este módulo define CÓMO se ve.
 *  - ExcelJS se usa aquí porque la edición community de `xlsx` no escribe estilos —
 *    mismo motivo y mismo patrón que `src/fuel/solicitudesExcel.ts`. Se importa
 *    dinámicamente desde el monolito → exceljs queda en un chunk on-demand.
 */
import ExcelJS from "exceljs";
import {
  COLUMNAS_RESUMEN,
  COLUMNAS_TALLER,
  diasEnTaller,
  filasDe,
  filasResumen,
  gastoTotalDe,
  type ColumnaResumen,
  type ColumnaTaller,
  type ContextoExport,
  type ResumenUnidad,
} from "./exportExcel";
import type { TallerEntry } from "./types";

// Paleta GPA Aqua — la misma de solicitudesExcel.ts, para que todos los Excel de la
// app se vean de la misma familia.
const C_TITULO = "FF115E59"; // teal-800
const C_HEADER = "FF0F766E"; // teal-700
const C_ZEBRA = "FFF0FDFA"; // teal-50
const C_TOTAL = "FFCCFBF1"; // teal-100
const C_LINEA = "FFB6E3DD";

const FILA_TITULO = 1;
const FILA_SUB = 2;
const FILA_HEADER = 4; // la 3 es un separador delgado

/**
 * ExcelJS serializa las fechas por su valor UTC (sin corregir huso local, a diferencia
 * de xlsx): se re-crea el instante con los MISMOS componentes pero en UTC para que
 * Excel muestre el wall-clock local. Igual que utcWallClock de solicitudesExcel.
 */
function utcWallClock(d: Date): Date {
  return new Date(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()),
  );
}

const celda = (v: string | number | Date): ExcelJS.CellValue =>
  v instanceof Date ? utcWallClock(v) : v;

/** "A".."Z","AA".. — para armar las fórmulas SUM de la fila TOTAL. */
function letraCol(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const dd = (n: number): string => String(n).padStart(2, "0");

interface ColumnaHoja {
  titulo: string;
  ancho: number;
  tipo: "texto" | "numero" | "moneda" | "fecha";
  formato?: string;
}

/**
 * Pinta una hoja completa con el formato de la casa. Devuelve la fila del último dato,
 * por si el llamador quiere seguir escribiendo debajo.
 */
function hojaProfesional(
  ws: ExcelJS.Worksheet,
  opts: {
    titulo: string;
    subtitulo: string;
    columnas: readonly ColumnaHoja[];
    filas: readonly (string | number | Date)[][];
    /** Índices (base 0) de columnas de moneda que llevan SUM en la fila TOTAL. */
    totales?: number[];
  },
): void {
  const { titulo, subtitulo, columnas, filas, totales = [] } = opts;
  const nCols = columnas.length;

  ws.mergeCells(FILA_TITULO, 1, FILA_TITULO, nCols);
  const t = ws.getCell(FILA_TITULO, 1);
  t.value = titulo;
  t.font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_TITULO } };
  t.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(FILA_TITULO).height = 28;

  ws.mergeCells(FILA_SUB, 1, FILA_SUB, nCols);
  const s = ws.getCell(FILA_SUB, 1);
  s.value = subtitulo;
  s.font = { size: 10, color: { argb: "FF475569" } };
  s.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_ZEBRA } };
  s.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(FILA_SUB).height = 18;
  ws.getRow(3).height = 6;

  const header = ws.getRow(FILA_HEADER);
  header.values = columnas.map((c) => c.titulo);
  header.height = 30;
  header.eachCell((c) => {
    c.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_HEADER } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.border = { bottom: { style: "medium", color: { argb: C_TITULO } } };
  });

  const primera = FILA_HEADER + 1;
  filas.forEach((fila, i) => {
    const row = ws.getRow(primera + i);
    row.values = fila.map(celda);
    if (i % 2 === 1)
      row.eachCell({ includeEmpty: true }, (c, colN) => {
        if (colN <= nCols) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_ZEBRA } };
      });
    row.eachCell({ includeEmpty: true }, (c, colN) => {
      if (colN <= nCols) c.border = { bottom: { style: "hair", color: { argb: C_LINEA } } };
    });
    columnas.forEach((col, ci) => {
      if (col.formato && fila[ci] !== "" && fila[ci] != null) row.getCell(ci + 1).numFmt = col.formato;
    });
  });

  const ultima = primera + filas.length - 1;
  if (totales.length && filas.length) {
    const totalRow = ws.getRow(ultima + 1);
    // Rótulo en la celda anterior al primer total (o en la primera columna).
    const rotuloCol = Math.max(1, Math.min(...totales) /* base 0 → anterior en base 1 */);
    totalRow.getCell(rotuloCol).value = "TOTAL";
    for (const ti of totales) {
      const L = letraCol(ti + 1);
      const c = totalRow.getCell(ti + 1);
      c.value = { formula: `SUM(${L}${primera}:${L}${ultima})` } as ExcelJS.CellValue;
      c.numFmt = columnas[ti]?.formato ?? '"$"#,##0.00';
    }
    totalRow.eachCell({ includeEmpty: true }, (c, colN) => {
      if (colN <= nCols) {
        c.font = { bold: true };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_TOTAL } };
        c.border = { top: { style: "medium", color: { argb: C_HEADER } } };
      }
    });
  }

  columnas.forEach((c, i) => (ws.getColumn(i + 1).width = c.ancho));
  ws.views = [{ state: "frozen", ySplit: FILA_HEADER }];
  ws.autoFilter = `A${FILA_HEADER}:${letraCol(nCols)}${Math.max(ultima, FILA_HEADER)}`;
}

const esCerrada = (e: TallerEntry): boolean => e.estado === "Finalizado";

const subtituloDe = (partes: string[], hoy: Date): string =>
  [
    `Exportado ${dd(hoy.getDate())}/${dd(hoy.getMonth() + 1)}/${hoy.getFullYear()} ${dd(hoy.getHours())}:${dd(hoy.getMinutes())}`,
    ...partes,
  ].join("  ·  ");

/** Índices (base 0) de las columnas de dinero que suman en la fila TOTAL. */
const TOTALES_TALLER = ["gastoRef", "gastoMO", "_gastoTotal", "gasto"]
  .map((campo) => COLUMNAS_TALLER.findIndex((c: ColumnaTaller) => c.campo === campo))
  .filter((i) => i >= 0);

/**
 * Agregado del historial por unidad — la lógica que vivía inline en el monolito, ahora
 * pura y testeable. Solo las visitas CERRADAS cuentan; ordena por gasto descendente.
 */
export function resumenPorUnidad(entries: readonly TallerEntry[], hoy: Date): ResumenUnidad[] {
  const porUnidad = new Map<string, TallerEntry[]>();
  // Km último por unidad: sobre TODAS las visitas (una abierta trae la lectura más
  // reciente del odómetro y su gasto aún no cuenta — el km sí).
  const kmMax = new Map<string, number>();
  for (const e of entries) {
    const k = e.unitKey || e.id;
    const km = Number(e.km);
    if (Number.isFinite(km) && km > 0 && km > (kmMax.get(k) ?? 0)) kmMax.set(k, km);
    if (!esCerrada(e)) continue;
    if (!porUnidad.has(k)) porUnidad.set(k, []);
    porUnidad.get(k)!.push(e);
  }
  const out: ResumenUnidad[] = [];
  for (const [k, cerradas] of porUnidad.entries()) {
    const ultima = [...cerradas].sort((a, b) =>
      String(a.updatedAt ?? "").localeCompare(String(b.updatedAt ?? "")),
    )[cerradas.length - 1]!;
    const entradas = cerradas.map((e) => e.fentrada).filter(Boolean).sort() as string[];
    const salidas = cerradas.map((e) => e.fsalidaReal).filter(Boolean).sort() as string[];
    const dias = cerradas.map((e) => diasEnTaller(e, hoy)).filter((d): d is number => d !== "");
    const gastoTotal = cerradas.reduce((a, e) => a + gastoTotalDe(e), 0);
    const kmU = kmMax.get(k) ?? 0;
    out.push({
      kmUltimo: kmU > 0 ? kmU : "",
      costoPorMilKm: kmU > 0 ? gastoTotal / (kmU / 1000) : "",
      eco: ultima.eco,
      plate: ultima.plate,
      brand: ultima.brand,
      sucursal: ultima.sucursal,
      area: ultima.area,
      visitas: cerradas.length,
      gastoTotal,
      gastoRef: cerradas.reduce((a, e) => a + (e.gastoRef ?? 0), 0),
      gastoMO: cerradas.reduce((a, e) => a + (e.gastoMO ?? 0), 0),
      primerIngreso: entradas[0],
      ultimaSalida: salidas[salidas.length - 1],
      diasPromedio: dias.length ? dias.reduce((a, b) => a + b, 0) / dias.length : "",
    });
  }
  return out.sort((a, b) => b.gastoTotal - a.gastoTotal);
}

/** Workbook de las unidades ACTIVAS en taller (las que llevan más días, primero). */
export async function buildActivasWorkbook(
  activas: readonly TallerEntry[],
  ctx: ContextoExport,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Control Flotilla · GPA";
  wb.created = ctx.hoy;

  const orden = [...activas].sort((a, b) => {
    const da = diasEnTaller(a, ctx.hoy);
    const db = diasEnTaller(b, ctx.hoy);
    return (db === "" ? -1 : db) - (da === "" ? -1 : da);
  });
  const gasto = orden.reduce((a, e) => a + gastoTotalDe(e), 0);

  hojaProfesional(wb.addWorksheet("Activas en Taller"), {
    titulo: "Unidades Activas en Taller · GPA",
    subtitulo: subtituloDe(
      [
        `${orden.length} unidad${orden.length === 1 ? "" : "es"} en taller`,
        `Gasto acumulado $${gasto.toLocaleString("es-MX")}`,
      ],
      ctx.hoy,
    ),
    columnas: COLUMNAS_TALLER,
    filas: filasDe(orden, COLUMNAS_TALLER, ctx),
    totales: TOTALES_TALLER,
  });
  return wb;
}

/** Workbook del HISTORIAL: hoja Resumen (agregado por unidad) + hoja Detalle (cerradas). */
export async function buildHistorialWorkbook(
  entries: readonly TallerEntry[],
  ctx: ContextoExport,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Control Flotilla · GPA";
  wb.created = ctx.hoy;

  const unidades = resumenPorUnidad(entries, ctx.hoy);
  const cerradas = entries
    .filter(esCerrada)
    .sort((a, b) => String(b.fentrada ?? "").localeCompare(String(a.fentrada ?? "")));
  const gasto = unidades.reduce((a, u) => a + u.gastoTotal, 0);
  const sub = subtituloDe(
    [
      `${unidades.length} unidad${unidades.length === 1 ? "" : "es"}`,
      `${cerradas.length} visita${cerradas.length === 1 ? "" : "s"} finalizadas`,
      `Gasto histórico $${gasto.toLocaleString("es-MX")}`,
    ],
    ctx.hoy,
  );

  const iTotales = ["Gasto Total", "Refacciones", "Mano de Obra"]
    .map((t) => COLUMNAS_RESUMEN.findIndex((c: ColumnaResumen) => c.titulo === t))
    .filter((i) => i >= 0);

  hojaProfesional(wb.addWorksheet("Resumen"), {
    titulo: "Historial de Taller · Resumen por Unidad · GPA",
    subtitulo: sub,
    columnas: COLUMNAS_RESUMEN,
    filas: filasResumen(unidades),
    totales: iTotales,
  });
  hojaProfesional(wb.addWorksheet("Detalle"), {
    titulo: "Historial de Taller · Detalle por Ingreso · GPA",
    subtitulo: sub,
    columnas: COLUMNAS_TALLER,
    filas: filasDe(cerradas, COLUMNAS_TALLER, ctx),
    totales: TOTALES_TALLER,
  });
  return wb;
}

/** Descarga en el navegador (mismo mecanismo que solicitudesExcel). */
async function descargar(wb: ExcelJS.Workbook, filename: string): Promise<void> {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadTallerActivasXlsx(
  activas: readonly TallerEntry[],
  ctx: ContextoExport,
): Promise<void> {
  await descargar(
    await buildActivasWorkbook(activas, ctx),
    `taller_activas_${ctx.hoy.toISOString().slice(0, 10)}.xlsx`,
  );
}

export async function downloadTallerHistorialXlsx(
  entries: readonly TallerEntry[],
  ctx: ContextoExport,
): Promise<void> {
  await descargar(
    await buildHistorialWorkbook(entries, ctx),
    `historial_taller_${ctx.hoy.toISOString().slice(0, 10)}.xlsx`,
  );
}
