import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  toOpsRecord,
  validarEvento,
  verificarFirma,
  type GpaOpsEvento,
} from "../src/opsgpa/evento";
import { mapCombustible } from "../src/opsgpa/mapCarga";
import { mapSolicitud } from "../src/opsgpa/mapSolicitud";
import type { OpsCargaRecord, OpsSolRecord } from "../src/opsgpa/contract";

/**
 * Espejo del publisher REAL (Eco-Admin e7c3d25, bridge/publisher.py::construir_evento):
 * misma lista _CAMPOS_INFRA y misma promoción de campos al envelope. Si el publisher
 * cambia su envelope, este espejo y el fixture de oro deben actualizarse juntos.
 */
const CAMPOS_INFRA = new Set([
  "PK",
  "SK",
  "GSI1PK",
  "GSI1SK",
  "GSI2PK",
  "GSI2SK",
  "GSI3PK",
  "GSI3SK",
  "id",
  "tipo_reg",
  "fecha",
  "sucursal",
  "accountId",
  "vehicleId",
  "placas",
  "economico",
  "userId",
  "responsable",
  "firma",
]);

const KEY_EVIDENCIA = /^(SOL|CL|MC|FRM)\/[0-9a-f]{32}\.(jpg|png|webp)$/;

function construirEventoComoPublisher(item: Record<string, unknown>, evento: string): GpaOpsEvento {
  const tipo = String(item.tipo_reg ?? String(item.PK ?? "").split("#")[0]);
  const answers = Object.fromEntries(Object.entries(item).filter(([k]) => !CAMPOS_INFRA.has(k)));
  const evidencias: Array<{ campo: string; key: string }> = [];
  const walk = (obj: unknown, ruta: string) => {
    if (typeof obj === "string" && KEY_EVIDENCIA.test(obj))
      evidencias.push({ campo: ruta || "?", key: obj });
    else if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj)) walk(v, ruta ? `${ruta}.${k}` : k);
    }
  };
  walk(answers, "");
  const firma =
    typeof item.firma === "string" && KEY_EVIDENCIA.test(item.firma) ? item.firma : null;
  return {
    version: 1,
    contrato: "gpa.ops.v1",
    tipo,
    subtipo: tipo === "CL" ? ((item.tipo as string) ?? null) : null,
    evento: evento as GpaOpsEvento["evento"],
    registroId: String(item.id),
    folio: `OPS-${String(item.id)}`,
    fechaISO: String(item.fecha),
    sucursal: (item.sucursal as string) ?? null,
    unidad: {
      vehicleId: (item.vehicleId as string) ?? null,
      economico: (item.economico as string) ?? null,
      placas: (item.placas as string) ?? null,
    },
    responsable: {
      nombre: (item.responsable as string) ?? null,
      userId: (item.userId as string | number) ?? null,
      accountId: (item.accountId as string) ?? null,
    },
    status: (item.status as string) ?? null,
    answers,
    evidencias,
    firma,
    bucketOrigen: "gpa-ops-evidencias-prod-149857424311",
    emitidoEn: "2026-07-10T00:00:00+00:00",
  };
}

