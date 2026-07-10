/**
 * Envelope canónico del puente — contrato gpa.ops.v1 tal como lo emite el publisher
 * REAL (Eco-Admin `operaciones-gpa` @ e7c3d25, `bridge/publisher.py::construir_evento`).
 *
 * El publisher desarma el registro plano de la tabla: promueve identidad/responsable/
 * fecha/sucursal al envelope y deja el resto de campos de negocio en `answers`
 * (incluido `formato:"reporte"`, el discriminador solicitud/carga). Este módulo hace
 * la operación inversa — `toOpsRecord()` reconstruye el registro plano — para que los
 * adaptadores ya probados (`mapCombustible`, etc.) funcionen sin cambios.
 *
 * También implementa la verificación de firma con los headers del publisher real:
 * `X-GPA-Timestamp` + `X-GPA-Firma`, donde firma = HMAC_SHA256(secret, `${ts}.${body}`)
 * en hex — verificada SIEMPRE sobre el cuerpo crudo recibido, byte a byte.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { OpsCargaRecord, OpsClRecord, OpsSolRecord } from "./contract";

export const CONTRATO = "gpa.ops.v1";
export const TOLERANCIA_REPLAY_S = 300;

/** Envelope emitido por el publisher (campos según construir_evento de e7c3d25). */
export interface GpaOpsEvento {
  version: number;
  contrato: string;
  tipo: "SOL" | "CL" | string;
  subtipo: string | null; // CL: "semanal" | "mensual"; SOL: null
  evento: "creacion" | "cambio_estado" | string;
  registroId: string;
  folio: string; // "OPS-<registroId>"
  fechaISO: string;
  sucursal: string | null;
  unidad: { vehicleId?: string | null; economico?: string | null; placas?: string | null };
  responsable: {
    nombre?: string | null;
    userId?: string | number | null;
    accountId?: string | null;
  };
  status?: string | null;
  answers: Record<string, unknown>; // resto de campos de negocio (incluye `formato`)
  evidencias: Array<{ campo: string; key: string }>;
  firma?: string | null; // key S3 de la firma manuscrita (va aparte de answers)
  bucketOrigen?: string;
  emitidoEn?: string;
}

/** Validación estructural mínima. Lista de errores; vacía = válido. */
export function validarEvento(ev: Partial<GpaOpsEvento>): string[] {
  const errores: string[] = [];
  if (ev?.contrato !== CONTRATO) errores.push(`contrato desconocido: ${String(ev?.contrato)}`);
  if (!["creacion", "cambio_estado"].includes(String(ev?.evento))) {
    errores.push(`evento inválido: ${String(ev?.evento)}`);
  }
  if (!["SOL", "CL"].includes(String(ev?.tipo)))
    errores.push(`tipo no implementado: ${String(ev?.tipo)}`);
  if (!ev?.registroId || !String(ev?.folio ?? "").startsWith("OPS-")) {
    errores.push("registroId/folio inválidos");
  }
  if (!ev?.answers || typeof ev.answers !== "object") errores.push("answers ausente");
  if (!ev?.unidad || (!ev.unidad.economico && !ev.unidad.placas)) errores.push("unidad sin llaves");
  return errores;
}

/**
 * Envelope → registro plano de Operaciones-GPA (la forma que esperan los adaptadores).
 * Inversa exacta de `construir_evento`: answers de vuelta al top-level + los campos
 * promovidos restaurados a sus nombres originales de la tabla.
 */
export function toOpsRecord(ev: GpaOpsEvento): OpsSolRecord | OpsCargaRecord | OpsClRecord {
  const plano: Record<string, unknown> = {
    ...ev.answers,
    tipo_reg: ev.tipo,
    id: ev.registroId,
    fecha: ev.fechaISO,
    sucursal: ev.sucursal ?? undefined,
    status: ev.status ?? (ev.answers.status as string | undefined),
    vehicleId: ev.unidad?.vehicleId ?? undefined,
    economico: ev.unidad?.economico ?? undefined,
    placas: ev.unidad?.placas ?? undefined,
    responsable: ev.responsable?.nombre ?? undefined,
    userId: ev.responsable?.userId ?? undefined,
    accountId: ev.responsable?.accountId ?? undefined,
  };
  if (ev.firma) plano.firma = ev.firma;
  // CL: el publisher promueve el subtipo (semanal/mensual); el registro plano lo
  // llama `tipo`. answers puede traerlo también — el envelope manda.
  if (ev.tipo === "CL" && ev.subtipo) plano.tipo = ev.subtipo;
  return plano as OpsSolRecord | OpsCargaRecord | OpsClRecord;
}

/**
 * Verifica los headers del publisher real sobre el cuerpo crudo.
 * `X-GPA-Timestamp: <epoch-s>` · `X-GPA-Firma: <hex64>` · ventana anti-replay ±300 s.
 */
export function verificarFirma(
  timestamp: string | undefined,
  firmaHex: string | undefined,
  cuerpoCrudo: string,
  secret: string,
  ahoraEpochS: number = Math.floor(Date.now() / 1000),
): { ok: boolean; motivo?: string } {
  if (!secret) return { ok: false, motivo: "receptor sin secreto configurado" };
  if (!timestamp || !firmaHex) return { ok: false, motivo: "faltan headers de firma" };
  if (!/^\d+$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(firmaHex)) {
    return { ok: false, motivo: "formato de firma inválido" };
  }
  if (Math.abs(ahoraEpochS - Number(timestamp)) > TOLERANCIA_REPLAY_S) {
    return { ok: false, motivo: `fuera de ventana anti-replay (±${TOLERANCIA_REPLAY_S}s)` };
  }
  const esperado = createHmac("sha256", secret).update(`${timestamp}.${cuerpoCrudo}`).digest("hex");
  const a = Buffer.from(firmaHex, "hex");
  const b = Buffer.from(esperado, "hex");
  return a.length === b.length && timingSafeEqual(a, b)
    ? { ok: true }
    : { ok: false, motivo: "firma no coincide" };
}
