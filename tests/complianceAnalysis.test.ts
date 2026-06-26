import { describe, expect, it } from "vitest";
import {
  complianceStatus,
  toComplianceEntry,
  diasEntre,
  resumirUnidad,
  resumirFlota,
  mergeFlotaConCatalogo,
  engomadoDePlaca,
  diaHoyNoCirculaForanea,
  ultimaCifraPlaca,
  DIAS_POR_VENCER,
} from "../src/compliance/complianceAnalysis";
import type { ComplianceDoc, ComplianceEntry, ComplianceTipoDoc } from "../src/compliance/types";

const HOY = "2026-06-26";

/** Documento mínimo de cumplimiento para pruebas. */
function doc(tipoDoc: ComplianceTipoDoc, over: Partial<ComplianceDoc> = {}): ComplianceDoc {
  return {
    tenantId: "gpa",
    economicoId: over.economicoId ?? "78",
    docId: over.docId ?? tipoDoc,
    tipoDoc,
    ...over,
  };
}

describe("diasEntre", () => {
  it("cuenta días entre fechas ISO", () => {
    expect(diasEntre("2026-06-26", "2026-06-26")).toBe(0);
    expect(diasEntre("2026-06-26", "2026-06-30")).toBe(4);
    expect(diasEntre("2026-06-26", "2026-06-20")).toBe(-6);
  });
  it("cruza fin de mes/año sin error", () => {
    expect(diasEntre("2025-12-31", "2026-01-01")).toBe(1);
  });
  it("devuelve null si la fecha es inválida", () => {
    expect(diasEntre("no-fecha", "2026-06-26")).toBeNull();
  });
});

describe("complianceStatus (documentos con fecha)", () => {
  it("vencido cuando la fecha ya pasó", () => {
    const r = complianceStatus(doc("seguro", { fechaVencimiento: "2026-06-01" }), HOY);
    expect(r.estado).toBe("vencido");
    expect(r.diasParaVencer).toBeLessThan(0);
  });
  it("porVencer dentro de la ventana (límite inclusivo)", () => {
    const enLimite = complianceStatus(
      doc("verificacion", { fechaVencimiento: "2026-07-26" }), // +30
      HOY,
    );
    expect(enLimite.estado).toBe("porVencer");
    expect(enLimite.diasParaVencer).toBe(DIAS_POR_VENCER);
  });
  it("vigente fuera de la ventana", () => {
    const r = complianceStatus(doc("refrendo", { fechaVencimiento: "2026-12-31" }), HOY);
    expect(r.estado).toBe("vigente");
  });
  it("desconocido si no hay fecha de vencimiento", () => {
    const r = complianceStatus(doc("tarjetaCirculacion"), HOY);
    expect(r.estado).toBe("desconocido");
    expect(r.diasParaVencer).toBeNull();
  });
  it("respeta una ventana personalizada", () => {
    const d = doc("seguro", { fechaVencimiento: "2026-07-10" }); // +14
    expect(complianceStatus(d, HOY, 7).estado).toBe("vigente");
    expect(complianceStatus(d, HOY, 30).estado).toBe("porVencer");
  });
});

describe("complianceStatus (multas)", () => {
  it("adeudo cuando hay monto pendiente", () => {
    expect(complianceStatus(doc("multa", { monto: 1500 }), HOY).estado).toBe("adeudo");
  });
  it("adeudo aunque el monto sea desconocido (registrada = pendiente)", () => {
    expect(complianceStatus(doc("multa"), HOY).estado).toBe("adeudo");
  });
  it("vigente (saldada) cuando el monto es exactamente 0", () => {
    expect(complianceStatus(doc("multa", { monto: 0 }), HOY).estado).toBe("vigente");
  });
});

describe("toComplianceEntry", () => {
  it("adjunta estado y diasParaVencer al doc", () => {
    const e = toComplianceEntry(doc("seguro", { fechaVencimiento: "2026-06-01" }), HOY);
    expect(e.estado).toBe("vencido");
    expect(e.tipoDoc).toBe("seguro");
    expect(e.diasParaVencer).toBeLessThan(0);
  });
});

