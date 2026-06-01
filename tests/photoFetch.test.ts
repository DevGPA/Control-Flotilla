import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock de Amplify Storage. getUrl devuelve {url, expiresAt} como el real; así probamos
// que el cache respeta el vencimiento REAL en vez de un TTL fijo adivinado (causa del bug
// "fotos No disponible": URLs vencidas servidas como válidas).
const getUrlMock = vi.fn();
const listMock = vi.fn();
vi.mock("aws-amplify/storage", () => ({
  list: (...a: unknown[]) => listMock(...a),
  getUrl: (...a: unknown[]) => getUrlMock(...a),
}));

import {
  indexCloudPhotos,
  getCloudPhotoUrl,
  refreshPhotoUrls,
  clearPhotoCache,
} from "../src/api/photoFetch";

const TENANT = "t1";
const FN = "moreapp_abc_x.jpg";

function mockList() {
  listMock.mockResolvedValue({ items: [{ path: `photos/${TENANT}/${FN}` }], nextToken: undefined });
}
function mockGetUrl(expiresInMs: number) {
  getUrlMock.mockImplementation(async () => ({
    url: new URL(`https://s3.example/${FN}?sig=${Date.now()}`),
    expiresAt: new Date(Date.now() + expiresInMs),
  }));
}

beforeEach(() => {
  clearPhotoCache();
  getUrlMock.mockReset();
  listMock.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("photoFetch — cache con TTL real (fix fotos 'No disponible')", () => {
  it("dentro de la ventana de vida real: cache hit, no re-firma", async () => {
    mockList();
    mockGetUrl(10 * 60 * 1000); // 10min → expires ≈ now+9min (tras skew)
    await indexCloudPhotos(TENANT);
    const u1 = await getCloudPhotoUrl(TENANT, FN);
    const u2 = await getCloudPhotoUrl(TENANT, FN);
    expect(u1).toBeTruthy();
    expect(u1).toBe(u2);
    expect(getUrlMock).toHaveBeenCalledTimes(1);
  });

  it("tras vencer la URL cacheada: re-firma (no sirve la muerta)", async () => {
    mockList();
    mockGetUrl(2 * 60 * 1000); // 2min → expires = 2min - 1min skew = now+60s
    await indexCloudPhotos(TENANT);
    await getCloudPhotoUrl(TENANT, FN);
    expect(getUrlMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(90 * 1000); // +90s > 60s → vencida
    await getCloudPhotoUrl(TENANT, FN);
    expect(getUrlMock).toHaveBeenCalledTimes(2);
  });

  it("refreshPhotoUrls fuerza re-firma aunque esté en cache y devuelve {url,expires}", async () => {
    mockList();
    mockGetUrl(10 * 60 * 1000);
    await indexCloudPhotos(TENANT);
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
