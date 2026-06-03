// Tests de regresión de la auditoría 2026-06-03 (ver audit/AUDITORIA-2026-06-03-detalle.md).
// Cada test FALLA con el código previo al fix y PASA con el fix aplicado.

import { describe, expect, it } from "vitest";
import { analyzeRow } from "../src/analyzer/analyzeRow";
import { buildHistorialRows } from "../src/taller/renderHistorial";
import { computeActivasKpis } from "../src/taller/renderActivasKpis";
import { filterAndSortWeekly } from "../src/weekly/renderTableSemanales";
import type { TallerEntry } from "../src/taller/types";
import type { WeeklyEntry } from "../src/types";

function mkT(overrides: Partial<TallerEntry> = {}): TallerEntry {
  return {
    id: "t1",
    unitKey: "U1",
    eco: "A-117",
    plate: "ABC-123",
    brand: "Toyota Hilux",
    sucursal: "GDL",
    area: "LOGISTICA",
    tipo: "Correctivo",
    estado: "Finalizado",
    fentrada: "2026-04-10",
    fsalidaReal: "2026-04-12",
    gastoRef: 500,
    gastoMO: 1000,
    updatedAt: "2026-04-12T10:00:00Z",
    ...overrides,
  };
}

function mkW(overrides: Partial<WeeklyEntry> = {}): WeeklyEntry {
  return {
    uid: "u1",
    eco: "A-100",
    plate: "ABC-123",
    brand: "Toyota",
    branch: "GDL",
    fecha: "2026-04-15",
    km: 120000,
    responsable: "Juan",
    aceiteRisk: "OK",
    radiadorRisk: "OK",
    carroceriaRisk: "OK",
    llantaRisk: "OK",
    ...overrides,
  };
}

describe("#11 analyzeRow — negativos compuestos en refacción", () => {
  it("'No cuenta'/'No tiene'/'Ninguna'/'Sin refacción' marcan sin refacción (no solo 'No')", () => {
    for (const v of ["No", "No cuenta", "No tiene", "Ninguna", "Sin refacción"]) {
      const r = analyzeRow({ "Cuenta con llanta de Refacción?": v });
      expect(r.F.some((f) => f.text === "Sin llanta de refacción funcional")).toBe(true);
    }
  });

  it("'Sí' y vacío NO marcan sin refacción", () => {
    const has = (v: string): boolean =>
      analyzeRow({ "Cuenta con llanta de Refacción?": v }).F.some(
        (f) => f.text === "Sin llanta de refacción funcional",
      );
    expect(has("Sí")).toBe(false);
    expect(has("")).toBe(false);
  });
});

describe("#13 parseSvcDate — serial Excel", () => {
  it("acepta un serial Excel pasado y dispara el fallback 'Servicio VENCIDO'", () => {
    // serial 40000 ≈ 2009 (pasado) sin datos de km → fallback de fecha vencida.
    const r = analyzeRow({ "Fecha estimada del siguiente servicio": 40000 });
    expect(r.F.some((f) => f.cat === "Mantenimiento" && f.text.includes("VENCIDO"))).toBe(true);
  });
});

describe("#25 computeActivasKpis — promDiasComp respeta el filtro", () => {
  it("con filtro sucursal solo promedia los cierres de esa sucursal", () => {
    const k = computeActivasKpis(
      [
        mkT({
          id: "g1",
          unitKey: "U1",
          sucursal: "GDL",
          fentrada: "2026-04-01",
          fsalidaReal: "2026-04-11",
        }), // 10
        mkT({
          id: "m1",
          unitKey: "U2",
          sucursal: "MTY",
          fentrada: "2026-04-01",
          fsalidaReal: "2026-04-03",
        }), // 2
      ],
      { sucursal: "GDL" },
    );
    expect(k.promDiasComp).toBe(10); // antes promediaba global (=6)
  });
});

describe("#27/#28/#29 buildHistorialRows — filtros de rango y latestClosed", () => {
  it("#27 cerrada SIN fentrada se excluye cuando hay rango activo", () => {
    const rows = buildHistorialRows(
      [
        mkT({
          id: "x",
          unitKey: "U1",
          fentrada: "",
          fsalidaReal: "2026-04-10",
          gastoRef: 500,
          gastoMO: 0,
        }),
      ],
      { desde: "2026-04-01", hasta: "2026-04-30" },
    );
    expect(rows).toHaveLength(0);
  });

  it("#28 borde superior con timestamp ISO completo NO se excluye", () => {
    const rows = buildHistorialRows(
      [
        mkT({
          id: "y",
          unitKey: "U2",
          fentrada: "2026-04-30T10:00:00Z",
          fsalidaReal: "2026-05-01",
        }),
      ],
      { hasta: "2026-04-30" },
    );
    expect(rows).toHaveLength(1);
  });

  it("#29 latestClosed = cierre de mayor updatedAt, no la activa ni el primer cerrado", () => {
    const rows = buildHistorialRows([
      mkT({ id: "a1", unitKey: "U1", estado: "En Reparación", updatedAt: "2026-04-25T00:00:00Z" }),
      mkT({
        id: "c1",
        unitKey: "U1",
        estado: "Finalizado",
        updatedAt: "2026-04-10T00:00:00Z",
        fsalidaReal: "2026-04-10",
      }),
      mkT({
        id: "c2",
        unitKey: "U1",
        estado: "Finalizado",
        updatedAt: "2026-04-20T00:00:00Z",
        fsalidaReal: "2026-04-20",
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.latestClosed.id).toBe("c2"); // antes devolvía c1 (primer cerrado)
  });
});

describe("#32 filterAndSortWeekly — riesgo carrocería/llanta undefined cuenta como OK", () => {
  it("filtro 'carroceria' NO deja pasar filas con carroceriaRisk undefined", () => {
    const rows = filterAndSortWeekly(
      [mkW({ uid: "a", carroceriaRisk: undefined }), mkW({ uid: "b", carroceriaRisk: "Revisar" })],
      { riskFilter: "carroceria", sucursal: "all", search: "" },
      "risk",
      -1,
    );
    expect(rows.map((r) => r.uid)).toEqual(["b"]);
  });

  it("filtro 'llanta' NO deja pasar filas con llantaRisk undefined", () => {
    const rows = filterAndSortWeekly(
      [mkW({ uid: "a", llantaRisk: undefined }), mkW({ uid: "b", llantaRisk: "Urgente" })],
      { riskFilter: "llanta", sucursal: "all", search: "" },
      "risk",
      -1,
    );
    expect(rows.map((r) => r.uid)).toEqual(["b"]);
  });
});
