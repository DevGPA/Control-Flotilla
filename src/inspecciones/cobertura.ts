// Cobertura del ciclo de inspección — el KPI de seguimiento del módulo.
//
// Responde "¿vamos al corriente?": de las unidades del catálogo que deben
// hacer checklist (scoped por sucursal, sin montacargas), cuántas ya tienen
// inspección dentro del rango activo. El caller (buildKPIs en el legado) ya
// tiene ambos insumos: `fleetRoster` y el Set `pres` de placas presentes —
// los mismos que alimentan el chip "Sin check" y el modal missingMensual,
// así card, chip y modal cuadran por construcción.

declare global {
  interface Window {
    /** Namespace para el legado (buildKPIs). */
    __cobertura?: {
      build: typeof buildCobertura;
      nivel: typeof coberturaNivel;
    };
  }
}

export type Cobertura = {
  total: number;
  conCheck: number;
  faltan: number;
  /** Porcentaje redondeado 0-100 (0 si el roster está vacío). */
  pct: number;
};

type RosterRow = { plate?: string; uid?: string };

/**
 * Cobertura = intersección roster ∩ presentes. El numerador NO es
 * `presentes.size`: el rango puede traer placas ya dadas de baja del
 * catálogo y el % pasaría de 100. Invariante: conCheck + faltan === total.
 */
export function buildCobertura(
  roster: ReadonlyArray<RosterRow>,
  presentes: ReadonlySet<string>,
): Cobertura {
  const total = roster.length;
  if (!total) return { total: 0, conCheck: 0, faltan: 0, pct: 0 };
  let conCheck = 0;
  for (const r of roster) {
    if (presentes.has(r.plate || String(r.uid ?? ""))) conCheck++;
  }
  return { total, conCheck, faltan: total - conCheck, pct: Math.round((conCheck / total) * 100) };
}

export type CoberturaNivel = "ok" | "warn" | "bad";

/** Semáforo del ciclo: ≥90 al corriente, ≥70 en riesgo, <70 atrasado. */
export function coberturaNivel(pct: number): CoberturaNivel {
  if (pct >= 90) return "ok";
  if (pct >= 70) return "warn";
  return "bad";
}
