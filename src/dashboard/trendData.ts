// Tendencia mensual de inspecciones — datos para renderTrendLine (#chart-trend).
//
// Antes la gráfica leía window.periodos, que solo poblaba el flujo VIEJO de
// subir XLSX (IndexedDB): en cloud siempre estaba vacío y la card vivía
// colapsada (auditoría 2026-06-10, ítem 51). Ahora la serie se construye de
// window.__inspections (todo el histórico hidratado, ya sin anulados),
// agrupando por mes calendario.
//
// Clasificación por `u.risk` CRUDO (el estado como se reportó), igual que el
// código previo del trend. Nota: el chart de sucursales de la misma vista
// clasifica distinto (findings PENDIENTES vía isFindingDone, descontando los
// atendidos). Esa inconsistencia es preexistente y se deja tal cual aquí: la
// tendencia histórica no debe "mejorar" retroactivamente al atender hallazgos.

import type { PeriodTrend } from "./charts"; // type-only: no arrastra ECharts al boot
import { monthOf, monthLabel } from "../dates";

declare global {
  interface Window {
    /** Namespace para el legado (buildAnalytics). */
    __trendData?: {
      fromInspections: typeof buildTrendFromInspections;
    };
  }
}

type TrendRow = { fecha?: string; risk?: string };

/**
 * Agrupa inspecciones por mes (YYYY-MM) → serie PeriodTrend ascendente.
 * - Filas sin fecha parseable se excluyen.
 * - Meses sin inspecciones se OMITEN (un mes sin datos no es "0% urgente").
 * - Conserva los `maxMeses` más recientes (default 12: eje X legible).
 */
export function buildTrendFromInspections(
  rows: ReadonlyArray<TrendRow>,
  opts?: { maxMeses?: number },
): PeriodTrend[] {
  const maxMeses = opts?.maxMeses ?? 12;
  const porMes = new Map<string, { total: number; urgente: number; revisar: number }>();
  for (const r of rows) {
    const ym = monthOf(r.fecha);
    if (!ym) continue;
    let acc = porMes.get(ym);
    if (!acc) {
      acc = { total: 0, urgente: 0, revisar: 0 };
      porMes.set(ym, acc);
    }
    acc.total++;
    if (r.risk === "Urgente") acc.urgente++;
    else if (r.risk === "Revisar") acc.revisar++;
    // "Completar" / undefined / resto → operativa (espejo del mapeo previo del trend)
  }
  return [...porMes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-maxMeses)
    .map(([ym, acc]) => ({
      label: monthLabel(ym),
      total: acc.total,
      urgente: acc.urgente,
      revisar: acc.revisar,
      operativa: acc.total - acc.urgente - acc.revisar,
    }));
}
