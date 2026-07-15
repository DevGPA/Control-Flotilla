import { describe, expect, it, beforeEach } from "vitest";
import {
  renderDetalleCarga,
  deriveGlobalVerdict,
  type RenderDetalleCargaDeps,
} from "../src/fuel/renderDetalleCarga";
import type { FuelEntry, FuelMetrics } from "../src/fuel/types";

function carga(extra: Partial<FuelEntry> = {}): FuelEntry {
  return {
    loadId: "90|carga|1",
    tipo: "carga",
    eco: "90",
    eventoId: "1",
    placa: "JB6511A",
    sucursal: "Cancun",
    fecha: "2026-06-22",
    fechaHora: "2026-06-22 08:00",
    responsable: "MARTIN CANUL",
    km: 15960,
    litros: 53.2,
    monto: 1500,
    photos: [
      { fname: "f_medidor.jpg", col: "fotoMedidorDeCombustible", group: "Carga Combustible" },
      { fname: "f_ticket.jpg", col: "fotoDelTicketDeCarga", group: "Carga Combustible" },
    ],
    ...extra,
  };
}

function deps(load: FuelEntry, over: Partial<RenderDetalleCargaDeps> = {}): RenderDetalleCargaDeps {
  return {
    body: document.createElement("div"),
    titleEl: document.createElement("div"),
    metaEl: document.createElement("div"),
    load,
    resolveUrl: (f) => `https://signed/${f}`,
    canWrite: true,
    onValidate: () => {},
    ...over,
  };
}

describe("deriveGlobalVerdict", () => {
  it("ok si todas las evidencias ok", () => {
    expect(deriveGlobalVerdict({ odometro: "ok", medidor: "ok", ticket: "ok" })).toBe("ok");
  });
  it("discrepancia si alguna es bad", () => {
    expect(deriveGlobalVerdict({ odometro: "ok", medidor: "bad" })).toBe("discrepancia");
  });
  it("pendiente si vacío o mezcla con pendiente", () => {
    expect(deriveGlobalVerdict({})).toBe("pendiente");
    expect(deriveGlobalVerdict({ odometro: "ok", medidor: "pendiente" })).toBe("pendiente");
  });
});

describe("renderDetalleCarga", () => {
  let d: RenderDetalleCargaDeps;
  beforeEach(() => {
    d = deps(carga());
  });

  it("pinta fichas, foto del medidor en su slot, y título/meta", () => {
    renderDetalleCarga(d);
    expect(d.body.querySelectorAll(".fv-card").length).toBeGreaterThanOrEqual(3);
    const imgs = d.body.querySelectorAll("img.fv-photo");
    expect(imgs.length).toBeGreaterThanOrEqual(2);
    expect((imgs[0] as HTMLImageElement).src).toContain("signed");
    expect(d.titleEl!.textContent).toContain("90");
    expect(d.metaEl!.textContent).toContain("Cancun");
  });

  it("oculta acciones cuando canWrite=false", () => {
    const d2 = deps(carga(), { canWrite: false });
    renderDetalleCarga(d2);
    expect(d2.body.querySelector(".fv-btn-ok")).toBeNull();
    expect(d2.body.querySelector(".fv-btn-ok-sm")).toBeNull();
  });

  it("dispara onValidate al validar carga completa", () => {
    let called: { loadId: string; kind: string; verdict: string } | null = null;
    const d2 = deps(carga(), {
      onValidate: (loadId, kind, verdict) => {
        called = { loadId, kind, verdict };
      },
    });
    renderDetalleCarga(d2);
    (d2.body.querySelector(".fv-btn-ok") as HTMLButtonElement).click();
    expect(called).toEqual({ loadId: "90|carga|1", kind: "all", verdict: "ok" });
  });

  it("muestra hint cuando el odómetro retrocede", () => {
    const metrics: FuelMetrics = {
      loadId: "90|carga|1",
      eco: "90",
      fecha: "2026-06-22",
      km: 15960,
      litros: 53.2,
      monto: 1500,
      kmDesdeAnterior: -200,
      kmPorLitro: null,
      precioPorLitro: null,
      diasDesdeAnterior: 3,
    };
    const d2 = deps(carga(), { metrics });
    renderDetalleCarga(d2);
    expect(d2.body.querySelector(".fv-hint")?.textContent).toContain("retrocede");
  });

  it("Fase 2: muestra el valor detectado por IA si existe", () => {
    const load = carga({
      review: {
        verdictGlobal: "pendiente",
        porEvidencia: {},
        kmDetectado: 15958,
        fuenteDeteccion: "ia",
      },
    });
    const d2 = deps(load);
    renderDetalleCarga(d2);
    expect(d2.body.querySelector(".fv-detected")?.textContent).toContain("15,958");
  });

  it("muestra 'sin foto' en slot sin evidencia (solicitud sin ticket)", () => {
    const sol = carga({
      tipo: "solicitud",
      loadId: "90|solicitud|2",
      photos: [],
      litros: undefined,
      monto: undefined,
      nivelAntes: "0",
      nivelDeseado: "1.00",
    });
    const d2 = deps(sol);
    renderDetalleCarga(d2);
    expect(d2.body.querySelector(".fv-nophoto")).toBeTruthy();
  });

  it("muestra 'Área solicitante' cuando la carga trae areaCarga (dato de Ops)", () => {
    const d2 = deps(carga({ areaCarga: "Mantenimiento" }));
    renderDetalleCarga(d2);
    const info = d2.body.querySelector(".fv-revinfo");
    expect(info?.textContent).toContain("Área solicitante");
    expect(info?.textContent).toContain("Mantenimiento");
  });

  it("no muestra 'Área solicitante' cuando la carga no trae areaCarga", () => {
    renderDetalleCarga(d);
    expect(d.body.textContent).not.toContain("Área solicitante");
  });
});
