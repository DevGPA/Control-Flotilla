import { describe, expect, it } from "vitest";
import {
  esVeredictoProtegido,
  mapValidacion,
  OPS_FUENTE_DETECCION,
} from "../src/opsgpa/mapValidacion";

const CARGA = {
  tenantId: "gpa",
  economicoId: "10",
  tipo: "solicitud" as const,
  eventoId: "OPS-34354ae5d278",
  fechaHora: "2026-06-04T01:10:03.987775+00:00",
};

describe("mapValidacion: aprobación en origen → ValidacionCarga (decisión 2026-07-10)", () => {
  it("Aprobada → verdict ok, con quién y cuándo (registro real)", () => {
    const v = mapValidacion(
      { status: "Aprobada", autorizadoPor: "admin", fechaAut: "2026-06-04T01:20:00+00:00" },
      CARGA,
    );
    expect(v).toEqual({
      tenantId: "gpa",
      loadId: "10|solicitud|OPS-34354ae5d278", // formato loadIdOf de FC, reutilizado
      verdictGlobal: "ok",
      revisadoPor: "admin · ops-gpa",
      nota: "Aprobada en origen (Operaciones-GPA)",
      ts: "2026-06-04T01:20:00+00:00",
      fuenteDeteccion: OPS_FUENTE_DETECCION,
    });
  });

  it("Rechazada → verdict 'rechazada' (primera clase, decisión 2026-07-21); tolera género/variantes", () => {
    for (const s of ["Rechazada", "Rechazado", "rechazada"]) {
      const v = mapValidacion({ status: s }, CARGA);
      expect(v?.verdictGlobal).toBe("rechazada");
      expect(v?.nota).toMatch(/Rechazada en origen/);
      expect(v?.revisadoPor).toBe("ops-gpa"); // sin autorizadoPor
    }
    expect(mapValidacion({ status: "Aprobado" }, CARGA)?.verdictGlobal).toBe("ok");
  });

  it("Pendiente / vacío → null (queda pendiente hasta el cambio_estado)", () => {
    expect(mapValidacion({ status: "Pendiente" }, CARGA)).toBeNull();
    expect(mapValidacion({}, CARGA)).toBeNull();
  });

  it("sin fechaAut cae a la fechaHora de la carga", () => {
    const v = mapValidacion({ status: "Aprobada" }, CARGA);
    expect(v?.ts).toBe(CARGA.fechaHora);
  });
});

/**
 * Statuses nuevos del brief Ops 2026-07-27. Lo importante aquí es la ASIMETRÍA:
 *
 *  - "Por corregir" SÍ degrada el veredicto. Es un estado retenido: si el registro ya
 *    estaba "ok" y Ops lo devuelve para corrección, dejar el "ok" vivo lo cuenta como
 *    aprobado cuando ya no lo está.
 *  - "Anulado" NO toca el veredicto. La fila `Anulacion` ya excluye el registro de todo
 *    cálculo; degradarlo encima DESTRUIRÍA el veredicto real sin versionarlo, y al
 *    restaurar volvería como "pendiente" en vez de conservar su "Validado · Ops".
 */
describe("mapValidacion: statuses nuevos de Ops (Anulado / Por corregir)", () => {
  it("Por corregir → degrada a 'pendiente' y avisa al revisor que no lo valide a mano", () => {
    for (const s of ["Por corregir", "por corrección", "POR CORREGIR"]) {
      const v = mapValidacion({ status: s, autorizadoPor: "admin" }, CARGA);
      expect(v?.verdictGlobal, s).toBe("pendiente");
      expect(v?.fuenteDeteccion, s).toBe(OPS_FUENTE_DETECCION);
      // La nota es el ÚNICO canal que ve tesorería: si validan a mano se persiste
      // fuenteDeteccion "manual" y por la regla de no-pisado la "Aprobada" final de Ops
      // ya nunca entra.
      expect(v?.nota, s).toMatch(/no validar aqu[íi]/i);
      // Sin nombre a propósito: la celda de validación pinta la pill "Pendiente" MÁS una
      // sub-línea con `revisadoPor`, y "Juan · 25/07/26" junto a "Pendiente" se lee como
      // "Juan la validó y está pendiente". El detalle va en la nota.
      expect(v?.revisadoPor, s).toBe("ops-gpa");
    }
  });

  it("Anulado → null (la exclusión la hace la Anulacion, no el veredicto)", () => {
    for (const s of ["Anulado", "Anulada"]) {
      expect(mapValidacion({ status: s, autorizadoPor: "admin" }, CARGA), s).toBeNull();
    }
  });
});

/**
 * Regla de no-pisado extraída a función pura (Fase 1 visión IA, 2026-08-20).
 *
 * Semántica NUEVA: se protege SOLO el veredicto humano (`fuenteDeteccion === "manual"`).
 * Antes la condición era `!== "ops-gpa"`, que también protegía filas con fuente null —
 * pero la Lambda de visión puede crear la fila ANTES de que llegue el cambio_estado de
 * Ops (fuente null: la visión no escribe fuenteDeteccion), y con la regla vieja esa fila
 * bloquearía para siempre el "Aprobada → ok" del puente. La lectura IA no es un
 * veredicto: no merece protección; el humano sí, siempre.
 */
describe("esVeredictoProtegido: matriz de fuentes (no-pisado)", () => {
  it("'manual' es el ÚNICO valor protegido", () => {
    expect(esVeredictoProtegido("manual")).toBe(true);
  });

  it("ops-gpa, ia, null, undefined y vacío son pisables por el puente", () => {
    for (const fuente of [OPS_FUENTE_DETECCION, "ia", null, undefined, ""]) {
      expect(esVeredictoProtegido(fuente), String(fuente)).toBe(false);
    }
  });

  it("valores desconocidos NO se protegen (cambio deliberado vs la regla vieja `!== ops-gpa`)", () => {
    // Si algún día aparece una fuente nueva que merezca protección, debe agregarse
    // explícitamente aquí y en la función — nunca por accidente.
    expect(esVeredictoProtegido("otro-sistema")).toBe(false);
  });
});
