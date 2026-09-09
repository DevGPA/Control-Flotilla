/**
 * IDENTIDAD DE UNIDAD — la placa VIGENTE.
 *
 * `Unit` se identifica por [tenantId, placa] y `Checklist`/`Semanal`/`CheckDone`/`Taller`
 * por `unitUid` (= la placa). El cruce que arma la app es `unit.placa === registro.unitUid`
 * (src/api/cloudHydrate.ts), así que **dos escrituras de la misma camioneta con placas
 * distintas parten su historial en dos** y la unidad aparece "sin una sola inspección".
 *
 * GPA reemplazó 11 unidades entre 2025 y 2026 y las fuentes de ingesta (el catálogo de
 * MoreApp y el de Operaciones-GPA) **siguen enviando la placa vieja**. La migración única
 * de 2026-08-27 (`scripts/migrar-placas.mjs`) re-archivó el historial bajo la placa vigente,
 * pero no podía durar: cada inspección nueva volvía a crear la unidad bajo la placa retirada
 * (verificado 2026-09-08 — 8 registros nuevos entre el 31-ago y el 2-sep, y 7 de las 11
 * unidades resucitadas en el catálogo con su placa vieja).
 *
 * Este módulo es la única fuente de verdad de esa equivalencia. Se aplica en los DOS extremos:
 *  - **Ingesta** (webhook de MoreApp y puente de Ops-GPA): normaliza antes de escribir, para
 *    que ningún registro nuevo nazca bajo una placa retirada.
 *  - **Lectura** (cloudHydrate): normaliza el cruce, para que un registro que se colara igual
 *    encuentre su unidad.
 *
 * Cuando GPA reemplace otra unidad: agregar el par aquí y correr
 * `scripts/reparar-identidad-placas.mjs` para re-archivar lo que ya entró con la placa vieja.
 */

/**
 * Placa retirada → placa vigente. Verificado contra la tarjeta de circulación de cada
 * unidad; varios comprobantes de refrendo de Jalisco imprimen el campo "PLACA ANT."
 * confirmando la sustitución. El comentario es el número económico de la unidad.
 */
export const PLACAS_SUSTITUIDAS: Readonly<Record<string, string>> = Object.freeze({
  JT98490: "JB4479A", // eco 06
  JLL5377: "JTA885A", // eco 10
  JU30222: "JB3943A", // eco 12
  JV50090: "JB4255A", // eco 21
  JV50092: "JB3941A", // eco 22
  JV50091: "JB4256A", // eco 23
  JV50089: "JB3940A", // eco 24
  SZ8900M: "TA8209R", // eco 47
  PW9237A: "PH8044C", // eco 54
  LE98216: "KR1818A", // eco 55
  JY38151: "KF2558A", // eco 76
});

/**
 * Forma canónica de una placa para COMPARAR: sin espacios, guiones ni minúsculas.
 * MoreApp y Ops-GPA capturan la misma placa como "JB4255A", "jb4255a" o "JB-4255-A"
 * según quién la escriba, y cada variante abría una unidad nueva.
 *
 * No valida el formato: el catálogo incluye montacargas y remolques cuyo "placa" es un
 * número de serie ("G25NXP58", "560XM", "H50FT"), y descartarlos los dejaría sin identidad.
 */
export function normalizaPlaca(valor: unknown): string {
  // Un objeto NO es una placa: MoreApp manda {} cuando el campo va vacio y String() lo
  // volveria "[object Object]", una identidad falsa que abriria una unidad basura.
  if (valor !== null && typeof valor === "object") return "";
  return String(valor ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * La placa VIGENTE de una unidad — la identidad con la que se escribe y se cruza.
 * Idempotente: aplicarla a una placa vigente la devuelve igual.
 */
export function placaVigente(valor: unknown): string {
  const p = normalizaPlaca(valor);
  return PLACAS_SUSTITUIDAS[p] ?? p;
}

/** `true` si la placa dada quedó retirada por un reemplacamiento. */
export function esPlacaRetirada(valor: unknown): boolean {
  return normalizaPlaca(valor) in PLACAS_SUSTITUIDAS;
}
