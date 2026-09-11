// tests/tallerPartidasApi.test.ts
import { describe, it, expect } from "vitest";
import { agruparPorVisita, visitaKeyDe } from "../src/api/tallerPartidas";
import { tallerCloudKey } from "../src/api/batchUpload";
import type { Partida } from "../src/taller/partidas";

const P = (visitaKey: string, partidaId: string, estado: Partida["estado"]): Partida => ({
  partidaId,
  visitaKey,
  descripcion: "x",
  estado,
  fotos: [],
});

describe("visitaKeyDe — una sola llave, derivada de la que ya existe", () => {
  it("es exactamente unitUid|fechaEntrada de tallerCloudKey", () => {
    const e = { id: "tl_1", plate: "JV98698", fentrada: "2026-09-01" } as any;
    const k = tallerCloudKey(e);
    expect(visitaKeyDe(e)).toBe(`${k.unitUid}|${k.fechaEntrada}`);
    expect(visitaKeyDe(e)).toBe("JV98698|2026-09-01");
  });

  it("hereda los mismos fallbacks (eco, unitKey, id) sin reimplementarlos", () => {
    expect(visitaKeyDe({ id: "tl_2", eco: "42", fentrada: "2026-09-02" } as any)).toBe(
      "42|2026-09-02",
    );
    const sinFecha = { id: "tl_3", eco: "9" } as any;
    expect(visitaKeyDe(sinFecha)).toBe(`9|${tallerCloudKey(sinFecha).fechaEntrada}`);
  });
});

describe("agruparPorVisita", () => {
  it("agrupa por visitaKey", () => {
    const g = agruparPorVisita([
      P("a|1", "p1", "propuesta"),
      P("a|1", "p2", "autorizada"),
      P("b|2", "p3", "propuesta"),
    ]);
    expect(g.get("a|1")?.length).toBe(2);
    expect(g.get("b|2")?.length).toBe(1);
  });

  it("deja fuera las canceladas — se conservan en la base, no en la vista", () => {
    const g = agruparPorVisita([P("a|1", "p1", "cancelada"), P("a|1", "p2", "propuesta")]);
    expect(g.get("a|1")?.map((p) => p.partidaId)).toEqual(["p2"]);
  });

  it("un set vacío da un mapa vacío, no undefined", () => {
    expect(agruparPorVisita([]).size).toBe(0);
  });
});
