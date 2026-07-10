/**
 * Adaptador: registro SOL (solicitud de combustible) de Operaciones-GPA →
 * input idempotente de `CargaCombustible` (tipo=solicitud) de Fleet Command.
 *
 * PURO y testeable: las evidencias se resuelven vía `resolveFname` (el orquestador la
 * implementa copiando S3→S3 desde el bucket de Ops al de Fleet Command). Reutiliza el
 * parser de `src/fuel/parse` — la misma normalización que el webhook de MoreApp, para que
 * los registros de ambas fuentes queden homogéneos en la tabla.
 *
 * Espeja el input que arma `processSolicitud` en el webhook (handler.ts) para que el
 * upsert idempotente por (tenantId, economicoId, tipo, eventoId) funcione idéntico.
 */
import { normSucursal, parseKm, parseNum } from "../fuel/parse";
import {
  OPS_SOURCE,
  OPS_TENANT_ID,
  opsEventoId,
  type CargaCombustibleInput,
  type EvidenceResolver,
  type FcPhotoRef,
  type OpsSolRecord,
} from "./contract";

/**
 * Puente de vocabulario: Operaciones-GPA guarda el nivel de tanque como fracción (0..1);
 * MoreApp lo mandaba como etiqueta de texto. Normalizamos a porcentaje legible ("50%").
 * El valor crudo se conserva además en `datos.tankBefore/tankAfter` para no perder precisión.
 */
export function nivelLabel(frac: number | undefined | null): string | undefined {
  if (frac == null || !Number.isFinite(frac)) return undefined;
  return `${Math.round(frac * 100)}%`;
}

export function mapSolicitud(
  ops: OpsSolRecord,
  resolveFname: EvidenceResolver,
): CargaCombustibleInput {
  const economicoId = String(ops.economico ?? "").trim();
  if (!economicoId) throw new Error(`SOL ${ops.id}: registro sin económico — no mapeable`);

  const photos: FcPhotoRef[] = [];
  if (ops.photo) photos.push({ group: "Evidencia", col: "foto", fname: resolveFname(ops.photo) });
  if (ops.firma) photos.push({ group: "Firma", col: "firma", fname: resolveFname(ops.firma) });

  const datos = {
    photos,
    producto: String(ops.producto ?? ""),
    combustible: String(ops.combustible ?? ""),
    precioCatalogo: ops.precio != null ? String(ops.precio) : "",
    observaciones: String(ops.obs ?? ""),
    sucursalRaw: String(ops.sucursal ?? ""),
    fuente: OPS_SOURCE,
    opsId: ops.id,
    opsStatus: ops.status ?? null,
    tankBefore: ops.tankBefore ?? null,
    tankAfter: ops.tankAfter ?? null,
    necesidad: ops.necesidad ?? null,
    mail: String(ops.mail ?? ""),
  };

  return {
    tenantId: OPS_TENANT_ID,
    economicoId,
    tipo: "solicitud",
    eventoId: opsEventoId(ops.id),
    placa: ops.placas ? String(ops.placas) : undefined,
    sucursal: normSucursal(ops.sucursal),
    tanque: ops.tanque != null ? String(ops.tanque) : undefined,
    fecha: String(ops.fecha).split(/[ T]/)[0] || String(ops.fecha),
    fechaHora: String(ops.fecha) || undefined,
    responsable: ops.responsable ? String(ops.responsable).trim() : undefined,
    kmCapturado: parseKm(ops.km),
    nivelAntes: nivelLabel(ops.tankBefore),
    nivelDeseado: nivelLabel(ops.tankAfter),
    montoEstimado: parseNum(ops.monto),
    maxLitros: parseNum(ops.litros),
    datos: JSON.stringify(datos),
  };
}
