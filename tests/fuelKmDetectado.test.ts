import { describe, expect, it } from "vitest";
import { computeFuelMetrics } from "../src/fuel/fuelAnalysis";
import type { FuelEntry, FuelMetrics, FuelReview } from "../src/fuel/types";

/**
 * Caso real eco 86 (2026-07-13): odómetro capturado 1,682 en vez de ~16,8xx.
 * (1) `review.kmDetectado` (capturado de la foto en la validación) corrige el km/l
 * sin tocar el dato crudo; (2) un retroceso NO contamina el ancla de la siguiente
 * carga (typo cuesta 1 intervalo, no 2); (3) un reset real de tablero se adopta.
 */

function carga(
  eventoId: string,
  fecha: string,
  km: number,
  litros: number,
  over: Partial<FuelEntry> = {},
): FuelEntry {
  return {
    loadId: `86|carga|${eventoId}`,
    tipo: "carga",
    eco: "86",
    eventoId,
    sucursal: "Ciudad de Mexico",
    fecha,
    fechaHora: `${fecha} 08:00`,
    km,
    litros,
    monto: litros * 26,
    seLlenoTanque: "Si",
    photos: [],
    ...over,
  };
}

function reviewKm(kmDetectado: number): FuelReview {
  return { verdictGlobal: "pendiente", porEvidencia: {}, kmDetectado, fuenteDeteccion: "manual" };
}

function byEvento(ms: FuelMetrics[]): Map<string, FuelMetrics> {
  return new Map(ms.map((m) => [m.loadId.split("|")[2]!, m]));
}

describe("kmDetectado corrige el km/l (odómetro efectivo)", () => {
  const ms = byEvento(
    computeFuelMetrics([
      carga("c1", "2026-07-01", 10000, 30),
      carga("c2", "2026-07-05", 10300, 30),
      // Typo del chofer (1,682) CORREGIDO por validación con la foto: 10,600.
      carga("c3", "2026-07-09", 1682, 30, { review: reviewKm(10600) }),
      carga("c4", "2026-07-13", 10900, 30),
    ]),
  );

  it("la carga corregida recupera su km/l (300 km / 30 L = 10)", () => {
    expect(ms.get("c3")!.kmPorLitro).toBe(10);
    expect(ms.get("c3")!.motivoSinKmpl).toBeUndefined();
    expect(ms.get("c3")!.kmDesdeAnterior).toBe(300);
  });

  it("la SIGUIENTE carga ancla en el odómetro corregido (10,900 − 10,600)", () => {
    expect(ms.get("c4")!.kmPorLitro).toBe(10);
    expect(ms.get("c4")!.motivoSinKmpl).toBeUndefined();
  });

  it("el dato crudo no se toca: metrics.km sigue reportando el capturado", () => {
    expect(ms.get("c3")!.km).toBe(1682);
  });
});

describe("ancla resistente: retroceso sin corregir cuesta 1 intervalo, no 2", () => {
  const ms = byEvento(
    computeFuelMetrics([
      carga("c1", "2026-07-01", 10000, 30),
      carga("c2", "2026-07-05", 10300, 30),
      carga("c3", "2026-07-09", 1682, 40), // typo SIN corregir
      carga("c4", "2026-07-13", 10900, 30),
      carga("c5", "2026-07-17", 2000, 30), // otro typo posterior
    ]),
  );

  it("el registro malo queda en retroceso con su chip (delta negativo)", () => {
    expect(ms.get("c3")!.kmPorLitro).toBeNull();
    expect(ms.get("c3")!.motivoSinKmpl).toBe("odometro_retroceso");
    expect(ms.get("c3")!.kmDesdeAnterior).toBe(1682 - 10300);
  });

  it("la siguiente carga mide contra la última ancla FIABLE (10,900 − 10,300 = 600)", () => {
    expect(ms.get("c4")!.kmPorLitro).toBe(20);
    expect(ms.get("c4")!.motivoSinKmpl).toBeUndefined();
  });

  it("la lectura pendiente se limpia tras un intervalo plausible (c5 no 'revive' contra 1,682)", () => {
    // 2000-1682=318 sería plausible contra la pendiente vieja; si no se limpió, saldría km/l falso.
    expect(ms.get("c5")!.kmPorLitro).toBeNull();
    expect(ms.get("c5")!.motivoSinKmpl).toBe("odometro_retroceso");
  });
});

describe("reset real de tablero: dos lecturas coherentes adoptan el tren nuevo", () => {
  const ms = byEvento(
    computeFuelMetrics([
      carga("r1", "2026-07-01", 250000, 30),
      carga("r2", "2026-07-05", 250300, 30),
      carga("r3", "2026-07-09", 120, 40), // tablero nuevo: retroceso (se pierde 1 intervalo)
      carga("r4", "2026-07-13", 460, 34), // coherente con la pendiente → km/l = 340/34
      carga("r5", "2026-07-17", 800, 34), // el tren nuevo ya es ancla → 340/34
    ]),
  );

  it("el primer registro del reset queda en retroceso (intervalo perdido, correcto)", () => {
    expect(ms.get("r3")!.kmPorLitro).toBeNull();
    expect(ms.get("r3")!.motivoSinKmpl).toBe("odometro_retroceso");
  });

  it("la segunda lectura coherente mide contra la pendiente y adopta el tren", () => {
    expect(ms.get("r4")!.kmPorLitro).toBe(10);
    expect(ms.get("r4")!.motivoSinKmpl).toBeUndefined();
    expect(ms.get("r5")!.kmPorLitro).toBe(10);
  });
});
