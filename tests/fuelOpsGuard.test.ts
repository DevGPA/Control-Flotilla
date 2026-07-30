// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderDetalleCarga } from "../src/fuel/renderDetalleCarga";
import type { FuelEntry } from "../src/fuel/types";
import {
  esOrigenOps,
  opsStatusEsFinal,
  puedeValidarManual,
  puedeCorregirKm,
  motivoBloqueo,
} from "../src/fuel/opsGuard";

describe("origen y finalidad del status", () => {
  it("reconoce el origen del puente y trata la ausencia como MoreApp", () => {
    expect(esOrigenOps({ fuente: "ops-gpa" })).toBe(true);
    expect(esOrigenOps({ fuente: undefined })).toBe(false);
    expect(esOrigenOps({ fuente: "moreapp" })).toBe(false);
  });

  it("tolera las DOS grafías de género de los statuses finales", () => {
    expect(opsStatusEsFinal({ opsStatus: "Aprobada" })).toBe(true);
    expect(opsStatusEsFinal({ opsStatus: "Aprobado" })).toBe(true);
    expect(opsStatusEsFinal({ opsStatus: "Rechazada" })).toBe(true);
    expect(opsStatusEsFinal({ opsStatus: "Rechazado" })).toBe(true);
  });

  it("todo lo demás NO es final, incluido un status que Ops no ha inventado aún", () => {
    expect(opsStatusEsFinal({ opsStatus: "Pendiente" })).toBe(false);
    expect(opsStatusEsFinal({ opsStatus: "Por corregir" })).toBe(false);
    expect(opsStatusEsFinal({ opsStatus: "Por corrección" })).toBe(false);
    expect(opsStatusEsFinal({ opsStatus: "En revisión de flotilla" })).toBe(false);
    expect(opsStatusEsFinal({ opsStatus: undefined })).toBe(false);
  });
});

describe("candado de validación manual (no congelar el veredicto de Ops)", () => {
  it("bloquea mientras Ops no haya decidido", () => {
    expect(puedeValidarManual({ fuente: "ops-gpa", opsStatus: "Pendiente" })).toBe(false);
    expect(puedeValidarManual({ fuente: "ops-gpa", opsStatus: "Por corregir" })).toBe(false);
  });

  it("permite cuando Ops ya decidió: el no-pisado existe para proteger ese override humano", () => {
    expect(puedeValidarManual({ fuente: "ops-gpa", opsStatus: "Aprobada" })).toBe(true);
    expect(puedeValidarManual({ fuente: "ops-gpa", opsStatus: "Rechazada" })).toBe(true);
  });

  it("los registros de MoreApp nunca se bloquean: nadie más los va a validar", () => {
    expect(puedeValidarManual({ fuente: undefined, opsStatus: undefined })).toBe(true);
  });

  it("explica el motivo del bloqueo, y no dice nada cuando no hay bloqueo", () => {
    expect(motivoBloqueo({ fuente: "ops-gpa", opsStatus: "Pendiente" })).toContain("Pendiente");
    expect(motivoBloqueo({ fuente: "ops-gpa", opsStatus: "Aprobada" })).toBe("");
    expect(motivoBloqueo({ fuente: undefined, opsStatus: undefined })).toBe("");
  });
});

describe("candado del odómetro (R10: divergencia silenciosa)", () => {
  it("NUNCA se corrige en FC un registro de Ops, ni siquiera ya aprobado", () => {
    expect(puedeCorregirKm({ fuente: "ops-gpa" })).toBe(false);
  });

  it("los de MoreApp sí: son los 32 errores reales y Ops no los puede tocar", () => {
    expect(puedeCorregirKm({ fuente: undefined })).toBe(true);
  });
});

function carga(over: Partial<FuelEntry> = {}): FuelEntry {
  return {
    loadId: "45|carga|OPS-abc",
    tipo: "carga",
    eco: "45",
    eventoId: "OPS-abc",
    sucursal: "Monterrey",
    fecha: "2026-07-29",
    tipoUnidad: "Gasolina Magna",
    esMontacargas: false,
    km: 1000,
    litros: 40,
    photos: [],
    ...over,
  } as FuelEntry;
}

function render(load: FuelEntry): HTMLElement {
  const body = document.createElement("div");
  renderDetalleCarga({
    body,
    load,
    canWrite: true,
    resolveUrl: () => null,
    onValidate: () => {},
    onKmDetectado: () => {},
  } as never);
  return body;
}

describe("aplicación del candado en el detalle de la carga", () => {
  it("un registro de Ops pendiente muestra el aviso y no ofrece corregir el odómetro", () => {
    const body = render(carga({ fuente: "ops-gpa", opsStatus: "Pendiente" }));
    expect(body.querySelector(".fv-bloqueo")?.textContent).toContain("Operaciones-GPA");
    expect(body.textContent).not.toContain("Odómetro real (según foto)");
  });

  it("un registro de Ops aprobado permite validar, pero el odómetro sigue siendo de Ops", () => {
    const body = render(carga({ fuente: "ops-gpa", opsStatus: "Aprobada" }));
    expect(body.querySelector(".fv-bloqueo")).toBeNull();
    expect(body.textContent).not.toContain("Odómetro real (según foto)");
    expect(body.textContent).toContain("se corrige en Ops");
  });

  it("un registro de MoreApp conserva el corrector de odómetro intacto", () => {
    const body = render(carga({ loadId: "45|carga|3809", eventoId: "3809" }));
    expect(body.querySelector(".fv-bloqueo")).toBeNull();
    expect(body.textContent).toContain("Odómetro real (según foto)");
  });
});
