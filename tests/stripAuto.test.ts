import { describe, expect, it } from "vitest";
import { stripAuto, type DoneMap } from "../src/analyzer/findingKey";

describe("stripAuto", () => {
  it("elimina entradas auto y conserva marcas y tombstones manuales, sin mutar", () => {
    const dm: DoneMap = {
      "Bin:Tapetes completos": { done: true, ts: "2026-07-06", by: "auto", auto: true },
      "Llanta:Piloto Delantera": { done: true, ts: "2026-07-01T10:00:00Z", by: "navares@gpa" },
      "Mant:Servicio": { done: false, ts: "2026-07-10T09:00:00Z" },
    };
    const out = stripAuto(dm);
    expect(Object.keys(out).sort()).toEqual(["Llanta:Piloto Delantera", "Mant:Servicio"]);
    expect(dm["Bin:Tapetes completos"]).toBeDefined(); // el original queda intacto
  });
});
