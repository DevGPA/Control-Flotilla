import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard de la CSP para VIDEO (fix 2026-07-23): los <video> no se rigen por
 * img-src sino por media-src; sin ella caen a default-src 'self' y el
 * navegador bloquea los mp4 firmados de S3 → galería mostraba "No disponible"
 * aunque el objeto existiera. img-src y media-src deben permitir el bucket.
 */
describe("CSP del HTML principal", () => {
  const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";

  it("img-src permite el bucket S3 (fotos)", () => {
    expect(meta).toMatch(/img-src[^;]*https:\/\/\*\.amazonaws\.com/);
  });

  it("media-src permite el bucket S3 (videos de inspecciones)", () => {
    expect(meta).toMatch(/media-src[^;]*https:\/\/\*\.amazonaws\.com/);
  });
});
