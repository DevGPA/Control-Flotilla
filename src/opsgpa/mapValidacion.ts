/**
 * Aprobación operativa de Operaciones-GPA → ValidacionCarga de Fleet Command.
 *
 * Decisión de negocio (Navares, 2026-07-10): la validación de combustible se hace EN
 * ORIGEN — aprobar en Ops ES validar. El puente traduce ese estado al modelo de
 * auditoría de FC para que nadie trabaje dos veces:
 *
 *   status "Aprobada"  → verdictGlobal "ok"
 *   status "Rechazada" → verdictGlobal "rechazada" (primera clase; decisión 2026-07-21 —
 *                        antes se traducía a "discrepancia" y el rechazo se perdía)
 *   status "Pendiente" → null (no se escribe; el cambio_estado llegará después)
 *
 * REGLA DE NO-PISADO (la aplica el receptor): un veredicto emitido por un humano EN
 * Fleet Command (fuenteDeteccion ≠ "ops-gpa") nunca se sobreescribe — tesorería
 * conserva la última palabra como auditoría selectiva.
 */
import { loadIdOf } from "../fuel/mapEntry";
import type { CargaCombustibleInput } from "./contract";

/** Marcador de autoría del puente — es también la llave de la regla de no-pisado. */
export const OPS_FUENTE_DETECCION = "ops-gpa";

export interface ValidacionCargaInput {
  tenantId: string;
  loadId: string;
  verdictGlobal: "ok" | "rechazada";
  revisadoPor: string;
  nota: string;
  ts?: string;
  fuenteDeteccion: string;
}

/**
 * Deriva la validación desde el registro plano de Ops. `null` = sin veredicto aún
 * (el registro queda "pendiente" en FC hasta que llegue su cambio_estado).
 */
export function mapValidacion(
  ops: { status?: unknown; autorizadoPor?: unknown; fechaAut?: unknown },
  carga: Pick<
    CargaCombustibleInput,
    "tenantId" | "economicoId" | "tipo" | "eventoId" | "fechaHora"
  >,
): ValidacionCargaInput | null {
  const st = String(ops.status ?? "")
    .trim()
    .toLowerCase();
  // Tolerante a género/variantes: "Aprobada"/"Aprobado", "Rechazada"/"Rechazado".
  const aprobada = st.startsWith("aproba");
  const rechazada = st.startsWith("rechaza");
  if (!aprobada && !rechazada) return null;

  const quien = String(ops.autorizadoPor ?? "").trim();
  return {
    tenantId: carga.tenantId,
    loadId: loadIdOf(carga.economicoId, carga.tipo, carga.eventoId),
    verdictGlobal: aprobada ? "ok" : "rechazada",
    revisadoPor: quien ? `${quien} · ops-gpa` : "ops-gpa",
    nota: aprobada
      ? "Aprobada en origen (Operaciones-GPA)"
      : "Rechazada en origen (Operaciones-GPA)",
    ts: String(ops.fechaAut ?? carga.fechaHora ?? "") || undefined,
    fuenteDeteccion: OPS_FUENTE_DETECCION,
  };
}
