import { describe, expect, it } from "vitest";
import { esStatusOpsConocido } from "../src/opsgpa/mapAnulacion";

/**
 * Vocabulario REAL de Operaciones-GPA, medido contra producción el 2026-08-11 sobre los 903
 * registros que ha escrito el puente:
 *
 *   "Aprobada" 745 · "Aprobado" 126 · "Rechazada" 21 · "Pendiente" 9 · "Por corregir" 2
 *
 * `Anulado` NO aparece ni una vez — la rama de anulación nunca se ejerció contra datos
 * reales. Este predicado es la ÚNICA lista de estados conocidos: la usa el receptor para
 * avisar en CloudWatch y la tabla de combustible para marcar la fila, así no pueden
 * divergir. Un status fuera de la lista es la señal de que Ops cambió su vocabulario, que es
 * justo el escenario donde un registro sustituido se colaría como vivo y se contaría dos
 * veces.
 */
describe("esStatusOpsConocido", () => {
  it("acepta los cinco estados que Ops realmente emite hoy", () => {
    for (const s of ["Aprobada", "Aprobado", "Rechazada", "Pendiente", "Por corregir"]) {
      expect(esStatusOpsConocido(s), s).toBe(true);
    }
  });

  it("acepta 'Anulado' aunque nunca haya llegado — lo fija el brief", () => {
    expect(esStatusOpsConocido("Anulado")).toBe(true);
    expect(esStatusOpsConocido("Anulada")).toBe(true);
  });

  it("tolera caja, espacios y acentos como el resto de los predicados", () => {
    for (const s of ["  aprobada ", "APROBADO", "Por corrección", "por correccion"]) {
      expect(esStatusOpsConocido(s), s).toBe(true);
    }
  });

  it("vacío / ausente cuenta como conocido (hay eventos legítimos sin status)", () => {
    expect(esStatusOpsConocido("")).toBe(true);
    expect(esStatusOpsConocido(undefined)).toBe(true);
    expect(esStatusOpsConocido(null)).toBe(true);
  });

  // Los que dispararían la marca visible en la tabla y el aviso en CloudWatch.
  it("marca como DESCONOCIDO cualquier palabra fuera del vocabulario", () => {
    for (const s of ["Cancelado", "Sustituido", "Reemplazada", "Reasignada", "En revisión", "xyz"]) {
      expect(esStatusOpsConocido(s), s).toBe(false);
    }
  });
});
