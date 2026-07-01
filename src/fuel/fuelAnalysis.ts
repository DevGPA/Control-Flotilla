/**
 * Motor PURO de rendimiento y anomalías de combustible. Sin DOM ni red.
 *
 * km/l por evento = (km de esta carga − km de la carga anterior de la MISMA unidad)
 * / litros cargados. Supuesto tanque-lleno: si una carga no llenó el tanque el evento
 * es ruidoso → el baseline por unidad recorta outliers (IQR) y los KPIs/alertas
 * priorizan el promedio por unidad sobre el km/l de un evento aislado.
 */
import type {
  FuelEntry,
  FuelMetrics,
  FleetBaseline,
  FuelStat,
  FuelThresholds,
  FuelFinding,
  MotivoSinKmpl,
  RiskLevel,
} from "./types";
import { mean, stdDev, percentile, clampOutliers } from "../analyzer/statistics";

export const DEFAULT_FUEL_THRESHOLDS: FuelThresholds = {
  DROP_SD: 1.5,
  DROP_PCT: 0.75,
  LITERS_SD: 2,
  // Salto de odómetro entre cargas consecutivas. El máximo delta legítimo observado en la
  // flota es ~989 km, con un hueco duro hasta ~2633 km; 1800 corta los saltos espurios
  // (probable error de captura / cargas intermedias sin registrar) sin descartar tramos reales.
  MAX_KM_JUMP: 1800,
  MIN_DAYS: 1,
  PRICE_MIN: 18,
  PRICE_MAX: 35,
  LEAK_PCT: 0.5,
  MIN_BASELINE_N: 3,
};

/**
 * Rango físico plausible de km/l para vehículos de combustión interna de la flota. Un km/l
 * FUERA de [MIN, MAX] no es rendimiento: es dato no verídico (odómetro truncado que produce
 * ~0.2 km/l, o un salto que produce ~110). Se anula (motivoSinKmpl='kmpl_implausible') para
 * que no contamine el baseline ni se muestre como número. Aplica a TODO, incluida la flota.
 */
export const KMPL_FISICO_MIN = 1.5;
export const KMPL_FISICO_MAX = 40;

/** Explicación larga del motivo por el que una carga no tiene km/l (para el detalle). */
export const MOTIVO_SIN_KMPL_LABEL: Record<MotivoSinKmpl, string> = {
  primera_carga:
    "Primera carga registrada de la unidad — no hay odómetro anterior con qué medir el recorrido.",
  montacargas: "Montacargas: mide horas de uso (horómetro), no kilómetros — el km/l no aplica.",
  sin_odometro: "Falta el kilometraje (odómetro) en esta carga.",
  sin_litros: "Faltan los litros cargados en esta carga.",
  odometro_retroceso:
    "El odómetro es menor que el de la carga anterior — captura por revisar (retroceso).",
  salto_improbable:
    "Salto de odómetro improbable entre cargas — probable carga intermedia no registrada.",
  llenado_partido:
    "Parte de un llenado partido (mismo odómetro) — el rendimiento se muestra en la carga principal del grupo.",
  kmpl_implausible:
    "Rendimiento fuera del rango físico posible — dato no verídico (odómetro truncado o salto de captura).",
};

/** Etiqueta corta (chip/tooltip de la tabla) del motivo sin km/l. */
export const MOTIVO_SIN_KMPL_CORTO: Record<MotivoSinKmpl, string> = {
  primera_carga: "1ª carga",
  montacargas: "Montacargas",
  sin_odometro: "Sin odómetro",
  sin_litros: "Sin litros",
  odometro_retroceso: "Odómetro retrocede",
  salto_improbable: "Salto de odómetro",
  llenado_partido: "Llenado partido",
  kmpl_implausible: "Valor implausible",
};

/**
 * ¿El motivo señala un dato POR REVISAR (captura mala) en vez de un hueco estructural correcto?
 * Estructurales: primera_carga, montacargas, llenado_partido. El resto es accionable.
 */