/** Registro SOL REAL de gpa_operaciones_prod (mismo fixture de oro de los otros tests). */
const REAL_SOL: OpsSolRecord & { PK: string; SK: string } = {
  PK: "SOL#34354ae5d278",
  SK: "META",
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

const REPORTE: OpsCargaRecord & { PK: string; SK: string } = {
  PK: "SOL#aa11bb22cc33",
  SK: "META",
  tipo_reg: "SOL",
  formato: "reporte",
  id: "aa11bb22cc33",
  fecha: "2026-07-08T18:30:00.000000+00:00",
  sucursal: "Cancun",
  status: "Pendiente",
  vehicleId: "89",
  economico: "89",
  placas: "JB6512A",
  subMarca: "Miller 4.5 5T RS",
  combustible: "Diesel",
  producto: "TOKA COMBUSTIBLE DIESEL CHIP",
  precio: 25.9,
  tanque: 80,
  km: 152340,
  lleno: "Si",
  litros: 62.5,
  precioLitro: 25.9,
  monto: 1618.75,
  responsable: "PEREZ LUIS",
  userId: 12,
  obs: "carga completa",
  fotoBomba: "SOL/cccccccccccccccccccccccccccccccc.jpg",
  firma: "SOL/ffffffffffffffffffffffffffffffff.png",
};

const resolve = (k: string): string => `opsgpa_${k.replace(/[/.]/g, "_")}`;

describe("toOpsRecord: envelope del publisher real → registro plano", () => {
  it("EQUIVALENCIA: mapear el envelope ≡ mapear el registro original de la tabla", () => {
    const envelope = construirEventoComoPublisher(REAL_SOL, "creacion");
    const viaEnvelope = mapCombustible(toOpsRecord(envelope) as OpsSolRecord, resolve);
    const directo = mapSolicitud(REAL_SOL, resolve);
    expect(viaEnvelope).toEqual(directo); // mismo CargaCombustible, byte a byte
  });

  it("el discriminador formato sobrevive el viaje por el envelope (SOL→carga)", () => {
    const envelope = construirEventoComoPublisher(REPORTE, "creacion");
    expect(envelope.answers.formato).toBe("reporte"); // el publisher lo deja en answers
    const out = mapCombustible(toOpsRecord(envelope) as OpsCargaRecord, resolve);
    expect(out.tipo).toBe("carga");
    expect(out.litrosCargados).toBe(62.5);
    expect(out.seLlenoTanque).toBe("Si");
    expect(out.eventoId).toBe("OPS-aa11bb22cc33");
  });

  it("CL: restaura subtipo como `tipo` del registro plano", () => {
    const cl = {
      PK: "CL#88d8c62e3378",
      SK: "META",
      tipo_reg: "CL",
      id: "88d8c62e3378",
      tipo: "semanal",
      fecha: "2026-07-09T19:00:03+00:00",
      sucursal: "Guadalajara",
      status: "Aprobado",
      vehicleId: "16",
      economico: "16",
      placas: "PR3430A",
      responsable: "Oscar Cabrera",
      userId: "administracion@gpa.com.mx",
      km: 11,
      answers: { radiador: "Nivel Optimo" },
      firma: "CL/e192065547a64740b9b87f42e522ad63.png",
    };
    const plano = toOpsRecord(construirEventoComoPublisher(cl, "creacion"));
    expect(plano.tipo_reg).toBe("CL");
    expect((plano as { tipo?: string }).tipo).toBe("semanal");
    expect((plano as { answers?: Record<string, unknown> }).answers?.radiador).toBe("Nivel Optimo");
    expect(plano.firma).toBe(cl.firma);
  });

  it("validarEvento: acepta el envelope real y rechaza tipos no implementados", () => {
    const ok = construirEventoComoPublisher(REAL_SOL, "creacion");
    expect(validarEvento(ok)).toEqual([]);
    expect(validarEvento({ ...ok, tipo: "MC" })).toContain("tipo no implementado: MC");
    expect(validarEvento({ ...ok, contrato: "otro" })[0]).toMatch(/contrato desconocido/);
  });
});

describe("verificarFirma: headers del publisher real (X-GPA-Timestamp / X-GPA-Firma)", () => {
  it("vector anclado del contrato", () => {
    // HMAC('test-secret', '1752000000.{"a":1}') — mismo vector del lado Python.
    const v = verificarFirma(
      "1752000000",
      "18280ef824e838621e734ceb8a915ad81b781e7f45bc700b6bd0f7832453a664",
      '{"a":1}',
      "test-secret",
      1752000000,
    );
    expect(v.ok).toBe(true);
  });

  it("firma real de un envelope completo (round-trip con el mismo algoritmo)", () => {
    const envelope = construirEventoComoPublisher(REAL_SOL, "creacion");
    const cuerpo = JSON.stringify(envelope); // el publisher firma los bytes que envía
    const ts = "1760000000";
    const hex = createHmac("sha256", "s3cr3t").update(`${ts}.${cuerpo}`).digest("hex");
    expect(verificarFirma(ts, hex, cuerpo, "s3cr3t", 1760000000).ok).toBe(true);
    // cuerpo alterado en un byte → rechazo
    expect(verificarFirma(ts, hex, cuerpo + " ", "s3cr3t", 1760000000).ok).toBe(false);
  });

  it("anti-replay: rechaza timestamps fuera de ±300 s", () => {
    const r = verificarFirma("1752000000", "0".repeat(64), "{}", "x", 1752000000 + 301);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/anti-replay/);
  });

  it("rechaza sin secreto o sin headers (fail-closed)", () => {
    expect(verificarFirma("1", "0".repeat(64), "{}", "").ok).toBe(false);
    expect(verificarFirma(undefined, undefined, "{}", "x").ok).toBe(false);
  });
});
