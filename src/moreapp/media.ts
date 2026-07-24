/**
 * Tipado de medios de las evidencias de MoreApp (fotos y VIDEO).
 *
 * Bug videos del mensual (fix 2026-07-23): `downloadPhotos` del webhook trataba
 * todo `gridfs://` como imagen — el content-type `video/mp4` caía en extensión
 * "jpg" y la galería lo pintaba en `<img>` → irreproducible. La extensión debe
 * derivar del content-type real, y el render debe distinguir video por fname.
 *
 * ⚠ El render legacy (`renderPhotos` en "Control de flotilla.html") duplica el
 * regex de `esVideoFname` inline (no puede importar módulos) — mantener en sync.
 */

/** Extensión de archivo desde el content-type de la descarga. Default histórico: jpg. */
export function extFromContentType(ct: string): string {
  const c = (ct || "").toLowerCase();
  if (c.includes("video/")) {
    if (c.includes("quicktime")) return "mov";
    if (c.includes("webm")) return "webm";
    return "mp4";
  }
  if (c.includes("png")) return "png";
  if (c.includes("webp")) return "webp";
  return "jpg";
}

/** ¿El fname es un video? (la galería lo renderiza con <video>, no <img>). */
export function esVideoFname(fname: string): boolean {
  return /\.(mp4|mov|webm)$/i.test(fname || "");
}
