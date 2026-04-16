import type { RiskLevel } from "../types";

const norm = (v: unknown): string =>
  String(v || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const FLUID_URG = [
  "vacio",
  "sin aceite",
  "sin refrigerante",
  "sin agua",
  "sin fluido",
  "fuga",
  "peligro",
  "agotado",
  "quemado",
  "no tiene aceite",
  "no tiene fluido",
  "perdida de aceite",
  "sin oil",
];

const FLUID_OK = [
  "ok",
  "correcto",
  "correcta",
  "normal",
  "bien",
  "bueno",
  "buena",
  "optimo",
  "optima",
  "nivel optimo",
  "nivel optima",
  "maximo",
  "al tope",
  "lleno",
  "llena",
  "completo",
  "completa",
  "suficiente",
  "adecuado",
  "adecuada",
  "a nivel",
  "al nivel",
  "en nivel",
  "dentro de",
  "no presenta",
  "sin fuga",
  "sin novedad",
  "funciona",
  "operativo",
  "operativa",
  "limpio",
  "limpia",
  "verde",
  "no hay fuga",
  "estable",
  "perfecto",
  "perfecta",
];

export function normFluidRisk(val: unknown): RiskLevel {
  const v = norm(val);
  if (!v) return "OK";
  if (FLUID_URG.some((kw) => v.includes(kw))) return "Urgente";
  if (FLUID_OK.some((kw) => v === kw || v.includes(kw))) return "OK";
  if (v === "si") return "OK";
  return "Revisar";
}

const BODY_OK_EXACT = ["no", "ninguno", "ninguna", "n/a", "na", "ningun"];
const BODY_OK_KW = [
  "sin golpe",
  "sin raspadura",
  "sin dano",
  "sin danos",
  "no presenta",
  "no hay dano",
  "limpia",
  "perfecta",
  "impecable",
  "buen estado",
  "excelente estado",
  "no aplica",
  "ningun dano",
  "ningun golpe",
  "sin novedad",
];
const BODY_URG = [
  "inoperable",
  "dano estructural",
  "no puede circular",
  "no puede operar",
  "no apto para circular",
  "no apta para circular",
  "inhabilitado",
  "inhabilitada",
  "perdida total",
  "volcadura",
  "volcado",
  "choque grave",
  "accidente grave",
  "fuera de servicio",
  "no opera",
  "dano mayor en chasis",
];

export function normBodyRisk(val: unknown): RiskLevel {
  const v = norm(val);
  if (!v) return "OK";
  if (BODY_OK_EXACT.includes(v)) return "OK";
  if (BODY_OK_KW.some((kw) => v.includes(kw))) return "OK";
  if (BODY_URG.some((kw) => v.includes(kw))) return "Urgente";
  return "Revisar";
}

const TIRE_OK = [
  "si",
  "funcional",
  "ok",
  "bueno",
  "buena",
  "tiene",
  "correcto",
  "correcta",
  "completa",
  "completo",
  "bien",
  "operativa",
  "operativo",
  "disponible",
  "infla",
  "buen estado",
  "lista",
];

export function normTireRisk(val: unknown): RiskLevel {
  const v = norm(val);
  if (!v) return "OK";
  if (
    v === "no" ||
    v.startsWith("no ") ||
    v.includes("sin refacc") ||
    v.includes("sin llanta") ||
    v.includes("falta") ||
    v.includes("ponchad") ||
    v.includes("danad") ||
    v.includes("danada") ||
    v.includes("no funcional") ||
    v.includes("mala") ||
    v.includes("no hay")
  )
    return "Revisar";
  if (TIRE_OK.some((kw) => v === kw || v.includes(kw))) return "OK";
  return "Revisar";
}

/**
 * Estatus semanal global de una unidad.
 *
 * Solo `aceite` y `radiador` escalan el estatus — son los vitales del motor.
 * `carroceria` y `llanta` se mantienen en la firma para compatibilidad con el
 * legado (permite llamadas `calcEstatusSemanal(a, r, c, l)` sin refactor), pero
 * se ignoran intencionalmente. Si un día cambia la regla de negocio, escalarlos
 * aquí sin romper callers.
 */
export function calcEstatusSemanal(
  aceiteRisk: RiskLevel | undefined,
  radiadorRisk: RiskLevel | undefined,
  _carroceriaRisk?: RiskLevel,
  _llantaRisk?: RiskLevel,
): RiskLevel {
  void _carroceriaRisk;
  void _llantaRisk;
  if (aceiteRisk === "Urgente" || radiadorRisk === "Urgente") return "Urgente";
  if (aceiteRisk === "Revisar" || radiadorRisk === "Revisar") return "Revisar";
  return "OK";
}
