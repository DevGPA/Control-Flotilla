import { describe, expect, it, vi } from "vitest";
import { Jimp, JimpMime } from "jimp";
import { analizaCarga, type DepsAnaliza } from "../src/vision/analiza";
import type { LecturaVision } from "../src/vision/fusion";

const LECTURA: LecturaVision = {
  ticket: {
    monto: 850.5,
    litros: 35.2,
    precioLitro: 24.16,
    fecha: "04/06/2026",
    confianza: 0.9,
    estado: "ok",
  },
};

const EVENTO = {
  tenantId: "gpa",
  loadId: "10|solicitud|OPS-abc123",
  fnames: {
    fotoTicket: "opsgpa_10_aaaa1111_fototicket.jpg",
    fotoDespues: "opsgpa_10_bbbb2222_fotodespues.jpg",
  },
};

async function fotoPng(w = 2000, h = 1500): Promise<Buffer> {
  return new Jimp({ width: w, height: h, color: 0x336699ff }).getBuffer(JimpMime.png);
}

function fakeDeps(over: Partial<DepsAnaliza> = {}): DepsAnaliza {
  return {
    bajaFoto: vi.fn(async () => fotoPng()),
    llamaBedrock: vi.fn(async () => LECTURA),
    leeValidacion: vi.fn(async () => null),
    escribeVision: vi.fn(async () => {}),
    ahora: () => "2026-08-20T12:00:00.000Z",
    modelo: "anthropic.claude-sonnet-5",
    ...over,
  };
}

describe("analizaCarga: orquestación S3 → resize → Bedrock → update parcial", () => {
  it("camino feliz: baja fotos, las reescala a JPEG y persiste la fusión + autoría de la lectura", async () => {
    const deps = fakeDeps();
    const r = await analizaCarga(EVENTO, deps);

    expect(deps.bajaFoto).toHaveBeenCalledTimes(2);
    expect(deps.llamaBedrock).toHaveBeenCalledTimes(1);
    const [, imagenes] = vi.mocked(deps.llamaBedrock).mock.calls[0]!;
    expect(imagenes).toHaveLength(2);
    for (const img of imagenes) {
      expect(img.mediaType).toBe("image/jpeg");
      expect(img.data[0]).toBe(0xff); // reescalada/transcodificada, no la PNG original
    }

    expect(deps.escribeVision).toHaveBeenCalledTimes(1);
    const [loadId, campos] = vi.mocked(deps.escribeVision).mock.calls[0]!;
    expect(loadId).toBe(EVENTO.loadId);
    expect(campos.montoDetectado).toBe(850.5);
    expect(campos.fechaDetectada).toBe("2026-06-04");
    expect(campos.tsVision).toBe("2026-08-20T12:00:00.000Z");
    expect(campos.modeloVision).toBe("anthropic.claude-sonnet-5");
    // el set de fnames analizado queda en el detalle → llave de idempotencia
    expect(campos.visionDetalle.fnames).toEqual(
      expect.arrayContaining(Object.values(EVENTO.fnames)),
    );
    expect(r.estado).toBe("analizada");
  });

  it("idempotencia: fila con tsVision y MISMO set de fnames → skip sin llamar a Bedrock", async () => {
    const deps = fakeDeps({
      leeValidacion: vi.fn(async () => ({
        tsVision: "2026-08-19T00:00:00Z",
        visionDetalle: { fnames: Object.values(EVENTO.fnames).sort() },
      })),
    });
    const r = await analizaCarga(EVENTO, deps);
    expect(r.estado).toBe("skip");
    expect(deps.llamaBedrock).not.toHaveBeenCalled();
    expect(deps.escribeVision).not.toHaveBeenCalled();
  });

  it("re-entrega con set de fnames DISTINTO (llegó foto nueva) → re-analiza", async () => {
    const deps = fakeDeps({
      leeValidacion: vi.fn(async () => ({
        tsVision: "2026-08-19T00:00:00Z",
        visionDetalle: { fnames: ["opsgpa_10_aaaa1111_fototicket.jpg"] },
      })),
    });
    const r = await analizaCarga(EVENTO, deps);
    expect(r.estado).toBe("analizada");
    expect(deps.llamaBedrock).toHaveBeenCalledTimes(1);
  });

  it("foto ausente en S3 → se analizan las presentes y la ausente queda 'faltante' en el detalle", async () => {
    const deps = fakeDeps({
      bajaFoto: vi.fn(async (fname: string) => (fname.includes("fotodespues") ? null : fotoPng())),
    });
    const r = await analizaCarga(EVENTO, deps);
    expect(r.estado).toBe("analizada");
    const [, imagenes] = vi.mocked(deps.llamaBedrock).mock.calls[0]!;
    expect(imagenes).toHaveLength(1);
    const [, campos] = vi.mocked(deps.escribeVision).mock.calls[0]!;
    expect(campos.visionDetalle.tanqueDespues?.estado).toBe("faltante");
  });

  it("CERO fotos disponibles → no llama a Bedrock ni escribe (reparable por re-entrega/reproceso)", async () => {
    const deps = fakeDeps({ bajaFoto: vi.fn(async () => null) });
    const r = await analizaCarga(EVENTO, deps);
    expect(r.estado).toBe("sin-fotos");
    expect(deps.llamaBedrock).not.toHaveBeenCalled();
    expect(deps.escribeVision).not.toHaveBeenCalled();
  });

  it("un error de Bedrock se propaga (el invoke asíncrono reintenta; el reproceso repara)", async () => {
    const deps = fakeDeps({
      llamaBedrock: vi.fn(async () => {
        throw new Error("ThrottlingException");
      }),
    });
    await expect(analizaCarga(EVENTO, deps)).rejects.toThrow("ThrottlingException");
    expect(deps.escribeVision).not.toHaveBeenCalled();
  });
});
