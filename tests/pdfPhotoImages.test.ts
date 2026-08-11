// El registro fotográfico del PDF salía en blanco: se le pasaba a jsPDF la URL de la foto
// en vez de sus BYTES. jsPDF solo sabe resolver una URL con un XMLHttpRequest SINCRÓNICO
// interno cuyo error se traga (`try{…}catch(is){}`), y al fallar usa como respaldo el
// formato declarado a mano ("JPEG") → procesa la URL como si fuera un JPEG, no incrusta
// nada y NO lanza excepción (por eso ni el recuadro "Sin imagen" aparecía).
//
// Verificado contra prod (2026-08-11): pasar la URL produce un PDF de 3,757 bytes; pasar
// los bytes reales de la misma foto, 599,497. Este módulo baja los bytes y detecta el
// formato de los propios bytes, para no volver a depender de ese camino.
import { describe, expect, it, vi } from "vitest";

import {
  descargarImagenes,
  esImagenSoportada,
  formatoDeBytes,
  type FotoParaPdf,
} from "../src/pdf/photoImages";

const bytes = (...b: number[]): Uint8Array => new Uint8Array(b);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const GIF = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
/** RIFF....WEBPVP8X — la variante extendida que usa Ops-GPA (agosto 2026). */
const WEBP_VP8X = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58,
]);

describe("esImagenSoportada — los videos no son fotos", () => {
  it("acepta las extensiones de imagen que jsPDF incrusta", () => {
    for (const f of ["a.jpg", "a.jpeg", "a.png", "a.webp", "a.gif", "a.bmp"]) {
      expect(esImagenSoportada(f)).toBe(true);
    }
  });

  // Caso REAL de prod: cada inspección de ene-jul trae ~1 video en el arreglo de fotos
  // (p. ej. moreapp_58n612_92e64bf3_video.mp4). addImage NO lanza error con un mp4 —
  // incrusta basura en silencio — así que hay que filtrarlo aquí.
  it("rechaza videos", () => {
    expect(esImagenSoportada("moreapp_58n612_92e64bf3_video.mp4")).toBe(false);
    expect(esImagenSoportada("clip.mov")).toBe(false);
  });

  it("es indiferente a mayúsculas", () => {
    expect(esImagenSoportada("FOTO.JPG")).toBe(true);
    expect(esImagenSoportada("CLIP.MP4")).toBe(false);
  });

  it("rechaza nombres sin extensión o vacíos", () => {
    expect(esImagenSoportada("sinextension")).toBe(false);
    expect(esImagenSoportada("")).toBe(false);
  });
});

describe("formatoDeBytes — el formato sale de los bytes, no del nombre", () => {
  it("reconoce JPEG, PNG, GIF y WEBP", () => {
    expect(formatoDeBytes(JPEG)).toBe("JPEG");
    expect(formatoDeBytes(PNG)).toBe("PNG");
    expect(formatoDeBytes(GIF)).toBe("GIF");
    expect(formatoDeBytes(WEBP_VP8X)).toBe("WEBP");
  });

  it("devuelve null con bytes que no son imagen (en vez de mentir 'JPEG')", () => {
    expect(formatoDeBytes(bytes(0x00, 0x01, 0x02, 0x03, 0x04, 0x05))).toBeNull();
  });

  it("no truena con entradas demasiado cortas", () => {
    expect(formatoDeBytes(bytes())).toBeNull();
    expect(formatoDeBytes(bytes(0xff))).toBeNull();
  });

  it("un .jpg cuyo contenido real es WEBP se reporta como WEBP", () => {
    // Pasó en prod: el webhook guardó .jpg con ContentType video/*. El nombre miente.
    expect(formatoDeBytes(WEBP_VP8X)).toBe("WEBP");
  });
});

const foto = (fname: string): FotoParaPdf => ({ fname, url: `https://s3/${fname}`, col: fname });

