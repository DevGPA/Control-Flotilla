// @vitest-environment happy-dom
/**
 * C5b — defensa en profundidad: los candados de `opsGuard` se aplican en los HANDLERS de
 * `wire.ts`, no solo en la capa de render. Que hoy el único camino a `handleValidate` /
 * `handleKmDetectado` sea el drawer es una coincidencia del cableado, no una garantía.
 *
 * Los handlers son privados del módulo, así que se capturan por donde `wire.ts` los entrega:
 * los `deps` con los que arma el drawer. Así se prueban SIN pasar por el candado del render
 * (que es justo lo que hay que poder saltar para demostrar que el handler protege solo).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FuelEntry } from "../src/fuel/types";
import type { RenderDetalleCargaDeps } from "../src/fuel/renderDetalleCarga";

let deps: RenderDetalleCargaDeps | null = null;
vi.mock("../src/fuel/renderDetalleCarga", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/fuel/renderDetalleCarga")>();
  return {
    ...real,
    renderDetalleCarga: (d: RenderDetalleCargaDeps) => {
      deps = d;
    },
  };
});

type Upsert = { loadId: string; kmDetectado?: number | null; verdictGlobal?: string };
const upserts: Upsert[] = [];
vi.mock("../src/api/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/api/client")>();
  return {
    ...real,
    upsertValidacionCarga: (arg: Upsert) => {
      upserts.push(arg);
      return Promise.resolve();
    },
  };
});

const avisos: string[] = [];

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

/**
 * Monta el drawer con `load` y devuelve los handlers REALES de wire.ts.
 * Sin `#fuel-tbody` en el DOM, `renderCombustible` es un no-op (early return).
 */
async function handlers(load: FuelEntry): Promise<{
  onValidate: RenderDetalleCargaDeps["onValidate"];
  onKmDetectado: NonNullable<RenderDetalleCargaDeps["onKmDetectado"]>;
}> {
  document.body.replaceChildren();
  const body = document.createElement("div");
  body.id = "fuel-det-body";
  document.body.appendChild(body);
  window.fuelEntries = [load];
  await import("../src/fuel/wire");
  window.openFuelDetail!(load.loadId);
  expect(deps, "wire.ts debió armar el drawer").not.toBeNull();
  expect(deps!.onKmDetectado, "el drawer siempre recibe onKmDetectado").toBeTypeOf("function");
  return { onValidate: deps!.onValidate, onKmDetectado: deps!.onKmDetectado! };
}

beforeEach(() => {
  upserts.length = 0;
  avisos.length = 0;
  deps = null;
  window.notify = (msg: string) => {
    avisos.push(msg);
  };
});

describe("handleKmDetectado — el candado del odómetro no vive solo en el render", () => {
  it("rechaza CREAR una corrección en un registro de Ops y explica por qué", async () => {
    const load = carga({ fuente: "ops-gpa", opsStatus: "Aprobada" });
    const { onKmDetectado } = await handlers(load);
    onKmDetectado(load.loadId, 16800);
    expect(upserts).toEqual([]);
    expect(load.review).toBeUndefined(); // ni siquiera se tocó el objeto local
    expect(avisos.join(" ")).toContain("Operaciones-GPA");
  });

  it("SÍ permite RETIRARLA: es la salida de emergencia de una corrección ya escrita", async () => {
    const load = carga({
      fuente: "ops-gpa",
      opsStatus: "Pendiente",
      review: { verdictGlobal: "pendiente", porEvidencia: {}, kmDetectado: 999 },
    } as Partial<FuelEntry>);
    const { onKmDetectado } = await handlers(load);
    onKmDetectado(load.loadId, null);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.kmDetectado).toBeNull();
    expect(load.review?.kmDetectado).toBeUndefined();
  });

  it("un registro de MoreApp se corrige con normalidad", async () => {
    const load = carga({ loadId: "45|carga|3809", eventoId: "3809" });
    const { onKmDetectado } = await handlers(load);
    onKmDetectado(load.loadId, 16800);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.kmDetectado).toBe(16800);
    expect(load.review?.kmDetectado).toBe(16800);
    expect(avisos.join(" ")).not.toContain("Operaciones-GPA");
  });
});

describe("handleValidate — el candado del veredicto no vive solo en el render", () => {
  it("no escribe nada mientras Ops no haya decidido, y dice el motivo", async () => {
    const load = carga({ fuente: "ops-gpa", opsStatus: "Pendiente" });
    const { onValidate } = await handlers(load);
    onValidate(load.loadId, "all", "ok");
    expect(upserts).toEqual([]);
    expect(load.review).toBeUndefined();
    // Mismo texto que el aviso del drawer (motivoBloqueo), no un mensaje paralelo.
    expect(avisos.join(" ")).toContain("Pendiente");
    expect(avisos.join(" ")).toContain("congelaría");
  });

  it("también bloquea «Por corregir» — se decide por negación, no por lista blanca", async () => {
    const load = carga({ fuente: "ops-gpa", opsStatus: "Por corregir" });
    const { onValidate } = await handlers(load);
    onValidate(load.loadId, "odometro", "ok");
    expect(upserts).toEqual([]);
    expect(load.review).toBeUndefined();
  });

  it("cuando Ops ya decidió, el criterio humano de Tesorería tiene la última palabra", async () => {
    const load = carga({ fuente: "ops-gpa", opsStatus: "Aprobado" });
    const { onValidate } = await handlers(load);
    onValidate(load.loadId, "all", "ok");
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.verdictGlobal).toBe("ok");
  });

  it("un registro de MoreApp se valida con normalidad", async () => {
    const load = carga({ loadId: "45|carga|3809", eventoId: "3809" });
    const { onValidate } = await handlers(load);
    onValidate(load.loadId, "all", "ok");
    expect(upserts).toHaveLength(1);
    expect(load.review?.verdictGlobal).toBe("ok");
  });
});
