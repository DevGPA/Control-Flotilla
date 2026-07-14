import { describe, expect, it } from "vitest";
import { computeFuelMetrics } from "../src/fuel/fuelAnalysis";
import type { FuelEntry, FuelMetrics } from "../src/fuel/types";

/**
 * Motor de VENTANAS entre tanques llenos: entre un lleno en km A y el siguiente lleno
 * en km B, TODOS los litros cargados en medio (parciales incluidos) = consumo exacto
 * de la distancia B−A. Diseño validado con datos reales de la unidad 47 (47% de sus
 * cargas son parciales; el motor por-intervalo perdía 39/51 rendimientos).
 */

let seq = 0;
function carga(
  fecha: string,
  km: number | null,
  litros: number | null,
  lleno: "Si" | "No",
  over: Partial<FuelEntry> = {},
): FuelEntry {
  const id = `c${++seq}`;
  return {
    loadId: `47|carga|${id}`,
    tipo: "carga",
    eco: "47",
    eventoId: id,
    sucursal: "Cancun",
    fecha,
    fechaHora: `${fecha} 08:00`,
    km: km ?? undefined,
    litros: litros ?? undefined,
    monto: litros != null ? litros * 26 : undefined,
    seLlenoTanque: lleno,
    tanque: "58",
    photos: [],
    ...over,
  };
}

function metricsDe(entries: FuelEntry[]): FuelMetrics[] {
  return computeFuelMetrics(entries);
}

function porEvento(ms: FuelMetrics[]): Map<string, FuelMetrics> {
  return new Map(ms.map((m) => [m.loadId.split("|")[2]!, m]));
}

describe("ventana simple lleno→lleno (equivale al intervalo clásico)", () => {
  const c1 = carga("2026-07-01", 10000, 30, "Si");
  const c2 = carga("2026-07-05", 10300, 30, "Si");
  const ms = porEvento(metricsDe([c1, c2]));

  it("el cierre mide 300 km / 30 L = 10, con metadatos de ventana", () => {
    const m = ms.get(c2.eventoId)!;
    expect(m.kmPorLitro).toBe(10);
    expect(m.ventanaKmDesde).toBe(300);
    expect(m.ventanaDesdeKm).toBe(10000);
    expect(m.ventanaCargas).toBe(1);
    expect(m.ventanaInferida).toBeFalsy();
    expect(m.litrosFill).toBe(30);
    expect(m.llenoEfectivo).toBe(true);
    expect(m.motivoSinKmpl).toBeUndefined();
  });

  it("la primera carga abre ventana sin medir (primera_carga)", () => {
    const m = ms.get(c1.eventoId)!;
    expect(m.kmPorLitro).toBeNull();
    expect(m.motivoSinKmpl).toBe("primera_carga");
  });
});

describe("cargas parciales dentro de la ventana", () => {
  it("1 parcial en medio: sus litros suman al cierre (530 km / 53 L = 10)", () => {
    const a = carga("2026-07-01", 10000, 30, "Si");
    const p = carga("2026-07-03", 10150, 20, "No");
    const b = carga("2026-07-06", 10530, 33, "Si");
    const ms = porEvento(metricsDe([a, p, b]));
    expect(ms.get(p.eventoId)!.kmPorLitro).toBeNull();
    expect(ms.get(p.eventoId)!.motivoSinKmpl).toBe("parcial_en_ventana");
    expect(ms.get(p.eventoId)!.llenoEfectivo).toBe(false);
    const cierre = ms.get(b.eventoId)!;
    expect(cierre.kmPorLitro).toBe(10);
    expect(cierre.ventanaCargas).toBe(2);
    expect(cierre.litrosFill).toBe(53);
  });

  it("racha de parciales (caso 47): una sola lectura sólida al cerrar", () => {
    const a = carga("2026-07-01", 10000, 30, "Si");
    const p1 = carga("2026-07-03", 10200, 30, "No");
    const p2 = carga("2026-07-05", 10400, 30, "No");
    const p3 = carga("2026-07-07", 10600, 30, "No");
    const b = carga("2026-07-09", 10900, 30, "Si");
    const ms = porEvento(metricsDe([a, p1, p2, p3, b]));
    for (const p of [p1, p2, p3])
      expect(ms.get(p.eventoId)!.motivoSinKmpl).toBe("parcial_en_ventana");
    const cierre = ms.get(b.eventoId)!;
    expect(cierre.kmPorLitro).toBe(900 / 120);
    expect(cierre.ventanaCargas).toBe(4);
    expect(cierre.ventanaKmDesde).toBe(900);
  });

  it("racha SIN cierre: los parciales quedan sumando a la ventana abierta", () => {
    const a = carga("2026-07-01", 10000, 30, "Si");
    const p1 = carga("2026-07-03", 10200, 30, "No");
    const p2 = carga("2026-07-05", 10400, 30, "No");
    const ms = porEvento(metricsDe([a, p1, p2]));
    expect(ms.get(p1.eventoId)!.motivoSinKmpl).toBe("parcial_en_ventana");
    expect(ms.get(p2.eventoId)!.motivoSinKmpl).toBe("parcial_en_ventana");
    expect([...ms.values()].every((m) => m.kmPorLitro == null)).toBe(true);
  });

  it("unidad 100% parcial: sin lleno previo, nada que medir", () => {
    const p1 = carga("2026-07-01", 10000, 20, "No");
    const p2 = carga("2026-07-03", 10200, 20, "No");
    const p3 = carga("2026-07-05", 10400, 20, "No");
    const ms = porEvento(metricsDe([p1, p2, p3]));
    expect(ms.get(p1.eventoId)!.motivoSinKmpl).toBe("primera_carga");
    expect(ms.get(p2.eventoId)!.motivoSinKmpl).toBe("sin_lleno_previo");
    expect(ms.get(p3.eventoId)!.motivoSinKmpl).toBe("sin_lleno_previo");
  });
});

