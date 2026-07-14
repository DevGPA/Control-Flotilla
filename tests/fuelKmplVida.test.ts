import { describe, expect, it } from "vitest";
import { computeKmplVida } from "../src/fuel/fuelAnalysis";
import type { FuelEntry } from "../src/fuel/types";

/** km/L de VIDA: referencia por unidad que ignora el estado de llenado (Σkm/Σlitros). */

let seq = 0;
function carga(km: number, litros: number | null, over: Partial<FuelEntry> = {}): FuelEntry {
  const n = ++seq;
  const fecha = `2026-05-${String((n % 27) + 1).padStart(2, "0")}`;
  return {
    loadId: `47|carga|v${n}`,
    tipo: "carga",
    eco: "47",
    eventoId: `v${n}`,
    sucursal: "Cancun",
    fecha,
    fechaHora: `${fecha} 08:00`,
    km,
    litros: litros ?? undefined,
    seLlenoTanque: "No", // la vida NO depende del llenado — ese es su punto
    photos: [],
    ...over,
  };
}

describe("computeKmplVida", () => {
  it("suma segmentos fiables y litros aunque NINGUNA carga llene el tanque", () => {
    seq = 0;
    const entries = [
      carga(10000, 30),
      carga(10300, 30),
      carga(10600, 30),
      carga(10900, 30),
      carga(11200, 30),
      carga(11500, 30),
    ];
    const v = computeKmplVida(entries).get("47")!;
    expect(v).toBeTruthy();
    expect(v.km).toBe(1500);
    expect(v.litros).toBe(150);
    expect(v.kmpl).toBe(10);
    expect(v.n).toBe(5);
  });

  it("un typo de odómetro no revienta el acumulado (se ignora su segmento)", () => {
    seq = 0;
    const entries = [
      carga(10000, 30),
      carga(10300, 30),
      carga(1682, 40), // typo: ignorado
      carga(10600, 30), // vuelve al tren: 10600-10300
      carga(10900, 30),
      carga(11200, 30),
      carga(11500, 30),
    ];
    const v = computeKmplVida(entries).get("47")!;
    expect(v.km).toBe(1500); // 5 segmentos de 300; el typo no resta ni suma
    expect(v.kmpl).toBe(1500 / 150);
  });

  it("guards: sin resultado con muestra chica (<5 cargas) o recorrido corto (<500 km)", () => {
    seq = 0;
    const pocas = [carga(10000, 30), carga(10300, 30), carga(10600, 30)];
    expect(computeKmplVida(pocas).get("47")).toBeUndefined();
    seq = 0;
    const corto = [
      carga(10000, 30),
      carga(10050, 30),
      carga(10100, 30),
      carga(10150, 30),
      carga(10200, 30),
      carga(10250, 30),
    ];
    expect(computeKmplVida(corto).get("47")).toBeUndefined();
  });

  it("montacargas quedan fuera (horómetro)", () => {
    seq = 0;
    const entries = Array.from({ length: 6 }, (_, i) =>
      carga(10000 + i * 300, 30, { esMontacargas: true }),
    );
    expect(computeKmplVida(entries).get("47")).toBeUndefined();
  });
});
