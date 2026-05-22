// Upload de fotos a S3 (Amplify Storage Gen 2).
//
// Path convention: photos/{tenantId}/{filename}
// El bucket se configura en amplify/storage/resource.ts con auth rules
// `allow.authenticated.to(['read', 'write', 'delete'])` — solo usuarios
// logueados del tenant pueden acceder.
//
// Estrategia:
// 1. uploadPhotosToS3 sube N imágenes en paralelo con batches limitados
//    (evita saturar el browser con miles de Promise pending).
// 2. Cada blob se sube via uploadData de aws-amplify/storage.
// 3. Resultado: count de éxitos/fallos para reportar al user.

import { uploadData } from "aws-amplify/storage";

interface PhotoUploadResult {
  uploaded: number;
  skipped: number;
  errors: { filename: string; error: string }[];
  duration_ms: number;
}

interface UploadOptions {
  /** Tamaño del batch paralelo (default 8). */
  concurrency?: number;
  /** Callback de progreso — invocado cada batch. */
  onProgress?: (done: number, total: number) => void;
}

function buildPhotoPath(tenantId: string, filename: string): string {
  // Sanitiza filename: lowercase + basename only (sin slashes).
  const clean = filename.split("/").pop()?.toLowerCase().trim() ?? filename;
  return `photos/${tenantId}/${clean}`;
}

async function uploadOne(
  tenantId: string,
  filename: string,
  data: Uint8Array,
): Promise<void> {
  const path = buildPhotoPath(tenantId, filename);
  // Inferir content-type por extensión.
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const contentType =
    ext === "png"
      ? "image/png"
      : ext === "gif"
        ? "image/gif"
        : ext === "webp"
          ? "image/webp"
          : "image/jpeg";

  // BlobPart cast para Uint8Array (Vite ESM strict).
  const blob = new Blob([data as BlobPart], { type: contentType });
  await uploadData({
    path,
    data: blob,
    options: { contentType },
  }).result;
}

/**
 * Sube fotos a S3 en paralelo. Idempotente — S3 sobrescribe por path,
 * misma foto re-subida no crea duplicados (mismo path).
 */
export async function uploadPhotosToS3(
  images: Record<string, Uint8Array>,
  tenantId: string,
  options: UploadOptions = {},
): Promise<PhotoUploadResult> {
  const start = Date.now();
  const concurrency = options.concurrency ?? 8;
  const filenames = Object.keys(images);
  const total = filenames.length;
  const result: PhotoUploadResult = {
    uploaded: 0,
    skipped: 0,
    errors: [],
    duration_ms: 0,
  };

  for (let i = 0; i < filenames.length; i += concurrency) {
    const batch = filenames.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map((fname) => uploadOne(tenantId, fname, images[fname]!)),
    );
    settled.forEach((s, idx) => {
      const fname = batch[idx]!;
      if (s.status === "fulfilled") {
        result.uploaded++;
      } else {
        result.errors.push({ filename: fname, error: (s.reason as Error).message });
      }
    });
    options.onProgress?.(Math.min(i + concurrency, total), total);
  }

  result.duration_ms = Date.now() - start;
  return result;
}

export type { PhotoUploadResult };
