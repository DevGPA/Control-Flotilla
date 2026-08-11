/**
 * Carga de fotos para el registro fotográfico del PDF.
 *
 * ⚠️ NUNCA le pases una URL a `jsPDF.addImage`. jsPDF no sabe descargar imágenes: su
 * único recurso es un `XMLHttpRequest` **SINCRÓNICO** interno (`loadFile`) cuyo error se
 * traga por completo (`try{…}catch(is){}` → devuelve `undefined`). Cuando ese XHR falla:
 *
 *  1. la URL se queda sin convertir a bytes,
 *  2. jsPDF no reconoce el tipo y usa como respaldo **el formato declarado a mano**,
 *  3. procesa la URL como si fuera ese formato → no incrusta nada,
 *  4. y **NO lanza excepción**, así que ningún `catch` del llamador se enteraba.
 *
 * Resultado: el PDF salía con la página "REGISTRO FOTOGRÁFICO", sus títulos y sus pies de
 * foto, y los huecos en blanco. Medido contra prod (2026-08-11): pasar la URL produce un
 * PDF de 3,757 bytes; pasar los bytes reales de la misma foto, 599,497.
 *
 * Este módulo baja los bytes con un fetch INYECTADO (async, en paralelo, con los errores
 * a la vista) y deduce el formato de los propios bytes — el nombre del archivo miente
 * (en prod hay `.jpg` cuyo contenido real es otro).
 */

/** Formatos que `jsPDF.addImage` incrusta de verdad. */
export type PdfImageFormat = "JPEG" | "PNG" | "WEBP" | "GIF" | "BMP";

const EXT_IMAGEN = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp"]);

/**
 * ¿Este nombre de archivo es una imagen incrustable?
 *
 * El arreglo `photos` de una inspección trae también VIDEOS (`.mp4`/`.mov` — ~1 por
 * inspección de ene-jul 2026). Hay que filtrarlos: `addImage` con un mp4 **no lanza
 * error**, incrusta basura en silencio (verificado con un archivo real de prod).
 */
export function esImagenSoportada(fname: string): boolean {
  const s = String(fname ?? "")
    .trim()
    .toLowerCase();
  const punto = s.lastIndexOf(".");
  if (punto <= 0 || punto === s.length - 1) return false;
  return EXT_IMAGEN.has(s.slice(punto + 1));
}

/**
 * Formato deducido de los BYTES (números mágicos), no de la extensión.
 * `null` si no es una imagen reconocible — así nunca se declara "JPEG" a ciegas, que es
 * justo lo que hacía que jsPDF incrustara basura sin protestar.
 */
export function formatoDeBytes(b: Uint8Array): PdfImageFormat | null {
  if (!b || b.length < 4) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "JPEG";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "PNG";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "GIF";
  if (b[0] === 0x42 && b[1] === 0x4d) return "BMP";
  // WEBP = "RIFF" + 4 bytes de tamaño + "WEBP". Cubre las tres variantes (VP8 / VP8L /
  // VP8X); Ops-GPA manda VP8X y jsPDF 4.2.1 las decodifica bien desde bytes.
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "WEBP";
  }
  return null;
}

export interface FotoParaPdf {
  fname: string;
  /** URL ya resuelta (firmada de S3, o cualquier origen que el llamador sepa leer). */
  url: string;
  /** Etiqueta del campo, para el pie de foto. */
  col?: string;
  /** Sección del PDF donde va agrupada. */
  group?: string;
}

export interface ImagenLista extends FotoParaPdf {
  bytes: Uint8Array;
  formato: PdfImageFormat;
}

export interface FotoFallida {
  fname: string;
  motivo: string;
}

export interface ResultadoDescarga {
  /** Listas para `addImage`, EN EL ORDEN DE ENTRADA. */
  listas: ImagenLista[];
  /** Las que no se pudieron usar, con el motivo — para que el fallo sea visible. */
  fallidas: FotoFallida[];
}

export interface OpcionesDescarga {
  /**
   * Inyectado: el llamador decide de dónde salen los bytes. Recibe también la foto porque
   * el origen puede depender de ella — en el flujo de ZIP local los bytes ya están en
   * memoria y hay que usarlos directo (un `fetch` a una URL `blob:` lo bloquea la CSP,
   * que no lista `blob:` en `connect-src`).
   */
  fetchBytes: (url: string, foto: FotoParaPdf) => Promise<Uint8Array>;
  /** Avance para el indicador de progreso. */
  onProgress?: (hechas: number, total: number) => void;
  /** Descargas simultáneas. Bajas de más saturan la red; de menos, tarda. */
  concurrencia?: number;
}

const CONCURRENCIA_DEFAULT = 6;

/**
 * Baja los bytes de cada foto en paralelo (con tope) y valida el formato.
 * Una foto que falle NO tumba las demás: se registra en `fallidas` y el PDF sale con el
 * resto. El orden de `listas` es el de entrada, porque el layout del PDF depende de él.
 */
export async function descargarImagenes(
  fotos: readonly FotoParaPdf[],
  opts: OpcionesDescarga,
): Promise<ResultadoDescarga> {
  const total = fotos.length;
  if (total === 0) return { listas: [], fallidas: [] };

  const { fetchBytes, onProgress } = opts;
  const limite = Math.max(1, opts.concurrencia ?? CONCURRENCIA_DEFAULT);

  // Resultados por ÍNDICE: las descargas terminan desordenadas y el orden importa.
  const porIndice = new Array<ImagenLista | null>(total).fill(null);
  const fallidas: FotoFallida[] = [];
  let siguiente = 0;
  let hechas = 0;

  const trabajador = async (): Promise<void> => {
    for (;;) {
      const i = siguiente++;
      if (i >= total) return;
      const f = fotos[i]!;
      try {
        const bytes = await fetchBytes(f.url, f);
        const formato = formatoDeBytes(bytes);
        if (formato) {
          porIndice[i] = { ...f, bytes, formato };
        } else {
          fallidas.push({ fname: f.fname, motivo: "formato de imagen no reconocido" });
        }
      } catch (e) {
        fallidas.push({ fname: f.fname, motivo: (e as Error)?.message || String(e) });
      }
      hechas++;
      onProgress?.(hechas, total);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limite, total) }, trabajador));
  return { listas: porIndice.filter((x): x is ImagenLista => x !== null), fallidas };
}
