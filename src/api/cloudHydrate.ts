// Hydrate frontend state desde DynamoDB.
//
// Tras login, el frontend lee de cloud y reconstruye los objetos Unit del
// legacy (window.units + checklistDB) mergeando Unit catalog + Checklist
// resultados. Esto permite que cualquier usuario del tenant vea los mismos
// datos sin necesidad de re-subir el ZIP.
//
// Mapping cloud → legacy:
// - cloud.Unit (catálogo)     → legacy.{uid, plate, brand, branch}
// - cloud.Checklist.resultados → legacy.{F, T, risk, minT, obs, km, nextSvc, kmNextSvc}
//
// Triggers re-render de la UI legacy llamando window.renderTable / buildKPIs.

import type { Schema } from "./amplifyClient";
import {
  listUnits,
  listChecklists,
  listSemanales,
  listTaller,
  listCheckDone,
  listCombustible,
  listCombustibleRange,
  listValidaciones,
  listComplianceDocs,
  listAccesorios,
  listAnulaciones,
  listAppConfig,
} from "./client";
import {
  buildAnuladasActivas,
  esChecklistAnulado,
  esSemanalAnulado,
  esTallerAnulado,
  type AnulacionInfo,
} from "../anulacion/anulacion";
import { buildFuelEntries } from "../fuel/mapEntry";
import { buildComplianceEntries } from "../compliance/mapEntry";
import { monthOf } from "../dates";
import { buildAccesorioEntries } from "../accesorios/mapEntry";
import type { FuelEntry } from "../fuel/types";
import { batchGetCloudPhotoUrls, refreshPhotoUrls, type PhotoUrlEntry } from "./photoFetch";
import { uploadTallerToCloud, type LegacyTallerEntry } from "./batchUpload";
import { dedupTallerCloudRows } from "./tallerDedup";
import {
  fetchPartidas,
  agruparPorVisita,
  juntaVisitaKey,
  visitaKeyDe,
  filasBandeja,
  guardarDecisionPartida,
  urlFotoPartida,
  resumenLoteFirma,
  type DecisionPartida,
  type FilaBandeja,
} from "./tallerPartidas";
import {
  pendientesDeFirma,
  MOTIVOS_RECHAZO,
  gastoDerivado,
  montoPendienteDeFirma,
  esquemaHibridoActivo,
  type Partida,
  type TotalesVisita,
  type GastoDerivado,
} from "../taller/partidas";
import { gastoAnualPorEco } from "../taller/exportExcel";
import { mergeCheckDones } from "./mergeCheckDones";
import { stripAuto, type DoneMap } from "../analyzer/findingKey";
import { injectAutoResolve, purgeAutoEntries, type AutoRow } from "../analyzer/autoResolve";
import { normalizaRefaccion } from "../analyzer/refaccion";
import type { Unit, Finding, RiskLevel, ChecklistDB, WeeklyEntry } from "../types";
import type { WeeklyPeriodo } from "../weekly/weeklyStore";
import type { TallerEntry, TallerEstado } from "../taller/types";
import { migrateEstado, normalizeArea } from "../taller/types";

interface ChecklistResultados {
  findings?: unknown[];
  tires?: Record<string, number>;
  risk?: string;
  max?: string;
  minT?: number | null;
  obs?: string;
  km?: number | string;
  nextSvc?: string;
  kmNextSvc?: number | string;
  validationErrors?: string[];
  /** Keys que la inspección evaluó (spec auto-resueltos §4; pipeline nuevo). */
  evaluatedKeys?: string[];
  moreappId?: string;
  photos?: unknown[];
}

const VALID_RISKS: ReadonlySet<RiskLevel> = new Set<RiskLevel>([
  "Urgente",
  "Revisar",
  "Completar",
  "OK",
]);
function asRisk(v: unknown): RiskLevel | undefined {
  const s = String(v ?? "");
  return VALID_RISKS.has(s as RiskLevel) ? (s as RiskLevel) : undefined;
}

/**
 * Fix ronda 2 (Task 9, Critical 1): `gasto`/`gastoRef`/`gastoMO` NUNCA se hidratan a `0` cuando
 * `datos` no trae el campo — antes `Number(datos.gasto) || 0` fabricaba un cero indistinguible
 * de un cero real. Con partidas, ese `0` fabricado se re-sube tal cual en el próximo
 * `finalizarUnidad`/guardado (uploadTallerToCloud sube el entry entero) y el registro cloud
 * queda con un $0 "duro" que ya no dice "no capturado" — dice "cero", y si las partidas se
 * volvieran inalcanzables (visita anulada y restaurada, o la placa cambia — tallerCloudKey usa
 * `plate || eco`, y el reemplacamiento de la flota está en curso) el dinero firmado desaparece
 * sin rastro. `Number(v)` no-finito (basura, `"abc"`) también se trata como ausente, nunca 0.
 *
 * Fix ronda 3: `Number("") === 0` (finito) — sin el guard de string vacía/solo-espacios, ESTA
 * MISMA función fabricaba el cero duro que existe para cerrar, con un `datos.gasto` vacío en
 * vez de ausente. `datos` nunca ha traído ese shape, pero el guard es una línea y el punto de
 * esta función es no dejar ni un solo camino hacia un cero fabricado.
 */
export function numOrUndef(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "string" && !v.trim()) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

