// Lectura y escritura de partidas de taller desde la app. Archivo aparte:
// batchUpload.ts ya es grande y tiene otra responsabilidad.

import { getUrl } from "aws-amplify/storage";
import { getClient, type Schema } from "./amplifyClient";
import { tallerCloudKey, type LegacyTallerEntry } from "./batchUpload";
import {
  autorizar,
  partidaManual,
  partidasPendientesDeFirma,
  proponer,
  rechazar,
  totalesVisita,
  type Partida,
  type PartidaTipo,
  type TotalesVisita,
} from "../taller/partidas";

/** Junta `{unitUid, fechaEntrada}` en la MISMA llave que usa `Partida.visitaKey`.
 *  Fix ronda 2 (Finding 2): esta plantilla vive en UN solo lugar y solo se usa
 *  hacia ADELANTE (para componer una llave), nunca hacia atrás (para separar
 *  una existente) — un `unitUid` que trajera un "|" propio (poco común, pero
 *  posible: viene de plate/eco/unitKey/id) haría que separar de vuelta
 *  fallara en silencio. Construir siempre hacia adelante retira esa clase de
 *  bug en vez de documentarla. */
export function juntaVisitaKey(k: { unitUid: string; fechaEntrada: string }): string {
  return `${k.unitUid}|${k.fechaEntrada}`;
}

/** La llave de la visita se DERIVA de tallerCloudKey para que las dos nunca
 *  divergan: si cambia la regla de la clave cloud, esta la sigue sola. */
