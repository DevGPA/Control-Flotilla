import { describe, expect, it } from "vitest";
import { parseUbicacion, mapCargaToFuelEntry } from "../src/fuel/mapEntry";

describe("parseUbicacion", () => {
  it("lee la forma real de MoreApp (coordinates.latitude/longitude + formattedValue)", () => {
    const r = parseUbicacion({
      coordinates: { latitude: 25.708031, longitude: -100.179101 },
      location: { descriptiveName: "Oxxo Gas", city: "Guadalupe" },
      formattedValue: "Oxxo Gas, Avenida Adolfo Ruíz Cortines, 67116 Guadalupe, Mexico",
    });
    expect(r.lat).toBeCloseTo(25.708031);
    expect(r.lng).toBeCloseTo(-100.179101);
    expect(r.texto).toContain("Oxxo Gas");
  });

  it("tolera lat/lng planos y números como string", () => {
    expect(parseUbicacion({ lat: "20.67", lng: "-103.35" })).toMatchObject({
      lat: 20.67,
      lng: -103.35,
    });
    expect(parseUbicacion({ latitude: 20.67, longitude: -103.35 })).toMatchObject({
      lat: 20.67,
      lng: -103.35,
    });
    expect(parseUbicacion({ location: { latitude: 20.67, longitude: -103.35 } })).toMatchObject({
      lat: 20.67,
      lng: -103.35,
    });
  });

  it('cae a parsear "lat,lng" del formattedValue', () => {
    const r = parseUbicacion({ formattedValue: "25.708, -100.179" });
    expect(r.lat).toBeCloseTo(25.708);
    expect(r.lng).toBeCloseTo(-100.179);
  });

  it("rechaza coordenadas fuera de rango y basura (solo texto)", () => {
    expect(parseUbicacion({ lat: 95, lng: -100, formattedValue: "x" })).toEqual({ texto: "x" });
    expect(parseUbicacion({ lat: 20, lng: 200, formattedValue: "x" })).toEqual({ texto: "x" });
    expect(parseUbicacion("no es objeto")).toEqual({ texto: undefined });
    expect(parseUbicacion(null)).toEqual({ texto: undefined });
    expect(parseUbicacion({ formattedValue: "Gasolinera Pemex GDL" })).toEqual({
      texto: "Gasolinera Pemex GDL",
    });
  });
});

describe("mapCargaToFuelEntry — ubicación", () => {
  const base = {
    economicoId: "44",
    tipo: "carga",
    eventoId: "E1",
    fecha: "2026-06-20",
    litrosCargados: 40,
  };

  it("pobla ubicacion y ubicacionLatLng desde datos.ubicacionDeCarga", () => {
    const e = mapCargaToFuelEntry({
      ...base,
      datos: {
        ubicacionDeCarga: {
          coordinates: { latitude: 25.7, longitude: -100.1 },
          formattedValue: "Oxxo Gas, Guadalupe",
        },
      },
    });
    expect(e.ubicacion).toBe("Oxxo Gas, Guadalupe");
    expect(e.ubicacionLatLng).toEqual({ lat: 25.7, lng: -100.1 });
  });

  it("tolera datos como JSON string (AppSync entrega el blob serializado)", () => {
    const e = mapCargaToFuelEntry({
      ...base,
      datos: JSON.stringify({
        ubicacionDeCarga: {
          coordinates: { latitude: 25.7, longitude: -100.1 },
          formattedValue: "Oxxo Gas",
        },
      }),
    });
    expect(e.ubicacionLatLng).toEqual({ lat: 25.7, lng: -100.1 });
  });

  it("sin GPS → ambos undefined", () => {
    const e = mapCargaToFuelEntry({ ...base, datos: {} });
    expect(e.ubicacion).toBeUndefined();
    expect(e.ubicacionLatLng).toBeUndefined();
  });
});
