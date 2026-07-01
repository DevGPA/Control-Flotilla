import { describe, expect, it } from "vitest";
import {
  computeFuelMetrics,
  buildFleetBaseline,
  detectFuelAnomalies,
  worstRisk,
  computeRecorridos,
  DEFAULT_FUEL_THRESHOLDS,
} from "../src/fuel/fuelAnalysis";
import type { FuelEntry } from "../src/fuel/types";
import { classByTankAndFuel } from "../src/fuel/mapEntry";

function carga(
  eco: string,
  fecha: string,
  km: number,
  litros: number,
  monto?: number,
  extra: Partial<FuelEntry> = {},
): FuelEntry {
  return {
    loadId: `${eco}|carga|${fecha}`,
    tipo: "carga",
    eco,
    eventoId: fecha,
    sucursal: "Guadalajara",
    fecha,
    fechaHora: `${fecha} 08:00`,
    km,
    litros,
    monto,
    seLlenoTanque: "Si", // por defecto tanque lleno (evento fiel); los tests de parcial lo pisan
    photos: [],
    ...extra,
  };
}

describe("computeFuelMetrics", () => {
  it("km/l = km entre cargas / litros; ordena por fecha; primera carga sin km/l", () => {
    const entries = [
      carga("U1", "2026-01-11", 1500, 50, 1350),
      carga("U1", "2026-01-01", 1000, 50),
    ];
    const m = computeFuelMetrics(entries);
    expect(m).toHaveLength(2);
    const [first, second] = m;
    expect(first!.kmPorLitro).toBeNull(); // primera carga
    expect(second!.kmDesdeAnterior).toBe(500);
    expect(second!.kmPorLitro).toBe(10);
    expect(second!.diasDesdeAnterior).toBe(10);
    expect(second!.precioPorLitro).toBe(27); // 1350/50
  });

  it("ignora solicitudes (sin litros reales)", () => {
    const entries: FuelEntry[] = [
      carga("U1", "2026-01-01", 1000, 50),
      {
        loadId: "U1|solicitud|x",
        tipo: "solicitud",
        eco: "U1",
        eventoId: "x",
        sucursal: "Guadalajara",
        fecha: "2026-01-02",
        photos: [],
      },
    ];
    expect(computeFuelMetrics(entries)).toHaveLength(1);
  });

  it("odómetro que retrocede → km/l null y kmDesdeAnterior negativo", () => {
    const m = computeFuelMetrics([
      carga("U1", "2026-01-01", 1000, 50),
      carga("U1", "2026-01-05", 900, 50),
    ]);
    expect(m[1]!.kmDesdeAnterior).toBe(-100);
    expect(m[1]!.kmPorLitro).toBeNull();
  });
});

describe("computeFuelMetrics — exclusiones que protegen el ranking", () => {
  it("salto de odómetro improbable (> MAX_KM_JUMP) → km/l null pero alerta viva", () => {
    const m = computeFuelMetrics([
      carga("U1", "2026-01-01", 1000, 50),
      carga("U1", "2026-01-20", 10500, 50), // salto 9500 km > 8000
    ]);
    expect(m[1]!.kmDesdeAnterior).toBe(9500);
    expect(m[1]!.kmPorLitro).toBeNull(); // excluido de baseline/ranking (no infla)
    // la alerta km-salto sigue disparando (usa kmDesdeAnterior, no kmPorLitro)
    const f = detectFuelAnomalies(m, buildFleetBaseline(m, []));
    expect(f.some((x) => x.key.startsWith("Fuel:km-salto:"))).toBe(true);
  });

  it("si la carga ANTERIOR es montacargas, no computa km/l (guard sobre prev)", () => {
    const m = computeFuelMetrics([
      carga("U1", "2026-01-01", 100, 50, undefined, { esMontacargas: true }),
      carga("U1", "2026-01-10", 600, 50),
    ]);
    expect(m[1]!.kmPorLitro).toBeNull();
  });

  it("dos cargas el mismo día sin hora → orden por odómetro, sin falso retroceso", () => {
    const hi = carga("U1", "2026-01-01", 1500, 50, undefined, {
      fechaHora: "2026-01-01",
      loadId: "U1|carga|hi",
    });
    const lo = carga("U1", "2026-01-01", 1000, 50, undefined, {
      fechaHora: "2026-01-01",
      loadId: "U1|carga|lo",
    });
    const m = computeFuelMetrics([hi, lo]); // entra desordenada (mayor km primero)
    expect(m[0]!.km).toBe(1000); // se reordena por km asc
    expect(m[1]!.km).toBe(1500);
    expect(m[1]!.kmDesdeAnterior).toBe(500); // +500, no -500
    expect(m[1]!.kmPorLitro).toBe(10);
  });
});

