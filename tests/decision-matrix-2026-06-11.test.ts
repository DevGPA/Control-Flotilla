// MATRIZ DE DECISIONES DE NEGOCIO — Navares, 2026-06-11.
// Unificación de los dos motores de riesgo (audit 2026-06-10: 13 inconsistencias).
// Este archivo es el CONTRATO ejecutable de esas decisiones:
//   A1: solo 2 vitales (aceite + radiador) votan el estatus semanal global.
//   B:  aceite de motor bajo = Urgente (agrupado con frenos).
//   C2: servicio VENCIDO = Revisar; PRÓXIMO A VENCER (≤1000km/≤30d) = Completar.
//   D:  sin llanta de refacción = Completar (acción de reposición).
//   E:  espejo retrovisor / luces interiores / tacómetro = Revisar (afectan
//       manejo); golpes carrocería / molduras / asientos / tapetes = Completar.
//   F:  documentos regulatorios en categoría "Documentos" separada.
// Además: PARIDAD de la tabla BIN entre el motor HTML legacy y el TS — si
// alguien cambia un nivel en un solo motor, este test truena.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeRow } from "../src/analyzer/analyzeRow";
import { calcEstatusSemanal } from "../src/analyzer/risk";
import { BIN } from "../src/analyzer/constants";

describe("Paridad BIN: motor HTML legacy ↔ motor TS (candado anti-drift)", () => {
  it("las tablas BIN de ambos motores son idénticas (keys y niveles)", () => {
    const html = readFileSync("Control de flotilla.html", "utf8");
    const m = html.match(/const BIN=\{([\s\S]*?)\};/);
    expect(m, "no se encontró `const BIN={...}` en el HTML").toBeTruthy();
    // Parsea las entradas "key":"Nivel" del objeto literal (ignora comentarios).
    const htmlBin: Record<string, string> = {};
    for (const entry of m![1]!.matchAll(
      /(['"])((?:\\.|(?!\1).)*)\1\s*:\s*"(Urgente|Revisar|Completar|OK)"/g,
    )) {
      htmlBin[entry[2]!.replace(/\\"/g, '"')] = entry[3]!;
    }
    expect(
      Object.keys(htmlBin).length,
      "el parser no extrajo entradas del BIN del HTML",
    ).toBeGreaterThan(20);
    expect(htmlBin).toEqual(BIN);
  });
});

describe("Decisión A1 — solo aceite + radiador son vitales", () => {
  it("aceite/radiador Urgente escalan; carrocería/llanta NO", () => {
    expect(calcEstatusSemanal("Urgente", "OK", "OK", "OK")).toBe("Urgente");
    expect(calcEstatusSemanal("OK", "Urgente", "OK", "OK")).toBe("Urgente");
    expect(calcEstatusSemanal("OK", "OK", "Urgente", "Urgente")).toBe("OK");
  });
});

describe("Decisión B — aceite de motor bajo = Urgente", () => {
  it("aceite bajo y frenos bajo son Urgente; radiador/dirección bajos son Revisar", () => {
    expect(analyzeRow({ "Nivel de aceite de motor max": "bajo" }).max).toBe("Urgente");
    expect(analyzeRow({ "Nivel de liquido de frenos max": "bajo" }).max).toBe("Urgente");
    expect(analyzeRow({ "Nivel de liquido de radiador max": "bajo" }).max).toBe("Revisar");
    expect(analyzeRow({ "Nivel de aceite de direccion max": "bajo" }).max).toBe("Revisar");
  });
});

describe("Decisión C2 — servicio: vencido=Revisar, próximo a vencer=Completar", () => {
  it("km vencido → Revisar con texto VENCIDO", () => {
    const r = analyzeRow({ Kilometraje: 31000, "Kilometraje del siguiente servicio": 30500 });
    expect(r.max).toBe("Revisar");
    expect(r.F[0]!.text).toContain("VENCIDO");
    expect(r.F[0]!.key).toBe("Mant:Servicio");
  });
  it("km próximo (≤1000) → Completar con texto 'próximo a vencer'", () => {
    const r = analyzeRow({ Kilometraje: 30000, "Kilometraje del siguiente servicio": 30500 });
    expect(r.max).toBe("Completar");
    expect(r.F[0]!.text).toContain("próximo a vencer");
    expect(r.F[0]!.key).toBe("Mant:Servicio");
  });
  it("nunca produce Urgente por servicio (reservado a fallas reales)", () => {
    const vencidisimo = analyzeRow({ Kilometraje: 99999, "Kilometraje del siguiente servicio": 1 });
    expect(vencidisimo.max).toBe("Revisar");
  });
});

describe("Decisión D — sin refacción = Completar", () => {
  it("'No' en la columna real produce Completar", () => {
    const r = analyzeRow({ "Cuenta con llanta de Refacción?": "No" });
    expect(r.max).toBe("Completar");
    expect(r.F[0]!.key).toBe("Chk:Refaccion");
  });
});

describe("Decisión E — división por seguridad de los 7 ítems", () => {
  it.each([
    ["Espejo retrovisor en buenas condiciones", "Revisar"],
    ["Luces interiores funcionando", "Revisar"],
    ["Tacometro en buenas condiciones", "Revisar"],
    ["Carroceria con golpes o raspaduras", "Completar"],
    ["Molduras completas y en buen estado", "Completar"],
    ["Asientos en buen estado", "Completar"],
    ["Tapetes completos", "Completar"],
  ] as const)("'%s' → %s", (col, esperado) => {
    expect(BIN[col]).toBe(esperado);
    expect(analyzeRow({ [col]: "No" }).max).toBe(esperado);
  });
});

describe("Decisión F — documentos en categoría separada", () => {
  it("los 6 documentos regulatorios salen con cat='Documentos'", () => {
    const docs = [
      'Licencia de "chofer" acorde a vehiculo vigente',
      "Tarjeta de circulacion vigente",
      "Poliza de seguro vigente",
      "Calcomonia de refrendo vehicular",
      "Tarjeta/calcamonia de verificacion ambiental vigente",
      "Calcamonia de ultimo servicio (en parabrisas)",
    ];
    for (const col of docs) {
      const r = analyzeRow({ [col]: "No" });
      expect(r.F[0]!.cat, col).toBe("Documentos");
    }
  });
  it("un BIN físico sigue en cat='Checklist'", () => {
    expect(analyzeRow({ "Tapon de la gasolina": "No" }).F[0]!.cat).toBe("Checklist");
  });
});
