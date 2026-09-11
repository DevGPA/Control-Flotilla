import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  KM_MAX,
  LARGO_MIN_SECRETO,
  MIMES_FOTO,
  TOPE_BYTES_FOTO,
  TOPE_FOTOS_PARTIDA,
  TOPE_PARTIDAS_VISITA,
  esKmValido,
  ligaRevocada,
  llaveFoto,
  llaveFotoValida,
  puedeEnviarAAutorizacion,
  secretoUtilizable,
  validarPartidaEntrante,
  validarTamanoFoto,
  visitaCerrada,
} from "../amplify/functions/taller-portal/validacion";

// `handler.ts` importa el modulo virtual $amplify/env/taller-portal y el SDK de
// AWS: no se puede importar en vitest (igual que el resto de los Lambdas del
// repo). Las pruebas de "que rama alcanza que" son ESTRUCTURALES sobre el texto
// fuente — el mismo patron que ya usa tallerLiga.test.ts.
const handlerSrc = readFileSync("amplify/functions/taller-portal/handler.ts", "utf8");

describe("llaveFoto — la ruta la genera el SERVIDOR", () => {
  it("vive bajo el prefijo de partidas de taller, con el tenant primero", () => {
    const k = llaveFoto("gpa", "JV98698|2026-09-01", "abc123", "image/jpeg");
    expect(k).toBe("photos/gpa/taller-partidas/JV98698_2026-09-01/abc123.jpg");
  });

  it("no deja escapar del prefijo con ../ ni con barras en la visitaKey", () => {
    const k = llaveFoto("gpa", "../../otra|2026-01-01", "id", "image/png");
    expect(k.startsWith("photos/gpa/taller-partidas/")).toBe(true);
    expect(k).not.toContain("..");
    expect(k.split("/").length).toBe(5);
  });

  it("la extensión sale del mime permitido, no de lo que mande el cliente", () => {
    expect(llaveFoto("gpa", "v", "i", "image/webp").endsWith(".webp")).toBe(true);
    expect(() => llaveFoto("gpa", "v", "i", "application/pdf")).toThrow();
    expect(() => llaveFoto("gpa", "v", "i", "text/html")).toThrow();
  });

  it("solo tres mimes de imagen en el Plan 1", () => {
    expect(MIMES_FOTO).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });
});

describe("validarPartidaEntrante — el texto lo escribe un tercero", () => {
  const ok = { descripcion: "Balatas delanteras", tipo: "refaccion", precio: 1850 };

  it("acepta una partida bien formada", () => {
    expect(validarPartidaEntrante(ok)).toEqual({
      descripcion: "Balatas delanteras",
      tipo: "refaccion",
      precio: 1850,
    });
  });

  it("exige descripción no vacía y la recorta", () => {
    expect(() => validarPartidaEntrante({ ...ok, descripcion: "   " })).toThrow();
    expect(validarPartidaEntrante({ ...ok, descripcion: "  x  " }).descripcion).toBe("x");
  });

  it("acota la descripción — no es un canal para subir kilobytes", () => {
    const larga = "a".repeat(1000);
    expect(validarPartidaEntrante({ ...ok, descripcion: larga }).descripcion.length).toBe(500);
  });

  it("rechaza tipo fuera del enum", () => {
    expect(() => validarPartidaEntrante({ ...ok, tipo: "otro" })).toThrow();
  });

  it("rechaza precios negativos, no numéricos y absurdos", () => {
    expect(() => validarPartidaEntrante({ ...ok, precio: -1 })).toThrow();
    expect(() => validarPartidaEntrante({ ...ok, precio: "1850" })).toThrow();
    expect(() => validarPartidaEntrante({ ...ok, precio: NaN })).toThrow();
    expect(() => validarPartidaEntrante({ ...ok, precio: 1e12 })).toThrow();
  });

  it("no deja que el cliente decida el estado ni la autoría", () => {
    const r = validarPartidaEntrante({ ...ok, estado: "autorizada", creadoPor: "user:jefe" });
    expect("estado" in r).toBe(false);
    expect("creadoPor" in r).toBe(false);
  });

  it("los topes son los del spec", () => {
    expect(TOPE_FOTOS_PARTIDA).toBe(6);
    expect(TOPE_PARTIDAS_VISITA).toBe(60);
  });
});

