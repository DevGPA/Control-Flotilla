// Fetch URLs firmadas de S3 (Amplify Storage Gen 2).
//
// Genera presigned URLs para fotos almacenadas en S3 bajo el path
// photos/{tenantId}/{filename}. Cachea la URL por (tenant+filename) para
// evitar re-firmar en cada render.
//
// Estrategia: firma POR-DEMANDA. Cada URL se genera localmente con las
// credenciales Cognito de la sesión (getUrl NO valida existencia ni lista el
// bucket → barato). NO se indexa el bucket: ver getCloudPhotoUrl para el porqué.

import { getUrl } from "aws-amplify/storage";

const urlCache = new Map<string, { url: string; expires: number }>();

// Fallback si getUrl no devolviera expiresAt (no debería pasar). El vencimiento real
// del presign lo da result.expiresAt — Amplify default ≈15min, acotado además por la
// credencial Cognito. ANTES se asumía 50min fijo → el cache servía URLs ya muertas.
const URL_TTL_MS = 15 * 60 * 1000;
const SKEW_MS = 60 * 1000; // margen para no servir una URL a punto de vencer

/**
 * Obtiene URL firmada de S3 para una foto. Cachea por TTL.
 * Async — el legacy `imgUrl` debe envolver en pre-fetch o usar callback.
 */
export async function getCloudPhotoUrl(
  tenantId: string,
  filename: string,
  opts?: { force?: boolean },
): Promise<string | null> {
  const key = filename.toLowerCase();
  // Firma DIRECTA por-demanda (fix de raíz 2026-06-15). ANTES esto exigía que el
  // filename estuviera en un índice del bucket COMPLETO: `indexCloudPhotos` listaba
  // las ~22k fotos del tenant al boot (≈23 páginas secuenciales) y sin ese índice
  // toda firma devolvía null. Con el bucket ya grande ese listado fallaba/no
  // completaba (timeout, credencial expirada, race multi-user) → NINGUNA foto se
  // firmaba y la UI mostraba "Sin fotos disponibles" pese a existir en S3.
  // Ya no se indexa: el path photos/{tenantId}/ AÍSLA por tenant (sin fuga
  // cross-tenant) y si la foto no existe la URL da 403/404 → el onerror del <img>
  // (photoImgErr) re-firma una vez y, si vuelve a fallar, muestra placeholder limpio.
  // Cache POR-TENANT (los basenames de MoreApp son poco únicos entre tenants → con
  // clave sin prefijo un cache-hit servía la URL firmada del otro tenant).
  const ck = `${tenantId}/${key}`;
  const cached = urlCache.get(ck);
  if (!opts?.force && cached && cached.expires > Date.now()) return cached.url;

  try {
    const result = await getUrl({ path: `photos/${tenantId}/${key}` });
    const url = result.url.toString();
    // Vencimiento REAL del presign (no un fijo adivinado). Restamos skew para no
    // entregar una URL que muere en segundos.
    const realExpiry =
      result.expiresAt instanceof Date ? result.expiresAt.getTime() : Date.now() + URL_TTL_MS;
    urlCache.set(ck, { url, expires: realExpiry - SKEW_MS });
    return url;
  } catch {
    return null;
  }
}

/** Entrada de URL firmada con su vencimiento real (para cachear con TTL honesto). */
export interface PhotoUrlEntry {
  url: string;
  expires: number;
}

/** Lee la entrada {url, expires} cacheada tras firmar (null si no se firmó).
 * La clave es la usada por urlCache: `${tenantId}/${filename}`. */
function entryFor(cacheKey: string): PhotoUrlEntry | null {
  const c = urlCache.get(cacheKey);
  return c ? { url: c.url, expires: c.expires } : null;
}

/**
 * Perf lag 2026-07-13: presignar es CPU LOCAL (SigV4 + SHA-256 + decodeJWT por
 * cada getUrl) — un Promise.all de cientos/miles corre como UNA sola cadena de
 * microtareas que nunca cede el hilo (long task de 3-4s medido en prod durante
 * la hidratación). Se trocea en lotes con cesión de MACROtarea entre ellos:
 * mismo resultado, la UI respira entre lotes.
 */
const SIGN_CHUNK = 40;
const yieldToMain = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function signChunked(
  filenames: string[],
  signOne: (f: string) => Promise<string | null>,
  tenantId: string,
): Promise<Map<string, PhotoUrlEntry | null>> {
  const out = new Map<string, PhotoUrlEntry | null>();
  for (let i = 0; i < filenames.length; i += SIGN_CHUNK) {
    const chunk = filenames.slice(i, i + SIGN_CHUNK);
    await Promise.all(
      chunk.map(async (f) => {
        const key = f.toLowerCase();
        const url = await signOne(f);
        out.set(key, url ? entryFor(`${tenantId}/${key}`) : null);
      }),
    );
    if (i + SIGN_CHUNK < filenames.length) await yieldToMain();
  }
  return out;
}

/**
 * Pre-firma URLs para una lista de filenames. Útil para batch render de un panel de
 * fotos. Devuelve map filename → {url, expires} (null si no encontrado).
 */
export async function batchGetCloudPhotoUrls(
  tenantId: string,
  filenames: string[],
): Promise<Map<string, PhotoUrlEntry | null>> {
  return signChunked(filenames, (f) => getCloudPhotoUrl(tenantId, f), tenantId);
}

/**
 * Re-firma URLs frescas para una lista de fnames (force:true ignora el cache).
 * Firmar es local/barato (pero ver nota de troceo arriba). Usado por el
 * auto-refresh para renovar URLs próximas a vencer sin costo de red extra.
 */
export async function refreshPhotoUrls(
  tenantId: string,
  filenames: string[],
): Promise<Map<string, PhotoUrlEntry | null>> {
  return signChunked(filenames, (f) => getCloudPhotoUrl(tenantId, f, { force: true }), tenantId);
}

export function clearPhotoCache(): void {
  urlCache.clear();
}
