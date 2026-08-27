// Tablero operativo de Análisis — capa PURA de datos (sin DOM).
//
// Rediseño 2026-08-27 (decisión Navares): la vista Análisis deja las gráficas
// descriptivas (categorías, heatmap, scatter km) y pasa a contestar preguntas
// operativas: ¿qué sucursal va atrasada?, ¿qué vence pronto?, ¿qué unidades
// reinciden?, ¿cuánto se va en taller cada mes? La tendencia mensual
// (trendData.ts) sigue siendo la pieza central.
//
// Todos los builders son puros: reciben datos ya scoped por sucursal (el
// caller aplica scopeUnits/scopeBySucursal) y devuelven filas listas para
// renderOps.ts. El criterio de servicio (svcStatus) vive en el legado y se
// INYECTA como función para no duplicarlo (patrón fleetMap).

import { monthOf, monthLabel } from "../dates";

// ── 1) Sucursales: cobertura y riesgo ────────────────────────────────────────

export type SucursalOps = {
  sucursal: string;
  total: number; // unidades del catálogo (sin montacargas)
  conCheck: number; // con inspección en el rango
  pct: number; // cobertura 0-100
  urgentes: number; // unidades (dedupe) con riesgo Urgente en el rango
  revisar: number;
};

type RosterRow = { plate?: string; uid?: string; branch?: string };
type RangoRow = RosterRow & { risk?: string };

const SIN_SUCURSAL = "Sin sucursal";

function keyDe(u: { plate?: string; uid?: string }): string {
  return u.plate || String(u.uid ?? "");
}

/**
 * Ranking por sucursal: cobertura del ciclo + carga de riesgo. `rangoRows`
 * debe venir DEDUPEADO por unidad (latestPorUnidad) para que urgentes/revisar
 * cuenten unidades. Orden: peor cobertura primero (ahí está el pendiente).
 */
export function buildSucursalesOps(
  roster: ReadonlyArray<RosterRow>,
  rangoRows: ReadonlyArray<RangoRow>,
): SucursalOps[] {
  const presentes = new Set(rangoRows.map(keyDe));
  const porSuc = new Map<string, SucursalOps>();
  const de = (branch: string | undefined): SucursalOps => {
    const suc = String(branch ?? "").trim() || SIN_SUCURSAL;
    let row = porSuc.get(suc);
    if (!row) {
      row = { sucursal: suc, total: 0, conCheck: 0, pct: 0, urgentes: 0, revisar: 0 };
      porSuc.set(suc, row);
    }
    return row;
  };
  for (const r of roster) {
    const row = de(r.branch);
    row.total++;
    if (presentes.has(keyDe(r))) row.conCheck++;
  }
  // Riesgo por unidad del rango (puede incluir placas ya fuera del catálogo).
  for (const u of rangoRows) {
    const row = de(u.branch);
    if (u.risk === "Urgente") row.urgentes++;
    else if (u.risk === "Revisar") row.revisar++;
  }
  const out = [...porSuc.values()];
  for (const r of out) r.pct = r.total ? Math.round((r.conCheck / r.total) * 100) : 0;
  // Peor cobertura primero; empate → más urgentes primero; luego alfabético.
  out.sort(
    (a, b) =>
      a.pct - b.pct || b.urgentes - a.urgentes || a.sucursal.localeCompare(b.sucursal, "es"),
  );
  return out;
}

// ── 2) Radar de vencimientos ─────────────────────────────────────────────────

export type RadarSeveridad = "vencido" | "proximo";

export type RadarItem = {
  eco: string;
  sucursal: string;
  /** Qué vence: "Servicio", "Verificación", "Seguro", "Multa"… */
  que: string;
  /** Contexto corto: "vencido hace 12 días", "vence en 8 días", "por km". */
  detalle: string;
  /** Días para vencer (negativo = vencido); null cuando el criterio es por km. */
  dias: number | null;
  severidad: RadarSeveridad;
};

export type RadarOps = {
  vencidos: number;
  proximos: number;
  /** Top N ordenado: vencidos primero (más viejo primero), luego próximos (más cercano primero). */
  items: RadarItem[];
};

const TIPO_DOC_LABEL: Record<string, string> = {
  verificacion: "Verificación",
  tenencia: "Tenencia",
  refrendo: "Refrendo",
  seguro: "Seguro",
  tarjetaCirculacion: "Tarjeta de circulación",
  licencia: "Licencia",
  multa: "Multa",
};

type FleetRow = {
  eco?: string;
  plate?: string;
  branch?: string;
  esMontacargas?: boolean;
  nextSvc?: string;
  kmNextSvc?: number;
};

type ComplianceRow = {
  economicoId: string;
  tipoDoc: string;
  estado: string; // vencido | porVencer | adeudo | vigente | desconocido
  diasParaVencer: number | null;
  sucursal?: string;
};

