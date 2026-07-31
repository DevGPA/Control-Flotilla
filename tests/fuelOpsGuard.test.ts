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

/** Km pasados a `onKmDetectado` por el render en curso (para probar el botón de retirar). */
const kmVistos: Array<number | null> = [];

function render(load: FuelEntry, canWrite = true): HTMLElement {
  kmVistos.length = 0;
  const body = document.createElement("div");
  renderDetalleCarga({
    body,
    load,
    canWrite,
    resolveUrl: () => null,
    onValidate: () => {},
    onKmDetectado: (_id: string, km: number | null) => kmVistos.push(km),
  } as never);
  return body;
}

/** Botón por su texto exacto (el DOM se construye con textContent, sin innerHTML). */
const boton = (root: HTMLElement, txt: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll("button")].find((b) => b.textContent === txt) as
    | HTMLButtonElement
    | undefined;

/** Corrección manual heredada (escrita antes de que existiera el candado). */
const CON_CORRECCION = {
  review: { verdictGlobal: "pendiente", porEvidencia: {}, kmDetectado: 999 },
} as Partial<FuelEntry>;

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

describe("el candado bloquea CREAR la corrección, nunca RETIRARLA", () => {
  it("un registro de Ops con corrección heredada sí puede retirarla", () => {
    // Sin esta salida, `kmDetectado` seguiría ganando en `kmEfectivo` y la corrección
    // quedaría irreversible desde la UI: la divergencia que el candado existe para evitar.
    const body = render(carga({ fuente: "ops-gpa", opsStatus: "Pendiente", ...CON_CORRECCION }));
    const quitar = boton(body, "Quitar corrección");
    expect(quitar, "debe ofrecerse la salida de emergencia").toBeDefined();
    // Pero NO el input de crear/cambiar: eso sigue siendo de Ops.
    expect(body.textContent).not.toContain("Odómetro real (según foto)");
    expect(body.querySelector('input[type="number"]')).toBeNull();
    expect(boton(body, "Corregir")).toBeUndefined();
    quitar!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(kmVistos).toEqual([null]);
  });

  it("un registro de Ops SIN corrección no ofrece nada que retirar", () => {
    const body = render(carga({ fuente: "ops-gpa", opsStatus: "Aprobada" }));
    expect(boton(body, "Quitar corrección")).toBeUndefined();
    expect(body.textContent).not.toContain("Corrección de odómetro heredada");
  });

  it("un registro de MoreApp con corrección conserva crear Y retirar", () => {
    const body = render(carga({ loadId: "45|carga|3809", eventoId: "3809", ...CON_CORRECCION }));
    expect(body.textContent).toContain("Odómetro real (según foto)");
    expect(boton(body, "Corregir")).toBeDefined();
    expect(boton(body, "Quitar corrección")).toBeDefined();
  });

  it("un rol de solo lectura no recibe ningún botón de escritura", () => {
    const body = render(
      carga({ fuente: "ops-gpa", opsStatus: "Pendiente", ...CON_CORRECCION }),
      false,
    );
    expect(boton(body, "Quitar corrección")).toBeUndefined();
    expect(boton(body, "Corregir")).toBeUndefined();
    expect(boton(body, "Validar")).toBeUndefined();
  });
});

describe("el aviso de bloqueo se dirige a quien podría haber escrito", () => {
  it("no se le muestra a un rol de solo lectura: nunca pudo validar", () => {
    const body = render(carga({ fuente: "ops-gpa", opsStatus: "Pendiente" }), false);
    expect(body.querySelector(".fv-bloqueo")).toBeNull();
  });

  it("sí se le muestra a quien tiene permiso de escritura", () => {
    const body = render(carga({ fuente: "ops-gpa", opsStatus: "Pendiente" }), true);
    expect(body.querySelector(".fv-bloqueo")?.textContent).toContain("congelaría");
  });
});
