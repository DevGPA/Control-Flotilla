import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { loadZip, ZipLoadError } from "../src/io/zipLoader";

// ─── Helpers para construir ZIPs mínimos con imágenes + XLSX ─────────────

async function deflateRaw(input: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate-raw");
  return new Uint8Array(
    await new Response(new Blob([input as BlobPart]).stream().pipeThrough(cs)).arrayBuffer(),
  );
}

function u16(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
}
function u32(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function buildZipWithEntries(files: Array<{ name: string; data: Uint8Array }>): Promise<Blob> {
  type Entry = { name: Uint8Array; compressed: Uint8Array; size: number; offset: number };
  const enc = new TextEncoder();
  const entries: Entry[] = [];
  const local: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const compressed = await deflateRaw(f.data);
    const flags = 0x0800; // UTF-8
    const lh = concat(
      u32(0x04034b50),
      u16(20),
      u16(flags),
      u16(8), // deflate
      u16(0),
      u16(0),
      u32(0),
      u32(compressed.length),
      u32(f.data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      compressed,
    );
    entries.push({ name: nameBytes, compressed, size: f.data.length, offset });
    offset += lh.length;
    local.push(lh);
  }

  const centralChunks: Uint8Array[] = [];
  for (const e of entries) {
    const cd = concat(
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(8),
      u16(0),
      u16(0),
      u32(0),
      u32(e.compressed.length),
      u32(e.size),
      u16(e.name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(e.offset),
      e.name,
    );
    centralChunks.push(cd);
  }

  const cdStart = offset;
  const cdBytes = concat(...centralChunks);
  const eocd = concat(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(cdBytes.length),
    u32(cdStart),
    u16(0),
  );
  return new Blob([concat(concat(...local), cdBytes, eocd) as BlobPart]);
}

function buildXlsxBytes(): Uint8Array {
  const ws = XLSX.utils.json_to_sheet([{ Eco: "A-117", Placas: "ABC-123" }], {
    header: ["Eco", "Placas"],
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Hoja1");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe("loadZip", () => {
  it("extrae imágenes y XLSX embebido", async () => {
    const zipBlob = await buildZipWithEntries([
      { name: "fotos/IMG_001.jpg", data: new TextEncoder().encode("fake jpg bytes") },
      { name: "fotos/IMG_002.png", data: new TextEncoder().encode("fake png bytes") },
      { name: "reporte.xlsx", data: buildXlsxBytes() },
    ]);
    const r = await loadZip(zipBlob, "paquete.zip");
    expect(r.imageCount).toBe(2);
    expect(Object.keys(r.images).sort()).toEqual(["img_001.jpg", "img_002.png"]);
    expect(r.report).not.toBeNull();
    expect(r.report?.rowCount).toBe(1);
    expect(r.report?.rows[0].Eco).toBe("A-117");
  });

  it("ignora __MACOSX y archivos ocultos", async () => {
    const zipBlob = await buildZipWithEntries([
      { name: "__MACOSX/._IMG.jpg", data: new Uint8Array([1, 2, 3]) },
      { name: ".DS_Store", data: new Uint8Array([4, 5, 6]) },
      { name: "IMG_real.jpg", data: new TextEncoder().encode("real") },
    ]);
    const r = await loadZip(zipBlob);
    expect(r.imageCount).toBe(1);
    expect(r.images["img_real.jpg"]).toBeDefined();
  });

  it("maneja ZIPs solo-fotos (sin xlsx)", async () => {
    const zipBlob = await buildZipWithEntries([
      { name: "a.jpg", data: new TextEncoder().encode("a") },
      { name: "b.png", data: new TextEncoder().encode("b") },
    ]);
    const r = await loadZip(zipBlob);
    expect(r.imageCount).toBe(2);
    expect(r.report).toBeNull();
  });

  it("lanza ZipLoadError si el XLSX embebido es inválido", async () => {
    const zipBlob = await buildZipWithEntries([
      { name: "roto.xlsx", data: new TextEncoder().encode("no soy excel") },
    ]);
    await expect(loadZip(zipBlob)).rejects.toThrow(ZipLoadError);
  });

  it("lanza ZipLoadError si el ZIP está corrupto", async () => {
    const junk = new Blob([new Uint8Array(50) as BlobPart]);
    await expect(loadZip(junk)).rejects.toThrow(ZipLoadError);
  });
});
