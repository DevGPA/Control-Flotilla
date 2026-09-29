// Vista LOCAL de la liga del proveedor — antes y después por hallazgo
// (spec docs/superpowers/specs/2026-09-28-taller-antes-despues-design.md §8.1).
//
// Sirve la página REAL (amplify/functions/taller-portal/pagina.ts) contra un servidor
// SIMULADO en memoria que usa las MISMAS reglas puras del portal (validacion.ts). Nada
// sale a internet ni toca AWS. Datos inventados (repo público).
//
//   npm run preview:liga                                 → http://localhost:5180 y /__panel
//   node scripts/preview-liga-local.mjs --red            → también desde el celular (misma red)
//   node scripts/preview-liga-local.mjs --smoke          → se prueba solo y sale (0 = bien)
//
// Lo que NO replica (y lo dice): la firma HMAC de la liga, el apagador, el portón de
// visita cerrada o anulada, la CSP del portal y S3 (las fotos viven en memoria). Tampoco
// los chequeos que viven en handler.ts y no en validacion.ts: los topes de hallazgos y
// fotos de POST /api/partida, el portón de km/fecha de POST /api/enviar y la lista de
// estados y la forma de fecha de POST /api/visita.
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createServer as crearVite } from "vite";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUERTO = Number(process.env.PUERTO_LIGA || 5180);
const EN_RED = process.argv.includes("--red");
const SMOKE = process.argv.includes("--smoke");

const vite = await crearVite({
  root: RAIZ,
  configFile: false,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true, hmr: false },
  // Vite solo se usa para cargar los dos .ts del portal: sin esto rastrea en segundo
  // plano TODA la app (Control de flotilla.html) y, al cerrar, pinta un muro de errores.
  optimizeDeps: { noDiscovery: true },
});
const { paginaProveedor } = await vite.ssrLoadModule("/amplify/functions/taller-portal/pagina.ts");
const V = await vite.ssrLoadModule("/amplify/functions/taller-portal/validacion.ts");

const TENANT = "demo";
const UNIDAD = "PRB0006";
const FECHA = "2026-09-14";
const VISITA_KEY = `${UNIDAD}|${FECHA}`;

// ── Fotos de ejemplo (dibujos SVG de un disco de freno) ──────────────────────
function dibujo(fondo, disco, grosor, texto, colorTexto) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120">` +
      `<rect width="160" height="120" fill="${fondo}"/>` +
      `<circle cx="72" cy="62" r="50" fill="${disco}"/><circle cx="72" cy="62" r="17" fill="#1f2937"/>` +
      `<rect x="112" y="30" width="30" height="64" rx="7" fill="#b91c1c"/>` +
      `<rect x="${112 - grosor}" y="38" width="${grosor}" height="48" rx="2" fill="#a8a29e"/>` +
      `<text x="80" y="114" font-size="8" fill="${colorTexto}" text-anchor="middle" font-family="sans-serif">${texto}</text>` +
      `</svg>`,
  );
}
const GASTADO = dibujo("#3f3a36", "#8a5a33", 4, "balata 2 mm · disco rayado", "#fca5a5");
const NUEVO = dibujo("#334155", "#cbd5e1", 12, "balata nueva 12 mm", "#bbf7d0");

let fotos; // llave -> { mime, bytes }
let partidas; // partidaId -> fila
let visita;

const llave = (nombre) => V.llaveFoto(TENANT, VISITA_KEY, nombre, "image/png");

