import { describe, expect, it } from "vitest";
import { hydrateSignature } from "../src/api/cloudHydrate";

// Perf F1-4: la firma del snapshot decide si el auto-refresh salta TODO el rebuild+render.
// Riesgo a cubrir: un falso "igual" congelaría los datos en pantalla (la UI dejaría de
// refrescar); un falso "distinto" solo pierde la optimización. Casos: alta, baja, edición
// (updatedAt), snapshot idéntico y sensibilidad al modelo de origen.

type Row = { updatedAt?: string | null };
const r = (updatedAt?: string | null): Row => ({ updatedAt });

describe("hydrateSignature (skip-if-unchanged del auto-refresh)", () => {
  it("snapshot idéntico → misma firma (el refresh se salta)", () => {
    const a = [[r("2026-07-01T10:00:00Z"), r("2026-07-02T09:00:00Z")], [r("2026-06-30T08:00:00Z")]];
    const b = [[r("2026-07-01T10:00:00Z"), r("2026-07-02T09:00:00Z")], [r("2026-06-30T08:00:00Z")]];
    expect(hydrateSignature(a)).toBe(hydrateSignature(b));
  });

  it("ALTA (un item más) → firma distinta aunque el max updatedAt no suba", () => {
    const antes = [[r("2026-07-02T09:00:00Z")]];
    const despues = [[r("2026-07-02T09:00:00Z"), r("2026-07-01T00:00:00Z")]];
    expect(hydrateSignature(antes)).not.toBe(hydrateSignature(despues));
  });

  it("BAJA (un item menos) → firma distinta", () => {
    const antes = [[r("2026-07-01T10:00:00Z"), r("2026-07-02T09:00:00Z")]];
    const despues = [[r("2026-07-01T10:00:00Z")]];
    expect(hydrateSignature(antes)).not.toBe(hydrateSignature(despues));
  });

  it("EDICIÓN (updatedAt del más reciente sube) → firma distinta", () => {
    const antes = [[r("2026-07-01T10:00:00Z"), r("2026-07-02T09:00:00Z")]];
    const despues = [[r("2026-07-01T10:00:00Z"), r("2026-07-02T09:05:00Z")]];
    expect(hydrateSignature(antes)).not.toBe(hydrateSignature(despues));
  });

  it("EDICIÓN de un item viejo (updatedAt sube pero sigue < max) → el nuevo updatedAt ES el max en Amplify", () => {
    // En Amplify, updatedAt lo sella el backend al mutar → un item editado pasa a tener
    // el updatedAt MÁS RECIENTE del modelo. La firma lo detecta vía max().
    const antes = [[r("2026-07-01T10:00:00Z"), r("2026-07-02T09:00:00Z")]];
    const despues = [[r("2026-07-03T11:00:00Z"), r("2026-07-02T09:00:00Z")]];
    expect(hydrateSignature(antes)).not.toBe(hydrateSignature(despues));
  });

  it("el MODELO de origen importa (mover un item de un modelo a otro cambia la firma)", () => {
    const a = [[r("2026-07-01T00:00:00Z")], []];
    const b = [[], [r("2026-07-01T00:00:00Z")]];
    expect(hydrateSignature(a)).not.toBe(hydrateSignature(b));
  });

  it("updatedAt ausente/null se tolera (cuenta sola distingue)", () => {
    const a = [[r(null), r(undefined)]];
    const b = [[r(null)]];
    expect(hydrateSignature(a)).not.toBe(hydrateSignature(b));
    expect(hydrateSignature(a)).toBe(hydrateSignature([[r(undefined), r(null)]]));
  });

  it("vacío total es estable", () => {
    expect(hydrateSignature([[], []])).toBe(hydrateSignature([[], []]));
  });
});
