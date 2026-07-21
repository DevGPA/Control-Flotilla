import { describe, expect, it } from "vitest";
import { mapCargaToFuelEntry, type CargaRow, type ValidacionRow } from "../src/fuel/mapEntry";

const ROW = {
  economicoId: "45",
  eventoId: "OPS-abc123",
  tipo: "carga",
  fecha: "2026-07-20",
  sucursal: "Monterrey",
} as CargaRow;

function val(over: Partial<ValidacionRow> = {}): ValidacionRow {
  return {
    loadId: "45|carga|OPS-abc123",
    verdictGlobal: "rechazada",
    revisadoPor: "ops-gpa",
    nota: "Rechazada en origen (Operaciones-GPA)",
    fuenteDeteccion: "ops-gpa",
    ...over,
  };
}

describe("hidratación de rechazadas (spec 2026-07-21)", () => {
  it("verdictGlobal 'rechazada' sobrevive la hidratación", () => {
    const e = mapCargaToFuelEntry(ROW, val());
    expect(e.review?.verdictGlobal).toBe("rechazada");
  });

  it("fuenteDeteccion 'ops-gpa' ya NO se aplana a 'manual'", () => {
    const e = mapCargaToFuelEntry(ROW, val());
    expect(e.review?.fuenteDeteccion).toBe("ops-gpa");
  });

  it("valores desconocidos siguen degradando: verdict → 'pendiente', fuente rara → 'manual'", () => {
    const e = mapCargaToFuelEntry(ROW, val({ verdictGlobal: "zzz", fuenteDeteccion: "zzz" }));
    expect(e.review?.verdictGlobal).toBe("pendiente");
    expect(e.review?.fuenteDeteccion).toBe("manual");
  });

  it("'ia' y vacío no cambian de comportamiento", () => {
    expect(mapCargaToFuelEntry(ROW, val({ fuenteDeteccion: "ia" })).review?.fuenteDeteccion).toBe(
      "ia",
    );
    expect(
      mapCargaToFuelEntry(ROW, val({ fuenteDeteccion: null })).review?.fuenteDeteccion,
    ).toBeUndefined();
  });
});