function detalleDias(dias: number | null, fallback: string): string {
  if (dias == null) return fallback;
  if (dias < 0) {
    const d = Math.abs(dias);
    return d === 1 ? "vencido hace 1 día" : `vencido hace ${d} días`;
  }
  if (dias === 0) return "vence hoy";
  return dias === 1 ? "vence mañana" : `vence en ${dias} días`;
}

/**
 * Consolida los riesgos por vencimiento de la flota en una sola lista:
 * servicios (criterio inyectado — km-first, vive en el legado) + documentos
 * de cumplimiento vencidos/por vencer y multas con adeudo.
 */
export function buildRadarVencimientos(
  fleet: ReadonlyArray<FleetRow>,
  svcStatusOf: (u: FleetRow) => "vencido" | "proximo" | "ok",
  compliance: ReadonlyArray<ComplianceRow>,
  opts?: { maxItems?: number },
): RadarOps {
  const maxItems = opts?.maxItems ?? 12;
  const items: RadarItem[] = [];
  for (const u of fleet) {
    if (u.esMontacargas) continue;
    const ss = svcStatusOf(u);
    if (ss === "ok") continue;
    const porKm = u.kmNextSvc != null && u.kmNextSvc > 0;
    items.push({
      eco: String(u.eco ?? u.plate ?? "").trim() || "—",
      sucursal: String(u.branch ?? "").trim() || SIN_SUCURSAL,
      que: "Servicio",
      detalle: porKm
        ? ss === "vencido"
          ? "vencido por km"
          : "próximo por km"
        : detalleDias(null, ss === "vencido" ? "vencido" : "próximo"),
      dias: null,
      severidad: ss === "vencido" ? "vencido" : "proximo",
    });
  }
  for (const c of compliance) {
    const grave = c.estado === "vencido" || c.estado === "adeudo";
    const proximo = c.estado === "porVencer";
    if (!grave && !proximo) continue;
    items.push({
      eco: String(c.economicoId ?? "").trim() || "—",
      sucursal: String(c.sucursal ?? "").trim() || SIN_SUCURSAL,
      que: TIPO_DOC_LABEL[c.tipoDoc] ?? c.tipoDoc,
      detalle:
        c.estado === "adeudo" ? "adeudo pendiente" : detalleDias(c.diasParaVencer, "vencido"),
      dias: c.diasParaVencer,
      severidad: grave ? "vencido" : "proximo",
    });
  }
  const vencidos = items.filter((i) => i.severidad === "vencido").length;
  const proximos = items.length - vencidos;
  items.sort((a, b) => {
    if (a.severidad !== b.severidad) return a.severidad === "vencido" ? -1 : 1;
    // Dentro del grupo: con días primero (más urgente primero); sin días (km) al final.
    const da = a.dias ?? Number.POSITIVE_INFINITY;
    const db = b.dias ?? Number.POSITIVE_INFINITY;
    return da - db || a.eco.localeCompare(b.eco, "es", { numeric: true });
  });
  return { vencidos, proximos, items: items.slice(0, maxItems) };
}

// ── 3) Unidades reincidentes ─────────────────────────────────────────────────

export type Reincidente = {
  eco: string;
  sucursal: string;
  /** Meses distintos (en la ventana) en que la unidad reportó riesgo Urgente. */
  mesesUrgente: number;
  visitasTaller: number;
  gastoTaller: number;
  /** Riesgo de su inspección más reciente en la ventana. */
  ultimoRiesgo: string;
  /** Llave del expediente de taller (unitKey||id de su entrada más reciente); "" sin visitas. */
  tallerKey: string;
};

type InspRow = {
  plate?: string;
  uid?: string;
  eco?: string;
  branch?: string;
  fecha?: string;
  risk?: string;
};
type TallerRow = {
  eco?: string;
  plate?: string;
  fentrada?: string;
  gastoRef?: number;
  gastoMO?: number;
  gasto?: number;
  unitKey?: string;
  id?: string;
};

/** Gasto canónico de una entrada de taller: Ref+MO si hay desglose, si no el subtotal legacy. */
export function gastoDe(e: Pick<TallerRow, "gastoRef" | "gastoMO" | "gasto">): number {
  const desglose = (e.gastoRef || 0) + (e.gastoMO || 0);
  return desglose > 0 ? desglose : e.gasto || 0;
}

/** Resta meses a un "YYYY-MM" (aritmética pura, sin Date). */
export function restarMeses(ym: string, n: number): string {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  if (!m) return ym;
  let anio = parseInt(m[1]!, 10);
  let mes = parseInt(m[2]!, 10) - n;
  while (mes <= 0) {
    mes += 12;
    anio -= 1;
  }
  return `${anio}-${String(mes).padStart(2, "0")}`;
}

function ecoKeyDe(eco: unknown, plate: unknown): string {
  return (
    String(eco ?? "")
      .trim()
      .toLowerCase() ||
    String(plate ?? "")
      .trim()
      .toLowerCase()
  );
}

/**
 * Unidades que repiten problemas en la ventana (default 6 meses, anclada al
 * mes más reciente con datos): riesgo Urgente en ≥2 meses distintos, o ≥2
 * visitas a taller. Orden: más meses urgentes → más visitas → más gasto.
 */
