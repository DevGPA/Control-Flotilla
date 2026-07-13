import { describe, expect, it } from "vitest";
import { mapMensual } from "../src/opsgpa/mapChecklist";
import type { OpsClRecord } from "../src/opsgpa/contract";

// Adaptador CL mensual de Operaciones-GPA → Unit + Checklist (analyzeRow canónico).
// Fixture = answers con los itemIds REALES de MENSUAL_SEC (Eco-Admin frontend) y los
// vocabularios de sus opts (TACO 1-10, Si/No, DOC_OPTS, NIVEL_OPTS).

const resolver = (key: string): string => `opsgpa_${key.replace(/[/.]/g, "_")}`;

/** Registro CL mensual sano (sin hallazgos) — base de los casos. */
function base(): OpsClRecord {
  return {
    id: "abc123def456",
    tipo: "mensual",
    fecha: "2026-07-13T10:30:00-06:00",
    sucursal: "Guadalajara",
    economico: "16",
    placas: "PR3430A",
    subMarca: "Aumark S6",
    responsable: "PEREZ LOPEZ JUAN",
    km: 45210,
    status: "Aprobado",
    obs: "Todo en orden",
    fotoKm: "CL/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg",
    firma: "FRM/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png",
    answers: {
      // Llantas (sanas)
      taco_pd: 8,
      taco_cd: 9,
      taco_pt: 8,
      taco_ct: 8,
      pt_int: "No",
      ct_int: "No",
      refacc: "Si",
      taco_ref: 7,
      f_pd: "CL/cccccccccccccccccccccccccccccccc.jpg",
      // Exterior
      carroceria: "Sin daños",
      // Luces / interior / herramientas (todo bien)
      luces_d: "Si",
      espejos: "Si",
      cristales: "Si",
      molduras: "Si",
      tapon: "Si",
      claxon: "Si",
      limpiaparab: "Si",
      tacometro: "Si",
      retrovisor: "Si",
      cinturones: "Si",
      luces_int: "Si",
      asientos: "Si",
      tapetes: "Si",
      gato: "Si",
      llave_cruz: "Si",
      triangulo: "Si",
      cables: "Si",
      // Documentación (vigente)
      tarj_circ: "Si vigente",
      poliza: "Si vigente",
      refrendo: "Si",
      verif: "Si vigente",
      licencia: "Si vigente",
      calcomonia: "Si",
      // Cofre (niveles óptimos)
      liq_frenos: "Nivel Optimo",
      aceite_motor: "Nivel Optimo",
      radiador: "Nivel Optimo",
      aceite_dir: "Nivel Optimo",
      // Servicio con buffer amplio
      km_sig_serv: 50000,
      fecha_sig_serv: "2027-01-15",
    },
  } as unknown as OpsClRecord;
}

function resultadosDe(ops: OpsClRecord) {
  const { checklist } = mapMensual(ops, resolver);
  return JSON.parse(checklist.resultados) as {
    findings: Array<{ cat: string; key: string; lv: string; text: string }>;
    tires: Record<string, number>;
    risk: string;
    max: string;
    minT: number | null;
    validationErrors: string[];
    obs: string;
    km: string;
    nextSvc: string;
    kmNextSvc: string;
    moreappId: string;
    photos: Array<{ group: string; col: string; fname: string }>;
    fuente: string;
  };
}

