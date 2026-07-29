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
    const d = JSON.parse(out.datos) as {
      photos: unknown[];
      fuente: string;
      areaResponsable: string;
    };
    expect(d.photos).toHaveLength(6);
    expect(d.fuente).toBe("ops-gpa");
    // Preservado en datos → FuelEntry.areaCarga (área que solicitó la carga).
    expect(d.areaResponsable).toBe("LOGISTICA");
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

/**
 * Vínculo solicitud ↔ carga (Ops lo implementó el 2026-07-28; verificado en prod: 11/11
 * reportes nuevos apuntan a una solicitud existente). Resuelve EN EL ORIGEN el 69 % de
 * emparejamientos ambiguos que medimos al intentar casarlos por económico y fecha.
 *
 * ⚠️ LA TRAMPA: Ops manda DOS campos y el más cómodo es el equivocado.
 *      solicitudId    = "08f0553fee77"        ← este
 *      folioSolicitud = "SOL-08F0553FEE77"    ← este NO
 * `folioSolicitud` falla por partida doble contra la convención de FC: prefijo `SOL-` en
 * vez de `OPS-`, y MAYÚSCULAS. Verificado contra prod: `OPS-08f0553fee77` existe,
 * `OPS-08F0553FEE77` y `SOL-08F0553FEE77` no. Usarlo tal cual no encuentra nada y no
 * levanta ningún error — falla en silencio.
 */
describe("mapCarga: enlace con la solicitud de origen", () => {
  const conEnlace = (extra: Record<string, unknown>): Record<string, unknown> => {
    const datos = JSON.parse(
      mapCarga({ ...REPORTE, ...extra } as OpsCargaRecord, resolve).datos,
    ) as Record<string, unknown>;
    return datos;
  };

  it("estampa el folio en la convención de FC, derivado del id crudo", () => {
    const datos = conEnlace({
      solicitudId: "08f0553fee77",
      folioSolicitud: "SOL-08F0553FEE77",
    });
    expect(datos.solicitudFolio).toBe("OPS-08f0553fee77");
  });

  it("NO adopta el folioSolicitud de Ops (prefijo y caja incompatibles con FC)", () => {
    const datos = conEnlace({
      solicitudId: "08f0553fee77",
      folioSolicitud: "SOL-08F0553FEE77",
    });
    expect(datos.solicitudFolio).not.toBe("SOL-08F0553FEE77");
    expect(String(datos.solicitudFolio)).not.toMatch(/^SOL-/);
    expect(String(datos.solicitudFolio)).not.toMatch(/[A-Z]{4}/); // sin tramos en mayúsculas
  });

  it("una carga sin solicitud de origen no inventa el campo", () => {
    const datos = conEnlace({});
    expect(datos.solicitudFolio).toBeUndefined();
  });

  it("tolera que solo venga folioSolicitud, normalizando prefijo y caja", () => {
    // Defensa por si algún día mandan el folio sin el id crudo.
    const datos = conEnlace({ folioSolicitud: "SOL-08F0553FEE77" });
    expect(datos.solicitudFolio).toBe("OPS-08f0553fee77");
  });
});
