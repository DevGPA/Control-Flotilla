import { describe, expect, it, vi } from "vitest";
import { Jimp, JimpMime } from "jimp";
import { reprocesaLote, type DepsReproceso } from "../src/vision/reproceso";
import type { LecturaVision } from "../src/vision/fusion";

const LECTURA: LecturaVision = {
  ticket: {
    monto: 100,
    litros: 10,
    precioLitro: 10,
    fecha: "01/08/2026",
    confianza: 0.9,
    estado: "ok",
  },
};

function datosReporte(eco: string): string {
  return JSON.stringify({
    photos: [{ group: "Carga", col: "fotoTicket", fname: `opsgpa_${eco}_x_fototicket.jpg` }],
  });
}

const CARGAS = [
  { tenantId: "gpa", loadId: "10|carga|OPS-a", datos: datosReporte("10") },
  { tenantId: "gpa", loadId: "11|solicitud|OPS-b", datos: JSON.stringify({ photos: [] }) },
  { tenantId: "gpa", loadId: "12|carga|OPS-c", datos: datosReporte("12") },
];

function fakeDeps(over: Partial<DepsReproceso> = {}): DepsReproceso {
  return {
    listaCargas: vi.fn(async () => ({ items: CARGAS, nextToken: "TOKEN-2" })),
    bajaFoto: vi.fn(async () =>
      new Jimp({ width: 100, height: 100, color: 0xffffffff }).getBuffer(JimpMime.png),
    ),
    llamaBedrock: vi.fn(async () => LECTURA),
    leeValidacion: vi.fn(async () => null),
    escribeVision: vi.fn(async () => {}),
    ahora: () => "2026-08-20T13:00:00.000Z",
    modelo: "anthropic.claude-sonnet-5",
    ...over,
  };
}

describe("reprocesaLote: batch del histórico por invocación directa", () => {
  it("procesa solo cargas con ticket/bomba; solicitudes cuentan como sinFotos", async () => {
    const deps = fakeDeps();
    const r = await reprocesaLote({ reproceso: true }, deps);
    expect(r.procesadas).toBe(2);
    expect(r.sinFotos).toBe(1); // la solicitud sin evidencias de montos
    expect(r.errores).toBe(0);
    expect(r.nextToken).toBe("TOKEN-2");
    expect(deps.llamaBedrock).toHaveBeenCalledTimes(2);
  });

  it("soloSinVision (default): una fila que YA tiene tsVision se salta sin gastar Bedrock", async () => {
    const deps = fakeDeps({
      leeValidacion: vi.fn(async (loadId: string) =>
        loadId === "10|carga|OPS-a" ? { tsVision: "2026-08-01T00:00:00Z" } : null,
      ),
    });
    const r = await reprocesaLote({ reproceso: true }, deps);
    expect(r.skips).toBe(1);
    expect(r.procesadas).toBe(1);
    expect(deps.llamaBedrock).toHaveBeenCalledTimes(1);
  });

  it("un error en una carga NO tumba el lote: se cuenta y sigue con las demás", async () => {
    const deps = fakeDeps({
      llamaBedrock: vi
        .fn<() => Promise<LecturaVision>>()
        .mockRejectedValueOnce(new Error("ThrottlingException"))
        .mockResolvedValue(LECTURA),
    });
    const r = await reprocesaLote({ reproceso: true }, deps);
    expect(r.errores).toBe(1);
    expect(r.procesadas).toBe(1);
  });

  it("pasa limit y nextToken al listado (paginación operada desde afuera)", async () => {
    const deps = fakeDeps();
    await reprocesaLote({ reproceso: true, limit: 25, nextToken: "TOKEN-1" }, deps);
    expect(deps.listaCargas).toHaveBeenCalledWith("TOKEN-1", 25);
  });
});