describe("validarTamanoFoto — el tope de subida es real, no un techo de cortesía", () => {
  it("el tope es 10 MB", () => {
    expect(TOPE_BYTES_FOTO).toBe(10 * 1024 * 1024);
  });

  it("rechaza cero", () => {
    expect(() => validarTamanoFoto(0)).toThrow();
  });

  it("rechaza un tamaño negativo", () => {
    expect(() => validarTamanoFoto(-1)).toThrow();
  });

  it("rechaza un tamaño no entero", () => {
    expect(() => validarTamanoFoto(1.5)).toThrow();
  });

  it("rechaza un byte por encima del tope", () => {
    expect(() => validarTamanoFoto(TOPE_BYTES_FOTO + 1)).toThrow();
  });

  it("acepta exactamente el tope", () => {
    expect(validarTamanoFoto(TOPE_BYTES_FOTO)).toBe(TOPE_BYTES_FOTO);
  });

  it('un tamaño omitido se rechaza — nunca hay un "sin límite" por default', () => {
    expect(() => validarTamanoFoto(undefined)).toThrow();
  });
});

describe("ligaRevocada — el único interruptor de revocación", () => {
  it("no está revocada si la versión coincide", () => {
    expect(ligaRevocada(3, { v: 3 })).toBe(false);
  });

  it("está revocada si la versión no coincide", () => {
    expect(ligaRevocada(2, { v: 3 })).toBe(true);
  });

  it("una versión ausente se trata como 1, no como sin-límite", () => {
    expect(ligaRevocada(undefined, { v: 1 })).toBe(false);
    expect(ligaRevocada(undefined, { v: 2 })).toBe(true);
  });

  it("compara con !==, no con < — una versión mayor también revoca", () => {
    // Si comparara con "<", una liga vieja (tk.v menor que la actual) nunca
    // se detectaría como revocada. El interruptor no es un contador.
    expect(ligaRevocada(5, { v: 3 })).toBe(true);
  });
});

describe("llaveFotoValida — valida la FORMA completa, no solo el prefijo", () => {
  const tenantId = "gpa";
  const visitaKey = "JV98698|2026-09-01";

  it("acepta exactamente la llave que genera llaveFoto", () => {
    const k = llaveFoto(tenantId, visitaKey, "abc123", "image/jpeg");
    expect(llaveFotoValida(tenantId, visitaKey, k)).toBe(true);
  });

  it('rechaza ".." en la cola', () => {
    const k = `photos/${tenantId}/taller-partidas/JV98698_2026-09-01/../evil.jpg`;
    expect(llaveFotoValida(tenantId, visitaKey, k)).toBe(false);
  });

  it('rechaza ".." aunque no traiga "/" — aísla el guard, no el charset', () => {
    // "../evil.jpg" lo rechaza igual el charset (el "/" no está permitido),
    // así que borrar el guard de ".." no rompería esa prueba. Esta sí:
    // "..evil.jpg" pasa el charset (el punto está permitido) y solo cae por
    // el guard dedicado.
    const k = `photos/${tenantId}/taller-partidas/JV98698_2026-09-01/..evil.jpg`;
    expect(llaveFotoValida(tenantId, visitaKey, k)).toBe(false);
  });

  it("exige el punto antes de la extensión, no un carácter cualquiera", () => {
    // Si el regex se armara con "\." en un template literal, llegaría a
    // RegExp como un "." pelón (cualquier carácter) y "abc123jpg" pasaría.
    const k = `photos/${tenantId}/taller-partidas/JV98698_2026-09-01/abc123jpg`;
    expect(llaveFotoValida(tenantId, visitaKey, k)).toBe(false);
  });

  it("rechaza un segmento demasiado largo", () => {
    const largo = "a".repeat(200);
    const k = `photos/${tenantId}/taller-partidas/JV98698_2026-09-01/${largo}.jpg`;
    expect(llaveFotoValida(tenantId, visitaKey, k)).toBe(false);
  });

  it("rechaza un segmento extra de ruta", () => {
    const k = `photos/${tenantId}/taller-partidas/JV98698_2026-09-01/sub/evil.jpg`;
    expect(llaveFotoValida(tenantId, visitaKey, k)).toBe(false);
  });

  it("rechaza una llave de otra visita", () => {
    const k = llaveFoto(tenantId, "OTRA123|2026-01-01", "abc123", "image/jpeg");
    expect(llaveFotoValida(tenantId, visitaKey, k)).toBe(false);
  });
});

