import { describe, expect, it } from "vitest";
import { mapCargaToFuelEntry, type CargaRow } from "../src/fuel/mapEntry";

const base: CargaRow = {
  economicoId: "45",
  tipo: "carga",
  eventoId: "OPS-abc123",
  fecha: "2026-07-20",
  sucursal: "Monterrey",
};

describe("origen del registro promovido a FuelEntry (spec 2026-07-30 §2.5)", () => {
  it("promueve datos.fuente y datos.opsStatus del puente de Ops", () => {
    const e = mapCargaToFuelEntry({
      ...base,
      datos: { fuente: "ops-gpa", opsStatus: "Pendiente" },
    });
    expect(e.fuente).toBe("ops-gpa");
    expect(e.opsStatus).toBe("Pendiente");
  });

  it("un registro de MoreApp queda sin fuente ni opsStatus (undefined, no cadena vacía)", () => {
    const e = mapCargaToFuelEntry({ ...base, datos: { producto: "MAGNA" } });
    expect(e.fuente).toBeUndefined();
    expect(e.opsStatus).toBeUndefined();
  });

  it("recorta espacios y trata la cadena vacía como ausente", () => {
    const e = mapCargaToFuelEntry({
      ...base,
      datos: { fuente: "  ops-gpa  ", opsStatus: "   " },
    });
    expect(e.fuente).toBe("ops-gpa");
    expect(e.opsStatus).toBeUndefined();
  });

  it("tolera datos ausente por completo", () => {
    const e = mapCargaToFuelEntry(base);
    expect(e.fuente).toBeUndefined();
    expect(e.opsStatus).toBeUndefined();
  });
});
