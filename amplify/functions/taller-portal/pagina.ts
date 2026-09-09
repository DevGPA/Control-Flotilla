// amplify/functions/taller-portal/pagina.ts
//
// La pantalla que ve el proveedor al abrir su liga: una sola pantalla con
// scroll, "lista viva" — el patrón de uso real es volver a entrar varias
// veces al día, no llenar un formulario una vez. Documento HTML autocontenido
// servido por este mismo Lambda (GET /, ver handler.ts), que habla con la
// API JSON de ese mismo Lambda. CERO recursos externos: la liga viaja en la
// URL (?t=) y cualquier CDN/fuente/script externo la filtraría vía Referer
// (de ahí el <meta name="referrer" content="no-referrer">).
//
// Seguridad (spec §7.5): el texto que escribe un tercero (la descripción del
// hallazgo la escribe el proveedor; el motivo de rechazo, Riesgos) nunca se
// pinta como HTML. Server-side, lo único dinámico horneado en este documento
// es el token — ya verificado por handler.ts antes de invocar esta función —
// y pasa por escaparHtml(). Client-side, el DOM se arma siempre con
// document.createElement + textContent; jamás asignando HTML crudo.

import {
  MIMES_FOTO,
  TOPE_BYTES_FOTO,
  TOPE_FOTOS_PARTIDA,
  TOPE_PARTIDAS_VISITA,
} from "./validacion";

/** Neutraliza los cinco caracteres peligrosos de HTML. Nunca hornear un dato
 *  dinámico en el documento sin pasarlo por aquí primero. */