describe("computeFuelMetrics — llenado partido (mismo odómetro)", () => {
  // Caso real unidad 66: un tanque se registró como 2 cargas con el MISMO km (98796):
  // 6.3 L y 25 L. Antes la distancia (365 km) se dividía entre una sola transacción → km/l
  // absurdo (365/6.3 ≈ 58). Debe consolidarse: 365 ÷ (25+6.3) ≈ 11.66, en UNA fila.
  const split = () => [
    carga("66", "2026-06-12", 98431, 40, 1000), // llenado anterior (ancla de distancia)
    carga("66", "2026-06-26", 98796, 6.3, 150, { loadId: "66|carga|A", eventoId: "A" }),
    carga("66", "2026-06-26", 98796, 25, 600, { loadId: "66|carga|B", eventoId: "B" }),
  ];

  it("km/l = distancia ÷ Σ litros del llenado, en la fila de MÁS litros", () => {
    const m = computeFuelMetrics(split());
    const big = m.find((x) => x.loadId === "66|carga|B")!; // 25 L = representativa
    const small = m.find((x) => x.loadId === "66|carga|A")!; // 6.3 L
    expect(big.kmDesdeAnterior).toBe(365);
    expect(big.litrosFill).toBeCloseTo(31.3, 5);
    expect(big.kmPorLitro!).toBeCloseTo(365 / 31.3, 4); // ≈ 11.66 (NO 365/25 ni 365/6.3)
    // La otra transacción del mismo llenado: sin km/l y 0 km recorridos.
    expect(small.kmPorLitro).toBeNull();
    expect(small.kmDesdeAnterior).toBe(0);
  });

  it("el baseline pondera el llenado partido UNA sola vez (no se infla)", () => {
    const entries = split();
    const base = buildFleetBaseline(computeFuelMetrics(entries), entries);
    expect(base.porUnidad.get("66")!.kmplVol!).toBeCloseTo(365 / 31.3, 2); // ≈ 11.66
  });
});

