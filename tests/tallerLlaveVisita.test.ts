// tests/tallerLlaveVisita.test.ts
import { describe, it, expect } from "vitest";
import { llaveEnUso } from "../src/taller/llaveVisita";
import { refIdTaller } from "../src/anulacion/anulacion";

const vigentes = [
  { id: "tl_1", unitUid: "PRB001A", fechaEntrada: "2026-09-14" },
  { id: "tl_2", unitUid: "PRB002B", fechaEntrada: "2026-09-18" },
];
const anuladas = new Map([
  [refIdTaller("PRB003C", "2026-09-10"), { ts: "2026-09-12T10:00:00.000Z" }],
]);

describe("llaveEnUso — ninguna visita pisa a otra", () => {
  it("una llave nueva está libre", () => {
    expect(
      llaveEnUso(
        { id: "tl_9", unitUid: "PRB001A", fechaEntrada: "2026-09-22" },
        vigentes,
        anuladas,
      ),
    ).toEqual({ kind: "libre" });
  });

  it("misma unidad y misma fecha que una visita VIGENTE ⇒ en uso, con su id", () => {
    expect(
      llaveEnUso(
        { id: "tl_9", unitUid: "PRB001A", fechaEntrada: "2026-09-14" },
        vigentes,
        anuladas,
      ),
    ).toEqual({ kind: "vigente", id: "tl_1", fentrada: "2026-09-14" });
  });

  it("la PROPIA visita (mismo id) no choca consigo misma al editarse", () => {
    expect(
      llaveEnUso(
        { id: "tl_1", unitUid: "PRB001A", fechaEntrada: "2026-09-14" },
        vigentes,
        anuladas,
      ),
    ).toEqual({ kind: "libre" });
  });

  it("misma llave que una visita ANULADA ⇒ en uso (anulada), con la fecha de anulación", () => {
    expect(
      llaveEnUso(
        { id: "tl_9", unitUid: "PRB003C", fechaEntrada: "2026-09-10" },
        vigentes,
        anuladas,
      ),
    ).toEqual({ kind: "anulada", fentrada: "2026-09-10", anuladaEn: "2026-09-12T10:00:00.000Z" });
  });

  it("el refId de la anulada se compone con refIdTaller, no con una cadena a mano", () => {
    const soloRefId = new Map([["taller|PRB004D|2026-09-01", {}]]);
    expect(llaveEnUso({ unitUid: "PRB004D", fechaEntrada: "2026-09-01" }, [], soloRefId).kind).toBe(
      "anulada",
    );
  });

  it("sin id en la candidata (alta nueva) una vigente con la misma llave sí choca", () => {
    expect(
      llaveEnUso({ unitUid: "PRB002B", fechaEntrada: "2026-09-18" }, vigentes, anuladas).kind,
    ).toBe("vigente");
  });

  it("la vigente gana sobre la anulada si ambas existen (la vigente es la que se pisaría)", () => {
    const ambas = new Map([[refIdTaller("PRB001A", "2026-09-14"), {}]]);
    expect(
      llaveEnUso({ unitUid: "PRB001A", fechaEntrada: "2026-09-14" }, vigentes, ambas).kind,
    ).toBe("vigente");
  });
});
