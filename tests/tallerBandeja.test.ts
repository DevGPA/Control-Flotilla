import { describe, it, expect } from "vitest";
import { filasBandeja } from "../src/api/tallerPartidas";
import type { Partida } from "../src/taller/partidas";

const P = (o: Partial<Partida>): Partida => ({
  partidaId: "p",
  visitaKey: "JV98698|2026-09-01",
  descripcion: "x",
  estado: "propuesta",
  fotos: [],
  ...o,
});

const entry = {
  id: "tl_1",
  plate: "JV98698",
  eco: "42",
  fentrada: "2026-09-01",
  brand: "NP 300",
  sucursal: "Cancún",
  area: "Logística",
  tipo: "Correctivo",
  tecnico: "Frenos GDL",
  estado: "En Diagnóstico",
} as any;

describe("filasBandeja — solo visitas que esperan firma", () => {
  it("omite las visitas sin partidas propuestas", () => {
    const g = new Map([
      ["JV98698|2026-09-01", [P({ estado: "autorizada", precioAutorizado: 100 })]],
    ]);
    expect(filasBandeja([entry], g, new Map())).toEqual([]);
  });

  it("arma la fila con los tres números que hacen la firma una decisión", () => {
    const g = new Map([
      [
        "JV98698|2026-09-01",
        [
          P({ partidaId: "a", estado: "propuesta", precio: 1850, tipo: "refaccion" }),
          P({
            partidaId: "b",
            estado: "autorizada",
            precio: 2400,
            precioAutorizado: 2400,
            tipo: "manoObra",
          }),
        ],
      ],
    ]);
    const fila = filasBandeja([entry], g, new Map([["42", { gasto: 38400, visitas: 4 }]]))[0]!;
    expect(fila.eco).toBe("42");
    expect(fila.proveedor).toBe("Frenos GDL");
    expect(fila.pendientes).toBe(1);
    expect(fila.totales.cotizado).toBe(1850 + 2400);
    expect(fila.totales.autorizado).toBe(2400);
    expect(fila.gastoAnual).toBe(38400);
    expect(fila.visitasAnual).toBe(4);
    // Fix ronda 1 (Important 1): la fila trae las partidas pendientes YA
    // filtradas — el monolito nunca vuelve a preguntar estado==="propuesta".
    expect(fila.partidasPendientes.map((p) => p.partidaId)).toEqual(["a"]);
  });

  it("sin historial anual, la fila existe con ceros y no truena", () => {
    const g = new Map([["JV98698|2026-09-01", [P({ precio: 500 })]]]);
    const fila = filasBandeja([entry], g, new Map())[0]!;
    expect(fila.gastoAnual).toBe(0);
    expect(fila.visitasAnual).toBe(0);
  });

  it("ordena primero lo que lleva más tiempo esperando firma", () => {
    const otra = { ...entry, plate: "JT44219", eco: "17", fentrada: "2026-08-28" };
    const g = new Map([
      ["JV98698|2026-09-01", [P({ propuestoEn: "2026-09-05T10:00:00Z" })]],
      [
        "JT44219|2026-08-28",
        [P({ visitaKey: "JT44219|2026-08-28", propuestoEn: "2026-09-02T10:00:00Z" })],
      ],
    ]);
    expect(filasBandeja([entry, otra], g, new Map()).map((f) => f.eco)).toEqual(["17", "42"]);
  });
});
