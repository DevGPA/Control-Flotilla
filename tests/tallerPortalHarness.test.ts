/**
 * ARNÉS DE SEGURIDAD DEL PORTAL DEL TALLER (R83) — las propiedades se EJECUTAN.
 * ===========================================================================
 *
 * Hasta aquí, las propiedades de seguridad de `amplify/functions/taller-portal/
 * handler.ts` estaban protegidas por pruebas ESTRUCTURALES: leen el archivo como
 * texto y afirman que cierta línea existe (tallerPortalHandler.test.ts,
 * tallerLiga.test.ts). Son honestas, pero no prueban COMPORTAMIENTO: un `if`
 * presente en el texto puede estar en la rama equivocada, detrás de un `return`
 * previo, o simplemente no dispararse.
 *
 * Este archivo llama al `handler(event)` REAL con eventos sintéticos y afirma
 * códigos de estado y cuerpos. Nada de AWS: el cliente de datos, S3 y el
 * presigner van mockeados contra un almacén en memoria que cada prueba controla
 * (ver "Lo que se mockea", abajo). Los tokens se acuñan con el `firmarToken`
 * REAL de token.ts — jamás se reimplementa el HMAC aquí.
 *
 * CERO cambios de producción. La única pieza de infraestructura que hizo falta
 * es el alias de PRUEBAS `$amplify/env/taller-portal` → tests/stubs/ en
 * `vite.config.ts` (bajo `test.alias`, no en el build de la app): sin él, el
 * análisis de imports de Vite tumba handler.ts antes de que `vi.mock` alcance a
 * intervenir — comprobado, no supuesto.
 *
 * ── LAS 17 PROPIEDADES ────────────────────────────────────────────────────────
 * La lista canónica de la fase de diseño se perdió; esta es la reconstrucción
 * desde el código. Cada `describe` de abajo abre con su número.
 *
 *  1. Secreto ausente o de menos de 32 caracteres ⇒ TODA ruta pública responde
 *     401; la rama del resolver responde "portal no configurado" y no acuña nada.
 *  2. Token forjado / manipulado / con firma de otro secreto ⇒ 401 con cuerpo
 *     OPACO (no delata cuál chequeo falló).
 *  3. Token vencido ⇒ 401 opaco.
 *  4. Liga revocada (`ligaVersion` de la fila > `v` del token) ⇒ 401 opaco; el
 *     token nunca se guarda ni se necesita para revocarlo.
 *  5. Visita cerrada (`estatus === "cerrado"` o `datos.estado === "Finalizado"`)
 *     ⇒ 401 opaco en toda ruta; `emitirLiga` se niega a acuñar para ella.
 *  6. Apagador: `AppConfig.tallerHibrido` falso ⇒ 401 opaco en las rutas
 *     públicas y el resolver se niega a EMITIR; la revocación sigue funcionando
 *     con el apagador puesto (R96); la lectura se memoiza ~60 s; una lectura
 *     fallida ⇒ cerrado (401) y el fallo NO se memoiza.
 *  7. La lectura del apagador ocurre ANTES de la lectura de la fila de la visita
 *     (un tenant apagado nunca llega a tocar la fila).
 *  8. Lectura de foto (`GET /api/foto`): solo llaves dentro del prefijo de ESTA
 *     visita; una llave de otra visita/otro tenant se rechaza, y el GET firmado
 *     lleva exactamente la llave pedida cuando sí está en alcance.
 *  9. Firma de subida (`POST /api/subida`): solo bajo el prefijo de esta visita,
 *     con el `ContentType` firmado salido de los MIMES permitidos y el tope de
 *     tamaño (10 MB) aplicado ANTES de firmar.
 * 10. Creación de partida: el SERVIDOR pone `estado: "borrador"`,
 *     `creadoPor: "liga:…"`, `version: 1` y un `partidaId` UUID; rechaza precios
 *     no finitos / sobre `PRECIO_MAX` / negativos, llaves de foto fuera del
 *     prefijo y el tope de fotos por partida; la respuesta es exactamente
 *     `{ partidaId, fotos }` (nunca la fila cruda).
 * 11. `POST /api/visita` responde exactamente `{ ok: true }` (jamás la fila); la
 *     validación de `km` es el ÚNICO predicado estricto `esKmValido`.
 * 12. Proyección de `leerVisita`: el taller NUNCA recibe `gasto`, `gastoRef`,
 *     `gastoMO`, `comentario`, `ligaCreadaPor`, `ligaRevocadaPor`, `folio`,
 *     `tecnico` ni `refacciones` — se afirma el conjunto EXACTO de llaves.
 * 13. `POST /api/enviar`: mueve a `propuesta` solo los borradores DE ESTA
 *     visita; las filas de otras visitas quedan intactas; es idempotente en una
 *     segunda llamada; respeta el portón (cerrada/apagado ⇒ 401).
 * 14. Rama del resolver: sin identidad ⇒ error y nada acuñado; grupos sin
 *     `admin`/`riesgos` ⇒ "no autorizado"; `admin` acuña; `riesgos` acuña; el
 *     tenant sale de `custom:tenantId` o del primer grupo que no esté en
 *     `ROLES_TALLER`; la carga útil es `{ token, expira }` pelado; `expira` ≈
 *     ahora + 90 días; el token acuñado verifica con `verificarToken`.
 * 15. Las respuestas de `html()` llevan las tres cabeceras de seguridad
 *     (`content-security-policy` con `frame-ancestors 'none'`,
 *     `x-content-type-options: nosniff`, `referrer-policy: no-referrer`) más
 *     `cache-control`.
 * 16. Bitácora: toda ruta de escritura loggea DESPUÉS de que la escritura tuvo
 *     éxito (una escritura fallida ⇒ ninguna línea) y la línea lleva el
 *     `sourceIp` y la huella de 8 caracteres del token, jamás el token completo.
 * 17. Ruteo: `rawPath` desconocido ⇒ 404; método equivocado ⇒ 404 (lo que el
 *     handler hace de verdad: cae al mismo catch-all, no hay 405); la rama del
 *     resolver se despacha por `info.fieldName` ANTES de cualquier lógica de
 *     `rawPath`.
 *
 * ── LO QUE SE MOCKEA ─────────────────────────────────────────────────────────
 *  · `$amplify/env/taller-portal`  → tests/stubs/ vía `test.alias` (vite.config.ts)
 *  · `@aws-amplify/backend/function/runtime` → `getAmplifyDataClientConfig` estático
 *  · `aws-amplify`                 → `Amplify.configure` no-op
 *  · `aws-amplify/data`            → `generateClient` con `models.Taller.{get,update}`,
 *                                    `models.TallerPartida.{create,list,update}` y
 *                                    `models.AppConfig.get`, sobre un almacén en memoria
 *  · `@aws-sdk/client-s3`          → `S3Client`/`PutObjectCommand`/`GetObjectCommand`
 *  · `@aws-sdk/s3-request-presigner`→ `getSignedUrl` devuelve una URL FALSA que
 *                                    incrusta Bucket/Key/ContentType/ContentLength
 *                                    para poder afirmar el acotamiento.
 *
 * Valores ficticios en todo (el repo es PÚBLICO): tenant "acme", placas AAA111/
 * BBB222, correos @ejemplo.invalid, IP de la red de documentación 203.0.113.7.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  VIGENCIA_LIGA_MS,
  firmarToken,
  verificarToken,
  type PortalToken,
} from "../amplify/functions/taller-portal/token";
import {
  LARGO_DESCRIPCION,
  PRECIO_MAX,
  TOPE_BYTES_FOTO,
  TOPE_FOTOS_PARTIDA,
  TOPE_PARTIDAS_VISITA,
  segmento,
} from "../amplify/functions/taller-portal/validacion";

type Fila = Record<string, unknown>;

// El almacén vive FUERA del grafo de módulos que `vi.resetModules()` recicla:
// `vi.hoisted` corre una sola vez por archivo de prueba, así que las fábricas de
// `vi.mock` (que sí se re-evalúan en cada reset) siguen cerrando sobre el MISMO
// objeto y una prueba puede sembrar datos antes de cargar el handler.
const g = vi.hoisted(() => ({
  taller: new Map<string, Record<string, unknown>>(),
  partidas: new Map<string, Record<string, unknown>>(),
  appConfig: new Map<string, Record<string, unknown>>(),
  lecturasAppConfig: 0,
  fallaAppConfig: false,
  llamadas: [] as string[],
  argumentosList: [] as Record<string, unknown>[],
  escriturasTaller: [] as Record<string, unknown>[],
  creacionesPartida: [] as Record<string, unknown>[],
  actualizacionesPartida: [] as Record<string, unknown>[],
  firmas: [] as { tipo: string; input: Record<string, unknown>; opciones: unknown }[],
  fallas: new Set<string>(),
  listaIgnoraAlcance: false,
  tamanoPagina: 100,
}));

const ERR = [{ message: "falla simulada del backend" }];

vi.mock("@aws-amplify/backend/function/runtime", () => ({
  getAmplifyDataClientConfig: async () => ({ resourceConfig: {}, libraryOptions: {} }),
}));

vi.mock("aws-amplify", () => ({ Amplify: { configure: () => undefined } }));

vi.mock("aws-amplify/data", () => ({
  generateClient: () => ({
    models: {
      AppConfig: {
        get: async (llave: { tenantId: string }) => {
          g.llamadas.push("AppConfig.get");
          g.lecturasAppConfig += 1;
          if (g.fallaAppConfig) return { data: null, errors: ERR };
          return { data: g.appConfig.get(llave.tenantId) ?? null, errors: undefined };
        },
      },
      Taller: {
        get: async (llave: { tenantId: string; unitUid: string; fechaEntrada: string }) => {
          g.llamadas.push("Taller.get");
          if (g.fallas.has("Taller.get")) return { data: null, errors: ERR };
          const fila = g.taller.get(`${llave.tenantId}|${llave.unitUid}|${llave.fechaEntrada}`);
          return { data: fila ?? null, errors: undefined };
        },
        update: async (input: Record<string, unknown>) => {
          g.llamadas.push("Taller.update");
          g.escriturasTaller.push(input);
          if (g.fallas.has("Taller.update")) return { data: null, errors: ERR };
          const clave = `${String(input.tenantId)}|${String(input.unitUid)}|${String(
            input.fechaEntrada,
          )}`;
          const previa = g.taller.get(clave);
          if (previa) g.taller.set(clave, { ...previa, ...input });
          return { data: g.taller.get(clave) ?? null, errors: undefined };
        },
      },
      TallerPartida: {
        create: async (input: Record<string, unknown>) => {
          g.llamadas.push("TallerPartida.create");
          g.creacionesPartida.push(input);
          if (g.fallas.has("TallerPartida.create")) return { data: null, errors: ERR };
          g.partidas.set(
            `${String(input.tenantId)}|${String(input.visitaKey)}|${String(input.partidaId)}`,
            { ...input },
          );
          return { data: { ...input }, errors: undefined };
        },
        update: async (input: Record<string, unknown>) => {
          g.llamadas.push("TallerPartida.update");
          g.actualizacionesPartida.push(input);
          if (g.fallas.has("TallerPartida.update")) return { data: null, errors: ERR };
          const clave = `${String(input.tenantId)}|${String(input.visitaKey)}|${String(
            input.partidaId,
          )}`;
          const previa = g.partidas.get(clave);
          if (previa) g.partidas.set(clave, { ...previa, ...input });
          return { data: g.partidas.get(clave) ?? null, errors: undefined };
        },
        list: async (arg: Record<string, unknown>) => {
          g.llamadas.push("TallerPartida.list");
          g.argumentosList.push(arg);
          if (g.fallas.has("TallerPartida.list")) {
            return { data: null, errors: ERR, nextToken: null };
          }
          const sk = arg.visitaKeyPartidaId as { beginsWith?: { visitaKey?: string } } | undefined;
          const prefijo = sk?.beginsWith?.visitaKey ?? "";
          const delTenant = [...g.partidas.values()].filter((p) => p.tenantId === arg.tenantId);
          // El modo "ignora alcance" simula el escenario que el comentario de
          // `listarPartidasDeVisita` describe: si el `beginsWith` dejara de
          // aplicarse, la consulta degradaría a solo-hash y devolvería las
          // partidas de TODO el tenant. Sirve para probar el filtro de respaldo.
          const todas = g.listaIgnoraAlcance
            ? delTenant
            : delTenant.filter((p) => String(p.visitaKey).startsWith(prefijo));
          const desde = arg.nextToken ? Number(arg.nextToken) : 0;
          const pagina = todas.slice(desde, desde + g.tamanoPagina);
          const siguiente =
            desde + g.tamanoPagina < todas.length ? String(desde + g.tamanoPagina) : null;
          return { data: pagina, errors: undefined, nextToken: siguiente };
        },
      },
    },
  }),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    async send() {
      return {};
    }
  },
  PutObjectCommand: class {
    tipo = "PUT";
    constructor(public input: Record<string, unknown>) {}
  },
  GetObjectCommand: class {
    tipo = "GET";
    constructor(public input: Record<string, unknown>) {}
  },
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: async (
    _cliente: unknown,
    comando: { tipo: string; input: Record<string, unknown> },
    opciones: unknown,
  ) => {
    if (g.fallas.has("getSignedUrl")) throw new Error("falla simulada del presigner");
    g.firmas.push({ tipo: comando.tipo, input: comando.input, opciones });
    const i = comando.input;
    const q = new URLSearchParams({
      op: comando.tipo,
      bucket: String(i.Bucket ?? ""),
      key: String(i.Key ?? ""),
      ct: String(i.ContentType ?? ""),
      len: String(i.ContentLength ?? ""),
      exp: String((opciones as { expiresIn?: number } | undefined)?.expiresIn ?? ""),
    });
    return `https://s3.ejemplo.invalid/firmada?${q.toString()}`;
  },
}));

// ── Constantes ficticias (repo público: nada real aquí) ──────────────────────
const SECRETO = "secreto-de-prueba-vitest".padEnd(64, "0");
const SECRETO_AJENO = "otro-secreto-de-prueba-vitest".padEnd(64, "9");
const TENANT = "acme";
const TENANT_AJENO = "otroinq";
const UNIDAD = "AAA111";
const UNIDAD_AJENA = "BBB222";
const FECHA = "2026-09-01";
const FECHA_AJENA = "2026-09-02";
const VISITA_KEY = `${UNIDAD}|${FECHA}`;
const VISITA_KEY_AJENA = `${UNIDAD_AJENA}|${FECHA_AJENA}`;
const IP = "203.0.113.7";
const BUCKET = "bucket-de-prueba";
const CORREO = "riesgos@ejemplo.invalid";
const SUB = "11111111-2222-3333-4444-555555555555";

const PREFIJO = `photos/${segmento(TENANT)}/taller-partidas/${segmento(VISITA_KEY)}/`;
const LLAVE_PROPIA = `${PREFIJO}foto-uno.jpg`;
const LLAVE_OTRA_VISITA = `photos/${segmento(TENANT)}/taller-partidas/${segmento(
  VISITA_KEY_AJENA,
)}/foto-uno.jpg`;
const LLAVE_OTRO_TENANT = `photos/${segmento(TENANT_AJENO)}/taller-partidas/${segmento(
  VISITA_KEY,
)}/foto-uno.jpg`;
const LLAVE_INSPECCIONES = `photos/${segmento(TENANT)}/inspecciones/foto-uno.jpg`;
const LLAVE_TRAVESIA = `${PREFIJO}..%2Fotra%2Ffoto.jpg`.replace(/%2F/g, "/");

// Marcadores internos: si CUALQUIERA aparece en una respuesta al taller, la
// proyección de la propiedad 12 se rompió.
const MARCADORES_INTERNOS = [
  "NOTA-INTERNA-DE-RIESGOS",
  "FOLIO-INTERNO",
  "TECNICO-INTERNO",
  "REFACCIONES-INTERNAS",
  "quien.emitio@ejemplo.invalid",
  "quien.revoco@ejemplo.invalid",
  "987654",
  "111222",
  "333444",
];

type Handler = (evento: unknown) => Promise<unknown>;
type RespuestaHttp = { statusCode: number; headers: Record<string, string>; body: string };

let espiaInfo: ReturnType<typeof vi.spyOn>;
let espiaError: ReturnType<typeof vi.spyOn>;
let bitacoras: string[] = [];
let errores: string[] = [];

function limpiar() {
  g.taller.clear();
  g.partidas.clear();
  g.appConfig.clear();
  g.lecturasAppConfig = 0;
  g.fallaAppConfig = false;
  g.llamadas.length = 0;
  g.argumentosList.length = 0;
  g.escriturasTaller.length = 0;
  g.creacionesPartida.length = 0;
  g.actualizacionesPartida.length = 0;
  g.firmas.length = 0;
  g.fallas.clear();
  g.listaIgnoraAlcance = false;
  g.tamanoPagina = 100;
  // Por defecto el esquema está ENCENDIDO: cada prueba del apagador lo apaga.
  g.appConfig.set(TENANT, { tenantId: TENANT, tallerHibrido: true });
}

beforeEach(() => {
  limpiar();
  bitacoras = [];
  errores = [];
  espiaInfo = vi.spyOn(console, "info").mockImplementation((...partes: unknown[]) => {
    bitacoras.push(partes.map(String).join(" "));
  });
  espiaError = vi.spyOn(console, "error").mockImplementation((...partes: unknown[]) => {
    errores.push(partes.map(String).join(" "));
  });
});

afterEach(() => {
  espiaInfo.mockRestore();
  espiaError.mockRestore();
  vi.useRealTimers();
});

/**
 * Carga una instancia FRESCA del handler. Indispensable: `SECRETO` se evalúa al
 * cargar el módulo y el memo del apagador (`apagadorCache`) es estado de módulo
 * — sin el reset, una prueba heredaría el secreto y la memoria de la anterior.
 */
