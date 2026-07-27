import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAnuladasActivas,
  esChecklistAnulado,
  esSemanalAnulado,
  moduloDeRefId,
  refIdSemanal,
} from "../src/anulacion/anulacion";
import { buildFuelEntries, type CargaRow } from "../src/fuel/mapEntry";
import type { OpsCargaRecord, OpsClRecord, OpsSolRecord } from "../src/opsgpa/contract";
import { toOpsRecord, type GpaOpsEvento } from "../src/opsgpa/evento";
import { mapAnulacionOps } from "../src/opsgpa/mapAnulacion";
import { mapCombustible } from "../src/opsgpa/mapCarga";
import { mapMensual, mapSemanal } from "../src/opsgpa/mapChecklist";

/**
 * EL RIESGO NÚMERO UNO de anular desde el puente: que el `refId` que escribe el receptor
 * NO sea byte a byte el mismo que consulta la hidratación. El modo de falla es SILENCIOSO
 * — la fila `Anulacion` se guarda, nadie ve un error, y el registro sigue contando.
 *
 * La defensa estructural es que `mapAnulacionOps` reciba el INPUT PERSISTIDO (la salida del
 * mapper), no el registro crudo de Ops: así la clave de la anulación y la de la hidratación
 * salen del mismo campo del mismo objeto. Estas pruebas cierran el círculo ejecutando LAS
 * DOS MITADES REALES — nunca comparan contra un refId escrito a mano (salvo T6, que existe
 * justamente para congelar el formato que asume el HTML legado).
 */
const golden = (n: string): GpaOpsEvento =>
  JSON.parse(readFileSync(join(__dirname, "opsgpa-golden", `${n}.json`), "utf8"));

const resolve = (k: string): string => `opsgpa_${k.replace(/[/.]/g, "_")}`;

const META = {
  status: "Anulado",
  anuladoPor: "administracion@gpa.com.mx",
  ts: "2026-07-24T10:51:51.753655-06:00",
  folioNuevo: "OPS-aaaa1111bbbb",
  ahora: "2026-07-27T12:00:00.000Z",
};

/** CL mensual mínimo: no hay golden de mensual todavía (falta el primer real en Ops). */
function clMensual(): OpsClRecord {
  return {
    id: "abc123def456",
    tipo: "mensual",
    fecha: "2026-07-13T10:30:00-06:00",
    sucursal: "Guadalajara",
    economico: "16",
    placas: "PR3430A",
    answers: {},
  } as OpsClRecord;
}

describe("mapAnulacionOps: solo actúa sobre el status Anulado", () => {
  it("devuelve null para los statuses del flujo normal", () => {
    const carga = mapCombustible(toOpsRecord(golden("sol-creacion")) as OpsSolRecord, resolve);
    for (const status of ["Aprobada", "Rechazada", "Pendiente", "Por corregir", "", undefined]) {
      expect(mapAnulacionOps({ modulo: "combustible", carga }, { ...META, status })).toBeNull();
    }
  });
});

describe("T1 — round-trip de combustible (receptor ↔ hidratación)", () => {
  it("el refId que escribe el receptor SÍ excluye el registro al hidratar", () => {
    const ev = golden("sol-creacion");
    ev.status = "Anulado";
    const carga = mapCombustible(toOpsRecord(ev) as OpsSolRecord, resolve);
    const a = mapAnulacionOps({ modulo: "combustible", carga }, META);
    expect(a).not.toBeNull();

    // La fila se construye DESDE EL MISMO input que se persiste: si cualquiera de los dos
    // lados cambia cómo compone la identidad, esta aserción truena.
    const entries = buildFuelEntries(
      [carga as unknown as CargaRow],
      [],
      undefined,
      buildAnuladasActivas([a!]),
    );
    expect(entries[0]!.anulada).toBeDefined();
    expect(entries[0]!.anulada?.motivo).toContain("OPS-aaaa1111bbbb");
  });

  it("con el refId alterado en UN carácter ya no excluye (el test tiene poder de detección)", () => {
    const ev = golden("sol-creacion");
    ev.status = "Anulado";
    const carga = mapCombustible(toOpsRecord(ev) as OpsSolRecord, resolve);
    const a = mapAnulacionOps({ modulo: "combustible", carga }, META)!;
    const entries = buildFuelEntries(
      [carga as unknown as CargaRow],
      [],
      undefined,
      buildAnuladasActivas([{ ...a, refId: `${a.refId}X` }]),
    );
    expect(entries[0]!.anulada).toBeUndefined();
  });
});