declare global {
  interface Window {
    buildAnalytics?: () => void;
    buildAlertsSummary?: () => void;
    buildKPIs?: () => void;
    /** Perf F1-4: firma del último snapshot cloud hidratado (cuenta+max updatedAt por
     *  modelo). Si el siguiente fetch da la misma firma, se omite rebuild+render. */
    __lastHydrateSig?: string;
    buildBranches?: () => void;
    showDash?: () => void;
    renderDet?: () => void;
    // checklistDB (completaciones, bridged al monolito) ya está declarado en main.ts como ChecklistDB.
    weeklyPeriodos?: WeeklyPeriodo[];
    activeWeeklyPeriodoId?: string | null;
    updateSwNavBadge?: () => void;
    tallerEntries?: TallerEntry[];
    updateTallerBadge?: () => void;
    renderTaller?: () => void;
    /** Partidas de taller (ciclo de firma), agrupadas por visitaKey. Alimenta
     *  el badge de la pestaña Taller — cuenta lo que espera la firma de Riesgos. */
    __tallerPartidas?: Map<string, Partida[]>;
    /**
     * Task 10 (el apagador) — `esquemaHibridoActivo(AppConfig)` ya resuelto, se
     * publica en CADA hidratación (incluso si el resto del snapshot no cambió:
     * un admin puede voltear el switch sin que el resto de los datos del tenant
     * se muevan un bit). Default OFF: fila ausente, campo ausente, tipo
     * incorrecto o lectura fallida resuelven `false` (ver `esquemaHibridoActivo`).
     * El Lambda del portal (taller-portal) NO se apaga con esta bandera — para
     * cerrar la puerta del proveedor se revoca la liga (`ligaVersion`, columna
     * de `Taller`), un mecanismo aparte. Cada resolver de partidas del monolito
     * y de src/api/{cloudWire,cloudHydrate}.ts consulta este MISMO booleano
     * (R62): con el esquema apagado, TODOS ven `[]`/`undefined` — el dinero
     * derivado deja de aplicar en cualquier lado, nunca a medias.
     */
    __tallerHibrido?: boolean;
    /** Bridge (fix ronda 2, Finding 1): la MISMA `pendientesDeFirma` de
     *  src/taller/partidas.ts, publicada para que el badge del monolito la
     *  consuma en vez de reimplementar el filtro "estado === propuesta" —
     *  Task 8 (bandeja de firma) contará con esta misma función. */
    __pendientesDeFirma?: (ps: Partida[]) => number;
    /** Bridges de Task 8 (bandeja de firmas) — mismo motivo que los de arriba:
     *  el `<script>` inline del monolito no puede `import`, así que las
     *  funciones puras de src/ se publican para que las invoque directo. */
    __filasBandeja?: (
      entries: LegacyTallerEntry[],
      porVisita: Map<string, Partida[]>,
      anualPorEco: Map<string, { gasto: number; visitas: number }>,
    ) => FilaBandeja[];
    /** Gasto+visitas CERRADAS del año, por eco (Ruling A) — el contexto que
     *  convierte firmar una partida en una decisión informada. Task 9: el 3er
     *  parámetro (opcional) resuelve las partidas de la visita de cada entry
     *  para que este total también vea lo FIRMADO — sin él, se comporta
     *  exactamente igual que antes de Task 9. */
    __gastoAnualPorEco?: (
      entries: readonly TallerEntry[],
      anio: number,
      partidasDe?: (e: TallerEntry) => Partida[] | undefined,
    ) => Map<string, { gasto: number; visitas: number }>;
    /**
     * Task 9 (el gasto se calcula, no se captura): el gasto de una visita con
     * partidas es la suma de lo FIRMADO, nunca un número tecleado. El monolito
     * la usa para pintar `#tf-gasto` en solo lectura con el valor derivado —
     * la aritmética vive en src/taller/partidas.ts, nunca reimplementada acá.
     */
    __gastoDerivado?: (
      entry: { gasto?: number; gastoRef?: number; gastoMO?: number },
      ps: Partida[],
    ) => GastoDerivado;
    /**
     * Fix ronda 2 (Task 9, Important 2): cuánto de las partidas de la visita sigue
     * esperando firma. El monolito la usa para que `#tf-gasto` en solo lectura
     * pueda decir "$X esperando firma" — un número de dinero declara su alcance
     * en vez de dejar el campo mudo sobre lo pendiente. Reemplaza al bridge
     * `__totalesVisita` de la ronda 1: ese residuo (`cotizado - autorizado -
     * rechazado`) solo cuadraba porque `autorizar()` congela `precioAutorizado
     * = precio` — el día que se autorice a un precio negociado distinto, el
     * residuo se desalinea. `montoPendienteDeFirma` no es un residuo.
     */
    __montoPendienteDeFirma?: (ps: Partida[]) => number;
    /** Menú CERRADO de motivos de rechazo — nunca un texto libre a mano. */
    __MOTIVOS_RECHAZO?: readonly string[];
    /** Misma derivación de visitaKey que agrupa `__tallerPartidas` — para que
     *  la bandeja pueda ubicar el `TallerEntry` original de una fila sin
     *  hand-rollear el match. */
    __visitaKeyDe?: (e: LegacyTallerEntry) => string;
    /** URL firmada de una foto de partida (llave completa, sin normalizar). */
    __urlFotoPartida?: (key: string) => Promise<string | null>;
    /**
     * Aritmética de "Autorizar las N" (fix ronda 1, Important 2): qué
     * partidas se pueden firmar en lote (tienen precio — Ruling B), a
     * cuánto queda el autorizado si se firman, y cuántas quedan fuera.
     * El monolito solo pinta lo que esto devuelve, nunca lo calcula.
     */
    __resumenLoteFirma?: (
      ps: Partida[],
      totales: TotalesVisita,
    ) => { autorizables: Partida[]; monto: number; sinPrecio: number };
    /**
     * Persiste la firma de una partida (autorizar/rechazar) y re-hidrata.
     * Único punto de escritura que la bandeja de firmas expone al monolito —
     * la lógica real (autorizar/rechazar + el registro con quién/cuándo) vive
     * en `guardarDecisionPartida` (src/api/tallerPartidas.ts).
     */
    __guardarDecisionPartida?: (
      partidaId: string,
      visitaKey: string,
      decision: DecisionPartida,
      motivo?: string,
      nota?: string,
    ) => Promise<void>;
    /** Mapa filename → {url firmada, expires}. Lo lee legacy imgUrl, que descarta las
     *  vencidas (las URLs firmadas de S3 expiran ≈15min). */
    __cloudPhotoUrlMap?: Map<string, PhotoUrlEntry>;
    // periodos / activePeriodoId / renderPeriodoBar / switchPeriodo: declarados en main.ts.
    // Vista de rango de fechas: todas las inspecciones (1 fila por checklist).
    __inspections?: Unit[];
    __inspMinDate?: string;
    __inspMaxDate?: string;
    applyDateRange?: (fromISO: string, toISO: string) => void;
    initRangoBar?: () => void;
    // Flota: unidades distintas (catálogo) con última inspección — para KPIs hero + dona.
    __fleetUnits?: Unit[];
    /** Anulaciones ACTIVAS (refId → info). Overlay admin que excluye registros de los
     *  cálculos; lo consumen combustible (tag en FuelEntry) y los módulos legacy. */
    __anuladasActivas?: Map<string, AnulacionInfo>;
    // Fase C1: registro de toggles locales recientes ("placa key" → ts) que el
    // merge respeta; lo escribe cloudWire.__cloudSetCheck.
    __checkDirty?: Record<string, string>;
    // Funciones globales del script legacy (function declarations → window.*).
    dbPut?: (store: string, key: string, value: unknown) => Promise<unknown>;
    recalcAllRisks?: () => void;
    initRangoSemanal?: () => void;
    renderSemanales?: () => void;
    // Módulo de combustible (Fase B).
    fuelEntries?: FuelEntry[];
    renderCombustible?: () => void;
    updateFuelNavBadge?: () => void;
    initRangoFuel?: () => void;
    /** Persistencia de sesión del legacy (IndexedDB) — reutilizada para el
     *  snapshot cloud (stale-while-revalidate, perf boot 2026-07-14). */
    persistState?: (filename: string) => Promise<void>;
  }
}

// Throttle de la persistencia del snapshot cloud (ver hydrateFromCloud).
let lastCloudPersist = 0;

/** Normaliza una fecha de checklist a ISO YYYY-MM-DD para ORDENAR/COMPARAR.
 * Acepta ISO (passthrough) o legacy DD/MM/YYYY. "" si no parseable. NO se usa
 * para construir uids ni el campo `fecha` mostrado, para no re-keyear los
 * CheckDones existentes (cuya llave depende del uid `placa__fecha`). */
function isoDay(fecha: string | null | undefined): string {
  const s = String(fecha ?? "").trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  return "";
}

function periodoLabelFromId(id: string): string {
  // "2026-W21" → "Semana 21, 2026"
  const m = id.match(/^(\d{4})-W(\d{1,2})$/);
  if (m) return `Semana ${parseInt(m[2]!, 10)}, ${m[1]}`;
  return id;
}

function parseResultados(raw: unknown): ChecklistResultados {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as ChecklistResultados;
    } catch {
      return {};
    }
  }
  return raw as ChecklistResultados;
}

