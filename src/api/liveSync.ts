/**
 * Sincronización EN VIVO vía suscripciones GraphQL de AppSync.
 *
 * Todos los escritores del sistema (webhook MoreApp, receptor del puente
 * Operaciones-GPA, backfill, ediciones de admin) mutan por AppSync, así que cada
 * cambio emite una suscripción en tiempo real — sin polling ni infraestructura
 * nueva. Este módulo se suscribe a los modelos alimentados por el puente y avisa
 * al auto-refresh existente (cloudWire), que ya sabe re-hidratar sin molestar al
 * usuario (guardas de modal/typing, hidratación serializada).
 *
 * Baja el "peor caso" de frescura de ~4 min (poll) a ~2 s (evento).
 */
import { getClient } from "./amplifyClient";

/** Modelos que alimenta el puente Ops→FC (los que cambian sin acción del usuario local). */
const MODELOS_VIVOS = ["CargaCombustible", "ValidacionCarga", "Semanal", "Unit"] as const;

type Sub = { unsubscribe(): void };
type StreamFactory = () => { subscribe(h: { next: () => void; error: (e: unknown) => void }): Sub };
type ModeloStreams = Record<"onCreate" | "onUpdate", StreamFactory>;

/**
 * Arranca las suscripciones. `onChange(modelo)` se dispara por cada evento —
 * el llamador decide el debounce/refresh. Devuelve el stop().
 * `modelsProvider` es inyectable para pruebas.
 */
export function startLiveSync(
  onChange: (modelo: string) => void,
  modelsProvider: () => Record<string, unknown> = () =>
    getClient().models as unknown as Record<string, unknown>,
): () => void {
  const subs: Sub[] = [];
  let models: Record<string, unknown>;
  try {
    models = modelsProvider();
  } catch (err) {
    console.warn("[liveSync] sin cliente de datos — live sync desactivado:", err);
    return () => {};
  }
  for (const modelo of MODELOS_VIVOS) {
    const m = models[modelo] as ModeloStreams | undefined;
    if (!m) continue;
    for (const op of ["onCreate", "onUpdate"] as const) {
      try {
        subs.push(
          m[op]().subscribe({
            next: () => onChange(modelo),
            // Un error de WebSocket no debe tumbar nada: el poll de 4 min sigue
            // siendo la red de seguridad de frescura.
            error: (e) => console.warn(`[liveSync] ${modelo}.${op}:`, e),
          }),
        );
      } catch (e) {
        console.warn(`[liveSync] no se pudo suscribir ${modelo}.${op}:`, e);
      }
    }
  }
  console.info(`[liveSync] ${subs.length} suscripciones en vivo activas`);
  return () => {
    for (const s of subs) {
      try {
        s.unsubscribe();
      } catch {
        /* ya cerrada */
      }
    }
  };
}
