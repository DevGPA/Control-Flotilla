import { describe, it, expect } from "vitest";
import {
  buildSucursalesOps,
  buildPrevCorrectivo,
  buildCostoUnidad,
  buildRadarVencimientos,
  buildReincidentes,
  buildGastoMensual,
  gastoDe,
  restarMeses,
} from "../src/analytics/opsTablero";

// ── Sucursales: cobertura y riesgo ───────────────────────────────────────────

describe("buildSucursalesOps", () => {
  const roster = [
    { plate: "A1", branch: "GDL" },
    { plate: "A2", branch: "GDL" },
    { plate: "B1", branch: "MTY" },
    { plate: "B2", branch: "MTY" },
    { plate: "B3", branch: "MTY" },
  ];

  it("cobertura y riesgo por sucursal, peor cobertura primero", () => {
    const rango = [
      { plate: "A1", branch: "GDL", risk: "Urgente" },
      { plate: "A2", branch: "GDL", risk: "OK" },
      { plate: "B1", branch: "MTY", risk: "Revisar" },
    ];
    const out = buildSucursalesOps(roster, rango);
    expect(out.map((r) => r.sucursal)).toEqual(["MTY", "GDL"]); // 33% antes que 100%
    expect(out[0]).toMatchObject({ total: 3, conCheck: 1, pct: 33, revisar: 1, urgentes: 0 });
    expect(out[1]).toMatchObject({ total: 2, conCheck: 2, pct: 100, urgentes: 1 });
  });

  it("sucursal vacía cae a 'Sin sucursal'", () => {
    const out = buildSucursalesOps([{ plate: "X", branch: "  " }], []);
    expect(out[0]!.sucursal).toBe("Sin sucursal");
  });

  it("roster vacío → vacío", () => {
    expect(buildSucursalesOps([], [{ plate: "A", risk: "Urgente" }])).toHaveLength(1); // solo la fila de riesgo
    expect(buildSucursalesOps([], [])).toEqual([]);
  });
});

// ── Radar de vencimientos ────────────────────────────────────────────────────

describe("buildRadarVencimientos", () => {
  const svcDe =
    (mapa: Record<string, "vencido" | "proximo" | "ok">) => (u: { eco?: string; plate?: string }) =>
      mapa[String(u.eco ?? u.plate)] ?? "ok";

  it("consolida servicio (criterio inyectado) + cumplimiento, vencidos primero", () => {
    const fleet = [
      { eco: "10", branch: "GDL", kmNextSvc: 80000 },
      { eco: "11", branch: "MTY" },
      { eco: "12", branch: "GDL" },
    ];
    const compliance = [
      {
        economicoId: "10",
        tipoDoc: "verificacion",
        estado: "porVencer",
        diasParaVencer: 8,
        sucursal: "GDL",
      },
      {
        economicoId: "11",
        tipoDoc: "seguro",
        estado: "vencido",
        diasParaVencer: -30,
        sucursal: "MTY",
      },
      {
        economicoId: "12",
        tipoDoc: "multa",
        estado: "adeudo",
        diasParaVencer: null,
        sucursal: "GDL",
      },
      { economicoId: "13", tipoDoc: "seguro", estado: "vigente", diasParaVencer: 200 },
    ];
    const radar = buildRadarVencimientos(
      fleet,
      svcDe({ "10": "vencido", "11": "proximo" }),
      compliance,
    );
    expect(radar.vencidos).toBe(3); // svc eco10 + seguro eco11 + multa eco12
    expect(radar.proximos).toBe(2); // svc eco11 + verificación eco10
    // Orden: vencidos con días primero (seguro -30), luego sin días (svc km, multa)
    expect(radar.items[0]).toMatchObject({
      eco: "11",
      que: "Seguro",
      detalle: "vencido hace 30 días",
    });
    expect(radar.items.filter((i) => i.severidad === "vencido")).toHaveLength(3);
  });

  it("montacargas no cuentan para servicio y 'vigente' no entra", () => {
    const radar = buildRadarVencimientos([{ eco: "M1", esMontacargas: true }], () => "vencido", [
      { economicoId: "20", tipoDoc: "seguro", estado: "vigente", diasParaVencer: 100 },
    ]);
    expect(radar.items).toHaveLength(0);
  });

  it("etiquetas de tipoDoc y detalle de días", () => {
    const radar = buildRadarVencimientos([], () => "ok", [
      { economicoId: "1", tipoDoc: "tarjetaCirculacion", estado: "porVencer", diasParaVencer: 1 },
      { economicoId: "2", tipoDoc: "verificacion", estado: "porVencer", diasParaVencer: 0 },
    ]);
    expect(radar.items.map((i) => i.que).sort()).toEqual([
      "Tarjeta de circulación",
      "Verificación",
    ]);
    expect(radar.items[0]!.detalle).toBe("vence hoy");
    expect(radar.items[1]!.detalle).toBe("vence mañana");
  });

  it("respeta maxItems pero los contadores son totales", () => {
    const compliance = Array.from({ length: 20 }, (_, i) => ({
      economicoId: String(i),
      tipoDoc: "seguro",
      estado: "vencido",
      diasParaVencer: -i,
    }));
    const radar = buildRadarVencimientos([], () => "ok", compliance, { maxItems: 5 });
    expect(radar.items).toHaveLength(5);
    expect(radar.vencidos).toBe(20);
  });
});