describe("computeFuelMetrics — motivoSinKmpl (por qué no hay km/l)", () => {
  it("primera carga de la unidad → 'primera_carga'; la 2ª con km/l no lleva motivo", () => {
    const m = computeFuelMetrics([
      carga("U1", "2026-01-01", 1000, 50),
      carga("U1", "2026-01-11", 1500, 50),
    ]);
    expect(m[0]!.kmPorLitro).toBeNull();
    expect(m[0]!.motivoSinKmpl).toBe("primera_carga");
    expect(m[1]!.kmPorLitro).toBe(10);
    expect(m[1]!.motivoSinKmpl).toBeUndefined();
  });

  it("odómetro que retrocede → 'odometro_retroceso'", () => {
    const m = computeFuelMetrics([
      carga("U1", "2026-01-01", 1000, 50),
      carga("U1", "2026-01-05", 900, 50),
    ]);
    expect(m[1]!.motivoSinKmpl).toBe("odometro_retroceso");
  });

  it("salto improbable (> MAX_KM_JUMP) → 'salto_improbable'", () => {
    const m = computeFuelMetrics([
      carga("U1", "2026-01-01", 1000, 50),
      carga("U1", "2026-01-20", 10500, 50),
    ]);
    expect(m[1]!.motivoSinKmpl).toBe("salto_improbable");
  });

  it("montacargas → 'montacargas'", () => {
    const m = computeFuelMetrics([
      carga("U1", "2026-01-01", 100, 50, undefined, { esMontacargas: true }),
      carga("U1", "2026-01-10", 600, 50, undefined, { esMontacargas: true }),
    ]);
    expect(m[1]!.motivoSinKmpl).toBe("montacargas");
  });

  it("sin litros → 'sin_litros'", () => {
    const m = computeFuelMetrics([
      carga("U1", "2026-01-01", 1000, 50),
      carga("U1", "2026-01-10", 1500, 0),
    ]);
    expect(m[1]!.kmPorLitro).toBeNull();
    expect(m[1]!.motivoSinKmpl).toBe("sin_litros");
  });

  it("sin odómetro → 'sin_odometro'", () => {
    const m = computeFuelMetrics([
      carga("U1", "2026-01-01", 1000, 50),
      carga("U1", "2026-01-10", 0, 50, undefined, { km: undefined }),
    ]);
    const segunda = m.find((x) => x.loadId === "U1|carga|2026-01-10")!;
    expect(segunda.motivoSinKmpl).toBe("sin_odometro");
  });

  it("llenado partido: la fila secundaria → 'llenado_partido' (su km/l vive en la principal)", () => {
    const m = computeFuelMetrics([
      carga("66", "2026-06-12", 98431, 40, 1000),
      carga("66", "2026-06-26", 98796, 6.3, 150, { loadId: "66|carga|A", eventoId: "A" }),
      carga("66", "2026-06-26", 98796, 25, 600, { loadId: "66|carga|B", eventoId: "B" }),
    ]);
    const small = m.find((x) => x.loadId === "66|carga|A")!;
    const big = m.find((x) => x.loadId === "66|carga|B")!;
    expect(small.kmPorLitro).toBeNull();
    expect(small.motivoSinKmpl).toBe("llenado_partido");
    expect(big.kmPorLitro).not.toBeNull();
    expect(big.motivoSinKmpl).toBeUndefined();
  });
});

describe("computeFuelMetrics — piso físico y fidelidad (compuerta km/l)", () => {
  it("km/l por debajo del piso físico (1.5) → null + motivo 'kmpl_implausible'", () => {
    const m = computeFuelMetrics([
      carga("U1", "2026-01-01", 1000, 50),
      carga("U1", "2026-01-05", 1050, 50), // 50 km / 50 L = 1.0 km/l (implausible)
    ]);
    expect(m[1]!.kmPorLitro).toBeNull();
    expect(m[1]!.motivoSinKmpl).toBe("kmpl_implausible");
  });

  it("km/l por encima del techo físico (40) → null + 'kmpl_implausible'", () => {
    const m = computeFuelMetrics([
      carga("U1", "2026-01-01", 1000, 30),
      carga("U1", "2026-01-05", 2600, 30), // 1600 km (<1800) / 30 L = 53.3 km/l (implausible)
    ]);
    expect(m[1]!.kmPorLitro).toBeNull();
    expect(m[1]!.motivoSinKmpl).toBe("kmpl_implausible");
  });

  it("km/l plausible con tanque lleno en ambos extremos → fiel (cargaParcial falsy)", () => {
    const m = computeFuelMetrics([
      carga("U1", "2026-01-01", 1000, 50),
      carga("U1", "2026-01-11", 1500, 50), // 10 km/l
    ]);
    expect(m[1]!.kmPorLitro).toBe(10);
    expect(m[1]!.cargaParcial).toBeFalsy();
  });

  it("carga actual con tanque NO lleno → cargaParcial=true (conserva el número)", () => {
    const m = computeFuelMetrics([
      carga("U1", "2026-01-01", 1000, 50),
      carga("U1", "2026-01-11", 1500, 50, undefined, { seLlenoTanque: "No" }),
    ]);
    expect(m[1]!.kmPorLitro).toBe(10);
    expect(m[1]!.cargaParcial).toBe(true);
  });

  it("ancla con tanque NO lleno → el evento siguiente es parcial aunque él sí llene", () => {
    const m = computeFuelMetrics([
      carga("U1", "2026-01-01", 1000, 50, undefined, { seLlenoTanque: "No" }),
      carga("U1", "2026-01-11", 1500, 50), // llena, pero su ancla no
    ]);
    expect(m[1]!.cargaParcial).toBe(true);
  });
});

