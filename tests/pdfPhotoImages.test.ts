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
  dimensionesDestino,
  esImagenSoportada,
  formatoDeBytes,
  pixelesPorMm,
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

// ── Reescalado ────────────────────────────────────────────────────────────────
// jsPDF re-encoda cada imagen a JPEG calidad 100, así que una foto de 64 KB acababa
// pesando ~700 KB dentro del PDF y una inspección de ~37 fotos daba ~25 MB —
// inservible para enviar por correo. En el papel cada foto mide 58×44 mm: todo pixel
// por encima de esa resolución es peso puro.
describe("pixelesPorMm", () => {
  it("convierte milímetros de papel a píxeles a la densidad dada", () => {
    expect(Math.round(pixelesPorMm(58, 150))).toBe(343); // 58mm / 25.4 * 150
    expect(Math.round(pixelesPorMm(25.4, 200))).toBe(200); // una pulgada exacta
  });

  it("no truena con cero o valores absurdos", () => {
    expect(pixelesPorMm(0, 150)).toBe(0);
    expect(pixelesPorMm(58, 0)).toBe(0);
    expect(pixelesPorMm(-5, 150)).toBe(0);
  });
});

describe("dimensionesDestino", () => {
  it("reduce una foto grande manteniendo la proporción", () => {
    const d = dimensionesDestino({ ancho: 4000, alto: 3000 }, { ancho: 400, alto: 300 });
    expect(d).toEqual({ ancho: 400, alto: 300 });
  });

  it("una foto apaisada la limita el ancho", () => {
    const d = dimensionesDestino({ ancho: 4000, alto: 1000 }, { ancho: 400, alto: 300 });
    expect(d).toEqual({ ancho: 400, alto: 100 });
  });

  it("una foto vertical la limita el alto", () => {
    const d = dimensionesDestino({ ancho: 1000, alto: 4000 }, { ancho: 400, alto: 300 });
    expect(d).toEqual({ ancho: 75, alto: 300 });
  });

  // Ampliar solo agregaría peso sin ganar nitidez.
  it("NUNCA amplía una foto que ya es más chica que el marco", () => {
    const d = dimensionesDestino({ ancho: 200, alto: 150 }, { ancho: 400, alto: 300 });
    expect(d).toEqual({ ancho: 200, alto: 150 });
  });

  it("devuelve enteros (el canvas no acepta fracciones)", () => {
    const d = dimensionesDestino({ ancho: 1333, alto: 999 }, { ancho: 343, alto: 260 });
    expect(Number.isInteger(d.ancho)).toBe(true);
    expect(Number.isInteger(d.alto)).toBe(true);
  });

  it("no truena ni divide por cero con dimensiones inválidas", () => {
    expect(dimensionesDestino({ ancho: 0, alto: 0 }, { ancho: 400, alto: 300 })).toEqual({
      ancho: 0,
      alto: 0,
    });
    expect(dimensionesDestino({ ancho: 100, alto: 100 }, { ancho: 0, alto: 0 })).toEqual({
      ancho: 100,
      alto: 100,
    });
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

  it("aplica `optimizar` y usa el resultado", async () => {
    const r = await descargarImagenes([foto("a.webp")], {
      fetchBytes: async () => WEBP_VP8X,
      optimizar: async () => ({ bytes: JPEG, formato: "JPEG" }),
    });
    expect(r.listas[0]!.formato).toBe("JPEG");
    expect(r.listas[0]!.bytes).toBe(JPEG);
  });

  // Degradación elegante: más vale una foto pesada que ninguna foto.
  it("si `optimizar` devuelve null, conserva el original", async () => {
    const r = await descargarImagenes([foto("a.webp")], {
      fetchBytes: async () => WEBP_VP8X,
      optimizar: async () => null,
    });
    expect(r.listas[0]!.formato).toBe("WEBP");
    expect(r.fallidas).toEqual([]);
  });

  it("si `optimizar` lanza, conserva el original, lo registra y NO pierde la foto", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const r = await descargarImagenes([foto("a.webp")], {
        fetchBytes: async () => WEBP_VP8X,
        optimizar: async () => {
          throw new Error("canvas no disponible");
        },
      });
      expect(r.listas).toHaveLength(1);
      expect(r.listas[0]!.formato).toBe("WEBP");
      expect(r.fallidas).toEqual([]);
      expect(warn).toHaveBeenCalledOnce(); // el fallo queda visible, no en silencio
    } finally {
      warn.mockRestore();
    }
  });

  // El canvas puede devolver un blob vacío; incrustar 0 bytes daría una foto rota.
  it("si `optimizar` devuelve bytes vacíos, conserva el original", async () => {
    const r = await descargarImagenes([foto("a.webp")], {
      fetchBytes: async () => WEBP_VP8X,
      optimizar: async () => ({ bytes: new Uint8Array(), formato: "JPEG" }),
    });
    expect(r.listas[0]!.formato).toBe("WEBP");
  });

  it("recibe los bytes y el formato ya detectado", async () => {
    const vistos: string[] = [];
    await descargarImagenes([foto("a.webp")], {
      fetchBytes: async () => WEBP_VP8X,
      optimizar: async (bytes, formato) => {
        vistos.push(`${formato}:${bytes.length}`);
        return null;
      },
    });
    expect(vistos).toEqual([`WEBP:${WEBP_VP8X.length}`]);
  });

  it("lista vacía → no descarga nada", async () => {
    const fetchBytes = vi.fn();
    const r = await descargarImagenes([], { fetchBytes });
    expect(r.listas).toEqual([]);
    expect(r.fallidas).toEqual([]);
    expect(fetchBytes).not.toHaveBeenCalled();
  });
});
