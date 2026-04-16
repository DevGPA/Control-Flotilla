import { describe, expect, it } from "vitest";
import { inflateBytes } from "../src/io/inflate";

async function deflateRaw(input: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate-raw");
  const blob = new Blob([input as BlobPart]);
  const stream = blob.stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("inflateBytes", () => {
  it("round-trip ASCII", async () => {
    const src = new TextEncoder().encode("Hello, GPA flotilla!");
    const compressed = await deflateRaw(src);
    const out = await inflateBytes(compressed);
    expect(new TextDecoder().decode(out)).toBe("Hello, GPA flotilla!");
  });

  it("round-trip UTF-8 con tildes (Refacción)", async () => {
    const text = "Refacción Copiloto Trasera INTERNA";
    const src = new TextEncoder().encode(text);
    const compressed = await deflateRaw(src);
    const out = await inflateBytes(compressed);
    expect(new TextDecoder().decode(out)).toBe(text);
  });

  it("round-trip binary zeros", async () => {
    const src = new Uint8Array(1024);
    const compressed = await deflateRaw(src);
    const out = await inflateBytes(compressed);
    expect(out.length).toBe(1024);
    expect(out.every((b) => b === 0)).toBe(true);
  });

  it("empty input → empty output", async () => {
    const compressed = await deflateRaw(new Uint8Array(0));
    const out = await inflateBytes(compressed);
    expect(out.length).toBe(0);
  });
});
