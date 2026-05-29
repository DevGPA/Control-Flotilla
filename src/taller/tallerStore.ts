// tallerStore — lógica pura de negocio para el módulo Taller.
// Exporta funciones de filtrado, ordenamiento, cálculo de días en taller,
// agrupación por unidad, totales de costo. Sin DOM, sin side effects.

import {
  ESTADOS_ACTIVOS,
  ESTADOS_CERRADOS,
  type TallerEntry,
  type TallerEstado,
  type TallerFilter,
} from "./types";

/** Si la entry cuenta como cerrada (Finalizado o Listo). */
export function isClosed(e: TallerEntry): boolean {
  return ESTADOS_CERRADOS.includes(e.estado);
}

/** Filtra activas (no cerradas). */
export function filterActivas(entries: TallerEntry[]): TallerEntry[] {
  return entries.filter((e) => !isClosed(e));
}

/** Filtra cerradas. */
export function filterCerradas(entries: TallerEntry[]): TallerEntry[] {
  return entries.filter(isClosed);
}

/** Días entre fentrada y hoy (o fecha de referencia). */
export function diasEnTaller(entry: TallerEntry, today: Date = new Date()): number | null {
  if (!entry.fentrada) return null;
  const entrada = new Date(entry.fentrada);
  if (Number.isNaN(entrada.getTime())) return null;
  return Math.max(0, Math.round((today.getTime() - entrada.getTime()) / 86400000));
}

/** Costo total (refacciones + mano de obra). */
export function gastoTotal(entry: TallerEntry): number {
  return (entry.gastoRef ?? 0) + (entry.gastoMO ?? 0);
}

/**
 * Busca texto libre contra eco/plate/tecnico/comentario/brand/refacciones.
 * Compara case-insensitive con normalización (sin tildes).
 */
