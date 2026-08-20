import { describe, expect, it } from "vitest";
import { Jimp, JimpMime } from "jimp";
import { CALIDAD_JPEG, LADO_MAX, preparaImagen } from "../src/vision/resize";

async function imagenSintetica(w: number, h: number): Promise<Buffer> {
  const img = new Jimp({ width: w, height: h, color: 0x3366ccff });
  return img.getBuffer(JimpMime.png);
}

describe("preparaImagen: reescalado para Bedrock (óptimo de visión + límite de payload)", () => {
  it("una foto grande queda con lado largo ≤ LADO_MAX, en JPEG y conservando proporción", async () => {
    const grande = await imagenSintetica(3000, 2000);
    const { data, mediaType } = await preparaImagen(grande);

    expect(mediaType).toBe("image/jpeg");
    // Magic bytes JPEG: FF D8
    expect(data[0]).toBe(0xff);
    expect(data[1]).toBe(0xd8);

    const relee = await Jimp.read(data);
    expect(Math.max(relee.width, relee.height)).toBeLessThanOrEqual(LADO_MAX);
    // proporción 3:2 conservada (±1px por redondeo)
    expect(Math.abs(relee.width / relee.height - 1.5)).toBeLessThan(0.01);
  });

  it("una foto pequeña NO se agranda (solo se transcodifica a JPEG)", async () => {
    const chica = await imagenSintetica(800, 600);
    const { data } = await preparaImagen(chica);
    const relee = await Jimp.read(data);
    expect(relee.width).toBe(800);
    expect(relee.height).toBe(600);
  });

  it("constantes del contrato: 1568px (óptimo visión Claude) y calidad ~80", () => {
    expect(LADO_MAX).toBe(1568);
    expect(CALIDAD_JPEG).toBeGreaterThanOrEqual(70);
    expect(CALIDAD_JPEG).toBeLessThanOrEqual(90);
  });
});