export const MOTIVO_SIN_KMPL_ACCIONABLE: Record<MotivoSinKmpl, boolean> = {
  primera_carga: false,
  montacargas: false,
  llenado_partido: false,
  sin_odometro: true,
  sin_litros: true,
  odometro_retroceso: true,
  salto_improbable: true,
  kmpl_implausible: true,
};

/**
 * Timestamp para ordenar cronológicamente (fechaHora si existe, si no fecha).
 * Construye la fecha por COMPONENTES en hora local para que "YYYY-MM-DD" (solo
 * fecha) y "YYYY-MM-DD HH:MM" usen el MISMO huso. Antes se usaba Date.parse, que
 * interpreta la solo-fecha como UTC y la fecha+hora como local → en UTC-6 invertía
 * el orden de cargas de la misma unidad y corrompía km/l + disparaba falsas anomalías.
 */
function toTime(e: Pick<FuelEntry, "fecha" | "fechaHora">): number {
  const raw = String(e.fechaHora || e.fecha || "").trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : 0;
  }
  return new Date(+m[1]!, +m[2]! - 1, +m[3]!, m[4] ? +m[4] : 0, m[5] ? +m[5] : 0).getTime();
}

/** Agrupa entradas por unidad (economicoId), preservando el array por clave. */
export function groupByUnit<T extends { eco: string }>(items: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) pushInto(m, it.eco, it);
  return m;
}

/** Empuja `val` al array de la clave `key` en `m`, creándolo si no existe. */
function pushInto<T>(m: Map<string, T[]>, key: string, val: T): void {
  const arr = m.get(key);
  if (arr) arr.push(val);
  else m.set(key, [val]);
}

/**
 * Orden cronológico de eventos de una unidad: por fecha/hora; con el mismo timestamp (típico
 * cuando MoreApp manda solo fecha sin hora) desempata por odómetro ascendente (para no inventar
 * un retroceso) y luego por loadId (estable, no depende del orden de listado de DynamoDB).
 */
function cronoCmp(
  a: Pick<FuelEntry, "fecha" | "fechaHora" | "km" | "loadId">,
  b: Pick<FuelEntry, "fecha" | "fechaHora" | "km" | "loadId">,
): number {
  const dt = toTime(a) - toTime(b);
  if (dt !== 0) return dt;
  const ka = typeof a.km === "number" ? a.km : 0;
  const kb = typeof b.km === "number" ? b.km : 0;
  if (ka !== kb) return ka - kb;
  return a.loadId.localeCompare(b.loadId);
}

/**
 * Calcula métricas km/l por evento de CARGA. Ignora solicitudes (sin litros reales).
 * La primera carga de cada unidad no tiene km/l (sin carga anterior).
 */