describe("puedeEnviarAAutorizacion — espejo servidor del botón 'Enviar a autorización' (§8.2)", () => {
  it("acepta km y fsalidaEst presentes", () => {
    expect(puedeEnviarAAutorizacion({ km: 85000, fsalidaEst: "2026-09-12" })).toBe(true);
  });

  it("rechaza sin km", () => {
    expect(puedeEnviarAAutorizacion({ fsalidaEst: "2026-09-12" })).toBe(false);
  });

  it("rechaza km en cero", () => {
    expect(puedeEnviarAAutorizacion({ km: 0, fsalidaEst: "2026-09-12" })).toBe(false);
  });

  it("acepta km como string numérico (columnas que llegan como texto)", () => {
    expect(puedeEnviarAAutorizacion({ km: "85000", fsalidaEst: "2026-09-12" })).toBe(true);
  });

  it("rechaza km como string no numérico", () => {
    expect(puedeEnviarAAutorizacion({ km: "abc", fsalidaEst: "2026-09-12" })).toBe(false);
  });

  it("rechaza sin fsalidaEst", () => {
    expect(puedeEnviarAAutorizacion({ km: 85000 })).toBe(false);
  });

  it("rechaza fsalidaEst vacio", () => {
    expect(puedeEnviarAAutorizacion({ km: 85000, fsalidaEst: "" })).toBe(false);
  });
});

// ── A-15 — UNA sola regla de "km válido" para la escritura y para el espejo ──
describe("esKmValido — un booleano no es un kilometraje (A-15)", () => {
  it("acepta enteros dentro del rango, como número o como string", () => {
    expect(esKmValido(1)).toBe(true);
    expect(esKmValido(85000)).toBe(true);
    expect(esKmValido("85000")).toBe(true);
    expect(esKmValido(KM_MAX)).toBe(true);
  });

  it("rechaza `true` — el bug exacto que tenía el espejo (Number(true) === 1)", () => {
    expect(esKmValido(true)).toBe(false);
    expect(esKmValido(false)).toBe(false);
  });

  it("rechaza NaN, cero, negativos, decimales y lo que se pase del tope", () => {
    expect(esKmValido(NaN)).toBe(false);
    expect(esKmValido(0)).toBe(false);
    expect(esKmValido(-5)).toBe(false);
    expect(esKmValido(85000.5)).toBe(false);
    expect(esKmValido("85000.5")).toBe(false);
    expect(esKmValido(KM_MAX + 1)).toBe(false);
  });

  it("rechaza vacíos, objetos y ausencias — nunca los convierte con Number()", () => {
    expect(esKmValido("")).toBe(false);
    expect(esKmValido("   ")).toBe(false);
    expect(esKmValido(null)).toBe(false);
    expect(esKmValido(undefined)).toBe(false);
    expect(esKmValido([])).toBe(false);
    expect(esKmValido({})).toBe(false);
  });

  it("puedeEnviarAAutorizacion usa EXACTAMENTE este predicado — una sola regla", () => {
    expect(puedeEnviarAAutorizacion({ km: true, fsalidaEst: "2026-09-12" })).toBe(false);
    expect(puedeEnviarAAutorizacion({ km: 85000.5, fsalidaEst: "2026-09-12" })).toBe(false);
  });

  it("actualizarVisita ya no lleva su propia regla de rango a mano", () => {
    const i = handlerSrc.indexOf("async function actualizarVisita(");
    const cuerpo = handlerSrc.slice(i, handlerSrc.indexOf("\n}", i));
    expect(cuerpo).toContain("esKmValido(body.km)");
    expect(cuerpo).not.toContain("3_000_000");
  });
});