describe("mapMensual: CL mensual de Ops → Unit + Checklist (analyzeRow)", () => {
  it("unidad sana → OK, sin hallazgos, identidad y shape del webhook", () => {
    const { unit, checklist } = mapMensual(base(), resolver);
    expect(unit).toEqual({
      tenantId: "gpa",
      placa: "PR3430A",
      economicoId: "16",
      marca: "Aumark S6",
      sucursal: "Guadalajara",
    });
    expect(checklist.tenantId).toBe("gpa");
    expect(checklist.unitUid).toBe("PR3430A");
    expect(checklist.fecha).toBe("2026-07-13"); // solo el día (identifier estable)
    expect(checklist.tipoInspeccion).toBe("mensual");
    expect(checklist.responsable).toBe("PEREZ LOPEZ JUAN");
    const r = resultadosDe(base());
    expect(r.risk).toBe("OK");
    expect(r.findings).toHaveLength(0);
    expect(r.tires).toMatchObject({
      "Piloto Delantera": 8,
      "Copiloto Delantera": 9,
      "Piloto Trasera": 8,
      "Copiloto Trasera": 8,
      Refacción: 7,
    });
    expect(r.minT).toBe(7);
    expect(r.km).toBe("45210");
    expect(r.kmNextSvc).toBe("50000");
    expect(r.nextSvc).toBe("2027-01-15");
    expect(r.moreappId).toBe("OPS-abc123def456");
    expect(r.fuente).toBe("ops-gpa");
    expect(r.validationErrors).toHaveLength(0);
  });

  it("TACO 1-10 son mm directos: 2 → Urgente; 5 → Revisar", () => {
    const ops = base();
    (ops.answers as Record<string, unknown>).taco_pd = 2;
    (ops.answers as Record<string, unknown>).taco_ct = 5;
    const r = resultadosDe(ops);
    expect(r.risk).toBe("Urgente");
    expect(r.findings).toContainEqual(
      expect.objectContaining({ cat: "Llantas", key: "Llanta:Piloto Delantera", lv: "Urgente" }),
    );
    expect(r.findings).toContainEqual(
      expect.objectContaining({ cat: "Llantas", key: "Llanta:Copiloto Trasera", lv: "Revisar" }),
    );
    expect(r.minT).toBe(2);
  });

  it('"Sin Nivel" en frenos (peor caso NIVEL_OPTS) → Urgente pese a no contener "bajo"', () => {
    const ops = base();
    (ops.answers as Record<string, unknown>).liq_frenos = "Sin Nivel";
    const r = resultadosDe(ops);
    expect(r.risk).toBe("Urgente");
    expect(r.findings).toContainEqual(expect.objectContaining({ cat: "Fluidos", lv: "Urgente" }));
  });

  it('"Muy Bajo" en dirección → Revisar; "Bajo" en aceite de motor → Urgente', () => {
    const ops = base();
    (ops.answers as Record<string, unknown>).aceite_dir = "Muy Bajo";
    (ops.answers as Record<string, unknown>).aceite_motor = "Bajo";
    const r = resultadosDe(ops);
    expect(r.findings).toContainEqual(
      expect.objectContaining({
        cat: "Fluidos",
        key: "Fluido:Nivel de aceite de direccion max",
        lv: "Revisar",
      }),
    );
    expect(r.findings).toContainEqual(
      expect.objectContaining({
        cat: "Fluidos",
        key: "Fluido:Nivel de aceite de motor max",
        lv: "Urgente",
      }),
    );
  });

  it('DOC_OPTS: "Vencido" y "No cuenta" → Documentos/Completar; "Si vigente" pasa', () => {
    const ops = base();
    (ops.answers as Record<string, unknown>).poliza = "Vencido";
    (ops.answers as Record<string, unknown>).licencia = "No cuenta";
    const r = resultadosDe(ops);
    const docs = r.findings.filter((f) => f.cat === "Documentos");
    expect(docs).toHaveLength(2);
    expect(docs.every((f) => f.lv === "Completar")).toBe(true);
    expect(r.risk).toBe("Completar");
  });

  it('carrocería "Con Raspaduras/Golpes" → Checklist/Completar; BIN "No" → su nivel', () => {
    const ops = base();
    (ops.answers as Record<string, unknown>).carroceria = "Con Raspaduras/Golpes";
    (ops.answers as Record<string, unknown>).luces_d = "No"; // Urgente en la matriz
    (ops.answers as Record<string, unknown>).retrovisor = "No"; // Revisar
    const r = resultadosDe(ops);
    expect(r.findings).toContainEqual(
      expect.objectContaining({
        key: "Bin:Carroceria con golpes o raspaduras",
        lv: "Completar",
      }),
    );
    expect(r.findings).toContainEqual(
      expect.objectContaining({
        key: "Bin:Luces y cuartos delanteros funcionando",
        lv: "Urgente",
      }),
    );
    expect(r.risk).toBe("Urgente");
  });

  it("gating: sin refacción → Completar y su TACO no cuenta; internas 'No' se saltan", () => {
    const ops = base();
    (ops.answers as Record<string, unknown>).refacc = "No";
    delete (ops.answers as Record<string, unknown>).taco_ref;
    const r = resultadosDe(ops);
    expect(r.findings).toContainEqual(
      expect.objectContaining({ key: "Chk:Refaccion", lv: "Completar" }),
    );
    expect(r.tires["Refacción"]).toBeUndefined();
    expect(r.tires["Piloto Trasera Int."]).toBeUndefined(); // pt_int:"No" del base
  });

  it("servicio por km: buffer agotado → Revisar (vencido)", () => {
    const ops = base();
    (ops.answers as Record<string, unknown>).km_sig_serv = 45000; // < km actual 45210
    const r = resultadosDe(ops);
    expect(r.findings).toContainEqual(
      expect.objectContaining({ cat: "Mantenimiento", key: "Mant:Servicio", lv: "Revisar" }),
    );
  });

  it("fotos: fotoKm+firma+answers con {group,col}; golpes array (objetos o keys)", () => {
    const ops = base();
    (ops.answers as Record<string, unknown>).golpes = [
      { desc: "rayón puerta", foto: "CL/dddddddddddddddddddddddddddddddd.jpg" },
      "CL/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.jpg",
      { desc: "sin foto" }, // tolerado: sin key de evidencia
    ];
    const r = resultadosDe(ops);
    const cols = r.photos.map((p) => p.col);
    expect(cols).toContain("Foto kilometraje");
    expect(cols).toContain("Firma");
    expect(cols).toContain("Foto piloto delantera");
    expect(r.photos.filter((p) => p.col === "Foto daño")).toHaveLength(2);
    // nombres resueltos por el resolver (determinísticos del puente)
    expect(r.photos.every((p) => p.fname.startsWith("opsgpa_"))).toBe(true);
  });

  it("obs combina obs del registro + comentario de radiador", () => {
    const ops = base();
    (ops.answers as Record<string, unknown>).com_radiador = "Radiador con sarro leve";
    const r = resultadosDe(ops);
    expect(r.obs).toBe("Todo en orden\n\nRadiador con sarro leve");
  });

  it("errores de negocio: sin placas / sin fecha / subtipo equivocado → throw (422)", () => {
    const sinPlaca = { ...base(), placas: "" };
    expect(() => mapMensual(sinPlaca, resolver)).toThrow(/sin placas/);
    const sinFecha = { ...base(), fecha: "" };
    expect(() => mapMensual(sinFecha, resolver)).toThrow(/sin fecha/);
    const semanal = { ...base(), tipo: "semanal" } as OpsClRecord;
    expect(() => mapMensual(semanal, resolver)).toThrow(/recibió tipo/);
  });

  it("llantas incompletas (faltan TACOs) → validationError, no throw", () => {
    const ops = base();
    const a = ops.answers as Record<string, unknown>;
    delete a.taco_pd;
    delete a.taco_cd;
    delete a.taco_pt;
    delete a.taco_ct;
    delete a.taco_ref;
    const r = resultadosDe(ops);
    expect(r.validationErrors.some((e) => e.includes("llantas incompletos"))).toBe(true);
  });
});
