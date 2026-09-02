/**
 * Reporte de Accesorios en Excel (2026-09-02). Dos hojas:
 *  1. "Vigentes por unidad" — una fila por unidad: qué batería y qué limpiabrisas trae hoy.
 *  2. "Historial"           — una fila por cambio capturado (para conciliar compras y garantías).
 *
 * ExcelJS (no la edición community de xlsx, que no escribe estilos ni congela encabezados),
 * importado dinámicamente desde wire.ts → queda en un chunk on-demand. Mismo patrón que
 * src/compliance/cumplimientoExcel.ts, cuyo formateador de hoja se replica aquí en corto a
 * propósito, para no modificar ese módulo (deuda menor: consolidar si aparece una 3ª hoja).
 */
import ExcelJS from "exceljs";
import { TIPO_LABEL, type AccesorioUnidad } from "./types";
import { fmtAntiguedad } from "./renderAccesorios";

export const VIGENTES_HEADER = [
  "Unidad",
  "Placa",
  "Sucursal",
  "Batería · marca",
  "Batería · serie",
  "Batería · compra",
  "Batería · antigüedad",
  "Limpiabrisas · marca",
  "Limpiabrisas · compra",
  "Limpiabrisas · antigüedad",
  "Cambios",
  "Gasto total",
] as const;

export const HISTORIAL_HEADER = [
  "Unidad",
  "Placa",
  "Sucursal",
  "Accesorio",
  "Marca",
  "Serie",
  "Fecha de compra",
  "Antigüedad",
  "Costo",
  "Vigente",
  "Nota",
  "Capturado por",
] as const;

export type Celda = string | number;

export type AccesoriosExcelMeta = {
  /** Fecha de referencia de la antigüedad (YYYY-MM-DD, zona México). */
  hoy: string;
  exportadoEl: Date;
  /** Sucursal a la que está scopeada la vista, si aplica. */
  sucursal?: string;
};

/** Una fila por unidad con lo vigente de cada tipo. PURA. */
export function filasVigentes(unidades: readonly AccesorioUnidad[]): Celda[][] {
  return unidades.map((u) => {
    const b = u.vigentes.bateria;
    const l = u.vigentes.limpiabrisas;
    return [
      u.economicoId,
      u.placa ?? "",
      u.sucursal ?? "",
      b?.marca ?? "",
      b?.numeroSerie ?? "",
      b?.fechaCompra ?? "",
      b ? fmtAntiguedad(b.antiguedadMeses) : "Sin registro",
      l?.marca ?? "",
      l?.fechaCompra ?? "",
      l ? fmtAntiguedad(l.antiguedadMeses) : "Sin registro",
      u.cambios,
      u.gastoTotal,
    ];
  });
}

/** Una fila por cambio capturado, del más reciente al más viejo dentro de cada unidad. PURA. */
export function filasHistorial(unidades: readonly AccesorioUnidad[]): Celda[][] {
  const out: Celda[][] = [];
  for (const u of unidades) {
    for (const e of u.historial) {
      out.push([
        u.economicoId,
        u.placa ?? "",
        u.sucursal ?? "",
        TIPO_LABEL[e.tipo],
        e.marca ?? "",
        e.numeroSerie ?? "",
        e.fechaCompra ?? "",
        fmtAntiguedad(e.antiguedadMeses),
        e.costo ?? "",
        u.vigentes[e.tipo]?.accesorioId === e.accesorioId ? "Sí" : "",
        e.nota ?? "",
        e.capturadoPor ?? "",
      ]);
    }
  }
  return out;
}

const C_TITULO = "FF15397A";
const C_HEADER = "FF1E4FA3";
const C_ZEBRA = "FFF3F5F9";
const C_LINEA = "FFD9DCE3";

/** Pinta una hoja con título, subtítulo, encabezado congelado, autofiltro y zebra. */
function pintaHoja(
  wb: ExcelJS.Workbook,
  nombre: string,
  titulo: string,
  subtitulo: string,
  header: readonly string[],
  filas: readonly Celda[][],
): void {
  const ws = wb.addWorksheet(nombre);
  const nCols = header.length;

  ws.mergeCells(1, 1, 1, nCols);
  const t = ws.getCell(1, 1);
  t.value = titulo;
  t.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_TITULO } };
  t.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, nCols);
  const sub = ws.getCell(2, 1);
  sub.value = subtitulo;
  sub.font = { size: 10, color: { argb: "FF475569" } };
  sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_ZEBRA } };
  sub.alignment = { vertical: "middle", horizontal: "left", indent: 1, wrapText: true };
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 6;

  const hr = ws.getRow(4);
  hr.values = [...header];
  hr.height = 28;
  hr.eachCell((c) => {
    c.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_HEADER } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.border = { bottom: { style: "medium", color: { argb: C_TITULO } } };
  });

  const primera = 5;
  for (const [i, f] of filas.entries()) {
    const row = ws.getRow(primera + i);
    row.values = [...f];
    row.eachCell({ includeEmpty: true }, (c, colN) => {
      if (colN > nCols) return;
      if (i % 2 === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_ZEBRA } };
      c.border = { bottom: { style: "hair", color: { argb: C_LINEA } } };
      c.alignment = { vertical: "top", wrapText: true };
    });
  }

  header.forEach((h, i) => {
    ws.getColumn(i + 1).width = Math.min(Math.max(h.length + 3, 10), 42);
  });
  ws.views = [{ state: "frozen", ySplit: 4 }];
  if (filas.length) ws.autoFilter = `A4:${ws.getColumn(nCols).letter}${primera + filas.length - 1}`;
}

/** Arma el workbook completo del reporte de Accesorios. */
export async function buildAccesoriosWorkbook(
  unidades: readonly AccesorioUnidad[],
  meta: AccesoriosExcelMeta,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Control Flotilla · GPA";
  wb.created = meta.exportadoEl;

  const alcance = meta.sucursal ? `Sucursal ${meta.sucursal}` : "Toda la flota";
  const conRegistro = unidades.filter((u) => u.cambios > 0).length;
  const ctx =
    `${alcance} · ${unidades.length} unidades · ${conRegistro} con al menos un accesorio ` +
    `capturado · antigüedad calculada al ${meta.hoy}.`;

  pintaHoja(
    wb,
    "Vigentes por unidad",
    "Accesorios vigentes por unidad · GPA",
    `El accesorio vigente es el de fecha de compra más reciente. ${ctx}`,
    VIGENTES_HEADER,
    filasVigentes(unidades),
  );
  pintaHoja(
    wb,
    "Historial",
    "Historial de cambios de accesorios · GPA",
    `Una fila por accesorio capturado, para conciliar compras y garantías. ${ctx}`,
    HISTORIAL_HEADER,
    filasHistorial(unidades),
  );
  return wb;
}

/** Genera el workbook y dispara la descarga en el navegador. */
export async function downloadAccesoriosXlsx(
  unidades: readonly AccesorioUnidad[],
  meta: AccesoriosExcelMeta,
  filename: string,
): Promise<void> {
  const wb = await buildAccesoriosWorkbook(unidades, meta);
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