describe("T2 — round-trip de checklist y semanal", () => {
  it("semanal: el refId excluye la fila que consulta la hidratación", () => {
    const ev = golden("cl-semanal-creacion");
    ev.status = "Anulado";
    const { semanal } = mapSemanal(toOpsRecord(ev) as OpsClRecord, resolve);
    const a = mapAnulacionOps({ modulo: "semanal", semanal }, META)!;
    expect(esSemanalAnulado(semanal, buildAnuladasActivas([a]))).toBe(true);
    expect(esSemanalAnulado(semanal, buildAnuladasActivas([{ ...a, refId: `${a.refId}X` }]))).toBe(
      false,
    );
  });

  it("checklist mensual: el refId excluye la fila que consulta la hidratación", () => {
    const { checklist } = mapMensual(clMensual(), resolve);
    const a = mapAnulacionOps({ modulo: "checklist", checklist }, META)!;
    expect(esChecklistAnulado(checklist, buildAnuladasActivas([a]))).toBe(true);
    expect(
      esChecklistAnulado(checklist, buildAnuladasActivas([{ ...a, refId: `${a.refId}X` }])),
    ).toBe(false);
  });
});

describe("T3 — anti-swap de refIdSemanal", () => {
  it("respeta el orden (periodoId, unitUid), que está invertido respecto a checklist", () => {
    const ev = golden("cl-semanal-creacion");
    ev.status = "Anulado";
    const { semanal } = mapSemanal(toOpsRecord(ev) as OpsClRecord, resolve);
    const a = mapAnulacionOps({ modulo: "semanal", semanal }, META)!;
    expect(a.refId).toBe(refIdSemanal(semanal.periodoId, semanal.unitUid));
    // La aserción que atrapa el error: los argumentos invertidos NO deben coincidir.
    expect(a.refId).not.toBe(refIdSemanal(semanal.unitUid, semanal.periodoId));
  });
});

describe("T4 — el campo `modulo` concuerda con el prefijo del refId", () => {
  it("los tres módulos son consistentes", () => {
    const evSol = golden("sol-creacion");
    evSol.status = "Anulado";
    const carga = mapCombustible(toOpsRecord(evSol) as OpsSolRecord, resolve);
    const evCl = golden("cl-semanal-creacion");
    evCl.status = "Anulado";
    const { semanal } = mapSemanal(toOpsRecord(evCl) as OpsClRecord, resolve);
    const { checklist } = mapMensual(clMensual(), resolve);

    // Si `modulo` no concuerda, la exclusión funciona pero el panel de anulados
    // (src/anulacion/ui.ts filtra por `modulo`) no la muestra ni permite restaurarla.
    for (const a of [
      mapAnulacionOps({ modulo: "combustible", carga }, META)!,
      mapAnulacionOps({ modulo: "semanal", semanal }, META)!,
      mapAnulacionOps({ modulo: "checklist", checklist }, META)!,
    ]) {
      expect(moduloDeRefId(a.refId)).toBe(a.modulo);
    }
  });
});

