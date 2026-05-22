// Fetch URLs firmadas de S3 (Amplify Storage Gen 2).
//
// Genera presigned URLs (válidas 60min default) para fotos almacenadas
// en S3 bajo path photos/{tenantId}/{filename}. Cachea URL por filename
// para evitar re-firmar en cada render.
//
// Estrategia lazy: solo se firma URL cuando el legacy `imgUrl(fname)`
// pide una foto que NO está en zipImgs local. Permite que multi-user vea
// fotos sin pre-fetch masivo.

import { list, getUrl } from "aws-amplify/storage";

const urlCache = new Map<string, { url: string; expires: number }>();
const indexCache = new Map<string, Set<string>>(); // tenantId → set of available filenames

const URL_TTL_MS = 50 * 60 * 1000; // refrescar antes de los 60min default

/**
 * Lista todas las fotos disponibles en S3 para un tenant.
 * Llamar UNA vez al boot post-login. Cachea el set de filenames.
 *
 * Retorna count + el set para uso interno.
 */
export async function indexCloudPhotos(tenantId: string): Promise<number> {
  const prefix = `photos/${tenantId}/`;
  const result = await list({ path: prefix });
  const filenames = new Set<string>();
  for (const item of result.items) {
    const fname = item.path.slice(prefix.length).toLowerCase();
    if (fname) filenames.add(fname);
  }
  indexCache.set(tenantId, filenames);
  return filenames.size;
}

/** Check sin red: si el filename está en el índice del tenant. */
export function hasCloudPhoto(tenantId: string, filename: string): boolean {
  const idx = indexCache.get(tenantId);
  if (!idx) return false;
  return idx.has(filename.toLowerCase());
}

/**
 * Obtiene URL firmada de S3 para una foto. Cachea por TTL.
 * Async — el legacy `imgUrl` debe envolver en pre-fetch o usar callback.
 */
export async function getCloudPhotoUrl(
  tenantId: string,
  filename: string,
): Promise<string | null> {
  const key = filename.toLowerCase();
  const cached = urlCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.url;

  if (!hasCloudPhoto(tenantId, key)) return null;

  try {
    const result = await getUrl({ path: `photos/${tenantId}/${key}` });
    const url = result.url.toString();
    urlCache.set(key, { url, expires: Date.now() + URL_TTL_MS });
    return url;
  } catch {
    return null;
  }
}

/**
 * Pre-firma URLs para una lista de filenames. Útil para batch render de
 * un panel de fotos. Devuelve map filename → url (null si no encontrado).
 */
export async function batchGetCloudPhotoUrls(
  tenantId: string,
  filenames: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  await Promise.all(
    filenames.map(async (f) => {
      out.set(f.toLowerCase(), await getCloudPhotoUrl(tenantId, f));
    }),
  );
  return out;
}

export function clearPhotoCache(): void {
  urlCache.clear();
  indexCache.clear();
}
