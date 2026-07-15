import { describe, expect, it } from "vitest";
import { evidenceKindOf } from "../src/fuel/mapEntry";

describe("evidenceKindOf: clasificación de fotos por columna", () => {
  it("clasifica las fotos de MoreApp por keyword", () => {
    expect(evidenceKindOf("fotoDelMedidorAntesDeCargar")).toBe("medidor");
    expect(evidenceKindOf("fotoOdometro")).toBe("odometro");
    expect(evidenceKindOf("fotoDelTicketDeCarga")).toBe("ticket");
    expect(evidenceKindOf("fotoBomba")).toBe("bomba");
    expect(evidenceKindOf("firma")).toBe("firma");
  });

  it("las fotos de nivel del reporte de carga de Ops (fotoAntes/Despues) son medidor", () => {
    // Confirmado con Tesorería 2026-07-15: fotoAntes/fotoDespues = nivel de combustible.
    expect(evidenceKindOf("fotoAntes")).toBe("medidor");
    expect(evidenceKindOf("fotoDespues")).toBe("medidor");
  });

  it("fotoPersona y columnas desconocidas caen en 'unidad'", () => {
    expect(evidenceKindOf("fotoPersona")).toBe("unidad");
    expect(evidenceKindOf("cualquierOtra")).toBe("unidad");
  });
});
