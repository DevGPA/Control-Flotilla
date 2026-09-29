import { describe, expect, it } from "vitest";
import { avisoSinDespues, refaccionesSinDespues, type Partida } from "../src/taller/partidas";
import { mapPartidas } from "../src/api/tallerPartidas";

const P = (sobre: Partial<Partida> = {}): Partida => ({
  partidaId: "p",
  visitaKey: "vk",
  descripcion: "Balatas delanteras",
  estado: "autorizada",
  tipo: "refaccion",
  fotos: [],
  precioAutorizado: 1850,
  ...sobre,
});

describe("refaccionesSinDespues", () => {
  it("cuenta solo refacciones AUTORIZADAS", () => {
    const ps = [
      P({ partidaId: "a" }),
      P({ partidaId: "b", estado: "propuesta" }),
      P({ partidaId: "c", estado: "rechazada" }),
    ];
    expect(refaccionesSinDespues(ps).map((p) => p.partidaId)).toEqual(["a"]);
  });
  it("una fila vieja sin tipo cuenta como refacción (el caso estricto)", () => {
    const sinTipo: Partida = {
      partidaId: "v",
      visitaKey: "vk",
      descripcion: "Balatas",
      estado: "autorizada",
      fotos: [],
    };
    expect(refaccionesSinDespues([sinTipo])).toHaveLength(1);
  });
  it("mano de obra autorizada NO cuenta: su foto es opcional", () => {
    expect(refaccionesSinDespues([P({ tipo: "manoObra" })])).toEqual([]);
  });
  it("una terminada nunca cuenta", () => {
    expect(refaccionesSinDespues([P({ estado: "terminada", evidenciaFinal: ["x.jpg"] })])).toEqual(
      [],
    );
  });
});

describe("avisoSinDespues", () => {
  it("'' cuando no falta ninguna", () => {
    expect(avisoSinDespues([])).toBe("");
    expect(avisoSinDespues([P({ estado: "terminada" })])).toBe("");
  });
  it("una: la nombra con su monto firmado", () => {
    expect(avisoSinDespues([P()])).toBe(
      "⚠ 1 refacción autorizada no tiene foto del después: Balatas delanteras ($1,850.00).\nSi la finalizas, la liga del taller se cierra y ya no podrá subirla.",
    );
  });
  it("hasta tres se nombran; sin monto firmado, solo la descripción", () => {
    const sinMonto: Partida = {
      partidaId: "b",
      visitaKey: "vk",
      descripcion: "Amortiguador",
      estado: "autorizada",
      tipo: "refaccion",
      fotos: [],
    };
    const t = avisoSinDespues([
      P({ partidaId: "a" }),
      sinMonto,
      P({ partidaId: "c", descripcion: "Rótula", precioAutorizado: 980 }),
    ]);
    expect(t).toContain("⚠ 3 refacciones autorizadas no tienen foto del después: ");
    expect(t).toContain("Balatas delanteras ($1,850.00), Amortiguador, Rótula ($980.00).");
  });
  it("más de tres: solo el número", () => {
    const t = avisoSinDespues(["a", "b", "c", "d"].map((id) => P({ partidaId: id })));
    expect(t.startsWith("⚠ 4 refacciones autorizadas no tienen foto del después.\n")).toBe(true);
    expect(t).not.toContain("Balatas");
  });
  it("descripción vacía ⇒ (sin descripción)", () => {
    expect(avisoSinDespues([P({ descripcion: "" })])).toContain("(sin descripción)");
  });
});

describe("mapPartidas — evidenciaFinal llega a Fleet", () => {
  const fila = (sobre: Record<string, unknown>) =>
    ({
      tenantId: "demo",
      visitaKey: "vk",
      partidaId: "p",
      descripcion: "x",
      precio: 1,
      estado: "terminada",
      fotos: [],
      ...sobre,
    }) as unknown as Parameters<typeof mapPartidas>[0][number];

  it("mapea evidenciaFinal y tira nulos; ausente ⇒ []", () => {
    const [a, b] = mapPartidas([
      fila({ evidenciaFinal: ["d.jpg", null] }),
      fila({ evidenciaFinal: null }),
    ]);
    expect(a!.evidenciaFinal).toEqual(["d.jpg"]);
    expect(b!.evidenciaFinal).toEqual([]);
  });
});
