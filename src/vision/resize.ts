/**
 * Reescalado de evidencias antes de enviarlas a Bedrock (Fase 1 visión IA).
 *
 * Las fotos de Ops llegan a S3 en tamaño original (cientos de KB a varios MB); la
 * visión de Claude no gana precisión arriba de ~1568px de lado largo y el payload
 * base64 tiene que quedar muy por debajo del límite de 5 MB por imagen. jimp y no
 * sharp: JS puro, sin binario nativo que pelee con el bundling esbuild de Amplify.
 * (Mismo espíritu que el reescalado del PDF: 682 KB → 31 KB por foto.)
 */
import { Jimp, JimpMime } from "jimp";

/** Lado largo máximo — óptimo de visión de Claude; nunca se agranda una foto chica. */
export const LADO_MAX = 1568;
export const CALIDAD_JPEG = 80;

export interface ImagenPreparada {
  data: Buffer;
  mediaType: "image/jpeg";
}

/** Reescala (solo hacia abajo) y transcodifica a JPEG listo para content block. */
export async function preparaImagen(bytes: Buffer | Uint8Array): Promise<ImagenPreparada> {
  const img = await Jimp.read(Buffer.from(bytes));
  const lado = Math.max(img.width, img.height);
  if (lado > LADO_MAX) {
    const escala = LADO_MAX / lado;
    img.resize({
      w: Math.round(img.width * escala),
      h: Math.round(img.height * escala),
    });
  }
  const data = await img.getBuffer(JimpMime.jpeg, { quality: CALIDAD_JPEG });
  return { data, mediaType: "image/jpeg" };
}
