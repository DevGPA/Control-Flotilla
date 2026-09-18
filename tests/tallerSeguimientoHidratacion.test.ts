// Las columnas que el resolver (liga) y el portal (estado del taller) escriben
// en la fila `Taller` nunca llegaban al TallerEntry: se guardaban y nadie las
// leía (hueco del Plan 1, ruling R88). Esta prueba fija el mapeo.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "..", "src", "api", "cloudHydrate.ts"), "utf8");
const tipos = readFileSync(join(__dirname, "..", "src", "taller", "types.ts"), "utf8");

const bloqueMapeo = (() => {
  const i = src.indexOf("const tallerEntries: TallerEntry[] = dedupedTaller.map(");
  expect(i).toBeGreaterThan(-1);
  const fin = src.indexOf("window.tallerEntries = tallerEntries;", i);
  expect(fin).toBeGreaterThan(i);
  return src.slice(i, fin);
})();

describe("hidratación — las columnas del proveedor llegan al TallerEntry", () => {
  it("el tipo declara los campos del proveedor, separados de los que teclea Riesgos", () => {
    for (const campo of [
      "estadoOperativo?:",
      "kmTaller?:",
      "fsalidaEstTaller?:",
      "fsalidaEstCompromiso?:",
      "ligaVersion?:",
      "ligaCreadaEn?:",
      "ligaCreadaPor?:",
      "ligaRevocadaEn?:",
      "ligaRevocadaPor?:",
    ]) {
      expect(tipos, `falta ${campo} en TallerEntry`).toContain(campo);
    }
    // `km` y `fsalidaEst` (lo que teclea Riesgos) siguen existiendo aparte.
    expect(tipos).toContain("km?: number | string;");
    expect(tipos).toContain("fsalidaEst?: string;");
  });

  it("el mapeo lee las COLUMNAS de la fila, no el blob `datos`", () => {
    for (const linea of [
      "estadoOperativo: t.estadoOperativo ?? undefined,",
      "kmTaller: numOrUndef(t.km),",
      "fsalidaEstTaller: t.fsalidaEst ?? undefined,",
      "fsalidaEstCompromiso: t.fsalidaEstCompromiso ?? undefined,",
      "ligaVersion: numOrUndef(t.ligaVersion),",
      "ligaCreadaEn: t.ligaCreadaEn ?? undefined,",
      "ligaCreadaPor: t.ligaCreadaPor ?? undefined,",
      "ligaRevocadaEn: t.ligaRevocadaEn ?? undefined,",
      "ligaRevocadaPor: t.ligaRevocadaPor ?? undefined,",
    ]) {
      expect(bloqueMapeo, `falta el mapeo: ${linea}`).toContain(linea);
    }
  });

  it("NO se suben de vuelta: el upload sigue mandando solo lo de `datos`", () => {
    const up = readFileSync(join(__dirname, "..", "src", "api", "batchUpload.ts"), "utf8");
    for (const campo of ["estadoOperativo", "fsalidaEstCompromiso", "ligaCreadaPor"]) {
      expect(up, `${campo} no debe viajar en el upload`).not.toContain(`${campo}:`);
    }
  });
});