async function cargarHandler(secreto: string = SECRETO): Promise<Handler> {
  vi.resetModules();
  process.env.TALLER_PORTAL_SECRET = secreto;
  process.env.CAPTURE_BUCKET = BUCKET;
  const mod = await import("../amplify/functions/taller-portal/handler");
  return mod.handler as unknown as Handler;
}

function acunar(sobre: Partial<PortalToken> = {}, secreto: string = SECRETO): string {
  return firmarToken(
    { t: TENANT, u: UNIDAD, f: FECHA, v: 1, exp: Date.now() + 3_600_000, ...sobre },
    secreto,
  );
}

function eventoHttp(opciones: {
  ruta?: string;
  metodo?: string;
  token?: string;
  query?: Record<string, string>;
  body?: unknown;
}) {
  const { ruta = "/", metodo = "GET", token, query, body } = opciones;
  return {
    rawPath: ruta,
    requestContext: { http: { method: metodo, sourceIp: IP } },
    queryStringParameters: { ...(token === undefined ? {} : { t: token }), ...(query ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function eventoResolver(
  campo: "generarLigaTaller" | "revocarLigaTaller",
  opciones: {
    grupos?: string[];
    correo?: string | null;
    sub?: string | null;
    tenantClaim?: string;
    sinIdentidad?: boolean;
    argumentos?: Record<string, unknown>;
  } = {},
) {
  const {
    grupos = ["admin", TENANT],
    correo = CORREO,
    sub = SUB,
    tenantClaim,
    sinIdentidad = false,
    argumentos = { unitUid: UNIDAD, fechaEntrada: FECHA },
  } = opciones;
  const claims: Record<string, unknown> = { "cognito:groups": grupos };
  if (correo !== null) claims.email = correo;
  if (tenantClaim !== undefined) claims["custom:tenantId"] = tenantClaim;
  const base: Record<string, unknown> = { info: { fieldName: campo }, arguments: argumentos };
  if (!sinIdentidad) base.identity = { ...(sub === null ? {} : { sub }), claims };
  return base;
}

function http(r: unknown): RespuestaHttp {
  return r as RespuestaHttp;
}
function cuerpo(r: unknown): Record<string, unknown> {
  return JSON.parse(http(r).body) as Record<string, unknown>;
}
function resolver(r: unknown): Record<string, unknown> {
  return r as Record<string, unknown>;
}
function primero<T>(a: T[]): T {
  const x = a[0];
  if (x === undefined) throw new Error("se esperaba al menos un elemento");
  return x;
}

function sembrarVisita(extra: Fila = {}, datosExtra: Fila = {}) {
  const fila: Fila = {
    tenantId: TENANT,
    unitUid: UNIDAD,
    fechaEntrada: FECHA,
    estatus: "abierto",
    ligaVersion: 1,
    km: 85000,
    fsalidaEst: "2026-09-20",
    fsalidaEstCompromiso: null,
    estadoOperativo: "revisando",
    // Columnas internas que el taller JAMÁS debe ver (propiedad 12).
    ligaCreadaPor: "quien.emitio@ejemplo.invalid",
    ligaRevocadaPor: "quien.revoco@ejemplo.invalid",
    folio: "FOLIO-INTERNO",
    datos: JSON.stringify({
      eco: "E-01",
      brand: "Submarca X",
      sucursal: "Sucursal Y",
      area: "Area Z",
      tipo: "Correctivo",
      estado: "En Reparación",
      // …y el blob interno completo.
      gasto: 987654,
      gastoRef: 111222,
      gastoMO: 333444,
      comentario: "NOTA-INTERNA-DE-RIESGOS",
      folio: "FOLIO-INTERNO",
      tecnico: "TECNICO-INTERNO",
      refacciones: "REFACCIONES-INTERNAS",
      ...datosExtra,
    }),
    ...extra,
  };
  g.taller.set(`${TENANT}|${UNIDAD}|${FECHA}`, fila);
  return fila;
}

function sembrarPartida(sobre: Fila = {}) {
  const id = String(sobre.partidaId ?? `partida-${g.partidas.size + 1}`);
  const p: Fila = {
    tenantId: TENANT,
    visitaKey: VISITA_KEY,
    descripcion: "Balatas delanteras",
    tipo: "refaccion",
    precio: 1850,
    estado: "borrador",
    fotos: [],
    version: 1,
    ...sobre,
    partidaId: id,
  };
  g.partidas.set(`${String(p.tenantId)}|${String(p.visitaKey)}|${id}`, p);
  return p;
}

/** Las siete rutas públicas, cada una con un cuerpo/query que pasaría sus
 *  propias validaciones — para que lo único que las tumbe sea el PORTÓN. */
const RUTAS_PUBLICAS: Array<{
  nombre: string;
  ruta: string;
  metodo: string;
  query?: Record<string, string>;
  body?: unknown;
  html?: boolean;
}> = [
  { nombre: "GET /", ruta: "/", metodo: "GET", html: true },
  { nombre: "GET /api/visita", ruta: "/api/visita", metodo: "GET" },
  { nombre: "GET /api/foto", ruta: "/api/foto", metodo: "GET", query: { key: LLAVE_PROPIA } },
  {
    nombre: "POST /api/partida",
    ruta: "/api/partida",
    metodo: "POST",
    body: { descripcion: "Balatas", tipo: "refaccion", precio: 100 },
  },
  { nombre: "POST /api/enviar", ruta: "/api/enviar", metodo: "POST" },
  { nombre: "POST /api/visita", ruta: "/api/visita", metodo: "POST", body: { km: 90000 } },
  {
    nombre: "POST /api/subida",
    ruta: "/api/subida",
    metodo: "POST",
    body: { mime: "image/jpeg", tamano: 1024 },
  },
];

const CUERPO_OPACO = JSON.stringify({ error: "liga no válida" });

// ════════════════════════════════════════════════════════════════════════════
// P1 — sin secreto utilizable, todo está cerrado
// ════════════════════════════════════════════════════════════════════════════
describe("P1 — secreto ausente o corto: todo el perímetro responde 401", () => {
  for (const secreto of ["", "x", "x".repeat(31)]) {
    const etiqueta = secreto === "" ? "ausente" : `de ${secreto.length} caracteres`;
    it(`secreto ${etiqueta}: las 7 rutas públicas responden 401 aun con un token bien firmado`, async () => {
      const handler = await cargarHandler(secreto);
      sembrarVisita();
      // El token se firma con el secreto BUENO: el 401 tiene que venir de que el
      // Lambda no tiene secreto utilizable, no de una firma mala.
      const token = acunar();
      for (const r of RUTAS_PUBLICAS) {
        const res = http(
          await handler(
            eventoHttp({ ruta: r.ruta, metodo: r.metodo, token, query: r.query, body: r.body }),
          ),
        );
        expect(res.statusCode, r.nombre).toBe(401);
      }
      // Y jamás se tocó la base: ni el apagador ni la fila.
      expect(g.llamadas).toEqual([]);
    });
  }

  it("el resolver responde 'portal no configurado' y NO acuña nada", async () => {
    const handler = await cargarHandler("");
    sembrarVisita();
    const generar = resolver(await handler(eventoResolver("generarLigaTaller")));
    const revocar = resolver(await handler(eventoResolver("revocarLigaTaller")));
    expect(generar).toEqual({ error: "portal no configurado" });
    expect(revocar).toEqual({ error: "portal no configurado" });
    expect(generar.token).toBeUndefined();
    expect(g.escriturasTaller).toEqual([]);
    expect(g.llamadas).toEqual([]);
  });

  it("con secreto corto la página también responde 401 en HTML, no la página del portal", async () => {
    const handler = await cargarHandler("x".repeat(31));
    sembrarVisita();
    const res = http(await handler(eventoHttp({ ruta: "/", metodo: "GET", token: acunar() })));
    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Esta liga ya no sirve");
    expect(res.body).not.toContain("pt-token");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// P2/P3/P4/P5/P6 — el 401 es SIEMPRE el mismo cuerpo: opacidad
// ════════════════════════════════════════════════════════════════════════════
describe("P2 — token forjado, manipulado o firmado con otro secreto: 401 opaco", () => {
  const casos: Array<[string, () => string]> = [
    ["cadena basura", () => "esto-no-es-un-token"],
    ["token vacío", () => ""],
    ["solo el cuerpo, sin firma", () => primero(acunar().split("."))],
    ["firmado con otro secreto", () => acunar({}, SECRETO_AJENO)],
    [
      "cuerpo manipulado (otra unidad) con la firma original",
      () => {
        const bueno = acunar();
        const partes = bueno.split(".");
        const falso = Buffer.from(
          JSON.stringify({ t: TENANT, u: UNIDAD_AJENA, f: FECHA, v: 1, exp: Date.now() + 1e6 }),
          "utf8",
        ).toString("base64url");
        return `${falso}.${partes[1]}`;
      },
    ],
    [
      "alcance `p` (Plan 2) firmado con el secreto bueno",
      () => acunar({ p: "partida-1" } as Partial<PortalToken>),
    ],
  ];

  for (const [nombre, hacer] of casos) {
    it(`${nombre} ⇒ 401 con cuerpo exactamente opaco`, async () => {
      const handler = await cargarHandler();
      sembrarVisita();
      const res = http(
        await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token: hacer() })),
      );
      expect(res.statusCode).toBe(401);
      expect(res.body).toBe(CUERPO_OPACO);
      // Ni el apagador ni la fila se leyeron: el rechazo es anterior.
      expect(g.llamadas).toEqual([]);
    });
  }

  it("el motivo real vive en la bitácora, nunca en la respuesta", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    await handler(
      eventoHttp({ ruta: "/api/visita", metodo: "GET", token: acunar({}, SECRETO_AJENO) }),
    );
    const linea = bitacoras.map((l) => JSON.parse(l) as Fila).find((l) => l.accion === "rechazado");
    expect(linea?.motivo).toBe("firma-invalida");
  });
});

describe("P3 — token vencido: 401 opaco", () => {
  it("un exp en el pasado no abre ninguna ruta", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const vencido = acunar({ exp: Date.now() - 1 });
    for (const r of RUTAS_PUBLICAS.filter((x) => !x.html)) {
      const res = http(
        await handler(
          eventoHttp({
            ruta: r.ruta,
            metodo: r.metodo,
            token: vencido,
            query: r.query,
            body: r.body,
          }),
        ),
      );
      expect(res.statusCode, r.nombre).toBe(401);
      expect(res.body, r.nombre).toBe(CUERPO_OPACO);
    }
    expect(g.llamadas).toEqual([]);
  });
});

describe("P4 — liga revocada (ligaVersion de la fila ≠ v del token): 401 opaco", () => {
  it("un token v1 contra una fila ya en v2 no lee, no escribe, no firma nada", async () => {
    const handler = await cargarHandler();
    sembrarVisita({ ligaVersion: 2 });
    const token = acunar({ v: 1 });
    for (const r of RUTAS_PUBLICAS.filter((x) => !x.html)) {
      const res = http(
        await handler(
          eventoHttp({ ruta: r.ruta, metodo: r.metodo, token, query: r.query, body: r.body }),
        ),
      );
      expect(res.statusCode, r.nombre).toBe(401);
      expect(res.body, r.nombre).toBe(CUERPO_OPACO);
    }
    expect(g.creacionesPartida).toEqual([]);
    expect(g.escriturasTaller).toEqual([]);
    expect(g.firmas).toEqual([]);
  });

  it("una columna ligaVersion AUSENTE se trata como v1 (la liga v1 sí entra)", async () => {
    const handler = await cargarHandler();
    sembrarVisita({ ligaVersion: undefined });
    const res = http(
      await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token: acunar({ v: 1 }) })),
    );
    expect(res.statusCode).toBe(200);
  });

  it("revocar NUNCA necesita el token: sube la columna y con eso basta", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const emitido = resolver(await handler(eventoResolver("generarLigaTaller")));
    const token = String(emitido.token);
    expect(token.length).toBeGreaterThan(20);
    // Nada de lo que se escribió en la fila contiene el token ni parte de él.
    const escrito = JSON.stringify(g.escriturasTaller);
    expect(escrito).not.toContain(token);
    expect(escrito).not.toContain(token.slice(0, 24));
    // Se revoca sin pasarle el token a nadie…
    const revocado = resolver(await handler(eventoResolver("revocarLigaTaller")));
    expect(revocado).toEqual({ ligaVersion: 2 });
    // …y el token emitido deja de servir.
    const res = http(await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token })));
    expect(res.statusCode).toBe(401);
    expect(res.body).toBe(CUERPO_OPACO);
  });
});