// Parseo defensivo de campos AWSJSON (datos de Taller/Semanal). Si el string está
// corrupto (ej. rollback parcial dejó JSON incompleto), devuelve {} en vez de
// tirar toda la hidratación con un throw.
function safeParseObj(raw: unknown): Record<string, unknown> {
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

/**
 * ¿La unidad es un montacargas? En la flota GPA el producto Gas LP ⇒ montacargas
 * (mismo criterio que el módulo de Combustible, `mapEntry.deriveTipo`). Cubre las grafías
 * "TOKA COMBUSTIBLE GAS LP CHIP" y "EASYGAS LP CHIP" (ambas contienen "gas lp" en minúsculas).
 */
export function esMontacargasProducto(productoToka: string | null | undefined): boolean {
  return String(productoToka ?? "")
    .toLowerCase()
    .includes("gas lp");
}

/**
 * El set de `visitaKey` de las visitas de Taller ANULADAS — construidas
 * hacia ADELANTE con `juntaVisitaKey` sobre las filas cloud de Taller (que ya
 * traen `unitUid`/`fechaEntrada` resueltos como columnas del identifier), no
 * separando de vuelta una `visitaKey` existente (fix ronda 2, Finding 2: la
 * versión anterior de este filtro invertía `visitaKey` a mano y un `unitUid`
 * con un "|" propio la hacía fallar en silencio — construir siempre hacia
 * adelante retira esa clase de bug en vez de documentarla).
 *
 * Reusa `esTallerAnulado` — el MISMO predicado que ya decide la anulación de
 * `tallerEntries` (ver `tallerVigente` más abajo) — en vez de reimplementar
 * el criterio. Pura y exportada para test (nada de Amplify aquí).
 */
export function visitasAnuladasKeys(
  tallerRows: readonly { unitUid?: unknown; fechaEntrada?: unknown }[],
  anuladas: ReadonlyMap<string, AnulacionInfo>,
): Set<string> {
  const out = new Set<string>();
  for (const t of tallerRows) {
    if (esTallerAnulado(t, anuladas)) {
      out.add(
        juntaVisitaKey({
          unitUid: String(t.unitUid ?? ""),
          fechaEntrada: String(t.fechaEntrada ?? ""),
        }),
      );
    }
  }
  return out;
}

/**
 * Excluye del ciclo de firma las partidas cuya `visitaKey` está en el set de
 * visitas anuladas — misma regla de "anulación, nunca borrado" que ya aplica
 * a `tallerEntries`. Sin este filtro, una visita anulada con partidas en
 * "propuesta" seguiría prendiendo el badge de Taller y mandaría a Riesgos a
 * perseguir una firma para un registro que ya no existe en la vista.
 * Pura y exportada para test.
 */
export function partidasVigentes(ps: Partida[], visitasAnuladas: ReadonlySet<string>): Partida[] {
  return ps.filter((p) => !visitasAnuladas.has(p.visitaKey));
}

/**
 * Partidas vigentes agrupadas por visita — la MISMA composición que arma
 * `window.__tallerPartidas` (más abajo) y que el fix de huérfanos (Task 9, fix
 * ronda 3, Critical 1 — hueco #3) necesita para resolver `partidasDe` ANTES de
 * que `window.__tallerPartidas` exista en este punto de la hidratación. Un
 * solo lugar para "vigentes + agrupadas", no dos copias que puedan divergir.
 * Pura y exportada para test.
 */
export function partidasVigentesPorVisita(
  partidas: Partida[],
  visitasAnuladas: ReadonlySet<string>,
): Map<string, Partida[]> {
  return agruparPorVisita(partidasVigentes(partidas, visitasAnuladas));
}

/** Exportada para tests (el cableado de la refacción vivía aquí como bug). */
export function mergeUnitWithChecklist(
  unit: Schema["Unit"]["type"],
  checklist: Schema["Checklist"]["type"] | undefined,
): Unit {
  const r = parseResultados(checklist?.resultados);
  const findings = (Array.isArray(r.findings) ? r.findings : []) as Finding[];
  const tires = r.tires ?? {};
  // Reglas de la LLANTA DE REFACCIÓN aplicadas AL LEER (decisión Navares 2026-08-11):
  // así los meses ya capturados en DynamoDB se ven con la regla nueva (tope Revisar +
  // TACO mínimo sin refacción) sin necesidad de backfill. También deriva `hasRefaccion`
  // de los hallazgos: antes se fijaba en `true` a mano y el aviso "Sin refacción" de la
  // pestaña Llantas y el renglón del PDF nunca se activaban.
  const refaccion = normalizaRefaccion({
    findings,
    risk: (r.risk ?? r.max ?? "OK") as RiskLevel,
    tires,
    minT: r.minT ?? null,
  });
  // economicoId es el ID interno GPA (numérico tipo "78"). Fallback a placa si
  // el upload no lo guardó (rows viejas) — preserva render legacy `u.eco || u.plate`.
  const ecoId = unit.economicoId || unit.placa;
  return {
    uid: unit.placa,
    eco: ecoId,
    plate: unit.placa,
    brand: unit.marca ?? undefined,
    anio: unit.anio ?? undefined,
    validationErrors: Array.isArray(r.validationErrors) ? r.validationErrors : undefined,
    evaluatedKeys: Array.isArray(r.evaluatedKeys) ? r.evaluatedKeys : undefined,
    branch: unit.sucursal ?? undefined,
    insp: checklist?.responsable ?? "",
    fecha: checklist?.fecha ?? "",
    km: r.km ?? "",
    obs: r.obs ?? "",
    obsArr: r.obs ? r.obs.split("\n\n").filter(Boolean) : [],
    nextSvc: r.nextSvc ?? "",
    kmNextSvc: r.kmNextSvc ?? "",
    risk: refaccion.risk,
    F: refaccion.findings,
    T: tires,
    minT: refaccion.minT,
    folio: r.moreappId ?? "",
    photos: Array.isArray(r.photos) ? r.photos : [],
    hasRefaccion: refaccion.hasRefaccion,
    esMontacargas: esMontacargasProducto(unit.productoToka),
  };
}

/**
 * Perf F1-4: firma barata del snapshot cloud para detectar "nada cambió" y saltar el
 * rebuild+render (la parte que congela el hilo cada 4min/focus/evento live). Cuenta +
 * max(updatedAt) por modelo detecta altas, bajas y ediciones sin serializar los items
 * (los modelos Amplify siempre tienen updatedAt automático). Exportada para tests.
 */
export function hydrateSignature(
  lists: ReadonlyArray<ReadonlyArray<{ readonly updatedAt?: string | null }>>,
): string {
  return lists
    .map((arr) => {
      let max = "";
      for (const it of arr) {
        const u = it.updatedAt ?? "";
        if (u > max) max = u;
      }
      return `${arr.length}:${max}`;
    })
    .join("|");
}

// ── Perf F3-1: ventana de hidratación de combustible ─────────────────────────
// CargaCombustible es la única tabla que crece a diario (~1k filas/mes). En vez de
// descargar el histórico completo en cada hidratación, se trae solo la ventana
// visible (default: últimos FUEL_WINDOW_DAYS, alineado con el rango default de la
// UI de Combustible) vía Query al GSI byTenantAndFecha. Si el usuario amplía el
// rango de fechas más atrás, ensureFuelWindow() trae el tramo faltante UNA vez y
// la frontera queda ampliada para los siguientes auto-refresh de la sesión.
// Perf boot 2026-07-14: 92→31 días. La ventana completa de 3 meses (~2,750 filas,
// 3.9 MB, 4 páginas secuenciales ≈ 3.4s) dominaba la hidratación del boot. Con 31
// días el boot paga ~1 página; al ENTRAR a Combustible, initRangoFuel amplía a los
// 3 meses del rango default vía ensureFuelWindow (en paralelo, ver splitFuelRange).
const FUEL_WINDOW_DAYS = 31;
// Frontera superior fija: incluye cargas con fecha futura por error de captura
// (mismo comportamiento que el Scan completo previo). La ventana solo se acota
// por atrás.
const FUEL_WINDOW_TO = "9999-12-31";
let fuelWindowFrom: string | null = null;
// Insumos del último hydrate — ensureFuelWindow reconstruye fuelEntries sin
// re-descargar validaciones/unidades/anulaciones (cambian poco; el próximo
// hydrate completo las refresca).
let fuelRaw: Schema["CargaCombustible"]["type"][] = [];
let fuelDeps: {
  tenantId: string;
  validaciones: Schema["ValidacionCarga"]["type"][];
  unidadPorEco: Map<string, { submarca?: string; area?: string }>;
  anuladasActivas: Map<string, AnulacionInfo>;
} | null = null;

/** Hoy en zona México menos FUEL_WINDOW_DAYS, en YYYY-MM-DD (formato de `fecha`). */
function defaultFuelWindowFrom(): string {
  const d = new Date(Date.now() - FUEL_WINDOW_DAYS * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}

const fuelKey = (r: Schema["CargaCombustible"]["type"]): string =>
  `${r.economicoId}|${r.tipo}|${r.eventoId}`;

/**
 * Perf boot 2026-07-14: parte [fromISO, toISO] en sub-rangos mensuales SIN huecos
 * ni traslapes (between es inclusivo en ambos extremos) para pedirlos en PARALELO
 * — la paginación por nextToken es secuencial y cada página costaba ~1s. El último
 * sub-rango conserva el tope original (9999-12-31 incluye fechas futuras por error
 * de captura). `hoyISO` inyectable para tests.
 */
export function splitFuelRange(
  fromISO: string,
  toISO: string,
  hoyISO?: string,
  chunkDays = 31,
): Array<[string, string]> {
  const hoy = hoyISO ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
  const cap = toISO < hoy ? toISO : hoy; // los datos reales terminan aquí
  const addDays = (iso: string, n: number): string =>
    new Date(new Date(iso + "T12:00:00Z").getTime() + n * 86_400_000).toISOString().slice(0, 10);
  const out: Array<[string, string]> = [];
  let cur = fromISO;
  while (out.length < 23) {
    const next = addDays(cur, chunkDays);
    if (next > cap) break;
    out.push([cur, addDays(next, -1)]);
    cur = next;
  }
  out.push([cur, toISO]);
  return out;
}

/** Descarga un rango de combustible en sub-rangos paralelos + dedup por identidad. */
async function fetchFuelRangeParallel(
  tenantId: string,
  fromISO: string,
  toISO: string,
): Promise<Schema["CargaCombustible"]["type"][]> {
  const parts = splitFuelRange(fromISO, toISO);
  if (parts.length === 1) return listCombustibleRange(tenantId, fromISO, toISO);
  const results = await Promise.all(parts.map(([a, b]) => listCombustibleRange(tenantId, a, b)));
  const seen = new Set<string>();
  const out: Schema["CargaCombustible"]["type"][] = [];
  for (const arr of results)
    for (const r of arr) {
      const k = fuelKey(r);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(r);
      }
    }
  return out;
}

// Serializa las ampliaciones (el rango de la UI puede moverse varias veces rápido).
let ensureFuelChain: Promise<boolean> = Promise.resolve(false);

/**
 * Amplía la ventana de combustible hacia atrás hasta cubrir `fromISO` (YYYY-MM-DD).
 * Trae SOLO el tramo faltante, lo mergea al crudo acumulado y reconstruye
 * window.fuelEntries (referencia nueva → el memo del módulo de combustible se
 * invalida solo). Devuelve true si amplió. No-op si la ventana ya cubre la fecha
 * o si aún no corre la primera hidratación.
 */
export function ensureFuelWindow(fromISO: string): Promise<boolean> {
  const next = ensureFuelChain
    .catch(() => false)
    .then(async () => {
      const from = String(fromISO ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return false;
      if (!fuelDeps || fuelWindowFrom === null || from >= fuelWindowFrom) return false;
      // Tramo faltante: [from, fuelWindowFrom) — between es inclusivo, así que el tope
      // es el día anterior a la frontera actual.
      const upper = new Date(new Date(fuelWindowFrom + "T12:00:00Z").getTime() - 86_400_000)
        .toISOString()
        .slice(0, 10);
      let tramo: Schema["CargaCombustible"]["type"][];
      try {
        tramo = await fetchFuelRangeParallel(fuelDeps.tenantId, from, upper);
      } catch (e) {
        console.warn("[ensureFuelWindow] fetch del tramo falló (no-fatal):", e);
        return false;
      }
      fuelWindowFrom = from;
      if (tramo.length) {
        const seen = new Set(fuelRaw.map(fuelKey));
        for (const r of tramo) if (!seen.has(fuelKey(r))) fuelRaw.push(r);
      }
      const entries = buildFuelEntries(
        fuelRaw,
        fuelDeps.validaciones,
        fuelDeps.unidadPorEco,
        fuelDeps.anuladasActivas,
      );
      window.fuelEntries = entries;
      if (typeof window.updateFuelNavBadge === "function") window.updateFuelNavBadge();
      if (typeof window.renderCombustible === "function") window.renderCombustible();
      console.info(
        `[ensureFuelWindow] ventana ampliada a ${from} (+${tramo.length} filas, total ${fuelRaw.length})`,
      );
      return true;
    });
  ensureFuelChain = next;
  return next;
}

/**
 * Perf F3-4: refresco EN VIVO solo del módulo de combustible. Cuando el evento live
 * es de CargaCombustible/ValidacionCarga (ráfagas del webhook/puente Ops), no hace
 * falta re-descargar los 9 modelos: se re-consulta la ventana (Query al GSI, barata)
 * + las validaciones, se reconstruye fuelEntries y se re-renderiza el módulo.
 * Devuelve false si aún no corrió la primera hidratación o si falló (el caller debe
 * hacer el hydrate completo como fallback).
 */
export function refreshFuelOnly(): Promise<boolean> {
  const next = ensureFuelChain
    .catch(() => false)
    .then(async () => {
      if (!fuelDeps || fuelWindowFrom === null) return false;
      const deps = fuelDeps;
      try {
        // Las anulaciones se RE-LEEN: el receptor del puente escribe `Anulacion` y
        // `CargaCombustible` en la misma invocación (reasignación de Ops), y reusar el mapa
        // de `deps` dejaba la carga anulada CONTANDO en KPIs hasta el poll de 4 min.
        const [combustible, validaciones, anulaciones] = await Promise.all([
          fetchFuelRangeParallel(deps.tenantId, fuelWindowFrom, FUEL_WINDOW_TO),
          listValidaciones(deps.tenantId),
          listAnulaciones(deps.tenantId).catch(() => null),
        ]);
        // Si la lectura de anulaciones falla, se conserva el mapa anterior (nunca se
        // "desanula" un registro por un error de red).
        const anuladasActivas = anulaciones
          ? buildAnuladasActivas(anulaciones)
          : deps.anuladasActivas;
        fuelRaw = [...combustible];
        fuelDeps = { ...deps, validaciones, anuladasActivas };
        // También en window: lo consumen los módulos legacy y el overlay optimista de wire.
        window.__anuladasActivas = anuladasActivas;
        const entries = buildFuelEntries(fuelRaw, validaciones, deps.unidadPorEco, anuladasActivas);
        window.fuelEntries = entries;
        if (typeof window.updateFuelNavBadge === "function") window.updateFuelNavBadge();
        if (typeof window.renderCombustible === "function") window.renderCombustible();
        console.info(`[refreshFuelOnly] ${entries.length} registros (live, ventana)`);
        return true;
      } catch (e) {
        console.warn("[refreshFuelOnly] falló — fallback a hydrate completo:", e);
        return false;
      }
    });
  ensureFuelChain = next;
  return next;
}

/**
 * Lee Units + Checklists del cloud, los merge en LegacyUnit[] y los inyecta
 * en window.units. Trigger re-render de la UI.
 *
 * Llamar SOLO si hay sesión activa con tenantId válido.
 * Idempotente: re-correr reemplaza state actual con data fresca del cloud.
 */
export async function hydrateFromCloud(tenantId: string): Promise<{
  units: number;
  source: "cloud" | "empty";
}> {
  const [
    units,
    checklists,
    semanales,
    tallerCloud,
    checkDones,
    combustible,
    validaciones,
    complianceDocs,
    accesorioRows,
    anulaciones,
    appConfigRows,
  ] = await Promise.all([
    listUnits(tenantId),
    listChecklists(tenantId),
    listSemanales(tenantId),
    listTaller(tenantId),
    // No-fatal: si CheckDone aún no está desplegado o falla, no debe tumbar toda la
    // hidratación de datos (units/checklists). Las completaciones son una mejora encima.
    listCheckDone(tenantId).catch((e) => {
      console.warn("[cloudHydrate] listCheckDone falló (no-fatal):", e);
      return [] as Schema["CheckDone"]["type"][];
    }),
    // No-fatal: el módulo de combustible es independiente; si falla no tumba el resto.
    // Perf F3-1: por VENTANA de fechas (Query al GSI byTenantAndFecha) en vez de Scan
    // del histórico completo — es la tabla más grande (~1k filas/mes). Fallback al
    // Scan completo si la index query falla (p.ej. GSI recién creado aún en backfill
    // durante el primer deploy, o cliente corriendo contra un backend sin el índice).
    fetchFuelRangeParallel(tenantId, fuelWindowFrom ?? defaultFuelWindowFrom(), FUEL_WINDOW_TO)
      .catch((e) => {
        console.warn("[cloudHydrate] fetchFuelRangeParallel falló — fallback a Scan completo:", e);
        return listCombustible(tenantId);
      })
      .catch((e) => {
        console.warn("[cloudHydrate] listCombustible falló (no-fatal):", e);
        return [] as Schema["CargaCombustible"]["type"][];
      }),
    listValidaciones(tenantId).catch((e) => {
      console.warn("[cloudHydrate] listValidaciones falló (no-fatal):", e);
      return [] as Schema["ValidacionCarga"]["type"][];
    }),
    // No-fatal: el módulo de cumplimiento es independiente y su modelo puede aún NO
    // estar desplegado → devolver [] para no tumbar la hidratación del resto.
    listComplianceDocs(tenantId).catch((e) => {
      console.warn("[cloudHydrate] listComplianceDocs falló (no-fatal):", e);
      return [] as Schema["ComplianceDoc"]["type"][];
    }),
    // No-fatal: la sub-pestaña Accesorios de Taller es independiente y su modelo puede aún
    // NO estar desplegado → devolver [] para no tumbar la hidratación del resto.
    listAccesorios(tenantId).catch((e) => {
      console.warn("[cloudHydrate] listAccesorios falló (no-fatal):", e);
      return [] as Schema["Accesorio"]["type"][];
    }),
    // No-fatal: las anulaciones son un overlay; si el modelo aún no está desplegado,
    // nada se excluye (comportamiento previo intacto).
    listAnulaciones(tenantId).catch((e) => {
      console.warn("[cloudHydrate] listAnulaciones falló (no-fatal):", e);
      return [] as Schema["Anulacion"]["type"][];
    }),
    // No-fatal (Task 10): el apagador debe resolver OFF si el modelo aún no está
    // desplegado o la lectura falla — nunca tumbar el resto de la hidratación por
    // un switch.
    listAppConfig(tenantId).catch((e) => {
      console.warn("[cloudHydrate] listAppConfig falló (no-fatal, apagador → OFF):", e);
      return [] as Schema["AppConfig"]["type"][];
    }),
  ]);

  // Task 10 (el apagador): se lee y publica SIEMPRE, en cada llamada — incluso
  // cuando el resto del snapshot no cambió (el short-circuit de "sin cambios"
  // más abajo se salta el rebuild completo, pero un admin puede voltear el
  // switch sin que ni una fila de units/taller/combustible se mueva — por eso
  // appConfigRows también viaja dentro de hydrateSignature() más abajo: sin
  // eso, ese short-circuit se pegaría al valor viejo del switch hasta que
  // algo MÁS cambiara). Fila ausente, campo ausente o de otro tipo resuelven
  // `false` (esquemaHibridoActivo). El Lambda del portal (taller-portal) NO
  // se apaga con esta bandera — para cerrar la puerta del proveedor se
  // revoca la liga (`ligaVersion`, columna de `Taller`), un mecanismo aparte.
  window.__tallerHibrido = esquemaHibridoActivo(appConfigRows[0]);

  // Índice refId → info de anulaciones ACTIVAS (las restauradas no excluyen). Se expone
  // en window para los módulos legacy (Inspecciones/Semanales) y se aplica aquí abajo.
  const anuladasActivas = buildAnuladasActivas(anulaciones);
  window.__anuladasActivas = anuladasActivas;
  // Checklists VIGENTES: los anulados por admin salen de TODA construcción de vistas
  // (inspecciones por rango, última inspección por unidad, flota, fallback). Combustible
  // etiqueta en vez de filtrar (tiene vista "Anuladas" propia); semanales filtra en su loop.
  const checklistsVigentes = checklists.filter((c) => !esChecklistAnulado(c, anuladasActivas));

  if (
    units.length === 0 &&
    semanales.length === 0 &&
    tallerCloud.length === 0 &&
    combustible.length === 0
  ) {
    console.info("[cloudHydrate] cloud vacío, nada que hidratar");
    return { units: 0, source: "empty" };
  }

  // Perf F1-4: si el snapshot cloud es IDÉNTICO al de la última hidratación, el estado en
  // window.* y el DOM ya reflejan estos datos → saltar TODO el rebuild + render (parse de
  // miles de blobs + reconstrucción de 6 módulos), que es la tarea síncrona que congela el
  // hilo en cada poll/focus/evento live cuando en realidad nada cambió. Las fotos se
  // re-firman por-demanda al verse (imgUrl → lazyObserver → __cloudGetPhotoUrl), así que
  // omitir el pre-firmado proactivo no rompe evidencias. El primer hydrate (sig undefined)
  // y cualquier cambio real (alta/baja/edición → cambia cuenta o max updatedAt) sí procede.
  // Fix ronda 1 (Task 10, Important 1): appConfigRows viaja aquí también — sin
  // ella, un admin que voltea SOLO el switch (ninguna otra fila del tenant se
  // movió) nunca dispara este rebuild: window.__tallerHibrido ya quedó
  // correcto arriba, pero updateTallerBadge()/renderTaller() (llamados más
  // abajo, dentro del bloque de taller) no vuelven a correr, así que
  // applyTallerHibridoGate() tampoco — el badge y la sub-pestaña "Por
  // autorizar" se quedan pegados al estado de antes del flip hasta que algo
  // MÁS cambie o el usuario recargue.
  const snapshotSig = hydrateSignature([
    units,
    checklists,
    semanales,
    tallerCloud,
    checkDones,
    combustible,
    validaciones,
    complianceDocs,
    anulaciones,
    appConfigRows,
  ]);
  if (window.__lastHydrateSig === snapshotSig) {
    console.info("[cloudHydrate] snapshot sin cambios — omito rebuild+render");
    const wu = (window as unknown as { units?: unknown[] }).units;
    return { units: Array.isArray(wu) ? wu.length : 0, source: "cloud" };
  }
  window.__lastHydrateSig = snapshotSig;

  // ── Auto-migración: tallerEntries locales (IndexedDB) NO en cloud → push ──
  // Si el user creó registros antes de la wire cloud (Taller wire fue Fase 10),
  // los entries viven solo en IndexedDB. Detectamos por id no presente en cloud
  // y los subimos automáticamente. Idempotente: misma key compuesta sobrescribe.
  const localTaller = window.tallerEntries ?? [];
  if (localTaller.length > 0) {
    const cloudIds = new Set<string>();
    for (const t of tallerCloud) {
      const datos = safeParseObj(t.datos);
      const id = String(datos.id ?? t.folio ?? "");
      if (id) cloudIds.add(id);
    }
    // Fase C2 (guarda anti-resurrección): NO re-subir entries que YA estuvieron
    // en el cloud (`_cloud:true`, marcado al hidratar). Sin esto, cuando un
    // usuario A borraba un registro, el usuario B —con la copia en su IndexedDB—
    // lo re-subía como "huérfano" en su próximo hydrate y el registro resucitaba.
    const orphans = localTaller.filter(
      (e) => !cloudIds.has(e.id) && !(e as { _cloud?: boolean })._cloud,
    );
    if (orphans.length > 0) {
      console.info(`[cloudHydrate] migrando ${orphans.length} taller entries locales al cloud`);
      try {
        // Fix ronda 3 (Task 9, Critical 1 — hueco #3): un huérfano LOCAL puede coincidir en
        // visitaKey (plate|fentrada, tallerCloudKey) con una visita que YA tiene partidas en
        // cloud — un mismo día, misma placa, reingreso local tras un upload fallido. Sin
        // resolver las partidas aquí, este upload no pasaba por el seam de cloudWire.ts y
        // volvía a escribir un gasto/gastoRef/gastoMO que las partidas ya poseen. No se
        // reusa `window.__tallerPartidas` — todavía no está poblado en este punto de la
        // hidratación (se arma más abajo) — así que se resuelve aparte, con la MISMA
        // fórmula (fetchPartidas + partidasVigentes + agruparPorVisita).
        const partidasOrfanas = await fetchPartidas(tenantId);
        const visitasAnuladasOrfanas = visitasAnuladasKeys(tallerCloud, anuladasActivas);
        const porVisitaOrfanas = partidasVigentesPorVisita(partidasOrfanas, visitasAnuladasOrfanas);
        // Task 10 (R62): con el esquema apagado, este resolver también ve `undefined` —
        // el mismo predicado (window.__tallerHibrido, ya resuelto arriba) que
        // partidasDeEntry en cloudWire.ts. Sin este candado, un huérfano migraría
        // aquí con su gasto tecleado RECORTADO aun con el apagador en OFF.
        const partidasDeOrfano = (e: LegacyTallerEntry): Partida[] | undefined =>
          window.__tallerHibrido ? porVisitaOrfanas.get(visitaKeyDe(e)) : undefined;
        await uploadTallerToCloud(
          orphans.map((e) => {
            // Cast: legacy entries pueden tener campos extra (km, etc) no en TallerEntry type.
            const raw = e as TallerEntry & Record<string, unknown>;
            return {
              id: raw.id,
              unitKey: raw.unitKey,
              eco: raw.eco,
              plate: raw.plate,
              brand: raw.brand,
              sucursal: raw.sucursal,
              area: raw.area,
              estado: raw.estado,
              tipo: raw.tipo,
              freporte: raw.freporte,
              fentrada: raw.fentrada,
              fsalidaEst: raw.fsalidaEst,
              fsalidaReal: raw.fsalidaReal,
              km: typeof raw.km === "number" ? raw.km : 0,
              gasto: raw.gasto,
              gastoRef: raw.gastoRef,
              gastoMO: raw.gastoMO,
              tecnico: raw.tecnico,
              pedidoErp: raw.pedidoErp,
              refacciones: raw.refacciones,
              comentario: raw.comentario,
              updatedAt: raw.updatedAt,
            };
          }),
          tenantId,
          partidasDeOrfano,
        );
        // Re-fetch tallerCloud para incluir los migrados.
        const refreshed = await listTaller(tenantId);
        tallerCloud.length = 0;
        tallerCloud.push(...refreshed);
        window.notify?.(`☁ ${orphans.length} registros de taller migrados al servidor`, "ok", 4000);
      } catch (err) {
        console.error("[cloudHydrate] migración taller falló:", err);
      }
    }
  }

  // Join VIVO con el catálogo de Unidades: submarca (eco.SUBMARCA → Unit.marca) y área
  // (asignada por el admin) por economicoId. buildFuelEntries normaliza las claves
  // (ecoKey "06"↔"6"). Reasignar el área re-clasifica el gasto histórico. También
  // alimenta el sellado del área de Taller (misma fuente de verdad, ver más abajo).
  const unidadPorEco = new Map<string, { submarca?: string; area?: string }>();
  for (const u of units) {
    const eco = String(u.economicoId ?? "");
    const marca = String(u.marca ?? "").trim();
    const area = String(u.area ?? "").trim();
    if (eco && (marca || area) && !unidadPorEco.has(eco))
      unidadPorEco.set(eco, { submarca: marca || undefined, area: area || undefined });
  }

  // ── Hydrate taller → window.tallerEntries ──────────────────
  // Cada Taller row reconstruye TallerEntry legacy desde datos JSON.
  // Fase C2: dedup en lectura — los re-keys históricos dejaron filas duplicadas
  // del mismo registro; la vista muestra UNA por id (gana la más reciente).
  // El reemplazo corre SIEMPRE (incluso con 0 filas): si otro usuario borró el
  // último registro, la copia en RAM de los demás también debe desaparecer.
  // El cloud es autoritativo aquí — la auto-migración (arriba) ya re-subió los
  // huérfanos legítimos pre-cloud, y el early-return de "cloud 100% vacío"
  // protege a tenants nuevos sin tocar su estado local.
  {
    // Anulación reversible (P0 2026-08-14): las filas con tombstone activo se excluyen
    // de la vista — el registro sigue en la nube y Restaurar lo trae de vuelta. Mismo
    // patrón que checklistsVigentes arriba; el refId se compone con los campos de CLAVE
    // de la propia fila (unitUid, fechaEntrada), la misma identidad que tallerCloudKey.
    const tallerVigente = tallerCloud.filter((t) => !esTallerAnulado(t, anuladasActivas));
    const dedupedTaller = dedupTallerCloudRows(tallerVigente);
    if (dedupedTaller.length < tallerVigente.length) {
      console.info(
        `[cloudHydrate] taller dedup: ${tallerVigente.length - dedupedTaller.length} fila(s) duplicada(s) ocultas`,
      );
    }
    const tallerEntries: TallerEntry[] = dedupedTaller.map((t) => {
      const datos = safeParseObj(t.datos);
      const estadoRaw = datos.estado ?? (t.estatus === "cerrado" ? "Finalizado" : "En Diagnóstico");
      const estado: TallerEstado = migrateEstado(estadoRaw);
      return {
        id: String(datos.id ?? t.folio ?? `${t.unitUid}_${t.fechaEntrada}`),
        unitKey: String(datos.unitKey ?? t.unitUid),
        eco: String(datos.eco ?? ""),
        plate: String(datos.plate ?? t.unitUid),
        brand: String(datos.brand ?? ""),
        sucursal: String(datos.sucursal ?? ""),
        // El área SIEMPRE sale del catálogo de la unidad (misma fuente que
        // Combustible); lo capturado a mano queda como respaldo normalizado.
        area:
          normalizeArea(unidadPorEco.get(String(datos.eco ?? "").trim())?.area) ||
          normalizeArea(datos.area),
        tipo: String(datos.tipo ?? t.motivo ?? ""),
        estado,
        freporte: String(datos.freporte ?? ""),
        fentrada: String(datos.fentrada ?? t.fechaEntrada),
        fsalidaEst: String(datos.fsalidaEst ?? ""),
        fsalidaReal: String(datos.fsalidaReal ?? t.fechaSalida ?? ""),
        km: Number(datos.km) || 0,
        gasto: numOrUndef(datos.gasto),
        gastoRef: numOrUndef(datos.gastoRef),
        gastoMO: numOrUndef(datos.gastoMO),
        tecnico: String(datos.tecnico ?? ""),
        pedidoErp: String(datos.pedidoErp ?? ""),
        refacciones: String(datos.refacciones ?? ""),
        comentario: String(datos.comentario ?? ""),
        updatedAt: String(datos.updatedAt ?? ""),
        // Marca "ya estuvo en cloud" — la auto-migración no lo re-sube si otro
        // usuario lo borra (guarda anti-resurrección, Fase C2). Persiste al
        // IndexedDB local junto con el entry.
        _cloud: true,
      };
    });
    window.tallerEntries = tallerEntries;
    // Ciclo de firma (Task 7): partidas agrupadas por visita — de aquí sale el
    // conteo de "esperando tu autorización" que prende el badge de la pestaña.
    // Fix ronda 1: las de una visita ANULADA se excluyen ANTES de agrupar — se
    // recalcula en cada hidratación, así que restaurar la anulación las trae
    // de vuelta solas, sin caché que limpiar. Fix ronda 2: el set de visitas
    // anuladas se construye hacia ADELANTE (visitasAnuladasKeys), nunca
    // separando de vuelta una visitaKey existente.
    const visitasAnuladas = visitasAnuladasKeys(tallerCloud, anuladasActivas);
    const partidas = await fetchPartidas(tenantId);
    window.__tallerPartidas = partidasVigentesPorVisita(partidas, visitasAnuladas);
    // Bridge (fix ronda 2, Finding 1): publica la MISMA pendientesDeFirma que
    // usará la bandeja de firma (Task 8) — el badge del monolito la consume
    // en vez de reimplementar el filtro "estado === propuesta".
    window.__pendientesDeFirma = pendientesDeFirma;
    // Task 8 (bandeja de firmas): mismo seam de bridge que arriba — funciones
    // puras de src/ publicadas para que el <script> inline las invoque (no
    // puede `import`). `filasBandeja`/`gastoAnualPorEco` se llaman con datos
    // frescos en cada render (no solo al hidratar), así que se publica la
    // FUNCIÓN, no un resultado ya calculado.
    window.__filasBandeja = filasBandeja;
    window.__gastoAnualPorEco = gastoAnualPorEco;
    // Task 9: mismo seam — la aritmética de "el gasto se calcula" vive en src/,
    // el monolito solo la invoca para pintar #tf-gasto en solo lectura.
    window.__gastoDerivado = gastoDerivado;
    // Fix ronda 2 (Task 9, Important 2): reemplaza al bridge __totalesVisita de la
    // ronda 1 — la leyenda de #tf-gasto ya no calcula un residuo en el inline script.
    window.__montoPendienteDeFirma = montoPendienteDeFirma;
    window.__MOTIVOS_RECHAZO = MOTIVOS_RECHAZO;
    window.__visitaKeyDe = visitaKeyDe;
    window.__urlFotoPartida = urlFotoPartida;
    window.__resumenLoteFirma = resumenLoteFirma;
    window.__guardarDecisionPartida = async (partidaId, visitaKey, decision, motivo, nota) => {
      const ps = window.__tallerPartidas?.get(visitaKey) ?? [];
      const partida = ps.find((p) => p.partidaId === partidaId);
      if (!partida) {
        throw new Error(
          `[guardarDecisionPartida] partida no encontrada: ${partidaId} (${visitaKey})`,
        );
      }
      const quien = window.__cloudSession?.email || "desconocido";
      await guardarDecisionPartida({
        tenantId,
        partida,
        decision,
        quien,
        cuando: new Date().toISOString(),
        motivo,
        nota,
      });
    };
    if (typeof window.updateTallerBadge === "function") window.updateTallerBadge();
    if (typeof window.renderTaller === "function") window.renderTaller();
    console.info(`[cloudHydrate] ${tallerEntries.length} taller entries hidratados`);
  }

  // ── Hydrate semanales → window.weeklyPeriodos ──────────────────
  // Agrupa entries por periodoId. Cada Semanal row es una entry de una unidad
  // en un período (semana ISO). Reconstruimos el shape legacy {id, label, entries}.
  if (semanales.length > 0) {
    const periodoMap = new Map<string, WeeklyEntry[]>();
    for (const s of semanales) {
      // Reporte semanal anulado por admin → fuera de KPIs/tabla/badges del módulo.
      if (esSemanalAnulado(s, anuladasActivas)) continue;
      const datos = safeParseObj(s.datos);
      // economicoId desde datos JSON (Excel "# Economico - id"). Fallback a
      // placa si upload viejo no lo guardó.
      const ecoId = String(datos.economicoId ?? "").trim() || s.unitUid;
      const entry: WeeklyEntry = {
        uid: s.unitUid,
        eco: ecoId,
        plate: s.unitUid,
        brand: String(datos.brand ?? ""),
        branch: s.sucursal,
        km: (datos.km as number | string) ?? "",
        fecha: String(datos.fecha ?? ""),
        responsable: String(datos.responsable ?? ""),
        aceite: String(datos.aceite ?? ""),
        aceiteRisk: asRisk(datos.aceiteRisk),
        radiador: String(datos.radiador ?? ""),
        radiadorRisk: asRisk(datos.radiadorRisk),
        carroceria: String(datos.carroceria ?? ""),
        carroceriaRisk: asRisk(datos.carroceriaRisk),
        llanta: String(datos.llanta ?? ""),
        llantaRisk: asRisk(datos.llantaRisk),
        risk: asRisk(datos.risk) ?? "OK",
        photos: Array.isArray(datos.photos) ? (datos.photos as string[]) : [],
      };
      const arr = periodoMap.get(s.periodoId) ?? [];
      arr.push(entry);
      periodoMap.set(s.periodoId, arr);
    }
    const weeklyPeriodos: WeeklyPeriodo[] = [...periodoMap.entries()]
      .map(([id, entries]) => ({
        id,
        label: periodoLabelFromId(id),
        uploadedAt: new Date().toISOString(),
        entries,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    window.weeklyPeriodos = weeklyPeriodos;
    if (weeklyPeriodos.length > 0) {
      window.activeWeeklyPeriodoId = weeklyPeriodos[weeklyPeriodos.length - 1]!.id;
    }
    if (typeof window.updateSwNavBadge === "function") window.updateSwNavBadge();
    // Fix 2026-06-09: inicializar la barra de rango de fechas y re-render de la
    // vista semanal. Antes solo se actualizaba el badge — si el usuario estaba
    // parado en "Semanales" cuando llegaba el hydrate, la vista (filtro de
    // fechas, KPIs, tabla) quedaba vacía hasta navegar fuera y volver.
    if (typeof window.initRangoSemanal === "function") window.initRangoSemanal();
    if (typeof window.renderSemanales === "function") window.renderSemanales();
    console.info(`[cloudHydrate] ${weeklyPeriodos.length} períodos semanales hidratados`);
  }

  // ── Hydrate combustible → window.fuelEntries ──────────────────
  // CargaCombustible (solicitudes + cargas) + ValidacionCarga (revisión) → FuelEntry[].
  // Las fotos de evidencia se pre-firman junto con las demás (más abajo).
  {
    const fuelEntries = buildFuelEntries(combustible, validaciones, unidadPorEco, anuladasActivas);
    window.fuelEntries = fuelEntries;
    // Perf F3-1: fijar el estado de la ventana (frontera + crudo + insumos) para que
    // ensureFuelWindow pueda ampliar hacia atrás sin re-descargar todo. La frontera
    // persiste entre auto-refreshes de la sesión (una vez ampliada, se mantiene).
    if (fuelWindowFrom === null) fuelWindowFrom = defaultFuelWindowFrom();
    fuelRaw = [...combustible];
    fuelDeps = { tenantId, validaciones, unidadPorEco, anuladasActivas };
    if (typeof window.updateFuelNavBadge === "function") window.updateFuelNavBadge();
    if (typeof window.initRangoFuel === "function") window.initRangoFuel();
    if (typeof window.renderCombustible === "function") window.renderCombustible();
    console.info(
      `[cloudHydrate] ${fuelEntries.length} registros de combustible hidratados (ventana desde ${fuelWindowFrom})`,
    );
  }

  // No early-exit aquí. Aunque units.length === 0, semanales puede tener
  // fotos que necesitan pre-fetch. Continuamos con un legacyUnits vacío.

  // ── Inspecciones por fecha → vista de rango (Desde/Hasta) ──
  // Cada checklist es una FILA de inspección con uid sintético único
  // (`placa__fecha`) para que la misma unidad pueda aparecer varias veces sin
  // colisionar en selección/detalle. Preserva eco/plate/fecha reales.
  const unitByPlaca = new Map(units.map((u) => [u.placa, u] as const));
  const inspections: Unit[] = [];
  for (const c of checklistsVigentes) {
    const fecha = String(c.fecha ?? "");
    if (!monthOf(fecha)) continue; // requiere fecha parseable
    const u =
      unitByPlaca.get(c.unitUid) ?? ({ tenantId, placa: c.unitUid } as Schema["Unit"]["type"]);
    const row = mergeUnitWithChecklist(u, c);
    row.uid = `${row.plate ?? c.unitUid}__${fecha}`; // único por inspección
    inspections.push(row);
  }
  // Desc por fecha (más reciente primero). Normaliza DMY→ISO para ordenar bien.
  inspections.sort((a, b) => isoDay(b.fecha).localeCompare(isoDay(a.fecha)));

  // Flota = unidades distintas del catálogo con su ÚLTIMO checklist (estado actual,
  // independiente del rango). Alimenta los KPIs hero + dona Operativa/Taller.
  const latestByUnit = new Map<string, Schema["Checklist"]["type"]>();
  for (const c of checklistsVigentes) {
    const e = latestByUnit.get(c.unitUid);
    if (!e || isoDay(c.fecha) > isoDay(e.fecha)) latestByUnit.set(c.unitUid, c);
  }
  window.__fleetUnits = units.map((u) => mergeUnitWithChecklist(u, latestByUnit.get(u.placa)));

  // ── Hydrate cumplimiento → window.complianceEntries ───────────
  // ComplianceDoc → ComplianceEntry[] (estado vencido/por-vencer derivado vs hoy). Se
  // resuelve sucursal/placa por economicoId desde el catálogo de Unit. El merge con la
  // flota completa (unidades sin docs = 'desconocido') lo hace el wire al renderizar.
  // Va DESPUÉS de fijar window.__fleetUnits, que renderCumplimiento usa para ese merge.
  {
    // "hoy" en la zona de México (no UTC): el estado vencido/por-vencer se ancla aquí y
    // GPA opera en husos negativos vs UTC; con toISOString() la fecha se adelantaba un día
    // en la ventana nocturna local (off-by-one en el borde de vencimiento). en-CA emite
    // YYYY-MM-DD directo. México sin DST desde 2022; Intl resuelve el offset por timeZone.
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
    const unitsByEco = new Map<string, { sucursal?: string; placa?: string }>();
    for (const u of units) {
      const eco = String(u.economicoId ?? "").trim();
      if (eco) unitsByEco.set(eco, { sucursal: u.sucursal ?? undefined, placa: u.placa });
    }
    window.complianceEntries = buildComplianceEntries(complianceDocs, hoy, { unitsByEco });
    if (typeof window.updateCumplimientoNavBadge === "function")
      window.updateCumplimientoNavBadge();
    if (typeof window.renderCumplimiento === "function") window.renderCumplimiento();
    console.info(`[cloudHydrate] ${complianceDocs.length} documentos de cumplimiento hidratados`);

    // ── Hydrate accesorios (sub-pestaña de Taller) → window.accesorioEntries ──
    // Mismo `hoy` de zona México: la antigüedad en meses se ancla ahí. El accesorio
    // vigente por unidad lo deriva el wire al renderizar (no se persiste).
    window.accesorioEntries = buildAccesorioEntries(accesorioRows, hoy, { unitsByEco });
    if (typeof window.renderAccesorios === "function") window.renderAccesorios();
    console.info(`[cloudHydrate] ${accesorioRows.length} registros de accesorios hidratados`);
  }

  let legacyUnits: Unit[];
  if (inspections.length > 0) {
    window.__inspections = inspections;
    // Min/max en ISO para que __inspMinDate/__inspMaxDate y el datepicker
    // (type=date → ISO) ordenen cronológicamente aunque la fecha venga en DMY.
    const fechas = inspections
      .map((i) => isoDay(i.fecha))
      .filter(Boolean)
      .sort();
    window.__inspMinDate = fechas[0];
    window.__inspMaxDate = fechas[fechas.length - 1];
    // Default: inspecciones del mes más reciente (evita arrancar con cientos).
    const maxMonth = monthOf(window.__inspMaxDate) ?? "";
    legacyUnits = inspections.filter((i) => monthOf(i.fecha) === maxMonth);
    window.units = legacyUnits;
    // Filtro por rango — lo llama el control Desde/Hasta del HTML.
    window.applyDateRange = (fromISO: string, toISO: string) => {
      const from = fromISO || "0000-01-01";
      const to = toISO || "9999-12-31";
      const sel = (window.__inspections ?? []).filter((i) => {
        const f = isoDay(i.fecha); // normaliza DMY→ISO para comparar contra from/to (ISO)
        return f !== "" && f >= from && f <= to;
      });
      window.units = sel;
      // Los risk de resultados vienen crudos (sin descuento de marcas/overlay);
      // recalc sobre el rango activo para que el pill de filas viejas no
      // contradiga a la celda de hallazgos (revisión adversarial 2026-07-23).
      if (typeof window.recalcAllRisks === "function") window.recalcAllRisks();
      if (typeof window.buildKPIs === "function") window.buildKPIs();
      if (typeof window.renderTable === "function") window.renderTable();
      if (typeof window.buildAlertsSummary === "function") window.buildAlertsSummary();
      if (typeof window.buildAnalytics === "function") window.buildAnalytics();
    };
  } else {
    // Fallback: sin checklists con fecha parseable → latest-per-unit plano.
    const checklistByUnit = new Map<string, Schema["Checklist"]["type"]>();
    for (const c of checklistsVigentes) {
      const existing = checklistByUnit.get(c.unitUid);
      if (!existing || (c.fecha ?? "") > (existing.fecha ?? "")) {
        checklistByUnit.set(c.unitUid, c);
      }
    }
    legacyUnits = units.map((u) => mergeUnitWithChecklist(u, checklistByUnit.get(u.placa)));
    window.units = legacyUnits;
  }

  if (!window.checklistDB) window.checklistDB = {} as ChecklistDB;
  const db = window.checklistDB;
  // Init checklistDB para los uids de TODAS las inspecciones.
  const allSnapUnits = window.__inspections ?? legacyUnits;
  for (const u of allSnapUnits) {
    if (!db[u.uid]) db[u.uid] = {};
  }

  // Pre-fetch URLs firmadas de S3 para las fotos del RANGO/PERÍODO ACTIVO.
  // Perf F3-3 (2026-07-10): antes se pre-firmaba TODO el histórico (inspecciones de
  // todos los meses + todos los períodos semanales + todo combustible) — miles de
  // firmas SigV4 en el main thread en cada boot, creciendo con el archivo. Ahora:
  // - Inspecciones: solo el rango visible (window.units, default mes reciente).
  // - Semanales: solo el período activo.
  // - Combustible: ya viene acotado por la ventana de hidratación (F3-1).
  // Las fotos FUERA de lo pre-firmado se firman on-demand al verse: galería vía
  // lazyObserver→__cloudGetPhotoUrl; lightbox/PDF/drawer con fallback async (F3-3).
  const allPhotoFnames = new Set<string>();
  for (const u of window.units ?? legacyUnits) {
    for (const p of u.photos ?? []) {
      const fn = (p as { fname?: string }).fname;
      if (fn) allPhotoFnames.add(fn.toLowerCase());
    }
  }
  // Semanales: cada entry tiene array de filenames raw (string[]).
  const activeWk = window.activeWeeklyPeriodoId;
  for (const periodo of window.weeklyPeriodos ?? []) {
    if (activeWk && periodo.id !== activeWk) continue;
    for (const entry of periodo.entries ?? []) {
      for (const fn of entry.photos ?? []) {
        if (fn) allPhotoFnames.add(String(fn).toLowerCase());
      }
    }
  }
  // Combustible: cada FuelEntry tiene fotos {fname,col,group} (evidencias).
  for (const fe of window.fuelEntries ?? []) {
    for (const p of fe.photos ?? []) {
      if (p.fname) allPhotoFnames.add(p.fname.toLowerCase());
    }
  }
  // FIRMA DE URLS DE FOTOS — por-demanda, sin listar el bucket (fix de raíz 2026-06-15).
  // firmar (getUrl) = LOCAL/barato; se firma cada fname del rango directamente. ANTES se
  // listaba todo S3 (indexCloudPhotos) para "verificar existencia" antes de firmar; ese
  // listado de ~22k fotos fallaba al crecer el bucket y dejaba el mapa VACÍO → "Sin fotos
  // disponibles". Ya no: firmamos directo (el path aísla por tenant; el onerror del <img>
  // cubre las inexistentes). Las URLs expiran ≈15min (acotadas por la credencial Cognito);
  // el auto-refresh (poll 4min) re-firma las próximas a vencer.
  window.__cloudPhotoUrlMap = window.__cloudPhotoUrlMap ?? new Map<string, PhotoUrlEntry>();
  const existingMap = window.__cloudPhotoUrlMap;
  const allFnamesArr = [...allPhotoFnames];
  const newFnames = allFnamesArr.filter((f) => !existingMap.has(f));
  const RESIGN_WINDOW_MS = 5 * 60 * 1000; // re-firmar las que vencen dentro de 5min
  const soon = Date.now() + RESIGN_WINDOW_MS;
  const staleFnames = allFnamesArr.filter((f) => {
    const e = existingMap.get(f);
    return e !== undefined && e.expires <= soon;
  });
  if (newFnames.length > 0 || staleFnames.length > 0) {
    try {
      if (newFnames.length > 0) {
        // Firma directa, sin index previo (getUrl no lista ni valida existencia).
        const urlMap = await batchGetCloudPhotoUrls(tenantId, newFnames);
        let count = 0;
        for (const [fname, entry] of urlMap) {
          if (entry) {
            existingMap.set(fname, entry);
            count++;
          }
        }
        console.info(`[cloudHydrate] ${count}/${newFnames.length} URLs de fotos nuevas firmadas`);
      }
      if (staleFnames.length > 0) {
        // Re-firma local (force:true) → barato, sin red de listado.
        const fresh = await refreshPhotoUrls(tenantId, staleFnames);
        let resigned = 0;
        for (const [fname, entry] of fresh) {
          if (entry) {
            existingMap.set(fname, entry);
            resigned++;
          }
        }
        if (resigned)
          console.info(
            `[cloudHydrate] ${resigned}/${staleFnames.length} URLs re-firmadas (por vencer)`,
          );
      }
    } catch (err) {
      console.warn("[cloudHydrate] photo URLs prefetch falló:", err);
    }
  }

  // Perf F2-5: cota superior del mapa de URLs firmadas. Antes crecía monótonamente (solo
  // .set, nunca .delete) → en sesiones largas (PWA abierta días) acumulaba decenas de miles
  // de {url ~500 chars, expires} (~15-30 MB). Podamos las más antiguas (el Map preserva orden
  // de inserción) al superar el tope; las evictadas se re-firman por-demanda al verse
  // (imgUrl → lazyObserver → __cloudGetPhotoUrl), así que podar es seguro.
  const PHOTO_URL_CAP = 6000;
  if (existingMap.size > PHOTO_URL_CAP) {
    const toDelete: string[] = [];
    const excess = existingMap.size - PHOTO_URL_CAP;
    for (const key of existingMap.keys()) {
      if (toDelete.length >= excess) break;
      toDelete.push(key);
    }
    for (const key of toDelete) existingMap.delete(key);
    console.info(
      `[cloudHydrate] photo URL cache podado: -${toDelete.length} (tope ${PHOTO_URL_CAP})`,
    );
  }

  // Completaciones de checklist COMPARTIDAS (Fase C1) + overlay auto-resueltos.
  // Orden OBLIGATORIO (spec 2026-07-23-hallazgos-autoresueltos §3):
  //   purga(auto) → merge cloud → persistir sin autos → inyección → recalc.
  // Sin la purga previa, un auto viejo bloquearía por LWW el re-merge de marcas
  // humanas y sobreviviría a la anulación de su evidencia.
  {
    const cdb = (window.checklistDB ?? {}) as Record<string, DoneMap>;
    purgeAutoEntries(cdb);
    if (checkDones.length) {
      const { modifiedUids } = mergeCheckDones({
        checkDones,
        rows: (window.__inspections ?? legacyUnits).map((u) => ({ uid: u.uid, plate: u.plate })),
        cdb,
        dirty: window.__checkDirty,
      });
      // Persistir a IndexedDB (H7): sin esto un arranque offline restaura el
      // snapshot viejo y "revive" desmarcados ya propagados. stripAuto por
      // defensa: en este punto aún no hay autos, pero blinda reordenamientos.
      if (typeof window.dbPut === "function") {
        for (const uid of modifiedUids) {
          try {
            void window.dbPut("checklist", uid, stripAuto(cdb[uid] ?? {}));
          } catch {
            /* persistencia best-effort */
          }
        }
      }
    }
    // Overlay derivado (solo memoria, jamás persistido): __inspections trae todas
    // las filas hidratadas, ya sin anuladas (checklistsVigentes).
    injectAutoResolve({ rows: (window.__inspections ?? []) as AutoRow[], cdb });
    window.checklistDB = cdb as ChecklistDB;
  }
  // Recalcular el riesgo efectivo por fila con las completaciones aplicadas —
  // antes de C1 no se llamaba y el badge de riesgo nunca descontaba atendidos
  // en sesiones cloud.
  if (typeof window.recalcAllRisks === "function") window.recalcAllRisks();

  // Trigger re-render del legacy. Sin esto, UI sigue vacía aunque state esté lleno.
  if (typeof window.initRangoBar === "function") window.initRangoBar();
  if (typeof window.showDash === "function") window.showDash();
  // Header status: sin esto quedaba "Sin datos cargados" en sesiones cloud puras.
  {
    const hstxt = document.getElementById("hstxt");
    if (hstxt && legacyUnits.length > 0) {
      // Etiqueta corta: la larga ("Datos del servidor (nube)") se envolvía a
      // 3 renglones en el header a 1366px (auditoría UX 2026-07 H20).
      hstxt.textContent = "Nube";
      hstxt.title = "Datos del servidor (nube)";
    }
    const hdot = document.getElementById("hdot");
    if (hdot && legacyUnits.length > 0) hdot.className = "hdot live";
  }
  // Stale-while-revalidate (perf boot 2026-07-14): persistir el snapshot para que
  // el PRÓXIMO boot pinte al instante desde IndexedDB (restoreState ya sabe
  // restaurar y el hydrate corre de fondo y re-renderiza). Sin esto, las sesiones
  // cloud arrancaban SIEMPRE con IDB vacío → spinner bloqueante los ~10s de la
  // descarga. Fire-and-forget con throttle (el auto-refresh re-hidrata cada 4min).
  if (
    legacyUnits.length > 0 &&
    typeof window.persistState === "function" &&
    Date.now() - lastCloudPersist > 5 * 60_000
  ) {
    lastCloudPersist = Date.now();
    void Promise.resolve(window.persistState("Datos de la nube")).catch((e) =>
      console.warn("[cloudHydrate] persistencia del snapshot falló (no-fatal):", e),
    );
  }
  if (typeof window.buildKPIs === "function") window.buildKPIs();
  // Sin esto el filtro de sucursales (#bsel) queda vacío en sesiones cloud.
  if (typeof window.buildBranches === "function") window.buildBranches();
  if (typeof window.renderTable === "function") window.renderTable();
  if (typeof window.buildAlertsSummary === "function") window.buildAlertsSummary();
  if (typeof window.buildAnalytics === "function") window.buildAnalytics();
  // Re-render detail panel si está abierto — sin esto las fotos en panel
  // mantienen src vacío de cuando el URL map todavía no se había poblado.
  if (typeof window.renderDet === "function") window.renderDet();
  // Re-render taller — el primer renderTaller corrió antes de poblar window.units,
  // por lo que el lookup de economicoId regresaba undefined. Ahora units está
  // listo, segundo render usa el ID correcto.
  if (typeof window.renderTaller === "function") window.renderTaller();

  console.info(`[cloudHydrate] ${legacyUnits.length} units hidratados del cloud`);
  return { units: legacyUnits.length, source: "cloud" };
}
