// Lectura y escritura de partidas de taller desde la app. Archivo aparte:
// batchUpload.ts ya es grande y tiene otra responsabilidad.

import { getClient, type Schema } from "./amplifyClient";
import { tallerCloudKey, type LegacyTallerEntry } from "./batchUpload";
import type { Partida } from "../taller/partidas";

/** La llave de la visita se DERIVA de tallerCloudKey para que las dos nunca
 *  divergan: si cambia la regla de la clave cloud, esta la sigue sola. */
export function visitaKeyDe(e: LegacyTallerEntry): string {
  const { unitUid, fechaEntrada } = tallerCloudKey(e);
  return `${unitUid}|${fechaEntrada}`;
}

export function agruparPorVisita(ps: Partida[]): Map<string, Partida[]> {
  const g = new Map<string, Partida[]>();
  for (const p of ps) {
    if (p.estado === "cancelada") continue;
    const arr = g.get(p.visitaKey) ?? [];
    arr.push(p);
    g.set(p.visitaKey, arr);
  }
  return g;
}

/**
 * Pagina el `.list()` de TallerPartida siguiendo `nextToken` hasta agotar —
 * mismo patrón que `listAll` en `src/api/client.ts` (sin esto, DynamoDB
 * trunca en ~100 ítems por página y el resto se pierde en silencio).
 */
async function listTallerPartidas(tenantId: string): Promise<Schema["TallerPartida"]["type"][]> {
  const c = getClient();
  const out: Schema["TallerPartida"]["type"][] = [];
  let token: string | null = null;
  let pages = 0;
  do {
    const page: {
      data: Schema["TallerPartida"]["type"][];
      nextToken?: string | null;
      errors?: readonly { errorType?: string; message?: string }[];
    } = await c.models.TallerPartida.list({
      filter: { tenantId: { eq: tenantId } },
      limit: 1000,
      nextToken: token ?? undefined,
    });
    if (page.errors && page.errors.length > 0) {
      throw new Error(`listTallerPartidas failed: ${JSON.stringify(page.errors)}`);
    }
    if (page.data) out.push(...page.data);
    token = page.nextToken ?? null;
    pages++;
  } while (token && pages < 100);
  if (token && pages >= 100) {
    console.warn(
      `[listTallerPartidas] paginación cortada en 100 páginas (${out.length} ítems) con nextToken pendiente — datos incompletos`,
    );
  }
  return out;
}

/** Lee las partidas del tenant desde cloud y las mapea al tipo puro `Partida`. */
export async function fetchPartidas(tenantId: string): Promise<Partida[]> {
  const rows = await listTallerPartidas(tenantId);
  return rows.map((r) => ({
    partidaId: r.partidaId,
    visitaKey: r.visitaKey,
    descripcion: r.descripcion,
    tipo: r.tipo ?? undefined,
    precio: r.precio ?? undefined,
    // El schema no marca `estado` required (deuda de Task 2); una fila sin
    // estado se trata como "borrador" — nunca cuenta como pendiente de firma.
    estado: (r.estado ?? "borrador") as Partida["estado"],
    motivoRechazo: r.motivoRechazo ?? undefined,
    motivoRechazoNota: r.motivoRechazoNota ?? undefined,
    fotos: (r.fotos ?? []).filter((f): f is string => typeof f === "string"),
    precioAutorizado: r.precioAutorizado ?? undefined,
    recotizaDe: r.recotizaDe ?? undefined,
    proveedorNombre: r.proveedorNombre ?? undefined,
    creadoPor: r.creadoPor ?? undefined,
    creadoEn: r.creadoEn ?? undefined,
    propuestoEn: r.propuestoEn ?? undefined,
    decididoEn: r.decididoEn ?? undefined,
    decididoPor: r.decididoPor ?? undefined,
    terminadoEn: r.terminadoEn ?? undefined,
  }));
}