// ── A-8 — el portón mira si la visita ya está CERRADA ───────────────────────
describe("visitaCerrada — una liga de 90 días no puede seguir cotizando una visita liquidada", () => {
  it("reconoce el literal REAL de la columna del modelo (estatus cerrado)", () => {
    expect(visitaCerrada({ estatus: "cerrado" })).toBe(true);
    expect(visitaCerrada({ estatus: "abierto" })).toBe(false);
  });

  it("reconoce también el Finalizado que la app guarda en datos.estado", () => {
    expect(visitaCerrada({ estatus: "abierto", estadoEnDatos: "Finalizado" })).toBe(true);
  });

  it("una visita abierta sin señales no se cierra por accidente", () => {
    expect(visitaCerrada({})).toBe(false);
    expect(visitaCerrada({ estatus: undefined, estadoEnDatos: "En Reparación" })).toBe(false);
  });

  it("el PORTÓN lo aplica: cargarVisitaVigente rechaza la visita cerrada", () => {
    const i = handlerSrc.indexOf("async function cargarVisitaVigente(");
    const cuerpo = handlerSrc.slice(i, handlerSrc.indexOf("\n}", i));
    expect(cuerpo).toContain("visitaCerrada(");
    expect(cuerpo).toContain("ErrorLigaInvalida");
  });

  it("la EMISIÓN lo aplica: emitirLiga no acuña para una visita cerrada", () => {
    const i = handlerSrc.indexOf("async function emitirLiga(");
    const fin = handlerSrc.indexOf("async function revocarLiga(");
    const cuerpo = handlerSrc.slice(i, fin);
    expect(cuerpo).toContain("visitaCerrada(");
    // El rechazo va ANTES de firmar el token: nunca se acuña y luego se tira.
    expect(cuerpo.indexOf("visitaCerrada(")).toBeLessThan(cuerpo.indexOf("firmarToken("));
  });
});

// ── Secreto mínimo — todo el perímetro es ese HMAC ──────────────────────────
describe("secretoUtilizable — un secreto corto se trata como AUSENTE (fail-closed)", () => {
  it("acepta uno de al menos el largo mínimo", () => {
    const bueno = "x".repeat(LARGO_MIN_SECRETO);
    expect(secretoUtilizable(bueno)).toBe(bueno);
  });

  it("descarta uno corto — un carácter protegiendo todo el perímetro no es un secreto", () => {
    expect(secretoUtilizable("x")).toBe("");
    expect(secretoUtilizable("x".repeat(LARGO_MIN_SECRETO - 1))).toBe("");
  });

  it("descarta ausencias y tipos que no son string", () => {
    expect(secretoUtilizable(undefined)).toBe("");
    expect(secretoUtilizable(null)).toBe("");
    expect(secretoUtilizable(12345)).toBe("");
  });

  it("el handler lee el secreto por aquí, nunca directo del env", () => {
    expect(handlerSrc).toContain("secretoUtilizable(process.env.TALLER_PORTAL_SECRET)");
  });
});

// ── A-7 — cabeceras de seguridad de la página del portal ────────────────────
describe("html() emite las cabeceras de seguridad (A-7)", () => {
  const i = handlerSrc.indexOf("function html(status: number, cuerpo: string)");
  const cuerpo = handlerSrc.slice(i, handlerSrc.indexOf("\n}", i));

  it("Content-Security-Policy", () => {
    expect(cuerpo).toContain('"content-security-policy"');
    expect(handlerSrc).toContain("frame-ancestors 'none'");
    expect(handlerSrc).toContain("default-src 'none'");
    expect(handlerSrc).toContain("form-action 'none'");
    expect(handlerSrc).toContain("base-uri 'none'");
  });

  it("X-Content-Type-Options: nosniff", () => {
    expect(cuerpo).toContain('"x-content-type-options": "nosniff"');
  });

  it("Referrer-Policy: no-referrer — la liga viaja en la URL", () => {
    expect(cuerpo).toContain('"referrer-policy": "no-referrer"');
  });
});

