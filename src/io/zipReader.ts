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

export async function readZip(file: File | Blob): Promise<Record<string, Uint8Array>> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const dv = new DataView(buf);
  const tdUtf8 = new TextDecoder("utf-8", { fatal: false });

  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP inválido — EOCD no encontrado.");

  const cdCount = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (cdCount === 0) throw new Error("ZIP vacío.");

  const out: Record<string, Uint8Array> = {};
  let p = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const fnLen = dv.getUint16(p + 28, true);
    const exLen = dv.getUint16(p + 30, true);
    const cmLen = dv.getUint16(p + 32, true);
    const lhOff = dv.getUint32(p + 42, true);
    const fnBytes = bytes.subarray(p + 46, p + 46 + fnLen);
    const isUtf8 = (flags & 0x0800) !== 0;
    const name = isUtf8 ? tdUtf8.decode(fnBytes) : decodeCp437(fnBytes);

    const lhFnLen = dv.getUint16(lhOff + 26, true);
    const lhExLen = dv.getUint16(lhOff + 28, true);
    const dataStart = lhOff + 30 + lhFnLen + lhExLen;
    if (dataStart + csize > bytes.length) {
      p += 46 + fnLen + exLen + cmLen;
      continue;
    }
    const raw = bytes.subarray(dataStart, dataStart + csize);
    try {
      if (method === 0) out[name] = new Uint8Array(raw);
      else if (method === 8) out[name] = await inflateBytes(raw);
    } catch (err) {
      console.warn("[zipReader] fallo:", name, err);
    }
    p += 46 + fnLen + exLen + cmLen;
  }
  return out;
}
