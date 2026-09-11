import { describe, it, expect } from "vitest";
import { escaparHtml, paginaProveedor } from "../amplify/functions/taller-portal/pagina";
import {
  MIMES_FOTO,
  PRECIO_MAX,
  TOPE_BYTES_FOTO,
  TOPE_FOTOS_PARTIDA,
  TOPE_PARTIDAS_VISITA,
} from "../amplify/functions/taller-portal/validacion";

// Important 3 (revisión de seguridad, ronda 1 de 5): un solo
// `not.toContain("innerHTML")` deja pasar cualquier otro sink peligroso. Un
// tercero (el proveedor del taller, o Riesgos vía motivoRechazo) escribe el
// texto que esta página renderiza — cualquiera de estos sinks aplicado a ese
// texto sería una fuga de XSS hacia el celular del taller o de quien abra la
// liga.
const PATRON_SINK_PELIGROSO =
  /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|srcdoc|javascript:/;

describe("escaparHtml — el texto del taller nunca se pinta como HTML", () => {
  it("neutraliza los cinco caracteres peligrosos", () => {
    expect(escaparHtml('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
    expect(escaparHtml("a & b")).toBe("a &amp; b");
    expect(escaparHtml("it's")).toBe("it&#39;s");
  });

  it("no truena con valores raros", () => {
    expect(escaparHtml(undefined)).toBe("");
    expect(escaparHtml(null)).toBe("");
    expect(escaparHtml(42)).toBe("42");
  });
});

describe("paginaProveedor", () => {
  const p = paginaProveedor("TOKEN.FIRMA");

  it("es un documento completo y responsivo", () => {
    expect(p.startsWith("<!doctype html>")).toBe(true);
    expect(p).toContain('name="viewport"');
    expect(p).toContain("width=device-width");
  });

  it("dice explícitamente que el precio va sin IVA", () => {
    expect(p).toContain("Precio sin IVA");
  });

  it("ofrece los cuatro estados operativos en el idioma del taller", () => {
    for (const t of [
      "Estoy revisando",
      "Ya estoy reparando",
      "Esperando la refacción",
      "Ya está lista",
    ]) {
      expect(p).toContain(t);
    }
  });

  it("no filtra el secreto ni URLs de infraestructura", () => {
    expect(p).not.toMatch(/TALLER_PORTAL_SECRET|amazonaws\.com|lambda-url/);
  });

  it("lleva el token para sus propias llamadas, sin volver a pedirlo", () => {
    expect(p).toContain("TOKEN.FIRMA");
  });

  it("no usa ningún sink de HTML/JS crudo (innerHTML y afines)", () => {
    expect(p).not.toMatch(PATRON_SINK_PELIGROSO);
  });

  // Important 4 (revisión de seguridad, ronda 1 de 5): propiedades de
  // seguridad ya verificadas por el review, ahora fijadas con tests para que
  // una edición futura no pueda relajarlas sin que algo se ponga rojo.
  describe("propiedades de seguridad fijadas (Important 4)", () => {
    it("manda no-referrer explícito, literal", () => {
      expect(p).toContain('<meta name="referrer" content="no-referrer">');
    });

    it("no carga ni referencia nada externo", () => {
      expect(p).not.toMatch(/https?:\/\//);
      expect(p).not.toMatch(/["'(]\/\//);
      expect(p).not.toContain("@import");
      expect(p).not.toContain("url(");
    });

    it("los cuatro data-estado calzan EXACTO con el allowlist de actualizarVisita", () => {
      // Un typo aquí (p.ej. "esperandorefaccion" sin la R mayúscula) pasaría
      // cualquier revisión visual — el botón se ve y dice lo correcto — pero
      // el fetch a POST /api/visita llegaría con un valor que el allowlist
      // del handler rechaza, y ese estado nunca se guardaría.
      for (const v of ["revisando", "reparando", "esperandoRefaccion", "lista"]) {
        expect(p).toContain(`data-estado="${v}"`);
      }
    });

    it("el botón de enviar nace deshabilitado en el HTML estático", () => {
      const btn = /<button id="btn-enviar"[^>]*>/.exec(p);
      expect(btn).not.toBeNull();
      expect(btn?.[0]).toMatch(/\bdisabled\b/);
    });

    it("los topes que ve el proveedor son los mismos que valida el servidor (./validacion)", () => {
      // Se compara contra las constantes importadas, no contra literales: si
      // validacion.ts cambia un tope, este test debe seguir en verde sin
      // tocarlo — y si pagina.ts se desincroniza de esas constantes, debe
      // ponerse en rojo.
      expect(p).toContain(String(TOPE_FOTOS_PARTIDA));
      expect(p).toContain(String(TOPE_BYTES_FOTO));
      expect(p).toContain(String(TOPE_PARTIDAS_VISITA));
      for (const mime of MIMES_FOTO) {
        expect(p).toContain(mime);
      }
    });
  });
});

// ── A-6 — el script servido es ES5, sin excepciones ────────────────────────
// El portal se abre en el celular de un taller mexicano: un WebView Android
// anterior a Chrome 80 no PARSEA `??`, y un fallo de parseo tumba la IIFE
// entera — ningún listener se ata y la pantalla se queda en "Cargando…" para
// siempre, en silencio. Los dos `??` que había eran las ÚNICAS dos sintaxis
// post-ES5 de todo el script; esta prueba impide que vuelvan.
describe("conformidad ES5 del <script> servido (A-6)", () => {
  const pagina = paginaProveedor("tok");
  const servido = pagina.slice(pagina.indexOf("<script>") + 8, pagina.lastIndexOf("</script>"));
  // Se revisa el CÓDIGO, no los comentarios: lo que hace fallar el parseo es la
  // sintaxis, y un comentario que menciona "??" o "Cargando..." no es sintaxis.
  const script = servido.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("el script existe y es sustancial (guarda del propio test)", () => {
    expect(script.length).toBeGreaterThan(2000);
    expect(script).toContain('"use strict"');
    // Guarda del propio test: el recorte de arriba tiene que haber dejado el
    // cuerpo real, no solo la cáscara.
    expect(script).toContain("addEventListener");
    expect(script).toContain("btn-guardar-draft");
  });

  const prohibidos: Array<[string, RegExp]> = [
    ["coalescencia nula (??)", /\?\?/],
    ["encadenamiento opcional (?.)", /\?\.[A-Za-z_$[(]/],
    ["arrow function (=>)", /=>/],
    ["const", /(^|[^A-Za-z0-9_$])const\s+[A-Za-z_$]/],
    ["let", /(^|[^A-Za-z0-9_$])let\s+[A-Za-z_$]/],
    ["template literal (`)", /`/],
    ["class", /(^|[^A-Za-z0-9_$])class\s+[A-Za-z_$]/],
    ["spread/rest (...)", /\.\.\./],
  ];
  for (const [nombre, re] of prohibidos) {
    it(`no usa ${nombre}`, () => {
      expect(re.test(script), `el script servido usa ${nombre}`).toBe(false);
    });
  }
});

// ── Tope de precio del lado cliente ─────────────────────────────────────────
describe("PRECIO_MAX viaja por data-* y se valida ANTES de subir fotos", () => {
  const p = paginaProveedor("tok");

  it("el tope viaja en el mismo <meta> que los demás, nunca horneado en el script", () => {
    expect(p).toContain(`data-precio-max="${PRECIO_MAX}"`);
    expect(p).toContain('metaConfig.getAttribute("data-precio-max")');
  });

  it("el guardado corta por tope ANTES de firmar/subir — nada de 60 MB huérfanos", () => {
    const iBoton = p.indexOf('document.getElementById("btn-guardar-draft")');
    const bloque = p.slice(iBoton);
    const iTope = bloque.indexOf("precio > PRECIO_MAX");
    const iSubir = bloque.indexOf("subirFotos(fotosDraft)");
    expect(iTope).toBeGreaterThan(-1);
    expect(iSubir).toBeGreaterThan(-1);
    expect(iTope).toBeLessThan(iSubir);
  });
});

// ── El <noscript> y el catch del guardado ──────────────────────────────────
describe("la página falla de forma visible, no en blanco", () => {
  const p = paginaProveedor("tok");

  it("tiene <noscript> — misma falla silenciosa que el `??` de A-6", () => {
    expect(p).toContain("<noscript>");
    expect(p).toMatch(/<noscript>[\s\S]*JavaScript[\s\S]*<\/noscript>/);
  });

  it('el catch de "No se pudo guardar" NO envuelve el render posterior al éxito', () => {
    const iBoton = p.indexOf('document.getElementById("btn-guardar-draft").addEventListener');
    const bloque = p.slice(iBoton, iBoton + 3000);
    const iCatchGuardado = bloque.indexOf("No se pudo guardar.");
    const iPintar = bloque.indexOf("pintarPartidas();");
    expect(iCatchGuardado).toBeGreaterThan(-1);
    expect(iPintar).toBeGreaterThan(-1);
    // El catch del guardado va ANTES del render: un throw al pintar ya no puede
    // caer en el mensaje que dice que no se guardó.
    expect(iCatchGuardado).toBeLessThan(iPintar);
    expect(bloque).toContain("Se guardó, pero no se pudo actualizar la lista.");
  });

  it("el comentario rancio de /api/enviar (404) ya no está: la ruta existe desde 6b", () => {
    expect(p).not.toContain("hoy /api/enviar responde 404");
  });
});
