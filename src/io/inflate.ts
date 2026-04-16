// Descompresión deflate-raw con DecompressionStream nativo.
// Navegadores modernos: Chrome 80+, Edge 80+, Firefox 113+, Safari 16.4+.
// Fallback: lanza error; quien lo necesite puede importar pureInflate legado.

export async function inflateBytes(src: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream no soportado — actualiza el navegador.");
  }
  const blob = new Blob([src as BlobPart]);
  const ds = new DecompressionStream("deflate-raw");
  const stream = blob.stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}
