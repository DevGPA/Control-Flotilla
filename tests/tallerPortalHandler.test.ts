import { describe, it, expect } from "vitest";
import {
  MIMES_FOTO,
  TOPE_BYTES_FOTO,
  TOPE_FOTOS_PARTIDA,
  TOPE_PARTIDAS_VISITA,
  ligaRevocada,
  llaveFoto,
  llaveFotoValida,
  validarPartidaEntrante,
  validarTamanoFoto,
} from "../amplify/functions/taller-portal/validacion";

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
