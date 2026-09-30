// R4 (revisión de T5): las reglas de la liga viven en un módulo HOJA para que batchUpload
// pueda usarlas sin el ciclo batchUpload → seguimiento → tallerPartidas → batchUpload.
// Esta prueba es estructural a propósito: un import nuevo hacia ../api/ en liga.ts o un
// import de seguimiento en batchUpload reabrirían el ciclo sin que ninguna prueba de
// comportamiento lo note (los ciclos ESM fallan tarde y lejos).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("src/taller/liga.ts es un módulo hoja", () => {
  const liga = readFileSync("src/taller/liga.ts", "utf8");
  const batchUpload = readFileSync("src/api/batchUpload.ts", "utf8");
  const seguimiento = readFileSync("src/taller/seguimiento.ts", "utf8");

  it("liga.ts no importa nada de ../api/ ni de módulos con lógica", () => {
    const imports = liga.match(/^import .* from "(.+)";$/gm) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const linea of imports) {
      expect(linea, linea).not.toContain("../api/");
      expect(linea, linea).toMatch(/^import type /);
    }
  });

  it("batchUpload importa revocacionPorCierre de ../taller/liga, no de seguimiento", () => {
    expect(batchUpload).toContain('from "../taller/liga"');
    expect(batchUpload).not.toContain('from "../taller/seguimiento"');
  });

  it("seguimiento re-exporta la superficie de antes (quien importaba de ahí no cambia)", () => {
    expect(seguimiento).toMatch(/export \{[^}]*VIGENCIA_LIGA_DIAS[^}]*\} from "\.\/liga"/);
    expect(seguimiento).toMatch(/export \{[^}]*estadoLiga[^}]*\} from "\.\/liga"/);
    expect(seguimiento).toMatch(/export \{[^}]*revocacionPorCierre[^}]*\} from "\.\/liga"/);
  });
});
