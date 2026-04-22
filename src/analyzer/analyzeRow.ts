import type { AnalyzeResult, ExcelRow, Finding, RiskLevel } from "../types";
import { BIN, BIN_LABELS, RO, TC, TCRIT, TWARN, isBinFail } from "./constants";

export function analyzeRow(row: ExcelRow): AnalyzeResult {
  const F: Finding[] = [];
  const T: Record<string, number> = {};
  let max: RiskLevel = "OK";
  const bump = (r: RiskLevel) => {
    if ((RO[r] || 0) > (RO[max] || 0)) max = r;
  };

  // Refacción gating: Excel real usa "Cuenta con llanta de Refacción?" (col AU).
  // Fallback al nombre legacy para compat con exports viejos.
  const refRaw = row["Cuenta con llanta de Refacción?"] ?? row["Llanta de refaccion funcional"] ?? "";
  const tieneRefaccion = String(refRaw).trim().toLowerCase() !== "no";
  if (!tieneRefaccion) {
    F.push({ cat: "Checklist", text: "Sin llanta de refacción funcional", lv: "Revisar" });
    bump("Revisar");
  }

  // Gating llantas internas: si "¿Cuenta con...?" === "No" → skip.
  const tieneIntPiloto =
    String(row["¿Cuenta con Llanta Piloto trasera INTERNA?"] ?? "").trim().toLowerCase() !== "no";
  const tieneIntCopiloto =
    String(row["¿Cuenta con Llanta Copiloto trasera INTERNA?"] ?? "").trim().toLowerCase() !== "no";

  for (const [n, c] of Object.entries(TC)) {
    if (n === "Refacción" && !tieneRefaccion) continue;
    if (n === "Piloto Trasera Int." && !tieneIntPiloto) continue;
    if (n === "Copiloto Trasera Int." && !tieneIntCopiloto) continue;
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
    if (isBinFail(row[c])) {
      F.push({ cat: "Checklist", text: BIN_LABELS[c] || c, lv: r });
      bump(r);
    }
  }

  // Tarjeta circulación vencida ya capturada por isBinFail (incluye "vencid").
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
  const validationErrors: string[] = [];
  if (
    !row["# Economico - id"] &&
    !row["# Economico - PLACAS"] &&
    !row["No. de unidad / ECO"] &&
    !row["Número de unidad"]
  ) {
    validationErrors.push("Falta identificador de unidad (ECO/Placas)");
  }
  if (tv.length < 4) {
    validationErrors.push(`Datos de llantas incompletos (${tv.length}/4)`);
  }

  return { max, F, T, minT: tv.length ? Math.min(...tv) : null, validationErrors };
}
