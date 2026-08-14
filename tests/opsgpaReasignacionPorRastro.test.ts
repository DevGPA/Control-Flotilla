import { describe, expect, it } from "vitest";
import {
  debeMantenerCatalogo,
  mapAnulacionOps,
  metaAnulacionDeOps,
  type AnulacionOpsDestino,
} from "../src/opsgpa/mapAnulacion";

/**
 * Detección de reasignación por RASTRO ESTRUCTURAL, no por la palabra del status.
 *
 * Medido contra producción el 2026-08-11: en 903 registros de Ops el vocabulario real es
 * solo "Aprobada"/"Aprobado", "Rechazada", "Pendiente" y "Por corregir" — los cuatro
 * reconocidos. **"Anulado" NUNCA ha llegado**: cero registros, cero AuditEvent de
 * reasignación, cero anulaciones escritas por el puente. La rama de anulación jamás se
 * ejerció contra datos reales; se construyó desde el brief, no desde un evento observado.
 *
 * Por eso gatear la anulación SOLO en la palabra es frágil: el día que Ops mande
 * "Cancelado" (o cualquier otra), el registro sustituido se upsertea VIVO y se cuenta dos
 * veces en silencio. Y adivinar sinónimos es peor: el vocabulario propio de tesorería usa
 * "Reasignada", y si Ops marcara así el registro NUEVO, anularíamos el bueno.
 *
 * El brief de Ops (2026-07-29) fija un rastro inequívoco y direccional:
 *   · `reasignadoA`  → en el registro SUSTITUIDO (apunta al nuevo) ⇒ hay que anularlo
 *   · `reasignadoDe` → en el registro NUEVO ⇒ NO se toca
 *
 * Se anula por el rastro; la palabra queda como señal secundaria.
 */
const destino: AnulacionOpsDestino = {
  modulo: "combustible",
  carga: { tenantId: "gpa", economicoId: "06", tipo: "carga", eventoId: "abc123" },
};

const AHORA = "2026-08-11T20:00:00.000Z";
const meta = (ops: Record<string, unknown>) => metaAnulacionDeOps(ops, AHORA);

describe("registro SUSTITUIDO — se anula aunque el status no diga 'Anulado'", () => {
  it("`reasignadoA` con status 'Aprobada' → se anula", () => {
    const a = mapAnulacionOps(destino, meta({ status: "Aprobada", reasignadoA: { id: "nuevo1" } }));
    expect(a).not.toBeNull();
    expect(a!.modulo).toBe("combustible");
  });

  // El caso que motiva todo el cambio: una palabra que nadie anticipó.
  it("`reasignadoA` con un status DESCONOCIDO → se anula igual", () => {
    const a = mapAnulacionOps(destino, meta({ status: "Cancelado", reasignadoA: { id: "n2" } }));
    expect(a).not.toBeNull();
  });

  it("acepta el rastro como string suelto", () => {
    expect(mapAnulacionOps(destino, meta({ status: "Aprobada", reasignadoA: "OPS-xyz" }))).not.toBeNull();
  });

  it("`folioNuevo` y `nuevoFolio` también cuentan como sustitución", () => {
    expect(mapAnulacionOps(destino, meta({ status: "Aprobada", folioNuevo: "OPS-a" }))).not.toBeNull();
    expect(mapAnulacionOps(destino, meta({ status: "Aprobada", nuevoFolio: "OPS-b" }))).not.toBeNull();
  });

  it("el motivo apunta al sustituto cuando se conoce el folio", () => {
    const a = mapAnulacionOps(destino, meta({ status: "Aprobada", reasignadoA: { id: "n3" } }));
    expect(a!.motivo).toContain("OPS-n3");
  });
});

describe("registro NUEVO — nunca se anula", () => {
  // Si esto se rompe, una reasignación anularía el registro BUENO y esconderíamos la carga
  // válida de los cálculos: peor que el doble conteo que el cambio viene a evitar.
  it("`reasignadoDe` NO dispara anulación, con ningún status", () => {
    for (const status of ["Aprobada", "Pendiente", "Rechazada", "Cancelado", undefined]) {
      expect(mapAnulacionOps(destino, meta({ status, reasignadoDe: { id: "viejo1" } }))).toBeNull();
    }
  });

  it("si trae AMBOS campos, manda `reasignadoA` (fue sustituido)", () => {
    const a = mapAnulacionOps(
      destino,
      meta({ status: "Aprobada", reasignadoDe: { id: "v" }, reasignadoA: { id: "n" } }),
    );
    expect(a).not.toBeNull();
  });
});

describe("no hay falsos positivos", () => {
  it("sin rastro y sin status de anulación → null", () => {
    for (const status of ["Aprobada", "Rechazada", "Pendiente", "Por corregir", ""]) {
      expect(mapAnulacionOps(destino, meta({ status }))).toBeNull();
    }
  });

  // `reasignadoManual` lo escribe TESORERÍA en FC (detector de económico equivocado); hay 5
  // en producción. NO es un campo de Ops y no debe anular nada.
  it("`reasignadoManual` de tesorería NO dispara anulación", () => {
    const ops = { status: "Pendiente", reasignadoManual: { de: "06", a: "23", motivo: "…" } };
    expect(mapAnulacionOps(destino, meta(ops))).toBeNull();
  });

  it("el status 'Anulado' sigue anulando aunque no venga rastro (conducta previa intacta)", () => {
    expect(mapAnulacionOps(destino, meta({ status: "Anulado" }))).not.toBeNull();
  });
});

describe("debeMantenerCatalogo — un registro sustituido tampoco manda sobre `Unit`", () => {
  // Un sustituido apunta a la unidad EQUIVOCADA (por eso se reasignó): dejarlo escribir el
  // catálogo puede pisar economicoId/marca/area de la unidad correcta o crear una fantasma.
  it("false cuando está sustituido, aunque el status sea 'Aprobada'", () => {
    expect(debeMantenerCatalogo("Aprobada", true)).toBe(false);
  });

  it("sigue en false para el status 'Anulado'", () => {
    expect(debeMantenerCatalogo("Anulado")).toBe(false);
  });

  it("true en el flujo normal", () => {
    expect(debeMantenerCatalogo("Aprobada")).toBe(true);
    expect(debeMantenerCatalogo("Aprobada", false)).toBe(true);
  });
});