function reiniciar() {
  fotos = new Map();
  const kA1 = llave("antes-balatas-delanteras");
  const kA2 = llave("antes-balatas-traseras");
  const kD2 = llave("despues-balatas-traseras");
  const kA4 = llave("antes-amortiguador");
  const kA5 = llave("antes-rotula");
  const kA6 = llave("antes-filtro-aire");
  for (const k of [kA1, kA2, kA4, kA5, kA6])
    fotos.set(k, { mime: "image/svg+xml", bytes: GASTADO });
  fotos.set(kD2, { mime: "image/svg+xml", bytes: NUEVO });
  const base = {
    tenantId: TENANT,
    visitaKey: VISITA_KEY,
    motivoRechazo: null,
    evidenciaFinal: [],
    terminadoEn: null,
    precioAutorizado: null,
    version: 2,
  };
  // Un hallazgo en cada estado (spec §8.1): borrador, propuesta, autorizada refacción,
  // autorizada mano de obra, terminada y rechazada.
  partidas = new Map(
    [
      {
        ...base,
        partidaId: "p-balatas-del",
        descripcion: "Balatas delanteras desgastadas",
        tipo: "refaccion",
        precio: 1850,
        precioAutorizado: 1850,
        estado: "autorizada",
        fotos: [kA1],
      },
      {
        ...base,
        partidaId: "p-freno-mano",
        descripcion: "Ajuste de freno de mano",
        tipo: "manoObra",
        precio: 350,
        precioAutorizado: 350,
        estado: "autorizada",
        fotos: [],
      },
      {
        ...base,
        partidaId: "p-balatas-tra",
        descripcion: "Balatas traseras",
        tipo: "refaccion",
        precio: 1650,
        precioAutorizado: 1650,
        estado: "terminada",
        fotos: [kA2],
        evidenciaFinal: [kD2],
        terminadoEn: "2026-09-16T15:00:00.000Z",
        version: 3,
      },
      {
        ...base,
        partidaId: "p-amortiguador",
        descripcion: "Amortiguador trasero con fuga",
        tipo: "refaccion",
        precio: 2400,
        estado: "propuesta",
        fotos: [kA4],
        version: 1,
      },
      {
        ...base,
        partidaId: "p-rotula",
        descripcion: "Rótula delantera",
        tipo: "refaccion",
        precio: 980,
        estado: "rechazada",
        motivoRechazo: "Precio alto — recotizar",
        fotos: [kA5],
      },
      {
        ...base,
        partidaId: "p-filtro-aire",
        descripcion: "Filtro de aire tapado",
        tipo: "refaccion",
        precio: 420,
        estado: "borrador",
        fotos: [kA6],
        version: 1,
      },
    ].map((p) => [p.partidaId, p]),
  );
  visita = {
    eco: "06",
    submarca: "Nissan NP300 (demo)",
    sucursal: "Guadalajara",
    area: "Mantenimiento",
    tipo: "Correctivo",
    km: 85000,
    estadoOperativo: "reparando",
    fsalidaEst: "2026-09-20",
  };
}
reiniciar();

function leerVisita() {
  return {
    unidad: {
      eco: visita.eco,
      placa: UNIDAD,
      submarca: visita.submarca,
      sucursal: visita.sucursal,
      area: visita.area,
    },
    visita: {
      tipo: visita.tipo,
      fechaEntrada: FECHA,
      km: visita.km,
      estadoOperativo: visita.estadoOperativo,
      fsalidaEst: visita.fsalidaEst,
    },
    partidas: [...partidas.values()]
      .filter((p) => p.estado !== "cancelada")
      .map((p) => V.proyectarPartidaParaTaller(p)),
  };
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
const leerCuerpo = (req) =>
  new Promise((ok, mal) => {
    const partes = [];
    req.on("data", (c) => partes.push(c));
    req.on("end", () => ok(Buffer.concat(partes)));
    req.on("error", mal);
  });

function cuerpoObjeto(buf) {
  let v;
  try {
    v = JSON.parse(buf.toString() || "{}");
  } catch {
    throw new V.ErrorEntrada("cuerpo JSON inválido");
  }
  if (v === null || typeof v !== "object" || Array.isArray(v))
    throw new V.ErrorEntrada("cuerpo JSON inválido");
  return v;
}

const json = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
};
const html = (res, status, cuerpo) => {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(cuerpo);
};
const redirigir = (res, a) => {
  res.writeHead(303, { location: a });
  res.end();
};
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