function norm(s?: string): string {
  return (s ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function matchesSearch(entry: TallerEntry, query: string): boolean {
  if (!query) return true;
  const q = norm(query);
  // Query solo dígitos → económico EXACTO (evita que "10" matchee "100"/placas).
  if (/^\d+$/.test(q)) return norm(entry.eco) === q;
  // Query con texto → substring incluyendo económico (alfanuméricos como "A-117").
  return [
    entry.eco,
    entry.plate,
    entry.tecnico,
    entry.comentario,
    entry.brand,
    entry.refacciones,
  ].some((f) => norm(f).includes(q));
}

/** Aplica filtros acumulativos (sucursal/area/tipo/search). */
export function applyFilters(entries: TallerEntry[], f: TallerFilter = {}): TallerEntry[] {
  let out = entries;
  if (f.sucursal && f.sucursal !== "all") out = out.filter((e) => e.sucursal === f.sucursal);
  if (f.area && f.area !== "all") out = out.filter((e) => e.area === f.area);
  if (f.tipo && f.tipo !== "all") out = out.filter((e) => e.tipo === f.tipo);
  if (f.search) out = out.filter((e) => matchesSearch(e, f.search!));
  return out;
}

/** Lista única de sucursales en el set de entries, ordenadas alfabéticamente. */
export function uniqueSucursales(entries: TallerEntry[]): string[] {
  const set = new Set<string>();
  for (const e of entries) if (e.sucursal) set.add(e.sucursal);
  return [...set].sort((a, b) => a.localeCompare(b, "es"));
}

export function uniqueAreas(entries: TallerEntry[]): string[] {
  const set = new Set<string>();
  for (const e of entries) if (e.area) set.add(e.area);
  return [...set].sort((a, b) => a.localeCompare(b, "es"));
}

export function uniqueTipos(entries: TallerEntry[]): string[] {
  const set = new Set<string>();
  for (const e of entries) if (e.tipo) set.add(e.tipo);
  return [...set].sort((a, b) => a.localeCompare(b, "es"));
}

/**
 * Agrupa entries por unitKey (eco preferido, plate fallback, id último).
 * Devuelve Map<unitKey, TallerEntry[]> donde cada bucket está ordenado desc
 * por fentrada (más reciente primero).
 */
export function groupByUnit(entries: TallerEntry[]): Map<string, TallerEntry[]> {
  const groups = new Map<string, TallerEntry[]>();
  for (const e of entries) {
    const key = e.unitKey || e.eco || e.plate || e.id;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }
  for (const arr of groups.values()) {
    arr.sort((a, b) => (b.fentrada || "").localeCompare(a.fentrada || ""));
  }
  return groups;
}

/** Sort keys soportados para listas. */
export type SortKey = "fentrada" | "dias" | "gasto" | "eco" | "estado" | "sucursal";
export type SortDir = "asc" | "desc";

export function sortEntries(
  entries: TallerEntry[],
  key: SortKey,
  dir: SortDir = "desc",
  today: Date = new Date(),
): TallerEntry[] {
  const sorted = [...entries];
  const cmp = (a: TallerEntry, b: TallerEntry): number => {
    let va: string | number = "",
      vb: string | number = "";
    switch (key) {
      case "fentrada":
        va = a.fentrada || "";
        vb = b.fentrada || "";
        break;
      case "dias":
        va = diasEnTaller(a, today) ?? -1;
        vb = diasEnTaller(b, today) ?? -1;
        break;
      case "gasto":
        va = gastoTotal(a);
        vb = gastoTotal(b);
        break;
      case "eco":
        va = a.eco || "";
        vb = b.eco || "";
        break;
      case "estado":
        va = a.estado;
        vb = b.estado;
        break;
      case "sucursal":
        va = a.sucursal || "";
        vb = b.sucursal || "";
        break;
    }
    if (va < vb) return dir === "asc" ? -1 : 1;
    if (va > vb) return dir === "asc" ? 1 : -1;
    return 0;
  };
  sorted.sort(cmp);
  return sorted;
}

/** Ordena por urgencia: entries con más días y gasto mayor primero. */
export function sortByUrgencia(entries: TallerEntry[], today: Date = new Date()): TallerEntry[] {
  return [...entries].sort((a, b) => {
    const dA = diasEnTaller(a, today) ?? 0;
    const dB = diasEnTaller(b, today) ?? 0;
    if (dA !== dB) return dB - dA; // más días = más urgente
    return gastoTotal(b) - gastoTotal(a); // gasto alto = urgente
  });
}

/** Totales agregados (para cards/KPI). */
export type TallerTotals = {
  activas: number;
  cerradas: number;
  gastoTotalActivas: number;
  gastoTotalCerradas: number;
  diasPromedioActivas: number;
};

export function computeTotals(entries: TallerEntry[], today: Date = new Date()): TallerTotals {
  const activas = filterActivas(entries);
  const cerradas = filterCerradas(entries);
  const gAct = activas.reduce((s, e) => s + gastoTotal(e), 0);
  const gCer = cerradas.reduce((s, e) => s + gastoTotal(e), 0);
  const diasList = activas.map((e) => diasEnTaller(e, today) ?? 0);
  const diasAvg = diasList.length ? diasList.reduce((s, d) => s + d, 0) / diasList.length : 0;
  return {
    activas: activas.length,
    cerradas: cerradas.length,
    gastoTotalActivas: gAct,
    gastoTotalCerradas: gCer,
    diasPromedioActivas: Math.round(diasAvg),
  };
}

/** Transiciones de estado válidas. */
const TRANSITIONS: Record<TallerEstado, TallerEstado[]> = {
  "En Diagnóstico": ["En Reparación", "Cotización", "Por recuperar", "Finalizado"],
  "En Reparación": ["Cotización", "Por recuperar", "Finalizado"],
  Cotización: ["En Reparación", "Por recuperar", "Finalizado"],
  "Por recuperar": ["Finalizado", "En Reparación"],
  Finalizado: [],
};

export function canTransitionTo(from: TallerEstado, to: TallerEstado): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStates(from: TallerEstado): TallerEstado[] {
  return TRANSITIONS[from] ?? [];
}

export { ESTADOS_ACTIVOS, ESTADOS_CERRADOS };