describe("lleno INFERIDO (litros ≥ 95% del tanque marcado 'No')", () => {
  it("cierra la ventana y queda señalado ventanaInferida", () => {
    const a = carga("2026-07-01", 10000, 30, "Si");
    const b = carga("2026-07-05", 10500, 56, "No"); // 56 ≥ 0.95·58=55.1 → lleno inferido
    const ms = porEvento(metricsDe([a, b]));
    const cierre = ms.get(b.eventoId)!;
    expect(cierre.kmPorLitro).toBeCloseTo(500 / 56, 5);
    expect(cierre.ventanaInferida).toBe(true);
    expect(cierre.llenoEfectivo).toBe(true);
  });

  it("sin capacidad de tanque NO se infiere (queda parcial)", () => {
    const a = carga("2026-07-01", 10000, 30, "Si", { tanque: undefined });
    const b = carga("2026-07-05", 10500, 56, "No", { tanque: undefined });
    const ms = porEvento(metricsDe([a, b]));
    expect(ms.get(b.eventoId)!.kmPorLitro).toBeNull();
    expect(ms.get(b.eventoId)!.motivoSinKmpl).toBe("parcial_en_ventana");
    expect(ms.get(b.eventoId)!.llenoEfectivo).toBe(false);
  });
});

describe("robustez de la ventana (conservación de combustible)", () => {
  it("retroceso-typo intermedio NO rompe: sus litros cuentan y conserva su chip", () => {
    const a = carga("2026-07-01", 10000, 30, "Si");
    const t = carga("2026-07-03", 1682, 40, "No"); // typo del chofer
    const b = carga("2026-07-06", 10600, 30, "Si");
    const ms = porEvento(metricsDe([a, t, b]));
    expect(ms.get(t.eventoId)!.motivoSinKmpl).toBe("odometro_retroceso"); // chip accionable vivo
    const cierre = ms.get(b.eventoId)!;
    expect(cierre.kmPorLitro).toBeCloseTo(600 / 70, 5);
    expect(cierre.ventanaCargas).toBe(2);
    expect(cierre.kmDesdeAnterior).toBe(600); // segmento vs ancla resistente intacto
  });

  it("reset REAL de tablero rompe la ventana y reabre en la lectura pendiente llena", () => {
    const a = carga("2026-07-01", 250000, 30, "Si");
    const r = carga("2026-07-05", 120, 40, "Si"); // tablero nuevo (lleno)
    const s = carga("2026-07-09", 460, 34, "Si");
    const ms = porEvento(metricsDe([a, r, s]));
    expect(ms.get(r.eventoId)!.motivoSinKmpl).toBe("odometro_retroceso");
    const cierre = ms.get(s.eventoId)!;
    expect(cierre.kmPorLitro).toBe(10); // 340/34, medido contra la pendiente adoptada
    expect(cierre.ventanaDesdeKm).toBe(120);
    expect(cierre.ventanaCargas).toBe(1);
  });

  it("reset con lectura pendiente PARCIAL: no hay ventana hasta el siguiente lleno", () => {
    const a = carga("2026-07-01", 250000, 30, "Si");
    const r = carga("2026-07-05", 120, 15, "No"); // tablero nuevo, carga parcial
    const s = carga("2026-07-09", 460, 34, "Si");
    const ms = porEvento(metricsDe([a, r, s]));
    expect(ms.get(s.eventoId)!.kmPorLitro).toBeNull();
    expect(ms.get(s.eventoId)!.motivoSinKmpl).toBe("sin_lleno_previo");
  });

  it("salto improbable rompe la ventana: el cierre queda ventana_rota y reabre limpio", () => {
    const a = carga("2026-07-01", 10000, 30, "Si");
    const x = carga("2026-07-05", 12500, 20, "No"); // +2500 km > MAX_KM_JUMP
    const b = carga("2026-07-08", 12800, 30, "Si");
    const c = carga("2026-07-12", 13100, 30, "Si");
    const ms = porEvento(metricsDe([a, x, b, c]));
    expect(ms.get(x.eventoId)!.motivoSinKmpl).toBe("salto_improbable");
    expect(ms.get(b.eventoId)!.kmPorLitro).toBeNull();
    expect(ms.get(b.eventoId)!.motivoSinKmpl).toBe("ventana_rota");
    expect(ms.get(c.eventoId)!.kmPorLitro).toBe(10); // ventana B→C sana
  });

  it("carga sin litros rompe la ventana (combustible desconocido)", () => {
    const a = carga("2026-07-01", 10000, 30, "Si");
    const m0 = carga("2026-07-03", 10200, null, "No");
    const b = carga("2026-07-06", 10500, 30, "Si");
    const c = carga("2026-07-10", 10800, 30, "Si");
    const ms = porEvento(metricsDe([a, m0, b, c]));
    expect(ms.get(m0.eventoId)!.motivoSinKmpl).toBe("sin_litros");
    expect(ms.get(b.eventoId)!.motivoSinKmpl).toBe("ventana_rota");
    expect(ms.get(c.eventoId)!.kmPorLitro).toBe(10);
  });
});