export function computeFuelMetrics(entries: readonly FuelEntry[]): FuelMetrics[] {
  const cargas = entries.filter((e) => e.tipo === "carga");
  const byUnit = groupByUnit(cargas);
  const out: FuelMetrics[] = [];
  for (const arr of byUnit.values()) {
    const sorted = [...arr].sort(cronoCmp);
    // Ancla de distancia = el ÚLTIMO llenado con odómetro distinto.
    let prevFillKm: number | null = null;
    let prevFillMonta = false;
    let prevFillLleno = false;
    let prevEmitted: FuelEntry | null = null;
    let i = 0;
    while (i < sorted.length) {
      // LLENADO PARTIDO: cargas CONSECUTIVAS con el MISMO odómetro son un solo llenado
      // dividido en varias transacciones (mismo km ⇒ no se condujo entre ellas). Se agrupan
      // para que el km/l use la SUMA de litros del llenado (y no la distancia ÷ una sola
      // transacción chica, que dispara un km/l absurdo). Sin km → grupo de 1.
      const head = sorted[i]!;
      const gKm = typeof head.km === "number" && Number.isFinite(head.km) ? head.km : null;
      let j = i + 1;
      if (gKm != null) {
        while (j < sorted.length && typeof sorted[j]!.km === "number" && sorted[j]!.km === gKm) j++;
      }
      const group = sorted.slice(i, j);

      // Litros del llenado (denominador del km/l) y estado montacargas (consistente por unidad).
      let litrosGrupo = 0;
      for (const g of group)
        if (typeof g.litros === "number" && g.litros > 0) litrosGrupo += g.litros;
      const grupoMonta = group.some((g) => g.esMontacargas);
      // ¿El llenado fue a tanque lleno? (alguna transacción del grupo con seLlenoTanque='Si').
      const grupoLleno = group.some((g) => g.seLlenoTanque === "Si");

      // Distancia y km/l del LLENADO (una sola vez, sobre los litros sumados).
      // Montacargas Gas LP: su `km` es horómetro → no se computa km/l (ruido para baseline).
      let fillKmDesde: number | null = null;
      let fillKmpl: number | null = null;
      if (prevFillKm != null && gKm != null && !grupoMonta && !prevFillMonta) {
        fillKmDesde = gKm - prevFillKm;
        // km/l solo si el tramo es plausible: >0 y por debajo del salto improbable (un salto
        // > MAX_KM_JUMP suele ser cargas intermedias no registradas → inflaría el km/l).
        // `kmDesdeAnterior` queda poblado en la fila representativa para que la alerta km-salto
        // / km-retrocede siga disparando.
        if (
          litrosGrupo > 0 &&
          fillKmDesde > 0 &&
          fillKmDesde <= DEFAULT_FUEL_THRESHOLDS.MAX_KM_JUMP
        )
          fillKmpl = fillKmDesde / litrosGrupo;
      }

      // Piso físico de validez: un km/l fuera de [MIN,MAX] es dato NO verídico (odómetro
      // truncado o salto) — se anula para no contaminar baseline/flota ni mostrarse como número.
      let kmplImplausible = false;
      if (fillKmpl != null && (fillKmpl < KMPL_FISICO_MIN || fillKmpl > KMPL_FISICO_MAX)) {
        fillKmpl = null;
        kmplImplausible = true;
      }

      // Motivo del km/l ausente del LLENADO (para explicar el "—"); undefined si sí hay km/l.
      // Mismo orden que las guardas de arriba: monta → sin odómetro → sin ancla previa →
      // sin litros → retroceso → salto improbable.
      let motivoFill: MotivoSinKmpl | undefined;
      if (fillKmpl == null) {
        if (kmplImplausible) motivoFill = "kmpl_implausible";
        else if (grupoMonta || prevFillMonta) motivoFill = "montacargas";
        else if (gKm == null) motivoFill = "sin_odometro";
        else if (prevFillKm == null) motivoFill = "primera_carga";
        else if (litrosGrupo <= 0) motivoFill = "sin_litros";
        else if (fillKmDesde != null && fillKmDesde <= 0) motivoFill = "odometro_retroceso";
        else if (fillKmDesde != null && fillKmDesde > DEFAULT_FUEL_THRESHOLDS.MAX_KM_JUMP)
          motivoFill = "salto_improbable";
      }

      // Fila representativa = la de MÁS litros (la carga "principal"); muestra el km/l del
      // llenado. Las demás cargas del grupo van con km/l "—" (son la misma carga física).
      let repIdx = 0;
      for (let k = 1; k < group.length; k++) {
        const lk = typeof group[k]!.litros === "number" ? group[k]!.litros! : -1;
        const lr = typeof group[repIdx]!.litros === "number" ? group[repIdx]!.litros! : -1;
        if (lk > lr) repIdx = k;
      }

      for (let k = 0; k < group.length; k++) {
        const e = group[k]!;
        const km = typeof e.km === "number" && Number.isFinite(e.km) ? e.km : null;
        const litros = typeof e.litros === "number" && e.litros > 0 ? e.litros : null;
        const monto = typeof e.monto === "number" && Number.isFinite(e.monto) ? e.monto : null;
        let diasDesdeAnterior: number | null = null;
        if (prevEmitted) {
          const dt = toTime(e) - toTime(prevEmitted);
          diasDesdeAnterior = dt > 0 ? dt / 86400000 : 0;
        }
        const esRep = k === repIdx;
        const multi = group.length > 1;
        const precioPorLitro =
          monto != null && litros != null
            ? monto / litros
            : typeof e.precioPorLitro === "number"
              ? e.precioPorLitro
              : null;
        out.push({
          loadId: e.loadId,
          eco: e.eco,
          fecha: e.fecha,
          km,
          litros,
          monto,
          // El llenado aporta su distancia/km/l a UNA fila (la de más litros). Las demás
          // cargas del grupo (mismo odómetro) → 0 km y km/l "—".
          kmDesdeAnterior: esRep ? fillKmDesde : multi ? 0 : fillKmDesde,
          kmPorLitro: esRep ? fillKmpl : null,
          // Filas no representativas de un llenado partido → "llenado_partido" (su km/l vive en
          // la fila principal); el resto hereda el motivo calculado del llenado.
          motivoSinKmpl: esRep ? motivoFill : multi ? "llenado_partido" : motivoFill,
          // Fiel = ancla Y llenado actual a tanque lleno. Solo aplica a la fila con km/l real.
          cargaParcial: esRep && fillKmpl != null ? !(prevFillLleno && grupoLleno) : undefined,
          esMontacargas: e.esMontacargas,
          // Solo en llenados partidos: la fila representativa carga la SUMA de litros como
          // denominador del km/l (para que el baseline pondere el llenado una sola vez).
          litrosFill: esRep && multi ? litrosGrupo : undefined,
          precioPorLitro,
          diasDesdeAnterior,
        });
        prevEmitted = e;
      }

      if (gKm != null) {
        prevFillKm = gKm;
        prevFillMonta = grupoMonta;
        prevFillLleno = grupoLleno;
      }
      i = j;
    }
  }
  return out;
}

