import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  estadoLiga,
  promesaTaller,
  revocacionPorCierre,
  distintivoProveedor,
  VIGENCIA_LIGA_DIAS,
} from "../src/taller/seguimiento";
import type { ResumenPartidas } from "../src/taller/seguimiento";

const EMITIDA = "2026-09-01T10:00:00.000Z";
const POR = "alguien@ejemplo.test";

describe("estadoLiga", () => {
  it("sin ligaCreadaEn no hay liga", () => {
    expect(estadoLiga({}, "2026-09-15T12:00:00.000Z")).toEqual({ kind: "sin-liga" });
  });

  it("recién emitida: activa con los días que faltan", () => {
    const r = estadoLiga({ ligaCreadaEn: EMITIDA, ligaCreadaPor: POR }, "2026-09-15T12:00:00.000Z");
    expect(r.kind).toBe("activa");
    if (r.kind !== "activa") throw new Error("kind");
    expect(r.diasRestantes).toBe(76); // 90 − 14 días transcurridos
    expect(r.emitidaPor).toBe(POR);
    expect(r.venceEn.slice(0, 10)).toBe("2026-11-30");
  });

  it("el día 90 exacto ya está vencida (el portal deja de aceptarla)", () => {
    const r = estadoLiga({ ligaCreadaEn: EMITIDA, ligaCreadaPor: POR }, "2026-11-30T10:00:00.000Z");
    expect(r.kind).toBe("vencida");
  });

  it("revocada después de emitir gana sobre activa", () => {
    const r = estadoLiga(
      {
        ligaCreadaEn: EMITIDA,
        ligaCreadaPor: POR,
        ligaRevocadaEn: "2026-09-10T10:00:00.000Z",
        ligaRevocadaPor: POR,
      },
      "2026-09-15T12:00:00.000Z",
    );
    expect(r.kind).toBe("revocada");
  });

  it("re-emitida DESPUÉS de una revocación vuelve a estar activa", () => {
    // emitirLiga limpia ligaRevocada*, pero si llegara una fila con ambas, gana
    // la más reciente: la liga que sirve es la última emitida.
    const r = estadoLiga(
      {
        ligaCreadaEn: "2026-09-12T10:00:00.000Z",
        ligaCreadaPor: POR,
        ligaRevocadaEn: "2026-09-10T10:00:00.000Z",
        ligaRevocadaPor: POR,
      },
      "2026-09-15T12:00:00.000Z",
    );
    expect(r.kind).toBe("activa");
  });

  it("la vigencia es la MISMA que aplica el portal", () => {
    const portal = readFileSync(
      join(__dirname, "..", "amplify", "functions", "taller-portal", "token.ts"),
      "utf8",
    );
    const m = portal.match(/VIGENCIA_LIGA_MS\s*=\s*(\d+)\s*\*\s*24/);
    expect(m, "no se encontró VIGENCIA_LIGA_MS en el portal").not.toBeNull();
    expect(Number(m![1])).toBe(VIGENCIA_LIGA_DIAS);
  });
});

describe("promesaTaller", () => {
  it("sin fecha prometida no hay promesa", () => {
    expect(promesaTaller({}, "2026-09-15")).toEqual({ kind: "sin-promesa" });
  });

  it("fecha futura: vigente con los días que faltan", () => {
    const r = promesaTaller({ fsalidaEstTaller: "2026-09-19" }, "2026-09-15");
    expect(r).toEqual({ kind: "vigente", fecha: "2026-09-19", diasRestantes: 4 });
  });

  it("fecha pasada y visita abierta: vencida con los días de retraso", () => {
    const r = promesaTaller({ fsalidaEstTaller: "2026-09-12" }, "2026-09-15");
    expect(r.kind).toBe("vencida");
    if (r.kind !== "vencida") throw new Error("kind");
    expect(r.diasVencida).toBe(3);
  });

  it("una visita YA CERRADA no tiene promesa vencida", () => {
    for (const cerrada of [
      { fsalidaEstTaller: "2026-09-12", fsalidaReal: "2026-09-13" },
      { fsalidaEstTaller: "2026-09-12", estado: "Finalizado" as const },
    ]) {
      expect(promesaTaller(cerrada, "2026-09-15").kind).not.toBe("vencida");
    }
  });

  it("si el taller movió la promesa, se conserva el compromiso ORIGINAL", () => {
    const r = promesaTaller(
      { fsalidaEstTaller: "2026-09-19", fsalidaEstCompromiso: "2026-09-12" },
      "2026-09-15",
    );
    expect(r.kind).toBe("vigente");
    if (r.kind !== "vigente") throw new Error("kind");
    expect(r.compromisoOriginal).toBe("2026-09-12");
  });

  it("si no la movió, no se repite el compromiso", () => {
    const r = promesaTaller(
      { fsalidaEstTaller: "2026-09-19", fsalidaEstCompromiso: "2026-09-19" },
      "2026-09-15",
    );
    if (r.kind !== "vigente") throw new Error("kind");
    expect(r.compromisoOriginal).toBeUndefined();
  });
});

