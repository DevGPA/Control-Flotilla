import { describe, expect, it, beforeEach } from "vitest";
import "../src/compliance/wire";
import type { ComplianceEntry } from "../src/compliance/types";

// El wire lee window.* en tiempo de llamada (no al importar), así que basta con
// preparar los globals antes de invocar window.complianceAlerts().
const w = window as unknown as {
  scopeBySucursal?: (rows: { sucursal?: string }[]) => { sucursal?: string }[];
  __fleetUnits?: Array<{ eco?: string; plate?: string; branch?: string }>;
};

function entry(over: Partial<ComplianceEntry>): ComplianceEntry {
  return {
    tenantId: "gpa",
    economicoId: "x",
    docId: "seguro",
    tipoDoc: "seguro",
    estado: "vigente",
    diasParaVencer: null,
    ...over,
  };
}

describe("wire: el scope por sucursal preserva las unidades huérfanas (sin sucursal)", () => {
  beforeEach(() => {
    // Usuario fijado a "Guadalajara" (no admin): scopeBySucursal filtra por esa sucursal.
    w.scopeBySucursal = (rows) => rows.filter((r) => r.sucursal === "Guadalajara");
    w.__fleetUnits = [{ eco: "10", plate: "JAL-10-05", branch: "Guadalajara" }];
  });

  it("una unidad huérfana con doc vencido (sin sucursal) sigue alertando pese al lock", () => {
    window.complianceEntries = [
      entry({
        economicoId: "99",
        estado: "vencido",
        fechaVencimiento: "2026-01-01",
        diasParaVencer: -100,
      }),
    ];
    const venc = window.complianceAlerts?.().find((a) => a.short === "Doc vencido");
    expect(venc?.count).toBe(1);
  });

  it("una unidad de otra sucursal SÍ se filtra por el lock (no rompimos el scope)", () => {
    window.complianceEntries = [
      entry({
        economicoId: "20",
        estado: "vencido",
        fechaVencimiento: "2026-01-01",
        diasParaVencer: -100,
        sucursal: "Monterrey",
      }),
    ];
    const venc = window.complianceAlerts?.().find((a) => a.short === "Doc vencido");
    expect(venc).toBeUndefined();
  });
});
