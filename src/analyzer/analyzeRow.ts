import type { AnalyzeResult, ExcelRow, Finding, RiskLevel } from "../types";
import { BIN, BIN_LABELS, RO, TC, TCRIT, TWARN, isBinFail } from "./constants";

// Keys de BIN que son documentos regulatorios, no checklist físico.
// Antes todas las fallas BIN iban a cat:"Checklist" inflando ese bucket e
// impidiendo ver documentos vencidos por separado en el analytics panel.
const DOC_KEYS = new Set<string>([
  'Licencia de "chofer" acorde a vehiculo vigente',
  "Tarjeta de circulacion vigente",
  "Poliza de seguro vigente",
  "Calcomonia de refrendo vehicular",
  "Tarjeta/calcamonia de verificacion ambiental vigente",
  "Calcamonia de ultimo servicio (en parabrisas)",
]);

// Parser inline compat con legacy parseSvcDate (Control de flotilla.html:1505).
// Formatos: DD/MM/YYYY o YYYY-MM-DD. null si no parseable.
function parseSvcDate(s: unknown): Date | null {
  const str = String(s ?? "").trim();
  if (!str || str === "—") return null;
  const m1 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  // m1 regex has 3 capture groups — guaranteed present when match succeeds
  if (m1) return new Date(+m1[3]!, +m1[2]! - 1, +m1[1]!);
  const m2 = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  // m2 regex has 3 capture groups — guaranteed present when match succeeds
  if (m2) return new Date(+m2[1]!, +m2[2]! - 1, +m2[3]!);
  return null;
}

export function analyzeRow(row: ExcelRow): AnalyzeResult {
  const F: Finding[] = [];
  const T: Record<string, number> = {};
  let max: RiskLevel = "OK";
  const bump = (r: RiskLevel) => {
    if ((RO[r] || 0) > (RO[max] || 0)) max = r;
  };

  // Refacción gating: Excel real usa "Cuenta con llanta de Refacción?" (col AU).
  // Fallback al nombre legacy para compat con exports viejos.
  const refRaw =
    row["Cuenta con llanta de Refacción?"] ?? row["Llanta de refaccion funcional"] ?? "";
  const tieneRefaccion = String(refRaw).trim().toLowerCase() !== "no";
  if (!tieneRefaccion) {
    F.push({ cat: "Checklist", text: "Sin llanta de refacción funcional", lv: "Revisar" });
    bump("Revisar");
  }

  // Gating llantas internas: si "¿Cuenta con...?" === "No" → skip.
  const tieneIntPiloto =
    String(row["¿Cuenta con Llanta Piloto trasera INTERNA?"] ?? "")
      .trim()
      .toLowerCase() !== "no";
  const tieneIntCopiloto =
    String(row["¿Cuenta con Llanta Copiloto trasera INTERNA?"] ?? "")
      .trim()
      .toLowerCase() !== "no";

  for (const [n, c] of Object.entries(TC)) {
    if (n === "Refacción" && !tieneRefaccion) continue;
    if (n === "Piloto Trasera Int." && !tieneIntPiloto) continue;
    if (n === "Copiloto Trasera Int." && !tieneIntCopiloto) continue;
    const raw = parseFloat(String(row[c] ?? ""));
    if (!isNaN(raw)) {
      // TACO de llanta: valores 0<v<1 vienen capturados en cm (0.4 cm = 4 mm) →
      // ×10. El 0 (llanta lisa) y los ≥1 quedan igual. Evita falsos críticos.
      const v = raw > 0 && raw < 1 ? Math.round(raw * 100) / 10 : raw;
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
      const cat = DOC_KEYS.has(c) ? "Documentos" : "Checklist";
      F.push({ cat, text: BIN_LABELS[c] || c, lv: r });
      bump(r);
    }
  }

  // Tarjeta circulación vencida ya capturada por isBinFail (incluye "vencid").
  // Frenos bajo = Urgente (seguridad crítica). Aceite motor bajo = Revisar (no inmediato).
  for (const c of ["Nivel de liquido de frenos max"]) {
    if (
      String(row[c] || "")
        .toLowerCase()
        .includes("bajo")
    ) {
      F.push({ cat: "Fluidos", text: `${c}: nivel BAJO`, lv: "Urgente" });
      bump("Urgente");
    }
  }

  for (const c of [
    "Nivel de aceite de motor max",
    "Nivel de liquido de radiador max",
    "Nivel de aceite de direccion max",
  ]) {
    if (
      String(row[c] || "")
        .toLowerCase()
        .includes("bajo")
    ) {
      F.push({ cat: "Fluidos", text: `${c}: nivel bajo`, lv: "Revisar" });
      bump("Revisar");
    }
  }

  // 🔮 Predictivo: km autoritativo cuando hay datos. Fecha = fallback.
  // La fecha "estimada del siguiente servicio" es proyección histórica que puede
  // quedar stale si la unidad rueda menos de lo esperado. El km es la realidad —
  // si todavía hay buffer, el servicio NO está vencido aunque la fecha-estimación
  // diga lo contrario. Bug #78: km buffer 375 + fecha stale → no debe ser Urgente.
  const kmActual = parseFloat(String(row["Kilometraje"] ?? "0"));
  const kmSiguiente = parseFloat(String(row["Kilometraje del siguiente servicio"] ?? "0"));
  const hasKmData = kmActual > 0 && kmSiguiente > 0;

  if (hasKmData) {
    const diff = kmSiguiente - kmActual;
    if (diff <= 0) {
      F.push({
        cat: "Mantenimiento",
        text: `Servicio VENCIDO (${Math.abs(Math.round(diff))}km excedidos)`,
        lv: "Urgente",
      });
      bump("Urgente");
    } else if (diff <= 1000) {
      F.push({
        cat: "Mantenimiento",
        text: `Servicio próximo (${Math.round(diff)}km restantes)`,
        lv: "Revisar",
      });
      bump("Revisar");
    }
  } else {
    // Fallback fecha cuando no hay datos de km. Columna MoreApp:
    // "Fecha estimada del siguiente servicio". Ventana 30 días = hero KPI #kv_svc.
    const svcDate = parseSvcDate(row["Fecha estimada del siguiente servicio"]);
    if (svcDate) {
      const today0 = new Date();
      today0.setHours(0, 0, 0, 0);
      const msDay = 86400000;
      const diffDays = Math.floor((svcDate.getTime() - today0.getTime()) / msDay);
      if (diffDays < 0) {
        F.push({
          cat: "Mantenimiento",
          text: `Servicio VENCIDO (${Math.abs(diffDays)} días atrás)`,
          lv: "Urgente",
        });
        bump("Urgente");
      } else if (diffDays <= 30) {
        F.push({
          cat: "Mantenimiento",
          text: `Servicio próximo (${diffDays} días)`,
          lv: "Revisar",
        });
        bump("Revisar");
      }
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