function panel() {
  const filas = [...partidas.values()]
    .map((p) => {
      const miniatura = (k) =>
        k
          ? `<img src="/__foto?key=${encodeURIComponent(k)}" alt="" style="width:56px;height:42px;object-fit:cover;border-radius:6px">`
          : "—";
      const accion =
        p.estado === "propuesta"
          ? `<form method="post" action="/__panel/autorizar?partidaId=${encodeURIComponent(p.partidaId)}"><button>Autorizar como Riesgos</button></form>`
          : "";
      return `<tr><td>${esc(p.descripcion)}</td><td>${esc(p.tipo)}</td><td><b>${esc(p.estado)}</b></td><td>${miniatura((p.fotos || [])[0])}</td><td>${miniatura((p.evidenciaFinal || [])[0])}</td><td>${accion}</td></tr>`;
    })
    .join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Panel · Riesgos simulado</title>
<body style="font:14px/1.5 system-ui;max-width:900px;margin:24px auto;padding:0 16px;color:#0f172a">
<h1 style="font-size:18px">Riesgos simulado · vista local</h1>
<p>Esto <b>no</b> es Fleet: es solo para autorizar hallazgos de la demo y ver cómo cambia la liga. <a href="/" target="_blank">Abrir la liga</a></p>
<table style="border-collapse:collapse;width:100%" border="1" cellpadding="6"><tr><th>Hallazgo</th><th>Tipo</th><th>Estado</th><th>Antes</th><th>Después</th><th></th></tr>${filas}</table>
<form method="post" action="/__panel/reiniciar" style="margin-top:16px"><button>Reiniciar la demo</button></form>
</body>`;
}

async function atender(req, res) {
  const url = new URL(req.url, "http://local");
  const ruta = url.pathname;
  const metodo = String(req.method).toUpperCase();
  try {
    if (metodo === "GET" && ruta === "/") return html(res, 200, paginaProveedor("vista-local"));
    if (metodo === "GET" && ruta === "/api/visita") return json(res, 200, leerVisita());
    if (metodo === "GET" && ruta === "/api/foto") {
      const key = url.searchParams.get("key") || "";
      if (!V.llaveFotoValida(TENANT, VISITA_KEY, key))
        throw new V.ErrorEntrada("llave de foto no válida");
      return json(res, 200, { url: `/__foto?key=${encodeURIComponent(key)}` });
    }
    if (metodo === "GET" && ruta === "/__foto") {
      const f = fotos.get(url.searchParams.get("key") || "");
      if (!f) return json(res, 404, { error: "no encontrada" });
      res.writeHead(200, { "content-type": f.mime, "cache-control": "no-store" });
      return res.end(f.bytes);
    }
    if (metodo === "POST" && ruta === "/api/subida") {
      const b = cuerpoObjeto(await leerCuerpo(req));
      if (!V.MIMES_FOTO.includes(String(b.mime)))
        return json(res, 400, { error: "tipo de archivo no permitido" });
      V.validarTamanoFoto(b.tamano);
      const key = V.llaveFoto(TENANT, VISITA_KEY, randomUUID(), String(b.mime));
      return json(res, 200, { url: `/__subir?key=${encodeURIComponent(key)}`, key });
    }
    if (metodo === "PUT" && ruta === "/__subir") {
      const key = url.searchParams.get("key") || "";
      if (!V.llaveFotoValida(TENANT, VISITA_KEY, key))
        return json(res, 400, { error: "llave no válida" });
      fotos.set(key, {
        mime: String(req.headers["content-type"] || "image/jpeg"),
        bytes: await leerCuerpo(req),
      });
      res.writeHead(200);
      return res.end();
    }
    if (metodo === "POST" && ruta === "/api/partida") {
      const b = cuerpoObjeto(await leerCuerpo(req));
      const datos = V.validarPartidaEntrante(b);
      const llaves = Array.isArray(b.fotos) ? b.fotos.map(String) : [];
      for (const k of llaves)
        if (!V.llaveFotoValida(TENANT, VISITA_KEY, k))
          throw new V.ErrorEntrada("llave de foto no válida");
      const partidaId = randomUUID();
      partidas.set(partidaId, {
        tenantId: TENANT,
        visitaKey: VISITA_KEY,
        partidaId,
        ...datos,
        estado: "borrador",
        fotos: llaves,
        evidenciaFinal: [],
        terminadoEn: null,
        precioAutorizado: null,
        motivoRechazo: null,
        version: 1,
      });
      return json(res, 200, { partidaId, fotos: llaves });
    }
    if (metodo === "POST" && ruta === "/api/enviar") {
      let enviadas = 0;
      for (const p of partidas.values())
        if (p.estado === "borrador") {
          p.estado = "propuesta";
          enviadas++;
        }
      return json(res, 200, { enviadas });
    }
    if (metodo === "POST" && ruta === "/api/visita") {
      const b = cuerpoObjeto(await leerCuerpo(req));
      if (b.km !== undefined) {
        if (!V.esKmValido(b.km)) throw new V.ErrorEntrada("Kilometraje no válido");
        visita.km = Number(b.km);
      }
      if (b.fsalidaEst !== undefined) visita.fsalidaEst = String(b.fsalidaEst);
      if (b.estadoOperativo !== undefined) visita.estadoOperativo = String(b.estadoOperativo);
      return json(res, 200, { ok: true });
    }
    if (metodo === "POST" && ruta === "/api/terminar") {
      const b = cuerpoObjeto(await leerCuerpo(req));
      const p = partidas.get(String(b.partidaId ?? ""));
      const cambios = V.decidirTerminacion(
        TENANT,
        VISITA_KEY,
        p,
        b.fotos,
        new Date().toISOString(),
      );
      if (cambios) Object.assign(p, cambios);
      const proy = V.proyectarPartidaParaTaller(p);
      return json(res, 200, {
        partidaId: proy.partidaId,
        estado: proy.estado,
        evidenciaFinal: proy.evidenciaFinal,
        terminadoEn: proy.terminadoEn,
      });
    }
    if (metodo === "GET" && ruta === "/__panel") return html(res, 200, panel());
    if (metodo === "POST" && ruta === "/__panel/autorizar") {
      const p = partidas.get(url.searchParams.get("partidaId") || "");
      if (p && p.estado === "propuesta") {
        p.estado = "autorizada";
        p.precioAutorizado = p.precio;
      }
      return redirigir(res, "/__panel");
    }
    if (metodo === "POST" && ruta === "/__panel/reiniciar") {
      reiniciar();
      return redirigir(res, "/__panel");
    }
    return json(res, 404, { error: "no encontrado" });
  } catch (e) {
    if (e instanceof V.ErrorConflicto) return json(res, 409, { error: e.message });
    if (e instanceof V.ErrorEntrada) return json(res, 400, { error: e.message });
    console.error("[preview-liga]", e);
    return json(res, 500, { error: "error interno" });
  }
}

const servidor = http.createServer((req, res) => {
  void atender(req, res);
});
await new Promise((ok) => servidor.listen(PUERTO, EN_RED ? "0.0.0.0" : "127.0.0.1", ok));

// Sin process.exit() de entrada: en Windows, salir a la fuerza mientras Vite y el servidor
// cierran sus manijas a veces tumba el proceso con una aserción de libuv (código 127)
// aunque todo haya pasado. Se cierra todo y el proceso termina solo, con este código; el
// temporizador (unref: no lo mantiene vivo) solo actúa si algo se quedara colgado.
async function cerrar(codigo) {
  process.exitCode = codigo;
  setTimeout(() => process.exit(codigo), 3000).unref();
  servidor.closeAllConnections();
  await new Promise((ok) => servidor.close(() => ok()));
  await vite.close();
}

if (SMOKE) {
  const base = `http://127.0.0.1:${PUERTO}`;
  const pedir = async (ruta, metodo = "GET", body) => {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const tipo = r.headers.get("content-type") || "";
    return { status: r.status, body: tipo.includes("json") ? await r.json() : await r.text() };
  };
  const fallas = [];
  const espera = (nombre, ok) => {
    console.log(`${ok ? "✓" : "✗"} ${nombre}`);
    if (!ok) fallas.push(nombre);
  };
  const pag = await pedir("/");
  espera(
    "la página real de la liga se sirve",
    pag.status === 200 && String(pag.body).includes("Subir foto del trabajo terminado"),
  );
  const v = await pedir("/api/visita");
  espera(
    "la visita trae 6 hallazgos (uno por estado), todos con evidenciaFinal y terminadoEn",
    v.status === 200 &&
      v.body.partidas.length === 6 &&
      v.body.partidas.every((p) => "evidenciaFinal" in p && "terminadoEn" in p),
  );
  const mo = await pedir("/api/terminar", "POST", { partidaId: "p-freno-mano", fotos: [] });
  espera("mano de obra se termina sin foto", mo.status === 200 && mo.body.estado === "terminada");
  const mo2 = await pedir("/api/terminar", "POST", { partidaId: "p-freno-mano", fotos: [] });
  espera("el reintento idéntico responde 200", mo2.status === 200);
  const sinFoto = await pedir("/api/terminar", "POST", { partidaId: "p-balatas-del", fotos: [] });
  espera("refacción sin foto ⇒ 400", sinFoto.status === 400);
  const prop = await pedir("/api/terminar", "POST", { partidaId: "p-amortiguador", fotos: [] });
  espera("propuesta ⇒ 400", prop.status === 400);
  const firma = await pedir("/api/subida", "POST", { mime: "image/jpeg", tamano: 3 });
  const put = await fetch(base + firma.body.url, {
    method: "PUT",
    headers: { "content-type": "image/jpeg" },
    body: Buffer.from([1, 2, 3]),
  });
  espera("la subida simulada guarda la foto", firma.status === 200 && put.status === 200);
  const ok = await pedir("/api/terminar", "POST", {
    partidaId: "p-balatas-del",
    fotos: [firma.body.key],
  });
  espera(
    "refacción con foto se termina",
    ok.status === 200 && ok.body.evidenciaFinal[0] === firma.body.key,
  );
  const conflicto = await pedir("/api/terminar", "POST", { partidaId: "p-balatas-del", fotos: [] });
  espera("cambiar el después de una terminada ⇒ 409", conflicto.status === 409);
  await cerrar(fallas.length ? 1 : 0);
} else {
  console.log("\nVista local de la liga (datos inventados; nada sale de tu computadora):");
  console.log(`  Liga del taller:      http://localhost:${PUERTO}/`);
  console.log(`  Riesgos simulado:     http://localhost:${PUERTO}/__panel`);
  if (EN_RED) {
    for (const lista of Object.values(os.networkInterfaces())) {
      for (const i of lista || []) {
        if (i.family === "IPv4" && !i.internal)
          console.log(`  Desde el celular:     http://${i.address}:${PUERTO}/`);
      }
    }
  }
  console.log("\nCtrl+C para cerrar.");
  process.on("SIGINT", () => void cerrar(0));
}