export function escaparHtml(s: unknown): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function paginaProveedor(token: string): string {
  const tk = escaparHtml(token);
  // Minor B (revision de seguridad): antes estas cuatro constantes se
  // interpolaban directo dentro de <script> (JSON.stringify + numeros). No
  // eran explotables hoy (MIMES_FOTO es una tupla `as const` de compilacion,
  // no dato de terceros), pero cualquier edicion futura que las reemplazara
  // por algo dinamico quedaria a un solo cambio de una fuga hacia el script.
  // Se mueven a atributos data-* del MISMO <meta> que ya carga el token
  // (mismo patron "leer con getAttribute", no "interpolar en un literal de
  // JS"): asi <script> nunca vuelve a llevar nada horneado por el servidor.
  const mimesAttr = escaparHtml(MIMES_FOTO.join(","));
  const topeFotos = TOPE_FOTOS_PARTIDA;
  const topeBytes = TOPE_BYTES_FOTO;
  const topePartidas = TOPE_PARTIDAS_VISITA;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex,nofollow">
<meta id="pt-token" content="${tk}" data-mimes="${mimesAttr}" data-tope-fotos="${topeFotos}" data-tope-bytes="${topeBytes}" data-tope-partidas="${topePartidas}">
<title>GPA · Portal de taller</title>
<style>
/* Tokens copiados de src/styles/main.css (fuente de verdad del diseño de
   GPA Fleet Command) — subconjunto mínimo, inline: esta página no carga la
   hoja de estilos de la app ni ningún recurso externo. */
:root{
  --ink:#0f172a; --ink2:#475569; --ink3:#64748b;
  --bg:#eff1f5; --card:#ffffff;
  --hair:rgba(21,28,40,.08);
  --ac:#1e4fa3; --cyan:#29abe2;
  --g:#047857; --a:#b45309; --r:#e11d48;
  --cotiz-fg:#5b21b6; --cotiz-bg:#ede9fe;
  --r1:6px; --r2:12px;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--bg); color:var(--ink);
  font-family:"Inter",system-ui,-apple-system,sans-serif;
  font-size:16px; line-height:1.45;
  padding-bottom:118px;
  -webkit-text-size-adjust:100%;
}
h1,h2{margin:0 0 10px; font-size:15px; color:var(--ink)}
p{margin:0 0 8px}
.topbar{
  background:var(--ink); color:#fff;
  padding:14px 16px; font-weight:700; font-size:15px;
  letter-spacing:.01em;
}
main{max-width:480px; margin:0 auto; padding:14px}
.card{
  background:var(--card); border:1px solid var(--hair); border-radius:var(--r2);
  padding:16px; margin-bottom:14px;
  box-shadow:0 1px 1px rgba(21,28,40,.04), 0 8px 20px -12px rgba(21,28,40,.14);
}
.estado-msg{padding:24px 16px; text-align:center; color:var(--ink3)}
.estado-msg.error{color:var(--r)}
dl{margin:0; display:grid; grid-template-columns:auto 1fr; gap:4px 10px; font-size:14px}
dt{color:var(--ink3)}
dd{margin:0; font-weight:600; color:var(--ink)}
.banner-ambar{
  background:#fef3e2; color:var(--a); border:1px solid rgba(180,83,9,.25);
  border-radius:var(--r1); padding:10px 12px; margin-bottom:14px; font-size:14px;
}
label{display:block; font-size:13px; color:var(--ink2); font-weight:600; margin:12px 0 4px}
.label-block{font-size:13px; color:var(--ink2); font-weight:600; margin:14px 0 6px}
input[type="number"],input[type="date"],input[type="text"],textarea{
  width:100%; border:1px solid var(--hair); border-radius:var(--r1);
  padding:10px 12px; font:inherit; color:var(--ink); background:#fff;
  min-height:44px;
}
textarea{min-height:72px; resize:vertical}
.fila{display:flex; gap:8px; align-items:stretch}
.fila input{flex:1}
.btn{
  min-height:44px; border-radius:var(--r1); border:1px solid var(--hair);
  background:#fff; color:var(--ink); font:inherit; font-weight:700;
  padding:10px 14px; cursor:pointer;
}
.btn:disabled{cursor:not-allowed; opacity:.55}
.btn-primario{background:var(--ac); color:#fff; border-color:var(--ac)}
.btn-primario:disabled{background:#cbd5e1; border-color:#cbd5e1; color:#64748b}
.btn-sec{background:#fff}
.estados{display:grid; grid-template-columns:1fr 1fr; gap:8px}
.btn-estado.activo{background:var(--ac); color:#fff; border-color:var(--ac)}
.tipo-botones{display:grid; grid-template-columns:1fr 1fr; gap:8px}
.btn-tipo.activo{background:var(--cotiz-bg); border-color:var(--cotiz-fg); color:var(--cotiz-fg)}
.msg{font-size:12px; min-height:16px; margin:4px 0 0; color:var(--ink3)}
.vacio{color:var(--ink3); font-size:14px; padding:8px 0}
.btn-agregar{width:100%; margin-top:10px; font-size:15px}
.hallazgo{
  display:flex; gap:10px; padding:10px 0; border-top:1px solid var(--hair);
}
.hallazgo:first-child{border-top:none; padding-top:0}
.hallazgo-foto{
  flex:0 0 52px; height:52px; border-radius:8px; background:#f1f5f9;
  display:flex; align-items:center; justify-content:center; font-size:13px;
  color:var(--ink3); overflow:hidden;
}
.hallazgo-foto img{width:100%; height:100%; object-fit:cover}
.hallazgo-cuerpo{flex:1; min-width:0}
.hallazgo-desc{font-size:14px; font-weight:600; margin:0 0 2px; word-break:break-word}
.hallazgo-meta{font-size:13px; color:var(--ink2); margin:0 0 6px}
.hallazgo-motivo{font-size:13px; color:var(--r); font-style:italic; margin:4px 0 0}
.tachado{text-decoration:line-through; opacity:.65}
.pill{display:inline-block; padding:2px 10px; border-radius:999px; font-size:12px; font-weight:700}
.pill-borrador{background:#e2e8f0; color:var(--ink2)}
.pill-propuesta{background:var(--cotiz-bg); color:var(--cotiz-fg)}
.pill-autorizada{background:rgba(4,120,87,.14); color:var(--g)}
.pill-rechazada{background:rgba(225,29,72,.14); color:var(--r)}
.pill-terminada{background:rgba(30,79,163,.14); color:var(--ac)}
.draft{
  margin-top:14px; padding-top:14px; border-top:1px dashed var(--hair);
}
.draft-fotos{display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px}
.draft-foto{
  width:64px; height:64px; border-radius:8px; overflow:visible; position:relative;
  background:#f1f5f9;
}
.draft-foto img{width:100%; height:100%; object-fit:cover; border-radius:8px}
/* Minor A: el area de toque real es 44x44 (transparente); el glifo visible
   sigue siendo el circulo chico de 20px dentro, vía <span>. */
.draft-foto button{
  position:absolute; top:-10px; right:-10px; width:44px; height:44px; min-height:0;
  display:flex; align-items:center; justify-content:center;
  border:none; background:transparent; padding:0; cursor:pointer;
}
.draft-foto button span{
  display:flex; align-items:center; justify-content:center;
  width:20px; height:20px; border-radius:50%;
  background:rgba(15,23,42,.7); color:#fff; font-size:12px; line-height:1;
}
.draft-acciones{display:flex; gap:8px; margin-top:10px}
.draft-acciones .btn{flex:1}
.pie{
  position:fixed; left:0; right:0; bottom:0; z-index:10;
  background:var(--card); border-top:1px solid var(--hair);
  padding:10px 16px calc(10px + env(safe-area-inset-bottom));
  box-shadow:0 -4px 16px rgba(15,23,42,.10);
}
.pie-inner{max-width:480px; margin:0 auto}
.pie-totales{display:flex; justify-content:space-between; margin-bottom:8px; font-size:14px}
.pie-etq{color:var(--ink3); margin-right:6px}
.pie-valor{font-weight:700}
.btn-enviar{width:100%; font-size:15px}
.msg-enviar-razon{font-size:12px; color:var(--a); margin:6px 0 0; text-align:center}
.msg-enviar-ok{font-size:12px; color:var(--g); margin:6px 0 0; text-align:center}
</style>
</head>
<body>
<div class="topbar">GPA · Control de Flotilla</div>
<main>
  <div id="cargando" class="estado-msg">Cargando…</div>
  <div id="error" class="estado-msg error" hidden></div>

  <div id="contenido" hidden>
    <section class="card" id="card-unidad">
      <h2>Unidad</h2>
      <dl id="unidad-datos"></dl>
    </section>

    <div id="banner-km" class="banner-ambar" hidden>
      Falta el kilometraje. Puedes seguir subiendo hallazgos.
    </div>

    <section class="card" id="card-camioneta">
      <h2>La camioneta</h2>

      <label for="in-km">Kilometraje</label>
      <div class="fila">
        <input id="in-km" type="number" inputmode="numeric" min="1" max="3000000" step="1">
        <button id="btn-km" class="btn btn-sec" type="button">Guardar</button>
      </div>
      <p id="msg-km" class="msg" aria-live="polite"></p>

      <p class="label-block">¿Cómo va?</p>
      <div class="estados">
        <button type="button" class="btn btn-estado" data-estado="revisando">🔧 Estoy revisando</button>
        <button type="button" class="btn btn-estado" data-estado="reparando">🛠 Ya estoy reparando</button>
        <button type="button" class="btn btn-estado" data-estado="esperandoRefaccion">📦 Esperando la refacción</button>
        <button type="button" class="btn btn-estado" data-estado="lista">✅ Ya está lista</button>
      </div>
      <p id="msg-estado" class="msg" aria-live="polite"></p>

      <label for="in-fecha">Estará lista</label>
      <div class="fila">
        <input id="in-fecha" type="date">
        <button id="btn-fecha" class="btn btn-sec" type="button">Guardar</button>
      </div>
      <p id="msg-fecha" class="msg" aria-live="polite"></p>
    </section>

    <section class="card" id="card-hallazgos">
      <h2>Hallazgos</h2>
      <div id="lista-partidas"></div>
      <p id="sin-partidas" class="vacio" hidden>Todavía no hay hallazgos registrados.</p>

      <button id="btn-agregar" class="btn btn-primario btn-agregar" type="button">📷 Agregar hallazgo</button>
      <input id="in-foto" type="file" accept="image/*" capture="environment" hidden>
      <p id="msg-tope-partidas" class="msg" hidden></p>

      <div id="draft" class="draft" hidden>
        <div class="draft-fotos" id="draft-fotos"></div>
        <button id="btn-otra-foto" class="btn btn-sec" type="button">+ Agregar otra foto</button>

        <label for="in-desc">¿Qué encontraste?</label>
        <textarea id="in-desc" maxlength="500"></textarea>

        <p class="label-block">¿Qué es?</p>
        <div class="tipo-botones">
          <button type="button" class="btn btn-tipo" data-tipo="refaccion">Refacción</button>
          <button type="button" class="btn btn-tipo" data-tipo="manoObra">Mano de obra</button>
        </div>

        <label for="in-precio">Precio sin IVA</label>
        <input id="in-precio" type="number" inputmode="decimal" min="0" step="0.01">

        <p id="msg-draft" class="msg" aria-live="polite"></p>

        <div class="draft-acciones">
          <button id="btn-cancelar-draft" class="btn btn-sec" type="button">Cancelar</button>
          <button id="btn-guardar-draft" class="btn btn-primario" type="button">Guardar hallazgo</button>
        </div>
      </div>
    </section>
  </div>
</main>

<footer class="pie">
  <div class="pie-inner">
    <div class="pie-totales">
      <div><span class="pie-etq">Cotizado</span><span class="pie-valor" id="tot-cotizado">$0.00</span></div>
      <div><span class="pie-etq">Autorizado</span><span class="pie-valor" id="tot-autorizado">$0.00</span></div>
    </div>
    <button id="btn-enviar" class="btn btn-primario btn-enviar" type="button" disabled>Enviar 0 a autorización</button>
    <p id="msg-enviar-razon" class="msg-enviar-razon" aria-live="polite"></p>
  </div>
</footer>

<script>
(function () {
  "use strict";

  var metaConfig = document.getElementById("pt-token");
  var TOKEN = metaConfig.getAttribute("content");
  var MIMES = metaConfig.getAttribute("data-mimes").split(",");
  var TOPE_FOTOS = parseInt(metaConfig.getAttribute("data-tope-fotos"), 10);
  var TOPE_BYTES = parseInt(metaConfig.getAttribute("data-tope-bytes"), 10);
  var TOPE_PARTIDAS = parseInt(metaConfig.getAttribute("data-tope-partidas"), 10);

  var RUTA_VISITA = "/api/visita";
  var RUTA_PARTIDA = "/api/partida";
  var RUTA_SUBIDA = "/api/subida";
  var RUTA_FOTO = "/api/foto";

  var estado = null; // { unidad, visita, partidas } tal como lo devuelve /api/visita
  var fotosDraft = []; // { file: File, key: string|null }[] — key se llena
  // al subir; un reintento no vuelve a subir lo que ya tiene key (Important 5)
  var tipoDraft = null; // "refaccion" | "manoObra"
  var previewsLocal = {}; // partidaId -> object URL, solo para lo creado en esta sesión

  function conToken(ruta) {
    return ruta + "?t=" + encodeURIComponent(TOKEN);
  }

  function el(tag, clase, texto) {
    var n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
  }

  function moneda(n) {
    var v = typeof n === "number" && isFinite(n) ? n : 0;
    return "$" + v.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function peticionJson(ruta, cuerpo) {
    return fetch(conToken(ruta), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cuerpo || {}),
    }).then(function (res) {
      if (!res.ok) throw new Error("http-" + res.status);
      return res.json();
    });
  }

  // ── Carga inicial ──────────────────────────────────────────────────────
  function cargar() {
    return fetch(conToken(RUTA_VISITA))
      .then(function (res) {
        if (!res.ok) throw new Error("http-" + res.status);
        return res.json();
      })
      .then(function (datos) {
        estado = datos;
        pintarUnidad();
        pintarCamioneta();
        pintarPartidas();
        document.getElementById("cargando").hidden = true;
        document.getElementById("contenido").hidden = false;
      })
      .catch(function () {
        document.getElementById("cargando").hidden = true;
        var e = document.getElementById("error");
        e.textContent = "No se pudo cargar la información. Verifica tu conexión e intenta de nuevo.";
        e.hidden = false;
      });
  }

  function pintarUnidad() {
    var dl = document.getElementById("unidad-datos");
    dl.textContent = "";
    var u = estado.unidad;
    var v = estado.visita;
    var filas = [
      ["Económico", u.eco || "—"],
      ["Placas", u.placa || "—"],
      ["Submarca", u.submarca || "—"],
      ["Sucursal", u.sucursal || "—"],
      ["Área", u.area || "—"],
      ["Tipo de visita", v.tipo || "—"],
      ["Fecha de ingreso", v.fechaEntrada || "—"],
    ];
    filas.forEach(function (f) {
      dl.appendChild(el("dt", null, f[0]));
      dl.appendChild(el("dd", null, f[1]));
    });
  }

  function pintarCamioneta() {
    var v = estado.visita;
    var inKm = document.getElementById("in-km");
    if (v.km !== null && v.km !== undefined) inKm.value = String(v.km);
    var inFecha = document.getElementById("in-fecha");
    if (v.fsalidaEst) inFecha.value = v.fsalidaEst;
    marcarEstadoActivo();
  }

  function marcarEstadoActivo() {
    var botones = document.querySelectorAll(".btn-estado");
    for (var i = 0; i < botones.length; i++) {
      var b = botones[i];
      var activo = b.getAttribute("data-estado") === estado.visita.estadoOperativo;
      if (activo) b.classList.add("activo");
      else b.classList.remove("activo");
    }
  }

  // ── Hallazgos: pintado ────────────────────────────────────────────────
  function etiquetaEstado(e) {
    if (e === "borrador") return "Borrador · aún no enviado";
    if (e === "propuesta") return "Esperando autorización";
    if (e === "autorizada") return "Autorizada";
    if (e === "rechazada") return "No autorizada";
    if (e === "terminada") return "Terminada";
    return e;
  }

  // Important 2 (revision de seguridad): /api/foto?t=...&key=... firma una
  // URL de LECTURA por-demanda (igual patron que el resto de la app: nunca
  // se lista el bucket). Mientras 6b no la despliegue, responde 404 y el
  // marcador "📷 N" puesto de entrada se queda tal cual — nunca se rompe la
  // tarjeta ni se reintenta indefinidamente.
  function pintarFotoPartida(cont, p) {
    var previa = previewsLocal[p.partidaId];
    if (previa) {
      var img = el("img", null);
      img.src = previa;
      img.alt = "Foto del hallazgo";
      img.loading = "lazy";
      cont.appendChild(img);
      return;
    }
    if (!p.fotos || !p.fotos.length) {
      cont.appendChild(document.createTextNode("📷"));
      return;
    }
    cont.appendChild(document.createTextNode("📷 " + p.fotos.length));
    fetch(conToken(RUTA_FOTO) + "&key=" + encodeURIComponent(p.fotos[0]))
      .then(function (res) {
        if (!res.ok) throw new Error("http-" + res.status);
        return res.json();
      })
      .then(function (datos) {
        if (!datos || !datos.url) throw new Error("sin-url");
        var img = el("img", null);
        img.src = datos.url;
        img.alt = "Foto del hallazgo";
        img.loading = "lazy";
        cont.textContent = "";
        cont.appendChild(img);
      })
      .catch(function () {
        // Ruta ausente hoy (6b) o firma fallida: el marcador ya puesto arriba
        // se queda como esta.
      });
  }

  function tarjetaPartida(p) {
    var card = el("div", "hallazgo");

    var foto = el("div", "hallazgo-foto");
    pintarFotoPartida(foto, p);
    card.appendChild(foto);

    var cuerpo = el("div", "hallazgo-cuerpo");
    var tachado = p.estado === "rechazada";

    var desc = el("p", "hallazgo-desc" + (tachado ? " tachado" : ""), p.descripcion);
    cuerpo.appendChild(desc);

    var tipoTxt = p.tipo === "manoObra" ? "Mano de obra" : "Refacción";
    // Important 1: autorizada muestra el precio CONGELADO (precioAutorizado),
    // no el capturado — se degrada a precio mientras 6b no manda el campo, y
    // en cualquier otro estado (todavia no hay precioAutorizado que mostrar).
    var precioMostrado = p.precioAutorizado ?? p.precio;
    var meta = el(
      "p",
      "hallazgo-meta" + (tachado ? " tachado" : ""),
      tipoTxt + " · " + moneda(precioMostrado),
    );
    cuerpo.appendChild(meta);

    var pill = el("span", "pill pill-" + p.estado, etiquetaEstado(p.estado));
    cuerpo.appendChild(pill);

    if (p.estado === "rechazada" && p.motivoRechazo) {
      var motivo = el("p", "hallazgo-motivo", '"' + p.motivoRechazo + '"');
      cuerpo.appendChild(motivo);
    }

    card.appendChild(cuerpo);
    return card;
  }

  function pintarPartidas() {
    var cont = document.getElementById("lista-partidas");
    cont.textContent = "";
    var partidas = estado.partidas || [];
    document.getElementById("sin-partidas").hidden = partidas.length > 0;
    partidas.forEach(function (p) {
      cont.appendChild(tarjetaPartida(p));
    });
    actualizarTotalesYPie();
    actualizarTopePartidas();
  }

  function actualizarTopePartidas() {
    var n = (estado.partidas || []).length;
    var msg = document.getElementById("msg-tope-partidas");
    var btn = document.getElementById("btn-agregar");
    if (n >= TOPE_PARTIDAS) {
      msg.textContent = "Esta visita ya tiene " + TOPE_PARTIDAS + " hallazgos.";
      msg.hidden = false;
      btn.disabled = true;
    } else {
      msg.hidden = true;
      btn.disabled = false;
    }
  }

  function actualizarTotalesYPie() {
    var cot = 0;
    var aut = 0;
    var nBorrador = 0;
    (estado.partidas || []).forEach(function (p) {
      if (p.estado === "propuesta" || p.estado === "autorizada" || p.estado === "rechazada") {
        cot += p.precio || 0;
      }
      if (p.estado === "autorizada") aut += (p.precioAutorizado ?? p.precio) || 0;
      if (p.estado === "borrador") nBorrador++;
    });
    document.getElementById("tot-cotizado").textContent = moneda(cot);
    document.getElementById("tot-autorizado").textContent = moneda(aut);

    var v = estado.visita;
    var faltaKm = v.km === null || v.km === undefined;
    var faltaFecha = !v.fsalidaEst;
    document.getElementById("banner-km").hidden = !faltaKm;

    var btn = document.getElementById("btn-enviar");
    var razon = document.getElementById("msg-enviar-razon");
    btn.textContent = "Enviar " + nBorrador + " a autorización";

    if (faltaKm || faltaFecha) {
      btn.disabled = true;
      var motivos = [];
      if (faltaKm) motivos.push("el kilometraje");
      if (faltaFecha) motivos.push("la fecha estimada de salida");
      razon.className = "msg-enviar-razon";
      razon.textContent = "Falta " + motivos.join(" y ") + " para poder enviar.";
    } else if (nBorrador === 0) {
      btn.disabled = true;
      razon.className = "msg-enviar-razon";
      razon.textContent = "No hay hallazgos nuevos por enviar.";
    } else {
      btn.disabled = false;
      razon.textContent = "";
    }
  }

  // ── Camioneta: guardar campos ────────────────────────────────────────
  function guardarCampoVisita(campo, msgId, alGuardar) {
    var msg = document.getElementById(msgId);
    msg.textContent = "Guardando…";
    peticionJson(RUTA_VISITA, campo)
      .then(function () {
        msg.textContent = "Guardado.";
        alGuardar();
        actualizarTotalesYPie();
      })
      .catch(function () {
        msg.textContent = "No se pudo guardar. Intenta de nuevo.";
      });
  }

  document.getElementById("btn-km").addEventListener("click", function () {
    var v = parseInt(document.getElementById("in-km").value, 10);
    if (!isFinite(v) || v < 1 || v > 3000000) {
      document.getElementById("msg-km").textContent = "Kilometraje no válido.";
      return;
    }
    guardarCampoVisita({ km: v }, "msg-km", function () {
      estado.visita.km = v;
    });
  });

  document.getElementById("btn-fecha").addEventListener("click", function () {
    var v = document.getElementById("in-fecha").value;
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(v)) {
      document.getElementById("msg-fecha").textContent = "Elige una fecha.";
      return;
    }
    guardarCampoVisita({ fsalidaEst: v }, "msg-fecha", function () {
      estado.visita.fsalidaEst = v;
    });
  });

  var botonesEstado = document.querySelectorAll(".btn-estado");
  for (var iBE = 0; iBE < botonesEstado.length; iBE++) {
    botonesEstado[iBE].addEventListener("click", function (ev) {
      var valor = ev.currentTarget.getAttribute("data-estado");
      guardarCampoVisita({ estadoOperativo: valor }, "msg-estado", function () {
        estado.visita.estadoOperativo = valor;
        marcarEstadoActivo();
      });
    });
  }

  // ── Agregar hallazgo: captura de foto y borrador ────────────────────
  function validarArchivo(f) {
    if (MIMES.indexOf(f.type) === -1) return "Tipo de archivo no permitido.";
    if (f.size > TOPE_BYTES) return "La foto pesa más de " + Math.round(TOPE_BYTES / (1024 * 1024)) + " MB.";
    return null;
  }

  function pintarFotosDraft() {
    var cont = document.getElementById("draft-fotos");
    cont.textContent = "";
    fotosDraft.forEach(function (item, idx) {
      var chip = el("div", "draft-foto");
      var img = document.createElement("img");
      img.src = URL.createObjectURL(item.file);
      img.alt = "Foto " + (idx + 1);
      chip.appendChild(img);
      var quitar = document.createElement("button");
      quitar.type = "button";
      quitar.setAttribute("aria-label", "Quitar foto");
      var glifo = el("span", null, "×");
      quitar.appendChild(glifo);
      quitar.addEventListener("click", function () {
        // Quitar la foto es el otro punto (junto con guardar con exito) en
        // el que se permite perder una llave ya subida — deja de haber
        // partida que la referencie, así que no hace falta rastrearla mas.
        fotosDraft.splice(idx, 1);
        pintarFotosDraft();
      });
      chip.appendChild(quitar);
      cont.appendChild(chip);
    });
    document.getElementById("btn-otra-foto").hidden = fotosDraft.length >= TOPE_FOTOS;
  }

  function abrirDraft() {
    document.getElementById("draft").hidden = false;
    pintarFotosDraft();
  }

  function cerrarDraft() {
    document.getElementById("draft").hidden = true;
    fotosDraft = [];
    tipoDraft = null;
    document.getElementById("in-desc").value = "";
    document.getElementById("in-precio").value = "";
    document.getElementById("msg-draft").textContent = "";
    var botones = document.querySelectorAll(".btn-tipo");
    for (var i = 0; i < botones.length; i++) botones[i].classList.remove("activo");
    pintarFotosDraft();
  }

  document.getElementById("btn-agregar").addEventListener("click", function () {
    document.getElementById("in-foto").click();
  });

  document.getElementById("btn-otra-foto").addEventListener("click", function () {
    document.getElementById("in-foto").click();
  });

  document.getElementById("in-foto").addEventListener("change", function (ev) {
    var input = ev.target;
    var f = input.files && input.files[0];
    input.value = "";
    if (!f) return;
    if (fotosDraft.length >= TOPE_FOTOS) {
      document.getElementById("msg-draft").textContent = "Máximo " + TOPE_FOTOS + " fotos por hallazgo.";
      return;
    }
    var err = validarArchivo(f);
    if (err) {
      document.getElementById("msg-draft").textContent = err;
      abrirDraft();
      return;
    }
    fotosDraft.push({ file: f, key: null });
    var draftEstabaAbierto = !document.getElementById("draft").hidden;
    abrirDraft();
    if (!draftEstabaAbierto) document.getElementById("in-desc").focus();
  });

  var botonesTipo = document.querySelectorAll(".btn-tipo");
  for (var iBT = 0; iBT < botonesTipo.length; iBT++) {
    botonesTipo[iBT].addEventListener("click", function (ev) {
      tipoDraft = ev.currentTarget.getAttribute("data-tipo");
      var botones = document.querySelectorAll(".btn-tipo");
      for (var i = 0; i < botones.length; i++) botones[i].classList.remove("activo");
      ev.currentTarget.classList.add("activo");
    });
  }

  document.getElementById("btn-cancelar-draft").addEventListener("click", function () {
    cerrarDraft();
  });

  // Important 5 (revision de seguridad): un reintento tras un fallo de
  // /api/partida (el caso central de esta pantalla: mala señal en el taller)
  // NO debe volver a firmar ni volver a subir fotos que ya llegaron a S3 —
  // eso deja objetos de 10 MB huerfanos en el bucket de produccion cada vez
  // que alguien reintenta. Cada elemento de fotosDraft es
  // { file: File, key: string|null }; subirFotos() se salta cualquier item
  // que ya tenga key (subido en un intento anterior) y solo sube lo que
  // falta. La key solo se limpia al guardar con éxito (cerrarDraft) o al
  // quitar la foto (pintarFotosDraft), nunca por un fallo de guardado.
  function subirFotos(items) {
    var cadena = Promise.resolve();
    items.forEach(function (item) {
      if (item.key) return; // ya subida en un intento anterior: no repetir
      cadena = cadena.then(function () {
        return peticionJson(RUTA_SUBIDA, { mime: item.file.type, tamano: item.file.size }).then(
          function (firma) {
            return fetch(firma.url, {
              method: "PUT",
              headers: { "content-type": item.file.type },
              body: item.file,
            }).then(function (resPut) {
              if (!resPut.ok) throw new Error("subida");
              item.key = firma.key;
            });
          },
        );
      });
    });
    return cadena.then(function () {
      return items.map(function (item) {
        return item.key;
      });
    });
  }

  document.getElementById("btn-guardar-draft").addEventListener("click", function () {
    var msg = document.getElementById("msg-draft");
    var desc = document.getElementById("in-desc").value.trim();
    var precioStr = document.getElementById("in-precio").value;
    var precio = parseFloat(precioStr);

    if (fotosDraft.length === 0) {
      msg.textContent = "Agrega al menos una foto.";
      return;
    }
    if (!desc) {
      msg.textContent = "Describe qué encontraste.";
      return;
    }
    if (!tipoDraft) {
      msg.textContent = "Elige si es refacción o mano de obra.";
      return;
    }
    if (precioStr === "" || !isFinite(precio) || precio < 0) {
      msg.textContent = "Precio no válido.";
      return;
    }

    var btnGuardar = document.getElementById("btn-guardar-draft");
    btnGuardar.disabled = true;
    msg.textContent = "Guardando…";

    subirFotos(fotosDraft)
      .then(function (claves) {
        return peticionJson(RUTA_PARTIDA, {
          descripcion: desc,
          tipo: tipoDraft,
          precio: precio,
          fotos: claves,
        });
      })
      .then(function (nueva) {
        var partidaId = nueva && nueva.partidaId;
        var primerArchivo = fotosDraft[0] && fotosDraft[0].file;
        estado.partidas.push({
          partidaId: partidaId,
          descripcion: desc,
          tipo: tipoDraft,
          precio: precio,
          estado: "borrador",
          motivoRechazo: null,
          fotos: (nueva && nueva.fotos) || [],
        });
        if (partidaId && primerArchivo) {
          previewsLocal[partidaId] = URL.createObjectURL(primerArchivo);
        }
        cerrarDraft();
        pintarPartidas();
      })
      .catch(function () {
        msg.textContent = "No se pudo guardar. Revisa tu señal e intenta de nuevo.";
      })
      .then(function () {
        btnGuardar.disabled = false;
      });
  });

  // ── Enviar a autorización ────────────────────────────────────────────
  // NOTA: handler.ts (Task 5) todavía no expone una ruta que mueva partidas
  // de "borrador" a "propuesta" — hoy /api/enviar responde 404. Se deja
  // cableado a la ruta que le correspondería por convención para que
  // encienda en cuanto ese endpoint exista, y falla de forma honesta
  // mientras tanto: nunca finge un envío que no ocurrió.
  document.getElementById("btn-enviar").addEventListener("click", function () {
    var razon = document.getElementById("msg-enviar-razon");
    razon.className = "msg-enviar-razon";
    razon.textContent = "Enviando…";
    fetch(conToken("/api/enviar"), { method: "POST" })
      .then(function (res) {
        if (!res.ok) throw new Error("http-" + res.status);
        return cargar();
      })
      .then(function () {
        razon.className = "msg-enviar-ok";
        razon.textContent = "Enviado a autorización.";
      })
      .catch(function () {
        razon.className = "msg-enviar-razon";
        razon.textContent = "No se pudo enviar todavía. Contacta a GPA si esto sigue pasando.";
      });
  });

  cargar();
})();
</script>
</body>
</html>`;
}
