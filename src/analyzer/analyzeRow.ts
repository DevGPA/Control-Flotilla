import type { AnalyzeResult, ExcelRow, Finding, RiskLevel } from "../types";
import { BIN, RO, TC, TCRIT, TWARN } from "./constants";

export function analyzeRow(row: ExcelRow): AnalyzeResult {
  const F: Finding[] = [];
  const T: Record<string, number> = {};
  let max: RiskLevel = "OK";
  const bump = (r: RiskLevel) => {
    if ((RO[r] || 0) > (RO[max] || 0)) max = r;
  };

  const tieneRefaccion =
    String(row["Llanta de refaccion funcional"] || "")
      .trim()
      .toLowerCase() !== "no";
  if (!tieneRefaccion) {
    F.push({ cat: "Checklist", text: "Llanta de refaccion funcional", lv: "Completar" });
    bump("Completar");
  }

  for (const [n, c] of Object.entries(TC)) {
    if (n === "Refacción" && !tieneRefaccion) continue;
    const v = parseFloat(String(row[c] ?? ""));
    if (!isNaN(v)) {
      T[n] = v;
      if (v <= TCRIT) {
        F.push({ cat: "Llantas", text: `${n}: ${v}mm — desgaste crítico`, lv: "Urgente" });
        bump("Urgente");
      } else if (v <= TWARN) {
        F.push({ cat: "Llantas", text: `${n}: ${v}mm — revisar desgaste`, lv: "Revisar" });
        bump("Revisar");
      }
    }
  }

  for (const [c, r] of Object.entries(BIN)) {
    if (
      String(row[c] || "")
        .trim()
        .toLowerCase() === "no"
    ) {
      F.push({ cat: "Checklist", text: c, lv: r });
      bump(r);
    }
  }

  if (String(row["Tarjeta de circulacion vigente"] || "").toLowerCase().includes("venci")) {
    F.push({ cat: "Documentos", text: "Tarjeta de circulación VENCIDA", lv: "Completar" });
    bump("Completar");
  }

  for (const c of ["Nivel de aceite de motor max", "Nivel de liquido de frenos max"]) {
    if (String(row[c] || "").toLowerCase().includes("bajo")) {
      F.push({ cat: "Fluidos", text: `${c}: nivel BAJO`, lv: "Urgente" });
      bump("Urgente");
    }
  }

  for (const c of ["Nivel de liquido de radiador max", "Nivel de aceite de direccion max"]) {
    if (String(row[c] || "").toLowerCase().includes("bajo")) {
      F.push({ cat: "Fluidos", text: `${c}: nivel bajo`, lv: "Revisar" });
      bump("Revisar");
    }
  }

  const tv = Object.values(T);
  return { max, F, T, minT: tv.length ? Math.min(...tv) : null };
}
