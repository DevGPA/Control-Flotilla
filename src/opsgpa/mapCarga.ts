/**
 * Adaptador: "reporte de carga" de Operaciones-GPA → input idempotente de
 * `CargaCombustible` (tipo=carga) de Fleet Command. Espeja `processCarga` del webhook.
 *
 * Incluye `mapCombustible`, el despachador que clasifica cualquier registro de combustible
 * de Ops (todos `tipo_reg="SOL"`) en solicitud o carga y aplica el adaptador correcto.
 *
 * Nota de validación: al 2026-07-09 no hay ningún "reporte de carga" real en Ops (los 9
 * registros SOL son solicitudes). Este adaptador está construido contra el CONTRATO del
 * frontend (`RepForm`, index.html) y probado con un fixture representativo; re-validar
 * contra el primer reporte real cuando exista.
 */
import { normSucursal, parseKm, parseNum } from "../fuel/parse";
import {
  OPS_SOURCE,
  OPS_TENANT_ID,
  opsEventoId,
  esReporteDeCarga,
  type CargaCombustibleInput,
  type EvidenceResolver,
  type FcPhotoRef,
  type OpsCargaRecord,
  type OpsSolRecord,
} from "./contract";
import { mapSolicitud } from "./mapSolicitud";

/** Añade una referencia de evidencia si la clave S3 existe. */
function pushPhoto(
  photos: FcPhotoRef[],
  key: unknown,
  group: string,
  col: string,
  r: EvidenceResolver,
) {
  if (typeof key === "string" && key) photos.push({ group, col, fname: r(key) });
}

export function mapCarga(
  ops: OpsCargaRecord,
  resolveFname: EvidenceResolver,
): CargaCombustibleInput {
  const economicoId = String(ops.economico ?? "").trim();
  if (!economicoId) throw new Error(`Carga ${ops.id}: registro sin económico — no mapeable`);

  const photos: FcPhotoRef[] = [];
  pushPhoto(photos, ops.fotoAntes, "Carga", "fotoAntes", resolveFname);
  pushPhoto(photos, ops.fotoDespues, "Carga", "fotoDespues", resolveFname);
  pushPhoto(photos, ops.fotoBomba, "Carga", "fotoBomba", resolveFname);
  pushPhoto(photos, ops.fotoTicket, "Carga", "fotoTicket", resolveFname);
  pushPhoto(photos, ops.fotoPersona, "Carga", "fotoPersona", resolveFname);
  pushPhoto(photos, ops.firma, "Firma", "firma", resolveFname);

  const datos = {
    photos,
    ubicacionDeCarga: ops.ubicacion ?? null,
    producto: String(ops.producto ?? ""),
    combustible: String(ops.combustible ?? ""),
    precioCatalogo: ops.precio != null ? String(ops.precio) : "",
    observaciones: String(ops.obs ?? ""),
    sucursalRaw: String(ops.sucursal ?? ""),
    areaResponsable: String(ops.areaResponsable ?? ""),
    fuente: OPS_SOURCE,
    opsId: ops.id,
    opsStatus: ops.status ?? null,
    mail: String(ops.mail ?? ""),
  };

  return {
    tenantId: OPS_TENANT_ID,
    economicoId,
    tipo: "carga",
    eventoId: opsEventoId(ops.id),
    placa: ops.placas ? String(ops.placas) : undefined,
    sucursal: normSucursal(ops.sucursal),
    tanque: ops.tanque != null ? String(ops.tanque) : undefined,
    fecha: String(ops.fecha).split(/[ T]/)[0] || String(ops.fecha),
    fechaHora: String(ops.fecha) || undefined,
    responsable: ops.responsable ? String(ops.responsable).trim() : undefined,
    kmCapturado: parseKm(ops.km),
    // Medición real de la carga (los insumos que el motor km/l consume):
    litrosCargados: parseNum(ops.litros),
    precioPorLitro: parseNum(ops.precioLitro),
    montoTotal: parseNum(ops.monto),
    // El frontend emite "Si"/"No"; el golden del contrato usa booleano. Toleramos
    // ambos y normalizamos al vocabulario que el motor km/l compara (=== "Si").
    seLlenoTanque:
      typeof ops.lleno === "boolean"
        ? ops.lleno
          ? "Si"
          : "No"
        : ops.lleno
          ? String(ops.lleno)
          : undefined,
    datos: JSON.stringify(datos),
  };
}

/**
 * Despachador: dado cualquier registro de combustible de Ops (tipo_reg="SOL"), decide si
 * es solicitud o carga y devuelve el input de CargaCombustible correspondiente.
 */
export function mapCombustible(
  ops: OpsSolRecord | OpsCargaRecord,
  resolveFname: EvidenceResolver,
): CargaCombustibleInput {
  return esReporteDeCarga(ops)
    ? mapCarga(ops as OpsCargaRecord, resolveFname)
    : mapSolicitud(ops as OpsSolRecord, resolveFname);
}
