// Loader XLSX envolvente: lee File → devuelve LoadedReport tipado con
// clasificación (mensual/semanal), headers normalizados, rows parseados y
// filename. No toca DOM. Testeable sin navegador (con happy-dom).
//
// Reemplaza la lógica de `doExcel()` / `doArchivoSemanal()` del legado.

import * as XLSX from "xlsx";
import { classifyReport } from "../analyzer/classifyReport";
import type { ExcelRow, ReportKind } from "../types";

export type LoadedReport = {
  kind: ReportKind;
  filename: string;
  sheetName: string;
  headers: string[];
  rows: ExcelRow[];
  rowCount: number;
};

export class ExcelLoadError extends Error {
  public readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ExcelLoadError";
    this.cause = cause;
  }
}

/** Lee un File/Blob XLSX y devuelve el reporte clasificado + parseado. */
export async function loadExcel(file: File | Blob, filename?: string): Promise<LoadedReport> {
  const name = filename ?? (file instanceof File ? file.name : "archivo.xlsx");
  let buf: ArrayBuffer;
  try {
    buf = await file.arrayBuffer();
  } catch (err) {
    throw new ExcelLoadError(`No se pudo leer el archivo como ArrayBuffer.`, err);
  }

  // XLSX es un ZIP. Validamos el magic byte PK\x03\x04 para rechazar basura
  // que SheetJS intentaría parsear como CSV/HTML/etc. y devolvería ruido.
  const bytes = new Uint8Array(buf);
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new ExcelLoadError(
      `Formato XLSX inválido: falta header ZIP (PK\\x03\\x04). El archivo no parece un .xlsx.`,
    );
  }

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "array", cellDates: false });
  } catch (err) {
    throw new ExcelLoadError(`Formato XLSX inválido o archivo corrupto.`, err);
  }

  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new ExcelLoadError("El XLSX no contiene hojas.");

  const ws = wb.Sheets[sheetName];
  if (!ws) throw new ExcelLoadError(`Hoja "${sheetName}" no encontrada.`);

  // Primera fila como headers
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ExcelLoadError("La hoja está vacía.");
  }

  const headers = (raw[0] as unknown[]).map((h) => String(h ?? "").trim());
  const kind = classifyReport(headers, name);

  // Rows como objetos keyed por header (compatible con analyzeRow)
  const rows = XLSX.utils.sheet_to_json<ExcelRow>(ws, { defval: "" });

  // sheet_to_json silenciosamente filtra filas totalmente vacías. Comparamos contra
  // el conteo crudo (raw - 1 por header) para detectar discrepancias grandes que
  // indiquen archivo malformado o rows raggeadas que SheetJS no pudo parsear.
  const expectedRowCount = raw.length - 1;
  const skipped = expectedRowCount - rows.length;
  if (skipped > 0) {
    const pct = expectedRowCount > 0 ? (skipped / expectedRowCount) * 100 : 0;
    if (pct >= 10) {
      console.warn(
        `[excelLoader] ${name}: ${skipped}/${expectedRowCount} filas omitidas (${pct.toFixed(1)}%) — verifica formato`,
      );
    } else if (skipped > 0) {
      console.info(`[excelLoader] ${name}: ${skipped} filas vacías omitidas`);
    }
  }

  return {
    kind,
    filename: name,
    sheetName,
    headers,
    rows,
    rowCount: rows.length,
  };
}
