import { describe, expect, it } from "vitest";
import { mapSolicitud, nivelLabel } from "../src/opsgpa/mapSolicitud";
import type { OpsSolRecord } from "../src/opsgpa/contract";

/**
 * Registro SOL REAL leído de `gpa_operaciones_prod` (2026-07-09, solo-lectura).
 * Sirve como "payload de oro" del contrato: si el mapeo cambia, este test lo detecta.
 */
const REAL_SOL: OpsSolRecord = {
  tipo_reg: "SOL",
  id: "34354ae5d278",
  fecha: "2026-06-04T01:10:03.987775+00:00",
  sucursal: "Guadalajara",
  status: "Aprobada",
  vehicleId: "10",
  economico: "10",
  placas: "JLL5377",
  subMarca: "Matiz 5 Ptas",
  combustible: "Gasolina",
  producto: "TOKA COMBUSTIBLE MAGNA CHIP",
  precio: 26.63,
  tanque: 35,
  km: 77777,
  tankBefore: 0.5,
  tankAfter: 1,
  litros: 18,
  monto: 479,
  necesidad: 0.5,
  responsable: "SANDOVAL FLORES RICARDO",
  userId: 46,
  mail: "mensajerogdl@gpa.com.mx",
  obs: "Prueba ",
  photo: "SOL/5fca5c35d797444dbb060c1b0f4012d8.jpg",
  firma: "SOL/39e6e78e26444ee49159438acc609c16.png",
};

// Resolver falso: simula el nombre final tras copiar S3→S3 (sin tocar AWS).
const fakeResolve = (k: string): string => `opsgpa_${k.replace(/[/.]/g, "_")}`;

describe("mapSolicitud: Ops SOL → CargaCombustible (tipo=solicitud)", () => {
  const out = mapSolicitud(REAL_SOL, fakeResolve);

  it("clave natural idempotente, folio con prefijo OPS-", () => {
    expect(out.tenantId).toBe("gpa");
    expect(out.economicoId).toBe("10");
    expect(out.tipo).toBe("solicitud");
    expect(out.eventoId).toBe("OPS-34354ae5d278");
  });

  it("mapea negocio y normaliza (sucursal, km, fecha a YYYY-MM-DD)", () => {
    expect(out.placa).toBe("JLL5377");
    expect(out.sucursal).toBe("Guadalajara");
    expect(out.kmCapturado).toBe(77777);
    expect(out.montoEstimado).toBe(479);
    expect(out.maxLitros).toBe(18);
    expect(out.tanque).toBe("35");
    expect(out.fecha).toBe("2026-06-04");
    expect(out.fechaHora).toBe("2026-06-04T01:10:03.987775+00:00");
  });

  it("traduce nivel de tanque (fracción → porcentaje)", () => {
    expect(out.nivelAntes).toBe("50%");
    expect(out.nivelDeseado).toBe("100%");
    expect(nivelLabel(undefined)).toBeUndefined();
  });

  it("conserva trazabilidad de fuente y referencias de evidencia", () => {
    const d = JSON.parse(out.datos) as Record<string, unknown>;
    expect(d.fuente).toBe("ops-gpa");
    expect(d.opsId).toBe("34354ae5d278");
    expect(d.producto).toBe("TOKA COMBUSTIBLE MAGNA CHIP");
    const photos = d.photos as Array<{ fname: string }>;
    expect(photos).toHaveLength(2);
    expect(photos[0]!.fname).toContain("opsgpa_");
  });

  it("es idempotente: re-mapear da el mismo folio (no duplica)", () => {
    expect(mapSolicitud(REAL_SOL, fakeResolve).eventoId).toBe(out.eventoId);
  });

  it("rechaza un registro sin económico (evita registros fantasma)", () => {
    expect(() => mapSolicitud({ ...REAL_SOL, economico: "" }, fakeResolve)).toThrow(/económico/);
  });
});
