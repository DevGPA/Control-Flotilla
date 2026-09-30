// T6 (2) de la revisión final de feat/taller-liga-cierre: al fallar la revocación de la liga ANTES de
// anular una visita de Taller, la persona veía DOS explicaciones distintas — un toast con la causa
// real y, en el overlay, el texto fijo "No se pudo anular. Verifica tu sesión (se requiere rol
// admin)…" (falso: la sesión servía, lo que falló fue revocar). Ahora el llamador lanza
// `ErrorLegible` con el texto para la persona y el overlay lo muestra tal cual; cualquier otro error
// (red, AppSync, rol) sigue con el texto genérico, porque su mensaje técnico no es para ella.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ErrorLegible, openAnularModal } from "../src/anulacion/ui";

const OVERLAY_ID = "anulacion-overlay";
const TEXTO_GENERICO =
  "No se pudo anular. Verifica tu sesión (se requiere rol admin) e intenta de nuevo.";
const CAUSA = "No se pudo revocar la liga del proveedor; la visita no se anuló. Intenta de nuevo.";
const CONFIRMA = "PRB001A";

function overlay(): HTMLElement {
  const ov = document.getElementById(OVERLAY_ID);
  expect(ov, "el overlay de anulación no está abierto").not.toBeNull();
  return ov as HTMLElement;
}

function botonAnular(ov: HTMLElement): HTMLButtonElement {
  const b = [...ov.querySelectorAll("button")].find((x) => x.textContent === "Anular registro");
  expect(b, "no encontré el botón 'Anular registro'").toBeDefined();
  return b as HTMLButtonElement;
}

/** Llena motivo + confirmación, pulsa "Anular registro" y espera a que onConfirm se asiente. */
async function confirmar(): Promise<void> {
  const ov = overlay();
  const motivo = ov.querySelector("textarea") as HTMLTextAreaElement;
  motivo.value = "registro de prueba";
  motivo.dispatchEvent(new Event("input"));
  const conf = ov.querySelector('input[type="text"]') as HTMLInputElement;
  conf.value = CONFIRMA;
  conf.dispatchEvent(new Event("input"));
  const btn = botonAnular(ov);
  expect(btn.disabled).toBe(false);
  btn.click();
  // onConfirm() rechaza en una microtarea y el .catch pinta en la siguiente: una vuelta de macrotarea basta.
  await new Promise((r) => setTimeout(r, 0));
}

describe("openAnularModal — el error que ve la persona cuando onConfirm falla", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    document.getElementById(OVERLAY_ID)?.remove();
    vi.restoreAllMocks();
  });

  it("ErrorLegible ⇒ el overlay muestra ESE texto (no el genérico) y sigue abierto para reintentar", async () => {
    openAnularModal({
      etiqueta: "Taller · unidad 06",
      confirmText: CONFIRMA,
      onConfirm: async () => {
        throw new ErrorLegible(CAUSA);
      },
    });
    await confirmar();
    const ov = overlay();
    expect(ov.textContent).toContain(CAUSA);
    expect(ov.textContent).not.toContain("se requiere rol admin");
    // Reintentable: el botón vuelve a su texto y queda habilitado.
    expect(botonAnular(ov).disabled).toBe(false);
  });

  it("cualquier otro error ⇒ el texto genérico; el mensaje técnico NO se pinta", async () => {
    openAnularModal({
      etiqueta: "Taller · unidad 06",
      confirmText: CONFIRMA,
      onConfirm: async () => {
        throw new Error('NetworkError: 500 {"errorType":"Unauthorized"}');
      },
    });
    await confirmar();
    const ov = overlay();
    expect(ov.textContent).toContain(TEXTO_GENERICO);
    expect(ov.textContent).not.toContain("NetworkError");
    expect(ov.textContent).not.toContain("Unauthorized");
  });

  it("un ErrorLegible SIN texto no deja el renglón vacío: cae al genérico", async () => {
    openAnularModal({
      etiqueta: "Taller · unidad 06",
      confirmText: CONFIRMA,
      onConfirm: async () => {
        throw new ErrorLegible("   ");
      },
    });
    await confirmar();
    expect(overlay().textContent).toContain(TEXTO_GENERICO);
  });

  it("si onConfirm resuelve, el overlay se cierra", async () => {
    openAnularModal({
      etiqueta: "Taller · unidad 06",
      confirmText: CONFIRMA,
      onConfirm: async () => undefined,
    });
    await confirmar();
    expect(document.getElementById(OVERLAY_ID)).toBeNull();
  });

  it("publica ErrorLegible en window.__anulacionUI: el monolito no puede importar", () => {
    expect(window.__anulacionUI?.ErrorLegible).toBe(ErrorLegible);
    expect(new ErrorLegible("x")).toBeInstanceOf(Error);
    expect(new ErrorLegible("x").name).toBe("ErrorLegible");
  });
});
