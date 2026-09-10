// tests/tallerCapturaManualApi.test.ts
//
// Fix ronda 1 (Important 1 / R78) — cubre la escritura real de
// `crearPartidaManual` y `enviarPartidaAAutorizacion` (src/api/tallerPartidas.ts):
// la primera SOLO crea (borrador, sin propuestoEn); la segunda es el envío
// EXPLÍCITO que faltaba (lee la fila actual, aplica `proponer`, persiste).
// Mockea `./amplifyClient` (no `amplify/` — ese archivo es frontend, src/**)
// para no depender de una sesión Amplify real, mismo espíritu que
// tests/tallerPortalUrl.test.ts mockea `amplify_outputs.json`.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockGet = vi.fn();

vi.mock("../src/api/amplifyClient", () => ({
  getClient: () => ({
    models: {
      TallerPartida: {
        create: mockCreate,
        update: mockUpdate,
        get: mockGet,
      },
    },
  }),
}));

const { crearPartidaManual, enviarPartidaAAutorizacion } =
  await import("../src/api/tallerPartidas");

beforeEach(() => {
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockGet.mockReset();
});

const datos = { descripcion: "Balatas delanteras", tipo: "refaccion" as const, precio: 1850 };

describe("crearPartidaManual — R78: SOLO crea, nace en borrador y se queda ahí", () => {
  it("persiste estado 'borrador' y NO manda propuestoEn a AppSync", async () => {
    mockCreate.mockResolvedValue({ errors: undefined });
    const p = await crearPartidaManual({
      tenantId: "gpa",
      datos,
      visitaKey: "JV98698|2026-09-01",
      autorSub: "abc",
      ahora: "2026-09-10T10:00:00Z",
    });
    expect(p.estado).toBe("borrador");
    expect(p.propuestoEn).toBeUndefined();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const payload = mockCreate.mock.calls[0]![0];
    expect(payload.estado).toBe("borrador");
    expect(payload.propuestoEn).toBeUndefined();
    expect(payload.creadoPor).toBe("user:abc");
  });

  it("si partidaManual lanza (datos inválidos), no se llama a AppSync ni una vez", async () => {
    await expect(
      crearPartidaManual({
        tenantId: "gpa",
        datos: { ...datos, precio: -5 },
        visitaKey: "v|1",
        autorSub: "abc",
        ahora: "x",
      }),
    ).rejects.toThrow();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("si TallerPartida.create devuelve errors, lanza (mismo shape que guardarDecisionPartida)", async () => {
    mockCreate.mockResolvedValue({ errors: [{ message: "boom" }] });
    await expect(
      crearPartidaManual({
        tenantId: "gpa",
        datos,
        visitaKey: "v|1",
        autorSub: "abc",
        ahora: "x",
      }),
    ).rejects.toThrow();
  });
});

describe("enviarPartidaAAutorizacion — R78: el envío EXPLÍCITO, separado de crear", () => {
  const filaBorrador = {
    tenantId: "gpa",
    visitaKey: "JV98698|2026-09-01",
    partidaId: "p1",
    descripcion: "Balatas delanteras",
    tipo: "refaccion",
    precio: 1850,
    estado: "borrador",
    fotos: [],
    creadoPor: "user:abc",
    creadoEn: "2026-09-10T10:00:00Z",
  };

  it("lee la fila actual, aplica proponer y persiste 'propuesta' + propuestoEn", async () => {
    mockGet.mockResolvedValue({ data: filaBorrador, errors: undefined });
    mockUpdate.mockResolvedValue({ errors: undefined });

    const p = await enviarPartidaAAutorizacion({
      tenantId: "gpa",
      visitaKey: "JV98698|2026-09-01",
      partidaId: "p1",
      ahora: "2026-09-10T10:05:00Z",
    });

    expect(p.estado).toBe("propuesta");
    expect(p.propuestoEn).toBe("2026-09-10T10:05:00Z");
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const payload = mockUpdate.mock.calls[0]![0];
    expect(payload.estado).toBe("propuesta");
    expect(payload.propuestoEn).toBe("2026-09-10T10:05:00Z");
  });

  it("una partida que ya está 'propuesta' no se puede volver a enviar — el throw de proponer sale, nunca silencioso", async () => {
    mockGet.mockResolvedValue({
      data: { ...filaBorrador, estado: "propuesta", propuestoEn: "2026-09-10T09:00:00Z" },
      errors: undefined,
    });

    await expect(
      enviarPartidaAAutorizacion({
        tenantId: "gpa",
        visitaKey: "JV98698|2026-09-01",
        partidaId: "p1",
        ahora: "2026-09-10T10:05:00Z",
      }),
    ).rejects.toThrow();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("lanza si la partida no existe en DynamoDB", async () => {
    mockGet.mockResolvedValue({ data: null, errors: undefined });
    await expect(
      enviarPartidaAAutorizacion({
        tenantId: "gpa",
        visitaKey: "v|1",
        partidaId: "no-existe",
        ahora: "x",
      }),
    ).rejects.toThrow();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("lanza si TallerPartida.get devuelve errors", async () => {
    mockGet.mockResolvedValue({ data: undefined, errors: [{ message: "boom" }] });
    await expect(
      enviarPartidaAAutorizacion({
        tenantId: "gpa",
        visitaKey: "v|1",
        partidaId: "p1",
        ahora: "x",
      }),
    ).rejects.toThrow();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("lanza si TallerPartida.update devuelve errors", async () => {
    mockGet.mockResolvedValue({ data: filaBorrador, errors: undefined });
    mockUpdate.mockResolvedValue({ errors: [{ message: "boom" }] });
    await expect(
      enviarPartidaAAutorizacion({
        tenantId: "gpa",
        visitaKey: "JV98698|2026-09-01",
        partidaId: "p1",
        ahora: "x",
      }),
    ).rejects.toThrow();
  });
});
