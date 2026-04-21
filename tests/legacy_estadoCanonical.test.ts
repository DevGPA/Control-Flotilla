import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression: el estado canónico es "En Revisión" (con acento).
// El mapEstado normalizer en el ingest (Control de flotilla.html:5270) lo
// establece así, y todas las comparaciones/writes deben usar la misma forma.
// Este test falla si alguien re-introduce "En Revision" (sin acento) en
// comparaciones/writes del HTML legado.
describe("estado canonical forms (regression)", () => {
  const HTML_PATH = resolve(__dirname, "../Control de flotilla.html");
  const html = readFileSync(HTML_PATH, "utf8");

  it("no 'En Revision' (sin acento) en comparaciones/writes", () => {
    // Excluye el comentario del normalizer que explícitamente menciona la forma sin acento.
    const lines = html.split("\n");
    const offenders: string[] = [];
    lines.forEach((line, i) => {
      // Match "En Revision" no seguido de "ó" ni "'ó"
      if (/"En Revision"/.test(line) || /'En Revision'/.test(line)) {
        offenders.push(`${i + 1}: ${line.trim()}`);
      }
    });
    expect(offenders).toEqual([]);
  });
});
