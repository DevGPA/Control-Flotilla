import type { RiskLevel } from "../types";

/** Tipo de registro de combustible (los 2 formularios de MoreApp). */
export type FuelTipo = "solicitud" | "carga";

/** Tipo de evidencia fotográfica, para emparejar foto ↔ campo capturado. */
export type FuelEvidenceKind = "odometro" | "medidor" | "ticket" | "bomba" | "firma" | "unidad";

/** Foto de evidencia (shape compat con PhotoRec del webhook / PhotoEntry del front). */
export type FuelPhoto = {
  fname: string;
  col: string; // dataName de MoreApp (etiqueta el tipo de foto)
  group: string;
};

/** Veredicto de validación por evidencia (semáforo del panel lado-a-lado). */
export type FuelVerdict = "ok" | "warn" | "bad" | "pendiente";

/** Veredicto global de una carga revisada. */
export type FuelVerdictGlobal = "ok" | "discrepancia" | "pendiente";

/** Revisión humana + (Fase E) lectura IA de una carga. Espejo de ValidacionCarga. */
export type FuelReview = {
  verdictGlobal: FuelVerdictGlobal;
  porEvidencia: Partial<Record<FuelEvidenceKind, FuelVerdict>>;
  revisadoPor?: string;
  nota?: string;
  ts?: string;
  // Fase E (IA) — asesora; el humano confirma.
  kmDetectado?: number;
  nivelDetectado?: string;
  litrosDetectado?: number;
  confianzaVision?: number;
  fuenteDeteccion?: "manual" | "ia";
};

/**
 * Registro de combustible normalizado para el front (mapeado desde CargaCombustible
 * + ValidacionCarga en cloudHydrate). `eco` (economicoId) es la identidad PRINCIPAL.
 */
export type FuelEntry = {
  loadId: string; // "economicoId|tipo|eventoId"
  tipo: FuelTipo;
  eco: string; // economicoId — identidad principal
  eventoId: string;
  placa?: string;
  sucursal: string;
  tanque?: string;
  fecha: string; // YYYY-MM-DD
  fechaHora?: string;
  responsable?: string;
  km?: number;
  tipoUnidad?: string; // categoría derivada de producto (Diesel / Gas LP / Premium…)
  combustible?: string;
  /**
   * Montacargas (Gas LP): su `km` es HORÓMETRO (horas), no odómetro → el km/l no
   * aplica. Se detecta por `producto` con "GAS LP". Se excluye de métricas km/l,
   * baseline, rankings y anomalías de km (pero sí cuenta en consumo/litros).
   */
  esMontacargas?: boolean;
  producto?: string;
  // Solicitud
  nivelAntes?: string;
  nivelDeseado?: string;
  montoEstimado?: number;
  maxLitros?: number;
  // Carga
  litros?: number;
  precioPorLitro?: number;
  monto?: number;
  seLlenoTanque?: string;
  ubicacion?: string; // formattedValue del GPS
  photos: FuelPhoto[];
  review?: FuelReview;
};

/** Métricas de rendimiento de una carga (km/l del evento). Solo aplica a tipo=carga. */
export type FuelMetrics = {
  loadId: string;
  eco: string;
  fecha: string;
  km: number | null;
  litros: number | null;
  monto: number | null;
  kmDesdeAnterior: number | null; // km[i] - km[i-1]
  kmPorLitro: number | null; // kmDesdeAnterior / litros
  precioPorLitro: number | null; // monto / litros
  diasDesdeAnterior: number | null;
};

/** Estadísticas de un grupo (por unidad o por tipo). */
export type FuelStat = {
  mean: number;
  sd: number;
  n: number;
  p25?: number;
  p75?: number;
};

/** Baseline de la flota para comparativos y anomalías. */
export type FleetBaseline = {
  porUnidad: Map<string, FuelStat>; // km/l por economicoId
  porTipo: Map<string, FuelStat>; // km/l por tipoUnidad
  tipoDe: Map<string, string>; // economicoId → tipoUnidad (para comparar vs su tipo)
  flotaMean: number; // km/l medio de la flota
};

/** Umbrales configurables del detector de anomalías. */
export type FuelThresholds = {
  DROP_SD: number; // caída de rendimiento: km/l < mean - DROP_SD·sd
  DROP_PCT: number; // o km/l < mean·DROP_PCT
  LITERS_SD: number; // consumo inusual: litros > mean + LITERS_SD·sd
  MAX_KM_JUMP: number; // salto de odómetro improbable entre cargas
  MIN_DAYS: number; // cargas demasiado frecuentes
  PRICE_MIN: number; // $/l mínimo plausible
  PRICE_MAX: number; // $/l máximo plausible
  LEAK_PCT: number; // posible fuga: km/l < flotaMean·LEAK_PCT sostenido
  MIN_BASELINE_N: number; // n mínimo para confiar en el baseline por unidad
};

/**
 * Hallazgo/anomalía de combustible. Reusa la forma {text, lv, key} y el RiskLevel
 * del analyzer, pero con cat propia "Combustible" (no toca la unión de Finding).
 */
export type FuelFinding = {
  cat: "Combustible";
  text: string;
  lv: RiskLevel;
  key: string; // identidad estable: "Fuel:<regla>:<loadId>"
  loadId?: string;
  eco?: string;
};

export type { RiskLevel };