describe("buildFleetBaseline — fidelidad: la flota conserva parciales, la unidad no", () => {
  it("un evento parcial NO entra al baseline por-unidad pero SÍ pondera la flota", () => {
    const entries = [
      carga("U1", "2026-01-01", 1000, 50, undefined, { seLlenoTanque: "No" }),
      carga("U1", "2026-01-11", 1500, 50, undefined, { seLlenoTanque: "No" }), // 10 km/l, parcial
    ];
    const metrics = computeFuelMetrics(entries);
    const base = buildFleetBaseline(metrics, entries);
    expect(base.porUnidad.get("U1")).toBeUndefined(); // 0 eventos fieles
    expect(base.flotaKmplVol!).toBeCloseTo(10, 5); // el parcial sí cuenta en la flota
  });
});

describe("detectFuelAnomalies — Paso 1 (fidelidad + montacargas)", () => {
  it("NO marca 'rendimiento' cuando el evento bajo es una carga parcial", () => {
    const entries = [
      carga("U1", "2026-01-01", 0, 50),
      carga("U1", "2026-01-05", 500, 50), // 10
      carga("U1", "2026-01-09", 1000, 50), // 10
      carga("U1", "2026-01-13", 1500, 50), // 10
      carga("U1", "2026-01-17", 1700, 50, undefined, { seLlenoTanque: "No" }), // 4 km/l, parcial
    ];
    const metrics = computeFuelMetrics(entries);
    const f = detectFuelAnomalies(metrics, buildFleetBaseline(metrics, entries));
    expect(f.some((x) => x.key.startsWith("Fuel:rendimiento:"))).toBe(false);
  });

  it("la regla de precio EXIME a los montacargas (Gas LP a ~$10/L)", () => {
    const m = computeFuelMetrics([
      carga("M1", "2026-01-01", 100, 40, 400, { esMontacargas: true }), // $10/L, fuera de [18,35]
    ]);
    const f = detectFuelAnomalies(m, buildFleetBaseline(m, []));
    expect(f.some((x) => x.key.startsWith("Fuel:captura-precio:"))).toBe(false);
  });

  it("MAX_KM_JUMP recalibrado a 1800", () => {
    expect(DEFAULT_FUEL_THRESHOLDS.MAX_KM_JUMP).toBe(1800);
  });
});

describe("buildFleetBaseline", () => {
  it("calcula media por unidad, media de flota y ponderado por volumen", () => {
    const entries = [
      carga("U1", "2026-01-01", 0, 50),
      carga("U1", "2026-01-10", 500, 50), // 10 km/l
      carga("U1", "2026-01-20", 1000, 50), // 10 km/l
    ];
    const base = buildFleetBaseline(computeFuelMetrics(entries), entries);
    expect(base.porUnidad.get("U1")!.mean).toBeCloseTo(10, 6);
    expect(base.porUnidad.get("U1")!.kmplVol!).toBeCloseTo(10, 6); // (500+500)/(50+50)
    expect(base.flotaMean).toBeCloseTo(10, 6);
    expect(base.flotaKmplVol!).toBeCloseTo(10, 6);
  });

  it("kmplVol = Σkm/Σlitros (ponderado), NO la media de ratios", () => {
    // 1ª sin km/l; luego 50 km/10 L = 5 y 500 km/50 L = 10.
    // Media de ratios = 7.5 (sesgada); ponderado = 550/60 = 9.17 (fiel).
    const entries = [
      carga("U1", "2026-01-01", 0, 10),
      carga("U1", "2026-01-05", 50, 10),
      carga("U1", "2026-01-10", 550, 50),
    ];
    const base = buildFleetBaseline(computeFuelMetrics(entries), entries);
    const s = base.porUnidad.get("U1")!;
    expect(s.mean).toBeCloseTo(7.5, 2); // distribución por evento (anomalías)
    expect(s.kmplVol!).toBeCloseTo(9.17, 2); // eficiencia ponderada (se muestra/ranquea)
    expect(base.flotaKmplVol!).toBeCloseTo(9.17, 2);
  });

  it("la cerca IQR excluye un dedazo de litros antes de ponderar", () => {
    const entries = [
      carga("U1", "2026-01-01", 0, 50),
      carga("U1", "2026-01-05", 500, 50), // 10
      carga("U1", "2026-01-09", 1000, 50), // 10
      carga("U1", "2026-01-13", 1500, 50), // 10
      carga("U1", "2026-01-17", 2000, 50), // 10
      carga("U1", "2026-01-21", 2050, 250), // 50 km / 250 L = 0.2 (dedazo) → fuera de cerca
    ];
    const base = buildFleetBaseline(computeFuelMetrics(entries), entries);
    // Sin la cerca el ponderado sería (2000+50)/(200+250)=4.56; con la cerca el dedazo se excluye.
    expect(base.porUnidad.get("U1")!.kmplVol!).toBeCloseTo(10, 1);
  });
});

