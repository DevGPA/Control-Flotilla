// tests/tallerPartidas.test.ts
import { describe, it, expect } from "vitest";
import {
  MOTIVOS_RECHAZO,
  autorizar,
  esEditablePorProveedor,
  estadoCompuesto,
  montoPendienteDeFirma,
  partidasPendientesDeFirma,
  pendientesDeFirma,
  puedeCancelar,
  rechazar,
  totalesVisita,
  type Partida,
} from "../src/taller/partidas";

const P = (o: Partial<Partida> = {}): Partida => ({
  partidaId: "p1",
  visitaKey: "JV98698|2026-09-01",
  descripcion: "Balatas delanteras",
  tipo: "refaccion",
  precio: 1850,
  estado: "borrador",
  fotos: [],
  ...o,
});

describe("editabilidad — una partida enviada se congela", () => {
  it("el proveedor edita solo en borrador", () => {
    expect(esEditablePorProveedor(P({ estado: "borrador" }))).toBe(true);
    for (const e of ["propuesta", "autorizada", "rechazada", "terminada", "cancelada"] as const) {
      expect(esEditablePorProveedor(P({ estado: e }))).toBe(false);
    }
  });

  it("el proveedor cancela mientras no haya firma; después solo Riesgos", () => {
    expect(puedeCancelar(P({ estado: "borrador" }), "proveedor")).toBe(true);
    expect(puedeCancelar(P({ estado: "propuesta" }), "proveedor")).toBe(true);
    expect(puedeCancelar(P({ estado: "autorizada" }), "proveedor")).toBe(false);
    expect(puedeCancelar(P({ estado: "autorizada" }), "riesgos")).toBe(true);
    expect(puedeCancelar(P({ estado: "cancelada" }), "riesgos")).toBe(false);
  });
});

describe("firma — se autoriza un precio, no una idea", () => {
  it("congela el precio autorizado y registra quién y cuándo", () => {
    const r = autorizar(
      P({ estado: "propuesta", precio: 1850 }),
      "user:abc",
      "2026-09-03T10:00:00Z",
    );
    expect(r.estado).toBe("autorizada");
    expect(r.precioAutorizado).toBe(1850);
    expect(r.decididoPor).toBe("user:abc");
    expect(r.decididoEn).toBe("2026-09-03T10:00:00Z");
  });

  it("no autoriza un borrador que nunca se envió", () => {
    expect(() =>
      autorizar(P({ estado: "borrador" }), "user:abc", "2026-09-03T10:00:00Z"),
    ).toThrow();
  });

  it("rechazar exige un motivo del menú cerrado", () => {
    const r = rechazar(
      P({ estado: "propuesta" }),
      "No es necesario ahora",
      undefined,
      "user:abc",
      "x",
    );
    expect(r.estado).toBe("rechazada");
    expect(r.motivoRechazo).toBe("No es necesario ahora");
    expect(r.precioAutorizado).toBeUndefined();
    expect(() => rechazar(P({ estado: "propuesta" }), "porque no", undefined, "u", "x")).toThrow();
  });

  it('"Otro" exige la nota — es lo que dice qué opción falta en el menú', () => {
    expect(() => rechazar(P({ estado: "propuesta" }), "Otro", "   ", "u", "x")).toThrow();
    const r = rechazar(P({ estado: "propuesta" }), "Otro", "La unidad se da de baja", "u", "x");
    expect(r.motivoRechazoNota).toBe("La unidad se da de baja");
  });

  it("los cinco motivos son exactamente los del spec", () => {
    expect(MOTIVOS_RECHAZO).toEqual([
      "No es necesario ahora",
      "Precio alto — recotizar",
      "Se repara en otro lado",
      "No corresponde a esta unidad",
      "Otro",
    ]);
  });
});