describe("interacciones con la maquinaria existente", () => {
  it("llenado partido mixto Si/No cierra la ventana con la suma del grupo", () => {
    const a = carga("2026-07-01", 10000, 30, "Si");
    const g1 = carga("2026-07-05", 10300, 20, "No");
    const g2 = carga("2026-07-05", 10300, 15, "Si"); // mismo odómetro → grupo
    const ms = porEvento(metricsDe([a, g1, g2]));
    const rep = ms.get(g1.eventoId)!; // la de más litros es la representativa
    expect(rep.kmPorLitro).toBeCloseTo(300 / 35, 5);
    expect(rep.litrosFill).toBe(35);
    expect(ms.get(g2.eventoId)!.motivoSinKmpl).toBe("llenado_partido");
  });

  it("kmDetectado (corrección por foto) corrige el extremo de cierre", () => {
    const a = carga("2026-07-01", 10000, 30, "Si");
    const b = carga("2026-07-05", 1682, 30, "Si", {
      review: {
        verdictGlobal: "pendiente",
        porEvidencia: {},
        kmDetectado: 10600,
        fuenteDeteccion: "manual",
      },
    });
    const ms = porEvento(metricsDe([a, b]));
    expect(ms.get(b.eventoId)!.kmPorLitro).toBe(20); // 600/30 con el odómetro corregido
    expect(ms.get(b.eventoId)!.ventanaDesdeKm).toBe(10000);
  });

  it("ventana legítima > MAX_KM_JUMP total (segmentos plausibles) SÍ mide", () => {
    const a = carga("2026-07-01", 10000, 30, "Si");
    const p1 = carga("2026-07-03", 10600, 30, "No");
    const p2 = carga("2026-07-05", 11200, 30, "No");
    const p3 = carga("2026-07-07", 11800, 30, "No");
    const b = carga("2026-07-09", 12400, 30, "Si");
    const ms = porEvento(metricsDe([a, p1, p2, p3, b]));
    const cierre = ms.get(b.eventoId)!;
    expect(cierre.ventanaKmDesde).toBe(2400); // > 1800 total, pero legítima
    expect(cierre.kmPorLitro).toBe(2400 / 120);
  });

  it("piso físico aplica al km/l de ventana (kmpl_implausible)", () => {
    const a = carga("2026-07-01", 10000, 30, "Si");
    const b = carga("2026-07-05", 10030, 30, "Si"); // 30/30 = 1.0 < 1.5
    const ms = porEvento(metricsDe([a, b]));
    expect(ms.get(b.eventoId)!.kmPorLitro).toBeNull();
    expect(ms.get(b.eventoId)!.motivoSinKmpl).toBe("kmpl_implausible");
  });

  it("montacargas: sin ventanas ni km/l", () => {
    const a = carga("2026-07-01", 100, 10, "Si", { esMontacargas: true });
    const b = carga("2026-07-05", 130, 10, "Si", { esMontacargas: true });
    const ms = porEvento(metricsDe([a, b]));
    expect(ms.get(b.eventoId)!.kmPorLitro).toBeNull();
    expect(ms.get(b.eventoId)!.motivoSinKmpl).toBe("montacargas");
    expect(ms.get(b.eventoId)!.ventanaKmDesde).toBeUndefined();
  });

  it("PASO 2A (odómetro no fiable) pisa el km/l y limpia los campos de ventana", () => {
    const cargas = [0, 1, 0, 1, 0, 1].map((km, i) =>
      carga(`2026-07-${String(i + 1).padStart(2, "0")}`, km, 30, "Si"),
    );
    const ms = metricsDe(cargas);
    for (const m of ms) {
      expect(m.kmPorLitro).toBeNull();
      expect(m.motivoSinKmpl).toBe("odometro_no_fiable");
      expect(m.ventanaKmDesde).toBeUndefined();
    }
  });
});
