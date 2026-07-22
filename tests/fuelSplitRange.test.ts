import { describe, expect, it } from "vitest";
import { splitFuelRange } from "../src/api/cloudHydrate";

// Perf boot 2026-07-14: la ventana de combustible se descargaba en páginas
// SECUENCIALES (nextToken). splitFuelRange parte [from, to] en sub-rangos
// mensuales SIN huecos ni traslapes (between es inclusivo en ambos extremos)
// para poder pedirlos en paralelo. El último sub-rango conserva el tope
// original (p.ej. 9999-12-31: cargas con fecha futura por error de captura).

describe("splitFuelRange", () => {
  it("parte 3 meses en sub-rangos contiguos sin traslape y conserva el tope", () => {
    const parts = splitFuelRange("2026-04-13", "9999-12-31", "2026-07-13");
    expect(parts.length).toBeGreaterThanOrEqual(3);
    // cobertura: inicia en from y termina en toISO
    expect(parts[0]![0]).toBe("2026-04-13");
    expect(parts[parts.length - 1]![1]).toBe("9999-12-31");
    // sin huecos ni traslapes: el from de cada tramo = día siguiente del to anterior
    for (let i = 1; i < parts.length; i++) {
      const prevTo = new Date(parts[i - 1]![1] + "T12:00:00Z").getTime();
      const curFrom = new Date(parts[i]![0] + "T12:00:00Z").getTime();
      expect(curFrom - prevTo).toBe(86_400_000);
    }
  });

  it("rango corto (≤1 mes) queda en un solo tramo", () => {
    const parts = splitFuelRange("2026-07-01", "9999-12-31", "2026-07-13");
    expect(parts).toEqual([["2026-07-01", "9999-12-31"]]);
  });

  it("from posterior a hoy → un solo tramo con el tope original", () => {
    const parts = splitFuelRange("2027-01-01", "9999-12-31", "2026-07-13");
    expect(parts).toEqual([["2027-01-01", "9999-12-31"]]);
  });

  it("tope acotado real (ensureFuelWindow): el último tramo termina exactamente en to", () => {
    const parts = splitFuelRange("2026-01-01", "2026-04-12", "2026-07-13");
    expect(parts[parts.length - 1]![1]).toBe("2026-04-12");
    expect(parts[0]![0]).toBe("2026-01-01");
    for (let i = 1; i < parts.length; i++) {
      const prevTo = new Date(parts[i - 1]![1] + "T12:00:00Z").getTime();
      const curFrom = new Date(parts[i]![0] + "T12:00:00Z").getTime();
      expect(curFrom - prevTo).toBe(86_400_000);
    }
  });
});
