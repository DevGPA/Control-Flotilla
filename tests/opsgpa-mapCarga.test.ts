import { describe, expect, it } from "vitest";
import { mapCarga, mapCombustible } from "../src/opsgpa/mapCarga";
import { esReporteDeCarga, type OpsCargaRecord, type OpsSolRecord } from "../src/opsgpa/contract";

/**
 * Fixture de "reporte de carga" construido contra el contrato del frontend (RepForm,
 * index.html): al 2026-07-09 no hay reportes reales en Ops (los 9 SOL son solicitudes).
 * Re-validar cuando exista el primero.
 */
const REPORTE: OpsCargaRecord = {
  tipo_reg: "SOL",
  formato: "reporte",
  id: "aa11bb22cc33",
  fecha: "2026-07-08T18:30:00.000000+00:00",
  sucursal: "Cancun ", // dato sucio a propósito (espacio) → debe canonizar
  status: "Pendiente",
  vehicleId: "89",
  economico: "89",
  placas: "JB6512A",
  subMarca: "Miller 4.5 5T RS",
  areaResponsable: "LOGISTICA",
  combustible: "Diesel",
  producto: "TOKA COMBUSTIBLE DIESEL CHIP",
  precio: 25.9,
  tanque: 80,
  km: 152340,
  lleno: "Si",
  litros: 62.5,
  precioLitro: 25.9,
  monto: 1618.75,
  ubicacion: { lat: 21.16, lng: -86.85 },
  responsable: "PEREZ LUIS",
  userId: 12,
  mail: "chofercun@gpa.com.mx",
  obs: "carga completa",
  fotoAntes: "SOL/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg",
  fotoDespues: "SOL/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg",
  fotoBomba: "SOL/cccccccccccccccccccccccccccccccc.jpg",
  fotoTicket: "SOL/dddddddddddddddddddddddddddddddd.jpg",
  fotoPersona: "SOL/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.jpg",
  firma: "SOL/ffffffffffffffffffffffffffffffff.png",
};

const resolve = (k: string): string => `opsgpa_${k.replace(/[/.]/g, "_")}`;

describe("mapCarga: reporte de carga → CargaCombustible (tipo=carga)", () => {
  const out = mapCarga(REPORTE, resolve);

  it("clave natural con tipo=carga y folio OPS-", () => {
    expect(out.tipo).toBe("carga");
    expect(out.economicoId).toBe("89");
    expect(out.eventoId).toBe("OPS-aa11bb22cc33");
  });

  it("lleva la medición real (insumos del km/l) y seLlenoTanque", () => {
    expect(out.litrosCargados).toBe(62.5);
    expect(out.precioPorLitro).toBe(25.9);
    expect(out.montoTotal).toBe(1618.75);
    expect(out.seLlenoTanque).toBe("Si");
    expect(out.kmCapturado).toBe(152340);
  });

  it("canoniza sucursal sucia y copia las 6 evidencias", () => {
    expect(out.sucursal).toBe("Cancun");
    const d = JSON.parse(out.datos) as { photos: unknown[]; fuente: string };
    expect(d.photos).toHaveLength(6);
    expect(d.fuente).toBe("ops-gpa");
  });
});

describe("mapCombustible: despacha solicitud vs carga por `formato`", () => {
  const solicitud: OpsSolRecord = {
    tipo_reg: "SOL",
    id: "sol01",
    fecha: "2026-06-04T01:10:03.000000+00:00",
    economico: "10",
    placas: "JLL5377",
    sucursal: "Guadalajara",
    monto: 479,
    litros: 18,
    tankBefore: 0.5,
    tankAfter: 1,
  };

  it("reconoce el discriminador", () => {
    expect(esReporteDeCarga(REPORTE)).toBe(true);
    expect(esReporteDeCarga(solicitud)).toBe(false);
  });

  it("una solicitud → tipo=solicitud; un reporte → tipo=carga", () => {
    expect(mapCombustible(solicitud, resolve).tipo).toBe("solicitud");
    expect(mapCombustible(REPORTE, resolve).tipo).toBe("carga");
  });
});
