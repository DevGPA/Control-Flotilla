import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock de Amplify Storage. getUrl devuelve {url, expiresAt} como el real; así probamos
// que el cache respeta el vencimiento REAL en vez de un TTL fijo adivinado (causa del bug
// "fotos No disponible": URLs vencidas servidas como válidas).
const getUrlMock = vi.fn();
vi.mock("aws-amplify/storage", () => ({
  getUrl: (...a: unknown[]) => getUrlMock(...a),
}));

import { getCloudPhotoUrl, refreshPhotoUrls, clearPhotoCache } from "../src/api/photoFetch";

const TENANT = "t1";
const FN = "moreapp_abc_x.jpg";

function mockGetUrl(expiresInMs: number) {
  getUrlMock.mockImplementation(async () => ({
    url: new URL(`https://s3.example/${FN}?sig=${Date.now()}`),
    expiresAt: new Date(Date.now() + expiresInMs),
  }));
}

beforeEach(() => {
  clearPhotoCache();
  getUrlMock.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("photoFetch — firma por-demanda (fix de raíz 'Sin fotos disponibles' 2026-06-15)", () => {
  it("firma una URL SIN haber indexado el bucket (regresión causa raíz)", async () => {
    // ANTES del fix: getCloudPhotoUrl exigía que el filename estuviera en un índice
    // del bucket completo (indexCloudPhotos). Sin ese listado masivo → devolvía null →
    // "Sin fotos disponibles" pese a existir la foto en S3. Ahora firma directo.
    mockGetUrl(10 * 60 * 1000);
    const url = await getCloudPhotoUrl(TENANT, FN);
    expect(url).toBeTruthy();
    expect(getUrlMock).toHaveBeenCalledTimes(1);
    // Firma con el path por-tenant (aísla cross-tenant; el path lleva el tenant).
    expect(getUrlMock).toHaveBeenCalledWith({ path: `photos/${TENANT}/${FN}` });
  });

  it("una foto inexistente (getUrl rechaza) devuelve null sin reventar", async () => {
    // El onerror del <img> (photoImgErr) maneja este caso con placeholder limpio.
    getUrlMock.mockRejectedValue(new Error("AccessDenied"));
    const url = await getCloudPhotoUrl(TENANT, FN);
    expect(url).toBeNull();
  });

  it("dentro de la ventana de vida real: cache hit, no re-firma", async () => {
    mockGetUrl(10 * 60 * 1000); // 10min → expires ≈ now+9min (tras skew)
    const u1 = await getCloudPhotoUrl(TENANT, FN);
    const u2 = await getCloudPhotoUrl(TENANT, FN);
    expect(u1).toBeTruthy();
    expect(u1).toBe(u2);
    expect(getUrlMock).toHaveBeenCalledTimes(1);
  });

  it("tras vencer la URL cacheada: re-firma (no sirve la muerta)", async () => {
    mockGetUrl(2 * 60 * 1000); // 2min → expires = 2min - 1min skew = now+60s
    await getCloudPhotoUrl(TENANT, FN);
    expect(getUrlMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(90 * 1000); // +90s > 60s → vencida
    await getCloudPhotoUrl(TENANT, FN);
    expect(getUrlMock).toHaveBeenCalledTimes(2);
  });

  it("refreshPhotoUrls fuerza re-firma aunque esté en cache y devuelve {url,expires}", async () => {
    mockGetUrl(10 * 60 * 1000);
    await getCloudPhotoUrl(TENANT, FN);
    expect(getUrlMock).toHaveBeenCalledTimes(1);
    const fresh = await refreshPhotoUrls(TENANT, [FN]);
    expect(getUrlMock).toHaveBeenCalledTimes(2); // force ignora el cache
    const entry = fresh.get(FN);
    expect(entry).toBeTruthy();
    expect(typeof entry!.expires).toBe("number");
    expect(entry!.expires).toBeGreaterThan(Date.now());
  });
});
