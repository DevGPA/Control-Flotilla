/**
 * Motor PURO de rendimiento y anomalías de combustible. Sin DOM ni red.
 *
 * km/l por VENTANA entre tanques llenos: entre un lleno en km A y el siguiente lleno
 * en km B, TODOS los litros cargados en medio (parciales incluidos) son exactamente el
 * consumo de la distancia B−A (conservación de combustible). Así las cargas parciales
 * —47% de la flota— dejan de perder el rendimiento: suman su combustible a la ventana
 * y la lectura aparece en la carga que vuelve a llenar el tanque. El intervalo por
 * SEGMENTO (carga→carga) se conserva solo para las alertas de odómetro
 * (retroceso/salto) vía `kmDesdeAnterior`.
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
  LEAK_DROP: 0.7,
  LEAK_FLOOR: 4,
  LEAK_MIN_N: 4,
  MIN_BASELINE_N: 3,
  // Carga al tope del tanque (auditoría): litros > 95% de la capacidad nominal ⇒ la unidad
  // llegó casi vacía (contra política de recarga) o hay cargas segregadas/desvío.
  TANK_FILL_PCT: 0.95,
  // Parciales crónicos: ≥60% de las últimas 8 cargas sin tanque lleno (con mínimo 6 para
  // juzgar) ⇒ la unidad no puede medir su rendimiento — corregir el hábito en campo.
  PARTIAL_WINDOW_N: 8,
  PARTIAL_MIN_N: 6,
  PARTIAL_PCT: 0.6,
};

/**
 * Inferencia de tanque LLENO para el motor de ventanas: si el chofer marcó "No" pero los
 * litros del llenado son ≥ TANK_FILL_PCT (95%) de la capacidad del tanque, físicamente fue
 * un llenado (caso real: cargas de ~49 L marcadas "No" en tanque de 58 L). Corrige el campo
 * mal marcado y recupera ventanas medibles; la UI lo señala como "lleno inferido".
 * Decisión de Navares 2026-07-13; apagar aquí si el criterio cambia.
 */
export const VENTANA_INFIERE_LLENO = true;

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
  odometro_no_fiable:
    "Odómetro no fiable: la unidad captura el kilometraje crónicamente roto (placeholder o congelado) — su km/l no es confiable.",
  parcial_en_ventana:
    "Carga parcial: sus litros se acumulan a la ventana entre tanques llenos — el rendimiento aparecerá en la siguiente carga a tanque lleno.",
  sin_lleno_previo:
    "Sin tanque lleno anterior fiable: no hay ventana abierta que medir. Abre una nueva ventana si esta carga llenó el tanque.",
  ventana_rota:
    "La ventana entre llenos se invalidó (salto de odómetro o carga sin litros en medio) — revisa la carga intermedia señalada; esta carga abre una ventana nueva.",
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
  odometro_no_fiable: "Odómetro no fiable",
  parcial_en_ventana: "Suma a ventana",
  sin_lleno_previo: "Sin lleno previo",
  ventana_rota: "Ventana reiniciada",
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
  odometro_no_fiable: true,
  // Ventanas: estructurales (el dato está bien; el rendimiento vive en el cierre de la
  // ventana). ventana_rota tampoco es accionable: la carga intermedia culpable ya carga
  // su propio motivo/alerta accionable — contarla aquí doble-contaría en el KPI.
  parcial_en_ventana: false,
  sin_lleno_previo: false,
  ventana_rota: false,
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
/**
 * Odómetro EFECTIVO de una carga: el corregido en la validación con la foto
 * (`review.kmDetectado`, caso eco 86 2026-07-13: capturaron 1,682 en vez de ~16,8xx)
 * o, si no hay corrección, el capturado por el chofer. El dato crudo NUNCA se toca
 * (overlay auditable, mismo principio que la anulación); la tabla sigue mostrando
 * `FuelEntry.km` y el drawer ambos valores.
 */
function kmEfectivo(e: Pick<FuelEntry, "km" | "review">): number | null {
  const det = e.review?.kmDetectado;
  if (typeof det === "number" && Number.isFinite(det) && det > 0) return det;
  return typeof e.km === "number" && Number.isFinite(e.km) ? e.km : null;
}