describe("detectFuelAnomalies", () => {
  it("marca Urgente cuando el odómetro retrocede", () => {
    const entries = [carga("U1", "2026-01-01", 1000, 50), carga("U1", "2026-01-05", 900, 50)];
    const metrics = computeFuelMetrics(entries);
    const f = detectFuelAnomalies(metrics, buildFleetBaseline(metrics, entries));
    const retro = f.find((x) => x.key.startsWith("Fuel:km-retrocede:"));
    expect(retro).toBeTruthy();
    expect(retro!.lv).toBe("Urgente");
    expect(retro!.cat).toBe("Combustible");
  });

  it("marca error de captura con litros inválidos", () => {
    const metrics = computeFuelMetrics([carga("U1", "2026-01-01", 1000, 0)]);
    const f = detectFuelAnomalies(metrics, buildFleetBaseline(metrics, []));
    expect(f.some((x) => x.key.startsWith("Fuel:captura-litros:"))).toBe(true);
  });

  it("detecta caída de rendimiento contra el histórico de la unidad", () => {
    // 4 cargas a ~10 km/l + 1 carga a 4 km/l → baseline≈10, evento bajo = Revisar
    const entries = [
      carga("U1", "2026-01-01", 0, 50),
      carga("U1", "2026-01-05", 500, 50), // 10
      carga("U1", "2026-01-09", 1000, 50), // 10
      carga("U1", "2026-01-13", 1500, 50), // 10
      carga("U1", "2026-01-17", 1700, 50), // 4 km/l (200/50)
    ];
    const metrics = computeFuelMetrics(entries);
    const f = detectFuelAnomalies(metrics, buildFleetBaseline(metrics, entries));
    expect(f.some((x) => x.key.startsWith("Fuel:rendimiento:"))).toBe(true);
  });

  it("marca cargas demasiado frecuentes", () => {
    const entries = [
      carga("U1", "2026-01-01", 1000, 50, undefined, { fechaHora: "2026-01-01 08:00" }),
      carga("U1", "2026-01-01", 1100, 50, undefined, { fechaHora: "2026-01-01 14:00" }),
    ];
    const metrics = computeFuelMetrics(entries);
    const f = detectFuelAnomalies(metrics, buildFleetBaseline(metrics, entries));
    expect(f.some((x) => x.key.startsWith("Fuel:frecuencia:"))).toBe(true);
  });
});

describe("detectFuelAnomalies — litros implausibles (techo por tipo)", () => {
  it("marca una carga con litros muy por encima del techo derivado de su tipo", () => {
    const tipo = { tipoUnidad: "Diesel" };
    const entries = [
      carga("U1", "2026-01-01", 0, 50, 1000, tipo),
      carga("U1", "2026-01-05", 500, 50, 1000, tipo),
      carga("U1", "2026-01-09", 1000, 48, 1000, tipo),
      carga("U1", "2026-01-13", 1500, 52, 1000, tipo),
      carga("U1", "2026-01-17", 2000, 50, 1000, tipo),
      carga("U2", "2026-01-02", 0, 250, 5000, tipo), // dedazo de litros
    ];
    const metrics = computeFuelMetrics(entries);
    const f = detectFuelAnomalies(metrics, buildFleetBaseline(metrics, entries));
    expect(f.some((x) => x.key.startsWith("Fuel:litros-implausibles:"))).toBe(true);
  });

  it("no marca si el tipo tiene menos de 4 cargas (techo no fiable)", () => {
    const entries = [
      carga("U1", "2026-01-01", 0, 50, 1000, { tipoUnidad: "Diesel" }),
      carga("U2", "2026-01-02", 0, 250, 5000, { tipoUnidad: "Diesel" }),
    ];
    const metrics = computeFuelMetrics(entries);
    const f = detectFuelAnomalies(metrics, buildFleetBaseline(metrics, entries));
    expect(f.some((x) => x.key.startsWith("Fuel:litros-implausibles:"))).toBe(false);
  });
});

