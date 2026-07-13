import { describe, expect, it } from "vitest";
import { mapCargaToFuelEntry, type CargaRow } from "../src/fuel/mapEntry";

/**
 * Campos de `datos` que consume el export "Solicitudes (Excel)" (réplica MoreApp):
 * observaciones, precioCatalogo, necesidad, emailNotificar y mailSolicitante.
 */

function rowMoreApp(datos: Record<string, unknown>): CargaRow {
  return { economicoId: "56", tipo: "solicitud", eventoId: "12292", datos };
}

describe("mapEntry — campos de datos para el export de solicitudes", () => {
  it("MoreApp: observaciones, precioCatalogo ($26.63→26.63), porcentajeDelTanqueALlenar y email", () => {
    const e = mapCargaToFuelEntry(
      rowMoreApp({
        observaciones: "mañana sale a ruta la paz",
        precioCatalogo: "$26.63",
        porcentajeDelTanqueALlenar: 0.5,
        email: "logisticaalmacenes@gpa.com.mx",
      }),
    );
    expect(e.observaciones).toBe("mañana sale a ruta la paz");
    expect(e.precioCatalogo).toBe(26.63);
    expect(e.necesidad).toBe(0.5);
    expect(e.emailNotificar).toBe("logisticaalmacenes@gpa.com.mx");
    expect(e.mailSolicitante).toBeUndefined();
  });

  it('OPS: precioCatalogo string sin signo ("11"→11), necesidad propia y mail del capturista', () => {
    const e = mapCargaToFuelEntry(
      rowMoreApp({
        precioCatalogo: "11",
        necesidad: 0.75,
        mail: "almty@gpa.com.mx",
      }),
    );
    expect(e.precioCatalogo).toBe(11);
    expect(e.necesidad).toBe(0.75);
    expect(e.mailSolicitante).toBe("almty@gpa.com.mx");
  });

  it("precio con separador de miles y valores ilegibles", () => {
    expect(mapCargaToFuelEntry(rowMoreApp({ precioCatalogo: "$1,225.50" })).precioCatalogo).toBe(
      1225.5,
    );
    expect(
      mapCargaToFuelEntry(rowMoreApp({ precioCatalogo: "N/A" })).precioCatalogo,
    ).toBeUndefined();
    expect(mapCargaToFuelEntry(rowMoreApp({})).precioCatalogo).toBeUndefined();
  });

  it("observaciones vacías o no-string → undefined (no ensucia el export)", () => {
    expect(mapCargaToFuelEntry(rowMoreApp({ observaciones: "  " })).observaciones).toBeUndefined();
    expect(mapCargaToFuelEntry(rowMoreApp({ observaciones: 42 })).observaciones).toBeUndefined();
  });
});
