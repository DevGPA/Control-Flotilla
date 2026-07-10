/**
 * Backfill pull: lee los registros de la tabla de Operaciones-GPA (solo-lectura, vía
 * GSI tipo-fecha) y los ingiere con LOS MISMOS adaptadores y upserts que el receptor
 * del puente. Cierra el hueco del modo espera: los registros capturados antes de
 * activar `FleetBridgeUrl` nunca cruzan el stream — este lector los trae.
 *
 * PURO respecto a AWS: la paginación de DynamoDB, la copia de evidencias y la
 * persistencia se INYECTAN (deps), así el flujo completo es testeable sin red.
 * Idempotente por construcción (claves naturales + nombres determinísticos):
 * re-ejecutar el backfill N veces converge al mismo estado.
 */
import { extraerEvidencias, stripInfra } from "./contract";
import type { OpsCargaRecord, OpsClRecord, OpsSolRecord } from "./contract";
import { mapCombustible } from "./mapCarga";
import { mapSemanal } from "./mapChecklist";
import { mapValidacion, type ValidacionCargaInput } from "./mapValidacion";
import type { CargaCombustibleInput } from "./contract";
import type { SemanalInput, UnitInput } from "./mapChecklist";

export interface BackfillRequest {
  backfill: true;
  /** Tipos a sincronizar (default ambos). */
  tipos?: Array<"SOL" | "CL">;
  /** true = mapear y reportar SIN escribir nada (validación). */
  dryRun?: boolean;
  /** Tope de registros por tipo (default sin tope). */
  limit?: number;
}

export interface BackfillDeps {
  /** Una página del GSI tipo-fecha: items crudos (ya unmarshalled) + cursor. */
  leerPagina: (
    tipo: string,
    cursor: Record<string, unknown> | undefined,
  ) => Promise<{ items: Array<Record<string, unknown>>; siguiente?: Record<string, unknown> }>;
  /** Copia una evidencia al bucket de FC → fname determinístico. */
  copiarEvidencia: (
    tipo: string,
    unidad: { economico?: string; placas?: string },
    campo: string,
    key: string,
  ) => Promise<string>;
  persistirCarga: (input: CargaCombustibleInput) => Promise<void>;
  persistirSemanal: (unit: UnitInput, semanal: SemanalInput) => Promise<void>;
  /** Upsert de ValidacionCarga con regla de no-pisado (la implementa el handler). */
  persistirValidacion: (input: ValidacionCargaInput) => Promise<void>;
}

export interface BackfillResumen {
  dryRun: boolean;
  leidos: number;
  escritos: { solicitud: number; carga: number; semanal: number };
  /** Validaciones derivadas de la aprobación en origen (decisión 2026-07-10). */
  validadas: number;
  omitidosMensual: number;
  errores: Array<{ id: string; error: string }>;
}

export async function runBackfill(
  req: BackfillRequest,
  deps: BackfillDeps,
): Promise<BackfillResumen> {
  const tipos = req.tipos ?? ["SOL", "CL"];
  const dryRun = req.dryRun === true;
  const resumen: BackfillResumen = {
    dryRun,
    leidos: 0,
    escritos: { solicitud: 0, carga: 0, semanal: 0 },
    validadas: 0,
    omitidosMensual: 0,
    errores: [],
  };

  for (const tipo of tipos) {
    let cursor: Record<string, unknown> | undefined;
    let porTipo = 0;
    do {
      const pagina = await deps.leerPagina(tipo, cursor);
      cursor = pagina.siguiente;
      for (const item of pagina.items) {
        if (req.limit && porTipo >= req.limit) {
          cursor = undefined;
          break;
        }
        porTipo += 1;
        resumen.leidos += 1;
        const plano = stripInfra(item);
        const id = String(plano.id ?? "?");
        try {
          // Registros que aún no se ingieren se omiten ANTES de copiar evidencias
          // (mensual: pendiente answersMap — contado, no silencioso).
          if (tipo === "CL" && (plano as unknown as OpsClRecord).tipo !== "semanal") {
            resumen.omitidosMensual += 1;
            continue;
          }
          const unidad = {
            economico: plano.economico ? String(plano.economico) : undefined,
            placas: plano.placas ? String(plano.placas) : undefined,
          };
          // Evidencias (idempotentes); en dryRun solo derivamos nombres.
          const fnames = new Map<string, string>();
          for (const { campo, key } of extraerEvidencias(plano)) {
            fnames.set(key, dryRun ? key : await deps.copiarEvidencia(tipo, unidad, campo, key));
          }
          const resolver = (key: string): string => fnames.get(key) ?? key;

          if (tipo === "SOL") {
            const input = mapCombustible(
              plano as unknown as OpsSolRecord | OpsCargaRecord,
              resolver,
            );
            if (!dryRun) await deps.persistirCarga(input);
            resumen.escritos[input.tipo] += 1;
            // Validación en origen: la aprobación de Ops se traduce a ValidacionCarga.
            const validacion = mapValidacion(plano, input);
            if (validacion) {
              if (!dryRun) await deps.persistirValidacion(validacion);
              resumen.validadas += 1;
            }
          } else {
            const { unit, semanal } = mapSemanal(plano as unknown as OpsClRecord, resolver);
            if (!dryRun) await deps.persistirSemanal(unit, semanal);
            resumen.escritos.semanal += 1;
          }
        } catch (e) {
          resumen.errores.push({ id, error: (e as Error).message });
        }
      }
    } while (cursor);
  }
  return resumen;
}