describe("totales — el gasto es la suma de lo firmado", () => {
  const ps = [
    P({
      partidaId: "a",
      estado: "autorizada",
      precio: 1850,
      precioAutorizado: 1850,
      tipo: "refaccion",
    }),
    P({
      partidaId: "b",
      estado: "autorizada",
      precio: 2400,
      precioAutorizado: 2400,
      tipo: "manoObra",
    }),
    P({ partidaId: "c", estado: "rechazada", precio: 980, tipo: "refaccion" }),
    P({ partidaId: "d", estado: "propuesta", precio: 500, tipo: "refaccion" }),
    P({ partidaId: "e", estado: "borrador", precio: 9999, tipo: "refaccion" }),
    P({ partidaId: "f", estado: "cancelada", precio: 7777, tipo: "refaccion" }),
  ];

  it("autorizado usa el precio congelado, no el capturado", () => {
    const t = totalesVisita([
      P({ estado: "autorizada", precio: 9999, precioAutorizado: 1850, tipo: "refaccion" }),
    ]);
    expect(t.autorizado).toBe(1850);
  });

  it("cotizado cuenta lo propuesto y lo ya decidido, nunca borradores ni canceladas", () => {
    const t = totalesVisita(ps);
    expect(t.cotizado).toBe(1850 + 2400 + 980 + 500);
    expect(t.autorizado).toBe(1850 + 2400);
    expect(t.rechazado).toBe(980);
  });

  it("el desglose Ref/MO sale solo — hoy el Excel reporta $0 en el 100%", () => {
    const t = totalesVisita(ps);
    expect(t.gastoRef).toBe(1850);
    expect(t.gastoMO).toBe(2400);
    expect(t.gastoRef + t.gastoMO).toBe(t.autorizado);
  });

  it("una visita sin partidas da ceros, no NaN", () => {
    const t = totalesVisita([]);
    expect(t).toEqual({ cotizado: 0, autorizado: 0, rechazado: 0, gastoRef: 0, gastoMO: 0 });
  });

  it("cuenta lo que espera firma", () => {
    expect(pendientesDeFirma(ps)).toBe(1);
    expect(pendientesDeFirma([])).toBe(0);
  });

  // Fix ronda 1 de Task 8 (Important 1): pendientesDeFirma es el .length de
  // partidasPendientesDeFirma — una sola definición de "esperando firma",
  // que filasBandeja (src/api/tallerPartidas.ts) y el badge comparten.
  it("partidasPendientesDeFirma es la MISMA lista de la que pendientesDeFirma saca el conteo", () => {
    const pendientes = partidasPendientesDeFirma(ps);
    expect(pendientes.map((p) => p.partidaId)).toEqual(["d"]);
    expect(pendientes.every((p) => p.estado === "propuesta")).toBe(true);
    expect(pendientes.length).toBe(pendientesDeFirma(ps));
    expect(partidasPendientesDeFirma([])).toEqual([]);
  });

  // Fix ronda 2 (Task 9, Important 2): antes la leyenda de #tf-gasto calculaba esto
  // como un residuo (`cotizado - autorizado - rechazado`), que solo cuadraba porque
  // `autorizar()` congela `precioAutorizado = p.precio`. montoPendienteDeFirma suma
  // directo el `precio` de lo pendiente — no le importa qué pasó con lo ya decidido.
  it("montoPendienteDeFirma suma el precio COTIZADO de lo pendiente, nada más", () => {
    expect(montoPendienteDeFirma(ps)).toBe(500); // solo "d" (propuesta)
    expect(montoPendienteDeFirma([])).toBe(0);
  });

  it("montoPendienteDeFirma no se mueve si lo YA decidido se autorizó a un precio negociado — el residuo sí se hubiera movido", () => {
    const psConNegociacion = [
      ...ps,
      // Autorizada a un precio MENOR al cotizado (negociación) — precioAutorizado
      // existe como campo aparte de precio justo para este caso.
      P({
        partidaId: "z",
        estado: "autorizada",
        precio: 3000,
        precioAutorizado: 2000,
        tipo: "refaccion",
      }),
    ];
    // El residuo totalesVisita().cotizado - .autorizado - .rechazado SÍ cambiaría aquí
    // (cotizado sube 3000, autorizado solo 2000 → el residuo "ve" 1000 de más
    // esperando firma que en realidad ya se decidió). montoPendienteDeFirma no:
    // "z" es autorizada, no propuesta, así que no cuenta.
    expect(montoPendienteDeFirma(psConNegociacion)).toBe(500);
  });

  it("terminada también cuenta hacia el gasto — es una autorizada que ya se cerró", () => {
    const psTerminadas = [
      P({
        partidaId: "g",
        estado: "terminada",
        precio: 9999,
        precioAutorizado: 1200,
        tipo: "refaccion",
      }),
      P({
        partidaId: "h",
        estado: "terminada",
        precio: 500,
        precioAutorizado: 500,
        tipo: "manoObra",
      }),
    ];
    const t = totalesVisita(psTerminadas);
    expect(t.cotizado).toBe(9999 + 500);
    expect(t.autorizado).toBe(1200 + 500);
    expect(t.gastoRef).toBe(1200);
    expect(t.gastoMO).toBe(500);
    expect(t.gastoRef + t.gastoMO).toBe(t.autorizado);
    expect(t.rechazado).toBe(0);
    // terminada ya se decidió: no es algo que espere firma.
    expect(pendientesDeFirma(psTerminadas)).toBe(0);
  });
});

describe("estado compuesto — el estado de la visita no puede mentir", () => {
  const base = { estado: "En Diagnóstico" as const, estadoOperativo: "reparando" as const };

  it("si hay partidas esperando firma, gana Cotización", () => {
    expect(estadoCompuesto(base, [P({ estado: "propuesta" })])).toBe("Cotización");
  });

  it("sin pendientes, refleja lo que el taller está haciendo", () => {
    expect(estadoCompuesto({ ...base, estadoOperativo: "revisando" }, [])).toBe("En Diagnóstico");
    expect(estadoCompuesto({ ...base, estadoOperativo: "reparando" }, [])).toBe("En Reparación");
    expect(estadoCompuesto({ ...base, estadoOperativo: "esperandoRefaccion" }, [])).toBe(
      "En Reparación",
    );
    expect(estadoCompuesto({ ...base, estadoOperativo: "lista" }, [])).toBe("Por recuperar");
  });

  it("Finalizado gana sobre todo, incluso con pendientes", () => {
    expect(estadoCompuesto({ estado: "Finalizado" }, [P({ estado: "propuesta" })])).toBe(
      "Finalizado",
    );
  });

  it("una visita vieja sin estadoOperativo conserva su estado capturado", () => {
    expect(estadoCompuesto({ estado: "Por recuperar" }, [])).toBe("Por recuperar");
  });
});
