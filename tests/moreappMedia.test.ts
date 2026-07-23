import { describe, expect, it } from "vitest";
import { extFromContentType, esVideoFname } from "../src/moreapp/media";

/**
 * Bug videos del mensual (2026-07-23): downloadPhotos trataba todo gridfs como
 * imagen — un video/mp4 caía en extensión "jpg" y la galería lo pintaba en <img>
 * → irreproducible. La extensión debe derivar del content-type real.
 */
describe("extFromContentType", () => {
  it("imágenes: png/webp explícitos, jpg como default (compat con lo histórico)", () => {
    expect(extFromContentType("image/png")).toBe("png");
    expect(extFromContentType("image/webp")).toBe("webp");
    expect(extFromContentType("image/jpeg")).toBe("jpg");
    expect(extFromContentType("application/octet-stream")).toBe("jpg");
    expect(extFromContentType("")).toBe("jpg");
  });

  it("videos: mp4/quicktime/webm → extensión de video reproducible", () => {
    expect(extFromContentType("video/mp4")).toBe("mp4");
    expect(extFromContentType("video/quicktime")).toBe("mov");
    expect(extFromContentType("video/webm")).toBe("webm");
  });
});

describe("esVideoFname", () => {
  it("detecta archivos de video por extensión (case-insensitive)", () => {
    expect(esVideoFname("moreapp_jx36945_ab12cd34_video.mp4")).toBe(true);
    expect(esVideoFname("algo.MOV")).toBe(true);
    expect(esVideoFname("clip.webm")).toBe(true);
  });
  it("las fotos no son video", () => {
    expect(esVideoFname("moreapp_jx36945_ab12cd34_video.jpg")).toBe(false);
    expect(esVideoFname("foto.png")).toBe(false);
    expect(esVideoFname("")).toBe(false);
  });
});
