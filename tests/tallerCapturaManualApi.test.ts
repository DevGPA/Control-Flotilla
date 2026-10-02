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
const mockTallerGet = vi.fn();

vi.mock("../src/api/amplifyClient", () => ({
  getClient: () => ({
    models: {
      TallerPartida: {
        create: mockCreate,
        update: mockUpdate,
        get: mockGet,
      },
      Taller: { get: mockTallerGet },
    },
  }),
}));

const { crearPartidaManual, enviarPartidaAAutorizacion, guardarDecisionPartida } =
  await import("../src/api/tallerPartidas");

beforeEach(() => {
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockGet.mockReset();
  mockTallerGet.mockReset();
});

/** La visita en la nube, como la devuelve `Taller.get`. */
const visitaNube = (estatus: "abierto" | "cerrado", datos: Record<string, unknown> = {}) => ({
  data: {
    tenantId: "gpa",
    unitUid: "JV98698",
    fechaEntrada: "2026-09-01",
    estatus,
    datos: JSON.stringify(datos),
  },
  errors: undefined,
});
const VISITA = { unitUid: "JV98698", fechaEntrada: "2026-09-01" };

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

  // Cambiar de decisión (2026-10-01): la máquina de estados ahora SÍ deja volver a
  // autorizar un rechazado, así que lo que sigue protegiendo contra el clic viejo es
  // comparar lo que el usuario VIO (su copia) con la fila real.
  it("si el usuario VE la rechazada y la fila real también lo está, volver a autorizar SÍ escribe", async () => {
    const rechazada = {
      ...propuesta,
      estado: "rechazada",
      motivoRechazo: "Precio alto — recotizar",
      decididoPor: "otro@gpa",
    };
    mockGet.mockResolvedValue({ data: rechazada, errors: undefined });
    mockUpdate.mockResolvedValue({ errors: undefined });
    mockTallerGet.mockResolvedValue(visitaNube("abierto"));

    const r = await guardarDecisionPartida({
      tenantId: "gpa",
      partida: { ...enCache, estado: "rechazada", motivoRechazo: "Precio alto — recotizar" },
      decision: "autorizar",
      quien: "riesgos@gpa",
      cuando: "2026-10-01T12:00:00Z",
      estadoVisto: "rechazada",
      visita: VISITA,
    });

    expect(r.estado).toBe("autorizada");
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0]![0]).toMatchObject({ estado: "autorizada", motivoRechazo: "" });
  });

  // Revisión 2026-10-02 (Important B): el lote compara contra la CACHÉ; si la caché se
  // refrescó a media corrida con el rechazo de otra persona, la guarda pasaba y se
  // re-autorizaba algo que el usuario nunca vio rechazado. Lo que manda es lo que VIO.
  it("el lote vio 'propuesta' pero la caché ya dice 'rechazada' ⇒ LANZA cambio y no escribe", async () => {
    const rechazadaPorOtro = {
      ...propuesta,
      estado: "rechazada",
      motivoRechazo: "Precio alto — recotizar",
      decididoPor: "otro@gpa",
    };
    mockGet.mockResolvedValue({ data: rechazadaPorOtro, errors: undefined });

    await expect(
      guardarDecisionPartida({
        tenantId: "gpa",
        partida: { ...enCache, estado: "rechazada", motivoRechazo: "Precio alto — recotizar" },
        decision: "autorizar",
        quien: "riesgos@gpa",
        cuando: "2026-10-02T12:00:00Z",
        estadoVisto: "propuesta",
        visita: VISITA,
      }),
    ).rejects.toMatchObject({ cambio: true });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // Revisión 2026-10-02 (Important A): cambiar de decisión solo "mientras sigue en taller",
  // verificado contra la NUBE — el registro abierto pudo cerrarse en otra pestaña.
  it("cambiar de decisión con la visita CERRADA en la nube ⇒ LANZA cambio y no escribe", async () => {
    mockGet.mockResolvedValue({
      data: { ...propuesta, estado: "rechazada", motivoRechazo: "No es necesario ahora" },
      errors: undefined,
    });
    mockTallerGet.mockResolvedValue(visitaNube("cerrado", { fsalidaReal: "2026-10-01" }));

    await expect(
      guardarDecisionPartida({
        tenantId: "gpa",
        partida: { ...enCache, estado: "rechazada" },
        decision: "autorizar",
        quien: "riesgos@gpa",
        cuando: "2026-10-02T12:00:00Z",
        estadoVisto: "rechazada",
        visita: VISITA,
      }),
    ).rejects.toMatchObject({ cambio: true });
    expect(mockTallerGet).toHaveBeenCalledWith({ tenantId: "gpa", ...VISITA });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("cambiar de decisión sin saber cuál es la visita ⇒ LANZA cambio (no se adivina)", async () => {
    mockGet.mockResolvedValue({
      data: { ...propuesta, estado: "autorizada", precioAutorizado: 1850 },
      errors: undefined,
    });
    await expect(
      guardarDecisionPartida({
        tenantId: "gpa",
        partida: { ...enCache, estado: "autorizada", precioAutorizado: 1850 },
        decision: "rechazar",
        motivo: "No es necesario ahora",
        quien: "riesgos@gpa",
        cuando: "2026-10-02T12:00:00Z",
        estadoVisto: "autorizada",
      }),
    ).rejects.toMatchObject({ cambio: true });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("la PRIMERA decisión (propuesta) no relee la visita: su camino no cambia", async () => {
    mockGet.mockResolvedValue({ data: propuesta, errors: undefined });
    mockUpdate.mockResolvedValue({ errors: undefined });
    await guardarDecisionPartida({
      tenantId: "gpa",
      partida: enCache,
      decision: "autorizar",
      quien: "riesgos@gpa",
      cuando: "2026-10-02T12:00:00Z",
      estadoVisto: "propuesta",
    });
    expect(mockTallerGet).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("si la copia local dice autorizada pero el taller YA la terminó, retirar LANZA y no se escribe nada", async () => {
    mockGet.mockResolvedValue({
      data: {
        ...propuesta,
        estado: "terminada",
        precioAutorizado: 1850,
        terminadoEn: "2026-09-30T10:00:00Z",
      },
      errors: undefined,
    });

    await expect(
      guardarDecisionPartida({
        tenantId: "gpa",
        partida: { ...enCache, estado: "autorizada", precioAutorizado: 1850 },
        decision: "rechazar",
        motivo: "No es necesario ahora",
        quien: "riesgos@gpa",
        cuando: "2026-10-01T12:00:00Z",
      }),
    ).rejects.toThrow();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // CORREGIDO 2026-09-15 tras un defecto en PROD. Este test exigía que el
  // payload llevara SIEMPRE `motivoRechazo: null` y `motivoRechazoNota: null`
  // al autorizar. En la misma ola, R92 le quitó `delete` a `operativo` sobre
  // TallerPartida, y en la autorización que genera Amplify escribir `null` ES
  // borrar ese campo: cada firma de Administración de Riesgos moría con
  // `Unauthorized`. `admin` no lo veía. La regla correcta no es "manda null
  // siempre", es "no dejes un rastro que contradiga el estado": se limpia
  // cuando hay algo que limpiar. Ver tests/tallerFirmaOperativo.test.ts.
  it("al autorizar una propuesta limpia, el payload NO pide borrar nada (operativo puede firmar)", async () => {
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
    expect(Object.prototype.hasOwnProperty.call(payload, "motivoRechazo")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, "motivoRechazoNota")).toBe(false);
    expect(Object.values(payload)).not.toContain(null);
  });

  it("si la fila arrastra un motivo viejo, autorizar SÍ lo borra — el rastro no sobrevive", async () => {
    // Dato corrupto: inalcanzable por la capa pura (una `propuesta` no lleva
    // motivo), pero si llegara así, la limpieza tiene que ocurrir.
    mockGet.mockResolvedValue({
      data: { ...propuesta, motivoRechazo: "Precio alto — recotizar", motivoRechazoNota: "nota" },
      errors: undefined,
    });
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
