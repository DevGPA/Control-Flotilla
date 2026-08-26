/**
 * Modo REPROCESO de la visión IA (Fase 1, Tarea 6) — batch por invocación directa,
 * mismo patrón que el backfill del receptor. Sin URL: solo lambda:InvokeFunction.
 *
 * Protecciones de gasto (el histórico son ~900 cargas y cada análisis cuesta dinero):
 *  - `soloSinVision: true` por DEFAULT — solo filas que nunca han tenido lectura.
 *  - `limit` por invocación (default 50) + `nextToken`: el operador itera lotes.
 *  - Un error en una carga se cuenta y NO tumba el lote (reparable re-invocando).
 */
import { analizaCarga, type DepsAnaliza } from "./analiza";
import { fnamesParaVision } from "./fnames";

export interface SolicitudReproceso {
  reproceso: true;
  /** default true: saltar filas que ya tienen tsVision (protege contra gasto accidental). */
  soloSinVision?: boolean;
  limit?: number;
  nextToken?: string | null;
}

export interface CargaListada {
  tenantId: string;
  loadId: string;
  /** JSON de CargaCombustible.datos (trae photos[]). */
  datos: string | null | undefined;
}

export interface DepsReproceso extends DepsAnaliza {
  listaCargas(
    nextToken: string | null | undefined,
    limit: number,
  ): Promise<{ items: CargaListada[]; nextToken?: string | null }>;
}

export interface ResumenReproceso {
  procesadas: number;
  skips: number;
  sinFotos: number;
  errores: number;
  nextToken: string | null;
}

export const LIMIT_DEFAULT = 50;

export async function reprocesaLote(
  req: SolicitudReproceso,
  deps: DepsReproceso,
): Promise<ResumenReproceso> {
  const soloSinVision = req.soloSinVision ?? true;
  const limit = req.limit ?? LIMIT_DEFAULT;
  const pagina = await deps.listaCargas(req.nextToken ?? null, limit);

  const resumen: ResumenReproceso = {
    procesadas: 0,
    skips: 0,
    sinFotos: 0,
    errores: 0,
    nextToken: pagina.nextToken ?? null,
  };

  // Secuencial a propósito: el throttling de Bedrock se respeta con la latencia natural
  // de cada llamada; paralelizar un backfill de cientos de cargas invita al 429.
  for (const carga of pagina.items) {
    const fnames = fnamesParaVision(carga.datos);
    if (!Object.keys(fnames).length) {
      resumen.sinFotos++;
      continue;
    }
    try {
      if (soloSinVision) {
        const existente = await deps.leeValidacion(carga.loadId);
        if (existente?.tsVision) {
          resumen.skips++;
          continue;
        }
      }
      const r = await analizaCarga(
        { tenantId: carga.tenantId, loadId: carga.loadId, fnames },
        deps,
      );
      if (r.estado === "analizada") resumen.procesadas++;
      else if (r.estado === "skip") resumen.skips++;
      else resumen.sinFotos++;
    } catch (e) {
      resumen.errores++;
      console.warn(`[vision:reproceso] ${carga.loadId}: ${(e as Error).message}`);
    }
  }

  return resumen;
}
