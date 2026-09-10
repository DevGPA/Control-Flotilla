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
// - Toda ruta autenticada cruza UN SOLO portón (cargarVisitaVigente): una
//   liga revocada no puede leer, crear partidas, actualizar la visita ni
//   firmar una subida — no solo "no puede leer".

import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/taller-portal";
import type { Schema } from "../../data/resource";
import {
  ErrorToken,
  verificarToken,
  firmarToken,
  VIGENCIA_LIGA_MS,
  type PortalToken,
} from "./token";
import {
  ErrorEntrada,
  MIMES_FOTO,
  TOPE_FOTOS_PARTIDA,
  TOPE_PARTIDAS_VISITA,
  ligaRevocada,
  llaveFoto,
  llaveFotoValida,
  puedeEnviarAAutorizacion,
  validarPartidaEntrante,
  validarTamanoFoto,
  type PartidaEntrante,
} from "./validacion";

/** Error de negocio "la liga ya no sirve" detectado DESPUÉS de que el token
 *  verificó bien su firma (revocación por ligaVersion, o la visita referida
 *  ya no existe). Se trata igual que un token inválido de origen: mismo 401,
 *  mismo cuerpo opaco. */
class ErrorLigaInvalida extends Error {}

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
 *  token completo: solo un prefijo, suficiente para correlacionar.
 *
 *  El tipo acepta solo `u`/`f`/`v` (no el `PortalToken` completo): emitirLiga/
 *  revocarLiga (Task 11) llaman esto sin un token real que firmar/verificar
 *  — solo tienen la visita y la versión de la columna — así que exigirles un
 *  `exp`/`t` de relleno solo para cuadrar el tipo sería ruido sin sentido. */
