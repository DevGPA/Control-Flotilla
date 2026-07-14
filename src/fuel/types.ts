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
  /**
   * Submarca/tipo comercial de la unidad (`Unit.marca`, de eco.SUBMARCA de MoreApp:
   * "Aumark TM3", "NP 300…"). Join por economicoId en hidratación — cambiarla en el
   * catálogo re-clasifica el histórico. Dimensión del comparativo de rendimiento por tipo.
   */
  submarca?: string;
  /**
   * Área operativa de la unidad (`Unit.area`, capturada por el admin). Join por
   * economicoId en hidratación — reasignar el área re-clasifica el gasto histórico.
   */
  area?: string;
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
  /** Fracción del tanque a llenar 0–1 (MoreApp `porcentajeDelTanqueALlenar` / OPS `necesidad`). */
  necesidad?: number;
  /** Precio por litro del catálogo de la unidad ("$26.63" → 26.63). */
  precioCatalogo?: number;
  observaciones?: string;
  /** Correo fijo de notificación del formulario (MoreApp `datos.email`). */
  emailNotificar?: string;
  /** Correo de quien capturó la solicitud (OPS `datos.mail`; MoreApp no lo guarda). */
  mailSolicitante?: string;
  // Carga
  litros?: number;
  precioPorLitro?: number;
  monto?: number;
  seLlenoTanque?: string;
  /**
   * Cierre del formulario (ISO UTC, de meta.registrationDate de MoreApp): cuándo el chofer
   * GUARDÓ el envío. La apertura es `fechaHora` (el widget la auto-llena al abrir, en hora
   * local del dispositivo). La duración de captura se deriva con el huso de la sucursal.
   */
  formCerrado?: string;
  ubicacion?: string; // formattedValue del GPS
  /** Coordenadas del GPS de la carga (liga a Maps para verificar que sea una gasolinera). */
  ubicacionLatLng?: { lat: number; lng: number };
  photos: FuelPhoto[];
  review?: FuelReview;
  /**
   * Anulación admin ACTIVA (tombstone lógico): el registro existe pero se excluye de
   * KPIs/métricas/anomalías/dashboard/export. Solo visible en la vista "Anuladas".
   */
  anulada?: { motivo: string; anuladoPor: string; ts: string };
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
  | "odometro_no_fiable"
  // Motor de VENTANAS entre tanques llenos (estructurales, NO accionables):
  | "parcial_en_ventana" // carga parcial: sus litros suman a la ventana abierta
  | "sin_lleno_previo" // sin tanque lleno fiable anterior que abra ventana
  | "ventana_rota"; // la ventana se invalidó (salto/sin litros) antes de este cierre

/** Métricas de rendimiento de una carga (km/l del evento). Solo aplica a tipo=carga. */
export type FuelMetrics = {
  loadId: string;
  eco: string;
  fecha: string;
  km: number | null;
  litros: number | null;
  monto: number | null;
  kmDesdeAnterior: number | null; // km[i] - km[i-1] (SEGMENTO; alimenta alertas retroceso/salto)
  /**
   * km/l de la VENTANA entre tanques llenos que CIERRA esta carga: (odómetro de este
   * lleno − odómetro del lleno anterior) / Σ litros cargados en medio (parciales
   * incluidos). null en cargas que no cierran ventana (parciales, intermedias, rotas).
   */
  kmPorLitro: number | null;
  /** Si kmPorLitro es null, POR QUÉ (para explicar el "—"). undefined cuando sí hay km/l. */
  motivoSinKmpl?: MotivoSinKmpl;
  /**
   * @deprecated El motor de ventanas mide lleno→lleno: todo km/l emitido es fiel por
   * construcción. Ya no se asigna; se elimina en el commit de limpieza.
   */
  cargaParcial?: boolean;
  /** Distancia de la VENTANA que cierra esta carga (= numerador del km/l). */
  ventanaKmDesde?: number;
  /** Odómetro del lleno que ABRIÓ la ventana (extremo A, para la cadena del detalle). */
  ventanaDesdeKm?: number;
  /** Nº de cargas cuyos litros suman a la ventana (incluye la de cierre). */
  ventanaCargas?: number;
  /** true si algún extremo de la ventana fue lleno INFERIDO (litros ≥ 95% del tanque). */
  ventanaInferida?: boolean;
  /** ¿Este llenado dejó el tanque lleno? ("Si" del chofer o inferido por litros). */
  llenoEfectivo?: boolean;
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
  /** Capacidad nominal del tanque en litros (de eco.TANQUE). undefined si no parsea. */
  tanqueCap?: number;
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
  TANK_FILL_PCT: number; // fracción de la capacidad nominal del tanque que marca la carga a revisar
  PARTIAL_WINDOW_N: number; // parciales crónicos: tamaño de la ventana de cargas recientes a evaluar
  PARTIAL_MIN_N: number; // parciales crónicos: mínimo de cargas recientes para juzgar a la unidad
  PARTIAL_PCT: number; // parciales crónicos: fracción de cargas sin tanque lleno que dispara la alerta
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

/** Áreas operativas canónicas de la flotilla (select fijo del admin y filtro de gasto). */
export const AREAS_FLOTILLA = ["Logística", "Almacén", "Postventa", "Administración"] as const;

export type { RiskLevel };
