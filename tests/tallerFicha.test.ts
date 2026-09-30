// Registro como ficha (spec 2026-09-30 §4.2): las cuentas viven en src/, el monolito pinta.
import { describe, expect, it } from "vitest";
import { diasEnTallerTabla, diferenciaDiasCiviles, fichaRegistro } from "../src/taller/ficha";
import { ordenarHallazgos } from "../src/taller/seguimiento";
import type { Partida } from "../src/taller/partidas";
import type { TallerEntry } from "../src/taller/types";

// 10:00 en CST del 30/09: la fórmula de la tabla (medianoche UTC) da 6 con entrada 25/09;
// el Excel (medianoche local) daría 5. Manda la tabla (§2 #25).
const AHORA = "2026-09-30T16:00:00.000Z";
const OPTS = { ahora: AHORA, hibrido: true as boolean | undefined, confiables: true };

const P = (s: Partial<Partida> = {}): Partida =>
  ({
    partidaId: "p",
    visitaKey: "vk",
    descripcion: "Balatas",
    estado: "propuesta",
    tipo: "refaccion",
    fotos: [],
    precio: 2400,
    creadoEn: "2026-09-25T16:00:00.000Z",
    ...s,
  }) as Partida;

const E = (s: Partial<TallerEntry> = {}): Partial<TallerEntry> => ({
  estado: "En Reparación",
  tipo: "Correctivo",
  fentrada: "2026-09-25",
  fsalidaEst: "2026-09-30",
  ...s,
});

describe("diasEnTallerTabla — la MISMA cuenta que la tabla", () => {
  it("entrada 25/09 y ahora 30/09 10:00 CST ⇒ 6", () => {
    expect(diasEnTallerTabla("2026-09-25", Date.parse(AHORA))).toBe(6);
  });
  it("fecha inválida ⇒ 0, nunca NaN", () => {
    expect(diasEnTallerTabla("", Date.parse(AHORA))).toBe(0);
    expect(diasEnTallerTabla("no-es-fecha", Date.parse(AHORA))).toBe(0);
  });
});

describe("diferenciaDiasCiviles — días de calendario, sin huso", () => {
  it("30/09 → 01/10 ⇒ 1; 01/10 → 30/09 ⇒ -1; inválida ⇒ null", () => {
    expect(diferenciaDiasCiviles("2026-09-30", "2026-10-01")).toBe(1);
    expect(diferenciaDiasCiviles("2026-10-01", "2026-09-30")).toBe(-1);
    expect(diferenciaDiasCiviles("2026-09-30", "")).toBeNull();
  });
});

describe("fichaRegistro — días", () => {
  it("visita abierta: 6 días, tono ámbar (>3), 'Ingresó' el 25/09", () => {
    const f = fichaRegistro(E(), [], OPTS);
    expect(f.dias).toEqual({
      n: 6,
      cerrada: false,
      inicio: "2026-09-25",
      fin: null,
      tono: "ambar",
    });
  });
  it("más de 7 días ⇒ rojo; 3 o menos ⇒ normal", () => {
    expect(fichaRegistro(E({ fentrada: "2026-09-20" }), [], OPTS).dias.tono).toBe("rojo");
    expect(fichaRegistro(E({ fentrada: "2026-09-28" }), [], OPTS).dias.tono).toBe("normal");
  });
  it("visita cerrada: cuenta hasta la salida real y el tono es normal", () => {
    const f = fichaRegistro(E({ estado: "Finalizado", fsalidaReal: "2026-09-29" }), [], OPTS);
    expect(f.dias).toEqual({
      n: 4,
      cerrada: true,
      inicio: "2026-09-25",
      fin: "2026-09-29",
      tono: "normal",
    });
  });
});

describe("fichaRegistro — salida (una sola señal, por prioridad)", () => {
  it("promesa del taller vencida gana", () => {
    const f = fichaRegistro(
      E({ fsalidaEst: "2026-09-28", fsalidaEstTaller: "2026-09-27" }),
      [],
      OPTS,
    );
    expect(f.salida.senal).toEqual({ kind: "promesa-vencida", dias: 3 });
    expect(f.salida.prometida).toBe("2026-09-27");
  });
  it("sin promesa y estimada de GPA vencida ⇒ 'estimada-vencida'", () => {
    const f = fichaRegistro(E({ fsalidaEst: "2026-09-27" }), [], OPTS);
    expect(f.salida.senal.kind).toBe("estimada-vencida");
  });
  it("promesa vigente un día después de la estimada ⇒ 'despues-de-estimada' 1", () => {
    const f = fichaRegistro(
      E({ fsalidaEst: "2026-10-05", fsalidaEstTaller: "2026-10-06" }),
      [],
      OPTS,
    );
    expect(f.salida.senal).toEqual({ kind: "despues-de-estimada", dias: 1 });
    expect(f.salida.estimadaGpa).toBe("2026-10-05");
  });
  it("promesa igual o antes de la estimada ⇒ ninguna; 'había prometido' viaja", () => {
    const f = fichaRegistro(
      E({
        fsalidaEst: "2026-10-05",
        fsalidaEstTaller: "2026-10-05",
        fsalidaEstCompromiso: "2026-10-03",
      }),
      [],
      OPTS,
    );
    expect(f.salida.senal).toEqual({ kind: "ninguna" });
    expect(f.salida.compromisoOriginal).toBe("2026-10-03");
  });
  it("cerrada: nunca vencida", () => {
    const f = fichaRegistro(
      E({ estado: "Finalizado", fsalidaReal: "2026-09-29", fsalidaEst: "2026-09-27" }),
      [],
      OPTS,
    );
    expect(f.salida.senal).toEqual({ kind: "ninguna" });
  });
});

