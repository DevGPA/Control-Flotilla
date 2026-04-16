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
