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

  it("predicado de exclusión de hidratación: checklist y semanal por identidad natural", () => {
    const anuladas = buildAnuladasActivas([
      {
        refId: refIdChecklist("JX36971", "2026-07-01"),
        modulo: "checklist",
        motivo: "m",
        anuladoPor: "a",
        ts: "t",
      },
      {
        refId: refIdSemanal("2026-W27", "AAA111"),
        modulo: "semanal",
        motivo: "m",
        anuladoPor: "a",
        ts: "t",
      },
    ]);
    const checklists = [
      { unitUid: "JX36971", fecha: "2026-07-01" }, // anulado
      { unitUid: "JX36971", fecha: "2026-06-01" },
      { unitUid: "BBB222", fecha: "2026-07-01" },
    ];
    const vigentes = checklists.filter((c) => !anuladas.has(refIdChecklist(c.unitUid, c.fecha)));
    expect(vigentes).toHaveLength(2);
    expect(vigentes.some((c) => c.unitUid === "JX36971" && c.fecha === "2026-07-01")).toBe(false);

    const semanales = [
      { periodoId: "2026-W27", unitUid: "AAA111" }, // anulado
      { periodoId: "2026-W27", unitUid: "BBB222" },
      { periodoId: "2026-W28", unitUid: "AAA111" },
    ];
    const vigentesSw = semanales.filter((s) => !anuladas.has(refIdSemanal(s.periodoId, s.unitUid)));
    expect(vigentesSw).toHaveLength(2);
  });

  it("filas sin refId se ignoran; campos faltantes degradan a string vacío", () => {
    const m = buildAnuladasActivas([{ refId: "" }, { refId: "semanal|2026-W27|AAA111" }]);
    expect(m.size).toBe(1);
    expect(m.get("semanal|2026-W27|AAA111")).toEqual({ motivo: "", anuladoPor: "", ts: "" });
  });
});
