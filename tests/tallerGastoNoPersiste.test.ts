// Fix ronda 2 (Task 9, Critical 1): "closing a visit is the normal end of every visit" —
// antes, `Number(datos.gasto) || 0` fabricaba un cero al hidratar cuando `datos` no traía
// el campo, y `finalizarUnidad` (Control de flotilla.html) sube el entry COMPLETO sin pasar
// por saveTallerEntry, así que ese cero fabricado (o el 0 literal que el formulario escribe
// al CREAR el ingreso, antes de que existan partidas) terminaba re-subido a DynamoDB como
// un money key "duro" — indistinguible de un cero real si las partidas se vuelven
// inalcanzables después (visita anulada y restaurada, o la placa cambia).
//
// Este archivo cubre las DOS puntas del ciclo:
//   1. Hidratación preserva ausencia (numOrUndef) — nunca fabrica un 0.
//   2. El payload que sube a cloud NUNCA carga gasto/gastoRef/gastoMO cuando la visita
//      tiene partidas (sinGastoSiTienePartidas + uploadTallerToCloud, ronda completa).
import { describe, expect, it, vi } from "vitest";
import { numOrUndef } from "../src/api/cloudHydrate";
import {
  sinGastoSiTienePartidas,
  uploadTallerToCloud,
  type LegacyTallerEntry,
} from "../src/api/batchUpload";
import type { Partida } from "../src/taller/partidas";

describe("numOrUndef — la hidratación preserva ausencia, nunca fabrica un 0", () => {
  it("null o undefined se hidratan como undefined", () => {
    expect(numOrUndef(null)).toBeUndefined();
    expect(numOrUndef(undefined)).toBeUndefined();
  });

  it("un 0 real (capturado a mano) se conserva como 0 — no se trata como ausente", () => {
    expect(numOrUndef(0)).toBe(0);
  });

  it("un número válido (incluida su forma string, como llega de JSON) se convierte", () => {
    expect(numOrUndef(1850)).toBe(1850);
    expect(numOrUndef("1850")).toBe(1850);
  });

  it("basura no-finita se trata como ausente, NUNCA como 0", () => {
    expect(numOrUndef("abc")).toBeUndefined();
    expect(numOrUndef(NaN)).toBeUndefined();
    expect(numOrUndef(Infinity)).toBeUndefined();
  });
});

describe("sinGastoSiTienePartidas — el payload de subida no carga un money key que las partidas ya poseen", () => {
  const e: LegacyTallerEntry = {
    id: "tl_1",
    plate: "ABC-123",
    estado: "Finalizado",
    gasto: 0,
    gastoRef: 0,
    gastoMO: 0,
  };

  it("sin partidas, el entry se sube tal cual (visitas históricas no se tocan)", () => {
    expect(sinGastoSiTienePartidas(e, false)).toEqual(e);
  });

  it("con partidas, gasto/gastoRef/gastoMO se QUITAN del payload — no se ponen en undefined, se eliminan", () => {
    const limpio = sinGastoSiTienePartidas(e, true);
    expect("gasto" in limpio).toBe(false);
    expect("gastoRef" in limpio).toBe(false);
    expect("gastoMO" in limpio).toBe(false);
    // El resto del entry sobrevive intacto.
    expect(limpio.id).toBe("tl_1");
    expect(limpio.plate).toBe("ABC-123");
    expect(limpio.estado).toBe("Finalizado");
  });
});

// ── Ronda completa: hidrata → cierra la visita (finalizarUnidad) → sube a cloud ──────────
type Upsert = { datos: unknown };
const upserts: Upsert[] = [];
vi.mock("../src/api/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/api/client")>();
  return {
    ...real,
    upsertTaller: (arg: Upsert) => {
      upserts.push(arg);
      return Promise.resolve({});
    },
  };
});

describe("uploadTallerToCloud — una visita con partidas que se CIERRA no sube dinero", () => {
  it("finalizarUnidad sube el entry COMPLETO (gastoRef/gastoMO en 0 desde la creación, antes de que existieran partidas) — el upload los quita porque la visita SÍ tiene partidas", async () => {
    upserts.length = 0;
    const ps: Partida[] = [
      {
        partidaId: "p1",
        visitaKey: "v",
        descripcion: "Refacción mayor",
        estado: "autorizada",
        precio: 50000,
        precioAutorizado: 50000,
        tipo: "refaccion",
        fotos: [],
      },
    ];
    // Igual que finalizarUnidad: el entry completo, con gastoRef/gastoMO en 0 literal
    // (el formulario los escribió así al crear el ingreso, antes de que la liga
    // recibiera partidas) — finalizarUnidad NUNCA los toca, solo cambia estado/fechas.
    const entry: LegacyTallerEntry = {
      id: "tl_close",
      plate: "ABC-123",
      fentrada: "2026-08-01",
      estado: "Finalizado",
      fsalidaReal: "2026-08-05",
      gasto: 0,
      gastoRef: 0,
      gastoMO: 0,
    };
    await uploadTallerToCloud([entry], "tenant-x", () => ps);
    expect(upserts).toHaveLength(1);
    const { datos } = upserts[0]!;
    expect(datos).not.toHaveProperty("gasto");
    expect(datos).not.toHaveProperty("gastoRef");
    expect(datos).not.toHaveProperty("gastoMO");
  });

  it("sin partidas, el gasto capturado a mano SÍ sube — las visitas históricas no se tocan", async () => {
    upserts.length = 0;
    const entry: LegacyTallerEntry = {
      id: "tl_legacy",
      plate: "XYZ-999",
      fentrada: "2026-01-01",
      estado: "Finalizado",
      gasto: 700,
    };
    await uploadTallerToCloud([entry], "tenant-x", () => undefined);
    const { datos } = upserts[0]! as { datos: { gasto?: number } };
    expect(datos.gasto).toBe(700);
  });

  it("sin partidasDe (el llamador no las conoce todavía), se comporta EXACTAMENTE como antes", async () => {
    upserts.length = 0;
    const entry: LegacyTallerEntry = {
      id: "tl_sin_bridge",
      plate: "QRS-1",
      fentrada: "2026-01-01",
      estado: "Finalizado",
      gasto: 300,
    };
    await uploadTallerToCloud([entry], "tenant-x");
    const { datos } = upserts[0]! as { datos: { gasto?: number } };
    expect(datos.gasto).toBe(300);
  });
});
