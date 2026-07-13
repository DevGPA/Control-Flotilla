/**
 * Construcción PURA del export "Solicitudes (Excel)" — réplica del layout Submissions
 * de MoreApp con el que Tesorería curó siempre la dispersión de combustible
 * ("CARGA DE GASOLINA <fecha>.xlsx"). Sin DOM ni xlsx — solo FuelEntry[] → filas.
 *
 * Con el piloto de Operaciones-GPA el export de MoreApp dejó de cubrir Monterrey/Cedis;
 * este layout sale de la app, que tiene AMBAS fuentes (spec:
 * docs/superpowers/specs/2026-07-13-solicitudes-layout-design.md).
 *
 * Fidelidad: mismos 30 encabezados y orden que MoreApp (grafía literal, incluidos el
 * doble espacio de "Foto  de kilometraje…" y "montarcargas"). Lo que la nube no guarda
 * queda vacío: By/MAIL (solo registros OPS), Location, Summary, id del solicitante.
 * A diferencia de MoreApp, montos/precios/necesidad van como NÚMERO y On/Fecha y Hora
 * como Date (editables en Excel sin convertir).
 */
import type { FuelEntry, FuelPhoto } from "./types";
import { evidenceKindOf } from "./mapEntry";
import { tzOffsetDeSucursal } from "./fuelAggregates";

export const SOLICITUDES_HEADER = [
  "Serial Number",
  "By",
  "On",
  "Summary",
  "Location - Latitude",
  "Location - Longitude",
  "Fecha y Hora",
  "# Economico - id",
  "# Economico - PLACAS",
  "# Economico - SUBMARCA",
  "# Economico - SUCURSAL",
  "# Economico - TANQUE",
  "# Economico - RESPONSABLE",
  "# Economico - combustible",
  "# Economico - precio",
  "Kilometraje",
  "Foto  de kilometraje y medidor de combustible al realizar esta solicitud (en la misma foto)",
  "Foto de horometro (montarcargas)",
  "Nivel del tanque antes de cargar (mas cercano)",
  "Nivel del tanque deseado",
  "Necesidad de gasolina (parte del tanque)",
  "Precio estimado x litros",
  "Maximo litros a cargar",
  "Monto a cargar ($)",
  "Observaciones",
  "Nombre del Solicitante - id",
  "Nombre del Solicitante - RESPONSABLE",
  "Nombre del Solicitante - MAIL",
  "Firma del Solicitante",
  "Email para notificar (no cambiar)",
] as const;

/** Celda del layout: texto, número editable o fecha real de Excel ("" = sin dato). */
export type SolicitudCell = string | number | Date;

export type SolicitudesLayoutResult = {
  rows: SolicitudCell[][];
  incluidas: number;
  totalMonto: number;
};

/**
 * Hora LOCAL de la captura como Date de componentes locales (lo que Excel muestra tal
 * cual). Toma el wall-clock del string y DESCARTA el offset: MoreApp ("2026-07-13 07:23")
 * ya viene en hora del dispositivo y OPS ("…T08:46:50-06:00") en hora de la sucursal.
 */
function fechaHoraLocal(s: string | undefined): Date | "" {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s ?? "");
  if (!m) return "";
  return new Date(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
}

/**
 * Instante ISO (con Z u offset) → Date con el wall-clock de la SUCURSAL (columna "On":
 * formCerrado viene en UTC; mostrado sin convertir confundiría a Tesorería).
 */
function wallClockDeSucursal(iso: string | undefined, sucursal: string): Date | "" {
  const ms = Date.parse(iso ?? "");
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + tzOffsetDeSucursal(sucursal) * 3_600_000);
  return new Date(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
  );
}

/** "Logística" → "LOGISTICA": mayúsculas sin acentos, como el RESPONSABLE de MoreApp. */
function areaMayusculas(area: string | undefined): string {
  return (area ?? "").normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
}

/** Primera foto del tipo pedido ("" si no hay). */
function foto(photos: readonly FuelPhoto[], ...kinds: string[]): string {
  return photos.find((p) => kinds.includes(evidenceKindOf(p.col)))?.fname ?? "";
}

/** Folio como en MoreApp: numérico puro → número; OPS-… y demás → texto. */
function serial(eventoId: string): string | number {
  return /^\d+$/.test(eventoId) ? parseInt(eventoId, 10) : eventoId;
}

/** Ms del evento para ORDENAR cronológicamente (mezcla formatos MoreApp y OPS). */
function tsMs(e: FuelEntry): number {
  const d = fechaHoraLocal(e.fechaHora || e.fecha);
  return d === "" ? 0 : d.getTime();
}

