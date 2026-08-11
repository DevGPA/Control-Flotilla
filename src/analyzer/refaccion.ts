/**
 * Reglas de negocio de la LLANTA DE REFACCIÓN — decisión Navares 2026-08-11.
 *
 * La refacción NO toca el piso, así que no es una falla operativa como una llanta de
 * rodaje. De ahí las dos reglas:
 *  1. **Tope Revisar:** su desgaste nunca escala la unidad a Urgente. Antes una
 *     refacción a 2mm marcaba Urgente mientras que NO traer refacción marcaba
 *     Completar — la severidad estaba invertida (no traerla es peor que traerla lisa).
 *  2. **Fuera del TACO mínimo:** el mínimo que se ve en la columna Llantas, en el
 *     recuadro del detalle y en el PDF refleja solo llantas EN CIRCULACIÓN. Antes una
 *     unidad con las 4 de rodaje en 8mm y la refacción en 3mm se veía "Reemplazo
 *     urgente" estando perfecta en la calle, e inflaba el conteo de urgentes.
 *
 * `normalizaRefaccion` se aplica en el camino de LECTURA (cloudHydrate) además del de
 * escritura (analyzeRow), para que los meses ya capturados en DynamoDB se vean con la
 * regla nueva sin necesidad de backfill. Es idempotente: si algún día se backfillea,
 * aplicarla otra vez no cambia nada.
 */
import type { Finding, RiskLevel, TireReadings } from "../types";
import { RO } from "./constants";

/** Nombre canónico de la posición "refacción" en TC / `unit.T`. */
export const REFACCION = "Refacción";

/** Identidad estable (Fase C1) del hallazgo de desgaste de la refacción. */
const KEY_TACO_REFACCION = `Llanta:${REFACCION}`;

/** Identidad estable (Fase C1) del hallazgo "la unidad no trae refacción". */
const KEY_SIN_REFACCION = "Chk:Refaccion";

/**
 * TACO mínimo de las llantas EN CIRCULACIÓN — excluye la refacción.
 * `null` si no hay ninguna lectura de rodaje (unidad sin medir, o solo refacción medida).
 */
export function minTRodaje(T: TireReadings | undefined): number | null {
  let min: number | null = null;
  for (const [posicion, mm] of Object.entries(T ?? {})) {
    if (posicion === REFACCION) continue;
    if (!Number.isFinite(mm)) continue;
    if (min === null || mm < min) min = mm;
  }
  return min;
}

/** ¿Este hallazgo es el de "no trae refacción"? */
function esSinRefaccion(f: Finding): boolean {
  if (f.key === KEY_SIN_REFACCION) return true;
  // Registros pre-Fase C1 (sin f.key): el texto es la única identidad disponible.
  // El prefijo va sin tilde para cubrir "Sin llanta de refacción" (monolito) y
  // "Sin llanta de refacción funcional" (motor TS).
  return !f.key && /^sin llanta de refacc/i.test(f.text);
}

/** ¿Este hallazgo es el de desgaste DE LA REFACCIÓN (no de una llanta de rodaje)? */
function esTacoRefaccion(f: Finding): boolean {
  if (f.key === KEY_TACO_REFACCION) return true;
  return !f.key && f.cat === "Llantas" && f.text.startsWith(`${REFACCION}:`);
}

/**
 * Riesgo global desde los hallazgos. Fiel a `analyzeRow`, donde cada `bump()` va
 * siempre acompañado de un `F.push()` — el máximo de la lista ES el riesgo.
 */
export function maxDeHallazgos(F: readonly Finding[]): RiskLevel {
  let max: RiskLevel = "OK";
  for (const f of F) {
    if ((RO[f.lv] || 0) > (RO[max] || 0)) max = f.lv;
  }
  return max;
}

export interface RefaccionInput {
  findings: Finding[];
  risk: RiskLevel;
  /** Lecturas por posición. `{}` en registros viejos que no las guardaron. */
  tires: TireReadings;
  /** minT tal como quedó guardado (se conserva si el registro no trae `tires`). */
  minT: number | null;
}

export interface RefaccionNormalizada {
  findings: Finding[];
  risk: RiskLevel;
  minT: number | null;
  hasRefaccion: boolean;
}

/**
 * Aplica las dos reglas a un registro (nuevo o ya guardado) y deriva `hasRefaccion`.
 * Si no hay nada que corregir devuelve el MISMO array de findings y el riesgo tal cual
 * — así ningún otro flujo cambia de comportamiento por pasar por aquí.
 */
export function normalizaRefaccion(input: RefaccionInput): RefaccionNormalizada {
  const { findings, risk, tires, minT } = input;

  const hayQueBajar = findings.some((f) => esTacoRefaccion(f) && f.lv === "Urgente");
  const corregidos = hayQueBajar
    ? findings.map((f) =>
        esTacoRefaccion(f) && f.lv === "Urgente" ? { ...f, lv: "Revisar" as RiskLevel } : f,
      )
    : findings;

  // Los registros viejos que no guardaron lecturas por posición conservan su minT:
  // sin `tires` no hay forma de saber cuál de las llantas dio ese mínimo.
  const tieneLecturas = Object.keys(tires).length > 0;

  return {
    findings: corregidos,
    risk: hayQueBajar ? maxDeHallazgos(corregidos) : risk,
    minT: tieneLecturas ? minTRodaje(tires) : minT,
    hasRefaccion: !findings.some(esSinRefaccion),
  };
}
