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

// Fallback si getUrl no devolviera expiresAt (no debería pasar). El vencimiento real
// del presign lo da result.expiresAt — Amplify default ≈15min, acotado además por la
// credencial Cognito. ANTES se asumía 50min fijo → el cache servía URLs ya muertas.
const URL_TTL_MS = 15 * 60 * 1000;
const SKEW_MS = 60 * 1000; // margen para no servir una URL a punto de vencer

/**
 * Lista todas las fotos disponibles en S3 para un tenant.
 * Llamar UNA vez al boot post-login. Cachea el set de filenames.
 *
 * Retorna count + el set para uso interno.
 */
export async function indexCloudPhotos(tenantId: string): Promise<number> {
  const prefix = `photos/${tenantId}/`;
  const filenames = new Set<string>();
  // Pagination: Amplify Storage list devuelve 1000 max default. Si S3 tiene
  // más, debemos iterar con nextToken hasta agotar.
  let nextToken: string | undefined;
  let pages = 0;
  do {
    const result = await list({
      path: prefix,
      options: { pageSize: 1000, ...(nextToken ? { nextToken } : {}) },
    });
    for (const item of result.items) {
      const fname = item.path.slice(prefix.length).toLowerCase();
      if (fname) filenames.add(fname);
    }
    nextToken = result.nextToken;
    pages++;
    // Safety cap: 50 pages × 1000 = 50K fotos. Más allá hay problema mayor.
    if (pages > 50) {
      console.warn("[indexCloudPhotos] pagination cap hit (50 pages)");
      break;
    }
  } while (nextToken);
  indexCache.set(tenantId, filenames);
  console.info(`[indexCloudPhotos] ${filenames.size} fotos indexadas en ${pages} pages`);
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
  opts?: { force?: boolean },
): Promise<string | null> {
  const key = filename.toLowerCase();
  // Verificar pertenencia al tenant ANTES de servir cache, y cachear con clave
  // POR-TENANT: los filenames de MoreApp son poco únicos y dos tenants pueden
  // compartir basename. Con clave sin prefijo, un cache-hit devolvía la URL
  // firmada del otro tenant (la línea de cache estaba ANTES del guard).
  if (!hasCloudPhoto(tenantId, key)) return null;
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
 * Pre-firma URLs para una lista de filenames. Útil para batch render de un panel de
 * fotos. Devuelve map filename → {url, expires} (null si no encontrado).
 */
export async function batchGetCloudPhotoUrls(
  tenantId: string,
  filenames: string[],
): Promise<Map<string, PhotoUrlEntry | null>> {
  const out = new Map<string, PhotoUrlEntry | null>();
  await Promise.all(
    filenames.map(async (f) => {
      const key = f.toLowerCase();
      const url = await getCloudPhotoUrl(tenantId, f);
      out.set(key, url ? entryFor(`${tenantId}/${key}`) : null);
    }),
  );
  return out;
}

/**
 * Re-firma URLs frescas para una lista de fnames SIN re-listar S3 (reusa el índice
 * cacheado de indexCloudPhotos). Firmar es local/barato; el list es lo caro. Usado por
 * el auto-refresh para renovar URLs próximas a vencer sin costo de red extra.
 */
export async function refreshPhotoUrls(
  tenantId: string,
  filenames: string[],
): Promise<Map<string, PhotoUrlEntry | null>> {
  const out = new Map<string, PhotoUrlEntry | null>();
  await Promise.all(
    filenames.map(async (f) => {
      const key = f.toLowerCase();
      const url = await getCloudPhotoUrl(tenantId, f, { force: true });
      out.set(key, url ? entryFor(`${tenantId}/${key}`) : null);
    }),
  );
  return out;
}

export function clearPhotoCache(): void {
  urlCache.clear();
  indexCache.clear();
}
