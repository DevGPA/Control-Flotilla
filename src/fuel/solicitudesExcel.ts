/**
 * Render del export "Solicitudes (Excel)" con FORMATO profesional (ExcelJS):
 *  - Hoja "Solicitudes": la vista de trabajo de Tesorería — título + contexto, 17
 *    columnas legibles (incl. FUENTE MoreApp/Operaciones-GPA para cazar duplicados
 *    del piloto), encabezado congelado con autofiltro, zebra, formatos $ y %, y fila
 *    TOTAL con fórmula SUM viva (poner un monto en 0 recalcula el total solo).
 *  - Hoja "Submissions": la réplica exacta de 30 columnas de MoreApp (compatibilidad
 *    con el flujo/archivos históricos de Tesorería).
 *
 * ExcelJS se usa SOLO aquí porque la edición community de xlsx no escribe estilos;
 * este módulo se importa dinámicamente desde wire.ts → exceljs queda en un chunk
 * on-demand (patrón del programa de rendimiento; el layout Toka sigue en xlsx).
 */
import ExcelJS from "exceljs";
import type { FuelEntry } from "./types";
import {
  SOLICITUDES_HEADER,
  buildSolicitudesLayout,
  buildSolicitudesVista,
  solicitudesLayoutToAoa,
  type SolicitudVista,
} from "./solicitudesLayout";

export const VISTA_HEADER = [
  "Folio",
  "Fecha y hora",
  "Sucursal",
  "Económico",
  "Placas",
  "Submarca",
  "Área",
  "Combustible",
  "Nivel antes",
  "Nivel deseado",
  "Necesidad",
  "Precio $/L",
  "Máx. litros",
  "Monto a cargar ($)",
  "Observaciones",
  "Solicitante",
  "Fuente",
] as const;

const ANCHOS = [15, 17, 15, 11, 11, 30, 13, 12, 11, 13, 11, 11, 11, 17, 28, 30, 16];

export type SolicitudesExcelMeta = {
  exportadoEl: Date;
  /** Sucursal del filtro activo ("" = Todas) — se deja constancia en el archivo. */
  filtroSucursal: string;
  /** Rango de fechas del filtro, ya formateado ("2026-07-13 a 2026-07-13"). */
  rango?: string;
};

// Paleta GPA Aqua (sobria): teal oscuro para encabezados, teal-50 para zebra.
const C_TITULO = "FF115E59"; // teal-800
const C_HEADER = "FF0F766E"; // teal-700
const C_ZEBRA = "FFF0FDFA"; // teal-50
const C_TOTAL = "FFCCFBF1"; // teal-100
const C_LINEA = "FFB6E3DD";

const FMT_MONTO = '"$"#,##0';
const FMT_PRECIO = '"$"#,##0.00';
const FMT_FECHA = "dd/mm/yyyy hh:mm";

/**
 * ExcelJS serializa las fechas por su valor UTC (sin corregir huso local, a diferencia
 * de xlsx): para que Excel muestre el wall-clock que trae el Date local, se re-crea
 * el instante con los MISMOS componentes pero en UTC.
 */
function utcWallClock(d: Date): Date {
  return new Date(
    Date.UTC(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
      d.getSeconds(),
    ),
  );
}

function cell(v: string | number | Date): ExcelJS.CellValue {
  return v instanceof Date ? utcWallClock(v) : v;
}

function dd(n: number): string {
  return String(n).padStart(2, "0");
}

function armaSubtitulo(
  vista: { incluidas: number; totalMonto: number },
  meta: SolicitudesExcelMeta,
): string {
  const f = meta.exportadoEl;
  const partes = [
    `Exportado ${dd(f.getDate())}/${dd(f.getMonth() + 1)}/${f.getFullYear()} ${dd(f.getHours())}:${dd(f.getMinutes())}`,
    `${vista.incluidas} solicitud${vista.incluidas === 1 ? "" : "es"}`,
    `Total solicitado $${vista.totalMonto.toLocaleString("es-MX")}`,
  ];
  if (meta.rango) partes.push(`Rango: ${meta.rango}`);
  partes.push(`Sucursal: ${meta.filtroSucursal || "Todas"}`);
  return partes.join("  ·  ");
}

