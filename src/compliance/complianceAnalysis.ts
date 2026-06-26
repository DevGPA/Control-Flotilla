/**
 * Lógica PURA del módulo de Cumplimiento (sin DOM, sin Amplify) — testeable en vitest,
 * igual que src/fuel/fuelAnalysis.ts. Es la ÚNICA fuente de verdad del estado de un
 * documento: la consumen la vista de flota, la pestaña por unidad y el panel de alertas
 * (para que nunca diverjan). Las fechas son strings YYYY-MM-DD y `hoy` se INYECTA como
 * parámetro (determinista; nunca se llama new Date() aquí dentro).
 */
import type {
  ComplianceDoc,
  ComplianceEntry,
  ComplianceEstado,
  ComplianceResumenUnidad,
} from "./types";

/** Ventana por defecto (días) para marcar un documento como "por vencer". */
export const DIAS_POR_VENCER = 30;

/**
 * Severidad del estado (mayor = más urgente), para elegir el "peor" de una unidad.
 * `vencido` gana a `adeudo` solo para etiquetar; ambos son rojo en la UI.
 */
export const COMPLIANCE_SEVERIDAD: Record<ComplianceEstado, number> = {
  desconocido: 0,
  vigente: 1,
  porVencer: 2,
  adeudo: 3,
  vencido: 4,
};