export function visitaKeyDe(e: LegacyTallerEntry): string {
  return juntaVisitaKey(tallerCloudKey(e));
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
 * Una fila de la bandeja de firmas (Task 8): una VISITA, no una partida
 * suelta. Agrupar por visita es deliberado — autorizar partidas aisladas
 * ciega al conjunto: se pueden firmar cuatro de $1,800 sin notar que van
 * $7,200 en una unidad que ya lleva $38 mil en el año.
 */
export type FilaBandeja = {
  visitaKey: string;
  eco: string;
  placa: string;
  submarca: string;
  sucursal: string;
  area: string;
  tipo: string;
  proveedor: string;
  fechaEntrada: string;
  fsalidaEst: string;
  km: number | null;
  totales: TotalesVisita;
  pendientes: number;
  /** Las partidas que esperan firma, YA filtradas (`partidasPendientesDeFirma`,
   *  src/taller/partidas.ts) — el monolito pinta esta lista directo y nunca
   *  vuelve a preguntar `estado === "propuesta"` por su cuenta. Fix ronda 1
   *  de Task 8 (Important 1): una sola definición de "esperando firma", no
   *  el mismo filtro copiado en dos/tres lugares. */
  partidasPendientes: Partida[];
  /** Contexto que convierte la firma en decisión: lo que esa unidad ya gastó
   *  este año (Ruling A: solo visitas CERRADAS — ver gastoAnualPorEco). */
  gastoAnual: number;
  visitasAnual: number;
  esperandoDesde: string;
};

/**
 * Filas de la bandeja: una por visita con al menos una partida "propuesta",
 * ordenadas por lo que lleva MÁS tiempo esperando la firma primero. Una
 * visita sin pendientes no aparece — la bandeja es "lo que falta firmar",
 * no un inventario de todo.
 */
export function filasBandeja(
  entries: LegacyTallerEntry[],
  porVisita: Map<string, Partida[]>,
  anualPorEco: Map<string, { gasto: number; visitas: number }>,
): FilaBandeja[] {
  const filas: FilaBandeja[] = [];
  for (const e of entries) {
    const visitaKey = visitaKeyDe(e);
    const ps = porVisita.get(visitaKey) ?? [];
    const partidasPendientes = partidasPendientesDeFirma(ps);
    if (!partidasPendientes.length) continue;

    const anual = anualPorEco.get(String(e.eco ?? "")) ?? { gasto: 0, visitas: 0 };
    const esperas = partidasPendientes
      .map((p) => p.propuestoEn ?? p.creadoEn ?? "")
      .filter(Boolean)
      .sort();

    filas.push({
      visitaKey,
      eco: String(e.eco ?? ""),
      placa: String(e.plate ?? ""),
      submarca: String(e.brand ?? ""),
      sucursal: String(e.sucursal ?? ""),
      area: String(e.area ?? ""),
      tipo: String(e.tipo ?? ""),
      proveedor: String(e.tecnico ?? ""),
      fechaEntrada: String(e.fentrada ?? ""),
      fsalidaEst: String(e.fsalidaEst ?? ""),
      km: typeof e.km === "number" ? e.km : null,
      totales: totalesVisita(ps),
      pendientes: partidasPendientes.length,
      partidasPendientes,
      gastoAnual: anual.gasto,
      visitasAnual: anual.visitas,
      esperandoDesde: esperas[0] ?? "",
    });
  }
  // Lo que lleva más tiempo esperando tu firma, primero.
  filas.sort((a, b) => (a.esperandoDesde || "9").localeCompare(b.esperandoDesde || "9"));
  return filas;
}

/**
 * El resumen de "firmar todas las pendientes de esta visita en un solo
 * click": cuáles se pueden (tienen precio — Ruling B: nunca se autoriza en
 * silencio una partida sin precio), cuánto queda autorizado si se firman, y
 * cuántas se quedan fuera. Vive en `src/` (fix ronda 1, Important 2) porque
 * es exactamente la aritmética que Ruling B existe para proteger — antes
 * vivía en el `<script>` inline, donde ningún test la alcanzaba.
 */
export function resumenLoteFirma(
  ps: Partida[],
  totales: TotalesVisita,
): { autorizables: Partida[]; monto: number; sinPrecio: number } {
  const autorizables = ps.filter((p) => typeof p.precio === "number");
  const monto = totales.autorizado + autorizables.reduce((s, p) => s + (p.precio ?? 0), 0);
  return { autorizables, monto, sinPrecio: ps.length - autorizables.length };
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

export type DecisionPartida = "autorizar" | "rechazar";

/**
 * Persiste la firma de UNA partida: aplica `autorizar`/`rechazar` (la lógica
 * pura de `src/taller/partidas.ts` — nunca reimplementada aquí) y escribe el
 * resultado en DynamoDB. La autorización es un REGISTRO, no una bandera: se
 * guardan `decididoPor` + `decididoEn` + `precioAutorizado` (y el motivo/nota
 * en un rechazo), nunca solo un booleano — así una segunda instancia de firma
 * el día de mañana es agregar un campo, no rehacer el módulo.
 *
 * No valida rol: igual que el resto de la escritura de esta app, el gate real
 * es AppSync (`operativo`/`admin`); esto solo persiste lo que la UI, ya
 * gateada para viewer, permitió intentar.
 */
export async function guardarDecisionPartida(args: {
  tenantId: string;
  partida: Partida;
  decision: DecisionPartida;
  quien: string;
  cuando: string;
  motivo?: string;
  nota?: string;
}): Promise<Partida> {
  const { tenantId, partida, decision, quien, cuando, motivo, nota } = args;
  const nueva =
    decision === "autorizar"
      ? autorizar(partida, quien, cuando)
      : rechazar(partida, motivo ?? "", nota, quien, cuando);

  const c = getClient();
  const { errors } = await c.models.TallerPartida.update({
    tenantId,
    visitaKey: partida.visitaKey,
    partidaId: partida.partidaId,
    estado: nueva.estado,
    precioAutorizado: nueva.precioAutorizado,
    motivoRechazo: nueva.motivoRechazo,
    motivoRechazoNota: nueva.motivoRechazoNota,
    decididoPor: nueva.decididoPor,
    decididoEn: nueva.decididoEn,
  });
  if (errors) throw new Error(`TallerPartida.update (decisión): ${JSON.stringify(errors)}`);
  return nueva;
}

/**
 * Task 12 (la salida de emergencia) — captura manual de Riesgos: el taller
 * mandó su cotización por WhatsApp en vez de usar la liga. Compone las DOS
 * transiciones puras de src/taller/partidas.ts en el mismo golpe de
 * escritura — nace en `borrador` (`partidaManual`, valida los tres campos)
 * y se manda a autorización (`proponer`) ANTES de persistir — nunca queda
 * nada a medias en DynamoDB: si `partidaManual` lanza (descripción vacía,
 * precio fuera de rango, tipo inválido), no se llama ni una vez a AppSync.
 *
 * Mismo shape de manejo de error que `guardarDecisionPartida`: `if (errors)
 * throw`. Mismo no-valida-rol: el gate real es AppSync (operativo/admin,
 * ver amplify/data/resource.ts) — esto solo persiste lo que la UI, ya
 * gateada para viewer y para el apagador del esquema (needs-hibrido), dejó
 * intentar.
 */
export async function crearPartidaManual(args: {
  tenantId: string;
  datos: { descripcion: string; tipo: PartidaTipo; precio: number };
  visitaKey: string;
  autorSub: string;
  ahora: string;
}): Promise<Partida> {
  const { tenantId, datos, visitaKey, autorSub, ahora } = args;
  const borrador = partidaManual(datos, visitaKey, autorSub, ahora);
  const propuesta = proponer(borrador, ahora);

  const c = getClient();
  const { errors } = await c.models.TallerPartida.create({
    tenantId,
    visitaKey: propuesta.visitaKey,
    partidaId: propuesta.partidaId,
    descripcion: propuesta.descripcion,
    tipo: propuesta.tipo,
    precio: propuesta.precio,
    estado: propuesta.estado,
    fotos: propuesta.fotos,
    creadoPor: propuesta.creadoPor,
    creadoEn: propuesta.creadoEn,
    propuestoEn: propuesta.propuestoEn,
    version: 1,
  });
  if (errors) throw new Error(`TallerPartida.create (captura manual): ${JSON.stringify(errors)}`);
  return propuesta;
}

/**
 * URL firmada para UNA foto de partida, tal cual está en `Partida.fotos`.
 *
 * A propósito NO reusa `getCloudPhotoUrl` (src/api/photoFetch.ts): ese helper
 * está pensado para basenames planos de MoreApp y por eso normaliza a
 * minúsculas antes de firmar. La llave de una foto de partida
 * (`llaveFoto` en `amplify/functions/taller-portal/validacion.ts`) es una
 * ruta COMPLETA que incluye la visitaKey con mayúsculas (la placa) —
 * bajarla a minúsculas produce una llave que no existe en S3 y la foto
 * jamás carga. Aquí se firma la llave tal cual, sin tocarla.
 */
export async function urlFotoPartida(key: string): Promise<string | null> {
  try {
    const result = await getUrl({ path: key });
    return result.url.toString();
  } catch {
    return null;
  }
}
