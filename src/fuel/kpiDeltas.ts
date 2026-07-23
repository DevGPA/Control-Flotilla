/**
 * Deltas de KPI (spec Producto Vivo §1.4): comparan el rango filtrado contra el
 * rango inmediato anterior del mismo largo. Capa PURA. Semántica por-KPI:
 * gasto = "costo" (subir es malo → rojo); litros/cargas = "neutral".
 */
import type { FuelEntry } from "./types";
import { montoEfectivo } from "./fuelAggregates";

export type RangoISO = { from: string; to: string };

const DIA = 86_400_000;
const toMs = (iso: string): number => Date.parse(`${iso}T12:00:00Z`);
const toISO = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function rangoAnterior(r: RangoISO): RangoISO {
  const dias = Math.round((toMs(r.to) - toMs(r.from)) / DIA) + 1;
  const to = toMs(r.from) - DIA;
  return { from: toISO(to - (dias - 1) * DIA), to: toISO(to) };
}

export type SemanticaDelta = "costo" | "neutral";
export type DeltaKpi = {
  pct: number;
  direccion: "up" | "down" | "flat";
  tone: "buena" | "mala" | "neutra";
};

export function deltaKpi(actual: number, anterior: number, sem: SemanticaDelta): DeltaKpi | null {
  if (!Number.isFinite(anterior) || anterior <= 0) return null; // sin base honesta → sin delta
  const pct = Math.round(((actual - anterior) / anterior) * 1000) / 10;
  const direccion = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const tone =
    direccion === "flat" || sem === "neutral" ? "neutra" : direccion === "up" ? "mala" : "buena"; // costo: subir = malo
  return { pct, direccion, tone };
}

export function totalesCargas(
  entries: readonly FuelEntry[],
  r: RangoISO,
): { litros: number; gasto: number; cargas: number } {
  const t = { litros: 0, gasto: 0, cargas: 0 };
  for (const e of entries) {
    if (e.tipo !== "carga") continue;
    const f = (e.fecha || "").slice(0, 10);
    if (f < r.from || f > r.to) continue;
    t.litros += e.litros ?? 0;
    t.gasto += montoEfectivo(e);
    t.cargas += 1;
  }
  return t;
}
