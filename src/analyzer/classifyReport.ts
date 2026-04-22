import type { ReportKind } from "../types";

const stripDiacritics = (s: string) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const EXCLUSIVAS = [
  "llanta de refaccion",
  "carroceria con golpe",
  "# economico - combustible",
];

const SEÑALES = [
  ...EXCLUSIVAS,
  "nombre de quien verifica",
  "nivel de aceite de motor",
  "radiador",
  "kilometraje",
];

/**
 * Match con word boundary — evita que "carroceria con golpe" haga match en
 * "carroceria con golpes o raspaduras" (header del reporte mensual).
 * Escapa metacaracteres regex en signal antes de armar el patrón.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function hasWord(haystack: string, needle: string): boolean {
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegex(needle)}(?:[^\\p{L}\\p{N}]|$)`, "u");
  return re.test(haystack);
}

export function classifyReport(hdrs: string[], filename?: string): ReportKind {
  const fn = stripDiacritics(filename || "");
  if (hasWord(fn, "mensual")) return "mensual";
  if (hasWord(fn, "semanal")) return "semanal";

  const normHdrs = hdrs.map(stripDiacritics);
  const hits = SEÑALES.filter((sig) => normHdrs.some((h) => hasWord(h, sig))).length;
  const tieneExclusiva = EXCLUSIVAS.some((sig) => normHdrs.some((h) => hasWord(h, sig)));
  if (hits >= 3 && tieneExclusiva) return "semanal";

  return "mensual";
}

export function isWeeklyReport(hdrs: string[], filename?: string): boolean {
  return classifyReport(hdrs, filename) === "semanal";
}
