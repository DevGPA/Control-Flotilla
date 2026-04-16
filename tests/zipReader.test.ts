import { describe, expect, it } from "vitest";
import { readZip } from "../src/io/zipReader";

// ─── Helpers para construir ZIPs mínimos en memoria ─────────────────────

async function deflateRaw(input: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate-raw");
  const blob = new Blob([input as BlobPart]);
  return new Uint8Array(await new Response(blob.stream().pipeThrough(cs)).arrayBuffer());
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

type ZipFile = {
  name: Uint8Array; // raw bytes del filename
  data: Uint8Array;
  compressed: Uint8Array;
  method: number; // 0 = stored, 8 = deflated
  utf8Flag: boolean;
};

async function buildZip(files: Array<{ name: Uint8Array; data: Uint8Array; method?: number; utf8?: boolean }>): Promise<Blob> {
  const entries: ZipFile[] = [];
  for (const f of files) {
    const method = f.method ?? 8;
    const compressed = method === 0 ? f.data : await deflateRaw(f.data);
    entries.push({ name: f.name, data: f.data, compressed, method, utf8Flag: f.utf8 ?? true });
  }

  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let offset = 0;

  for (const e of entries) {
    offsets.push(offset);
    const flags = e.utf8Flag ? 0x0800 : 0x0000;
    const lh = concat(
      u32(0x04034b50), // local file header sig
      u16(20), // version needed
      u16(flags),
      u16(e.method),
      u16(0), u16(0), // time, date
      u32(0), // crc32 (no lo validamos en el reader)
      u32(e.compressed.length),
      u32(e.data.length),
      u16(e.name.length),
      u16(0), // extra len
      e.name,
      e.compressed,
    );
    localChunks.push(lh);
    offset += lh.length;
  }

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const flags = e.utf8Flag ? 0x0800 : 0x0000;
    const cd = concat(
      u32(0x02014b50), // central dir sig
      u16(20), u16(20), // version made by / needed
      u16(flags),
      u16(e.method),
      u16(0), u16(0),
      u32(0),
      u32(e.compressed.length),
      u32(e.data.length),
      u16(e.name.length),
      u16(0), u16(0), // extra, comment
      u16(0), u16(0), // disk, internal attrs
      u32(0), // external attrs
      u32(offsets[i]),
      e.name,
    );
    centralChunks.push(cd);
  }

  const cdStart = offset;
  const cdBytes = concat(...centralChunks);
  const eocd = concat(
    u32(0x06054b50),
    u16(0), u16(0),
    u16(entries.length), u16(entries.length),
    u32(cdBytes.length),
    u32(cdStart),
    u16(0),
  );

  const final = concat(concat(...localChunks), cdBytes, eocd);
  return new Blob([final as BlobPart]);
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("readZip", () => {
  it("parsea archivos deflate-compressed con nombres UTF-8", async () => {
    const zip = await buildZip([
      { name: new TextEncoder().encode("hola.txt"), data: new TextEncoder().encode("Hola mundo"), method: 8, utf8: true },
      { name: new TextEncoder().encode("refacción.txt"), data: new TextEncoder().encode("tildes ok"), method: 8, utf8: true },
    ]);
    const out = await readZip(zip);
    expect(Object.keys(out).sort()).toEqual(["hola.txt", "refacción.txt"]);
    expect(new TextDecoder().decode(out["hola.txt"])).toBe("Hola mundo");
    expect(new TextDecoder().decode(out["refacción.txt"])).toBe("tildes ok");
  });

  it("parsea archivos stored (method 0, sin compresión)", async () => {
    const data = new TextEncoder().encode("no comprimido");
    const zip = await buildZip([{ name: new TextEncoder().encode("raw.bin"), data, method: 0, utf8: true }]);
    const out = await readZip(zip);
    expect(new TextDecoder().decode(out["raw.bin"])).toBe("no comprimido");
  });

  it("decodifica filenames CP437 cuando el flag UTF-8 no está seteado", async () => {
    // "Refacción.xlsx" en CP437: R=0x52 e=0x65 f=0x66 a=0x61 c=0x63 c=0x63 i=0x69 ó=0xA2 n=0x6E . x l s x
    const cp437Name = new Uint8Array([0x52, 0x65, 0x66, 0x61, 0x63, 0x63, 0x69, 0xA2, 0x6E, 0x2E, 0x78, 0x6C, 0x73, 0x78]);
    const zip = await buildZip([{ name: cp437Name, data: new TextEncoder().encode("payload"), method: 8, utf8: false }]);
    const out = await readZip(zip);
    const keys = Object.keys(out);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe("Refacción.xlsx");
  });

  it("lanza error si no hay EOCD", async () => {
    const junk = new Blob([new Uint8Array(100) as BlobPart]);
    await expect(readZip(junk)).rejects.toThrow(/EOCD/);
  });

  it("lanza error si el ZIP está vacío (cdCount=0)", async () => {
    const eocd = concat(
      u32(0x06054b50),
      u16(0), u16(0),
      u16(0), u16(0),
      u32(0),
      u32(0),
      u16(0),
    );
    await expect(readZip(new Blob([eocd as BlobPart]))).rejects.toThrow(/vacío/);
  });
});