/** Métricas agrupadas por unidad (para historial y comparativos). */
export function groupMetricsByUnit(metrics: readonly FuelMetrics[]): Map<string, FuelMetrics[]> {
  return groupByUnit(metrics);
}

/** Recorrido del ciclo de combustible de una solicitud. */
export type RecorridoInfo = {
  /** km del ciclo (solicitud → siguiente solicitud). null si no medible / sin siguiente. */
  km: number | null;
  /** ¿hubo al menos una carga registrada entre esta solicitud y la siguiente? */
  viaCarga: boolean;
  /**
   * ¿El ciclo está CERRADO? (existe una solicitud posterior). La última solicitud de cada
   * unidad tiene el ciclo abierto/en curso (`false`) → no se cuenta como "sin carga" todavía.
   */
  cerrado: boolean;
};

/**
 * Recorrido por CICLO de combustible, por solicitud. Por unidad ordena TODOS los eventos
 * (solicitudes + cargas) cronológicamente; para cada SOLICITUD mide los km hasta la SIGUIENTE
 * solicitud (ciclo completo) y marca si hubo una carga de por medio (`viaCarga`). Se eligió el
 * ciclo solicitud→solicitud porque la mayoría de solicitudes no tienen carga registrada.
 * Guardas (como en km/l): km faltante / retroceso (<0) / salto > MAX_KM_JUMP / montacargas
 * (horómetro) → km null. Última solicitud sin siguiente → km null. Devuelve Map por loadId.
 */
export function computeRecorridos(
  entries: readonly FuelEntry[],
  cfg: FuelThresholds = DEFAULT_FUEL_THRESHOLDS,
): Map<string, RecorridoInfo> {
  const out = new Map<string, RecorridoInfo>();
  for (const arr of groupByUnit(entries).values()) {
    const sorted = [...arr].sort(cronoCmp);
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i]!;
      if (e.tipo !== "solicitud") continue;
      // Avanza hasta la siguiente solicitud; marca si hubo carga en medio.
      let viaCarga = false;
      let next: FuelEntry | null = null;
      for (let j = i + 1; j < sorted.length; j++) {
        const f = sorted[j]!;
        if (f.tipo === "carga") {
          viaCarga = true;
          continue;
        }
        next = f;
        break;
      }
      let km: number | null = null;
      if (next && !e.esMontacargas && typeof e.km === "number" && typeof next.km === "number") {
        const d = next.km - e.km;
        if (d > 0 && d <= cfg.MAX_KM_JUMP) km = d;
      }
      out.set(e.loadId, { km, viaCarga, cerrado: next !== null });
    }
  }
  return out;
}

