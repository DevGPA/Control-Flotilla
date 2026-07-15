import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toOpsRecord, validarEvento, type GpaOpsEvento } from "../src/opsgpa/evento";
import { mapCombustible } from "../src/opsgpa/mapCarga";
import { mapSemanal } from "../src/opsgpa/mapChecklist";
import type { OpsCargaRecord, OpsClRecord, OpsSolRecord } from "../src/opsgpa/contract";

/**
 * PRUEBA DE CONTRATO COMPARTIDA del puente gpa.ops.v1.
 *
 * Los fixtures de tests/opsgpa-golden/ son COPIA LITERAL de los golden del
 * publisher (repo Eco-Admin, Operaciones-GPA/tests/golden/, rama operaciones-gpa
 * @ 3bb1e24) — los mismos que su pytest verifica contra publisher.py. Si cualquiera
 * de los dos lados cambia el contrato, la suite del otro lado truena.
 *
 * Al actualizar: copiar los golden nuevos desde Eco-Admin y correr ambas suites.
 */
const golden = (n: string): GpaOpsEvento =>
  JSON.parse(readFileSync(join(__dirname, "opsgpa-golden", `${n}.json`), "utf8"));

const resolve = (k: string): string => `opsgpa_${k.replace(/[/.]/g, "_")}`;

describe("contrato compartido: los golden del publisher pasan por el receptor", () => {
  it("todos los golden son eventos válidos del contrato", () => {
    for (const n of [
      "sol-creacion",
      "sol-reporte-creacion",
      "cl-semanal-creacion",
      "sol-cambio-estado",
    ]) {
      expect(validarEvento(golden(n)), n).toEqual([]);
    }
  });

  it("sol-creacion → CargaCombustible tipo=solicitud (registro real eco 10)", () => {
    const ev = golden("sol-creacion");
    const out = mapCombustible(toOpsRecord(ev) as OpsSolRecord, resolve);
    expect(out.tipo).toBe("solicitud");
    expect(out.economicoId).toBe("10");
    expect(out.eventoId).toBe(ev.folio);
    expect(out.kmCapturado).toBe(77777);
  });

  it("sol-reporte-creacion → tipo=carga con medición real (el discriminador formato)", () => {
    const ev = golden("sol-reporte-creacion");
    expect(ev.answers.formato).toBe("reporte");
    const out = mapCombustible(toOpsRecord(ev) as OpsCargaRecord, resolve);
    expect(out.tipo).toBe("carga");
    expect(out.litrosCargados).toBe(ev.answers.litros);
    expect(out.seLlenoTanque).toMatch(/^(Si|No)$/); // normalizado (golden booleano / frontend string)
  });

  // El golden cl-semanal-creacion.json se reconstruyó de un registro real de
  // gpa_operaciones_prod (2026-07-13): answers.answers con las llaves reales
  // aceite/radiador/carroceria/llanta_ref. Identidad anonimizada, claves S3 placeholder.
  it("cl-semanal-creacion → Unit + Semanal (registro real eco 10 / JLL5377)", () => {
    const ev = golden("cl-semanal-creacion");
    const { unit, semanal } = mapSemanal(toOpsRecord(ev) as OpsClRecord, resolve);
    expect(unit.placa).toBe("JLL5377");
    expect(semanal.unitUid).toBe("JLL5377");
    expect(semanal.periodoId).toMatch(/^\d{4}-W\d{2}$/);
    const datos = JSON.parse(semanal.datos) as Record<string, unknown>;
    expect(datos.moreappId).toBe(ev.folio);
    expect(datos.fuente).toBe("ops-gpa");
    // El estatus semanal solo lo votan aceite y radiador (regla A1); estas aserciones
    // fallan si el golden no trae las llaves reales o si el mapeo deja de leerlas.
    expect(datos.aceite).toBe("Nivel Optimo");
    expect(datos.radiador).toBe("Nivel Optimo");
    expect(datos.risk).toBe("OK");
  });

  it("semanal: bajar un fluido vital escala el estatus (protege el key-rename del envelope)", () => {
    const ev = golden("cl-semanal-creacion");
    (ev.answers.answers as Record<string, unknown>).aceite = "Sin Nivel";
    const { semanal } = mapSemanal(toOpsRecord(ev) as OpsClRecord, resolve);
    const datos = JSON.parse(semanal.datos) as { aceiteRisk: string; risk: string };
    expect(datos.aceiteRisk).toBe("Revisar");
    expect(datos.risk).toBe("Revisar");
  });

  it("sol-cambio-estado → re-upsert idempotente con la imagen completa", () => {
    const ev = golden("sol-cambio-estado");
    expect(ev.evento).toBe("cambio_estado");
    // Contrato canónico (publisher real): trae el status NUEVO + imagen completa;
    // NO emite estadoAnterior (el receptor no lo necesita: re-upserta la imagen).
    expect(ev.status).toBeTruthy();
    const out = mapCombustible(toOpsRecord(ev) as OpsSolRecord, resolve);
    expect(out.eventoId).toBe(ev.folio); // mismo folio → converge al mismo registro
    expect(out.kmCapturado).not.toBeUndefined(); // imagen COMPLETA, no delta
  });
});
