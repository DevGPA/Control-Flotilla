/**
 * ÍNDICE DEL CATÁLOGO POR PLACA VIGENTE — la capa pura del cruce `unit.placa === unitUid`.
 *
 * Vive aparte de `cloudHydrate` (y no inline, como estaba) por la misma razón que los
 * predicados de anulación: el cruce lo componen DOS lados y si divergen la unidad aparece
 * "sin una sola inspección" — falla EN SILENCIO. Con una función pura las pruebas ejercitan
 * el mismo código que corre en producción en vez de una copia del criterio.
 *
 * Detecta además los dos estados que un `Map` construido a la ligera esconde:
 *  - **Duplicados**: dos filas del catálogo que colapsan a la misma placa vigente (la placa
 *    retirada y la vigente conviviendo, o "JB4255A" y "JB-4255-A"). Un `new Map(...)` se queda
 *    con la ÚLTIMA en orden de paginación de AppSync, que no es estable: la misma data podía
 *    rendir `row.uid` distintos entre dos hidrataciones y con eso perder los hallazgos ya
 *    marcados (`mergeCheckDones` compara por cadena exacta).
 *  - **Sin llave**: filas cuya placa normaliza a "" (un guion, un espacio). Todas colapsarían
 *    a la misma entrada; se excluyen del índice y se cuentan.
 */
import { placaVigente } from "./placaVigente";

export type IndiceCatalogo<T> = {
  /** placa vigente → la fila del catálogo que la representa. */
  porPlaca: ReadonlyMap<string, T>;
  /** Llaves con más de una fila. Se conserva la fila cuya placa YA es la vigente. */
  duplicados: ReadonlyArray<{ llave: string; placas: string[] }>;
  /** Filas cuya placa normaliza a "" — quedan fuera del índice. */
  sinLlave: number;
};

/**
 * Indexa el catálogo por placa vigente.
 *
 * Ante un duplicado conserva la fila cuya placa ES ya la vigente (la correcta), y sólo si
 * ninguna lo es se queda con la primera. Así el resultado NO depende del orden de llegada.
 */
export function indexaCatalogo<T extends { placa?: unknown }>(
  units: readonly T[],
): IndiceCatalogo<T> {
  const porPlaca = new Map<string, T>();
  const colisiones = new Map<string, string[]>();
  let sinLlave = 0;

  for (const u of units) {
    const llave = placaVigente(u.placa);
    if (!llave) {
      sinLlave++;
      continue;
    }
    const previa = porPlaca.get(llave);
    if (previa === undefined) {
      porPlaca.set(llave, u);
      colisiones.set(llave, [String(u.placa ?? "")]);
      continue;
    }
    colisiones.get(llave)!.push(String(u.placa ?? ""));
    // Empate: manda la fila cuya placa ya es la vigente (determinista, no "la última").
    if (String(previa.placa ?? "") !== llave && String(u.placa ?? "") === llave) {
      porPlaca.set(llave, u);
    }
  }

  const duplicados = [...colisiones]
    .filter(([, placas]) => placas.length > 1)
    .map(([llave, placas]) => ({ llave, placas }));

  return { porPlaca, duplicados, sinLlave };
}

/** La fila del catálogo que corresponde a un `unitUid` almacenado, o `undefined`. */
export function resuelveUnidad<T>(
  indice: Pick<IndiceCatalogo<T>, "porPlaca">,
  unitUid: unknown,
): T | undefined {
  const llave = placaVigente(unitUid);
  return llave ? indice.porPlaca.get(llave) : undefined;
}

/**
 * Placas que tienen registros pero NINGUNA unidad en el catálogo: el historial de esa unidad
 * está partido. Devuelve las llaves vigentes, ordenadas, sin repetir.
 */
export function placasSinUnidad<T>(
  indice: Pick<IndiceCatalogo<T>, "porPlaca">,
  unitUids: Iterable<unknown>,
): string[] {
  const fuera = new Set<string>();
  for (const uid of unitUids) {
    const llave = placaVigente(uid);
    if (llave && !indice.porPlaca.has(llave)) fuera.add(llave);
  }
  return [...fuera].sort();
}
