/**
 * Aprobación operativa de Operaciones-GPA → ValidacionCarga de Fleet Command.
 *
 * Decisión de negocio (Navares, 2026-07-10): la validación de combustible se hace EN
 * ORIGEN — aprobar en Ops ES validar. El puente traduce ese estado al modelo de
 * auditoría de FC para que nadie trabaje dos veces:
 *
 *   status "Aprobada"     → verdictGlobal "ok"
 *   status "Rechazada"    → verdictGlobal "rechazada" (primera clase; decisión 2026-07-21 —
 *                           antes se traducía a "discrepancia" y el rechazo se perdía)
 *   status "Por corregir" → verdictGlobal "pendiente" (DEGRADA: estado retenido de Ops;
 *                           si el registro ya estaba "ok", dejarlo vivo lo contaría como
 *                           aprobado cuando ya no lo está)
 *   status "Pendiente"    → null (no se escribe; el cambio_estado llegará después)
 *   status "Anulado"      → null. NO se toca el veredicto: la fila `Anulacion` que escribe
 *                           el receptor ya excluye el registro de todo cálculo, y degradarlo
 *                           encima destruiría el veredicto real SIN versionarlo — al
 *                           restaurar volvería como "pendiente" en vez de "Validado · Ops".
 *
 * REGLA DE NO-PISADO (la aplica el receptor): un veredicto emitido por un humano EN
 * Fleet Command (fuenteDeteccion ≠ "ops-gpa") nunca se sobreescribe — tesorería
 * conserva la última palabra como auditoría selectiva.
 */
import { loadIdOf } from "../fuel/mapEntry";
import type { CargaCombustibleInput } from "./contract";
import { esStatusPorCorregir } from "./mapAnulacion";

/** Marcador de autoría del puente — es también la llave de la regla de no-pisado. */
export const OPS_FUENTE_DETECCION = "ops-gpa";

export interface ValidacionCargaInput {
  tenantId: string;
  loadId: string;
  // "pendiente" ya es un valor legal de FuelVerdictGlobal y está soportado en toda la UI
  // (VERDICTS_GLOBAL, VERDICT_PILL, VERDICT_RANK, filtro y clase de fila) → sin cambio de
  // esquema: ValidacionCarga.verdictGlobal es a.string().
  verdictGlobal: "ok" | "rechazada" | "pendiente";
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
  const porCorregir = esStatusPorCorregir(ops.status);
  // "Anulado" cae aquí y sale por null a propósito (ver cabecera).
  if (!aprobada && !rechazada && !porCorregir) return null;

  const quien = String(ops.autorizadoPor ?? "").trim();
  return {
    tenantId: carga.tenantId,
    loadId: loadIdOf(carga.economicoId, carga.tipo, carga.eventoId),
    verdictGlobal: aprobada ? "ok" : rechazada ? "rechazada" : "pendiente",
    // En "Por corregir" NO se estampa el nombre: la celda de validación pinta la pill
    // "Pendiente" más una sub-línea con `revisadoPor`, y un nombre ahí se lee como
    // "lo validó y está pendiente". El detalle va en la nota.
    revisadoPor: porCorregir || !quien ? "ops-gpa" : `${quien} · ops-gpa`,
    nota: aprobada
      ? "Aprobada en origen (Operaciones-GPA)"
      : rechazada
        ? "Rechazada en origen (Operaciones-GPA)"
        : // Único canal que ve tesorería: si valida a mano se persiste
          // fuenteDeteccion "manual" y por no-pisado la "Aprobada" final ya nunca entra.
          "Devuelta para corrección en Operaciones-GPA — no validar aquí; el veredicto final llega por el puente",
    ts: String(ops.fechaAut ?? carga.fechaHora ?? "") || undefined,
    fuenteDeteccion: OPS_FUENTE_DETECCION,
  };
}