describe("classByTankAndFuel — clase tanque × combustible (Paso 3)", () => {
  it("cruza tamaño (≤70 Ligero / ≥110 Pesado) con el combustible", () => {
    expect(classByTankAndFuel("58", "Gasolina Premium", false)).toBe("Ligero Premium");
    expect(classByTankAndFuel("173", "Gasolina Premium", false)).toBe("Pesado Premium");
    expect(classByTankAndFuel("165", "Diesel", false)).toBe("Pesado Diesel");
    expect(classByTankAndFuel("55", "Gasolina Magna", false)).toBe("Ligero Magna");
    expect(classByTankAndFuel("70", "Diesel", false)).toBe("Ligero Diesel"); // 70 = tope ligero
  });
  it("los montacargas conservan su tipo (no se reclasifican por tanque)", () => {
    expect(classByTankAndFuel("41", "Gas LP (montacargas)", true)).toBe("Gas LP (montacargas)");
  });
  it("sin capacidad de tanque fiable → conserva el tipo por combustible", () => {
    expect(classByTankAndFuel(undefined, "Diesel", false)).toBe("Diesel");
    expect(classByTankAndFuel("", "Gasolina Premium", false)).toBe("Gasolina Premium");
  });
});

describe("computeFuelMetrics — Paso 2A: odómetro no fiable (a nivel unidad)", () => {
  it("marca la unidad con odómetro congelado (mediana de deltas < 40 km)", () => {
    const entries = [
      carga("U1", "2026-01-01", 100, 40),
      carga("U1", "2026-01-05", 110, 40),
      carga("U1", "2026-01-09", 120, 40),
      carga("U1", "2026-01-13", 130, 40),
      carga("U1", "2026-01-17", 140, 40), // deltas 10 → medDelta=10 < 40
    ];
    const m = computeFuelMetrics(entries);
    expect(m.every((x) => x.odometroNoFiable === true)).toBe(true);
    expect(m.every((x) => x.motivoSinKmpl === "odometro_no_fiable")).toBe(true);
    expect(m.every((x) => x.kmPorLitro === null)).toBe(true);
  });
  it("NO marca una unidad sana (deltas normales)", () => {
    const entries = [
      carga("U1", "2026-01-01", 0, 50),
      carga("U1", "2026-01-05", 500, 50),
      carga("U1", "2026-01-09", 1000, 50),
      carga("U1", "2026-01-13", 1500, 50),
      carga("U1", "2026-01-17", 2000, 50),
    ];
    expect(computeFuelMetrics(entries).some((x) => x.odometroNoFiable)).toBe(false);
  });
  it("NO marca montacargas (excluidos antes de la regla)", () => {
    const entries: FuelEntry[] = [];
    for (let i = 1; i <= 6; i++)
      entries.push(carga("M1", `2026-01-0${i}`, 10 * i, 40, undefined, { esMontacargas: true }));
    expect(computeFuelMetrics(entries).some((x) => x.odometroNoFiable)).toBe(false);
  });
});

