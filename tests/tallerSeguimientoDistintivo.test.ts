import { describe, it, expect } from "vitest";
import {
  resumenPartidas,
  distintivoProveedor,
  etiquetaDistintivo,
  filasPendientes,
  estadoLiga,
  promesaTaller,
} from "../src/taller/seguimiento";
import { gastoDerivado, type Partida } from "../src/taller/partidas";
import { visitaKeyDe } from "../src/api/tallerPartidas";
import type { TallerEntry } from "../src/taller/types";
import type { LegacyTallerEntry } from "../src/api/batchUpload";

const VK = "JB4479A|2026-09-14";
const P = (o: Partial<Partida> = {}): Partida => ({
  partidaId: "p",
  visitaKey: VK,
  descripcion: "x",
  tipo: "refaccion",
  precio: 100,
  estado: "propuesta",
  fotos: [],
  ...o,
});

describe("resumenPartidas", () => {
  const ps = [
    P({ partidaId: "a", estado: "propuesta", precio: 550 }),
    P({ partidaId: "b", estado: "autorizada", precio: 35000, precioAutorizado: 35000 }),
    P({ partidaId: "c", estado: "autorizada", precio: 250, precioAutorizado: 250 }),
    P({ partidaId: "d", estado: "rechazada", precio: 2500 }),
    P({ partidaId: "e", estado: "borrador", precio: 80, creadoPor: "liga:" + VK }),
    P({ partidaId: "f", estado: "cancelada", precio: 999 }),
  ];

  it("cuenta y suma por estado", () => {
    const r = resumenPartidas(ps);
    expect(r.pendientes).toEqual({ n: 1, monto: 550 });
    expect(r.autorizadas).toEqual({ n: 2, monto: 35250 });
    expect(r.rechazadas).toEqual({ n: 1, monto: 2500 });
    expect(r.borradoresTaller).toBe(1);
  });

  it("lo autorizado COINCIDE con la única fórmula del dinero (gastoDerivado)", () => {
    const entry = { id: "t1", estado: "En Diagnóstico" } as TallerEntry;
    expect(resumenPartidas(ps).autorizadas.monto).toBe(gastoDerivado(entry, ps).gasto);
  });

  it("sin partidas, todo en cero (nunca NaN)", () => {
    const r = resumenPartidas([]);
    expect(r.autorizadas).toEqual({ n: 0, monto: 0 });
    expect(r.pendientes).toEqual({ n: 0, monto: 0 });
  });
});

describe("distintivoProveedor — una sola señal, por prioridad", () => {
  const sinNada = resumenPartidas([]);
  const conPendiente = resumenPartidas([P({ estado: "propuesta", precio: 550 })]);
  const ligaActiva = estadoLiga(
    { ligaCreadaEn: "2026-09-01T00:00:00.000Z" },
    "2026-09-15T00:00:00.000Z",
  );
  const promVencida = promesaTaller({ fsalidaEstTaller: "2026-09-12" }, "2026-09-15");
  const promNinguna = promesaTaller({}, "2026-09-15");

  it("promesa vencida gana sobre todo", () => {
    expect(distintivoProveedor(ligaActiva, promVencida, conPendiente)).toEqual({
      kind: "promesa-vencida",
      dias: 3,
    });
  });

  it("esperando firma gana sobre liga activa", () => {
    expect(distintivoProveedor(ligaActiva, promNinguna, conPendiente)).toEqual({
      kind: "esperando-firma",
      n: 1,
    });
  });

  it("liga activa cuando no hay nada más urgente", () => {
    expect(distintivoProveedor(ligaActiva, promNinguna, sinNada)).toEqual({
      kind: "liga-activa",
      dias: 76,
    });
  });

  it("revocada y sin liga", () => {
    const rev = estadoLiga(
      { ligaCreadaEn: "2026-09-01T00:00:00.000Z", ligaRevocadaEn: "2026-09-05T00:00:00.000Z" },
      "2026-09-15T00:00:00.000Z",
    );
    expect(distintivoProveedor(rev, promNinguna, sinNada)).toEqual({ kind: "liga-revocada" });
    expect(distintivoProveedor({ kind: "sin-liga" }, promNinguna, sinNada)).toEqual({
      kind: "sin-liga",
    });
  });

  it("una liga VENCIDA sin nada pendiente se lee como 'sin liga' (ya no sirve)", () => {
    const venc = estadoLiga(
      { ligaCreadaEn: "2026-01-01T00:00:00.000Z" },
      "2026-09-15T00:00:00.000Z",
    );
    expect(distintivoProveedor(venc, promNinguna, sinNada)).toEqual({ kind: "sin-liga" });
  });

  it("las etiquetas son las que ve el usuario", () => {
    expect(etiquetaDistintivo({ kind: "promesa-vencida", dias: 3 })).toBe("Promesa vencida · 3d");
    expect(etiquetaDistintivo({ kind: "esperando-firma", n: 2 })).toBe("Esperando firma · 2");
    expect(etiquetaDistintivo({ kind: "liga-activa", dias: 76 })).toBe("Liga activa · 76d");
    expect(etiquetaDistintivo({ kind: "liga-revocada" })).toBe("Liga revocada");
    expect(etiquetaDistintivo({ kind: "sin-liga" })).toBe("Sin liga");
  });
});

describe("filasPendientes — la bandeja de ENTRADA", () => {
  const e1 = {
    id: "t1",
    plate: "JB4479A",
    fentrada: "2026-09-14",
    estado: "En Diagnóstico",
  } as TallerEntry;
  const e2 = {
    id: "t2",
    plate: "JB4256A",
    fentrada: "2026-09-08",
    estado: "En Reparación",
  } as TallerEntry;
  const k1 = visitaKeyDe(e1 as unknown as LegacyTallerEntry);
  const k2 = visitaKeyDe(e2 as unknown as LegacyTallerEntry);

  const mapa = new Map<string, Partida[]>([
    [k1, [P({ partidaId: "a", visitaKey: k1, precio: 550, propuestoEn: "2026-09-14T17:21:00Z" })]],
    [
      k2,
      [
        P({ partidaId: "b", visitaKey: k2, precio: 700, propuestoEn: "2026-09-13T09:00:00Z" }),
        P({ partidaId: "c", visitaKey: k2, precio: 500, propuestoEn: "2026-09-14T09:00:00Z" }),
        P({
          partidaId: "d",
          visitaKey: k2,
          estado: "autorizada",
          precio: 100,
          precioAutorizado: 100,
        }),
      ],
    ],
  ]);

  it("una fila por visita con pendientes, con su conteo y monto", () => {
    const filas = filasPendientes([e1, e2], mapa, "2026-09-15T12:00:00.000Z");
    expect(filas).toHaveLength(2);
    const f2 = filas.find((f) => f.visitaKey === k2)!;
    expect(f2.n).toBe(2);
    expect(f2.monto).toBe(1200);
  });

  it("ordena por la espera más larga: la más antigua primero", () => {
    const filas = filasPendientes([e1, e2], mapa, "2026-09-15T12:00:00.000Z");
    expect(filas[0]!.visitaKey).toBe(k2); // propuesta desde el 13
    expect(filas[0]!.masAntigua).toBe("2026-09-13T09:00:00Z");
  });

  it("una visita sin pendientes no aparece", () => {
    const soloAutorizadas = new Map<string, Partida[]>([
      [k1, [P({ visitaKey: k1, estado: "autorizada", precioAutorizado: 100 })]],
    ]);
    expect(filasPendientes([e1], soloAutorizadas, "2026-09-15T12:00:00.000Z")).toEqual([]);
  });
});