describe("P5 — visita cerrada: 401 opaco en toda ruta, y no se acuña liga nueva", () => {
  const cerradas: Array<[string, Fila, Fila]> = [
    ["por la columna estatus", { estatus: "cerrado" }, {}],
    ["por datos.estado = Finalizado", { estatus: "abierto" }, { estado: "Finalizado" }],
  ];

  for (const [nombre, extra, datosExtra] of cerradas) {
    it(`${nombre}: las rutas JSON responden 401 opaco`, async () => {
      const handler = await cargarHandler();
      sembrarVisita(extra, datosExtra);
      const token = acunar();
      for (const r of RUTAS_PUBLICAS.filter((x) => !x.html)) {
        const res = http(
          await handler(
            eventoHttp({ ruta: r.ruta, metodo: r.metodo, token, query: r.query, body: r.body }),
          ),
        );
        expect(res.statusCode, r.nombre).toBe(401);
        expect(res.body, r.nombre).toBe(CUERPO_OPACO);
      }
      expect(g.creacionesPartida).toEqual([]);
      expect(g.firmas).toEqual([]);
    });

    it(`${nombre}: la PÁGINA responde 401 en HTML con la página de liga inválida`, async () => {
      const handler = await cargarHandler();
      sembrarVisita(extra, datosExtra);
      const res = http(await handler(eventoHttp({ ruta: "/", metodo: "GET", token: acunar() })));
      expect(res.statusCode).toBe(401);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.body).toContain("Esta liga ya no sirve");
    });

    it(`${nombre}: emitirLiga se niega a acuñar`, async () => {
      const handler = await cargarHandler();
      sembrarVisita(extra, datosExtra);
      const r = resolver(await handler(eventoResolver("generarLigaTaller")));
      expect(r).toEqual({ error: "La visita está finalizada" });
      expect(r.token).toBeUndefined();
      expect(g.escriturasTaller).toEqual([]);
    });
  }

  it("una visita que no existe también da 401 opaco (misma clase de fallo)", async () => {
    const handler = await cargarHandler();
    // sin sembrar
    const res = http(
      await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token: acunar() })),
    );
    expect(res.statusCode).toBe(401);
    expect(res.body).toBe(CUERPO_OPACO);
  });
});