export function buildReincidentes(
  inspections: ReadonlyArray<InspRow>,
  taller: ReadonlyArray<TallerRow>,
  opts?: { mesesVentana?: number; maxItems?: number },
): Reincidente[] {
  const mesesVentana = opts?.mesesVentana ?? 6;
  const maxItems = opts?.maxItems ?? 10;
  // Ventana anclada al dato más reciente (determinista, testeable sin "hoy").
  let maxYm = "";
  for (const i of inspections) {
    const ym = monthOf(i.fecha);
    if (ym && ym > maxYm) maxYm = ym;
  }
  for (const t of taller) {
    const ym = monthOf(t.fentrada);
    if (ym && ym > maxYm) maxYm = ym;
  }
  if (!maxYm) return [];
  const cutoff = restarMeses(maxYm, mesesVentana - 1);

  type Acc = {
    eco: string;
    sucursal: string;
    mesesUrgente: Set<string>;
    visitas: number;
    gasto: number;
    ultimaFechaYm: string;
    ultimoRiesgo: string;
    tallerKey: string;
    tallerKeyYm: string;
  };
  const porUnidad = new Map<string, Acc>();
  const accDe = (key: string): Acc => {
    let a = porUnidad.get(key);
    if (!a) {
      a = {
        eco: "",
        sucursal: SIN_SUCURSAL,
        mesesUrgente: new Set(),
        visitas: 0,
        gasto: 0,
        ultimaFechaYm: "",
        ultimoRiesgo: "",
        tallerKey: "",
        tallerKeyYm: "",
      };
      porUnidad.set(key, a);
    }
    return a;
  };

  for (const i of inspections) {
    const ym = monthOf(i.fecha);
    if (!ym || ym < cutoff) continue;
    const key = ecoKeyDe(i.eco, i.plate);
    if (!key) continue;
    const a = accDe(key);
    if (!a.eco) a.eco = String(i.eco ?? i.plate ?? "").trim();
    const suc = String(i.branch ?? "").trim();
    if (suc) a.sucursal = suc;
    if (i.risk === "Urgente") a.mesesUrgente.add(ym);
    if (ym >= a.ultimaFechaYm) {
      a.ultimaFechaYm = ym;
      a.ultimoRiesgo = String(i.risk ?? "");
    }
  }
  for (const t of taller) {
    const ym = monthOf(t.fentrada);
    if (!ym || ym < cutoff) continue;
    const key = ecoKeyDe(t.eco, t.plate);
    if (!key) continue;
    const a = accDe(key);
    if (!a.eco) a.eco = String(t.eco ?? t.plate ?? "").trim();
    a.visitas++;
    a.gasto += gastoDe(t);
    const expKey = String(t.unitKey ?? t.id ?? "");
    if (expKey && ym >= a.tallerKeyYm) {
      a.tallerKey = expKey;
      a.tallerKeyYm = ym;
    }
  }

  return [...porUnidad.values()]
    .filter((a) => a.mesesUrgente.size >= 2 || a.visitas >= 2)
    .map((a) => ({
      eco: a.eco || "—",
      sucursal: a.sucursal,
      mesesUrgente: a.mesesUrgente.size,
      visitasTaller: a.visitas,
      gastoTaller: a.gasto,
      ultimoRiesgo: a.ultimoRiesgo || "—",
      tallerKey: a.tallerKey,
    }))
    .sort(
      (x, y) =>
        y.mesesUrgente - x.mesesUrgente ||
        y.visitasTaller - x.visitasTaller ||
        y.gastoTaller - x.gastoTaller ||
        x.eco.localeCompare(y.eco, "es", { numeric: true }),
    )
    .slice(0, maxItems);
}

// ── 4) Gasto de taller por mes ───────────────────────────────────────────────

export type GastoMes = {
  mes: string; // "2026-08"
  label: string; // "Ago 2026"
  total: number;
  porSucursal: Record<string, number>;
};

/** Serie mensual de gasto de taller por sucursal (mes = fecha de ENTRADA). */
export function buildGastoMensual(
  taller: ReadonlyArray<TallerRow & { sucursal?: string }>,
  opts?: { maxMeses?: number },
): GastoMes[] {
  const maxMeses = opts?.maxMeses ?? 12;
  const porMes = new Map<string, GastoMes>();
  for (const t of taller) {
    const ym = monthOf(t.fentrada);
    if (!ym) continue;
    const g = gastoDe(t);
    if (!g) continue;
    let row = porMes.get(ym);
    if (!row) {
      row = { mes: ym, label: monthLabel(ym), total: 0, porSucursal: {} };
      porMes.set(ym, row);
    }
    const suc = String(t.sucursal ?? "").trim() || SIN_SUCURSAL;
    row.total += g;
    row.porSucursal[suc] = (row.porSucursal[suc] || 0) + g;
  }
  return [...porMes.values()].sort((a, b) => a.mes.localeCompare(b.mes)).slice(-maxMeses);
}