// ── Unidades reincidentes ────────────────────────────────────────────────────

describe("buildReincidentes", () => {
  const insp = (eco: string, fecha: string, risk: string, branch = "GDL") => ({
    eco,
    plate: `P${eco}`,
    fecha,
    risk,
    branch,
  });
  const visita = (eco: string, fentrada: string, extra: Record<string, unknown> = {}) => ({
    eco,
    fentrada,
    ...extra,
  });

  it("urgente en ≥2 meses distintos califica; 1 mes no", () => {
    const out = buildReincidentes(
      [
        insp("40", "2026-06-05", "Urgente"),
        insp("40", "2026-08-10", "Urgente"),
        insp("41", "2026-08-12", "Urgente"), // solo 1 mes
      ],
      [],
    );
    expect(out.map((r) => r.eco)).toEqual(["40"]);
    expect(out[0]).toMatchObject({ mesesUrgente: 2, ultimoRiesgo: "Urgente" });
  });

  it("≥2 visitas a taller califica aunque no haya urgencias; suma gasto canónico y guarda tallerKey", () => {
    const out = buildReincidentes(
      [insp("50", "2026-08-01", "OK")],
      [
        visita("50", "2026-07-03", { gastoRef: 1000, gastoMO: 500, unitKey: "uk-1" }),
        visita("50", "2026-08-15", { gasto: 2000, unitKey: "uk-1" }), // legacy sin desglose
      ],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ visitasTaller: 2, gastoTaller: 3500, tallerKey: "uk-1" });
  });

  it("la ventana de 6 meses se ancla al dato más reciente", () => {
    const out = buildReincidentes(
      [
        insp("60", "2025-01-05", "Urgente"), // fuera de ventana
        insp("60", "2025-02-05", "Urgente"), // fuera
        insp("60", "2026-08-10", "Urgente"),
        insp("61", "2026-03-01", "Urgente"), // 2026-03 = cutoff con max 2026-08
        insp("61", "2026-08-01", "Urgente"),
      ],
      [],
    );
    expect(out.map((r) => r.eco)).toEqual(["61"]); // 60 solo tiene 1 mes en ventana
  });

  it("orden: meses urgentes desc, luego visitas, luego gasto", () => {
    const out = buildReincidentes(
      [
        insp("70", "2026-07-01", "Urgente"),
        insp("70", "2026-08-01", "Urgente"),
        insp("71", "2026-06-01", "Urgente"),
        insp("71", "2026-07-01", "Urgente"),
        insp("71", "2026-08-01", "Urgente"),
      ],
      [visita("70", "2026-08-01", { gasto: 9999 })],
    );
    expect(out.map((r) => r.eco)).toEqual(["71", "70"]);
  });

  it("cruza taller↔inspecciones por eco normalizado (trim/case)", () => {
    const out = buildReincidentes(
      [insp(" 80 ", "2026-08-01", "OK")],
      [visita("80", "2026-07-01"), visita("80 ", "2026-08-01")],
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.visitasTaller).toBe(2);
  });

  it("sin datos → vacío", () => {
    expect(buildReincidentes([], [])).toEqual([]);
  });
});

// ── Gasto mensual ────────────────────────────────────────────────────────────

