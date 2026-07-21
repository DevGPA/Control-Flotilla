import { describe, expect, it } from "vitest";
import { mapValidacion, OPS_FUENTE_DETECCION } from "../src/opsgpa/mapValidacion";

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