/** Parse YYYY-MM-DD a epoch UTC (medianoche). NaN si la fecha es inválida. */
function epochDia(fecha: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Días entre dos fechas YYYY-MM-DD (`b - a`). Positivo = `b` es posterior. null si inválidas. */
export function diasEntre(a: string, b: string): number | null {
  const ea = epochDia(a);
  const eb = epochDia(b);
  if (Number.isNaN(ea) || Number.isNaN(eb)) return null;
  return Math.round((eb - ea) / 86_400_000);
}

/**
 * Estado de UN documento respecto a `hoy` (YYYY-MM-DD). PURO.
 * - multa: 'adeudo' salvo que su monto sea exactamente 0 (saldada). diasParaVencer = null.
 * - documentos con fecha: vencido (fecha < hoy) | porVencer (≤ ventana) | vigente.
 * - sin fecha (y no es multa): 'desconocido'.
 */
export function complianceStatus(
  doc: ComplianceDoc,
  hoy: string,
  diasPorVencer: number = DIAS_POR_VENCER,
): { estado: ComplianceEstado; diasParaVencer: number | null } {
  if (doc.tipoDoc === "multa") {
    const adeuda = doc.monto == null || doc.monto > 0;
    return { estado: adeuda ? "adeudo" : "vigente", diasParaVencer: null };
  }
  const fv = doc.fechaVencimiento;
  if (!fv) return { estado: "desconocido", diasParaVencer: null };
  const dias = diasEntre(hoy, fv);
  if (dias == null) return { estado: "desconocido", diasParaVencer: null };
  if (dias < 0) return { estado: "vencido", diasParaVencer: dias };
  if (dias <= diasPorVencer) return { estado: "porVencer", diasParaVencer: dias };
  return { estado: "vigente", diasParaVencer: dias };
}

/** Normaliza un ComplianceDoc a ComplianceEntry (con estado derivado vs `hoy`). */
export function toComplianceEntry(
  doc: ComplianceDoc,
  hoy: string,
  diasPorVencer: number = DIAS_POR_VENCER,
): ComplianceEntry {
  const { estado, diasParaVencer } = complianceStatus(doc, hoy, diasPorVencer);
  return { ...doc, estado, diasParaVencer };
}

/** Resume el expediente de UNA unidad: peor estado + conteos + monto total de adeudos. */
export function resumirUnidad(eco: string, docs: ComplianceEntry[]): ComplianceResumenUnidad {
  let vencidos = 0;
  let porVencer = 0;
  let adeudos = 0;
  let montoAdeudo = 0;
  let peor: ComplianceEstado = "desconocido";
  let sucursal: string | undefined;
  let placa: string | undefined;
  for (const d of docs) {
    if (d.estado === "vencido") vencidos++;
    else if (d.estado === "porVencer") porVencer++;
    if (d.estado === "adeudo") {
      adeudos++;
      montoAdeudo += d.monto ?? 0;
    }
    if (COMPLIANCE_SEVERIDAD[d.estado] > COMPLIANCE_SEVERIDAD[peor]) peor = d.estado;
    if (!sucursal && d.sucursal) sucursal = d.sucursal;
    if (!placa && d.placa) placa = d.placa;
  }
  return { eco, estado: peor, vencidos, porVencer, adeudos, montoAdeudo, sucursal, placa, docs };
}

/** Agrupa entries por economicoId y resume cada unidad. */
export function resumirFlota(entries: ComplianceEntry[]): Map<string, ComplianceResumenUnidad> {
  const porEco = new Map<string, ComplianceEntry[]>();
  for (const e of entries) {
    const arr = porEco.get(e.economicoId);
    if (arr) arr.push(e);
    else porEco.set(e.economicoId, [e]);
  }
  const out = new Map<string, ComplianceResumenUnidad>();
  for (const [eco, docs] of porEco) out.set(eco, resumirUnidad(eco, docs));
  return out;
}

/** Datos mínimos de una unidad del catálogo de flota, para fusionar con los resúmenes. */
export type UnidadCatalogo = { eco: string; sucursal?: string; placa?: string };

/**
 * Fusiona los resúmenes (unidades CON documentos) con el catálogo COMPLETO de la flota,
 * de modo que las unidades SIN documentos aparezcan como 'desconocido'. Rellena sucursal/
 * placa desde el catálogo si el resumen no las trae. Las unidades con docs pero ausentes
 * del catálogo (huérfanas) se conservan. Pura.
 */
export function mergeFlotaConCatalogo(
  resumenPorEco: ReadonlyMap<string, ComplianceResumenUnidad>,
  catalogo: readonly UnidadCatalogo[],
): ComplianceResumenUnidad[] {
  const out: ComplianceResumenUnidad[] = [];
  const vistos = new Set<string>();
  for (const u of catalogo) {
    if (!u.eco || vistos.has(u.eco)) continue;
    vistos.add(u.eco);
    const r = resumenPorEco.get(u.eco);
    if (r) {
      out.push({ ...r, sucursal: r.sucursal ?? u.sucursal, placa: r.placa ?? u.placa });
    } else {
      out.push({
        eco: u.eco,
        estado: "desconocido",
        vencidos: 0,
        porVencer: 0,
        adeudos: 0,
        montoAdeudo: 0,
        sucursal: u.sucursal,
        placa: u.placa,
        docs: [],
      });
    }
  }
  for (const [eco, r] of resumenPorEco) {
    if (!vistos.has(eco)) out.push(r);
  }
  return out;
}

// ── Helpers deterministas por terminación de placa (Megalópolis / verificación) ─────
// La verificación y el "Hoy No Circula" de placa foránea se DERIVAN de la última cifra
// de la placa — no requieren consultar ningún portal. Convención nacional de engomados.

/** Color de engomado / calendario de verificación. */
export type Engomado = "amarillo" | "rosa" | "rojo" | "verde" | "azul";

/** Día de "Hoy No Circula" (placa foránea en CDMX/Edomex). */
export type DiaSemana = "lunes" | "martes" | "miercoles" | "jueves" | "viernes";

const ENGOMADO_POR_CIFRA: Record<number, Engomado> = {
  5: "amarillo",
  6: "amarillo",
  7: "rosa",
  8: "rosa",
  3: "rojo",
  4: "rojo",
  1: "verde",
  2: "verde",
  9: "azul",
  0: "azul",
};

const DIA_HNC_POR_CIFRA: Record<number, DiaSemana> = {
  5: "lunes",
  6: "lunes",
  7: "martes",
  8: "martes",
  3: "miercoles",
  4: "miercoles",
  1: "jueves",
  2: "jueves",
  9: "viernes",
  0: "viernes",
};

/** Última cifra numérica de la placa (ignora letras). null si no trae dígitos. */
export function ultimaCifraPlaca(placa?: string | null): number | null {
  if (!placa) return null;
  const digs = placa.replace(/\D/g, "");
  if (!digs) return null;
  return Number(digs[digs.length - 1]);
}

/** Engomado de la unidad por su placa, o null si no se puede determinar. */
export function engomadoDePlaca(placa?: string | null): Engomado | null {
  const c = ultimaCifraPlaca(placa);
  return c == null ? null : (ENGOMADO_POR_CIFRA[c] ?? null);
}

/** Día de "Hoy No Circula" para placa foránea (CDMX/Edomex) por su placa, o null. */
export function diaHoyNoCirculaForanea(placa?: string | null): DiaSemana | null {
  const c = ultimaCifraPlaca(placa);
  return c == null ? null : (DIA_HNC_POR_CIFRA[c] ?? null);
}