export function computeFuelMetrics(entries: readonly FuelEntry[]): FuelMetrics[] {
  const cargas = entries.filter((e) => e.tipo === "carga");
  const byUnit = groupByUnit(cargas);

  // PASO 2A — Odómetro no fiable a nivel UNIDAD (placeholder km<=1 o congelado). NO recupera;
  // solo marca para excluir su km/l y avisar "revisar captura". Excluye montacargas (horómetro
  // legítimo, ya sin km/l) ANTES de la regla. El clamp de deltas a (0,MAX_KM_JUMP] es load-bearing:
  // sin él, los typos gigantes de odómetro marcarían unidades sanas.
  const ecosOdometroNoFiable = new Set<string>();
  for (const [eco, arr] of byUnit) {
    if (arr.some((c) => c.esMontacargas)) continue;
    const sorted = [...arr].sort(cronoCmp);
    const kms: number[] = [];
    for (const c of sorted) {
      const km = kmEfectivo(c);
      if (km == null) continue;
      if (kms.length && kms[kms.length - 1] === km) continue; // mismo odómetro = llenado partido
      kms.push(km);
    }
    if (kms.length < 5) continue; // muestra mínima para juzgar a la unidad
    const fracLE1 = kms.filter((k) => k <= 1).length / kms.length;
    const deltas: number[] = [];
    for (let k = 1; k < kms.length; k++) {
      const d = kms[k]! - kms[k - 1]!;
      if (d > 0 && d <= DEFAULT_FUEL_THRESHOLDS.MAX_KM_JUMP) deltas.push(d);
    }
    const medDelta = deltas.length ? percentile(deltas, 50) : Infinity;
    if (fracLE1 >= 0.5 || medDelta < 40) ecosOdometroNoFiable.add(eco);
  }

  const out: FuelMetrics[] = [];
  for (const arr of byUnit.values()) {
    const sorted = [...arr].sort(cronoCmp);
    // Ancla de distancia = el ÚLTIMO llenado con odómetro FIABLE (un retroceso no
    // ancla; queda pendiente por si fue un reset real de tablero).
    let prevFillKm: number | null = null;
    let prevFillMonta = false;
    let pendingResetKm: number | null = null;
    let pendingResetLlenoEf = false;
    let pendingResetInferido = false;
    // ── Ventana entre LLENOS ── abre en un lleno-efectivo con odómetro adoptado,
    // acumula litros de los grupos siguientes y cierra en el próximo lleno-efectivo.
    let winStartKm: number | null = null;
    let winLitros = 0;
    let winCargas = 0;
    let winRota = false; // salto adoptado / carga sin litros invalidó la conservación
    let winInferida = false; // la apertura fue un lleno INFERIDO
    let prevEmitted: FuelEntry | null = null;
    let i = 0;
    while (i < sorted.length) {
      // LLENADO PARTIDO: cargas CONSECUTIVAS con el MISMO odómetro son un solo llenado
      // dividido en varias transacciones (mismo km ⇒ no se condujo entre ellas). Se agrupan
      // para que el km/l use la SUMA de litros del llenado (y no la distancia ÷ una sola
      // transacción chica, que dispara un km/l absurdo). Sin km → grupo de 1.
      const head = sorted[i]!;
      const gKm = kmEfectivo(head);
      let j = i + 1;
      if (gKm != null) {
        while (j < sorted.length && kmEfectivo(sorted[j]!) === gKm) j++;
      }
      const group = sorted.slice(i, j);

      // Litros del llenado (denominador del km/l) y estado montacargas (consistente por unidad).
      let litrosGrupo = 0;
      for (const g of group)
        if (typeof g.litros === "number" && g.litros > 0) litrosGrupo += g.litros;
      const grupoMonta = group.some((g) => g.esMontacargas);
      // ¿El llenado fue a tanque lleno? (alguna transacción del grupo con seLlenoTanque='Si').
      const grupoLleno = group.some((g) => g.seLlenoTanque === "Si");
      // Lleno INFERIDO: el chofer marcó "No" pero cargó ≥95% del tanque — físicamente
      // fue un llenado (campo mal marcado). Recupera ventanas medibles; la UI lo señala.
      const tanqueGrupoNum = parseFloat(String(head.tanque ?? ""));
      const tanqueCapGrupo =
        Number.isFinite(tanqueGrupoNum) && tanqueGrupoNum > 0 ? tanqueGrupoNum : undefined;
      const llenoInferido =
        !grupoLleno &&
        VENTANA_INFIERE_LLENO &&
        !grupoMonta &&
        tanqueCapGrupo != null &&
        litrosGrupo >= DEFAULT_FUEL_THRESHOLDS.TANK_FILL_PCT * tanqueCapGrupo;
      const llenoEf = grupoLleno || llenoInferido;
      const primeraDeUnidad = prevFillKm == null;

      // Distancia del SEGMENTO (carga→carga) — alimenta las alertas de odómetro
      // (retroceso/salto) vía kmDesdeAnterior. El km/l ya NO se mide aquí: lo mide la
      // ventana entre llenos (abajo). Montacargas: horómetro → nada de esto aplica.
      let fillKmDesde: number | null = null;
      let desdePendiente = false;
      if (prevFillKm != null && gKm != null && !grupoMonta && !prevFillMonta) {
        fillKmDesde = gKm - prevFillKm;
        // Reset REAL de tablero: retrocede vs la ancla pero es coherente con la
        // lectura rechazada anterior (pendiente) → se mide contra ella y el tren
        // nuevo se adopta como ancla. Un typo aislado NO cumple esto (su siguiente
        // lectura vuelve a ser plausible vs la ancla fiable).
        if (
          fillKmDesde <= 0 &&
          pendingResetKm != null &&
          gKm - pendingResetKm > 0 &&
          gKm - pendingResetKm <= DEFAULT_FUEL_THRESHOLDS.MAX_KM_JUMP
        ) {
          fillKmDesde = gKm - pendingResetKm;
          desdePendiente = true;
        }
      }
      // Retroceso NO adoptado (typo probable): su odómetro no ancla ni cierra ventana.
      const retrocesoSinAdoptar =
        prevFillKm != null &&
        gKm != null &&
        !desdePendiente &&
        !grupoMonta &&
        !prevFillMonta &&
        gKm - prevFillKm <= 0;

      // ── VENTANA entre llenos: acumulación, cierre y reapertura ──
      let kmplVentana: number | null = null;
      let kmplImplausible = false;
      let ventanaLitrosOut: number | undefined;
      let ventanaKmDesdeOut: number | undefined;
      let ventanaDesdeKmOut: number | undefined;
      let ventanaCargasOut: number | undefined;
      let ventanaInferidaOut: boolean | undefined;
      let motivoVentana: MotivoSinKmpl | undefined;
      if (!grupoMonta && !prevFillMonta) {
        // Reset real ADOPTADO: la ventana del tren viejo muere; si la lectura pendiente
        // era un lleno, la ventana reabre ahí (el tren nuevo se mide desde la pendiente).
        if (desdePendiente) {
          winStartKm = pendingResetLlenoEf ? pendingResetKm : null;
          winInferida = pendingResetLlenoEf ? pendingResetInferido : false;
          winLitros = 0;
          winCargas = 0;
          winRota = false;
        }
        // Conservación de combustible: TODO litro cargado entre los dos llenos se
        // consumió en esa distancia — aunque el odómetro intermedio traiga typo
        // (retroceso no adoptado) o falte. Sin litros → conservación rota.
        if (winStartKm != null) {
          if (litrosGrupo > 0) {
            winLitros += litrosGrupo;
            winCargas++;
          } else {
            winRota = true;
          }
          // Salto ADOPTADO = cargas no registradas en medio → litros faltantes.
          if (
            !retrocesoSinAdoptar &&
            fillKmDesde != null &&
            fillKmDesde > DEFAULT_FUEL_THRESHOLDS.MAX_KM_JUMP
          )
            winRota = true;
        }
        // Cierre: lleno efectivo con odómetro adoptable.
        if (llenoEf && gKm != null && !retrocesoSinAdoptar) {
          if (winStartKm != null && !winRota) {
            const delta = gKm - winStartKm;
            if (delta > 0 && winLitros > 0) {
              const kmpl = delta / winLitros;
              // Piso físico: fuera de [MIN,MAX] es dato no verídico — no se emite.
              if (kmpl < KMPL_FISICO_MIN || kmpl > KMPL_FISICO_MAX) kmplImplausible = true;
              else {
                kmplVentana = kmpl;
                ventanaLitrosOut = winLitros;
                ventanaKmDesdeOut = delta;
                ventanaDesdeKmOut = winStartKm;
                ventanaCargasOut = winCargas;
                ventanaInferidaOut = winInferida || llenoInferido || undefined;
              }
            } else motivoVentana = "ventana_rota";
          } else if (winStartKm != null) motivoVentana = "ventana_rota";
          else motivoVentana = "sin_lleno_previo";
          // Reabrir SIEMPRE en este lleno (aunque el cierre fallara): es ancla llena válida.
          winStartKm = gKm;
          winLitros = 0;
          winCargas = 0;
          winRota = false;
          winInferida = llenoInferido;
        } else if (!llenoEf) {
          motivoVentana = winStartKm != null && !winRota ? "parcial_en_ventana" : "sin_lleno_previo";
        }
      }

      // Motivo del km/l ausente (para explicar el "—"); undefined si sí hay km/l de ventana.
      // Los motivos DUROS (captura mala) ganan sobre los estructurales de ventana.
      let motivoFill: MotivoSinKmpl | undefined;
      if (kmplVentana == null) {
        if (kmplImplausible) motivoFill = "kmpl_implausible";
        else if (grupoMonta || prevFillMonta) motivoFill = "montacargas";
        else if (gKm == null) motivoFill = "sin_odometro";
        else if (primeraDeUnidad) motivoFill = "primera_carga";
        else if (litrosGrupo <= 0) motivoFill = "sin_litros";
        else if (fillKmDesde != null && fillKmDesde <= 0) motivoFill = "odometro_retroceso";
        else if (fillKmDesde != null && fillKmDesde > DEFAULT_FUEL_THRESHOLDS.MAX_KM_JUMP)
          motivoFill = "salto_improbable";
        else motivoFill = motivoVentana;
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
        const tanqueNum = parseFloat(String(e.tanque ?? ""));
        const tanqueCap = Number.isFinite(tanqueNum) && tanqueNum > 0 ? tanqueNum : undefined;
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
          kmPorLitro: esRep ? kmplVentana : null,
          // Filas no representativas de un llenado partido → "llenado_partido" (su km/l vive en
          // la fila principal); el resto hereda el motivo calculado del llenado.
          motivoSinKmpl: esRep ? motivoFill : multi ? "llenado_partido" : motivoFill,
          esMontacargas: e.esMontacargas,
          // Denominador del km/l de VENTANA (Σ litros de todas sus cargas) en la fila que
          // cierra; en llenados partidos sin cierre conserva la suma del grupo (informativa).
          litrosFill: esRep
            ? (ventanaLitrosOut ?? (multi ? litrosGrupo : undefined))
            : undefined,
          ventanaKmDesde: esRep ? ventanaKmDesdeOut : undefined,
          ventanaDesdeKm: esRep ? ventanaDesdeKmOut : undefined,
          ventanaCargas: esRep ? ventanaCargasOut : undefined,
          ventanaInferida: esRep ? ventanaInferidaOut : undefined,
          llenoEfectivo: esRep && !grupoMonta ? llenoEf : undefined,
          precioPorLitro,
          diasDesdeAnterior,
          tanqueCap,
        });
        prevEmitted = e;
      }

      if (gKm != null) {
        // Ancla RESISTENTE: un odómetro que retrocede no se promueve a ancla (un
        // typo contaminaría también la SIGUIENTE carga con "salto improbable").
        // Queda pendiente: si la próxima lectura es coherente con él, era un reset
        // real y se adopta (arriba); si vuelve a medir bien vs la ancla, se limpia.
        if (retrocesoSinAdoptar) {
          pendingResetKm = gKm;
          pendingResetLlenoEf = llenoEf;
          pendingResetInferido = llenoInferido;
        } else {
          prevFillKm = gKm;
          prevFillMonta = grupoMonta;
          pendingResetKm = null;
        }
      }
      i = j;
    }
  }

  // PASO 2A — aplica la marca de odómetro no fiable: anula el km/l de esas unidades (así sale
  // de baseline/ranking/alertas automáticamente) y expone el motivo. No toca montacargas.
  if (ecosOdometroNoFiable.size) {
    for (const m of out) {
      if (ecosOdometroNoFiable.has(m.eco) && !m.esMontacargas) {
        m.kmPorLitro = null;
        m.motivoSinKmpl = "odometro_no_fiable";
        m.odometroNoFiable = true;
        m.ventanaKmDesde = undefined;
        m.ventanaDesdeKm = undefined;
        m.ventanaCargas = undefined;
        m.ventanaInferida = undefined;
      }
    }
  }
  return out;
}