describe("fichaRegistro — costo (tri-estado del apagador)", () => {
  const ps = [
    P({ estado: "autorizada", precioAutorizado: 1850 }),
    P({ estado: "propuesta", precio: 2400 }),
  ];
  it("híbrido ON, confiables y con partidas ⇒ autorizado y pendiente de la capa pura", () => {
    expect(fichaRegistro(E(), ps, OPTS).costo).toEqual({
      kind: "partidas",
      autorizado: 1850,
      pendiente: 2400,
    });
  });
  it("híbrido ON, confiables, sin partidas ⇒ capturado por GPA", () => {
    expect(fichaRegistro(E({ gastoRef: 100, gastoMO: 50 }), [], OPTS).costo).toEqual({
      kind: "capturado",
      monto: 150,
      verificando: false,
    });
  });
  it("híbrido ON y NO confiables ⇒ sin datos, nunca $0", () => {
    const c = fichaRegistro(E(), [], { ...OPTS, confiables: false }).costo;
    expect(c).toEqual({ kind: "sin-datos" });
  });
  it("híbrido OFF ⇒ capturado aunque haya partidas", () => {
    expect(fichaRegistro(E({ gasto: 999 }), ps, { ...OPTS, hibrido: false }).costo).toEqual({
      kind: "capturado",
      monto: 999,
      verificando: false,
    });
  });
  it("híbrido desconocido ⇒ capturado · verificando", () => {
    expect(fichaRegistro(E({ gasto: 999 }), ps, { ...OPTS, hibrido: undefined }).costo).toEqual({
      kind: "capturado",
      monto: 999,
      verificando: true,
    });
  });
});

describe("fichaRegistro — estado GPA y la línea 'Esperando firma' (§2 #14)", () => {
  it("copia estado y tipo; con pendientes y promesa vigente ⇒ esperandoFirma", () => {
    const f = fichaRegistro(E({ fsalidaEstTaller: "2026-10-06" }), [P()], OPTS);
    expect(f.estadoGpa).toBe("En Reparación");
    expect(f.tipo).toBe("Correctivo");
    expect(f.esperandoFirma).toBe(true);
  });
  it("con la promesa vencida la lista marca «Promesa vencida»: la línea NO sale", () => {
    expect(fichaRegistro(E({ fsalidaEstTaller: "2026-09-27" }), [P()], OPTS).esperandoFirma).toBe(
      false,
    );
  });
  it("sin pendientes, con el apagador apagado o sin partidas confiables ⇒ false", () => {
    expect(fichaRegistro(E(), [], OPTS).esperandoFirma).toBe(false);
    expect(fichaRegistro(E(), [P()], { ...OPTS, hibrido: false }).esperandoFirma).toBe(false);
    expect(fichaRegistro(E(), [P()], { ...OPTS, confiables: false }).esperandoFirma).toBe(false);
  });
  it("tallerNombre sale de 'Técnico asignado' (§2 #16), vacío ⇒ null", () => {
    expect(fichaRegistro(E({ tecnico: "  Taller Frenos del Bajío " }), [], OPTS).tallerNombre).toBe(
      "Taller Frenos del Bajío",
    );
    expect(fichaRegistro(E({ tecnico: "  " }), [], OPTS).tallerNombre).toBeNull();
  });
});

describe("ordenarHallazgos — tres grupos, orden estable (§2 #18)", () => {
  it("propuestas → autorizadas/terminadas → el resto, cada grupo en el orden de llegada", () => {
    const a = P({ partidaId: "a", estado: "autorizada" });
    const b = P({ partidaId: "b", estado: "propuesta" });
    const c = P({ partidaId: "c", estado: "rechazada" });
    const d = P({ partidaId: "d", estado: "terminada" });
    const e = P({ partidaId: "e", estado: "propuesta" });
    const f = P({ partidaId: "f", estado: "borrador" });
    const g = ordenarHallazgos([a, b, c, d, e, f]);
    expect(g.esperanFirma.map((p) => p.partidaId)).toEqual(["b", "e"]);
    expect(g.autorizados.map((p) => p.partidaId)).toEqual(["a", "d"]);
    expect(g.noAutorizados.map((p) => p.partidaId)).toEqual(["c", "f"]);
  });
  it("vacío ⇒ tres grupos vacíos", () => {
    expect(ordenarHallazgos([])).toEqual({ esperanFirma: [], autorizados: [], noAutorizados: [] });
  });
});
