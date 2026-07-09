import { describe, expect, it } from "vitest";
import {
  refIdCombustible,
  refIdChecklist,
  refIdSemanal,
  moduloDeRefId,
  esAnulacionActiva,
  buildAnuladasActivas,
  type AnulacionRow,
} from "../src/anulacion/anulacion";

describe("constructores de refId (identidad natural por módulo)", () => {
  it("combustible: prefijo + loadId (eco|tipo|eventoId)", () => {
    expect(refIdCombustible("44|carga|4050")).toBe("combustible|44|carga|4050");
  });
  it("checklist: placa + fecha", () => {
    expect(refIdChecklist("JX36971", "2026-07-01")).toBe("checklist|JX36971|2026-07-01");
  });
  it("semanal: semana ISO + placa", () => {
    expect(refIdSemanal("2026-W27", "JX36971")).toBe("semanal|2026-W27|JX36971");
  });
  it("moduloDeRefId extrae el módulo", () => {
    expect(moduloDeRefId("combustible|44|carga|4050")).toBe("combustible");
    expect(moduloDeRefId("checklist|X|2026-07-01")).toBe("checklist");
    expect(moduloDeRefId("")).toBe("");
  });
});

describe("esAnulacionActiva / buildAnuladasActivas", () => {
  const activa: AnulacionRow = {
    refId: "combustible|44|carga|4050",
    modulo: "combustible",
    motivo: "carga duplicada",
    anuladoPor: "admin@gpa.com.mx",
    ts: "2026-07-09T10:00:00Z",
  };
  const restaurada: AnulacionRow = {
    refId: "checklist|JX36971|2026-07-01",
    modulo: "checklist",
    motivo: "error",
    anuladoPor: "admin@gpa.com.mx",
    ts: "2026-07-08T10:00:00Z",
    restauradaPor: "admin@gpa.com.mx",
    restauradaTs: "2026-07-09T09:00:00Z",
  };

  it("una anulación restaurada YA NO aplica (pero la fila existe → historial)", () => {
    expect(esAnulacionActiva(activa)).toBe(true);
    expect(esAnulacionActiva(restaurada)).toBe(false);
    expect(esAnulacionActiva({ restauradaTs: null })).toBe(true);
  });

  it("buildAnuladasActivas indexa solo las activas, con motivo/quién/cuándo", () => {
    const m = buildAnuladasActivas([activa, restaurada]);
    expect(m.size).toBe(1);
    expect(m.get("combustible|44|carga|4050")).toEqual({
      motivo: "carga duplicada",
      anuladoPor: "admin@gpa.com.mx",
      ts: "2026-07-09T10:00:00Z",
    });
    expect(m.has("checklist|JX36971|2026-07-01")).toBe(false);
  });

  it("filas sin refId se ignoran; campos faltantes degradan a string vacío", () => {
    const m = buildAnuladasActivas([{ refId: "" }, { refId: "semanal|2026-W27|AAA111" }]);
    expect(m.size).toBe(1);
    expect(m.get("semanal|2026-W27|AAA111")).toEqual({ motivo: "", anuladoPor: "", ts: "" });
  });
});
