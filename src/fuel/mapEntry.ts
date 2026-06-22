/**
 * Mapeo PURO de filas cloud (CargaCombustible + ValidacionCarga) → FuelEntry para
 * el front. Sin DOM ni dependencias de Amplify (tipos laxos) → testeable con vitest.
 */
import type {
  FuelEntry,
  FuelPhoto,
  FuelReview,
  FuelTipo,
  FuelVerdictGlobal,
  FuelEvidenceKind,
  FuelVerdict,
} from "./types";

export interface CargaRow {
  economicoId: string;
  tipo: string;
  eventoId: string;
  placa?: string | null;
  sucursal?: string | null;
  tanque?: string | null;
  fecha?: string | null;
  fechaHora?: string | null;
  responsable?: string | null;
  kmCapturado?: number | null;
  nivelAntes?: string | null;
  nivelDeseado?: string | null;
  montoEstimado?: number | null;
  maxLitros?: number | null;
  litrosCargados?: number | null;
  precioPorLitro?: number | null;
  montoTotal?: number | null;
  seLlenoTanque?: string | null;
  datos?: unknown;
}

export interface ValidacionRow {
  loadId: string;
  verdictGlobal?: string | null;
  porEvidencia?: unknown;
  revisadoPor?: string | null;
  nota?: string | null;
  ts?: string | null;
  kmDetectado?: number | null;
  nivelDetectado?: string | null;
  litrosDetectado?: number | null;
  confianzaVision?: number | null;
  fuenteDeteccion?: string | null;
}

function safeObj(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** loadId estable: "economicoId|tipo|eventoId". */
export function loadIdOf(eco: string, tipo: string, eventoId: string): string {
  return `${eco}|${tipo}|${eventoId}`;
}

const VERDICTS_GLOBAL = new Set<FuelVerdictGlobal>(["ok", "discrepancia", "pendiente"]);
const VERDICTS = new Set<FuelVerdict>(["ok", "warn", "bad", "pendiente"]);

/** Clasifica una foto (por su dataName/col de MoreApp) a un tipo de evidencia. */
export function evidenceKindOf(col: string): FuelEvidenceKind {
  const c = col.toLowerCase();
  // Horómetro (montacargas) = lectura de horas/odómetro de la solicitud.
  if (c.includes("horometro") || c.includes("odometro")) return "odometro";
  // fotoMedidorDeCombustible y fotoDelMedidorAntesDeCargar = nivel de combustible.
  if (c.includes("medidor")) return "medidor";
  if (c.includes("ticket")) return "ticket";
  if (c.includes("bomba")) return "bomba";
  if (c.includes("signature") || c.includes("firma")) return "firma";
  return "unidad";
}

function mapReview(v: ValidacionRow | undefined): FuelReview | undefined {
  if (!v) return undefined;
  const porEvRaw = safeObj(v.porEvidencia);
  const porEvidencia: Partial<Record<FuelEvidenceKind, FuelVerdict>> = {};
  for (const [k, val] of Object.entries(porEvRaw)) {
    if (VERDICTS.has(val as FuelVerdict)) porEvidencia[k as FuelEvidenceKind] = val as FuelVerdict;
  }
  const vg = String(v.verdictGlobal ?? "pendiente");
  return {
    verdictGlobal: VERDICTS_GLOBAL.has(vg as FuelVerdictGlobal)
      ? (vg as FuelVerdictGlobal)
      : "pendiente",
    porEvidencia,
    revisadoPor: v.revisadoPor ?? undefined,
    nota: v.nota ?? undefined,
    ts: v.ts ?? undefined,
    kmDetectado: num(v.kmDetectado),
    nivelDetectado: v.nivelDetectado ?? undefined,
    litrosDetectado: num(v.litrosDetectado),
    confianzaVision: num(v.confianzaVision),
    fuenteDeteccion: v.fuenteDeteccion === "ia" ? "ia" : v.fuenteDeteccion ? "manual" : undefined,
  };
}

/** Mapea una fila CargaCombustible (+ su validación) a FuelEntry. */
export function mapCargaToFuelEntry(row: CargaRow, val?: ValidacionRow): FuelEntry {
  const datos = safeObj(row.datos);
  const tipo: FuelTipo = row.tipo === "solicitud" ? "solicitud" : "carga";
  const photosRaw = Array.isArray(datos.photos) ? (datos.photos as unknown[]) : [];
  const photos: FuelPhoto[] = photosRaw
    .map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      return {
        fname: String(o.fname ?? ""),
        col: String(o.col ?? ""),
        group: String(o.group ?? ""),
      };
    })
    .filter((p) => p.fname);
  const ubic = safeObj(datos.ubicacionDeCarga);
  const ubicacion = typeof ubic.formattedValue === "string" ? ubic.formattedValue : undefined;

  return {
    loadId: loadIdOf(row.economicoId, tipo, row.eventoId),
    tipo,
    eco: row.economicoId,
    eventoId: row.eventoId,
    placa: row.placa ?? undefined,
    sucursal: row.sucursal ?? "",
    tanque: row.tanque ?? undefined,
    fecha: row.fecha ?? "",
    fechaHora: row.fechaHora ?? undefined,
    responsable: row.responsable ?? undefined,
    km: num(row.kmCapturado),
    tipoUnidad: typeof datos.combustible === "string" ? datos.combustible : undefined,
    combustible: typeof datos.combustible === "string" ? datos.combustible : undefined,
    producto: typeof datos.producto === "string" ? datos.producto : undefined,
    nivelAntes: row.nivelAntes ?? undefined,
    nivelDeseado: row.nivelDeseado ?? undefined,
    montoEstimado: num(row.montoEstimado),
    maxLitros: num(row.maxLitros),
    litros: num(row.litrosCargados),
    precioPorLitro: num(row.precioPorLitro),
    monto: num(row.montoTotal),
    seLlenoTanque: row.seLlenoTanque ?? undefined,
    ubicacion,
    photos,
    review: mapReview(val),
  };
}

/** Construye los FuelEntry mergeando cargas con sus validaciones (por loadId). */
export function buildFuelEntries(
  rows: readonly CargaRow[],
  validaciones: readonly ValidacionRow[] = [],
): FuelEntry[] {
  const valByLoad = new Map<string, ValidacionRow>();
  for (const v of validaciones) valByLoad.set(v.loadId, v);
  return rows.map((r) =>
    mapCargaToFuelEntry(r, valByLoad.get(loadIdOf(r.economicoId, r.tipo, r.eventoId))),
  );
}