/** Selección compartida por layout y vista: solicitudes vigentes en orden cronológico. */
function solicitudesVigentes(entries: readonly FuelEntry[]): FuelEntry[] {
  return entries
    .filter((e) => e.tipo === "solicitud" && !e.anulada)
    .sort((a, b) => tsMs(a) - tsMs(b) || a.eventoId.localeCompare(b.eventoId));
}

/**
 * Arma el layout: una fila por SOLICITUD vigente (cargas y anuladas fuera), en orden
 * cronológico ascendente como el export de MoreApp.
 */
export function buildSolicitudesLayout(entries: readonly FuelEntry[]): SolicitudesLayoutResult {
  const solicitudes = solicitudesVigentes(entries);

  const rows = solicitudes.map((e): SolicitudCell[] => [
    serial(e.eventoId),
    e.mailSolicitante ?? "",
    wallClockDeSucursal(e.formCerrado ?? e.fechaHora, e.sucursal),
    "",
    e.ubicacionLatLng?.lat ?? "",
    e.ubicacionLatLng?.lng ?? "",
    fechaHoraLocal(e.fechaHora || e.fecha),
    e.eco,
    e.placa ?? "",
    e.submarca ?? "",
    e.sucursal,
    e.tanque ?? "",
    areaMayusculas(e.area),
    e.combustible ?? "",
    e.precioCatalogo ?? "",
    e.km ?? "",
    foto(e.photos, "medidor", "unidad"),
    foto(e.photos, "odometro"),
    e.nivelAntes ?? "",
    e.nivelDeseado ?? "",
    e.necesidad ?? "",
    e.precioCatalogo ?? "",
    e.maxLitros ?? "",
    e.montoEstimado ?? "",
    e.observaciones ?? "",
    "",
    e.responsable ?? "",
    e.mailSolicitante ?? "",
    foto(e.photos, "firma"),
    e.emailNotificar ?? "",
  ]);

  return {
    rows,
    incluidas: rows.length,
    totalMonto: solicitudes.reduce((s, e) => s + (e.montoEstimado ?? 0), 0),
  };
}

/** Header + filas para XLSX.utils.aoa_to_sheet (con cellDates para On/Fecha y Hora). */
export function solicitudesLayoutToAoa(result: SolicitudesLayoutResult): SolicitudCell[][] {
  return [[...SOLICITUDES_HEADER], ...result.rows];
}

/** Fila LEGIBLE de la hoja de trabajo "Solicitudes" (formato profesional). */
export type SolicitudVista = {
  folio: string | number;
  fechaHora: Date | "";
  sucursal: string;
  eco: string;
  placa: string;
  submarca: string;
  area: string; // legible, con acento ("Logística") — no la grafía MoreApp
  combustible: string;
  nivelAntes: string;
  nivelDeseado: string;
  necesidad: number | ""; // fracción 0–1; el % lo pinta el formato de Excel
  precio: number | "";
  maxLitros: number | "";
  monto: number | "";
  observaciones: string;
  solicitante: string;
  /** Origen del registro — hace visibles los duplicados MoreApp↔OPS del piloto. */
  fuente: "MoreApp" | "Operaciones-GPA";
};

export type SolicitudesVistaResult = {
  filas: SolicitudVista[];
  incluidas: number;
  totalMonto: number;
};

/** Mismas solicitudes/orden que el layout, pero como objetos tipados para la vista. */
export function buildSolicitudesVista(entries: readonly FuelEntry[]): SolicitudesVistaResult {
  const solicitudes = solicitudesVigentes(entries);
  const filas = solicitudes.map(
    (e): SolicitudVista => ({
      folio: serial(e.eventoId),
      fechaHora: fechaHoraLocal(e.fechaHora || e.fecha),
      sucursal: e.sucursal,
      eco: e.eco,
      placa: e.placa ?? "",
      submarca: e.submarca ?? "",
      area: e.area ?? "",
      combustible: e.combustible ?? "",
      nivelAntes: e.nivelAntes ?? "",
      nivelDeseado: e.nivelDeseado ?? "",
      necesidad: e.necesidad ?? "",
      precio: e.precioCatalogo ?? "",
      maxLitros: e.maxLitros ?? "",
      monto: e.montoEstimado ?? "",
      observaciones: e.observaciones ?? "",
      solicitante: e.responsable ?? "",
      fuente: e.eventoId.startsWith("OPS-") ? "Operaciones-GPA" : "MoreApp",
    }),
  );
  return {
    filas,
    incluidas: filas.length,
    totalMonto: solicitudes.reduce((s, e) => s + (e.montoEstimado ?? 0), 0),
  };
}
