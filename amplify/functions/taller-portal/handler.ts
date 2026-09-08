// Portal del proveedor: sirve la página y recibe sus escrituras.
//
// Reglas que no se negocian:
// - tenantId/unitUid/fechaEntrada salen del TOKEN, nunca del body.
// - No hay endpoint que liste ni busque nada.
// - La llave de S3 la genera el servidor; el cliente nunca elige ruta.
// - Todo texto entrante se valida aquí, no solo en el navegador.
// - Ninguna respuesta distingue POR QUÉ una liga no sirvió (firma mala,
//   vencida, revocada, secreto ausente...): todas responden lo mismo hacia
//   afuera. El motivo real solo vive en la bitácora del servidor.

import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/taller-portal";
import type { Schema } from "../../data/resource";
import { ErrorToken, verificarToken, type PortalToken } from "./token";

export const MIMES_FOTO = ["image/jpeg", "image/png", "image/webp"] as const;
export const TOPE_FOTOS_PARTIDA = 6;
export const TOPE_PARTIDAS_VISITA = 60;
// 10 MB — tope de bytes por foto subida (spec §7.3): sin esto, una liga
// válida podría empujar archivos sin límite hacia el bucket de producción
// mientras el token siga vigente.
export const TOPE_BYTES_FOTO = 10 * 1024 * 1024;
const LARGO_DESCRIPCION = 500;
const PRECIO_MAX = 10_000_000;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Error de ENTRADA: el dato lo mandó el cliente y el mensaje describe qué
 * tiene mal (precio, tipo, mime, tope...). Es seguro devolverlo tal cual en
 * un 400 — no describe infraestructura.
 *
 * Cualquier otro error (fallo de GraphQL, S3, excepción no prevista) NO se
 * expone: se registra completo en la bitácora y el cliente recibe un 500
 * genérico. Sin esta distinción, un error de AppSync (que puede traer
 * nombres de tabla/campo) se filtraría tal cual al proveedor externo.
 */
class ErrorEntrada extends Error {}

/** Error de negocio "la liga ya no sirve" detectado DESPUÉS de que el token
 *  verificó bien su firma (revocación por ligaVersion, o la visita referida
 *  ya no existe). Se trata igual que un token inválido de origen: mismo 401,
 *  mismo cuerpo opaco. */
class ErrorLigaInvalida extends Error {}

/** Un segmento seguro de ruta S3: sin barras, sin puntos dobles, acotado. */
function segmento(s: string): string {
  return String(s)
    .replace(/[^A-Za-z0-9_.:@+-]/g, "_")
    .replace(/\.{2,}/g, "_")
    .slice(0, 120);
}

export function llaveFoto(tenantId: string, visitaKey: string, uuid: string, mime: string): string {
  const ext = EXT[mime];
  if (!ext) throw new Error(`Tipo de archivo no permitido: ${mime}`);
  return `photos/${segmento(tenantId)}/taller-partidas/${segmento(visitaKey)}/${segmento(uuid)}.${ext}`;
}

export type PartidaEntrante = {
  descripcion: string;
  tipo: "refaccion" | "manoObra";
  precio: number;
};

export function validarPartidaEntrante(body: unknown): PartidaEntrante {
  const b = (body ?? {}) as Record<string, unknown>;

  const descripcion = String(b.descripcion ?? "")
    .trim()
    .slice(0, LARGO_DESCRIPCION);
  if (!descripcion) throw new ErrorEntrada("La descripción del hallazgo es obligatoria");

  const tipo = b.tipo;
  if (tipo !== "refaccion" && tipo !== "manoObra") {
    throw new ErrorEntrada(`Tipo no válido: ${String(tipo)}`);
  }

  const precio = b.precio;
  if (typeof precio !== "number" || !Number.isFinite(precio) || precio < 0 || precio > PRECIO_MAX) {
    throw new ErrorEntrada(`Precio no válido: ${String(precio)}`);
  }

  // Nada más se toma del cliente: el estado, la autoría y las fechas los pone
  // el servidor. Un cliente NO puede mandar una partida ya autorizada.
  return { descripcion, tipo, precio };
}

/**
 * El tamaño declarado de una foto ANTES de firmar su URL de subida. El límite
 * es real (§7.3): sin él, cualquiera con una liga vigente podría empujar
 * archivos de tamaño arbitrario al bucket de producción mientras el token
 * no expire. Se valida ANTES de emitir la URL prefirmada — nunca después —
 * y el valor validado se firma como ContentLength exacto en el PUT: S3
 * rechaza cualquier subida cuyo tamaño real no coincida.
 */
