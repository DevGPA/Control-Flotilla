import { inflateBytes } from "./inflate";

export type ZipEntry = {
  name: string;
  method: number;
  csize: number;
  usize: number;
  offset: number;
};

// Lector ZIP mínimo — parsea EOCD + central directory + devuelve Uint8Array por archivo.
// Basado en el lector legado de `Control de flotilla.html` (doZip).
//
// Encoding: por defecto los ZIPs anteriores al 2008 usan CP437 (IBM-PC) para nombres;
// los modernos marcan UTF-8 con General Purpose Bit Flag bit 11. Detectamos por flag
// para evitar mojibake en filenames con tildes (p. ej. "Refacción.xlsx" de exports MX).
const CP437_UTF8 = [
  "\u00C7","\u00FC","\u00E9","\u00E2","\u00E4","\u00E0","\u00E5","\u00E7","\u00EA","\u00EB","\u00E8","\u00EF","\u00EE","\u00EC","\u00C4","\u00C5",
  "\u00C9","\u00E6","\u00C6","\u00F4","\u00F6","\u00F2","\u00FB","\u00F9","\u00FF","\u00D6","\u00DC","\u00A2","\u00A3","\u00A5","\u20A7","\u0192",
  "\u00E1","\u00ED","\u00F3","\u00FA","\u00F1","\u00D1","\u00AA","\u00BA","\u00BF","\u2310","\u00AC","\u00BD","\u00BC","\u00A1","\u00AB","\u00BB",
];
function decodeCp437(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    if (b < 0x80) out += String.fromCharCode(b);
    else if (b < 0xB0) out += CP437_UTF8[b - 0x80];
    else out += String.fromCharCode(b); // rango box-drawing: fallback directo
  }
  return out;
}

/**
 * Lee el archivo ZIP de manera "streaming" usando Blob.slice() para evitar
 * cargar todo el archivo (que puede ser de >100MB) en memoria.
 * 
 * @param file El archivo o blob ZIP.
 * @param onEntry Callback invocado por cada archivo encontrado. Recibe el nombre
 * y una función para obtener los bytes de ese archivo de manera perezosa.
 */
export async function readZipStream(
  file: File | Blob,
  onEntry: (name: string, getBytes: () => Promise<Uint8Array>) => Promise<void>
): Promise<void> {
  const size = file.size;
  const tdUtf8 = new TextDecoder("utf-8", { fatal: false });

  // 1. Encontrar EOCD (End of Central Directory) al final del archivo.
  // 65558 = 22 (header EOCD fijo) + 65536 (max comment length per spec ZIP, uint16).
  const EOCD_MAX_SCAN = 22 + 65536;
  const eocdScanSize = Math.min(size, EOCD_MAX_SCAN);
  const eocdBlob = file.slice(size - eocdScanSize);
  const eocdBuf = await eocdBlob.arrayBuffer();
  const eocdBytes = new Uint8Array(eocdBuf);
  const eocdDv = new DataView(eocdBuf);

  let eocdPos = -1;
  for (let i = eocdBytes.length - 22; i >= 0; i--) {
    if (eocdDv.getUint32(i, true) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos < 0) throw new Error("ZIP inválido — EOCD no encontrado.");

  const cdCount = eocdDv.getUint16(eocdPos + 10, true);
  const cdSize = eocdDv.getUint32(eocdPos + 12, true);
  const cdOffset = eocdDv.getUint32(eocdPos + 16, true);
  if (cdCount === 0) throw new Error("ZIP vacío.");

  // 2. Leer el Central Directory completo.
  // Sigue siendo razonable leerlo en memoria ya que suele ser pequeño (<1MB).
  const cdBlob = file.slice(cdOffset, cdOffset + cdSize);
  const cdBuf = await cdBlob.arrayBuffer();
  const cdBytes = new Uint8Array(cdBuf);
  const cdDv = new DataView(cdBuf);

  let p = 0;
  for (let i = 0; i < cdCount; i++) {
    if (cdDv.getUint32(p, true) !== 0x02014b50) break;
    const flags = cdDv.getUint16(p + 8, true);
    const method = cdDv.getUint16(p + 10, true);
    const csize = cdDv.getUint32(p + 20, true);
    const fnLen = cdDv.getUint16(p + 28, true);
    const exLen = cdDv.getUint16(p + 30, true);
    const cmLen = cdDv.getUint16(p + 32, true);
    const lhOff = cdDv.getUint32(p + 42, true);
    const fnBytes = cdBytes.subarray(p + 46, p + 46 + fnLen);
    const isUtf8 = (flags & 0x0800) !== 0;
    const name = isUtf8 ? tdUtf8.decode(fnBytes) : decodeCp437(fnBytes);

    // Función perezosa para obtener los bytes del archivo.
    const getBytes = async (): Promise<Uint8Array> => {
      // Leer Local Header para saber el offset real de los datos.
      // El Local Header mide 30 bytes + filename + extra.
      const lhBlob = file.slice(lhOff, lhOff + 30 + 1024); // buffer generoso
      const lhBuf = await lhBlob.arrayBuffer();
      const lhDv = new DataView(lhBuf);
      if (lhDv.getUint32(0, true) !== 0x04034b50) throw new Error(`LH inválido para ${name}`);
      
      const lhFnLen = lhDv.getUint16(26, true);
      const lhExLen = lhDv.getUint16(28, true);
      const dataStart = lhOff + 30 + lhFnLen + lhExLen;
      
      const dataBlob = file.slice(dataStart, dataStart + csize);
      const raw = new Uint8Array(await dataBlob.arrayBuffer());
      
      if (method === 0) return raw;
      if (method === 8) return await inflateBytes(raw);
      throw new Error(`Método de compresión ${method} no soportado para ${name}`);
    };

    await onEntry(name, getBytes);
    p += 46 + fnLen + exLen + cmLen;
  }
}

export type ZipReadResult = {
  entries: Record<string, Uint8Array>;
  /** Entradas que fallaron — caller puede notificar UI o decidir abortar. */
  failures: Array<{ name: string; error: Error }>;
};

export async function readZip(file: File | Blob): Promise<ZipReadResult> {
  const entries: Record<string, Uint8Array> = {};
  const failures: Array<{ name: string; error: Error }> = [];
  await readZipStream(file, async (name, getBytes) => {
    try {
      entries[name] = await getBytes();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.warn("[readZip] fallo:", name, error);
      failures.push({ name, error });
    }
  });
  return { entries, failures };
}

