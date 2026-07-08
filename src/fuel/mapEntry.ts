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
import { ecoKey } from "./tokaLayout";

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

/**
 * Deriva la categoría de unidad desde `producto` (fiable) y `combustible` (no fiable:
 * los montacargas Gas LP traen combustible="Gasolina"). "GAS LP" en el producto ⇒
 * montacargas (su kilometraje es horómetro, no odómetro → sin km/l).
 */
export function deriveTipo(
  producto: string,
  combustible: string,
): { tipoUnidad: string; esMontacargas: boolean } {
  const p = producto.toLowerCase();
  const c = combustible.toLowerCase();
  if (p.includes("gas lp") || c.includes("gas lp"))
    return { tipoUnidad: "Gas LP (montacargas)", esMontacargas: true };
  if (p.includes("diesel") || c.includes("diesel"))
    return { tipoUnidad: "Diesel", esMontacargas: false };
  if (p.includes("premium")) return { tipoUnidad: "Gasolina Premium", esMontacargas: false };
  if (p.includes("magna")) return { tipoUnidad: "Gasolina Magna", esMontacargas: false };
  return { tipoUnidad: combustible || "(sin tipo)", esMontacargas: false };
}

/**
 * Clase de unidad para el comparativo "vs su tipo" y el ranking por desviación: cruza la
 * CAPACIDAD DE TANQUE (proxy de clase de vehículo — hay un hueco duro real 70↔110 L en la flota,
 * así que ≤70 = Ligero, ≥110 = Pesado) con el COMBUSTIBLE fiable (el tipoUnidad de deriveTipo).
 * Reemplaza al tipo-por-producto, que mezclaba pesados con ligeros y hacía que un Premium pesado
 * sano saliera falsamente "peor de su tipo". Los montacargas conservan su tipo (km = horómetro).
 * NO se usa para el layout Toka (que lee `producto`), solo para agrupar el rendimiento.
 */
export function classByTankAndFuel(
  tanque: string | null | undefined,
  tipoUnidad: string,
  esMontacargas: boolean,
): string {
  if (esMontacargas) return tipoUnidad;
  const n = parseFloat(String(tanque ?? ""));
  if (!Number.isFinite(n) || n <= 0) return tipoUnidad; // sin capacidad fiable → conserva el tipo por combustible
  const tamano = n <= 70 ? "Ligero" : "Pesado";
  const comb =
    tipoUnidad === "Diesel"
      ? "Diesel"
      : tipoUnidad === "Gasolina Premium"
        ? "Premium"
        : tipoUnidad === "Gasolina Magna"
          ? "Magna"
          : tipoUnidad;
  return `${tamano} ${comb}`;
}

/**
 * Extrae texto y coordenadas del widget location de MoreApp (`ubicacionDeCarga`).
 * Forma real observada: { coordinates: {latitude, longitude}, location: {...}, formattedValue }.
 * Tolera variantes (location.latitude/longitude, lat/lng planos, números como string) y cae a
 * parsear "lat,lng" del formattedValue. Coordenadas fuera de rango → solo texto.
 */
export function parseUbicacion(raw: unknown): { texto?: string; lat?: number; lng?: number } {
  const o = safeObj(raw);
  const texto =
    typeof o.formattedValue === "string" && o.formattedValue ? o.formattedValue : undefined;
  const coord = (v: unknown): number | undefined => {
    const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  const candidates = [safeObj(o.coordinates), safeObj(o.location), o];
  for (const c of candidates) {
    const lat = coord(c.latitude ?? c.lat);
    const lng = coord(c.longitude ?? c.lng);
    if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)
      return { texto, lat, lng };
  }
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(texto ?? "");
  if (m) {
    const lat = parseFloat(m[1]!);
    const lng = parseFloat(m[2]!);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { texto, lat, lng };
  }
  return { texto };
}

/**
 * Normaliza la submarca del catálogo para mostrar/agrupar: colapsa espacios y recorta.
 * Conserva el casing original (es la etiqueta visible); el agrupador del ranking
 * compara case-insensitive por su cuenta.
 */
export function normSubmarca(s: string | null | undefined): string | undefined {
  const v = String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return v || undefined;
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

/** Datos de la unidad del catálogo que se anexan a cada carga (join por economicoId). */
export type UnidadJoin = { submarca?: string };

/** Mapea una fila CargaCombustible (+ su validación) a FuelEntry. */
export function mapCargaToFuelEntry(
  row: CargaRow,
  val?: ValidacionRow,
  unidad?: UnidadJoin,
): FuelEntry {
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
  const ubic = parseUbicacion(datos.ubicacionDeCarga);
  const producto = typeof datos.producto === "string" ? datos.producto : "";
  const combustible = typeof datos.combustible === "string" ? datos.combustible : "";
  const { tipoUnidad, esMontacargas } = deriveTipo(producto, combustible);
  // Clase para el comparativo "vs su tipo": tanque × combustible (ver classByTankAndFuel).
  const clase = classByTankAndFuel(row.tanque, tipoUnidad, esMontacargas);

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
    tipoUnidad: clase,
    submarca: normSubmarca(unidad?.submarca),
    combustible: combustible || undefined,
    producto: producto || undefined,
    esMontacargas,
    nivelAntes: row.nivelAntes ?? undefined,
    nivelDeseado: row.nivelDeseado ?? undefined,
    montoEstimado: num(row.montoEstimado),
    maxLitros: num(row.maxLitros),
    litros: num(row.litrosCargados),
    precioPorLitro: num(row.precioPorLitro),
    monto: num(row.montoTotal),
    seLlenoTanque: row.seLlenoTanque ?? undefined,
    formCerrado: typeof datos.formCerrado === "string" ? datos.formCerrado : undefined,
    ubicacion: ubic.texto,
    ubicacionLatLng:
      ubic.lat != null && ubic.lng != null ? { lat: ubic.lat, lng: ubic.lng } : undefined,
    photos,
    review: mapReview(val),
  };
}

/**
 * Construye los FuelEntry mergeando cargas con sus validaciones (por loadId) y el catálogo
 * de unidades (por economicoId, claves normalizadas con ecoKey: "06"↔"6"). El join de
 * `unidadPorEco` es VIVO: cambiar la submarca en el catálogo re-clasifica el histórico.
 */
export function buildFuelEntries(
  rows: readonly CargaRow[],
  validaciones: readonly ValidacionRow[] = [],
  unidadPorEco?: ReadonlyMap<string, UnidadJoin>,
): FuelEntry[] {
  const valByLoad = new Map<string, ValidacionRow>();
  for (const v of validaciones) valByLoad.set(v.loadId, v);
  // Re-keyea el catálogo con ecoKey para que "06" (catálogo) case con "6" (cargas).
  const unidadByKey = new Map<string, UnidadJoin>();
  if (unidadPorEco)
    for (const [eco, u] of unidadPorEco) {
      const k = ecoKey(eco);
      if (k && !unidadByKey.has(k)) unidadByKey.set(k, u);
    }
  return rows.map((r) =>
    mapCargaToFuelEntry(
      r,
      valByLoad.get(loadIdOf(r.economicoId, r.tipo, r.eventoId)),
      unidadByKey.get(ecoKey(r.economicoId)),
    ),
  );
}
