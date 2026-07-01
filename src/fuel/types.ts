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

/**
 * Por qué una carga NO tiene km/l — para explicar el "—" en vez de dejarlo desnudo.
 * Estructurales (correctos, nada que hacer): primera_carga, montacargas, llenado_partido.
 * Por revisar (captura mala): sin_odometro, sin_litros, odometro_retroceso, salto_improbable.
 */
export type MotivoSinKmpl =
  | "primera_carga"
  | "montacargas"
  | "sin_odometro"
  | "sin_litros"
  | "odometro_retroceso"
  | "salto_improbable"
  | "llenado_partido"
  | "kmpl_implausible"
  | "odometro_no_fiable";

/** Métricas de rendimiento de una carga (km/l del evento). Solo aplica a tipo=carga. */
export type FuelMetrics = {
  loadId: string;
  eco: string;
  fecha: string;
  km: number | null;
  litros: number | null;
  monto: number | null;
  kmDesdeAnterior: number | null; // km[i] - km[i-1]
  kmPorLitro: number | null; // kmDesdeAnterior / litros (sobre litrosFill si es llenado partido)
  /** Si kmPorLitro es null, POR QUÉ (para explicar el "—"). undefined cuando sí hay km/l. */
  motivoSinKmpl?: MotivoSinKmpl;
  /**
   * true si el evento SÍ tiene km/l pero NO es fiel: la carga o su ancla no fue a tanque lleno.
   * Se excluye del ranking por-unidad y de las alertas, pero se CONSERVA en el KPI de flota
   * (quitarlo daría sesgo de supervivencia). Se muestra marcado "no fiel · carga parcial".
   */
  cargaParcial?: boolean;
  /** true si la carga es de un montacargas (Gas LP): km = horómetro, no odómetro. */
  esMontacargas?: boolean;
  /** true si la UNIDAD tiene odómetro crónicamente no fiable (placeholder/congelado) — km/l anulado. */
  odometroNoFiable?: boolean;
  /**
   * Litros usados como DENOMINADOR del km/l. Normalmente = `litros`; en un llenado partido en
   * varias cargas con el mismo odómetro, la fila representativa lleva la SUMA de litros del grupo
   * (las demás cargas del grupo quedan con kmPorLitro=null). El baseline pondera por este valor.
   */
  litrosFill?: number;
  precioPorLitro: number | null; // monto / litros
  diasDesdeAnterior: number | null;
};

/** Estadísticas de un grupo (por unidad o por tipo). */
export type FuelStat = {
  mean: number; // media de los km/l por evento (distribución; la usan las anomalías)
  sd: number;
  n: number;
  p25?: number;
  p75?: number;
  /**
   * km/l PONDERADO POR VOLUMEN del grupo: Σ(km recorridos) / Σ(litros) sobre los eventos
   * dentro de la cerca IQR. Es la métrica de EFICIENCIA que se muestra/ranquea (robusta a
   * llenados parciales y sin el sesgo del promedio de ratios). Opcional: si falta, los
   * consumidores caen a `mean` (compatibilidad con literales de test).
   */
  kmplVol?: number;
  /** Mediana de km/l por evento (robusta a outliers). La usa la regla de fuga y su gate FLOOR. */
  median?: number;
};

/** Baseline de la flota para comparativos y anomalías. */
export type FleetBaseline = {
  porUnidad: Map<string, FuelStat>; // km/l por economicoId
  porTipo: Map<string, FuelStat>; // km/l por tipoUnidad
  tipoDe: Map<string, string>; // economicoId → tipoUnidad (para comparar vs su tipo)
  flotaMean: number; // km/l medio de la flota (media de eventos). Histórico: lo usaba "fuga", que ahora compara contra la mediana propia de cada unidad.
  flotaKmplVol?: number; // km/l ponderado por volumen de la flota (Σkm/Σlitros)
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
  LEAK_DROP: number; // fuga: km/l < mediana propia · LEAK_DROP (sostenido 2 cargas)
  LEAK_FLOOR: number; // km/l mínimo para juzgar fuga (exime unidades crónicamente ineficientes)
  LEAK_MIN_N: number; // n mínimo de eventos fieles para juzgar la caída de una unidad
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
