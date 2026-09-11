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

const { crearPartidaManual, enviarPartidaAAutorizacion, guardarDecisionPartida } =
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

// ── C-I6 — Riesgos no empuja el borrador que el taller aún no envió ─────────
describe("enviarPartidaAAutorizacion — solo lo que capturó GPA (C-I6)", () => {
  const filaDeLaLiga = {
    tenantId: "gpa",
    visitaKey: "JV98698|2026-09-01",
    partidaId: "p9",
    descripcion: "Bomba de agua",
    tipo: "refaccion" as const,
    precio: 4200,
    estado: "borrador",
    fotos: [],
    creadoPor: "liga:JV98698|2026-09-01",
    creadoEn: "2026-09-10T10:00:00Z",
  };

  it("un borrador de origen `liga:` NO se puede enviar desde la app — es del taller", async () => {
    mockGet.mockResolvedValue({ data: filaDeLaLiga, errors: undefined });
    await expect(
      enviarPartidaAAutorizacion({
        tenantId: "gpa",
        visitaKey: "JV98698|2026-09-01",
        partidaId: "p9",
        ahora: "2026-09-10T10:05:00Z",
      }),
    ).rejects.toThrow(/taller/i);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("un borrador SIN autoría tampoco — nunca se asume que es de GPA", async () => {
    mockGet.mockResolvedValue({
      data: { ...filaDeLaLiga, creadoPor: undefined },
      errors: undefined,
    });
    await expect(
      enviarPartidaAAutorizacion({
        tenantId: "gpa",
        visitaKey: "JV98698|2026-09-01",
        partidaId: "p9",
        ahora: "2026-09-10T10:05:00Z",
      }),
    ).rejects.toThrow();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ── B-C3 — la firma se aplica sobre la fila REAL, nunca sobre la caché ──────
describe("guardarDecisionPartida — re-lee antes de aplicar la máquina de estados (B-C3)", () => {
  const propuesta = {
    tenantId: "gpa",
    visitaKey: "JV98698|2026-09-01",
    partidaId: "p1",
    descripcion: "Balatas",
    tipo: "refaccion" as const,
    precio: 1850,
    estado: "propuesta",
    fotos: [],
    creadoPor: "user:abc",
  };
  /** La copia CACHEADA que tendría el monolito: dice "propuesta" aunque la fila
   *  real ya no lo esté. */
  const enCache = { ...propuesta, estado: "propuesta" as const, fotos: [] as string[] };

  it("autoriza sobre lo que dice DynamoDB, no sobre la copia del cliente", async () => {
    mockGet.mockResolvedValue({ data: propuesta, errors: undefined });
    mockUpdate.mockResolvedValue({ errors: undefined });

    const r = await guardarDecisionPartida({
      tenantId: "gpa",
      partida: enCache,
      decision: "autorizar",
      quien: "riesgos@gpa",
      cuando: "2026-09-11T10:00:00Z",
    });

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(r.estado).toBe("autorizada");
    expect(r.precioAutorizado).toBe(1850);
  });

  it("si otra pestaña YA la rechazó, autorizar LANZA y no se escribe nada", async () => {
    mockGet.mockResolvedValue({
      data: {
        ...propuesta,
        estado: "rechazada",
        motivoRechazo: "Precio alto — recotizar",
        decididoPor: "otro@gpa",
      },
      errors: undefined,
    });

    await expect(
      guardarDecisionPartida({
        tenantId: "gpa",
        partida: enCache,
        decision: "autorizar",
        quien: "riesgos@gpa",
        cuando: "2026-09-11T10:00:00Z",
      }),
    ).rejects.toThrow();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("al autorizar, motivoRechazo/nota se escriben como null — nunca sobreviven al cambio", async () => {
    mockGet.mockResolvedValue({ data: propuesta, errors: undefined });
    mockUpdate.mockResolvedValue({ errors: undefined });

    await guardarDecisionPartida({
      tenantId: "gpa",
      partida: enCache,
      decision: "autorizar",
      quien: "riesgos@gpa",
      cuando: "2026-09-11T10:00:00Z",
    });

    const payload = mockUpdate.mock.calls[0]![0];
    expect(payload.estado).toBe("autorizada");
    // `undefined` NO se serializa: el rastro viejo se quedaría pegado.
    expect(payload.motivoRechazo).toBeNull();
    expect(payload.motivoRechazoNota).toBeNull();
  });

  it("lanza si la partida ya no existe — nunca escribe a ciegas", async () => {
    mockGet.mockResolvedValue({ data: null, errors: undefined });
    await expect(
      guardarDecisionPartida({
        tenantId: "gpa",
        partida: enCache,
        decision: "autorizar",
        quien: "riesgos@gpa",
        cuando: "2026-09-11T10:00:00Z",
      }),
    ).rejects.toThrow();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