export function validarTamanoFoto(tamano: unknown): number {
  if (typeof tamano !== "number" || !Number.isInteger(tamano) || tamano <= 0) {
    throw new ErrorEntrada(`Tamaño de archivo no válido: ${String(tamano)}`);
  }
  if (tamano > TOPE_BYTES_FOTO) {
    throw new ErrorEntrada(`El archivo excede el máximo de ${TOPE_BYTES_FOTO} bytes`);
  }
  return tamano;
}

const SECRETO = process.env.TALLER_PORTAL_SECRET ?? "";

function json(status: number, body: unknown) {
  return {
    statusCode: status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

function html(status: number, cuerpo: string) {
  return {
    statusCode: status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    body: cuerpo,
  };
}

const PAGINA_LIGA_INVALIDA = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
 <title>Liga no válida</title>
 <div style="font:16px/1.6 system-ui;max-width:34em;margin:12vh auto;padding:0 1.5em;color:#0f172a">
 <h1 style="font-size:1.4em">Esta liga ya no sirve</h1>
 <p>Puede haber vencido o haber sido cancelada. Pídele una nueva a Administración de Riesgos de GPA.</p>
 </div>`;

/** Cada apertura y cada escritura se registra (§7.6 del spec). No se loggea el
 *  token completo: solo un prefijo, suficiente para correlacionar. */
function bitacora(accion: string, tk: PortalToken | null, extra: Record<string, unknown> = {}) {
  console.info(
    JSON.stringify({
      canal: "taller-portal",
      accion,
      liga: tk ? `liga:${tk.u}|${tk.f}|v${tk.v}` : "liga:invalida",
      ...extra,
    }),
  );
}

/** JSON.parse defensivo: un cuerpo malformado es un error de ENTRADA, no un 500. */
function parseBody(event: unknown): Record<string, unknown> {
  const raw = (event as { body?: unknown } | null | undefined)?.body;
  try {
    return JSON.parse(typeof raw === "string" ? raw : "{}");
  } catch {
    throw new ErrorEntrada("cuerpo JSON inválido");
  }
}

export const handler = async (event: any) => {
  const ruta = String(event?.rawPath ?? "/");
  const metodo = String(event?.requestContext?.http?.method ?? "GET").toUpperCase();
  const token = String(event?.queryStringParameters?.t ?? "");
  const esPagina = ruta === "/" && metodo === "GET";

  let tk: PortalToken;
  try {
    tk = verificarToken(token, SECRETO);
  } catch (e) {
    const motivo = e instanceof ErrorToken ? e.motivo : "malformado";
    bitacora("rechazado", null, { motivo });
    // Una liga vencida o revocada merece una explicación humana, no un 401 seco.
    // El MOTIVO real (sin-secreto/firma-invalida/expirado/...) solo va a la
    // bitácora — exponerlo en la respuesta convertiría a la liga en un oráculo
    // que le dice a cualquiera si el despliegue está mal configurado.
    if (esPagina) return html(401, PAGINA_LIGA_INVALIDA);
    return json(401, { error: "liga no válida" });
  }

  const visitaKey = `${tk.u}|${tk.f}`;

  try {
    if (metodo === "GET" && ruta === "/") {
      bitacora("abrir", tk);
      const { paginaProveedor } = await import("./pagina");
      return html(200, paginaProveedor(token));
    }

    if (metodo === "GET" && ruta === "/api/visita") {
      bitacora("leer", tk);
      return json(200, await leerVisita(tk, visitaKey));
    }

    if (metodo === "POST" && ruta === "/api/partida") {
      const body = parseBody(event);
      const datos = validarPartidaEntrante(body);
      bitacora("crear-partida", tk);
      return json(200, await crearPartida(tk, visitaKey, datos, body.fotos));
    }

    if (metodo === "POST" && ruta === "/api/visita") {
      const body = parseBody(event);
      bitacora("actualizar-visita", tk);
      return json(200, await actualizarVisita(tk, body));
    }

    if (metodo === "POST" && ruta === "/api/subida") {
      const body = parseBody(event);
      const mime = String(body?.mime ?? "");
      if (!(MIMES_FOTO as readonly string[]).includes(mime)) {
        return json(400, { error: "tipo de archivo no permitido" });
      }
      // El tamaño se valida ANTES de firmar la URL — nunca después.
      const tamano = validarTamanoFoto(body?.tamano);
      const key = llaveFoto(tk.t, visitaKey, randomUUID(), mime);
      bitacora("firmar-subida", tk, { key, tamano });
      return json(200, await firmarSubida(key, mime, tamano));
    }

    return json(404, { error: "no encontrado" });
  } catch (e) {
    // La revocación (ligaVersion subió tras emitirse el token) y la visita
    // ausente son la MISMA clase de fallo que una firma inválida desde el
    // punto de vista de quien llama: la liga, sencillamente, ya no sirve.
    if (e instanceof ErrorLigaInvalida) {
      bitacora("rechazado-tras-verificar", tk, { motivo: e.message });
      return esPagina ? html(401, PAGINA_LIGA_INVALIDA) : json(401, { error: "liga no válida" });
    }
    if (e instanceof ErrorEntrada) {
      bitacora("rechazado-entrada", tk, { motivo: e.message });
      return json(400, { error: e.message });
    }
    // Cualquier otra falla (GraphQL, S3, excepción no prevista): el detalle
    // completo se queda en la bitácora del servidor; el cliente NUNCA ve un
    // stack ni un mensaje de AppSync/S3.
    const msg = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ canal: "taller-portal", accion: "error", error: msg }));
    return json(500, { error: "error interno" });
  }
};

// ── Datos ──────────────────────────────────────────────────────────────────
// Mismo patrón de cliente AppSync por IAM que opsgpa-receptor/handler.ts:
// generateClient<Schema>({ authMode: "iam" }) tras configurar Amplify tal
// cual expone getAmplifyDataClientConfig tomando el `env` del módulo virtual
// $amplify/env/<nombre-de-la-función>.

const s3 = new S3Client({});
const BUCKET = process.env.CAPTURE_BUCKET ?? "";

let configured = false;
let dataClient: ReturnType<typeof generateClient<Schema>> | null = null;
async function getDataClient() {
  if (!configured) {
    const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(
      env as unknown as Parameters<typeof getAmplifyDataClientConfig>[0],
    );
    Amplify.configure(resourceConfig, libraryOptions);
    configured = true;
  }
  if (!dataClient) dataClient = generateClient<Schema>({ authMode: "iam" });
  return dataClient;
}

/** `datos` se guarda como texto (mismo convenio que src/api/client.ts); se lee
 *  defensivo por si algún día llega ya-objeto. */
function parseDatos(datos: unknown): Record<string, unknown> {
  if (typeof datos === "string") {
    try {
      return (JSON.parse(datos || "{}") ?? {}) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (datos ?? {}) as Record<string, unknown>;
}

async function firmarSubida(key: string, mime: string, tamano: number) {
  const url = await getSignedUrl(
    s3,
    // ContentLength EXACTO: S3 rechaza cualquier PUT cuyo tamaño real no
    // coincida con el firmado aquí — es lo que convierte el tope en algo
    // real y no solo un número que el cliente puede ignorar.
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: mime, ContentLength: tamano }),
    { expiresIn: 300 }, // minutos, no horas
  );
  return { url, key };
}

async function leerVisita(tk: PortalToken, visitaKey: string) {
  const client = await getDataClient();

  const { data: v, errors } = await client.models.Taller.get({
    tenantId: tk.t,
    unitUid: tk.u,
    fechaEntrada: tk.f,
  });
  if (errors) throw new Error(`Taller.get: ${JSON.stringify(errors)}`);
  if (!v) throw new ErrorLigaInvalida("visita no encontrada");

  const d = parseDatos(v.datos);
  // Revocación: un token con ligaVersion vieja muere aquí. `!==`, nunca `<`
  // — `v` (ligaVersion) es el interruptor de revocación, no un contador
  // donde "menor o igual" tenga sentido: cualquier desajuste es revocación.
  const vActual = Number(d.ligaVersion ?? 1);
  if (vActual !== tk.v) throw new ErrorLigaInvalida("liga revocada");

  const { data: partidas, errors: errPartidas } = await client.models.TallerPartida.list({
    filter: { tenantId: { eq: tk.t }, visitaKey: { eq: visitaKey } },
    limit: TOPE_PARTIDAS_VISITA + 10,
  });
  if (errPartidas) throw new Error(`TallerPartida.list: ${JSON.stringify(errPartidas)}`);

  return {
    // Solo lo que el taller necesita ver. Nada del resto de la flota.
    unidad: {
      eco: d.eco ?? "",
      placa: tk.u,
      submarca: d.brand ?? "",
      sucursal: d.sucursal ?? "",
      area: d.area ?? "",
    },
    visita: {
      tipo: d.tipo ?? "",
      fechaEntrada: tk.f,
      km: v.km ?? d.km ?? null,
      estadoOperativo: v.estadoOperativo ?? null,
      fsalidaEst: v.fsalidaEst ?? d.fsalidaEst ?? null,
      comentario: d.comentario ?? "",
    },
    partidas: (partidas ?? [])
      .filter((p) => p.estado !== "cancelada")
      .map((p) => ({
        partidaId: p.partidaId,
        descripcion: p.descripcion,
        tipo: p.tipo,
        precio: p.precio,
        estado: p.estado,
        motivoRechazo: p.motivoRechazo ?? null,
        fotos: p.fotos ?? [],
      })),
  };
}

async function crearPartida(
  tk: PortalToken,
  visitaKey: string,
  datos: PartidaEntrante,
  fotos: unknown,
) {
  const client = await getDataClient();

  const { data: existentes, errors: errExistentes } = await client.models.TallerPartida.list({
    filter: { tenantId: { eq: tk.t }, visitaKey: { eq: visitaKey } },
    limit: TOPE_PARTIDAS_VISITA + 10,
  });
  if (errExistentes) throw new Error(`TallerPartida.list: ${JSON.stringify(errExistentes)}`);
  const vivas = (existentes ?? []).filter((p) => p.estado !== "cancelada");
  if (vivas.length >= TOPE_PARTIDAS_VISITA) {
    throw new ErrorEntrada(`Esta visita ya tiene ${TOPE_PARTIDAS_VISITA} hallazgos`);
  }

  const llaves = Array.isArray(fotos) ? fotos.map(String) : [];
  if (llaves.length > TOPE_FOTOS_PARTIDA) {
    throw new ErrorEntrada(`Máximo ${TOPE_FOTOS_PARTIDA} fotos por hallazgo`);
  }
  // Una llave que el servidor no generó no entra: debe vivir bajo el prefijo
  // de ESTA visita.
  const prefijo = `photos/${segmento(tk.t)}/taller-partidas/${segmento(visitaKey)}/`;
  for (const k of llaves) {
    if (!k.startsWith(prefijo)) throw new ErrorEntrada("llave de foto no válida");
  }

  const ahora = new Date().toISOString();
  const { data, errors } = await client.models.TallerPartida.create({
    tenantId: tk.t,
    visitaKey,
    partidaId: randomUUID(),
    ...datos,
    // El estado y la autoría los pone el SERVIDOR, siempre.
    estado: "borrador",
    fotos: llaves,
    creadoPor: `liga:${tk.u}|${tk.f}`,
    creadoEn: ahora,
    version: 1,
  });
  if (errors) throw new Error(`TallerPartida.create: ${JSON.stringify(errors)}`);
  return data;
}

async function actualizarVisita(tk: PortalToken, body: Record<string, unknown>) {
  const client = await getDataClient();

  const input: Record<string, unknown> = {
    tenantId: tk.t,
    unitUid: tk.u,
    fechaEntrada: tk.f,
  };

  if (body.km !== undefined) {
    const km = Number(body.km);
    if (!Number.isInteger(km) || km < 1 || km > 3_000_000) {
      throw new ErrorEntrada("Kilometraje no válido");
    }
    input.km = km;
  }

  if (body.estadoOperativo !== undefined) {
    const permitidos = ["revisando", "reparando", "esperandoRefaccion", "lista"];
    if (!permitidos.includes(String(body.estadoOperativo))) {
      throw new ErrorEntrada("Estado no válido");
    }
    input.estadoOperativo = body.estadoOperativo;
  }

  if (body.fsalidaEst !== undefined) {
    const f = String(body.fsalidaEst).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw new ErrorEntrada("Fecha no válida");
    input.fsalidaEst = f;
    // El COMPROMISO se escribe una sola vez: es contra esta fecha que se mide
    // el incumplimiento, así que el taller no la puede reescribir para borrar
    // su propio retraso.
    const { data: actual, errors: errActual } = await client.models.Taller.get({
      tenantId: tk.t,
      unitUid: tk.u,
      fechaEntrada: tk.f,
    });
    if (errActual) throw new Error(`Taller.get: ${JSON.stringify(errActual)}`);
    if (!actual) throw new ErrorLigaInvalida("visita no encontrada");
    if (!actual.fsalidaEstCompromiso) input.fsalidaEstCompromiso = f;
  }

  const { data, errors } = await client.models.Taller.update(input as never);
  if (errors) throw new Error(`Taller.update: ${JSON.stringify(errors)}`);
  return data;
}
