import type { RiskLevel } from "../types";

export const TC: Record<string, string> = {
  "Piloto Delantera": "Nivel TACO de llanta piloto delantera",
  "Copiloto Delantera": "Nivel TACO de llanta copiloto delantera",
  "Piloto Trasera": "Nivel TACO de llanta piloto trasera",
  "Piloto Trasera Int.": "Nivel TACO de llanta piloto trasera INTERNA",
  "Copiloto Trasera": "Nivel TACO de llanta copiloto trasera",
  "Copiloto Trasera Int.": "Nivel TACO de llanta copiloto trasera INTERNA",
  "Refacción": "Nivel TACO de llanta REFACCION",
};

export const TCRIT = 3.99;
export const TWARN = 6.99;

export const BIN: Record<string, RiskLevel> = {
  "Luces y cuartos delanteros funcionando": "Urgente",
  "Cinturones de seguridad funcionando (todos)": "Urgente",
  "Carroceria con golpes o raspaduras": "Revisar",
  "Espejos laterales en buen estado": "Revisar",
  "Cristales en buenas condiciones": "Revisar",
  "Molduras completas y en buen estado": "Revisar",
  "Tapon de la gasolina": "Revisar",
  "Bocina del claxon funcionando": "Revisar",
  "Limpia parabrisas funcionando correctamente": "Revisar",
  "Tacometro en buenas condiciones": "Revisar",
  "Espejo retrovisor en buenas condiciones": "Revisar",
  "Luces interiores funcionando": "Revisar",
  "Asientos en buen estado": "Revisar",
  "Tapetes completos": "Revisar",
  "Gato adecuado para el vehiculo y su palanca": "Completar",
  "Llave de cruz o palanca acorde a los birlos de las llantas": "Completar",
  "Triangulo de seguridad": "Completar",
  "Cables pasa corriente": "Completar",
  'Licencia de "chofer" acorde a vehiculo vigente': "Completar",
  "Tarjeta de circulacion vigente": "Completar",
  "Poliza de seguro vigente": "Completar",
  "Calcomonia de refrendo vehicular": "Completar",
  "Tarjeta/calcamonia de verificacion ambiental vigente": "Completar",
  "Calcamonia de ultimo servicio (en parabrisas)": "Completar",
};

/**
 * Etiquetas display para items BIN. Excel keys siguen igual (no rompemos import).
 * Si una key no esta aqui, se usa el texto literal del Excel como fallback.
 * Forma de "problema/falla" para evitar ambigüedad de pregunta-positiva.
 */
export const BIN_LABELS: Record<string, string> = {
  "Luces y cuartos delanteros funcionando": "Luces / cuartos delanteros no funcionan",
  "Cinturones de seguridad funcionando (todos)": "Cinturones de seguridad fallando",
  "Carroceria con golpes o raspaduras": "Carrocería con daños / raspaduras",
  "Espejos laterales en buen estado": "Espejos laterales dañados",
  "Cristales en buenas condiciones": "Cristales dañados / estrellados",
  "Molduras completas y en buen estado": "Molduras incompletas o dañadas",
  "Tapon de la gasolina": "Sin tapón de gasolina",
  "Bocina del claxon funcionando": "Claxon no funciona",
  "Limpia parabrisas funcionando correctamente": "Limpia parabrisas no funciona",
  "Tacometro en buenas condiciones": "Tacómetro dañado / sin funcionar",
  "Espejo retrovisor en buenas condiciones": "Espejo retrovisor dañado",
  "Luces interiores funcionando": "Luces interiores no funcionan",
  "Asientos en buen estado": "Asientos dañados",
  "Tapetes completos": "Tapetes faltantes / incompletos",
  "Gato adecuado para el vehiculo y su palanca": "Sin gato / palanca adecuada",
  "Llave de cruz o palanca acorde a los birlos de las llantas": "Sin llave de cruz adecuada",
  "Triangulo de seguridad": "Sin triángulo de seguridad",
  "Cables pasa corriente": "Sin cables pasa corriente",
  'Licencia de "chofer" acorde a vehiculo vigente': "Licencia de chofer faltante o vencida",
  "Tarjeta de circulacion vigente": "Tarjeta de circulación vencida o faltante",
  "Poliza de seguro vigente": "Póliza de seguro vencida o faltante",
  "Calcomonia de refrendo vehicular": "Sin calcomanía de refrendo",
  "Tarjeta/calcamonia de verificacion ambiental vigente": "Verificación ambiental vencida o faltante",
  "Calcamonia de ultimo servicio (en parabrisas)": "Sin calcomanía de último servicio",
};

/**
 * Clasifica si el valor de un campo BIN representa una FALLA (debe disparar finding).
 * Maneja valores no binarios reales del Excel: "Si vigente", "Si vencida", "No aplica",
 * "Sin Raspaduras/Golpes", "Con Raspaduras/Golpes", "No lleva", etc.
 *
 * Reglas:
 *  - vacío / "no aplica" → NO falla (skip)
 *  - "si" / "si vigente" → NO falla
 *  - "no" / "no <algo>" / "vencid*" / "con golpe*" / "con raspad*" → FALLA
 */
export function isBinFail(val: unknown): boolean {
  const s = String(val ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!s) return false;
  if (s === "no aplica" || s === "n/a" || s === "na") return false;
  if (s === "si" || s.startsWith("si vigente") || s === "ok") return false;
  // Negativos explícitos
  if (s === "no" || s.startsWith("no ")) return true;
  if (s.includes("vencid")) return true;
  if (s.startsWith("con ")) return true; // "Con Raspaduras/Golpes"
  if (s.startsWith("sin ")) return false; // "Sin Raspaduras/Golpes" = OK
  return false;
}

export const CATI: Record<string, string> = {
  Llantas: "🛞",
  Checklist: "📋",
  Documentos: "📄",
  Fluidos: "🧪",
};

export const RO: Record<RiskLevel, number> = {
  Urgente: 3,
  Revisar: 2,
  Completar: 1.5,
  OK: 1,
};
