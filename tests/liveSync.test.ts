import { describe, expect, it, vi } from "vitest";
import { startLiveSync } from "../src/api/liveSync";

function fakeModels() {
  const handlers: Array<{ modelo: string; op: string; next: () => void }> = [];
  const unsubs: string[] = [];
  const models: Record<string, unknown> = {};
  for (const modelo of ["CargaCombustible", "ValidacionCarga", "Semanal", "Unit", "Taller"]) {
    models[modelo] = {
      onCreate: () => ({
        subscribe: (h: { next: () => void }) => {
          handlers.push({ modelo, op: "onCreate", next: h.next });
          return { unsubscribe: () => unsubs.push(`${modelo}.onCreate`) };
        },
      }),
      onUpdate: () => ({
        subscribe: (h: { next: () => void }) => {
          handlers.push({ modelo, op: "onUpdate", next: h.next });
          return { unsubscribe: () => unsubs.push(`${modelo}.onUpdate`) };
        },
      }),
    };
  }
  return { models, handlers, unsubs };
}

describe("liveSync: suscripciones de los modelos del puente", () => {
  it("se suscribe a onCreate+onUpdate de los 4 modelos vivos (y NO a otros)", () => {
    const { models, handlers } = fakeModels();
    startLiveSync(
      () => {},
      () => models,
    );
    expect(handlers).toHaveLength(8); // 4 modelos × 2 operaciones
    expect(handlers.some((h) => h.modelo === "Taller")).toBe(false); // no suscrito
  });

  it("propaga el nombre del modelo en cada evento", () => {
    const { models, handlers } = fakeModels();
    const onChange = vi.fn();
    startLiveSync(onChange, () => models);
    handlers.find((h) => h.modelo === "ValidacionCarga" && h.op === "onUpdate")!.next();
    expect(onChange).toHaveBeenCalledWith("ValidacionCarga");
  });

  it("stop() cancela todas las suscripciones", () => {
    const { models, unsubs } = fakeModels();
    const stop = startLiveSync(
      () => {},
      () => models,
    );
    stop();
    expect(unsubs).toHaveLength(8);
  });

  it("sin cliente de datos: no truena, devuelve stop() inocuo", () => {
    const stop = startLiveSync(
      () => {},
      () => {
        throw new Error("Amplify no configurado");
      },
    );
    expect(() => stop()).not.toThrow();
  });
});
