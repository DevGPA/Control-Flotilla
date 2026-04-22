// Loader ZIP de alto nivel — combina `readZip` (parser binario) con `loadExcel`
// (parser XLSX) para producir un `LoadedZip` tipado listo para consumir.
// Reemplaza la lógica de `doZip()` del legado (extracción de imágenes + XLSX
// + clasificación), pero sin tocar DOM ni estado global.

import { loadExcel, type LoadedReport, ExcelLoadError } from "./excelLoader";
import { readZipStream } from "./zipReader";

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

/**
 * Loader ZIP de alto nivel. Ahora usa streaming internamente para evitar OOM.
 */
export async function loadZip(file: File | Blob, filename?: string): Promise<LoadedZip> {
  const name = filename ?? (file instanceof File ? file.name : "archivo.zip");
  const images: Record<string, Uint8Array> = {};
  const entries: LoadedZip["entries"] = [];
  type XlsxRef = { name: string; bytes: Uint8Array };
  const xlsxBox: { ref: XlsxRef | null } = { ref: null };

  try {
    await readZipStream(file, async (entryName, getBytes) => {
      // Saltar directorios y metadatos macOS
      if (MACOSX_PATH.test(entryName) || entryName.startsWith(".") || entryName.endsWith("/")) {
        return;
      }

      const isImg = IMG_EXT.test(entryName);
      const isXlsx = XLSX_EXT.test(entryName);

      if (isImg || isXlsx) {
        const bytes = await getBytes();
        if (isImg) {
          const key = (entryName.split("/").pop() ?? entryName).toLowerCase().trim();
          if (key) images[key] = bytes;
          entries.push({ name: entryName, kind: "image", size: bytes.length });
        } else if (isXlsx && !xlsxBox.ref) {
          xlsxBox.ref = { name: entryName, bytes };
          entries.push({ name: entryName, kind: "xlsx", size: bytes.length });
        }
      } else {
        // Para archivos "other", solo guardamos el nombre y tipo en el log de entries
        // pero no extraemos los bytes para ahorrar RAM.
        entries.push({ name: entryName, kind: "other", size: 0 });
      }
    });
  } catch (err) {
    throw new ZipLoadError(`No se pudo leer el ZIP: ${(err as Error).message}`, err);
  }

  let report: LoadedReport | null = null;
  const xlsx = xlsxBox.ref;
  if (xlsx) {
    try {
      const xlsxBlob = new Blob([xlsx.bytes as BlobPart]);
      report = await loadExcel(xlsxBlob, xlsx.name.split("/").pop() || xlsx.name);
    } catch (err) {
      if (err instanceof ExcelLoadError) {
        throw new ZipLoadError(
          `ZIP leído OK pero el XLSX embebido "${xlsx.name}" es inválido: ${err.message}`,
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

/**
 * Versión avanzada que permite procesar imágenes on-the-fly (útil para guardar a DB sin RAM).
 */
export async function loadZipStream(
  file: File | Blob,
  onImage: (name: string, data: Uint8Array) => Promise<void>,
  onReport: (report: LoadedReport) => Promise<void>
): Promise<void> {
  await readZipStream(file, async (entryName, getBytes) => {
    if (MACOSX_PATH.test(entryName) || entryName.startsWith(".") || entryName.endsWith("/")) {
      return;
    }

    if (IMG_EXT.test(entryName)) {
      const bytes = await getBytes();
      const key = (entryName.split("/").pop() ?? entryName).toLowerCase().trim();
      if (key) await onImage(key, bytes);
    } else if (XLSX_EXT.test(entryName)) {
      const bytes = await getBytes();
      const xlsxBlob = new Blob([bytes as BlobPart]);
      const report = await loadExcel(xlsxBlob, entryName.split("/").pop() || entryName);
      await onReport(report);
    }
  });
}

