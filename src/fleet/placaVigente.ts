/**
 * IDENTIDAD DE UNIDAD — la placa VIGENTE.
 *
 * `Unit` se identifica por [tenantId, placa] y `Checklist`/`Semanal`/`CheckDone`/`Taller`
 * por `unitUid` (= la placa). El cruce que arma la app es `unit.placa === registro.unitUid`
 * (src/api/cloudHydrate.ts), así que **dos escrituras de la misma camioneta con placas
 * distintas parten su historial en dos** y la unidad aparece "sin una sola inspección".
 *
 * GPA reemplazó 11 unidades entre 2025 y 2026 y la fuente de ingesta (el catálogo de
 * Operaciones-GPA) **sigue enviando la placa vieja**. La migración única de 2026-08-27
 * re-archivó el historial bajo la placa vigente, pero no podía durar: cada inspección nueva
 * volvía a crear la unidad bajo la placa retirada. Verificado en prod el 2026-09-08: 7 de las
 * 11 unidades resucitadas en el catálogo con su placa vieja y 20 registros nuevos archivados
 * ahí entre el 31-ago y el 2-sep.
 *
 * Este módulo es la única fuente de verdad de esa equivalencia. Se aplica en los DOS extremos:
 *  - **Ingesta**: el puente de Ops-GPA (`src/opsgpa/mapChecklist.ts`) y la carga por Excel/ZIP
 *    (`src/api/batchUpload.ts`) normalizan antes de escribir, para que ningún registro nuevo
 *    nazca bajo una placa retirada.
 *  - **Lectura**: el cruce de `cloudHydrate` normaliza, para que un registro que se colara
 *    igual encuentre su unidad.
 *
 * ⚠️ La normalización de LECTURA es una red, no la garantía. La garantía es que todo escritor
 * normalice. Mientras exista un registro cuyo `unitUid` no sea su placa vigente, la fila
 * renderizada tiene una placa (la del catálogo, canónica) distinta de su llave almacenada, y
 * cualquier identidad derivada de la fila divergiría de la almacenada. Por eso la fila carga
 * su llave cruda en `unitUid` y el `refId` de anulación se compone SIEMPRE de esa llave
 * cruda — ver `mergeUnitWithChecklist` en cloudHydrate y `anularInspeccion` en el monolito.
 *
 * Cuando GPA reemplace otra unidad: agregar el par aquí y correr
 * `scripts/reparar-identidad-placas.mjs` para re-archivar lo que ya entró con la placa vieja.
 */

/**
 * Placa retirada → placa vigente, por REEMPLACAMIENTO. Verificado contra la tarjeta de
 * circulación de cada unidad; varios comprobantes de refrendo de Jalisco imprimen el campo
 * "PLACA ANT." confirmando la sustitución. El comentario es el número económico.
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
 * Placas MAL CAPTURADAS a mano en el panel admin. No son reemplacamientos, son errores de
 * dedo; van aparte para no confundir las dos causas, pero resuelven igual porque el efecto es
 * el mismo (el historial de la unidad se parte) y `normalizaPlaca` NO puede arreglarlos: no es
 * un separador ni una mayúscula, es un carácter de más.
 *
 * eco 75: el catálogo decía "JY138152", ocho caracteres, con un "1" de más. La placa real es
 * JY38152 — lo confirman las 7,332 cargas de combustible, que identifican por número económico
 * y traen la placa como dato. Bajo JY38152 había 10 inspecciones mensuales, 27 semanales y 2
 * ingresos a taller que no encontraban su unidad.
 */
export const PLACAS_MAL_CAPTURADAS: Readonly<Record<string, string>> = Object.freeze({
  JY138152: "JY38152", // eco 75
});

/** Todo lo que resuelve a otra placa, de las dos causas. */
const EQUIVALENCIAS: Readonly<Record<string, string>> = Object.freeze({
  ...PLACAS_SUSTITUIDAS,
  ...PLACAS_MAL_CAPTURADAS,
});

/**
 * Forma canónica de una placa para COMPARAR: sin espacios, guiones ni minúsculas. La misma
 * placa se captura como "JB4255A", "jb4255a" o "JB-4255-A" según quién la escriba, y cada
 * variante abría una unidad nueva.
 *
 * No valida el formato: el catálogo incluye montacargas y remolques cuyo "placa" es un número
 * de serie ("G25NXP58", "560XM", "H50FT"), y descartarlos los dejaría sin identidad.
 */
export function normalizaPlaca(valor: unknown): string {
  // Un objeto NO es una placa: la ingesta manda {} cuando el campo va vacío y String() lo
  // volvería "[object Object]", una identidad falsa que abriría una unidad basura.
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
  return EQUIVALENCIAS[p] ?? p;
}
