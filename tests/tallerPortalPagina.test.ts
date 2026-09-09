import { describe, it, expect } from "vitest";
import { escaparHtml, paginaProveedor } from "../amplify/functions/taller-portal/pagina";
import {
  MIMES_FOTO,
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
