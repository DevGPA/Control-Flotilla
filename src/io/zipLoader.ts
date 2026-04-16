// Loader ZIP de alto nivel — combina `readZip` (parser binario) con `loadExcel`
// (parser XLSX) para producir un `LoadedZip` tipado listo para consumir.
// Reemplaza la lógica de `doZip()` del legado (extracción de imágenes + XLSX
// + clasificación), pero sin tocar DOM ni estado global.

import { loadExcel, type LoadedReport, ExcelLoadError } from "./excelLoader";
import { readZip } from "./zipReader";

const IMG_EXT = /\.(jpe?g|png|gif|webp)$/i;
const XLSX_EXT = /\.xlsx?$/i;
const MACOSX_PATH = /(^|\/)__MACOSX\//;

export type LoadedZip = {
  filename: string;
  images: Record<string, Uint8Array>; // key = basename.toLowerCase()
  imageCount: number;
  report: LoadedReport | null; // primer xlsx encontrado; null si el ZIP solo trae fotos
  entries: {
    name: string; // nombre dentro del zip (con path)
    kind: "image" | "xlsx" | "other";
    size: number;
  }[];
};

export class ZipLoadError extends Error {
  public readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ZipLoadError";
    this.cause = cause;
  }
}

export async function loadZip(file: File | Blob, filename?: string): Promise<LoadedZip> {
  const name = filename ?? (file instanceof File ? file.name : "archivo.zip");

  let raw: Record<string, Uint8Array>;
  try {
    raw = await readZip(file);
  } catch (err) {
    throw new ZipLoadError(`No se pudo leer el ZIP: ${(err as Error).message}`, err);
  }

  const images: Record<string, Uint8Array> = {};
  const entries: LoadedZip["entries"] = [];
  let firstXlsx: { name: string; bytes: Uint8Array } | null = null;

  for (const [entryName, bytes] of Object.entries(raw)) {
    if (MACOSX_PATH.test(entryName) || entryName.startsWith(".") || entryName.endsWith("/")) {
      continue;
    }
    if (IMG_EXT.test(entryName)) {
      const key = (entryName.split("/").pop() ?? entryName).toLowerCase().trim();
      if (key) images[key] = bytes;
      entries.push({ name: entryName, kind: "image", size: bytes.length });
    } else if (XLSX_EXT.test(entryName)) {
      if (!firstXlsx) firstXlsx = { name: entryName, bytes };
      entries.push({ name: entryName, kind: "xlsx", size: bytes.length });
    } else {
      entries.push({ name: entryName, kind: "other", size: bytes.length });
    }
  }

  let report: LoadedReport | null = null;
  if (firstXlsx) {
    try {
      const xlsxBlob = new Blob([firstXlsx.bytes as BlobPart]);
      report = await loadExcel(xlsxBlob, firstXlsx.name.split("/").pop() || firstXlsx.name);
    } catch (err) {
      // Si el XLSX embebido está corrupto, preservamos las imágenes pero
      // propagamos el error: quien llama decide si seguir con solo fotos.
      if (err instanceof ExcelLoadError) {
        throw new ZipLoadError(
          `ZIP leído OK pero el XLSX embebido "${firstXlsx.name}" es inválido: ${err.message}`,
          err,
        );
      }
      throw err;
    }
  }

  return {
    filename: name,
    images,
    imageCount: Object.keys(images).length,
    report,
    entries,
  };
}