function bitacora(
  accion: string,
  tk: Pick<PortalToken, "u" | "f" | "v"> | null,
  extra: Record<string, unknown> = {},
) {
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

/** Grupos de ROL de Cognito (amplify/auth/resource.ts) — todo lo demás en
 *  `cognito:groups` es el tenant del usuario. Local a este archivo (no se
 *  importa de admin-users/handler.ts: cada Lambda es su propio módulo, sin
 *  acoplarse a los internos de otra función). */
const ROLES_TALLER = new Set(["admin", "operativo", "viewer"]);

/**
 * El tenant y quién invoca, tomados del `identity`/`claims` de AppSync que ya
 * validó el grupo (mismo patrón que `getIdentity` en
 * amplify/functions/admin-users/handler.ts): el tenant NO sale de un env var
 * inventado (no existe `TALLER_TENANT_ID`) — hoy es el único grupo Cognito del
 * usuario que no es un rol (admin/operativo/viewer), y con un segundo tenant
 * seguirá siendo correcto sin tocar este código. `quien` prioriza el correo
 * (identificable a simple vista en la bitácora y en `ligaCreadaPor`) sobre el
 * sub (un GUID); si ninguno viaja en el token, "desconocido" — una liga sin
 * autor no debe bloquear la emisión, pero tampoco debe mentir con un valor
 * inventado.
 */
function identidadDeResolver(event: any): { tenantId: string; quien: string } {
  const identity = (event?.identity ?? {}) as { sub?: string; claims?: Record<string, unknown> };
  const claims = identity.claims ?? {};
  const gruposRaw = claims["cognito:groups"];
  const grupos = Array.isArray(gruposRaw) ? (gruposRaw as string[]) : [];
  const tenantClaim = String(claims["custom:tenantId"] ?? "");
  const tenantId = tenantClaim || grupos.find((g) => !ROLES_TALLER.has(g)) || "";
  const quien = String(claims.email ?? "") || String(identity.sub ?? "") || "desconocido";
  return { tenantId, quien };
}

export const handler = async (event: any) => {
  // ── Invocación por AppSync (mutación con permiso de grupo) ──────────────
  // generarLigaTaller / revocarLigaTaller (amplify/data/resource.ts) llegan
  // aquí por `event.info.fieldName`, NUNCA por la URL pública del portal: esa
  // URL solo la protege la firma del token, así que una ruta de emisión ahí
  // dejaría a cualquiera en internet acuñar una liga para cualquier unidad
  // (ver la cabecera del archivo). AppSync YA validó el grupo del invocador
  // (admin/operativo) antes de invocar esta Lambda.
  //
  // Esta rama va ANTES de leer `rawPath`/verificar el token A PROPÓSITO: un
  // evento de resolver no trae `rawPath` ni `?t=`. Si esta rama no fuera lo
  // PRIMERO que el handler mira, `ruta` caería a "/" y `esPagina` a `true`
  // más abajo, y el fallo de `verificarToken` con un token vacío devolvería
  // la PÁGINA HTML "liga no válida" a AppSync en vez de JSON — una mutación
  // "que funciona" pero regresa basura al cliente.
  //
  // El valor de retorno es el objeto JSON CRUDO, NUNCA el sobre
  // {statusCode,headers,body} de las rutas HTTP de abajo: `.returns(a.json())`
  // en el schema espera el valor tal cual — mismo patrón que
  // admin-users/handler.ts, que retorna `{ok, ...}` directo, no una respuesta
  // HTTP.
  const campoResolver = event?.info?.fieldName;
  if (campoResolver === "generarLigaTaller" || campoResolver === "revocarLigaTaller") {
    try {
      if (!SECRETO) return { error: "portal no configurado" };
      const { unitUid, fechaEntrada } = (event.arguments ?? {}) as Record<string, unknown>;
      const { tenantId, quien } = identidadDeResolver(event);
      return campoResolver === "generarLigaTaller"
        ? await emitirLiga(tenantId, String(unitUid), String(fechaEntrada), quien)
        : await revocarLiga(tenantId, String(unitUid), String(fechaEntrada), quien);
    } catch (e) {
      if (e instanceof ErrorEntrada) return { error: e.message };
      const msg = e instanceof Error ? e.message : String(e);
      console.error(JSON.stringify({ canal: "taller-portal", accion: "error-liga", error: msg }));
      return { error: "error interno" };
    }
  }

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
    // ── El portón — TODA ruta lo cruza ──────────────────────────────────────
    // Una sola lectura de la visita, aquí, antes de cualquier despacho: si la
    // liga fue revocada (ligaVersion subió) o la visita ya no existe, ninguna
    // ruta de abajo se alcanza — ni leer, ni crear partida, ni actualizar la
    // visita, ni firmar una subida. Antes, la revocación solo se checaba
    // dentro de leerVisita: una liga revocada podía seguir escribiendo
    // partidas y firmando subidas de 10 MB durante los 90 días de vigencia
    // del token. El resultado se reutiliza en las rutas que lo necesitan, así
    // que actualizarVisita ya no repite su propio Taller.get.
    const visita = await cargarVisitaVigente(tk);

    if (metodo === "GET" && ruta === "/") {
      bitacora("abrir", tk);
      const { paginaProveedor } = await import("./pagina");
      return html(200, paginaProveedor(token));
    }

    if (metodo === "GET" && ruta === "/api/visita") {
      bitacora("leer", tk);
      return json(200, await leerVisita(tk, visitaKey, visita));
    }

    if (metodo === "GET" && ruta === "/api/foto") {
      // Misma validación que ya protege POST /api/partida: la llave debe
      // calzar la FORMA COMPLETA del prefijo de ESTA visita — nunca fotos de
      // otra visita ni de inspecciones (§7.3).
      const key = String(event?.queryStringParameters?.key ?? "");
      if (!llaveFotoValida(tk.t, visitaKey, key)) throw new ErrorEntrada("llave de foto no válida");
      bitacora("leer-foto", tk, { key });
      return json(200, await firmarLecturaFoto(key));
    }

    if (metodo === "POST" && ruta === "/api/partida") {
      const body = parseBody(event);
      const datos = validarPartidaEntrante(body);
      bitacora("crear-partida", tk);
      return json(200, await crearPartida(tk, visitaKey, datos, body.fotos));
    }

    if (metodo === "POST" && ruta === "/api/enviar") {
      // §6.2: borrador → propuesta, disparado UNA vez por el proveedor, para
      // que a Riesgos (Task 8) le llegue un solo aviso por hallazgo. Sin
      // esta ruta nada de lo capturado por el taller llegaba a autorización.
      return json(200, await enviarAAutorizacion(tk, visitaKey, visita));
    }

    if (metodo === "POST" && ruta === "/api/visita") {
      const body = parseBody(event);
      bitacora("actualizar-visita", tk);
      return json(200, await actualizarVisita(tk, body, visita));
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

/**
 * El portón único: una lectura de `Taller` por su llave real, seguida del
 * chequeo de revocación (`ligaRevocada`, pura, en validacion.ts). Lo cruza
 * TODA ruta autenticada — ver el comentario en `handler()`.
 */
async function cargarVisitaVigente(tk: PortalToken): Promise<Schema["Taller"]["type"]> {
  const client = await getDataClient();
  const { data: v, errors } = await client.models.Taller.get({
    tenantId: tk.t,
    unitUid: tk.u,
    fechaEntrada: tk.f,
  });
  if (errors) throw new Error(`Taller.get: ${JSON.stringify(errors)}`);
  if (!v) throw new ErrorLigaInvalida("visita no encontrada");
  if (ligaRevocada(v.ligaVersion, tk)) throw new ErrorLigaInvalida("liga revocada");
  return v;
}

/**
 * Trae TODAS las partidas de una visita — Query real por clave primaria
 * (`tenantId` como hash + `beginsWith` sobre el sort key compuesto), NO un
 * Scan filtrado. Sigue `nextToken` hasta agotar las páginas.
 *
 * Sin esto: `TallerPartida.list({filter: {tenantId, visitaKey}})` (sin
 * argumentos de llave) resuelve como Scan, y DynamoDB aplica `limit` a lo
 * ESCANEADO antes del filtro — en cuanto la tabla pasa de ~70 filas (dos
 * visitas), una visita real puede devolver una lista vacía o parcial, y el
 * conteo del tope de 60 partidas deja de dispararse porque cuenta sobre una
 * página truncada, no sobre la visita completa.
 *
 * Forma del argumento VERIFICADA (no adivinada) contra dos fuentes
 * independientes en node_modules de este proyecto, no contra documentación:
 *  1) el runtime del cliente, `@aws-amplify/data-schema/.../APIClient.mjs`
 *     (`resolvedSkName` + el caso `LIST` de `buildGraphQLVariables`): para
 *     `.identifier(["tenantId","visitaKey","partidaId"])` el hash es
 *     `tenantId` y el sort key compuesto se manda bajo la llave
 *     `visitaKeyPartidaId` (camelCase de los campos de sort restantes).
 *  2) el transformer que arma el esquema real en CDK,
 *     `@aws-amplify/graphql-index-transformer` (`toCamelCase` +
 *     `makeCompositeKeyConditionInputForKey`/`makeCompositeKeyInputForKey`):
 *     mismo nombre `visitaKeyPartidaId`, tipo `ModelTallerPartidaPrimary-
 *     CompositeKeyConditionInput` con `beginsWith`, cuyos campos internos
 *     (`visitaKey`, `partidaId`) son AMBOS opcionales — se puede mandar solo
 *     `visitaKey` para calzar cualquier partida de esa visita sin conocer
 *     `partidaId` de antemano (confirmado en la VTL de
 *     `applyCompositeKeyConditionExpression`, que arma el prefijo del
 *     `begins_with` solo con los campos presentes).
 *
 * El tipo público de `generateClient` SÍ expresa este argumento, así que la
 * llamada va SIN cast y el compilador la vigila:
 * `ClientSchema/Core/ClientModel.d.ts` define
 * `ListOptionsPkParams = Partial<IndexQueryInput<…>>`, e `IndexQueryInput` se
 * ramifica según `Idx["compositeSk"]`, que `MappedTypes/MapIndexes.d.ts`
 * (`PrimaryIndexFieldsToIR`) fija al literal `"visitaKeyPartidaId"` cuando el
 * sort key tiene dos campos; el `beginsWith?: Partial<SkIr>` viene de
 * `util/Filters.d.ts`.
 *
 * Que NO haya cast es la mitad del blindaje. Si ese nombre se desfasara (un
 * rename, un copy-paste, un refactor), `buildGraphQLVariables` lee
 * `arg[skName]` por el nombre CALCULADO, ignora en silencio la propiedad
 * desconocida y la consulta degrada a solo-hash: sigue siendo Query, NO
 * lanza error, y el endpoint devolvería las partidas de TODO el tenant a
 * quien tenga una sola liga. El compilador es lo que ahora impide eso; el
 * filtro por `visitaKey` de abajo es el cinturón de respaldo.
 */
async function listarPartidasDeVisita(
  tenantId: string,
  visitaKey: string,
): Promise<Schema["TallerPartida"]["type"][]> {
  const client = await getDataClient();
  const items: Schema["TallerPartida"]["type"][] = [];
  let nextToken: string | null | undefined;
  do {
    const {
      data,
      errors,
      nextToken: siguiente,
    } = await client.models.TallerPartida.list({
      tenantId,
      visitaKeyPartidaId: { beginsWith: { visitaKey } },
      limit: 100,
      nextToken,
    });
    if (errors) throw new Error(`TallerPartida.list: ${JSON.stringify(errors)}`);
    items.push(...(data ?? []));
    nextToken = siguiente;
  } while (nextToken);
  // Cinturón de respaldo, NO el mecanismo principal: el acotamiento real lo
  // hace el `beginsWith` sobre el sort key de arriba. Esto garantiza que,
  // incluso si ese argumento dejara de aplicarse alguna vez, el resultado
  // degrade a lento-pero-correcto en lugar de filtrar partidas de otras
  // visitas o del resto de la flota.
  return items.filter((p) => p.visitaKey === visitaKey);
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

/**
 * Presigned GET para que el taller vea sus propias fotos al reabrir la liga
 * (§7.3: nunca se lista el bucket, siempre una URL firmada de minutos por
 * llave puntual). La llave ya viene validada por `llaveFotoValida` contra
 * ESTA visita antes de llegar aquí — este helper no vuelve a decidir nada,
 * solo firma.
 */
async function firmarLecturaFoto(key: string) {
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: 300 }, // mismo tope que la subida — nunca una liga larga
  );
  return { url };
}

async function leerVisita(tk: PortalToken, visitaKey: string, visita: Schema["Taller"]["type"]) {
  const d = parseDatos(visita.datos);

  const partidas = await listarPartidasDeVisita(tk.t, visitaKey);

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
      km: visita.km ?? d.km ?? null,
      estadoOperativo: visita.estadoOperativo ?? null,
      fsalidaEst: visita.fsalidaEst ?? d.fsalidaEst ?? null,
      comentario: d.comentario ?? "",
    },
    partidas: partidas
      .filter((p) => p.estado !== "cancelada")
      .map((p) => ({
        partidaId: p.partidaId,
        descripcion: p.descripcion,
        tipo: p.tipo,
        precio: p.precio,
        // Congelado en el momento de la firma (Task 8): la página lo usa
        // para sumar "Autorizado" con lo REALMENTE firmado, no con la
        // cotización original.
        precioAutorizado: p.precioAutorizado ?? null,
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

  const existentes = await listarPartidasDeVisita(tk.t, visitaKey);
  const vivas = existentes.filter((p) => p.estado !== "cancelada");
  if (vivas.length >= TOPE_PARTIDAS_VISITA) {
    throw new ErrorEntrada(`Esta visita ya tiene ${TOPE_PARTIDAS_VISITA} hallazgos`);
  }

  const llaves = Array.isArray(fotos) ? fotos.map(String) : [];
  if (llaves.length > TOPE_FOTOS_PARTIDA) {
    throw new ErrorEntrada(`Máximo ${TOPE_FOTOS_PARTIDA} fotos por hallazgo`);
  }
  // Una llave que el servidor no generó no entra: la FORMA COMPLETA debe
  // calzar (prefijo de ESTA visita + un solo segmento con el charset/tope de
  // segmento() + una extensión permitida) — no solo el prefijo.
  for (const k of llaves) {
    if (!llaveFotoValida(tk.t, visitaKey, k)) throw new ErrorEntrada("llave de foto no válida");
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

async function actualizarVisita(
  tk: Pick<PortalToken, "t" | "u" | "f">,
  body: Record<string, unknown>,
  visita: Schema["Taller"]["type"],
  // Task 11 (R65): columnas de la liga, escritas SOLO por llamadores internos
  // (emitirLiga/revocarLiga) — la ruta pública POST /api/visita nunca pasa
  // este 4º argumento, así que el `body` que manda el taller, sin importar
  // qué contenga, no puede tocar `ligaVersion` ni el rastro de auditoría. Sin
  // este aislamiento, un taller malicioso podría reescribir `ligaVersion` en
  // su propio body y resucitar un token ya revocado.
  columnasLiga?: Partial<
    Pick<
      Schema["Taller"]["type"],
      "ligaVersion" | "ligaCreadaEn" | "ligaCreadaPor" | "ligaRevocadaEn" | "ligaRevocadaPor"
    >
  >,
) {
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
    // su propio retraso. `visita` ya viene cargada del portón — sin la
    // segunda lectura que hacía este bloque antes.
    if (!visita.fsalidaEstCompromiso) input.fsalidaEstCompromiso = f;
  }

  if (columnasLiga) Object.assign(input, columnasLiga);

  const { data, errors } = await client.models.Taller.update(input as never);
  if (errors) throw new Error(`Taller.update: ${JSON.stringify(errors)}`);
  return data;
}

/**
 * §6.2: mueve TODAS las partidas en "borrador" de esta visita a "propuesta",
 * en una sola pasada, para que a Riesgos (Task 8) le llegue un solo aviso
 * por hallazgo. Es la ruta que le faltaba al plan original — sin ella nada
 * de lo que captura el taller llega jamás a la bandeja de autorización.
 *
 * Idempotente por diseño: si ya no quedan borradores (reintento tras un
 * click doble, o una visita que ya se envio) responde 0 sin fallar — un
 * reintento de red nunca debe convertirse en un 400 para el taller.
 */
async function enviarAAutorizacion(
  tk: PortalToken,
  visitaKey: string,
  visita: Schema["Taller"]["type"],
) {
  // Espejo SERVIDOR de la regla de UI de la Tarea 6 (el botón "Enviar a
  // autorización" nace deshabilitado sin estos datos): el botón es
  // cortesía, esto es lo que de verdad lo impide si alguien llama la ruta
  // directo. Mismo fallback a `datos` que ya usa `leerVisita`: hoy SOLO
  // este portal escribe las columnas promovidas (`Taller.km`/`fsalidaEst`);
  // la app de escritorio de Administración de Riesgos sigue mandando ambos
  // campos dentro del blob `datos` (src/api/client.ts no los declara,
  // src/api/batchUpload.ts manda `datos: e` entero). Sin este fallback, el
  // portón de esta ruta rechazaba TODA visita real aunque la página ya
  // mostrara los valores y habilitara el botón leyéndolos de `datos`.
  const d = parseDatos(visita.datos);
  if (
    !puedeEnviarAAutorizacion({
      km: visita.km ?? d.km,
      fsalidaEst: visita.fsalidaEst ?? d.fsalidaEst,
    })
  ) {
    throw new ErrorEntrada(
      "Falta kilometraje o fecha estimada de salida para enviar a autorización",
    );
  }

  const client = await getDataClient();
  const partidas = await listarPartidasDeVisita(tk.t, visitaKey);
  const borradores = partidas.filter((p) => p.estado === "borrador");

  const ahora = new Date().toISOString();
  for (const p of borradores) {
    const { errors } = await client.models.TallerPartida.update({
      tenantId: tk.t,
      visitaKey,
      partidaId: p.partidaId,
      estado: "propuesta",
      propuestoEn: ahora,
    });
    if (errors) throw new Error(`TallerPartida.update: ${JSON.stringify(errors)}`);
  }

  // La bitácora se escribe DESPUÉS de que las mutaciones ya sucedieron, con
  // el conteo REAL de lo enviado — no la intención de antes de escribir
  // (la revisión de la Tarea 5 señaló justo este patrón en las demás
  // rutas; aquí se hace bien desde el inicio).
  bitacora("enviar-autorizacion", tk, { enviadas: borradores.length });

  return { enviadas: borradores.length };
}

/**
 * Task 11 — mutación `generarLigaTaller`. Firma un token nuevo apuntando a la
 * versión ACTUAL de la columna `ligaVersion` (una visita sin liga previa se
 * trata como versión 1 — mismo criterio que `ligaRevocada`). Emitir NO sube
 * la versión: un token nuevo con la MISMA versión convive con los que ya se
 * hubieran repartido antes, todos vigentes hasta la próxima revocación. El
 * rastro de auditoría (`ligaCreadaEn/Por`) se escribe a través del MISMO
 * `actualizarVisita` que ya usa la ruta pública — nunca un segundo helper de
 * escritura — pasando el 4º argumento que esa ruta jamás pasa.
 */
async function emitirLiga(tenantId: string, unitUid: string, fechaEntrada: string, quien: string) {
  const client = await getDataClient();
  const { data: visita, errors } = await client.models.Taller.get({
    tenantId,
    unitUid,
    fechaEntrada,
  });
  if (errors) throw new Error(`Taller.get: ${JSON.stringify(errors)}`);
  if (!visita) throw new ErrorEntrada("La visita no existe");

  // Columna real, NUNCA `datos.ligaVersion` (R65): es la que `ligaRevocada`
  // compara contra el token dentro de `cargarVisitaVigente`.
  const ligaVersion = visita.ligaVersion ?? 1;
  const ahora = Date.now();
  const exp = ahora + VIGENCIA_LIGA_MS;
  const token = firmarToken(
    { t: tenantId, u: unitUid, f: fechaEntrada, v: ligaVersion, exp },
    SECRETO,
  );

  await actualizarVisita({ t: tenantId, u: unitUid, f: fechaEntrada }, {}, visita, {
    ligaCreadaEn: new Date(ahora).toISOString(),
    ligaCreadaPor: quien,
  });

  bitacora("emitir-liga", { u: unitUid, f: fechaEntrada, v: ligaVersion }, { quien });
  // Devuelve el TOKEN, no una URL (R66): componer `${TALLER_PORTAL_URL}?t=...`
  // en este Lambda leyendo la URL de su PROPIA Function URL como env var crea
  // un ciclo Function→FunctionUrl→Function que falla el synth de CDK. La URL
  // la compone el FRONTEND (amplify_outputs.json → custom.tallerPortalUrl,
  // ya publicado por amplify/backend.ts).
  return { token, expira: exp };
}

/**
 * Task 11 — mutación `revocarLigaTaller`. Sube `ligaVersion` (la COLUMNA,
 * R65): es el único interruptor de revocación — `ligaRevocada` compara con
 * `!==`, así que CUALQUIER cambio de versión invalida todos los tokens
 * firmados antes, sin tocar el token mismo (nunca se guarda en la base).
 */
async function revocarLiga(tenantId: string, unitUid: string, fechaEntrada: string, quien: string) {
  const client = await getDataClient();
  const { data: visita, errors } = await client.models.Taller.get({
    tenantId,
    unitUid,
    fechaEntrada,
  });
  if (errors) throw new Error(`Taller.get: ${JSON.stringify(errors)}`);
  if (!visita) throw new ErrorEntrada("La visita no existe");

  const nueva = (visita.ligaVersion ?? 1) + 1;
  const ahora = new Date().toISOString();

  await actualizarVisita({ t: tenantId, u: unitUid, f: fechaEntrada }, {}, visita, {
    ligaVersion: nueva,
    ligaRevocadaEn: ahora,
    ligaRevocadaPor: quien,
  });

  bitacora("revocar-liga", { u: unitUid, f: fechaEntrada, v: nueva }, { quien });
  return { ligaVersion: nueva };
}
