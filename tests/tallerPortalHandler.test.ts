import { describe, it, expect } from "vitest";
import {
  MIMES_FOTO,
  TOPE_FOTOS_PARTIDA,
  TOPE_PARTIDAS_VISITA,
  llaveFoto,
  validarPartidaEntrante,
} from "../amplify/functions/taller-portal/handler";

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