function statOf(values: number[]): FuelStat {
  const clean = clampOutliers(values);
  const base = clean.length >= 2 ? clean : values;
  return {
    mean: mean(base),
    sd: stdDev(base),
    n: values.length,
    p25: percentile(base, 25),
    p75: percentile(base, 75),
  };
}

/** Un evento de rendimiento: km recorridos, litros cargados y su km/l. */
type KmEvent = { km: number; litros: number; kmpl: number };

/** Cerca IQR (Tukey k) sobre los km/l; [-∞,∞] si hay <4 (no se puede recortar fiable). */
function iqrBounds(kmpls: readonly number[], k = 1.5): [number, number] {
  if (kmpls.length < 4) return [-Infinity, Infinity];
  const q1 = percentile(kmpls as number[], 25);
  const q3 = percentile(kmpls as number[], 75);
  const iqr = q3 - q1;
  return [q1 - k * iqr, q3 + k * iqr];
}

/**
 * km/l PONDERADO POR VOLUMEN: Σkm/Σlitros sobre los eventos cuyo km/l cae dentro de la cerca
 * IQR. La cerca descarta llenados parciales atípicos y dedazos de litros ANTES de sumar (el
 * ponderado por volumen no recorta solo). NaN si no quedan litros. Esta es la métrica fiel
 * (sin sesgo de tramos cortos, robusta a tanque no lleno) que se muestra/ranquea.
 */
function volWeightedKmpl(events: readonly KmEvent[]): number {
  const [lo, hi] = iqrBounds(events.map((e) => e.kmpl));
  let sumKm = 0;
  let sumLitros = 0;
  for (const e of events) {
    if (e.kmpl < lo || e.kmpl > hi) continue;
    sumKm += e.km;
    sumLitros += e.litros;
  }
  return sumLitros > 0 ? sumKm / sumLitros : NaN;
}

/**
 * Baseline de la flota a partir de las métricas: km/l por unidad, por tipo de unidad
 * (para "vs unidades similares") y media de flota. Usa recorte IQR para robustez.
 */
export function buildFleetBaseline(
  metrics: readonly FuelMetrics[],
  entries: readonly FuelEntry[] = [],
): FleetBaseline {
  const tipoOf = new Map<string, string>();
  for (const e of entries) if (e.tipoUnidad) tipoOf.set(e.eco, e.tipoUnidad);

  // Reúne EVENTOS válidos (km recorrido + litros + km/l) por unidad/tipo/flota. El filtro es
  // el mismo de siempre (km/l finito y >0 ya excluye montacargas/retroceso/salto/litros≤0); el
  // guard extra de km/litros es para TS (cuando hay km/l, ambos existen y son >0).
  const evByUnit = new Map<string, KmEvent[]>();
  const evByTipo = new Map<string, KmEvent[]>();
  const allEv: KmEvent[] = [];
  for (const m of metrics) {
    if (m.kmPorLitro == null || !(m.kmPorLitro > 0) || !Number.isFinite(m.kmPorLitro)) continue;
    // En llenados partidos, el denominador del km/l es la SUMA de litros del llenado
    // (`litrosFill`), no los de una sola transacción → el ponderado cuenta el llenado una vez.
    const litrosKmpl = m.litrosFill ?? m.litros;
    if (m.kmDesdeAnterior == null || litrosKmpl == null || !(litrosKmpl > 0)) continue;
    const ev: KmEvent = { km: m.kmDesdeAnterior, litros: litrosKmpl, kmpl: m.kmPorLitro };
    // Flota (KPI de cabecera): incluye eventos parciales — el ponderado por volumen los
    // sub-pesa y quitarlos daría sesgo de supervivencia (ocultaría la mitad sedienta).
    allEv.push(ev);
    // Por unidad / tipo (ranking y comparativo "vs su tipo"): SOLO eventos fieles (tanque
    // lleno en ambos extremos). Un evento parcial no representa la eficiencia real de la unidad.
    if (m.cargaParcial) continue;
    pushInto(evByUnit, m.eco, ev);
    pushInto(evByTipo, tipoOf.get(m.eco) ?? "(sin tipo)", ev);
  }

  // mean/sd/p25/p75 = distribución de km/l por evento (para anomalías). kmplVol = ponderado.
  const porUnidad = new Map<string, FuelStat>();
  for (const [eco, evs] of evByUnit)
    porUnidad.set(eco, { ...statOf(evs.map((e) => e.kmpl)), kmplVol: volWeightedKmpl(evs) });
  const porTipo = new Map<string, FuelStat>();
  for (const [tipo, evs] of evByTipo)
    porTipo.set(tipo, { ...statOf(evs.map((e) => e.kmpl)), kmplVol: volWeightedKmpl(evs) });

  return {
    porUnidad,
    porTipo,
    tipoDe: tipoOf,
    flotaMean: mean(clampOutliers(allEv.map((e) => e.kmpl))),
    flotaKmplVol: volWeightedKmpl(allEv),
  };
}

