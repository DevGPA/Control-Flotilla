import { describe, expect, it } from "vitest";
import { DEFAULT_FUEL_THRESHOLDS, FUEL_RULE_LABEL, ticketNoCuadra } from "../src/fuel/fuelAnalysis";
import type { FuelEntry } from "../src/fuel/types";

function carga(over: Partial<FuelEntry> = {}): FuelEntry {
  return {
    loadId: "10|carga|OPS-abc",
    tipo: "carga",
    eco: "10",
    eventoId: "OPS-abc",
    sucursal: "Guadalajara",
    fecha: "2026-08-19",
    monto: 850.5,
    litros: 35.2,
    photos: [],
    review: {
      verdictGlobal: "pendiente",
      porEvidencia: {},
      montoDetectado: 850.5,
      litrosDetectado: 35.2,
      confianzaVision: 0.9,
      tsVision: "2026-08-19T20:00:00Z",
    },
    ...over,
  } as FuelEntry;
}

describe("ticketNoCuadra: la IA solo MARCA — regla client-side sobre campos persistidos", () => {
  it("todo cuadra dentro de tolerancia → null (sin ruido)", () => {
    expect(ticketNoCuadra(carga(), DEFAULT_FUEL_THRESHOLDS)).toBeNull();
    // $2 de diferencia con tolerancia max(1%, $5) → sigue sin alertar
    const casi = carga({ monto: 848.5 });
    expect(ticketNoCuadra(casi, DEFAULT_FUEL_THRESHOLDS)).toBeNull();
  });

  it("monto del ticket ≠ capturado (fuera de max(1%, $5)) → hallazgo Revisar con ambos montos", () => {
    const e = carga({ monto: 250 });
    const f = ticketNoCuadra(e, DEFAULT_FUEL_THRESHOLDS);
    expect(f).not.toBeNull();
    expect(f?.lv).toBe("Revisar");
    expect(f?.key).toBe("Fuel:ticket-no-cuadra:10|carga|OPS-abc");
    expect(f?.text).toContain("850.50");
    expect(f?.text).toContain("250.00");
  });

  it("litros fuera de tolerancia (2%) también dispara", () => {
    const e = carga({ litros: 30 }); // detectado 35.2 → ~17% de diferencia
    const f = ticketNoCuadra(e, DEFAULT_FUEL_THRESHOLDS);
    expect(f?.text).toMatch(/litros/i);
  });

  it("confianza < umbral → null (una lectura dudosa no acusa a nadie)", () => {
    const e = carga({ monto: 250 });
    e.review = { ...e.review!, confianzaVision: 0.5 };
    expect(ticketNoCuadra(e, DEFAULT_FUEL_THRESHOLDS)).toBeNull();
  });

  it("sin lectura IA (histórico aún no reprocesado) → null", () => {
    const e = carga();
    e.review = { verdictGlobal: "pendiente", porEvidencia: {} };
    expect(ticketNoCuadra(e, DEFAULT_FUEL_THRESHOLDS)).toBeNull();
    expect(ticketNoCuadra(carga({ review: undefined }), DEFAULT_FUEL_THRESHOLDS)).toBeNull();
  });

  it("la regla tiene etiqueta para el chip y el filtro", () => {
    expect(FUEL_RULE_LABEL["ticket-no-cuadra"]).toBeTruthy();
  });
});
