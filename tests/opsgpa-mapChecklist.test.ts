import { describe, expect, it } from "vitest";
import { isoWeekId, mapSemanal } from "../src/opsgpa/mapChecklist";
import type { OpsClRecord } from "../src/opsgpa/contract";

/** Checklist CL REAL de gpa_operaciones_prod (88d8c62e3378, leído 2026-07-09). */
const REAL_CL: OpsClRecord = {
  tipo_reg: "CL",
  id: "88d8c62e3378",
  tipo: "semanal",
  fecha: "2026-07-09T19:00:03.456755+00:00",
  sucursal: "Guadalajara",
  status: "Aprobado",
  vehicleId: "16",
  economico: "16",
  placas: "PR3430A",
  subMarca: "F-350 Chas Cabina Xl",
  km: 11,
  responsable: "Oscar Cabrera Rodriguez",
  userId: "administracion@gpa.com.mx",
  obs: "NA",
  fotoKm: "CL/72bf2673751f4b698950a89e5d53b670.jpg",
  firma: "CL/e192065547a64740b9b87f42e522ad63.png",
  answers: {
    carroceria: "Sin daños",
    radiador: "Nivel Optimo",
    llanta_ref: "Si",
    f_frente_d: "CL/9cdbe31a7d0948cab40d4056a0e6eb00.jpg",
    f_radiador: "CL/edab420e3fd949af96b77e9477518dd0.jpg",
  },
};

const resolve = (k: string): string => `opsgpa_${k.replace(/[/.]/g, "_")}`;

describe("isoWeekId (en sync con el webhook)", () => {
  it("calcula la semana ISO correcta", () => {
    expect(isoWeekId("2026-07-09T19:00:03+00:00")).toBe("2026-W28");
    expect(isoWeekId("2026-01-01")).toBe("2026-W01");
    expect(isoWeekId("basura")).toBe("sin-fecha");
  });
});

describe("mapSemanal: CL real de Ops → Unit + Semanal de Fleet Command", () => {
  const { unit, semanal } = mapSemanal(REAL_CL, resolve);
  const datos = JSON.parse(semanal.datos) as Record<string, unknown>;

  it("claves naturales idempotentes (placa + semana ISO)", () => {
    expect(unit).toEqual({
      tenantId: "gpa",
      placa: "PR3430A",
      economicoId: "16",
      marca: "F-350 Chas Cabina Xl",
      sucursal: "Guadalajara",
    });
    expect(semanal.periodoId).toBe("2026-W28");
    expect(semanal.unitUid).toBe("PR3430A");
    expect(semanal.tenantId).toBe("gpa");
  });

  it("los motores canónicos entienden el vocabulario de Ops sin traducción", () => {
    expect(datos.radiadorRisk).toBe("OK"); // "Nivel Optimo"
    expect(datos.carroceriaRisk).toBe("OK"); // "Sin daños"
    expect(datos.llantaRisk).toBe("OK"); // "Si"
    // aceite no viene en este CL real → "" → OK (misma tolerancia que el webhook)
    expect(datos.aceiteRisk).toBe("OK");
    expect(datos.risk).toBe("OK");
  });

  it("vocabulario de riesgo: niveles bajos y daños escalan igual que en MoreApp", () => {
    const conProblemas = {
      ...REAL_CL,
      answers: {
        ...REAL_CL.answers,
        radiador: "Sin Nivel",
        aceite: "Bajo",
        carroceria: "Con Raspaduras/Golpes",
        llanta_ref: "No",
      },
    };
    const d = JSON.parse(mapSemanal(conProblemas, resolve).semanal.datos) as Record<
      string,
      unknown
    >;
    expect(d.radiadorRisk).toBe("Revisar");
    expect(d.aceiteRisk).toBe("Revisar");
    expect(d.carroceriaRisk).toBe("Revisar");
    expect(d.llantaRisk).toBe("Revisar");
    expect(d.risk).toBe("Revisar"); // vitales (aceite/radiador) votan
  });

  it("junta todas las fotos (fotoKm + answers + firma) como fnames", () => {
    expect(datos.photos).toEqual([
      "opsgpa_CL_72bf2673751f4b698950a89e5d53b670_jpg",
      "opsgpa_CL_9cdbe31a7d0948cab40d4056a0e6eb00_jpg",
      "opsgpa_CL_edab420e3fd949af96b77e9477518dd0_jpg",
      "opsgpa_CL_e192065547a64740b9b87f42e522ad63_png",
    ]);
  });

  it("trazabilidad: folio OPS- visible y fuente marcada", () => {
    expect(datos.moreappId).toBe("OPS-88d8c62e3378");
    expect(datos.fuente).toBe("ops-gpa");
  });

  it("rechaza mensual (no implementado) y registros sin placa", () => {
    expect(() => mapSemanal({ ...REAL_CL, tipo: "mensual" }, resolve)).toThrow(/no implementado/);
    expect(() => mapSemanal({ ...REAL_CL, placas: "" }, resolve)).toThrow(/sin placas/);
  });
});