describe("P2-P6 (opacidad transversal) — los seis motivos son INDISTINGUIBLES afuera", () => {
  it("firma mala, vencido, revocado, cerrado, apagado y visita ausente dan respuestas byte-idénticas", async () => {
    const respuestas: RespuestaHttp[] = [];
    const recoger = async (preparar: () => Promise<{ handler: Handler; token: string }>) => {
      limpiar();
      const { handler, token } = await preparar();
      respuestas.push(
        http(await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token }))),
      );
    };

    await recoger(async () => {
      const handler = await cargarHandler();
      sembrarVisita();
      return { handler, token: acunar({}, SECRETO_AJENO) };
    });
    await recoger(async () => {
      const handler = await cargarHandler();
      sembrarVisita();
      return { handler, token: acunar({ exp: Date.now() - 1 }) };
    });
    await recoger(async () => {
      const handler = await cargarHandler();
      sembrarVisita({ ligaVersion: 9 });
      return { handler, token: acunar({ v: 1 }) };
    });
    await recoger(async () => {
      const handler = await cargarHandler();
      sembrarVisita({ estatus: "cerrado" });
      return { handler, token: acunar() };
    });
    await recoger(async () => {
      const handler = await cargarHandler();
      sembrarVisita();
      g.appConfig.set(TENANT, { tenantId: TENANT, tallerHibrido: false });
      return { handler, token: acunar() };
    });
    await recoger(async () => {
      const handler = await cargarHandler();
      return { handler, token: acunar() };
    });
    await recoger(async () => {
      const handler = await cargarHandler("");
      sembrarVisita();
      return { handler, token: acunar() };
    });

    const base = primero(respuestas);
    for (const r of respuestas) {
      expect(r.statusCode).toBe(base.statusCode);
      expect(r.body).toBe(base.body);
      expect(r.headers).toEqual(base.headers);
    }
    expect(base.statusCode).toBe(401);
    expect(base.body).toBe(CUERPO_OPACO);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// P6 — el apagador
// ════════════════════════════════════════════════════════════════════════════
describe("P6 — el apagador AppConfig.tallerHibrido (R90/R96)", () => {
  it("apagado ⇒ 401 opaco en las 7 rutas públicas", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    g.appConfig.set(TENANT, { tenantId: TENANT, tallerHibrido: false });
    const token = acunar();
    for (const r of RUTAS_PUBLICAS) {
      const res = http(
        await handler(
          eventoHttp({ ruta: r.ruta, metodo: r.metodo, token, query: r.query, body: r.body }),
        ),
      );
      expect(res.statusCode, r.nombre).toBe(401);
      if (!r.html) expect(res.body, r.nombre).toBe(CUERPO_OPACO);
    }
  });

  it("una fila de AppConfig AUSENTE también cierra (fail-closed, no 'a falta de dato, abre')", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    g.appConfig.clear();
    const res = http(
      await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token: acunar() })),
    );
    expect(res.statusCode).toBe(401);
  });

  it("apagado ⇒ el resolver se niega a EMITIR", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    g.appConfig.set(TENANT, { tenantId: TENANT, tallerHibrido: false });
    const r = resolver(await handler(eventoResolver("generarLigaTaller")));
    expect(r).toEqual({ error: "esquema apagado" });
    expect(r.token).toBeUndefined();
    expect(g.escriturasTaller).toEqual([]);
  });

  it("R96 — con el apagador puesto, REVOCAR sigue funcionando (y ni consulta el apagador)", async () => {
    const handler = await cargarHandler();
    sembrarVisita({ ligaVersion: 3 });
    g.appConfig.set(TENANT, { tenantId: TENANT, tallerHibrido: false });
    const r = resolver(await handler(eventoResolver("revocarLigaTaller")));
    expect(r).toEqual({ ligaVersion: 4 });
    expect(g.lecturasAppConfig).toBe(0);
    expect(primero(g.escriturasTaller).ligaVersion).toBe(4);
  });

  it("la lectura se memoiza: dos requests seguidos = UNA sola lectura de AppConfig", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const token = acunar();
    await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token }));
    expect(g.lecturasAppConfig).toBe(1);
    await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token }));
    expect(g.lecturasAppConfig).toBe(1);
  });

  it("pasado el TTL (~60 s) se vuelve a leer, así que apagar surte efecto sin redeploy", async () => {
    const base = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(base);
    const handler = await cargarHandler();
    sembrarVisita();
    const token = acunar({ exp: base + 3_600_000 });

    expect(
      http(await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token }))).statusCode,
    ).toBe(200);
    expect(g.lecturasAppConfig).toBe(1);

    // Alguien apaga el esquema en la consola…
    g.appConfig.set(TENANT, { tenantId: TENANT, tallerHibrido: false });
    // …pero dentro del TTL el contenedor caliente sigue con el valor memoizado.
    vi.setSystemTime(base + 30_000);
    expect(
      http(await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token }))).statusCode,
    ).toBe(200);
    expect(g.lecturasAppConfig).toBe(1);

    // Pasado el minuto, se relee y la puerta se cierra.
    vi.setSystemTime(base + 61_000);
    const res = http(await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token })));
    expect(res.statusCode).toBe(401);
    expect(res.body).toBe(CUERPO_OPACO);
    expect(g.lecturasAppConfig).toBe(2);
  });

  it("una lectura FALLIDA cierra la puerta y NO se memoiza: el siguiente request relee", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    g.fallaAppConfig = true;
    const token = acunar();

    expect(
      http(await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token }))).statusCode,
    ).toBe(401);
    expect(g.lecturasAppConfig).toBe(1);
    expect(
      http(await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token }))).statusCode,
    ).toBe(401);
    expect(g.lecturasAppConfig).toBe(2);

    // Y en cuanto el backend se recupera, la puerta vuelve a abrir sin esperar TTL.
    g.fallaAppConfig = false;
    expect(
      http(await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token }))).statusCode,
    ).toBe(200);
    expect(g.lecturasAppConfig).toBe(3);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// P7 — el orden de las lecturas
// ════════════════════════════════════════════════════════════════════════════
describe("P7 — el apagador se lee ANTES que la fila de la visita", () => {
  it("con el esquema apagado, Taller.get NUNCA se llama", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    g.appConfig.set(TENANT, { tenantId: TENANT, tallerHibrido: false });
    await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token: acunar() }));
    expect(g.llamadas).toEqual(["AppConfig.get"]);
    expect(g.llamadas).not.toContain("Taller.get");
  });

  it("con el esquema encendido, el orden es AppConfig.get y DESPUÉS Taller.get", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token: acunar() }));
    expect(g.llamadas.indexOf("AppConfig.get")).toBe(0);
    expect(g.llamadas.indexOf("Taller.get")).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// P8 — lectura de fotos
