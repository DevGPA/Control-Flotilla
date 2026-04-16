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

export function classifyReport(hdrs: string[], filename?: string): ReportKind {
  const fn = stripDiacritics(filename || "");
  if (fn.includes("mensual")) return "mensual";
  if (fn.includes("semanal")) return "semanal";

  const normHdrs = hdrs.map(stripDiacritics);
  const hits = SEÑALES.filter((sig) => normHdrs.some((h) => h.includes(sig))).length;
  const tieneExclusiva = EXCLUSIVAS.some((sig) => normHdrs.some((h) => h.includes(sig)));
  if (hits >= 3 && tieneExclusiva) return "semanal";

  return "mensual";
}

export function isWeeklyReport(hdrs: string[], filename?: string): boolean {
  return classifyReport(hdrs, filename) === "semanal";
}