/** Precedencia de RiskLevel para agregar el peor. */
const RISK_ORDER: Record<RiskLevel, number> = { Urgente: 3, Revisar: 2, Completar: 1.5, OK: 1 };

/** Devuelve el RiskLevel más severo de una lista de findings (OK si vacía). */
export function worstRisk(findings: readonly { lv: RiskLevel }[]): RiskLevel {
  let worst: RiskLevel = "OK";
  for (const f of findings) if (RISK_ORDER[f.lv] > RISK_ORDER[worst]) worst = f.lv;
  return worst;
}

/**
 * Detecta anomalías de combustible y devuelve hallazgos con identidad estable.
 * Reglas (umbrales configurables vía cfg): caída de rendimiento, consumo inusual,
 * discrepancia de km (odómetro retrocede / salto improbable), cargas demasiado
 * frecuentes, errores de captura, posible fuga/uso indebido sostenido.
 */
export function detectFuelAnomalies(
  metrics: readonly FuelMetrics[],
  baseline: FleetBaseline,
  cfg: FuelThresholds = DEFAULT_FUEL_THRESHOLDS,
): FuelFinding[] {
  const out: FuelFinding[] = [];
  const push = (m: FuelMetrics, rule: string, text: string, lv: RiskLevel) =>
    out.push({
      cat: "Combustible",
      text,
      lv,
      key: `Fuel:${rule}:${m.loadId}`,
      loadId: m.loadId,
      eco: m.eco,
    });

  // litros por unidad para "consumo inusual"
  const litrosByUnit = new Map<string, number[]>();
  for (const m of metrics)
    if (m.litros != null && m.litros > 0) pushInto(litrosByUnit, m.eco, m.litros);
  const litrosStat = new Map<string, FuelStat>();
  for (const [eco, vals] of litrosByUnit) litrosStat.set(eco, statOf(vals));

  // Techo de litros plausible POR TIPO de unidad (derivado de los datos): q3 + 3·IQR. Marca
  // dedazos claros (p.ej. 210 L donde el tanque ronda 60) sin castigar consumos altos normales.
  // Requiere ≥4 cargas del tipo para ser fiable.
  const litrosByTipo = new Map<string, number[]>();
  for (const m of metrics)
    if (m.litros != null && m.litros > 0)
      pushInto(litrosByTipo, baseline.tipoDe.get(m.eco) ?? "(sin tipo)", m.litros);
  const techoLitrosTipo = new Map<string, number>();
  for (const [tipo, vals] of litrosByTipo) {
    if (vals.length < 4) continue;
    const q1 = percentile(vals, 25);
    const q3 = percentile(vals, 75);
    techoLitrosTipo.set(tipo, q3 + 3 * (q3 - q1));
  }

  const byUnit = groupMetricsByUnit(metrics);
  for (const arr of byUnit.values()) {
    // arr ya viene ordenado por computeFuelMetrics (orden de inserción cronológico)
    let prevLeak = false;
    for (const m of arr) {
      // 1. Errores de captura
      if (m.litros == null || m.litros <= 0)
        push(m, "captura-litros", "Litros inválidos o ausentes en la captura", "Completar");
      if (m.monto != null && m.monto <= 0)
        push(m, "captura-monto", "Monto inválido o ausente en la captura", "Completar");
      if (m.km == null) push(m, "captura-km", "Kilometraje ausente en la captura", "Completar");
      if (
        !m.esMontacargas &&
        m.precioPorLitro != null &&
        (m.precioPorLitro < cfg.PRICE_MIN || m.precioPorLitro > cfg.PRICE_MAX)
      )
        push(
          m,
          "captura-precio",
          `Precio por litro fuera de rango: $${m.precioPorLitro.toFixed(2)}/l`,
          "Completar",
        );

      // 2. Discrepancia de km vs histórico
      if (m.kmDesdeAnterior != null && m.kmDesdeAnterior < 0)
        push(
          m,
          "km-retrocede",
          `El odómetro retrocede ${Math.abs(m.kmDesdeAnterior).toLocaleString("es-MX")} km respecto a la carga anterior`,
          "Urgente",
        );
      else if (m.kmDesdeAnterior != null && m.kmDesdeAnterior > cfg.MAX_KM_JUMP)
        push(
          m,
          "km-salto",
          `Salto de odómetro improbable: ${m.kmDesdeAnterior.toLocaleString("es-MX")} km entre cargas`,
          "Revisar",
        );

      // 3. Cargas demasiado frecuentes
      if (m.diasDesdeAnterior != null && m.diasDesdeAnterior < cfg.MIN_DAYS)
        push(
          m,
          "frecuencia",
          `Carga muy cercana a la anterior (${m.diasDesdeAnterior.toFixed(1)} días)`,
          "Revisar",
        );

      // 4. Caída de rendimiento (requiere baseline confiable de la unidad). Solo eventos FIELES:
      // un km/l bajo por carga parcial es artefacto de medición, no una caída real.
      const stat = baseline.porUnidad.get(m.eco);
      if (
        m.kmPorLitro != null &&
        !m.cargaParcial &&
        stat &&
        stat.n >= cfg.MIN_BASELINE_N &&
        stat.mean > 0
      ) {
        const umbralSd = stat.mean - cfg.DROP_SD * stat.sd;
        const umbralPct = stat.mean * cfg.DROP_PCT;
        if (m.kmPorLitro < umbralSd && m.kmPorLitro < umbralPct)
          push(
            m,
            "rendimiento",
            `Rendimiento bajo: ${m.kmPorLitro.toFixed(2)} km/l vs histórico ${stat.mean.toFixed(2)} km/l`,
            "Revisar",
          );
      }

      // 5. Consumo inusual de litros
      const ls = litrosStat.get(m.eco);
      if (m.litros != null && ls && ls.n >= cfg.MIN_BASELINE_N && ls.sd > 0) {
        if (m.litros > ls.mean + cfg.LITERS_SD * ls.sd)
          push(
            m,
            "consumo",
            `Consumo inusual: ${m.litros.toFixed(1)} L vs habitual ${ls.mean.toFixed(1)} L`,
            "Revisar",
          );
      }

      // 7. Litros implausibles (posible dedazo de captura): supera el techo derivado de su tipo.
      const techoL = techoLitrosTipo.get(baseline.tipoDe.get(m.eco) ?? "(sin tipo)");
      if (m.litros != null && techoL != null && m.litros > techoL)
        push(
          m,
          "litros-implausibles",
          `Litros implausibles: ${m.litros.toFixed(1)} L — posible error de captura (máx. usual de su tipo ≈ ${Math.round(techoL)} L)`,
          "Revisar",
        );

      // 6. Posible fuga / uso indebido (km/l muy bajo vs flota, sostenido 2+ cargas)
      const leakNow =
        m.kmPorLitro != null &&
        !m.cargaParcial &&
        baseline.flotaMean > 0 &&
        m.kmPorLitro < baseline.flotaMean * cfg.LEAK_PCT;
      if (leakNow && prevLeak)
        push(
          m,
          "fuga",
          `Posible fuga/uso indebido: km/l muy por debajo de la flota en cargas consecutivas`,
          "Urgente",
        );
      prevLeak = !!leakNow;
    }
  }
  return out;
}