/** Fila de la vista en el orden de VISTA_HEADER. */
function filaVista(f: SolicitudVista): ExcelJS.CellValue[] {
  return [
    f.folio,
    cell(f.fechaHora),
    f.sucursal,
    f.eco,
    f.placa,
    f.submarca,
    f.area,
    f.combustible,
    f.nivelAntes,
    f.nivelDeseado,
    f.necesidad,
    f.precio,
    f.maxLitros,
    f.monto,
    f.observaciones,
    f.solicitante,
    f.fuente,
  ];
}

export async function buildSolicitudesWorkbook(
  entries: readonly FuelEntry[],
  meta: SolicitudesExcelMeta,
): Promise<ExcelJS.Workbook> {
  const vista = buildSolicitudesVista(entries);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Control Flotilla · GPA";
  wb.created = meta.exportadoEl;

  // ── Hoja 1: vista de trabajo ─────────────────────────────────────────────
  const ws = wb.addWorksheet("Solicitudes");
  const nCols = VISTA_HEADER.length;
  const ultimaCol = ws.getColumn(nCols).letter;

  ws.mergeCells(1, 1, 1, nCols);
  const titulo = ws.getCell(1, 1);
  titulo.value = "Solicitudes de Combustible · GPA";
  titulo.font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
  titulo.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_TITULO } };
  titulo.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(1).height = 28;

  ws.mergeCells(2, 1, 2, nCols);
  const sub = ws.getCell(2, 1);
  sub.value = armaSubtitulo(vista, meta);
  sub.font = { size: 10, color: { argb: "FF475569" } };
  sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_ZEBRA } };
  sub.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 6; // separador

  const headerRow = ws.getRow(4);
  headerRow.values = [...VISTA_HEADER];
  headerRow.height = 30;
  headerRow.eachCell((c) => {
    c.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_HEADER } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.border = { bottom: { style: "medium", color: { argb: C_TITULO } } };
  });

  const primeraFila = 5;
  for (const [i, f] of vista.filas.entries()) {
    const row = ws.getRow(primeraFila + i);
    row.values = filaVista(f);
    if (i % 2 === 1)
      row.eachCell({ includeEmpty: true }, (c, colN) => {
        if (colN <= nCols)
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_ZEBRA } };
      });
    row.eachCell({ includeEmpty: true }, (c, colN) => {
      if (colN <= nCols) c.border = { bottom: { style: "hair", color: { argb: C_LINEA } } };
    });
    row.getCell(2).numFmt = FMT_FECHA;
    row.getCell(11).numFmt = "0%";
    row.getCell(12).numFmt = FMT_PRECIO;
    row.getCell(14).numFmt = FMT_MONTO;
    row.getCell(14).font = { bold: true };
  }

  // Fila TOTAL: SUM viva — la curaduría (poner montos en 0) recalcula el total sola.
  const ultimaFila = primeraFila + vista.filas.length - 1;
  const totalRow = ws.getRow(ultimaFila + 1);
  totalRow.getCell(13).value = "TOTAL";
  totalRow.getCell(14).value = { formula: `SUM(N${primeraFila}:N${ultimaFila})` };
  totalRow.getCell(14).numFmt = FMT_MONTO;
  totalRow.eachCell({ includeEmpty: true }, (c, colN) => {
    if (colN <= nCols) {
      c.font = { bold: true };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_TOTAL } };
      c.border = { top: { style: "medium", color: { argb: C_HEADER } } };
    }
  });

  ANCHOS.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", ySplit: 4 }];
  ws.autoFilter = `A4:${ultimaCol}${ultimaFila}`;

  // ── Hoja 2: réplica exacta de 30 columnas (compatibilidad) ──────────────
  const rep = wb.addWorksheet("Submissions");
  const aoa = solicitudesLayoutToAoa(buildSolicitudesLayout(entries));
  for (const fila of aoa) rep.addRow(fila.map(cell));
  rep.getRow(1).font = { bold: true };
  for (let r = 2; r <= aoa.length; r++)
    for (const c of [3, 7]) {
      const celda = rep.getRow(r).getCell(c);
      if (celda.value instanceof Date) celda.numFmt = "yyyy-mm-dd hh:mm";
    }
  SOLICITUDES_HEADER.forEach((h, i) => {
    rep.getColumn(i + 1).width = Math.min(Math.max(h.length + 2, 10), 40);
  });

  return wb;
}

/** Genera el workbook y dispara la descarga en el navegador. */
export async function downloadSolicitudesXlsx(
  entries: readonly FuelEntry[],
  meta: SolicitudesExcelMeta,
  filename: string,
): Promise<void> {
  const wb = await buildSolicitudesWorkbook(entries, meta);
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