describe("detectFuelAnomalies — Paso 2B: fuga vs histórico PROPIO", () => {
  it("dispara fuga con caída sostenida bajo la mediana propia (≥ FLOOR)", () => {
    const entries = [
      carga("U1", "2026-01-01", 0, 50),
      carga("U1", "2026-01-05", 500, 50), // 10
      carga("U1", "2026-01-09", 1000, 50), // 10
      carga("U1", "2026-01-13", 1500, 50), // 10
      carga("U1", "2026-01-17", 1800, 50), // 6  (< 7 = 10·0.7)
      carga("U1", "2026-01-21", 2100, 50), // 6  (sostenido)
    ];
    const metrics = computeFuelMetrics(entries);
    const f = detectFuelAnomalies(metrics, buildFleetBaseline(metrics, entries));
    expect(f.some((x) => x.key.startsWith("Fuel:fuga:"))).toBe(true);
  });
  it("NO dispara fuga para una unidad crónicamente ineficiente (mediana propia < FLOOR=4)", () => {
    const entries = [
      carga("U1", "2026-01-01", 0, 50),
      carga("U1", "2026-01-05", 150, 50), // 3
      carga("U1", "2026-01-09", 300, 50), // 3
      carga("U1", "2026-01-13", 450, 50), // 3
      carga("U1", "2026-01-17", 550, 50), // 2
      carga("U1", "2026-01-21", 650, 50), // 2
    ];
    const metrics = computeFuelMetrics(entries);
    const f = detectFuelAnomalies(metrics, buildFleetBaseline(metrics, entries));
    expect(f.some((x) => x.key.startsWith("Fuel:fuga:"))).toBe(false); // exime por baja eficiencia crónica
  });
});

describe("worstRisk", () => {
  it("devuelve el nivel más severo", () => {
    expect(worstRisk([{ lv: "OK" }, { lv: "Revisar" }, { lv: "Urgente" }])).toBe("Urgente");
    expect(worstRisk([])).toBe("OK");
  });
});

function sol(eco: string, fecha: string, km?: number, extra: Partial<FuelEntry> = {}): FuelEntry {
  return {
    loadId: `${eco}|solicitud|${fecha}`,
    tipo: "solicitud",
    eco,
    eventoId: fecha,
    sucursal: "Guadalajara",
    fecha,
    fechaHora: `${fecha} 08:00`,
    km,
    photos: [],
    ...extra,
  } as FuelEntry;
}

describe("computeRecorridos", () => {
  it("ciclo solicitud→solicitud SIN carga: mide km, viaCarga=false, cerrado=true", () => {
    const r = computeRecorridos([sol("U1", "2026-01-01", 0), sol("U1", "2026-01-10", 500)]);
    const a = r.get("U1|solicitud|2026-01-01")!;
    expect(a.km).toBe(500);
    expect(a.viaCarga).toBe(false);
    expect(a.cerrado).toBe(true);
  });

  it("ciclo con carga de por medio: viaCarga=true; mide hasta la SIGUIENTE solicitud", () => {
    const r = computeRecorridos([
      sol("U1", "2026-01-01", 0),
      carga("U1", "2026-01-05", 300, 40, 1000),
      sol("U1", "2026-01-12", 800),
    ]);
    const a = r.get("U1|solicitud|2026-01-01")!;
    expect(a.km).toBe(800); // 800 − 0, ciclo completo (no se corta en la carga)
    expect(a.viaCarga).toBe(true);
    expect(a.cerrado).toBe(true);
  });

  it("última solicitud (sin evento posterior): km=null, cerrado=false (ciclo en curso)", () => {
    const r = computeRecorridos([sol("U1", "2026-01-01", 0), sol("U1", "2026-01-10", 500)]);
    const b = r.get("U1|solicitud|2026-01-10")!;
    expect(b.km).toBeNull();
    expect(b.cerrado).toBe(false);
  });

  it("retroceso de odómetro → km=null pero ciclo cerrado", () => {
    const r = computeRecorridos([sol("U1", "2026-01-01", 900), sol("U1", "2026-01-10", 800)]);
    const a = r.get("U1|solicitud|2026-01-01")!;
    expect(a.km).toBeNull();
    expect(a.cerrado).toBe(true);
  });

  it("salto improbable (> MAX_KM_JUMP) → km=null", () => {
    const r = computeRecorridos([sol("U1", "2026-01-01", 0), sol("U1", "2026-01-10", 10000)]);
    expect(r.get("U1|solicitud|2026-01-01")!.km).toBeNull();
  });

  it("montacargas (horómetro) → km=null", () => {
    const r = computeRecorridos([
      sol("U1", "2026-01-01", 0, { esMontacargas: true }),
      sol("U1", "2026-01-10", 500, { esMontacargas: true }),
    ]);
    expect(r.get("U1|solicitud|2026-01-01")!.km).toBeNull();
  });
});