describe("descargarImagenes", () => {
  it("devuelve bytes y formato de cada foto", async () => {
    const r = await descargarImagenes([foto("a.jpg"), foto("b.webp")], {
      fetchBytes: async (url) => (url.endsWith("a.jpg") ? JPEG : WEBP_VP8X),
    });
    expect(r.fallidas).toEqual([]);
    expect(r.listas).toHaveLength(2);
    expect(r.listas[0]).toMatchObject({ fname: "a.jpg", formato: "JPEG" });
    expect(r.listas[1]).toMatchObject({ fname: "b.webp", formato: "WEBP" });
  });

  it("conserva el orden de entrada (el layout del PDF depende de él)", async () => {
    const nombres = ["1.jpg", "2.jpg", "3.jpg", "4.jpg"];
    const r = await descargarImagenes(nombres.map(foto), {
      // La 1 tarda más que las demás: sin cuidado, terminaría al final.
      fetchBytes: async (url) => {
        if (url.endsWith("1.jpg")) await new Promise((res) => setTimeout(res, 20));
        return JPEG;
      },
    });
    expect(r.listas.map((i) => i.fname)).toEqual(nombres);
  });

  it("una foto que falla NO tumba las demás y queda registrada", async () => {
    const r = await descargarImagenes([foto("ok.jpg"), foto("mala.jpg"), foto("ok2.jpg")], {
      fetchBytes: async (url) => {
        if (url.includes("mala")) throw new Error("403 firma vencida");
        return JPEG;
      },
    });
    expect(r.listas.map((i) => i.fname)).toEqual(["ok.jpg", "ok2.jpg"]);
    expect(r.fallidas).toHaveLength(1);
    expect(r.fallidas[0]!.fname).toBe("mala.jpg");
    expect(r.fallidas[0]!.motivo).toContain("403");
  });

  it("bytes irreconocibles van a fallidas — nunca se incrusta basura", async () => {
    const r = await descargarImagenes([foto("rara.jpg")], {
      fetchBytes: async () => bytes(0x00, 0x01, 0x02, 0x03),
    });
    expect(r.listas).toEqual([]);
    expect(r.fallidas[0]!.motivo).toMatch(/formato/i);
  });

  it("reporta avance para el indicador de progreso", async () => {
    const onProgress = vi.fn();
    await descargarImagenes([foto("a.jpg"), foto("b.jpg"), foto("c.jpg")], {
      fetchBytes: async () => JPEG,
      onProgress,
    });
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenLastCalledWith(3, 3);
  });

  it("respeta el límite de descargas simultáneas", async () => {
    let enVuelo = 0;
    let pico = 0;
    await descargarImagenes(
      Array.from({ length: 12 }, (_, i) => foto(`f${i}.jpg`)),
      {
        concurrencia: 4,
        fetchBytes: async () => {
          enVuelo++;
          pico = Math.max(pico, enVuelo);
          await new Promise((res) => setTimeout(res, 5));
          enVuelo--;
          return JPEG;
        },
      },
    );
    expect(pico).toBeLessThanOrEqual(4);
    expect(pico).toBeGreaterThan(1); // y sí baja en paralelo, no en serie
  });

  // El llamador necesita la foto, no solo su URL: en el flujo de ZIP local los bytes ya
  // están en memoria (`zipImgs`) y hay que usarlos directo — un `fetch` a una URL `blob:`
  // lo bloquea la CSP, que no lista `blob:` en connect-src.
  it("le pasa la foto completa a fetchBytes, no solo la URL", async () => {
    const vistas: Array<[string, string]> = [];
    await descargarImagenes([foto("a.jpg")], {
      fetchBytes: async (url, f) => {
        vistas.push([url, f.fname]);
        return JPEG;
      },
    });
    expect(vistas).toEqual([["https://s3/a.jpg", "a.jpg"]]);
  });

  it("lista vacía → no descarga nada", async () => {
    const fetchBytes = vi.fn();
    const r = await descargarImagenes([], { fetchBytes });
    expect(r.listas).toEqual([]);
    expect(r.fallidas).toEqual([]);
    expect(fetchBytes).not.toHaveBeenCalled();
  });
});
