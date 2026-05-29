// weeklyStore — lógica pura del módulo Semanales (reportes semanales + período).
// No toca DOM ni state global. Funciones reutilizables desde renderers
// legacy o futuros módulos TS.

import { calcEstatusSemanal } from "../analyzer/risk";
import type { RiskLevel, WeeklyEntry } from "../types";

export type WeeklyPeriodo = {
  id: string;
  label: string;
  uploadedAt?: string;
  filename?: string;
  entries: WeeklyEntry[];
};

/**
 * Risk efectivo de una entry semanal — combina aceite + radiador (los vitales)
 * via calcEstatusSemanal. Carrocería y llanta se ignoran por regla de negocio
 * (ver risk.ts línea ~162).
 */
export function effRisk(entry: WeeklyEntry | undefined): RiskLevel {
  if (!entry) return "OK";
  return calcEstatusSemanal(
    entry.aceiteRisk,
    entry.radiadorRisk,
    entry.carroceriaRisk,
    entry.llantaRisk,
  );
}

/**
 * Calcula número de semana ISO para un Date dado.
 * Reemplaza getISOWeek() del legado.
 */
export function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const week =
    1 +
    Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return { year: d.getFullYear(), week };
}

/** Formatea un ISO week como "2026-W15". */
export function formatIsoWeek(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, "0")}`;
}

// ═══════════════════════════════════════════════════════════════
//  KPIs agregados por período
// ═══════════════════════════════════════════════════════════════

export type WeeklyKpis = {
  total: number;
  urgente: number;
  revisar: number;
  ok: number;
  aceiteUrgente: number;
  aceiteRevisar: number;
  radiadorUrgente: number;
  radiadorRevisar: number;
  carroceriaUrgente: number;
  carroceriaRevisar: number;
  llantaRevisar: number;
  pctUrgente: number;
  pctRevisar: number;
  pctOk: number;
};

export function buildKpisFromEntries(entries: WeeklyEntry[]): WeeklyKpis {
  const k: WeeklyKpis = {
    total: entries.length,
    urgente: 0,
    revisar: 0,
    ok: 0,
    aceiteUrgente: 0,
    aceiteRevisar: 0,
    radiadorUrgente: 0,
    radiadorRevisar: 0,
    carroceriaUrgente: 0,
    carroceriaRevisar: 0,
    llantaRevisar: 0,
    pctUrgente: 0,
    pctRevisar: 0,
    pctOk: 0,
  };
  for (const e of entries) {
    const r = effRisk(e);
    if (r === "Urgente") k.urgente++;
    else if (r === "Revisar") k.revisar++;
    else k.ok++;
    if (e.aceiteRisk === "Urgente") k.aceiteUrgente++;
    else if (e.aceiteRisk === "Revisar") k.aceiteRevisar++;
    if (e.radiadorRisk === "Urgente") k.radiadorUrgente++;
    else if (e.radiadorRisk === "Revisar") k.radiadorRevisar++;
    if (e.carroceriaRisk === "Urgente") k.carroceriaUrgente++;
    else if (e.carroceriaRisk === "Revisar") k.carroceriaRevisar++;
    if (e.llantaRisk === "Revisar") k.llantaRevisar++;
  }
  const pct = (n: number) => (k.total ? Math.round((n / k.total) * 100) : 0);
  k.pctUrgente = pct(k.urgente);
  k.pctRevisar = pct(k.revisar);
  k.pctOk = pct(k.ok);
  return k;
}

export function buildKpisFromPeriodo(periodo: WeeklyPeriodo | undefined): WeeklyKpis | null {
  if (!periodo) return null;
  return buildKpisFromEntries(periodo.entries);
}

// ═══════════════════════════════════════════════════════════════
//  Filtros + búsqueda
// ═══════════════════════════════════════════════════════════════

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export type WeeklyFilter = {
  riskFilter?: RiskLevel | "all";
  sucursal?: string;
  search?: string;
};

export function applyWeeklyFilters(entries: WeeklyEntry[], f: WeeklyFilter = {}): WeeklyEntry[] {
  let out = entries;
  if (f.riskFilter && f.riskFilter !== "all") {
    out = out.filter((e) => effRisk(e) === f.riskFilter);
  }
  if (f.sucursal && f.sucursal !== "all") {
    out = out.filter((e) => e.branch === f.sucursal);
  }
  if (f.search) {
    const q = norm(f.search);
    // Query solo dígitos → económico EXACTO (evita falsos positivos por substring).
    out = /^\d+$/.test(q)
      ? out.filter((e) => norm(e.eco ?? "") === q)
      : out.filter(
          (e) =>
            norm(e.eco ?? "").includes(q) ||
            norm(e.plate ?? "").includes(q) ||
            norm(e.branch ?? "").includes(q),
        );
  }
  return out;
}

export function uniqueWeeklySucursales(entries: WeeklyEntry[]): string[] {
  const set = new Set<string>();
  for (const e of entries) if (e.branch) set.add(e.branch);
  return [...set].sort((a, b) => a.localeCompare(b, "es"));
}

// ═══════════════════════════════════════════════════════════════
//  Períodos — ordenar, activo por default, delete
// ═══════════════════════════════════════════════════════════════

/** Ordena períodos ascendente por id (ISO week = string-comparable). */
export function sortPeriodos(periodos: WeeklyPeriodo[]): WeeklyPeriodo[] {
  return [...periodos].sort((a, b) => a.id.localeCompare(b.id));
}

/** Devuelve el período más reciente (último en sort asc). */
export function latestPeriodo(periodos: WeeklyPeriodo[]): WeeklyPeriodo | null {
  if (periodos.length === 0) return null;
  return sortPeriodos(periodos)[periodos.length - 1] ?? null;
}

/** Busca período por id. */
export function findPeriodo(periodos: WeeklyPeriodo[], id: string): WeeklyPeriodo | null {
  return periodos.find((p) => p.id === id) ?? null;
}

/** Entry más reciente de una unidad across todos los períodos. */
export function latestEntryForUnit(
  periodos: WeeklyPeriodo[],
  match: { uid?: string; eco?: string; plate?: string },
): { periodo: WeeklyPeriodo; entry: WeeklyEntry } | null {
  const sorted = sortPeriodos(periodos);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    if (!p) continue;
    const e = p.entries.find(
      (x) =>
        (match.uid && x.uid === match.uid) ||
        (match.eco && x.eco === match.eco) ||
        (match.plate && x.plate === match.plate),
    );
    if (e) return { periodo: p, entry: e };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
//  Comparación entre 2 períodos (tendencias)
// ═══════════════════════════════════════════════════════════════

export type PeriodComparison = {
  improved: number;
  worsened: number;
  unchanged: number;
  new: number; // unidades no en período previo
  gone: number; // unidades en prev pero no en current
};

const RISK_ORDER: Record<RiskLevel, number> = { OK: 0, Completar: 1, Revisar: 2, Urgente: 3 };

export function comparePeriodos(prev: WeeklyPeriodo, cur: WeeklyPeriodo): PeriodComparison {
  const prevMap = new Map<string, WeeklyEntry>();
  for (const e of prev.entries) {
    const key = e.uid || e.eco || e.plate || "";
    if (key) prevMap.set(key, e);
  }
  const curKeys = new Set<string>();
  const cmp: PeriodComparison = { improved: 0, worsened: 0, unchanged: 0, new: 0, gone: 0 };

  for (const e of cur.entries) {
    const key = e.uid || e.eco || e.plate || "";
    if (!key) continue;
    curKeys.add(key);
    const p = prevMap.get(key);
    if (!p) {
      cmp.new++;
      continue;
    }
    const rCur = effRisk(e);
    const rPrev = effRisk(p);
    const dCur = RISK_ORDER[rCur];
    const dPrev = RISK_ORDER[rPrev];
    if (dCur < dPrev) cmp.improved++;
    else if (dCur > dPrev) cmp.worsened++;
    else cmp.unchanged++;
  }

  for (const key of prevMap.keys()) {
    if (!curKeys.has(key)) cmp.gone++;
  }

  return cmp;
}
