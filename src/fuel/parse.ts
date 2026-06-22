/**
 * Parsers puros para el ingest de los formularios de combustible de MoreApp.
 *
 * Viven en src/ (no en el handler de la Lambda) para ser testeables con vitest
 * — el handler importa `analyzeRow`/`types` desde src/, así que reusa este módulo
 * igual. Sin dependencias de `$amplify/env`, DOM ni red: funciones puras.
 *
 * Estructura real de los lookups de MoreApp (verificada en S3, 2026-06-22):
 *   - Solicitud Gasolina ROF v2 → lookup en `answers.economico`
 *   - Carga Gasolina ROF v2     → lookup en `answers.search`
 *   ambos shape: {id, PLACAS, SUBMARCA, SUCURSAL, TANQUE, RESPONSABLE, combustible, precio, PRODUCTO}
 *   responsable en `nombreDelChoferQueRegistraDatos` (solicitud) o `responsableDeCarga` (carga),
 *   shape {id, RESPONSABLE, MAIL}.
 */

/** trim + sin acentos + minúsculas. Espejo de `norm()` del handler del webhook. */
export function normText(s: unknown): string {
  return String(s ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Catálogo de sucursales canónicas (nombres completos como viven en los datos).
// Resuelve "Cancún" / "CANCUN" / "Cancun " (espacio invisible, dato sucio conocido)
// → "Cancun". Si la entrada no está en el catálogo, se devuelve el crudo (trim).
const SUCURSAL_CANON: Record<string, string> = {
  cabos: "Cabos",
  cancun: "Cancun",
  cedis: "Cedis",
  "ciudad de mexico": "Ciudad de Mexico",
  guadalajara: "Guadalajara",
  monterrey: "Monterrey",
  vallarta: "Vallarta",
};

/** Normaliza la sucursal contra el catálogo canónico. "" si vacío. */
export function normSucursal(raw: unknown): string {
  const v = normText(raw);
  if (!v) return "";
  return SUCURSAL_CANON[v] ?? String(raw ?? "").trim();
}

/**
 * Parsea un número de MoreApp tolerando símbolo de moneda y separadores de miles.
 * MoreApp emite formato US: "$3,599.96" (coma=miles, punto=decimal), "$27.00",
 * o un number nativo (133.332). Devuelve undefined si no hay número válido.
 */
export function parseNum(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const s = String(v).replace(/[^0-9.,-]/g, ""); // quita $, espacios, letras
  if (!s || s === "-" || s === "." || s === ",") return undefined;
  const clean = s.replace(/,/g, ""); // quita separador de miles
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : undefined;
}

/** Kilometraje/horómetro como entero (redondea). undefined si no hay número. */
export function parseKm(v: unknown): number | undefined {
  const n = parseNum(v);
  return n === undefined ? undefined : Math.round(n);
}

type AnswerObj = Record<string, unknown>;

/** Devuelve el objeto de lookup de unidad: `economico` (solicitud) o `search` (carga). */
export function pickEco(answers: AnswerObj): AnswerObj {
  const e = answers?.economico ?? answers?.search;
  return e && typeof e === "object" ? (e as AnswerObj) : {};
}

/** Extrae el RESPONSABLE del registrador (solicitud) o del responsable de carga. */
export function pickResponsable(answers: AnswerObj): string {
  const r = answers?.nombreDelChoferQueRegistraDatos ?? answers?.responsableDeCarga;
  if (r && typeof r === "object") {
    return String((r as AnswerObj).RESPONSABLE ?? "").trim();
  }
  return String(r ?? "").trim();
}

/**
 * ID de unidad (identidad PRINCIPAL del módulo). Usa `eco.id`; si falta, cae a
 * `PLACA:<placas>` para no perder el registro (se marca `economicoIdFaltante`).
 * "" solo si no hay ni id ni placa.
 */
export function pickEconomicoId(eco: AnswerObj): { economicoId: string; faltante: boolean } {
  const id = String(eco?.id ?? "").trim();
  if (id) return { economicoId: id, faltante: false };
  const placa = String(eco?.PLACAS ?? "").trim();
  if (placa) return { economicoId: `PLACA:${placa}`, faltante: true };
  return { economicoId: "", faltante: true };
}