describe("T5 — el discriminador `tipo` viaja en el refId", () => {
  it("un reporte de carga produce |carga| y una solicitud |solicitud|", () => {
    const rep = golden("sol-reporte-creacion");
    rep.status = "Anulado";
    const cargaRep = mapCombustible(toOpsRecord(rep) as OpsCargaRecord, resolve);
    const aRep = mapAnulacionOps({ modulo: "combustible", carga: cargaRep }, META)!;
    expect(aRep.refId).toContain("|carga|");

    const sol = golden("sol-creacion");
    sol.status = "Anulado";
    const cargaSol = mapCombustible(toOpsRecord(sol) as OpsSolRecord, resolve);
    const aSol = mapAnulacionOps({ modulo: "combustible", carga: cargaSol }, META)!;
    expect(aSol.refId).toContain("|solicitud|");
  });

  it("invariante de contrato: el cambio_estado trae la imagen COMPLETA, no un delta", () => {
    // `tipo` sale de `formato` y es parte del refId Y de la clave primaria. Si algún día
    // el publisher mandara un delta sin `formato`, el refId apuntaría a un registro que no
    // existe y la anulación se guardaría SIN EXCLUIR NADA.
    const ev = golden("sol-cambio-estado");
    expect(ev.evento).toBe("cambio_estado");
    expect(Object.keys(ev.answers).length).toBeGreaterThan(3);
    const carga = mapCombustible(toOpsRecord(ev) as OpsSolRecord, resolve);
    expect(carga.kmCapturado).not.toBeUndefined();
  });
});

describe("T6 — congela el formato de refId que asume el HTML legado", () => {
  it("checklist y semanal coinciden con los literales de plantilla del HTML", () => {
    // `Control de flotilla.html` construye estos refIds con literales de plantilla en vez
    // de usar los helpers. Si el formato cambia, las anulaciones hechas desde Inspecciones
    // y Semanales dejan de aplicar. Este es el único literal legítimo del archivo.
    const { checklist } = mapMensual(clMensual(), resolve);
    const aCl = mapAnulacionOps({ modulo: "checklist", checklist }, META)!;
    expect(aCl.refId).toBe(`checklist|${checklist.unitUid}|${checklist.fecha}`);

    const ev = golden("cl-semanal-creacion");
    const { semanal } = mapSemanal(toOpsRecord(ev) as OpsClRecord, resolve);
    const aSem = mapAnulacionOps({ modulo: "semanal", semanal }, META)!;
    expect(aSem.refId).toBe(`semanal|${semanal.periodoId}|${semanal.unitUid}`);
  });
});

describe("T7 — los campos obligatorios de Anulacion salen siempre poblados", () => {
  it("ninguno de los 6 required queda vacío", () => {
    const ev = golden("sol-creacion");
    ev.status = "Anulado";
    const carga = mapCombustible(toOpsRecord(ev) as OpsSolRecord, resolve);
    const a = mapAnulacionOps({ modulo: "combustible", carga }, META)!;
    // Un "" en cualquiera hace que AppSync rechace el create → 500 → reintento → DLQ.
    for (const k of ["tenantId", "refId", "modulo", "motivo", "anuladoPor", "ts"] as const) {
      expect(a[k], k).toBeTruthy();
    }
    expect(a.tenantId).toBe("gpa");
    expect(a.anuladoPor).toBe("administracion@gpa.com.mx · ops-gpa");
    expect(a.ts).toBe(META.ts);
  });

  it("sin ts de Ops cae al reloj inyectado, y sin quién cae al marcador del puente", () => {
    const ev = golden("sol-creacion");
    ev.status = "Anulado";
    const carga = mapCombustible(toOpsRecord(ev) as OpsSolRecord, resolve);
    const a = mapAnulacionOps(
      { modulo: "combustible", carga },
      { status: "Anulado", ahora: META.ahora },
    )!;
    expect(a.ts).toBe(META.ahora);
    expect(a.anuladoPor).toBe("ops-gpa");
  });

  it("sin folio del sustituto el motivo sigue siendo legible (no dice 'undefined')", () => {
    const ev = golden("sol-creacion");
    ev.status = "Anulado";
    const carga = mapCombustible(toOpsRecord(ev) as OpsSolRecord, resolve);
    const a = mapAnulacionOps(
      { modulo: "combustible", carga },
      { status: "Anulado", ahora: META.ahora },
    )!;
    expect(a.motivo).toMatch(/Operaciones-GPA/);
    expect(a.motivo).not.toMatch(/undefined|null/);
  });
});