/** Métricas agrupadas por unidad (para historial y comparativos). */
export function groupMetricsByUnit(metrics: readonly FuelMetrics[]): Map<string, FuelMetrics[]> {
  return groupByUnit(metrics);
}

/** km/L "de vida" de una unidad: referencia robusta sobre TODO su histórico. */
export type KmplVida = {
  kmpl: number;
  km: number; // Σ km de segmentos fiables
  litros: number; // Σ litros de las cargas de esos segmentos
  n: number; // cargas que aportaron
};

/**
 * km/L de VIDA por unidad = Σ km de segmentos fiables / Σ litros de sus cargas — la
 * referencia más robusta cuando la unidad casi nunca llena el tanque (sin ventanas
 * medibles). Ignora el estado de llenado por completo; error acotado ~±1 tanque sobre
 * el histórico. Usa la misma ancla resistente del motor (typos no cuentan; un reset de
 * tablero se adopta con la segunda lectura coherente). Guards: no montacargas, ≥5
 * cargas aportando y ≥500 km (evita referencias de muestra chica).
 */
export function computeKmplVida(entries: readonly FuelEntry[]): Map<string, KmplVida> {
  const cargas = entries.filter((e) => e.tipo === "carga" && !e.esMontacargas);
  const byUnit = groupByUnit(cargas);
  const out = new Map<string, KmplVida>();
  for (const [eco, arr] of byUnit) {
    const sorted = [...arr].sort(cronoCmp);
    let prevKm: number | null = null;
    let pendiente: number | null = null;
    let km = 0;
    let litros = 0;
    let n = 0;
    for (const c of sorted) {
      const k = kmEfectivo(c);
      const l = typeof c.litros === "number" && c.litros > 0 ? c.litros : null;
      if (k == null) continue;
      if (prevKm == null) {
        prevKm = k;
        continue;
      }
      let delta = k - prevKm;
      if (delta <= 0) {
        // Retroceso: typo (se ignora) o reset de tablero (lo adopta la siguiente coherente).
        if (pendiente != null && k - pendiente > 0 && k - pendiente <= DEFAULT_FUEL_THRESHOLDS.MAX_KM_JUMP) {
          delta = k - pendiente;
        } else {
          pendiente = k;
          continue;
        }
      }
      pendiente = null;
      if (delta > DEFAULT_FUEL_THRESHOLDS.MAX_KM_JUMP) {
        prevKm = k; // salto: el tramo no cuenta, pero la lectura alta es creíble
        continue;
      }
      prevKm = k;
      if (l != null) {
        km += delta;
        litros += l;
        n++;
      }
    }
    if (n >= 5 && km >= 500 && litros > 0) {
      const kmpl = km / litros;
      if (kmpl >= KMPL_FISICO_MIN && kmpl <= KMPL_FISICO_MAX)
        out.set(eco, { kmpl, km, litros, n });
    }
  }
  return out;
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
    median: percentile(base, 50),
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
    // La distancia del evento es la de la VENTANA entre llenos (numerador real del km/l);
    // kmDesdeAnterior (segmento) queda de fallback para métricas legadas.
    const kmEvento = m.ventanaKmDesde ?? m.kmDesdeAnterior;
    if (kmEvento == null || litrosKmpl == null || !(litrosKmpl > 0)) continue;
    const ev: KmEvent = { km: kmEvento, litros: litrosKmpl, kmpl: m.kmPorLitro };
    // Flota (KPI de cabecera): todos los cierres de ventana ponderan (los litros de las
    // cargas parciales ya viven en el denominador de su ventana — nada se descarta).
    allEv.push(ev);
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

/** Regla de un finding a partir de su key "Fuel:<regla>:<loadId>". */
export function ruleOfFinding(f: Pick<FuelFinding, "key">): string {
  return f.key.split(":")[1] ?? "";
}

/** Agrupa findings por loadId (chips por fila de la tabla y filtro por alerta). */
export function groupFindingsByLoad(findings: readonly FuelFinding[]): Map<string, FuelFinding[]> {
  const m = new Map<string, FuelFinding[]>();
  for (const f of findings) if (f.loadId) pushInto(m, f.loadId, f);
  return m;
}

/** Etiqueta corta por regla de anomalía (chips de la tabla y opciones del filtro). */
export const FUEL_RULE_LABEL: Record<string, string> = {
  frecuencia: "2ª carga en el día",
  "tanque-95": "≥95% del tanque",
  "km-retrocede": "Odómetro retrocede",
  "km-salto": "Salto de odómetro",
  rendimiento: "Rendimiento bajo",
  consumo: "Consumo inusual",
  "litros-implausibles": "Litros implausibles",
  fuga: "Posible fuga",
  "captura-litros": "Captura: litros",
  "captura-monto": "Captura: monto",
  "captura-km": "Captura: km",
  "captura-precio": "Captura: precio",
  "parciales-cronicos": "Parciales crónicos",
};

/**
 * ¿Los findings de una fila empatan el filtro de alerta? `""` = sin filtro (todo pasa),
 * `"any"` = con alguna alerta, `"captura"` = cualquier error de captura (prefijo),
 * cualquier otro valor = regla exacta.
 */
export function matchesFlag(findings: readonly FuelFinding[] | undefined, flag: string): boolean {
  if (!flag) return true;
  const fs = findings ?? [];
  if (flag === "any") return fs.length > 0;
  if (flag === "captura") return fs.some((f) => ruleOfFinding(f).startsWith("captura"));
  return fs.some((f) => ruleOfFinding(f) === flag);
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

      // 4. Caída de rendimiento (requiere baseline confiable de la unidad). Todo km/l
      // emitido por el motor de ventanas es fiel por construcción (lleno→lleno).
      const stat = baseline.porUnidad.get(m.eco);
      if (
        m.kmPorLitro != null &&
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

      // 8. Carga al tope del tanque (auditoría): litros > TANK_FILL_PCT · capacidad NOMINAL
      // (eco.TANQUE). Complementa la regla 7 (techo estadístico): aquí la señal es que la
      // unidad llegó casi vacía o hay cargas segregadas. Montacargas fuera (tanque Gas LP
      // no comparable). Sin capacidad fiable, la regla simplemente no aplica.
      if (
        !m.esMontacargas &&
        m.litros != null &&
        m.tanqueCap != null &&
        m.litros > cfg.TANK_FILL_PCT * m.tanqueCap
      )
        push(
          m,
          "tanque-95",
          `Carga al ${Math.round((m.litros / m.tanqueCap) * 100)}% del tanque (${m.litros.toFixed(1)} L de ${m.tanqueCap} L) — llegó casi vacío o cargas segregadas`,
          "Revisar",
        );

      // 6. Posible fuga / uso indebido: caída SOSTENIDA vs el HISTÓRICO PROPIO de la unidad
      // (no vs la flota — eso marcaba falsamente a las unidades de baja eficiencia). Solo eventos
      // fieles; exime a las crónicamente ineficientes (mediana propia < LEAK_FLOOR). `stat` ya se
      // leyó en la regla de rendimiento (mismo loop).
      const leakRef = stat ? (stat.median ?? stat.mean) : null;
      const leakNow =
        m.kmPorLitro != null &&
        stat != null &&
        stat.n >= cfg.LEAK_MIN_N &&
        leakRef != null &&
        leakRef >= cfg.LEAK_FLOOR &&
        m.kmPorLitro < leakRef * cfg.LEAK_DROP;
      if (leakNow && prevLeak)
        push(
          m,
          "fuga",
          `Posible fuga/uso indebido: ${m.kmPorLitro!.toFixed(2)} km/l vs su histórico ${leakRef!.toFixed(2)} km/l en cargas consecutivas`,
          "Urgente",
        );
      prevLeak = !!leakNow;
    }

    // 9. Parciales CRÓNICOS (por unidad): si la mayoría de sus cargas recientes no llenan
    // el tanque, la unidad no puede medir su rendimiento — es la palanca para corregir el
    // hábito en campo (causa raíz observada en la unidad 47: 47% de cargas parciales).
    // Anclada a la carga MÁS RECIENTE: el chip vive en la fila nueva y la key se re-ancla
    // sola al llegar la siguiente carga (los findings no se persisten).
    const reps = arr.filter((m) => m.llenoEfectivo !== undefined); // filas representativas no-monta
    const recientes = reps.slice(-cfg.PARTIAL_WINDOW_N);
    if (recientes.length >= cfg.PARTIAL_MIN_N) {
      const parciales = recientes.filter((m) => m.llenoEfectivo !== true).length;
      if (parciales / recientes.length >= cfg.PARTIAL_PCT)
        push(
          recientes[recientes.length - 1]!,
          "parciales-cronicos",
          `Hábito de cargas parciales: ${parciales} de las últimas ${recientes.length} sin tanque lleno — pedir cargar a tanque lleno para poder medir su rendimiento`,
          "Revisar",
        );
    }
  }
  return out;
}