// ════════════════════════════════════════════════════════════════════════════
describe("P8 — GET /api/foto solo sirve llaves del prefijo de ESTA visita", () => {
  const fuera: Array<[string, string]> = [
    ["de otra visita del mismo tenant", LLAVE_OTRA_VISITA],
    ["de otro tenant", LLAVE_OTRO_TENANT],
    ["de otro módulo (inspecciones)", LLAVE_INSPECCIONES],
    ["con travesía ..", LLAVE_TRAVESIA],
    ["con una segunda barra en la cola", `${PREFIJO}sub/foto.jpg`],
    ["con extensión no permitida", `${PREFIJO}payload.html`],
    ["vacía", ""],
  ];

  for (const [nombre, key] of fuera) {
    it(`llave ${nombre} ⇒ rechazada y NADA se firma`, async () => {
      const handler = await cargarHandler();
      sembrarVisita();
      const res = http(
        await handler(
          eventoHttp({ ruta: "/api/foto", metodo: "GET", token: acunar(), query: { key } }),
        ),
      );
      expect(res.statusCode).toBe(400);
      expect(cuerpo(res)).toEqual({ error: "llave de foto no válida" });
      expect(g.firmas).toEqual([]);
    });
  }

  it("una llave EN alcance se firma como GET con exactamente esa llave y ese bucket", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const res = http(
      await handler(
        eventoHttp({
          ruta: "/api/foto",
          metodo: "GET",
          token: acunar(),
          query: { key: LLAVE_PROPIA },
        }),
      ),
    );
    expect(res.statusCode).toBe(200);
    const url = new URL(String(cuerpo(res).url));
    expect(url.searchParams.get("op")).toBe("GET");
    expect(url.searchParams.get("bucket")).toBe(BUCKET);
    expect(url.searchParams.get("key")).toBe(LLAVE_PROPIA);
    // La respuesta es solo la URL: ni la llave ni la fila viajan de vuelta.
    expect(Object.keys(cuerpo(res))).toEqual(["url"]);
    // Y la firma es de minutos, no de horas.
    expect(primero(g.firmas).opciones).toEqual({ expiresIn: 300 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// P9 — firma de subida
// ════════════════════════════════════════════════════════════════════════════
describe("P9 — POST /api/subida: la llave la elige el SERVIDOR, con MIME y tope", () => {
  it("firma un PUT bajo el prefijo de esta visita, con el ContentType permitido", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const res = http(
      await handler(
        eventoHttp({
          ruta: "/api/subida",
          metodo: "POST",
          token: acunar(),
          body: { mime: "image/png", tamano: 2048 },
        }),
      ),
    );
    expect(res.statusCode).toBe(200);
    const datos = cuerpo(res);
    expect(Object.keys(datos).sort()).toEqual(["key", "url"]);
    const key = String(datos.key);
    expect(key.startsWith(PREFIJO)).toBe(true);
    expect(key.endsWith(".png")).toBe(true);
    const url = new URL(String(datos.url));
    expect(url.searchParams.get("op")).toBe("PUT");
    expect(url.searchParams.get("bucket")).toBe(BUCKET);
    expect(url.searchParams.get("key")).toBe(key);
    expect(url.searchParams.get("ct")).toBe("image/png");
    // ContentLength EXACTO: es lo que hace real el tope del lado de S3.
    expect(url.searchParams.get("len")).toBe("2048");
    expect(url.searchParams.get("exp")).toBe("300");
  });

  it("la llave la genera el servidor: el cliente NO puede elegir ruta", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const res = http(
      await handler(
        eventoHttp({
          ruta: "/api/subida",
          metodo: "POST",
          token: acunar(),
          body: {
            mime: "image/jpeg",
            tamano: 10,
            key: "photos/otro/evil.jpg",
            Key: "photos/otro/evil.jpg",
          },
        }),
      ),
    );
    expect(String(cuerpo(res).key).startsWith(PREFIJO)).toBe(true);
    expect(String(primero(g.firmas).input.Key).startsWith(PREFIJO)).toBe(true);
  });

  for (const mime of ["application/pdf", "text/html", "image/svg+xml", "", "image/JPEG"]) {
    it(`mime "${mime}" ⇒ 400 y nada se firma`, async () => {
      const handler = await cargarHandler();
      sembrarVisita();
      const res = http(
        await handler(
          eventoHttp({
            ruta: "/api/subida",
            metodo: "POST",
            token: acunar(),
            body: { mime, tamano: 10 },
          }),
        ),
      );
      expect(res.statusCode).toBe(400);
      expect(cuerpo(res)).toEqual({ error: "tipo de archivo no permitido" });
      expect(g.firmas).toEqual([]);
    });
  }

  const tamanosMalos: Array<[string, unknown]> = [
    ["por encima del tope de 10 MB", TOPE_BYTES_FOTO + 1],
    ["cero", 0],
    ["negativo", -1],
    ["decimal", 1.5],
    ["string numérico", "1024"],
    ["ausente", undefined],
  ];
  for (const [nombre, tamano] of tamanosMalos) {
    it(`tamaño ${nombre} ⇒ 400 ANTES de firmar`, async () => {
      const handler = await cargarHandler();
      sembrarVisita();
      const res = http(
        await handler(
          eventoHttp({
            ruta: "/api/subida",
            metodo: "POST",
            token: acunar(),
            body: { mime: "image/jpeg", tamano },
          }),
        ),
      );
      expect(res.statusCode).toBe(400);
      expect(g.firmas).toEqual([]);
    });
  }

  it("exactamente 10 MB sí pasa (el tope es inclusivo)", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const res = http(
      await handler(
        eventoHttp({
          ruta: "/api/subida",
          metodo: "POST",
          token: acunar(),
          body: { mime: "image/jpeg", tamano: TOPE_BYTES_FOTO },
        }),
      ),
    );
    expect(res.statusCode).toBe(200);
    expect(primero(g.firmas).input.ContentLength).toBe(TOPE_BYTES_FOTO);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// P10 — creación de partidas
// ════════════════════════════════════════════════════════════════════════════
describe("P10 — POST /api/partida: el estado y la autoría los pone el servidor", () => {
  const buena = { descripcion: "Balatas delanteras", tipo: "refaccion", precio: 1850 };

  it("escribe estado borrador, creadoPor liga:…, version 1 y un partidaId UUID", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const res = http(
      await handler(
        eventoHttp({ ruta: "/api/partida", metodo: "POST", token: acunar(), body: buena }),
      ),
    );
    expect(res.statusCode).toBe(200);
    const escrito = primero(g.creacionesPartida);
    expect(escrito.estado).toBe("borrador");
    expect(escrito.creadoPor).toBe(`liga:${UNIDAD}|${FECHA}`);
    expect(escrito.version).toBe(1);
    expect(escrito.tenantId).toBe(TENANT);
    expect(escrito.visitaKey).toBe(VISITA_KEY);
    expect(String(escrito.partidaId)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("un cliente NO puede mandar su partida ya autorizada ni con otra autoría", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    await handler(
      eventoHttp({
        ruta: "/api/partida",
        metodo: "POST",
        token: acunar(),
        body: {
          ...buena,
          estado: "autorizada",
          precioAutorizado: 999999,
          creadoPor: "el-taller-malicioso",
          version: 42,
          tenantId: TENANT_AJENO,
          visitaKey: VISITA_KEY_AJENA,
          autorizadoPor: "nadie",
        },
      }),
    );
    const escrito = primero(g.creacionesPartida);
    expect(escrito.estado).toBe("borrador");
    expect(escrito.creadoPor).toBe(`liga:${UNIDAD}|${FECHA}`);
    expect(escrito.version).toBe(1);
    expect(escrito.tenantId).toBe(TENANT);
    expect(escrito.visitaKey).toBe(VISITA_KEY);
    expect(escrito.precioAutorizado).toBeUndefined();
    expect(escrito.autorizadoPor).toBeUndefined();
  });

  it("la respuesta es EXACTAMENTE { partidaId, fotos } — nunca la fila", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const res = http(
      await handler(
        eventoHttp({
          ruta: "/api/partida",
          metodo: "POST",
          token: acunar(),
          body: { ...buena, fotos: [LLAVE_PROPIA] },
        }),
      ),
    );
    const datos = cuerpo(res);
    expect(Object.keys(datos).sort()).toEqual(["fotos", "partidaId"]);
    expect(datos.fotos).toEqual([LLAVE_PROPIA]);
  });

  const preciosMalos: Array<[string, unknown]> = [
    ["negativo", -1],
    ["sobre PRECIO_MAX", PRECIO_MAX + 1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["string numérico", "1850"],
    ["ausente", undefined],
    ["booleano", true],
  ];
  for (const [nombre, precio] of preciosMalos) {
    it(`precio ${nombre} ⇒ 400 y NADA se escribe`, async () => {
      const handler = await cargarHandler();
      sembrarVisita();
      const res = http(
        await handler(
          eventoHttp({
            ruta: "/api/partida",
            metodo: "POST",
            token: acunar(),
            body: { ...buena, precio },
          }),
        ),
      );
      expect(res.statusCode).toBe(400);
      expect(g.creacionesPartida).toEqual([]);
    });
  }

  it("tipo fuera del enum y descripción vacía ⇒ 400", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    for (const body of [
      { ...buena, tipo: "otro" },
      { ...buena, descripcion: "   " },
    ]) {
      const res = http(
        await handler(eventoHttp({ ruta: "/api/partida", metodo: "POST", token: acunar(), body })),
      );
      expect(res.statusCode).toBe(400);
    }
    expect(g.creacionesPartida).toEqual([]);
  });

  it("una descripción larguísima NO se rechaza: se RECORTA a LARGO_DESCRIPCION", async () => {
    // Comportamiento real de `validarPartidaEntrante` (slice, no throw). Se
    // documenta ejecutándolo: el canal queda acotado igual, que es la propiedad
    // que importa (no se pueden empujar kilobytes por aquí).
    const handler = await cargarHandler();
    sembrarVisita();
    const res = http(
      await handler(
        eventoHttp({
          ruta: "/api/partida",
          metodo: "POST",
          token: acunar(),
          body: { ...buena, descripcion: "a".repeat(5000) },
        }),
      ),
    );
    expect(res.statusCode).toBe(200);
    expect(String(primero(g.creacionesPartida).descripcion).length).toBe(LARGO_DESCRIPCION);
  });

  for (const [nombre, key] of [
    ["de otra visita", LLAVE_OTRA_VISITA],
    ["de otro tenant", LLAVE_OTRO_TENANT],
    ["con travesía", LLAVE_TRAVESIA],
  ] as Array<[string, string]>) {
    it(`una llave de foto ${nombre} ⇒ 400 y la partida NO se crea`, async () => {
      const handler = await cargarHandler();
      sembrarVisita();
      const res = http(
        await handler(
          eventoHttp({
            ruta: "/api/partida",
            metodo: "POST",
            token: acunar(),
            body: { ...buena, fotos: [LLAVE_PROPIA, key] },
          }),
        ),
      );
      expect(res.statusCode).toBe(400);
      expect(cuerpo(res)).toEqual({ error: "llave de foto no válida" });
      expect(g.creacionesPartida).toEqual([]);
    });
  }

  it(`más de ${TOPE_FOTOS_PARTIDA} fotos por hallazgo ⇒ 400`, async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const fotos = Array.from(
      { length: TOPE_FOTOS_PARTIDA + 1 },
      (_, i) => `${PREFIJO}foto-${i}.jpg`,
    );
    const res = http(
      await handler(
        eventoHttp({
          ruta: "/api/partida",
          metodo: "POST",
          token: acunar(),
          body: { ...buena, fotos },
        }),
      ),
    );
    expect(res.statusCode).toBe(400);
    expect(g.creacionesPartida).toEqual([]);
  });

  it(`el tope de ${TOPE_PARTIDAS_VISITA} partidas por visita se cuenta sobre la visita COMPLETA, aunque la lista venga paginada`, async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    for (let i = 0; i < TOPE_PARTIDAS_VISITA; i++) sembrarPartida({ partidaId: `p-${i}` });
    // DynamoDB devuelve páginas cortas legítimamente: el conteo debe seguir
    // nextToken hasta agotarlas, no quedarse con la primera.
    g.tamanoPagina = 7;
    const res = http(
      await handler(
        eventoHttp({ ruta: "/api/partida", metodo: "POST", token: acunar(), body: buena }),
      ),
    );
    expect(res.statusCode).toBe(400);
    expect(String(cuerpo(res).error)).toContain(String(TOPE_PARTIDAS_VISITA));
    expect(g.creacionesPartida).toEqual([]);
    expect(g.llamadas.filter((l) => l === "TallerPartida.list").length).toBeGreaterThan(1);
  });

  it("las partidas canceladas NO cuentan para el tope", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    for (let i = 0; i < TOPE_PARTIDAS_VISITA; i++) {
      sembrarPartida({ partidaId: `p-${i}`, estado: "cancelada" });
    }
    const res = http(
      await handler(
        eventoHttp({ ruta: "/api/partida", metodo: "POST", token: acunar(), body: buena }),
      ),
    );
    expect(res.statusCode).toBe(200);
  });

  it("un cuerpo JSON malformado es un 400 de ENTRADA, no un 500", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const res = http(
      await handler({
        rawPath: "/api/partida",
        requestContext: { http: { method: "POST", sourceIp: IP } },
        queryStringParameters: { t: acunar() },
        body: "{esto no es json",
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(cuerpo(res)).toEqual({ error: "cuerpo JSON inválido" });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// P11 — POST /api/visita
// ════════════════════════════════════════════════════════════════════════════
describe("P11 — POST /api/visita responde un acuse, y km pasa por UN solo predicado", () => {
  it("la respuesta es EXACTAMENTE { ok: true } — jamás la fila de Taller", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const res = http(
      await handler(
        eventoHttp({ ruta: "/api/visita", metodo: "POST", token: acunar(), body: { km: 90000 } }),
      ),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(JSON.stringify({ ok: true }));
    for (const marcador of MARCADORES_INTERNOS) expect(res.body).not.toContain(marcador);
  });

  const kmMalos: Array<[string, unknown]> = [
    ["true (el bug exacto de Number(true) === 1)", true],
    ["false", false],
    ["NaN", Number.NaN],
    ["cero", 0],
    ["negativo", -5],
    ["decimal", 85000.5],
    ["string decimal", "85000.5"],
    ["string vacío", ""],
    ["sobre el tope", 3_000_001],
    ["objeto", {}],
    ["arreglo", []],
  ];
  for (const [nombre, km] of kmMalos) {
    it(`km ${nombre} ⇒ 400 y Taller.update NO se llama`, async () => {
      const handler = await cargarHandler();
      sembrarVisita();
      const res = http(
        await handler(
          eventoHttp({ ruta: "/api/visita", metodo: "POST", token: acunar(), body: { km } }),
        ),
      );
      expect(res.statusCode).toBe(400);
      expect(cuerpo(res)).toEqual({ error: "Kilometraje no válido" });
      expect(g.escriturasTaller).toEqual([]);
    });
  }

  it("un entero en rango sí se escribe, convertido a número", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const res = http(
      await handler(
        eventoHttp({ ruta: "/api/visita", metodo: "POST", token: acunar(), body: { km: "90000" } }),
      ),
    );
    expect(res.statusCode).toBe(200);
    expect(primero(g.escriturasTaller).km).toBe(90000);
  });

  it("el body NO puede tocar ligaVersion ni el rastro de auditoría de la liga", async () => {
    const handler = await cargarHandler();
    sembrarVisita({ ligaVersion: 1 });
    await handler(
      eventoHttp({
        ruta: "/api/visita",
        metodo: "POST",
        token: acunar(),
        body: {
          km: 90000,
          ligaVersion: 99,
          ligaCreadaPor: "el-taller",
          ligaRevocadaEn: null,
          estatus: "cerrado",
          datos: "{}",
          gasto: 1,
        },
      }),
    );
    const escrito = primero(g.escriturasTaller);
    expect(Object.keys(escrito).sort()).toEqual(["fechaEntrada", "km", "tenantId", "unitUid"]);
  });

  it("estadoOperativo fuera del enum ⇒ 400; dentro del enum ⇒ se escribe", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const malo = http(
      await handler(
        eventoHttp({
          ruta: "/api/visita",
          metodo: "POST",
          token: acunar(),
          body: { estadoOperativo: "loQueSea" },
        }),
      ),
    );
    expect(malo.statusCode).toBe(400);
    const bueno = http(
      await handler(
        eventoHttp({
          ruta: "/api/visita",
          metodo: "POST",
          token: acunar(),
          body: { estadoOperativo: "lista" },
        }),
      ),
    );
    expect(bueno.statusCode).toBe(200);
    expect(primero(g.escriturasTaller).estadoOperativo).toBe("lista");
  });

  // ── DEFECTO encontrado al EJECUTAR (no se arregla aquí: decide el controller) ──
  // `parseBody` se documenta a sí mismo como "JSON.parse defensivo: un cuerpo
  // malformado es un error de ENTRADA, no un 500" (handler.ts:159-167). Pero
  // `JSON.parse("null")` devuelve `null`, que el tipo de retorno
  // `Record<string, unknown>` afirma en falso, y `actualizarVisita` lo destripa
  // con `body.km !== undefined` (handler.ts:758) ⇒ TypeError ⇒ el catch general
  // responde 500 y escribe una línea de `console.error`.
  //
  // Alcance real: NO hay fuga (el cuerpo es el genérico "error interno") ni
  // escritura, y el portón ya se cruzó, así que hace falta una liga VIGENTE para
  // llegar aquí. Lo que sí da es un 500 y ruido de alarma en CloudWatch a
  // voluntad del taller. Las rutas vecinas sobreviven al mismo cuerpo porque
  // usan `body?.mime` (/api/subida) o `(body ?? {})` (/api/partida): es esta
  // ruta, y solo esta, la que no lo hace.
  // ARREGLADO tras el hallazgo del arnés: `parseBody` rechaza como error de
  // ENTRADA (400) todo cuerpo JSON que no sea un objeto — `null` incluido — en
  // vez de dejar que `actualizarVisita` reviente en 500. Estos tests ya no
  // pinean el defecto: fijan el comportamiento correcto.
  it("body `null` en POST /api/visita ⇒ 400 de entrada, sin escritura ni stack (antes 500)", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const res = http(
      await handler({
        rawPath: "/api/visita",
        requestContext: { http: { method: "POST", sourceIp: IP } },
        queryStringParameters: { t: acunar() },
        body: "null",
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(cuerpo(res)).toEqual({ error: "cuerpo JSON inválido" });
    expect(res.body).not.toContain("TypeError");
    expect(res.body).not.toContain("actualizarVisita");
    expect(g.escriturasTaller).toEqual([]);
  });

  it("ningún cuerpo que no sea objeto pasa: número, arreglo, texto y booleano ⇒ 400, jamás 500", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    for (const crudo of ["123", "[]", '"texto"', "true"]) {
      const res = http(
        await handler({
          rawPath: "/api/visita",
          requestContext: { http: { method: "POST", sourceIp: IP } },
          queryStringParameters: { t: acunar() },
          body: crudo,
        }),
      );
      expect(res.statusCode, crudo).toBe(400);
      expect(cuerpo(res), crudo).toEqual({ error: "cuerpo JSON inválido" });
    }
    expect(g.escriturasTaller).toEqual([]);
  });

  it("un objeto vacío sigue siendo un cuerpo válido: POST /api/visita con `{}` ⇒ 200 { ok: true }", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const res = http(
      await handler({
        rawPath: "/api/visita",
        requestContext: { http: { method: "POST", sourceIp: IP } },
        queryStringParameters: { t: acunar() },
        body: "{}",
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(JSON.stringify({ ok: true }));
  });

  it("el COMPROMISO de fecha de salida se escribe UNA vez: el taller no borra su retraso", async () => {
    const handler = await cargarHandler();
    sembrarVisita({ fsalidaEstCompromiso: null });
    const token = acunar();
    await handler(
      eventoHttp({
        ruta: "/api/visita",
        metodo: "POST",
        token,
        body: { fsalidaEst: "2026-09-20" },
      }),
    );
    expect(primero(g.escriturasTaller).fsalidaEstCompromiso).toBe("2026-09-20");
    // Segunda pasada: la fila ya tiene compromiso, y ya no se reescribe.
    await handler(
      eventoHttp({
        ruta: "/api/visita",
        metodo: "POST",
        token,
        body: { fsalidaEst: "2026-12-31" },
      }),
    );
    const segunda = g.escriturasTaller[1];
    expect(segunda?.fsalidaEst).toBe("2026-12-31");
    expect(segunda?.fsalidaEstCompromiso).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// P12 — la proyección de lectura
// ════════════════════════════════════════════════════════════════════════════
describe("P12 — GET /api/visita proyecta SOLO lo del taller", () => {
  it("el conjunto de llaves es exactamente el permitido, en los tres niveles", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({ partidaId: "p-1", motivoRechazo: "muy caro", precioAutorizado: 1000 });
    const res = http(
      await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token: acunar() })),
    );
    expect(res.statusCode).toBe(200);
    const datos = cuerpo(res);
    expect(Object.keys(datos).sort()).toEqual(["partidas", "unidad", "visita"]);
    expect(Object.keys(datos.unidad as Fila).sort()).toEqual([
      "area",
      "eco",
      "placa",
      "submarca",
      "sucursal",
    ]);
    expect(Object.keys(datos.visita as Fila).sort()).toEqual([
      "estadoOperativo",
      "fechaEntrada",
      "fsalidaEst",
      "km",
      "tipo",
    ]);
    const partidas = datos.partidas as Fila[];
    expect(Object.keys(primero(partidas)).sort()).toEqual([
      "descripcion",
      "estado",
      "fotos",
      "motivoRechazo",
      "partidaId",
      "precio",
      "precioAutorizado",
      "tipo",
    ]);
  });

  it("ni gasto, ni gastoRef, ni gastoMO, ni comentario, ni folio, ni técnico, ni refacciones, ni los correos de GPA", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({ partidaId: "p-1" });
    const res = http(
      await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token: acunar() })),
    );
    for (const marcador of MARCADORES_INTERNOS) {
      expect(res.body, `se filtró ${marcador}`).not.toContain(marcador);
    }
    for (const campo of [
      "gasto",
      "gastoRef",
      "gastoMO",
      "comentario",
      "ligaCreadaPor",
      "ligaRevocadaPor",
      "folio",
      "tecnico",
      "refacciones",
      "ligaVersion",
      "estatus",
    ]) {
      expect(res.body, `apareció el campo ${campo}`).not.toContain(`"${campo}"`);
    }
  });

  it("la consulta de partidas va acotada por el sort key de ESTA visita (Query, no Scan)", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token: acunar() }));
    const arg = primero(g.argumentosList);
    expect(arg.tenantId).toBe(TENANT);
    expect(arg.visitaKeyPartidaId).toEqual({ beginsWith: { visitaKey: VISITA_KEY } });
    expect(arg.filter).toBeUndefined();
  });

  it("cinturón de respaldo: si el acotamiento del sort key dejara de aplicarse, el filtro por visitaKey igual tapa la fuga", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({ partidaId: "mia" });
    sembrarPartida({
      partidaId: "ajena",
      visitaKey: VISITA_KEY_AJENA,
      descripcion: "DE-OTRA-VISITA",
    });
    g.listaIgnoraAlcance = true;
    const res = http(
      await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token: acunar() })),
    );
    const partidas = cuerpo(res).partidas as Fila[];
    expect(partidas.map((p) => p.partidaId)).toEqual(["mia"]);
    expect(res.body).not.toContain("DE-OTRA-VISITA");
  });

  it("las partidas canceladas no se le muestran al taller", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({ partidaId: "viva" });
    sembrarPartida({ partidaId: "muerta", estado: "cancelada" });
    const res = http(
      await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token: acunar() })),
    );
    const partidas = cuerpo(res).partidas as Fila[];
    expect(partidas.map((p) => p.partidaId)).toEqual(["viva"]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// P13 — enviar a autorización
// ════════════════════════════════════════════════════════════════════════════
describe("P13 — POST /api/enviar mueve borradores de ESTA visita, y solo de esta", () => {
  it("promueve los borradores propios y deja intactas las filas de otra visita", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({ partidaId: "b-1" });
    sembrarPartida({ partidaId: "b-2" });
    sembrarPartida({ partidaId: "ya-propuesta", estado: "propuesta" });
    sembrarPartida({ partidaId: "ajena", visitaKey: VISITA_KEY_AJENA });
    // Peor caso: el backend deja de acotar por sort key.
    g.listaIgnoraAlcance = true;

    const res = http(
      await handler(eventoHttp({ ruta: "/api/enviar", metodo: "POST", token: acunar() })),
    );
    expect(res.statusCode).toBe(200);
    expect(cuerpo(res)).toEqual({ enviadas: 2 });

    const tocadas = g.actualizacionesPartida.map((u) => String(u.partidaId)).sort();
    expect(tocadas).toEqual(["b-1", "b-2"]);
    for (const u of g.actualizacionesPartida) {
      expect(u.estado).toBe("propuesta");
      expect(u.visitaKey).toBe(VISITA_KEY);
      expect(u.tenantId).toBe(TENANT);
    }
    expect(g.partidas.get(`${TENANT}|${VISITA_KEY_AJENA}|ajena`)?.estado).toBe("borrador");
  });

  it("es idempotente: una segunda llamada responde 0 y no vuelve a escribir", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({ partidaId: "b-1" });
    const token = acunar();
    expect(
      cuerpo(await handler(eventoHttp({ ruta: "/api/enviar", metodo: "POST", token }))),
    ).toEqual({
      enviadas: 1,
    });
    g.actualizacionesPartida.length = 0;
    const segunda = http(await handler(eventoHttp({ ruta: "/api/enviar", metodo: "POST", token })));
    expect(segunda.statusCode).toBe(200);
    expect(cuerpo(segunda)).toEqual({ enviadas: 0 });
    expect(g.actualizacionesPartida).toEqual([]);
  });

  it("sin km o sin fecha estimada de salida ⇒ 400 (espejo SERVIDOR del botón)", async () => {
    const handler = await cargarHandler();
    sembrarVisita({ km: null, fsalidaEst: null }, { km: undefined, fsalidaEst: undefined });
    sembrarPartida({ partidaId: "b-1" });
    const res = http(
      await handler(eventoHttp({ ruta: "/api/enviar", metodo: "POST", token: acunar() })),
    );
    expect(res.statusCode).toBe(400);
    expect(g.actualizacionesPartida).toEqual([]);
  });

  it("un km=true en el blob `datos` NO alcanza para pasar el espejo (A-15)", async () => {
    const handler = await cargarHandler();
    sembrarVisita({ km: null, fsalidaEst: null }, { km: true, fsalidaEst: "2026-09-20" });
    sembrarPartida({ partidaId: "b-1" });
    const res = http(
      await handler(eventoHttp({ ruta: "/api/enviar", metodo: "POST", token: acunar() })),
    );
    expect(res.statusCode).toBe(400);
    expect(g.actualizacionesPartida).toEqual([]);
  });

  it("respeta el portón: con el esquema apagado no promueve nada", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    sembrarPartida({ partidaId: "b-1" });
    g.appConfig.set(TENANT, { tenantId: TENANT, tallerHibrido: false });
    const res = http(
      await handler(eventoHttp({ ruta: "/api/enviar", metodo: "POST", token: acunar() })),
    );
    expect(res.statusCode).toBe(401);
    expect(g.actualizacionesPartida).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// P14 — la rama del resolver
// ════════════════════════════════════════════════════════════════════════════
describe("P14 — generarLigaTaller / revocarLigaTaller (rama AppSync)", () => {
  it("sin identity ⇒ 'no autorizado' y nada acuñado", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const r = resolver(await handler(eventoResolver("generarLigaTaller", { sinIdentidad: true })));
    expect(r).toEqual({ error: "no autorizado" });
    expect(r.token).toBeUndefined();
    expect(g.llamadas).toEqual([]);
  });

  it("grupos sin admin ni riesgos (solo operativo) ⇒ 'no autorizado'", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const r = resolver(
      await handler(eventoResolver("generarLigaTaller", { grupos: ["operativo", TENANT] })),
    );
    expect(r).toEqual({ error: "no autorizado" });
    expect(g.llamadas).toEqual([]);
  });

  it("viewer tampoco acuña, y tampoco puede revocar", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    for (const campo of ["generarLigaTaller", "revocarLigaTaller"] as const) {
      const r = resolver(await handler(eventoResolver(campo, { grupos: ["viewer", TENANT] })));
      expect(r).toEqual({ error: "no autorizado" });
    }
    expect(g.escriturasTaller).toEqual([]);
  });

  it("sin tenant derivable ⇒ 'no autorizado' ANTES de tocar la base", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const r = resolver(await handler(eventoResolver("generarLigaTaller", { grupos: ["admin"] })));
    expect(r).toEqual({ error: "no autorizado" });
    expect(g.llamadas).toEqual([]);
  });

  it("sin autor identificable (ni correo ni sub) ⇒ 'no autorizado': una liga sin responsable, no", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const r = resolver(
      await handler(eventoResolver("generarLigaTaller", { correo: null, sub: null })),
    );
    expect(r).toEqual({ error: "no autorizado" });
    expect(g.llamadas).toEqual([]);
  });

  it("admin SÍ acuña: carga útil pelada { token, expira }, con expira ≈ ahora + 90 días", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const antes = Date.now();
    const r = resolver(
      await handler(eventoResolver("generarLigaTaller", { grupos: ["admin", TENANT] })),
    );
    expect(Object.keys(r).sort()).toEqual(["expira", "token"]);
    const expira = Number(r.expira);
    expect(expira).toBeGreaterThanOrEqual(antes + VIGENCIA_LIGA_MS);
    expect(expira).toBeLessThanOrEqual(Date.now() + VIGENCIA_LIGA_MS + 5_000);
  });

  it("riesgos SÍ acuña (credencial adicional, Task 14)", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const r = resolver(
      await handler(
        eventoResolver("generarLigaTaller", { grupos: ["operativo", "riesgos", TENANT] }),
      ),
    );
    expect(Object.keys(r).sort()).toEqual(["expira", "token"]);
  });

  it("el token acuñado verifica con verificarToken y apunta a la visita y versión reales", async () => {
    const handler = await cargarHandler();
    sembrarVisita({ ligaVersion: 4 });
    const r = resolver(await handler(eventoResolver("generarLigaTaller")));
    const tk = verificarToken(String(r.token), SECRETO);
    expect(tk.t).toBe(TENANT);
    expect(tk.u).toBe(UNIDAD);
    expect(tk.f).toBe(FECHA);
    expect(tk.v).toBe(4);
    expect(tk.exp).toBe(Number(r.expira));
    expect(tk.p).toBeUndefined();
    // Y el token recién acuñado abre la puerta de verdad.
    const res = http(
      await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token: String(r.token) })),
    );
    expect(res.statusCode).toBe(200);
  });

  it("el tenant sale de custom:tenantId cuando viene", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const r = resolver(
      await handler(
        eventoResolver("generarLigaTaller", { grupos: ["admin"], tenantClaim: TENANT }),
      ),
    );
    expect(verificarToken(String(r.token), SECRETO).t).toBe(TENANT);
  });

  it("la trampa de Task 14: con grupos [operativo, riesgos, acme] el tenant es 'acme', NUNCA 'riesgos'", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const r = resolver(
      await handler(
        eventoResolver("generarLigaTaller", { grupos: ["operativo", "riesgos", TENANT] }),
      ),
    );
    const tk = verificarToken(String(r.token), SECRETO);
    expect(tk.t).toBe(TENANT);
    expect(tk.t).not.toBe("riesgos");
  });

  it("emitir deja el rastro de autoría y LIMPIA el de revocación", async () => {
    const handler = await cargarHandler();
    sembrarVisita({
      ligaRevocadaEn: "2026-08-01T00:00:00.000Z",
      ligaRevocadaPor: "quien.revoco@ejemplo.invalid",
    });
    await handler(eventoResolver("generarLigaTaller"));
    const escrito = primero(g.escriturasTaller);
    expect(escrito.ligaCreadaPor).toBe(CORREO);
    expect(escrito.ligaRevocadaEn).toBeNull();
    expect(escrito.ligaRevocadaPor).toBeNull();
    // Emitir NO sube la versión.
    expect(escrito.ligaVersion).toBeUndefined();
  });

  it("emitir para una visita inexistente ⇒ error de entrada, sin token", async () => {
    const handler = await cargarHandler();
    const r = resolver(await handler(eventoResolver("generarLigaTaller")));
    expect(r).toEqual({ error: "La visita no existe" });
  });

  it("un fallo interno del backend NO le devuelve el detalle a AppSync", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    g.fallas.add("Taller.update");
    const r = resolver(await handler(eventoResolver("generarLigaTaller")));
    expect(r).toEqual({ error: "error interno" });
    expect(JSON.stringify(r)).not.toContain("falla simulada");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// P15 — cabeceras
// ════════════════════════════════════════════════════════════════════════════
describe("P15 — las respuestas HTML llevan las tres cabeceras de seguridad (A-7)", () => {
  it("la página del portal (200)", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const res = http(await handler(eventoHttp({ ruta: "/", metodo: "GET", token: acunar() })));
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["content-security-policy"]).toContain("form-action 'none'");
    expect(res.headers["content-security-policy"]).toContain("base-uri 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("la página de liga inválida (401) lleva exactamente las mismas", async () => {
    const handler = await cargarHandler();
    const res = http(await handler(eventoHttp({ ruta: "/", metodo: "GET", token: "basura" })));
    expect(res.statusCode).toBe(401);
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("las respuestas JSON no se cachean (la liga viaja en la URL)", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const res = http(
      await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token: acunar() })),
    );
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-type"]).toContain("application/json");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// P16 — la bitácora
// ════════════════════════════════════════════════════════════════════════════
describe("P16 — la bitácora se escribe DESPUÉS de la escritura, con IP y huella", () => {
  const lineas = () =>
    bitacoras.map((l) => {
      try {
        return JSON.parse(l) as Fila;
      } catch {
        return { crudo: l } as Fila;
      }
    });
  const linea = (accion: string) => lineas().find((l) => l.accion === accion);

  it("la línea lleva sourceIp y la huella HMAC de 8 caracteres — nunca el token", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const token = acunar();
    await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token }));
    const l = linea("leer");
    expect(l).toBeDefined();
    expect(l?.ip).toBe(IP);
    const huella = String(l?.liga8);
    expect(huella).toMatch(/^[0-9a-f]{8}$/);
    // Es un HMAC real del token con el secreto del perímetro, no un prefijo.
    expect(huella).toBe(createHmac("sha256", SECRETO).update(token).digest("hex").slice(0, 8));
    expect(huella).not.toBe(token.slice(0, 8));
    // Y el token completo no aparece en NINGUNA línea.
    for (const cruda of bitacoras) expect(cruda).not.toContain(token);
  });

  it("dos ligas distintas de la misma visita y versión dan huellas DISTINTAS (detectar una filtrada)", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const a = acunar({ exp: Date.now() + 1_000_000 });
    const b = acunar({ exp: Date.now() + 2_000_000 });
    await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token: a }));
    await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token: b }));
    const huellas = lineas()
      .filter((l) => l.accion === "leer")
      .map((l) => l.liga8);
    expect(huellas.length).toBe(2);
    expect(huellas[0]).not.toBe(huellas[1]);
  });

  const escrituras: Array<{
    nombre: string;
    accion: string;
    falla: string;
    ruta: string;
    metodo: string;
    body?: unknown;
  }> = [
    {
      nombre: "crear-partida",
      accion: "crear-partida",
      falla: "TallerPartida.create",
      ruta: "/api/partida",
      metodo: "POST",
      body: { descripcion: "Balatas", tipo: "refaccion", precio: 100 },
    },
    {
      nombre: "actualizar-visita",
      accion: "actualizar-visita",
      falla: "Taller.update",
      ruta: "/api/visita",
      metodo: "POST",
      body: { km: 90000 },
    },
    {
      nombre: "firmar-subida",
      accion: "firmar-subida",
      falla: "getSignedUrl",
      ruta: "/api/subida",
      metodo: "POST",
      body: { mime: "image/jpeg", tamano: 1024 },
    },
    {
      nombre: "enviar-autorizacion",
      accion: "enviar-autorizacion",
      falla: "TallerPartida.update",
      ruta: "/api/enviar",
      metodo: "POST",
    },
  ];

  for (const e of escrituras) {
    it(`${e.nombre}: con la escritura EN VERDE sí hay línea`, async () => {
      const handler = await cargarHandler();
      sembrarVisita();
      sembrarPartida({ partidaId: "b-1" });
      const res = http(
        await handler(
          eventoHttp({ ruta: e.ruta, metodo: e.metodo, token: acunar(), body: e.body }),
        ),
      );
      expect(res.statusCode).toBe(200);
      expect(linea(e.accion), `falta la línea ${e.accion}`).toBeDefined();
    });

    it(`${e.nombre}: si la escritura FALLA no hay línea — "loggeado" significa "ocurrió"`, async () => {
      const handler = await cargarHandler();
      sembrarVisita();
      sembrarPartida({ partidaId: "b-1" });
      g.fallas.add(e.falla);
      const res = http(
        await handler(
          eventoHttp({ ruta: e.ruta, metodo: e.metodo, token: acunar(), body: e.body }),
        ),
      );
      expect(res.statusCode).toBe(500);
      expect(linea(e.accion), `no debió loggearse ${e.accion}`).toBeUndefined();
    });
  }

  it("un 500 no le entrega al taller el mensaje del backend ni un stack", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    g.fallas.add("Taller.update");
    const res = http(
      await handler(
        eventoHttp({ ruta: "/api/visita", metodo: "POST", token: acunar(), body: { km: 90000 } }),
      ),
    );
    expect(res.statusCode).toBe(500);
    expect(cuerpo(res)).toEqual({ error: "error interno" });
    expect(res.body).not.toContain("falla simulada");
    expect(res.body).not.toContain("Taller.update");
    // El detalle sí queda del lado servidor.
    expect(errores.join(" ")).toContain("falla simulada");
  });

  it("un rechazo de liga se loggea sin token y con la liga marcada inválida", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const token = "no-es-un-token";
    await handler(eventoHttp({ ruta: "/api/visita", metodo: "GET", token }));
    const l = linea("rechazado");
    expect(l?.liga).toBe("liga:invalida");
    expect(l?.ip).toBe(IP);
    expect(JSON.stringify(l)).not.toContain(token);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// P17 — ruteo
// ════════════════════════════════════════════════════════════════════════════
describe("P17 — ruteo: 404 para lo desconocido, y el resolver se despacha primero", () => {
  it("un rawPath desconocido ⇒ 404, aun con un token perfectamente válido", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    for (const ruta of ["/api/otra", "/admin", "/api/visita/", "//api/visita", "/api"]) {
      const res = http(await handler(eventoHttp({ ruta, metodo: "GET", token: acunar() })));
      expect(res.statusCode, ruta).toBe(404);
      expect(cuerpo(res)).toEqual({ error: "no encontrado" });
    }
  });

  it("el método equivocado cae en el MISMO catch-all: 404, no 405", async () => {
    // Comportamiento real y documentado aquí: el handler no distingue "ruta que
    // no existe" de "ruta que existe con otro verbo". No filtra nada (no delata
    // qué rutas existen), así que se afirma tal cual.
    const handler = await cargarHandler();
    sembrarVisita();
    const casos: Array<[string, string]> = [
      ["/api/foto", "POST"],
      ["/api/partida", "GET"],
      ["/api/visita", "DELETE"],
      ["/api/subida", "GET"],
      ["/api/enviar", "GET"],
      ["/", "POST"],
      ["/", "DELETE"],
    ];
    for (const [ruta, metodo] of casos) {
      const res = http(await handler(eventoHttp({ ruta, metodo, token: acunar() })));
      expect(res.statusCode, `${metodo} ${ruta}`).toBe(404);
      expect(cuerpo(res)).toEqual({ error: "no encontrado" });
    }
  });

  it("el 404 va DESPUÉS del portón: una ruta desconocida con la liga revocada da 401, no 404", async () => {
    const handler = await cargarHandler();
    sembrarVisita({ ligaVersion: 7 });
    const res = http(
      await handler(eventoHttp({ ruta: "/api/otra", metodo: "GET", token: acunar({ v: 1 }) })),
    );
    expect(res.statusCode).toBe(401);
    expect(res.body).toBe(CUERPO_OPACO);
  });

  it("info.fieldName gana sobre rawPath: un evento de resolver con rawPath '/' devuelve JSON crudo, no la página", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const evento = {
      ...eventoResolver("generarLigaTaller"),
      rawPath: "/",
      requestContext: { http: { method: "GET", sourceIp: IP } },
      queryStringParameters: {},
    };
    const r = resolver(await handler(evento));
    expect(Object.keys(r).sort()).toEqual(["expira", "token"]);
    expect(r.statusCode).toBeUndefined();
    expect(r.headers).toBeUndefined();
    expect(r.body).toBeUndefined();
  });

  it("un fieldName desconocido NO entra a la rama del resolver: cae al perímetro público", async () => {
    const handler = await cargarHandler();
    sembrarVisita();
    const res = http(
      await handler({
        info: { fieldName: "otraMutacion" },
        identity: { sub: SUB, claims: { "cognito:groups": ["admin", TENANT], email: CORREO } },
        arguments: { unitUid: UNIDAD, fechaEntrada: FECHA },
        rawPath: "/api/visita",
        requestContext: { http: { method: "GET", sourceIp: IP } },
        queryStringParameters: {},
      }),
    );
    // Sin token válido ⇒ 401 opaco. La identidad de AppSync NO abre el portal.
    expect(res.statusCode).toBe(401);
    expect(res.body).toBe(CUERPO_OPACO);
  });
});