describe("estadoLiga — 'cerrada': liga vigente en una visita cerrada", () => {
  const AHORA = "2026-09-15T12:00:00.000Z";
  it("con fsalidaReal, una liga vigente pasa a 'cerrada' (no 'activa')", () => {
    const r = estadoLiga(
      { ligaCreadaEn: EMITIDA, ligaCreadaPor: POR, fsalidaReal: "2026-09-14" },
      AHORA,
    );
    expect(r).toEqual({ kind: "cerrada", emitidaEn: EMITIDA, emitidaPor: POR });
  });
  it("con estado Finalizado también", () => {
    expect(
      estadoLiga({ ligaCreadaEn: EMITIDA, ligaCreadaPor: POR, estado: "Finalizado" }, AHORA).kind,
    ).toBe("cerrada");
  });
  it("revocada gana sobre cerrada", () => {
    const r = estadoLiga(
      {
        ligaCreadaEn: EMITIDA,
        ligaRevocadaEn: "2026-09-10T00:00:00.000Z",
        ligaRevocadaPor: POR,
        fsalidaReal: "2026-09-14",
      },
      AHORA,
    );
    expect(r.kind).toBe("revocada");
  });
  it("vencida gana sobre cerrada (una liga vencida ya no hay que revocarla)", () => {
    expect(
      estadoLiga(
        { ligaCreadaEn: EMITIDA, ligaCreadaPor: POR, fsalidaReal: "2026-12-01" },
        "2026-12-15T00:00:00.000Z",
      ).kind,
    ).toBe("vencida");
  });
  it("abierta sigue siendo 'activa'", () => {
    expect(
      estadoLiga({ ligaCreadaEn: EMITIDA, ligaCreadaPor: POR, estado: "En Reparación" }, AHORA)
        .kind,
    ).toBe("activa");
  });
  it("el distintivo trata 'cerrada' como 'sin-liga'", () => {
    const resumen: ResumenPartidas = {
      pendientes: { n: 0, monto: 0 },
      autorizadas: { n: 0, monto: 0 },
      rechazadas: { n: 0, monto: 0 },
      borradoresTaller: 0,
    };
    expect(
      distintivoProveedor(
        { kind: "cerrada", emitidaEn: EMITIDA, emitidaPor: POR },
        { kind: "sin-promesa" },
        resumen,
      ),
    ).toEqual({ kind: "sin-liga" });
  });
});

describe("revocacionPorCierre — al cerrar, el mismo guardado revoca la liga", () => {
  const AHORA = "2026-09-22T18:00:00.000Z";
  it("visita cerrada con liga vigente ⇒ versión +1 y rastro 'cierre:<quien>'", () => {
    expect(
      revocacionPorCierre(
        { ligaCreadaEn: EMITIDA, ligaCreadaPor: POR, ligaVersion: 3, fsalidaReal: "2026-09-22" },
        AHORA,
        "riesgos@ejemplo.test",
      ),
    ).toEqual({
      ligaVersion: 4,
      ligaRevocadaEn: AHORA,
      ligaRevocadaPor: "cierre:riesgos@ejemplo.test",
    });
  });
  it("sin ligaVersion en la fila, la versión implícita es 1 ⇒ pasa a 2 (misma regla que el portal)", () => {
    expect(
      revocacionPorCierre(
        { ligaCreadaEn: EMITIDA, fsalidaReal: "2026-09-22" },
        AHORA,
        "x@ejemplo.test",
      )?.ligaVersion,
    ).toBe(2);
  });
  it("visita ABIERTA ⇒ null (nada viaja)", () => {
    expect(
      revocacionPorCierre(
        { ligaCreadaEn: EMITIDA, estado: "En Reparación" },
        AHORA,
        "x@ejemplo.test",
      ),
    ).toBeNull();
  });
  it("cerrada pero SIN liga ⇒ null", () => {
    expect(revocacionPorCierre({ fsalidaReal: "2026-09-22" }, AHORA, "x@ejemplo.test")).toBeNull();
  });
  it("cerrada con liga YA revocada ⇒ null (no se re-revoca en cada guardado)", () => {
    expect(
      revocacionPorCierre(
        {
          ligaCreadaEn: EMITIDA,
          ligaRevocadaEn: "2026-09-21T00:00:00.000Z",
          fsalidaReal: "2026-09-22",
        },
        AHORA,
        "x@ejemplo.test",
      ),
    ).toBeNull();
  });
  it("cerrada con liga VENCIDA ⇒ null (ya no sirve; no hay nada que matar)", () => {
    expect(
      revocacionPorCierre(
        { ligaCreadaEn: EMITIDA, fsalidaReal: "2026-12-10" },
        "2026-12-15T00:00:00.000Z",
        "x@ejemplo.test",
      ),
    ).toBeNull();
  });
  it("sin quien ⇒ rastro 'cierre:desconocido' (nunca vacío)", () => {
    expect(
      revocacionPorCierre({ ligaCreadaEn: EMITIDA, fsalidaReal: "2026-09-22" }, AHORA, "")
        ?.ligaRevocadaPor,
    ).toBe("cierre:desconocido");
  });
});
