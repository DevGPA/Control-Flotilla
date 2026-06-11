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
  if (s instanceof Date) return Number.isNaN(s.getTime()) ? null : s;
  // Serial Excel (días desde 1899-12-30). Con cellDates:false las fechas llegan
  // como serial numérico; el rango ~20000–90000 cubre 1954–2146 y evita
  // interpretar números pequeños espurios como fechas absurdas. Antes parseSvcDate
  // solo reconocía strings DMY/ISO → un serial/Date desactivaba el fallback de fecha.
  const asSerial = (n: number): Date | null =>
    Number.isFinite(n) && n >= 20000 && n <= 90000
      ? new Date(Date.UTC(1899, 11, 30) + n * 86400000)
      : null;
  if (typeof s === "number") return asSerial(s);
  const str = String(s ?? "").trim();
  if (!str || str === "—") return null;
  if (/^\d{5}(\.\d+)?$/.test(str)) return asSerial(parseFloat(str));
  const m1 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  // m1 regex has 3 capture groups — guaranteed present when match succeeds
  if (m1) return new Date(+m1[3]!, +m1[2]! - 1, +m1[1]!);
  const m2 = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  // m2 regex has 3 capture groups — guaranteed present when match succeeds
  if (m2) return new Date(+m2[1]!, +m2[2]! - 1, +m2[3]!);
  return null;
}

// Detecta respuestas negativas compuestas además del literal "no": "No cuenta",
// "No tiene", "Ninguna/o", "Sin refacción". Antes el gating usaba `!== "no"`
// estricto, por lo que cualquier negativa con texto adicional se trataba como
// afirmativa y NO disparaba el hallazgo de refacción/llanta faltante.
// Cadena vacía / dato ausente NO cuenta como negativa (se asume presente).
function esRespuestaNegativa(raw: unknown): boolean {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!v) return false;
  return (
    v === "no" ||
    v.startsWith("no ") ||
    v === "ninguna" ||
    v === "ninguno" ||
    v === "ningun" ||
    v.startsWith("sin ")
  );
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
  const tieneRefaccion = !esRespuestaNegativa(refRaw);
  if (!tieneRefaccion) {
    // Decisión 2026-06-11 (D): Completar — es una acción de reposición (falta
    // que completar), no una falla operativa. En sync con el motor HTML.
    F.push({
      cat: "Checklist",
      key: "Chk:Refaccion",
      text: "Sin llanta de refacción funcional",
      lv: "Completar",
    });
    bump("Completar");
  }

  // Gating llantas internas: si "¿Cuenta con...?" es negativa → skip.
  const tieneIntPiloto = !esRespuestaNegativa(row["¿Cuenta con Llanta Piloto trasera INTERNA?"]);
  const tieneIntCopiloto = !esRespuestaNegativa(
    row["¿Cuenta con Llanta Copiloto trasera INTERNA?"],
  );

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
        F.push({
          cat: "Llantas",
          key: `Llanta:${n}`,
          text: `${n}: ${v}mm — desgaste crítico`,
          lv: "Urgente",
        });
        bump("Urgente");
      } else if (v <= TWARN) {
        F.push({
          cat: "Llantas",
          key: `Llanta:${n}`,
          text: `${n}: ${v}mm — revisar desgaste`,
          lv: "Revisar",
        });
        bump("Revisar");
      }
    }
  }

  for (const [c, r] of Object.entries(BIN)) {
    if (isBinFail(row[c])) {
      const cat = DOC_KEYS.has(c) ? "Documentos" : "Checklist";
      // key = columna Excel (estable); BIN_LABELS es solo display (editable).
      F.push({ cat, key: `Bin:${c}`, text: BIN_LABELS[c] || c, lv: r });
      bump(r);
    }
  }

  // Tarjeta circulación vencida ya capturada por isBinFail (incluye "vencid").
  // Decisión 2026-06-11 (B): frenos Y ACEITE DE MOTOR bajos = Urgente (riesgo de
  // daño de motor en operación de reparto; criterio conservador). En sync con el
  // motor HTML, que siempre los agrupó así.
  for (const c of ["Nivel de liquido de frenos max", "Nivel de aceite de motor max"]) {
    if (
      String(row[c] || "")
        .toLowerCase()
        .includes("bajo")
    ) {
      F.push({ cat: "Fluidos", key: `Fluido:${c}`, text: `${c}: nivel BAJO`, lv: "Urgente" });
      bump("Urgente");
    }
  }

  for (const c of ["Nivel de liquido de radiador max", "Nivel de aceite de direccion max"]) {
    if (
      String(row[c] || "")
        .toLowerCase()
        .includes("bajo")
    ) {
      F.push({ cat: "Fluidos", key: `Fluido:${c}`, text: `${c}: nivel bajo`, lv: "Revisar" });
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
    // Decisión 2026-06-11 (C2): servicio VENCIDO = Revisar (planeación urgente,
    // pero la unidad sigue operando — "Urgente" se reserva para fallas reales);
    // PRÓXIMO A VENCER (≤1000km / ≤30 días) = Completar (agendar taller).
    if (diff <= 0) {
      F.push({
        cat: "Mantenimiento",
        // Una sola key para vencido/próximo: el texto cambia en cada re-upload
        // (km/días relativos) y la transición de nivel no debe huerfanar la marca.
        key: "Mant:Servicio",
        text: `Servicio VENCIDO (${Math.abs(Math.round(diff))}km excedidos)`,
        lv: "Revisar",
      });
      bump("Revisar");
    } else if (diff <= 1000) {
      F.push({
        cat: "Mantenimiento",
        key: "Mant:Servicio",
        text: `Servicio próximo a vencer (${Math.round(diff)}km restantes)`,
        lv: "Completar",
      });
      bump("Completar");
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
          key: "Mant:Servicio",
          text: `Servicio VENCIDO (${Math.abs(diffDays)} días atrás)`,
          lv: "Revisar",
        });
        bump("Revisar");
      } else if (diffDays <= 30) {
        F.push({
          cat: "Mantenimiento",
          key: "Mant:Servicio",
          text: `Servicio próximo a vencer (${diffDays} días)`,
          lv: "Completar",
        });
        bump("Completar");
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
