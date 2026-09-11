// tests/tallerCapturaManual.test.ts
import { describe, it, expect } from "vitest";
import {
  autorPartidaEtiqueta,
  origenPartida,
  partidaManual,
  proponer,
  type Partida,
} from "../src/taller/partidas";

const datos = { descripcion: "Balatas delanteras", tipo: "refaccion" as const, precio: 1850 };

describe("partidaManual — misma regla, distinto autor", () => {
  it("nace en borrador, como la del proveedor", () => {
    const p = partidaManual(datos, "JV98698|2026-09-01", "abc", "2026-09-08T10:00:00Z");
    expect(p.estado).toBe("borrador");
  });

  it("la autoría dice que la capturó una persona de GPA, no la liga", () => {
    const p = partidaManual(datos, "v|1", "abc", "2026-09-08T10:00:00Z");
    expect(p.creadoPor).toBe("user:abc");
    // creadoPor es opcional en el tipo Partida (liga/portal pueden omitirlo),
    // pero partidaManual SIEMPRE lo estampa — el `?? ""` es solo para el
    // typechecker, no cambia el caso que se prueba.
    expect((p.creadoPor ?? "").startsWith("liga:")).toBe(false);
  });

  it("genera un id propio y no lo acepta del formulario", () => {
    const a = partidaManual(datos, "v|1", "abc", "2026-09-08T10:00:00Z");
    const b = partidaManual(datos, "v|1", "abc", "2026-09-08T10:00:00Z");
    expect(a.partidaId).not.toBe(b.partidaId);
    expect(a.partidaId.length).toBeGreaterThan(8);
  });

  it("aplica las mismas validaciones que la liga", () => {
    expect(() => partidaManual({ ...datos, descripcion: "  " }, "v|1", "a", "x")).toThrow();
    expect(() => partidaManual({ ...datos, precio: -5 }, "v|1", "a", "x")).toThrow();
    expect(() => partidaManual({ ...datos, tipo: "otro" as any }, "v|1", "a", "x")).toThrow();
  });

  it("una partida capturada a mano puede no traer foto — el taller mandó texto", () => {
    const p = partidaManual(datos, "v|1", "abc", "2026-09-08T10:00:00Z");
    expect(p.fotos).toEqual([]);
  });

  it("fix ronda 1 (Important 3): un autorSub vacío o en blanco no escribe 'user:' sin nadie detrás", () => {
    expect(() => partidaManual(datos, "v|1", "", "x")).toThrow();
    expect(() => partidaManual(datos, "v|1", "   ", "x")).toThrow();
  });
});

const P = (o: Partial<Partida> = {}): Partida => ({
  partidaId: "p1",
  visitaKey: "v|1",
  descripcion: "Balatas delanteras",
  tipo: "refaccion",
  precio: 1850,
  estado: "borrador",
  fotos: [],
  ...o,
});

describe("proponer — R69(b): borrador → propuesta, la misma que usa la app para mandar a firma", () => {
  it("solo transiciona desde borrador", () => {
    const r = proponer(P({ estado: "borrador" }), "2026-09-08T10:05:00Z");
    expect(r.estado).toBe("propuesta");
  });

  it("estampa propuestoEn con el valor recibido", () => {
    const r = proponer(P({ estado: "borrador" }), "2026-09-08T10:05:00Z");
    expect(r.propuestoEn).toBe("2026-09-08T10:05:00Z");
  });

  it("lanza en cualquier otro estado — nunca re-propone lo ya decidido", () => {
    for (const estado of [
      "propuesta",
      "autorizada",
      "rechazada",
      "terminada",
      "cancelada",
    ] as const) {
      expect(() => proponer(P({ estado }), "x")).toThrow();
    }
  });

  it("no muta la partida original", () => {
    const original = P({ estado: "borrador" });
    proponer(original, "x");
    expect(original.estado).toBe("borrador");
    expect(original.propuestoEn).toBeUndefined();
  });
});

describe("origenPartida — R74: nunca asume 'liga' por default", () => {
  it("user: → Capturada por GPA", () => {
    expect(origenPartida(P({ creadoPor: "user:abc123" }))).toBe("Capturada por GPA");
  });

  it("liga: → desde la liga", () => {
    expect(origenPartida(P({ creadoPor: "liga:JV98698|2026-09-01" }))).toBe("desde la liga");
  });

  it("ausente → origen desconocido, nunca 'liga' por default", () => {
    expect(origenPartida(P({ creadoPor: undefined }))).toBe("origen desconocido");
  });

  it("un prefijo que no se reconoce → origen desconocido", () => {
    expect(origenPartida(P({ creadoPor: "webhook:x" }))).toBe("origen desconocido");
  });
});

describe("autorPartidaEtiqueta — R79: 'Subió <taller>' es falso para una captura manual", () => {
  it("una captura manual (user:) nunca nombra al taller", () => {
    const p = P({ creadoPor: "user:abc123" });
    expect(autorPartidaEtiqueta(p, "Taller Hidráulico GDL")).toBe("Capturó GPA");
  });

  it("una partida de la liga sí nombra al proveedor que la subió", () => {
    const p = P({ creadoPor: "liga:JV98698|2026-09-01" });
    expect(autorPartidaEtiqueta(p, "Taller Hidráulico GDL")).toBe("Subió Taller Hidráulico GDL");
  });

  it("origen desconocido: se comporta como la liga (nombra el proveedor recibido) — nunca inventa 'Capturó GPA'", () => {
    const p = P({ creadoPor: undefined });
    expect(autorPartidaEtiqueta(p, "—")).toBe("Subió —");
  });
});