describe("buildGastoMensual", () => {
  it("agrupa por mes de entrada y por sucursal, orden ascendente", () => {
    const out = buildGastoMensual([
      { fentrada: "2026-08-05", sucursal: "GDL", gastoRef: 1000, gastoMO: 200 },
      { fentrada: "2026-08-20", sucursal: "MTY", gasto: 500 },
      { fentrada: "2026-07-01", sucursal: "GDL", gasto: 300 },
      { fentrada: "", sucursal: "GDL", gasto: 999 }, // sin fecha → fuera
      { fentrada: "2026-08-02", sucursal: "GDL" }, // sin gasto → fuera
    ]);
    expect(out.map((m) => m.mes)).toEqual(["2026-07", "2026-08"]);
    expect(out[1]).toMatchObject({
      label: "Ago 2026",
      total: 1700,
      porSucursal: { GDL: 1200, MTY: 500 },
    });
  });

  it("recorta a los últimos maxMeses", () => {
    const taller = Array.from({ length: 14 }, (_, i) => ({
      fentrada: `${i < 12 ? 2025 : 2026}-${String((i % 12) + 1).padStart(2, "0")}-05`,
      sucursal: "GDL",
      gasto: 100,
    }));
    expect(buildGastoMensual(taller)).toHaveLength(12);
    expect(buildGastoMensual(taller, { maxMeses: 3 })).toHaveLength(3);
  });

  // Fix ronda 1 (Task 9): prueba end-to-end de que el threading llega al consumidor
  // real (no solo a gastoDe aislado) — una visita sin gasto tecleado pero con
  // partidas firmadas debe aparecer en la serie mensual del tablero de Análisis.
  it("con partidasDe, un mes cuyo único gasto llegó por partidas firmadas no desaparece de la serie", () => {
    const ps = [
      {
        partidaId: "p1",
        visitaKey: "clave-v1",
        descripcion: "Refacción",
        estado: "autorizada" as const,
        precio: 2500,
        precioAutorizado: 2500,
        tipo: "refaccion" as const,
        fotos: [],
      },
    ];
    const visita = { id: "v1", fentrada: "2026-08-05", sucursal: "GDL", gasto: 0 };
    const out = buildGastoMensual([visita], undefined, (t) => (t.id === "v1" ? ps : undefined));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ mes: "2026-08", total: 2500, porSucursal: { GDL: 2500 } });
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

describe("gastoDe / restarMeses", () => {
  it("gasto canónico: desglose Ref+MO manda; fallback al subtotal legacy", () => {
    expect(gastoDe({ gastoRef: 100, gastoMO: 50, gasto: 999 })).toBe(150);
    expect(gastoDe({ gasto: 800 })).toBe(800);
    expect(gastoDe({})).toBe(0);
  });

  // Fix ronda 1 (Task 9): gastoDe reimplementaba su propia copia de la fórmula de
  // gastoTotalDe (src/taller/exportExcel.ts) en vez de llamarla — una unidad cuyo
  // gasto llegó ENTERO por partidas firmadas quedaba en $0 en el tablero de Análisis.
  it("con partidas firmadas, usa el AUTORIZADO en vez del legacy — no 0", () => {
    const ps = [
      {
        partidaId: "p1",
        visitaKey: "v",
        descripcion: "Refacción",
        estado: "autorizada" as const,
        precio: 4000,
        precioAutorizado: 4000,
        tipo: "refaccion" as const,
        fotos: [],
      },
      {
        partidaId: "p2",
        visitaKey: "v",
        descripcion: "Rechazada",
        estado: "rechazada" as const,
        precio: 999,
        tipo: "refaccion" as const,
        fotos: [],
      },
    ];
    expect(gastoDe({ gasto: 0, gastoRef: 0, gastoMO: 0 }, ps)).toBe(4000);
  });

  it("sin partidas (ausente o []), se comporta EXACTAMENTE como antes", () => {
    expect(gastoDe({ gastoRef: 100, gastoMO: 50, gasto: 999 }, [])).toBe(150);
    expect(gastoDe({ gasto: 800 })).toBe(800);
  });

  it("restarMeses cruza el año", () => {
    expect(restarMeses("2026-08", 5)).toBe("2026-03");
    expect(restarMeses("2026-02", 3)).toBe("2025-11");
    expect(restarMeses("2026-01", 12)).toBe("2025-01");
  });
});

// ── Preventivo vs Correctivo ─────────────────────────────────────────────────

describe("buildPrevCorrectivo", () => {
  it("parte el gasto mensual por tipo; sin tipo/accidente → otros", () => {
    const out = buildPrevCorrectivo([
      { fentrada: "2026-08-05", tipo: "Preventivo", gasto: 1000 },
      { fentrada: "2026-08-10", tipo: "Correctivo", gastoRef: 2000, gastoMO: 500 },
      { fentrada: "2026-08-12", tipo: "Accidente", gasto: 300 },
      { fentrada: "2026-08-15", gasto: 200 }, // sin tipo
      { fentrada: "2026-07-01", tipo: "correctivo", gasto: 900 }, // case-insensitive
    ]);
    expect(out.map((m) => m.mes)).toEqual(["2026-07", "2026-08"]);
    expect(out[0]).toMatchObject({ correctivo: 900, preventivo: 0, otros: 0 });
    expect(out[1]).toMatchObject({
      preventivo: 1000,
      correctivo: 2500,
      otros: 500,
      label: "Ago 2026",
    });
  });

  it("sin fecha o sin gasto → fuera; recorta a maxMeses", () => {
    const taller = Array.from({ length: 14 }, (_, i) => ({
      fentrada: `${i < 12 ? 2025 : 2026}-${String((i % 12) + 1).padStart(2, "0")}-05`,
      tipo: "Preventivo",
      gasto: 100,
    }));
    expect(buildPrevCorrectivo(taller)).toHaveLength(12);
    expect(buildPrevCorrectivo([{ fentrada: "", gasto: 5 }, { fentrada: "2026-08-01" }])).toEqual(
      [],
    );
  });
});

// ── Costo por unidad ─────────────────────────────────────────────────────────

describe("buildCostoUnidad", () => {
  const fleet = [
    { eco: "45", plate: "P45", branch: "GDL", brand: "RAM", anio: 2016 },
    { eco: "46", plate: "P46", branch: "MTY", brand: "Aumark", anio: 2022 },
  ];

  it("acumula gasto 12m por unidad, resuelve marca/año del catálogo, ordena por gasto", () => {
    const out = buildCostoUnidad(
      [
        { eco: "45", fentrada: "2026-08-01", gasto: 5000, unitKey: "uk-45" },
        { eco: "45", fentrada: "2026-03-01", gastoRef: 3000, gastoMO: 0, unitKey: "uk-45" },
        { eco: "46", fentrada: "2026-08-10", gasto: 2000, unitKey: "uk-46" },
      ],
      fleet,
    );
    expect(out.map((r) => r.eco)).toEqual(["45", "46"]);
    expect(out[0]).toMatchObject({
      unidad: "RAM 2016",
      sucursal: "GDL",
      visitas: 2,
      gasto: 8000,
      tallerKey: "uk-45",
    });
  });

  it("unidad fuera del catálogo usa la sucursal del taller y unidad '—'", () => {
    const out = buildCostoUnidad(
      [{ eco: "99", sucursal: "Cancun", fentrada: "2026-08-01", gasto: 100 }],
      fleet,
    );
    expect(out[0]).toMatchObject({ eco: "99", unidad: "—", sucursal: "Cancun", tallerKey: "" });
  });

  it("ventana 12m anclada al dato más reciente; visitas sin gasto no cuentan", () => {
    const out = buildCostoUnidad(
      [
        { eco: "45", fentrada: "2025-08-01", gasto: 9999 }, // 2025-08 < cutoff 2025-09
        { eco: "45", fentrada: "2026-08-01", gasto: 100 },
        { eco: "45", fentrada: "2026-07-01" }, // sin gasto
      ],
      fleet,
    );
    expect(out[0]).toMatchObject({ gasto: 100, visitas: 1 });
  });

  it("respeta maxItems y sin datos → vacío", () => {
    const taller = Array.from({ length: 12 }, (_, i) => ({
      eco: String(i),
      fentrada: "2026-08-01",
      gasto: 100 + i,
    }));
    expect(buildCostoUnidad(taller, [], { maxItems: 5 })).toHaveLength(5);
    expect(buildCostoUnidad([], fleet)).toEqual([]);
  });
});
