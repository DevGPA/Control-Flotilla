import { describe, expect, it } from "vitest";
import { analyzeRow } from "../src/analyzer/analyzeRow";

describe("analyzeRow", () => {
  it("marca Urgente cuando una llanta está debajo del umbral crítico", () => {
    const r = analyzeRow({ "Nivel TACO de llanta piloto delantera": 3 });
    expect(r.max).toBe("Urgente");
    expect(r.F.some((f) => f.lv === "Urgente" && f.cat === "Llantas")).toBe(true);
    expect(r.minT).toBe(3);
  });

  it("marca Revisar cuando una llanta está entre TCRIT y TWARN", () => {
    const r = analyzeRow({ "Nivel TACO de llanta piloto delantera": 5 });
    expect(r.max).toBe("Revisar");
    expect(r.minT).toBe(5);
  });

  it("no marca nada cuando todas las llantas están por encima de TWARN", () => {
    const r = analyzeRow({
      "Nivel TACO de llanta piloto delantera": 8,
      "Nivel TACO de llanta copiloto delantera": 9,
    });
    expect(r.max).toBe("OK");
  });

  it("agrega Completar cuando la refacción no es funcional y no la mide (legacy col)", () => {
    const r = analyzeRow({
      "Llanta de refaccion funcional": "No",
      "Nivel TACO de llanta REFACCION": 2,
    });
    expect(r.F.some((f) => f.text === "Sin llanta de refacción funcional")).toBe(true);
    expect(r.F.some((f) => f.cat === "Llantas" && f.text.includes("Refacción"))).toBe(false);
  });

  it("Refacción 'No' en col real + 0mm → Completar, no Urgente", () => {
    const r = analyzeRow({
      "Cuenta con llanta de Refacción?": "No",
      "Nivel TACO de llanta REFACCION": 0,
    });
    expect(r.max).toBe("Revisar");
    expect(r.F.some((f) => f.text === "Sin llanta de refacción funcional")).toBe(true);
    expect(r.F.some((f) => f.cat === "Llantas" && f.lv === "Urgente")).toBe(false);
    expect(r.T["Refacción"]).toBeUndefined();
  });

  it("Refacción 'Si' + 0mm → Urgente (caso correcto)", () => {
    const r = analyzeRow({
      "Cuenta con llanta de Refacción?": "Si",
      "Nivel TACO de llanta REFACCION": 0,
    });
    expect(r.max).toBe("Urgente");
    expect(r.F.some((f) => f.cat === "Llantas" && f.text.includes("Refacción"))).toBe(true);
  });

  it("Internas 'No' + 0mm → skip, no Urgente", () => {
    const r = analyzeRow({
      "¿Cuenta con Llanta Piloto trasera INTERNA?": "No",
      "¿Cuenta con Llanta Copiloto trasera INTERNA?": "No",
      "Nivel TACO de llanta piloto trasera INTERNA": 0,
      "Nivel TACO de llanta copiloto trasera INTERNA": 0,
    });
    expect(r.max).toBe("OK");
    expect(r.T["Piloto Trasera Int."]).toBeUndefined();
    expect(r.T["Copiloto Trasera Int."]).toBeUndefined();
  });

  it("detecta tarjeta de circulación vencida (via isBinFail)", () => {
    const r = analyzeRow({ "Tarjeta de circulacion vigente": "Si vencida" });
    expect(r.F.some((f) => f.text.includes("Tarjeta de circulación vencida"))).toBe(true);
    expect(r.max).toBe("Completar");
  });

  it("BIN: 'Con Raspaduras/Golpes' → Completar (cosmético, no descalifica operativa)", () => {
    const r = analyzeRow({ "Carroceria con golpes o raspaduras": "Con Raspaduras/Golpes" });
    expect(r.max).toBe("Completar");
    expect(r.F.some((f) => f.text.includes("Carrocería con daños"))).toBe(true);
  });

  it("BIN: 'Sin Raspaduras/Golpes' → OK (carrocería limpia)", () => {
    const r = analyzeRow({ "Carroceria con golpes o raspaduras": "Sin Raspaduras/Golpes" });
    expect(r.max).toBe("OK");
  });

  it("BIN: 'No lleva' (tapón) → Revisar", () => {
    const r = analyzeRow({ "Tapon de la gasolina": "No lleva" });
    expect(r.max).toBe("Revisar");
    expect(r.F.some((f) => f.text === "Sin tapón de gasolina")).toBe(true);
  });

  it("BIN: 'No aplica' (verificación ambiental) → no dispara", () => {
    const r = analyzeRow({ "Tarjeta/calcamonia de verificacion ambiental vigente": "No aplica" });
    expect(r.max).toBe("OK");
  });

  it("BIN: 'Si vigente' → no dispara", () => {
    const r = analyzeRow({ "Poliza de seguro vigente": "Si vigente" });
    expect(r.max).toBe("OK");
  });

  it("BIN: 'Si vencida' (póliza) → dispara Completar", () => {
    const r = analyzeRow({ "Poliza de seguro vigente": "Si vencida" });
    expect(r.max).toBe("Completar");
    expect(r.F.some((f) => f.text.includes("Póliza de seguro vencida"))).toBe(true);
  });

  it("DOC_KEYS: póliza vencida → cat='Documentos' (no Checklist)", () => {
    const r = analyzeRow({ "Poliza de seguro vigente": "Si vencida" });
    const f = r.F.find((f) => f.text.includes("Póliza"));
    expect(f?.cat).toBe("Documentos");
  });

  it("DOC_KEYS: tarjeta circulación vencida → cat='Documentos'", () => {
    const r = analyzeRow({ "Tarjeta de circulacion vigente": "Si vencida" });
    const f = r.F.find((f) => f.text.includes("Tarjeta"));
    expect(f?.cat).toBe("Documentos");
  });

  it("DOC_KEYS: falla NO-documento (claxon) sigue en cat='Checklist'", () => {
    const r = analyzeRow({ "Bocina del claxon funcionando": "No" });
    const f = r.F.find((f) => f.text.includes("Claxon"));
    expect(f?.cat).toBe("Checklist");
  });

  it("Mantenimiento por fecha: 'Fecha estimada del siguiente servicio' vencida → Urgente", () => {
    const past = new Date(Date.now() - 5 * 86400000);
    const dd = String(past.getDate()).padStart(2, "0");
    const mm = String(past.getMonth() + 1).padStart(2, "0");
    const yyyy = past.getFullYear();
    const r = analyzeRow({ "Fecha estimada del siguiente servicio": `${dd}/${mm}/${yyyy}` });
    expect(r.max).toBe("Urgente");
    const f = r.F.find((f) => f.cat === "Mantenimiento");
    expect(f).toBeDefined();
    expect(f?.text).toContain("VENCIDO");
    expect(f?.lv).toBe("Urgente");
  });

  it("Mantenimiento por fecha: próximo <=30 días → Revisar", () => {
    const soon = new Date(Date.now() + 15 * 86400000);
    const dd = String(soon.getDate()).padStart(2, "0");
    const mm = String(soon.getMonth() + 1).padStart(2, "0");
    const yyyy = soon.getFullYear();
    const r = analyzeRow({ "Fecha estimada del siguiente servicio": `${dd}/${mm}/${yyyy}` });
    const f = r.F.find((f) => f.cat === "Mantenimiento");
    expect(f).toBeDefined();
    expect(f?.lv).toBe("Revisar");
  });

  it("Mantenimiento por fecha: >30 días → no dispara finding", () => {
    const far = new Date(Date.now() + 90 * 86400000);
    const dd = String(far.getDate()).padStart(2, "0");
    const mm = String(far.getMonth() + 1).padStart(2, "0");
    const yyyy = far.getFullYear();
    const r = analyzeRow({ "Fecha estimada del siguiente servicio": `${dd}/${mm}/${yyyy}` });
    expect(r.F.some((f) => f.cat === "Mantenimiento")).toBe(false);
  });

  it("km autoritativo: buffer km > 0 ignora fecha vencida (bug #78)", () => {
    const r = analyzeRow({
      Kilometraje: 30125,
      "Kilometraje del siguiente servicio": 30500,
      "Fecha estimada del siguiente servicio": "04/05/2026", // pasada
    });
    // diff km = 375 → "próximo" (Revisar), NUNCA VENCIDO por fecha stale.
    expect(r.max).toBe("Revisar");
    expect(r.F.some((f) => f.text.includes("VENCIDO"))).toBe(false);
    expect(r.F.some((f) => f.text.includes("próximo") && f.text.includes("km"))).toBe(true);
  });

  it("km vencido (diff <= 0) → Urgente aunque fecha sea futura", () => {
    const r = analyzeRow({
      Kilometraje: 31000,
      "Kilometraje del siguiente servicio": 30500,
      "Fecha estimada del siguiente servicio": "01/12/2099",
    });
    expect(r.max).toBe("Urgente");
    expect(r.F.some((f) => f.text.includes("500km excedidos"))).toBe(true);
  });

  it("km con buffer amplio (>1000) y fecha vencida: no dispara finding", () => {
    // km dice OK (5000km buffer) → fecha-fallback NO debe activarse.
    const r = analyzeRow({
      Kilometraje: 25000,
      "Kilometraje del siguiente servicio": 30000,
      "Fecha estimada del siguiente servicio": "01/01/2026",
    });
    expect(r.F.some((f) => f.cat === "Mantenimiento")).toBe(false);
  });

  it("sin km data, fecha vencida → Urgente (fallback funciona)", () => {
    const r = analyzeRow({
      "Fecha estimada del siguiente servicio": "01/01/2026",
    });
    expect(r.max).toBe("Urgente");
    expect(r.F.some((f) => f.text.includes("días atrás"))).toBe(true);
  });

  it("BIN_LABELS: usa label friendly, no key crudo", () => {
    const r = analyzeRow({ "Espejo retrovisor en buenas condiciones": "No" });
    expect(r.F.some((f) => f.text === "Espejo retrovisor dañado")).toBe(true);
    expect(r.F.some((f) => f.text === "Espejo retrovisor en buenas condiciones")).toBe(false);
  });

  it("marca Revisar cuando nivel de aceite de motor está bajo", () => {
    const r = analyzeRow({ "Nivel de aceite de motor max": "Nivel bajo" });
    expect(r.max).toBe("Revisar");
  });

  it("marca Urgente cuando nivel de líquido de frenos está bajo", () => {
    const r = analyzeRow({ "Nivel de liquido de frenos max": "Nivel bajo" });
    expect(r.max).toBe("Urgente");
  });

  it("marca Revisar cuando radiador está bajo", () => {
    const r = analyzeRow({ "Nivel de liquido de radiador max": "nivel bajo" });
    expect(r.max).toBe("Revisar");
  });

  it("BIN: luces 'No' produce Urgente", () => {
    const r = analyzeRow({ "Luces y cuartos delanteros funcionando": "No" });
    expect(r.max).toBe("Urgente");
  });

  it("BIN cosméticos reclasificados → Completar (no descalifican operativa)", () => {
    const cosmetic = [
      "Espejo retrovisor en buenas condiciones",
      "Molduras completas y en buen estado",
      "Asientos en buen estado",
      "Tapetes completos",
      "Tacometro en buenas condiciones",
      "Luces interiores funcionando",
    ];
    for (const item of cosmetic) {
      const r = analyzeRow({ [item]: "No" });
      expect(r.max, `${item} debería ser Completar`).toBe("Completar");
    }
  });

  it("BIN seguridad real sigue Revisar", () => {
    const safety = [
      "Espejos laterales en buen estado",
      "Cristales en buenas condiciones",
      "Bocina del claxon funcionando",
      "Limpia parabrisas funcionando correctamente",
      "Tapon de la gasolina",
    ];
    for (const item of safety) {
      const r = analyzeRow({ [item]: "No" });
      expect(r.max, `${item} debería ser Revisar`).toBe("Revisar");
    }
  });

  it("maneja fila vacía sin reventar", () => {
    const r = analyzeRow({});
    expect(r.max).toBe("OK");
    expect(r.F).toHaveLength(0);
    expect(r.minT).toBeNull();
  });
});