// ── A-1 — POST /api/visita nunca devuelve la fila de Taller ─────────────────
describe("POST /api/visita responde un acuse, no la fila completa (A-1)", () => {
  it("la ruta devuelve { ok: true }", () => {
    const i = handlerSrc.indexOf('ruta === "/api/visita"', handlerSrc.indexOf('metodo === "POST"'));
    const bloque = handlerSrc.slice(i, i + 1600);
    expect(bloque).toContain("{ ok: true }");
    expect(bloque).not.toContain("json(200, await actualizarVisita(");
  });

  it("comentario (texto interno de Riesgos) sale de la proyección de leerVisita", () => {
    const i = handlerSrc.indexOf("async function leerVisita(");
    const fin = handlerSrc.indexOf("async function crearPartida(");
    const cuerpo = handlerSrc.slice(i, fin);
    expect(cuerpo).not.toContain("comentario: d.comentario");
  });
});

// ── A-4 — la bitácora ocurre DESPUÉS de la escritura, con IP y huella ───────
describe("bitácora (§7.6) — IP, huella del token, y después de escribir (A-4)", () => {
  it("loggea la IP de quien llama y una huella HMAC del token, nunca el token", () => {
    expect(handlerSrc).toContain("event?.requestContext?.http?.sourceIp");
    expect(handlerSrc).toContain("function huellaToken(");
    expect(handlerSrc).toContain("liga8:");
    // La huella es un HMAC truncado — jamás un prefijo del token real.
    const i = handlerSrc.indexOf("function huellaToken(");
    const cuerpo = handlerSrc.slice(i, handlerSrc.indexOf("\n}", i));
    expect(cuerpo).toContain("createHmac");
    expect(cuerpo).toContain("slice(0, 8)");
  });

  const sitios: Array<[string, string]> = [
    ["crear-partida", "await crearPartida("],
    ["actualizar-visita", "await actualizarVisita(tk, body, visita)"],
    ["firmar-subida", "await firmarSubida("],
  ];
  for (const [ruta, marcador] of sitios) {
    it(`${ruta}: la línea se escribe DESPUÉS de la escritura — "loggeado" significa "ocurrió"`, () => {
      const idxEscritura = handlerSrc.indexOf(marcador);
      const idxBitacora = handlerSrc.indexOf(`bitacora("${ruta}"`);
      expect(idxEscritura).toBeGreaterThan(-1);
      expect(idxBitacora).toBeGreaterThan(idxEscritura);
    });
  }
});

// ── Anclas del alcance `p` (recotización, Plan 2) ───────────────────────────
// Hoy /api/foto y /api/enviar NO son conscientes del alcance por partida: son
// seguras solo porque `verificarToken` rechaza de plano cualquier token con `p`
// (token.ts, "alcance-no-soportado"). El día que ese alcance se habilite, esas
// dos rutas hay que acotarlas ANTES. El ancla queda escrita en el código.
describe("alcance `p` — las dos rutas que no lo conocen lo dicen (ancla Plan 2)", () => {
  it("/api/foto y /api/enviar llevan el comentario de ancla", () => {
    const anclas = handlerSrc.match(/ANCLA \(alcance `p`, Plan 2\)/g) ?? [];
    expect(anclas.length).toBe(2);
  });

  it("el rechazo del alcance sigue vivo en el verificador del token", () => {
    const tokenSrc = readFileSync("amplify/functions/taller-portal/token.ts", "utf8");
    expect(tokenSrc).toContain("alcance-no-soportado");
    expect(tokenSrc).toMatch(/if \(payload\.p\) throw new ErrorToken\("alcance-no-soportado"\)/);
  });
});