describe("resumirUnidad", () => {
  const entries: ComplianceEntry[] = [
    toComplianceEntry(doc("seguro", { fechaVencimiento: "2026-06-01" }), HOY), // vencido
    toComplianceEntry(doc("verificacion", { fechaVencimiento: "2026-07-10" }), HOY), // porVencer
    toComplianceEntry(doc("refrendo", { fechaVencimiento: "2026-12-31" }), HOY), // vigente
    toComplianceEntry(doc("multa", { docId: "multa#cdmx#A1", monto: 800 }), HOY), // adeudo
    toComplianceEntry(doc("multa", { docId: "multa#edomex#B2", monto: 1200 }), HOY), // adeudo
  ];
  const r = resumirUnidad("78", entries);

  it("cuenta vencidos, por vencer y adeudos", () => {
    expect(r.vencidos).toBe(1);
    expect(r.porVencer).toBe(1);
    expect(r.adeudos).toBe(2);
    expect(r.montoAdeudo).toBe(2000);
  });
  it("el peor estado es 'vencido' (gana a adeudo para etiquetar)", () => {
    expect(r.estado).toBe("vencido");
  });
  it("una unidad sin documentos queda 'desconocido'", () => {
    expect(resumirUnidad("99", []).estado).toBe("desconocido");
  });
  it("deriva sucursal/placa del primer doc que las tenga", () => {
    const docs: ComplianceEntry[] = [
      toComplianceEntry(doc("seguro"), HOY),
      {
        ...toComplianceEntry(doc("multa", { docId: "m1" }), HOY),
        sucursal: "Monterrey",
        placa: "ABC-12-30",
      },
    ];
    const r = resumirUnidad("78", docs);
    expect(r.sucursal).toBe("Monterrey");
    expect(r.placa).toBe("ABC-12-30");
  });
});

describe("resumirFlota", () => {
  it("agrupa por economicoId", () => {
    const entries: ComplianceEntry[] = [
      toComplianceEntry(doc("seguro", { economicoId: "10", fechaVencimiento: "2026-06-01" }), HOY),
      toComplianceEntry(doc("seguro", { economicoId: "20", fechaVencimiento: "2026-12-31" }), HOY),
      toComplianceEntry(doc("multa", { economicoId: "10", docId: "multa#x#1", monto: 100 }), HOY),
    ];
    const flota = resumirFlota(entries);
    expect(flota.size).toBe(2);
    expect(flota.get("10")?.estado).toBe("vencido");
    expect(flota.get("10")?.docs).toHaveLength(2);
    expect(flota.get("20")?.estado).toBe("vigente");
  });
});

describe("mergeFlotaConCatalogo", () => {
  const docDe = (eco: string, fechaVencimiento: string) =>
    toComplianceEntry(doc("seguro", { economicoId: eco, fechaVencimiento }), HOY);

  it("incluye unidades del catálogo SIN docs como 'desconocido'", () => {
    const resumen = resumirFlota([docDe("10", "2026-06-01")]);
    const catalogo = [
      { eco: "10", sucursal: "Guadalajara", placa: "JAB-10-05" },
      { eco: "20", sucursal: "Monterrey", placa: "ABC-20-07" },
    ];
    const merged = mergeFlotaConCatalogo(resumen, catalogo);
    expect(merged).toHaveLength(2);
    expect(merged.find((u) => u.eco === "10")?.estado).toBe("vencido");
    const u20 = merged.find((u) => u.eco === "20");
    expect(u20?.estado).toBe("desconocido");
    expect(u20?.sucursal).toBe("Monterrey");
    expect(u20?.docs).toHaveLength(0);
  });

  it("rellena sucursal/placa desde el catálogo si el resumen no las trae", () => {
    const resumen = resumirFlota([docDe("10", "2026-12-31")]); // sin sucursal/placa en el doc
    const merged = mergeFlotaConCatalogo(resumen, [
      { eco: "10", sucursal: "Cabos", placa: "BCS-1-1" },
    ]);
    expect(merged[0]?.sucursal).toBe("Cabos");
    expect(merged[0]?.placa).toBe("BCS-1-1");
  });

  it("conserva unidades con docs ausentes del catálogo (huérfanas)", () => {
    const resumen = resumirFlota([docDe("99", "2026-06-01")]);
    const merged = mergeFlotaConCatalogo(resumen, []);
    expect(merged.map((u) => u.eco)).toEqual(["99"]);
  });

  it("no duplica si el catálogo trae el mismo eco dos veces", () => {
    const merged = mergeFlotaConCatalogo(new Map(), [{ eco: "10" }, { eco: "10" }]);
    expect(merged).toHaveLength(1);
  });
});

describe("helpers de placa (engomado / Hoy No Circula)", () => {
  it("extrae la última cifra de la placa", () => {
    expect(ultimaCifraPlaca("JAB-12-34")).toBe(4);
    expect(ultimaCifraPlaca("ABC1230")).toBe(0);
    expect(ultimaCifraPlaca("SIN-LETRAS")).toBeNull();
    expect(ultimaCifraPlaca(null)).toBeNull();
  });
  it("mapea engomado por terminación", () => {
    expect(engomadoDePlaca("XXX-00-05")).toBe("amarillo"); // 5
    expect(engomadoDePlaca("XXX-00-09")).toBe("azul"); // 9
    expect(engomadoDePlaca("XXX-00-01")).toBe("verde"); // 1
  });
  it("mapea día de Hoy No Circula por terminación", () => {
    expect(diaHoyNoCirculaForanea("XXX-00-06")).toBe("lunes"); // 6
    expect(diaHoyNoCirculaForanea("XXX-00-03")).toBe("miercoles"); // 3
    expect(diaHoyNoCirculaForanea("XXX-00-00")).toBe("viernes"); // 0
  });
});
