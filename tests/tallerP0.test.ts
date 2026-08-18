import { describe, expect, it } from "vitest";
import {
  buildAnuladasActivas,
  esTallerAnulado,
  refIdTaller,
} from "../src/anulacion/anulacion";
import { diasVencida } from "../src/taller/tallerStore";
import { resumenPorUnidad } from "../src/taller/tallerExcel";
import { COLUMNAS_RESUMEN } from "../src/taller/exportExcel";
import type { TallerEntry } from "../src/taller/types";

/**
 * P0 del módulo Taller (2026-08-14), tras la revisión honesta con datos de prod:
 *  1. ANULACIÓN en vez de borrado físico — Taller era el ÚNICO módulo donde "Borrar"
 *     destruía el registro local Y en la nube con un confirm(). Ahora usa el tombstone
 *     reversible estándar (modelo Anulacion) como Inspecciones/Semanales/Combustible.
 *  2. SALIDA VENCIDA visible — el 87% captura fecha estimada de salida y nada la
 *     explotaba (eco 46: 15 días dentro con salida vencida desde el 31-jul, sin señal).
 *  3. $/1,000 km por unidad en el Resumen — la base del reparar-vs-reemplazar.
 */
const HOY = new Date("2026-08-14T12:00:00Z");

const entry = (over: Partial<TallerEntry> = {}): TallerEntry => ({
  id: "t1",
  estado: "En Reparación",
  ...over,
});

// ── 1. Anulación de taller ───────────────────────────────────────────────────────
describe("refIdTaller / esTallerAnulado", () => {
  it("compone el refId con la MISMA identidad que la clave cloud", () => {
    expect(refIdTaller("PW9237A", "2026-08-10")).toBe("taller|PW9237A|2026-08-10");
    // El fallback sin fecha de tallerCloudKey también es representable.
    expect(refIdTaller("54", "sin-fecha:tl_123")).toBe("taller|54|sin-fecha:tl_123");
  });

  it("excluye la fila cloud cuando hay anulación ACTIVA", () => {
    const anuladas = buildAnuladasActivas([
      { refId: "taller|PW9237A|2026-08-10", modulo: "taller", motivo: "duplicado" },
    ]);
    expect(esTallerAnulado({ unitUid: "PW9237A", fechaEntrada: "2026-08-10" }, anuladas)).toBe(true);
    expect(esTallerAnulado({ unitUid: "PW9237A", fechaEntrada: "2026-08-11" }, anuladas)).toBe(false);
  });

  it("una anulación RESTAURADA deja de excluir (reversibilidad)", () => {
    const anuladas = buildAnuladasActivas([
      {
        refId: "taller|PW9237A|2026-08-10",
        modulo: "taller",
        restauradaTs: "2026-08-14T10:00:00Z",
      },
    ]);
    expect(esTallerAnulado({ unitUid: "PW9237A", fechaEntrada: "2026-08-10" }, anuladas)).toBe(false);
  });
});

// ── 2. Salida vencida ────────────────────────────────────────────────────────────
describe("diasVencida", () => {
  it("días de atraso cuando la salida estimada ya pasó y sigue dentro", () => {
    expect(diasVencida(entry({ fsalidaEst: "2026-07-31" }), HOY)).toBe(14);
  });

  it("null si aún no vence, no hay estimada, o ya salió", () => {
    expect(diasVencida(entry({ fsalidaEst: "2026-08-20" }), HOY)).toBeNull();
    expect(diasVencida(entry({}), HOY)).toBeNull();
    expect(
      diasVencida(entry({ fsalidaEst: "2026-07-31", fsalidaReal: "2026-08-01" }), HOY),
    ).toBeNull();
  });

  it("null para finalizadas — el atraso solo aplica a unidades DENTRO del taller", () => {
    expect(diasVencida(entry({ estado: "Finalizado", fsalidaEst: "2026-07-31" }), HOY)).toBeNull();
  });

  it("el día exacto de la estimada aún no está vencida", () => {
    expect(diasVencida(entry({ fsalidaEst: "2026-08-14" }), HOY)).toBeNull();
  });

  it("fecha basura no truena ni inventa atraso", () => {
    expect(diasVencida(entry({ fsalidaEst: "no-es-fecha" }), HOY)).toBeNull();
  });
});

// ── 3. $/1,000 km por unidad ─────────────────────────────────────────────────────
describe("resumenPorUnidad — km último y costo por 1,000 km", () => {
  const visitas: TallerEntry[] = [
    entry({ id: "a", unitKey: "54", eco: "54", estado: "Finalizado", km: 80000, gasto: 5000, fentrada: "2026-06-01", fsalidaReal: "2026-06-03" }),
    entry({ id: "b", unitKey: "54", eco: "54", estado: "Finalizado", km: 88118, gasto: 3000, fentrada: "2026-08-01", fsalidaReal: "2026-08-02" }),
    // Abierta: su km SÍ cuenta para "km último" (mejor lectura del odómetro), su gasto no.
    entry({ id: "c", unitKey: "54", eco: "54", estado: "En Reparación", km: 90500 }),
  ];

  it("km último = el odómetro más alto conocido de la unidad (incluye visitas abiertas)", () => {
    const [u] = resumenPorUnidad(visitas, HOY);
    expect(u!.kmUltimo).toBe(90500);
  });

  it("costo por 1,000 km = gasto de cerradas / (km último / 1000)", () => {
    const [u] = resumenPorUnidad(visitas, HOY);
    expect(u!.costoPorMilKm).toBeCloseTo(8000 / 90.5, 5);
  });

  it("sin km conocido → ambas celdas vacías, no división entre cero", () => {
    const [u] = resumenPorUnidad(
      [entry({ id: "x", unitKey: "9", eco: "9", estado: "Finalizado", gasto: 700 })],
      HOY,
    );
    expect(u!.kmUltimo).toBe("");
    expect(u!.costoPorMilKm).toBe("");
  });

  it("las columnas del Resumen incluyen KM Último y $/1,000 km", () => {
    const titulos = COLUMNAS_RESUMEN.map((c) => c.titulo);
    expect(titulos).toContain("KM Último");
    expect(titulos).toContain("$ / 1,000 km");
  });
});
