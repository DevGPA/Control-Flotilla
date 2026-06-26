import { describe, expect, it } from "vitest";
import {
  buildComplianceEntries,
  buildComplianceDoc,
  type ComplianceDocRow,
} from "../src/compliance/mapEntry";

const HOY = "2026-06-26";

function row(over: Partial<ComplianceDocRow> = {}): ComplianceDocRow {
  return {
    tenantId: "gpa",
    economicoId: "78",
    docId: "seguro",
    tipoDoc: "seguro",
    ...over,
  };
}

describe("buildComplianceEntries", () => {
  it("mapea una fila a entry con estado derivado", () => {
    const out = buildComplianceEntries([row({ fechaVencimiento: "2026-06-01" })], HOY);
    expect(out).toHaveLength(1);
    expect(out[0]?.estado).toBe("vencido");
    expect(out[0]?.tipoDoc).toBe("seguro");
  });

  it("descarta filas sin identidad mínima", () => {
    const out = buildComplianceEntries(
      [
        row(), // ok
        { tenantId: "gpa", economicoId: null, docId: "x", tipoDoc: "seguro" }, // sin eco
        { tenantId: "gpa", economicoId: "9", docId: "seguro" }, // sin tipoDoc
      ],
      HOY,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.economicoId).toBe("78");
  });

  it("normaliza monto null (no lo arrastra como adeudo en documentos)", () => {
    const out = buildComplianceEntries([row({ fechaVencimiento: "2026-12-31", monto: null })], HOY);
    expect(out[0]?.monto).toBeUndefined();
    expect(out[0]?.estado).toBe("vigente");
  });

  it("una multa sin monto queda como adeudo", () => {
    const out = buildComplianceEntries(
      [row({ docId: "multa#cdmx#A1", tipoDoc: "multa", monto: null })],
      HOY,
    );
    expect(out[0]?.estado).toBe("adeudo");
  });

  it("adjunta sucursal/placa desde el lookup por economicoId", () => {
    const unitsByEco = new Map([["78", { sucursal: "Guadalajara", placa: "JAB-12-30" }]]);
    const out = buildComplianceEntries([row()], HOY, { unitsByEco });
    expect(out[0]?.sucursal).toBe("Guadalajara");
    expect(out[0]?.placa).toBe("JAB-12-30");
  });

  it("sin lookup, sucursal/placa quedan indefinidos", () => {
    const out = buildComplianceEntries([row()], HOY);
    expect(out[0]?.sucursal).toBeUndefined();
    expect(out[0]?.placa).toBeUndefined();
  });

  it("respeta una ventana de por-vencer personalizada", () => {
    const r = row({ fechaVencimiento: "2026-07-10" }); // +14 días
    expect(buildComplianceEntries([r], HOY, { diasPorVencer: 7 })[0]?.estado).toBe("vigente");
    expect(buildComplianceEntries([r], HOY, { diasPorVencer: 30 })[0]?.estado).toBe("porVencer");
  });

  it("trimea economicoId/docId para un matching robusto del lookup", () => {
    const unitsByEco = new Map([["78", { sucursal: "Guadalajara", placa: "JAB-1" }]]);
    const out = buildComplianceEntries([row({ economicoId: "  78  ", docId: "  seguro " })], HOY, {
      unitsByEco,
    });
    expect(out[0]?.economicoId).toBe("78");
    expect(out[0]?.sucursal).toBe("Guadalajara"); // empata pese a los espacios
  });

  it("descarta monto negativo y trata la multa como adeudo pendiente", () => {
    const out = buildComplianceEntries(
      [row({ docId: "multa#x#1", tipoDoc: "multa", monto: -500 })],
      HOY,
    );
    expect(out[0]?.monto).toBeUndefined();
    expect(out[0]?.estado).toBe("adeudo");
  });
});

describe("buildComplianceDoc (constructor de captura)", () => {
  const NOW = "2026-06-26T10:00:00.000Z";

  it("singleton: docId = tipoDoc, fuente 'manual', ultimaActualizacion = now", () => {
    const d = buildComplianceDoc(
      "gpa",
      "78",
      { tipoDoc: "seguro", fechaVencimiento: "2026-12-31" },
      NOW,
    );
    expect(d.docId).toBe("seguro");
    expect(d.fuente).toBe("manual");
    expect(d.ultimaActualizacion).toBe(NOW);
    expect(d.fechaVencimiento).toBe("2026-12-31");
  });

  it("multa: docId compuesto con jurisdicción y referencia", () => {
    const d = buildComplianceDoc(
      "gpa",
      "78",
      { tipoDoc: "multa", jurisdiccion: "cdmx", referencia: "A1", monto: 1500 },
      NOW,
    );
    expect(d.docId).toBe("multa#cdmx#A1");
    expect(d.monto).toBe(1500);
  });

  it("multa sin referencia usa now (único) en el docId", () => {
    const d = buildComplianceDoc("gpa", "78", { tipoDoc: "multa", monto: 100 }, NOW);
    expect(d.docId).toBe(`multa#otra#${NOW}`);
  });

  it("trimea identidad y descarta monto negativo", () => {
    const d = buildComplianceDoc(" gpa ", "  78  ", { tipoDoc: "multa", monto: -5 }, NOW);
    expect(d.tenantId).toBe("gpa");
    expect(d.economicoId).toBe("78");
    expect(d.monto).toBeUndefined();
  });
});
