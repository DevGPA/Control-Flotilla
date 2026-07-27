import { describe, expect, it } from "vitest";
import { runBackfill, type BackfillDeps } from "../src/opsgpa/backfill";
import { extraerEvidencias, nombreEvidencia, stripInfra } from "../src/opsgpa/contract";

/** Items crudos como salen de la tabla (con claves de infraestructura). */
const SOL_ITEM = {
  PK: "SOL#34354ae5d278",
  SK: "META",
  GSI1PK: "SOL",
  GSI1SK: "2026-06-04T01:10:03+00:00",
  tipo_reg: "SOL",
  id: "34354ae5d278",
  fecha: "2026-06-04T01:10:03.987775+00:00",
  sucursal: "Guadalajara",
  status: "Aprobada",
  vehicleId: "10",
  economico: "10",
  placas: "JLL5377",
  km: 77777,
  monto: 479,
  litros: 18,
  photo: "SOL/5fca5c35d797444dbb060c1b0f4012d8.jpg",
  firma: "SOL/39e6e78e26444ee49159438acc609c16.png",
};
const REPORTE_ITEM = {
  PK: "SOL#aa11bb22cc33",
  SK: "META",
  GSI1PK: "SOL",
  tipo_reg: "SOL",
  formato: "reporte",
  id: "aa11bb22cc33",
  fecha: "2026-07-08T18:30:00+00:00",
  sucursal: "Cancun",
  economico: "89",
  placas: "JB6512A",
  km: 152340,
  lleno: "Si",
  litros: 62.5,
  precioLitro: 25.9,
  monto: 1618.75,
};
const CL_ITEM = {
  PK: "CL#88d8c62e3378",
  SK: "META",
  GSI1PK: "CL",
  tipo_reg: "CL",
  id: "88d8c62e3378",
  tipo: "semanal",
  fecha: "2026-07-09T19:00:03+00:00",
  sucursal: "Guadalajara",
  economico: "16",
  placas: "PR3430A",
  km: 11,
  answers: { radiador: "Nivel Optimo", f_radiador: "CL/edab420e3fd949af96b77e9477518dd0.jpg" },
};
const CL_MENSUAL_ITEM = { ...CL_ITEM, PK: "CL#otro", id: "otro", tipo: "mensual" };
/** Reasignados: Ops los deja con status "Anulado" y un rastro hacia el sustituto. */
const SOL_ANULADO = {
  ...SOL_ITEM,
  PK: "SOL#anul1234anul",
  id: "anul1234anul",
  status: "Anulado",
  reasignacion: { en: "2026-07-24T10:51:51-06:00", por: "admin@gpa.com.mx" },
  reasignadoA: { folio: "OPS-nuevo1234nue", registroId: "nuevo1234nue" },
};
const CL_ANULADO = { ...CL_ITEM, PK: "CL#anulcl", id: "anulcl", status: "Anulado" };
const SOL_ROTO = {
  PK: "SOL#roto",
  SK: "META",
  tipo_reg: "SOL",
  id: "roto",
  fecha: "2026-07-01",
  economico: "",
};

function depsMock(paginasOverride?: Record<string, Array<Array<Record<string, unknown>>>>) {
  const escritos: {
    carga: unknown[];
    semanal: unknown[];
    mensual: unknown[];
    copiadas: string[];
    validaciones: unknown[];
    anulaciones: Array<{ refId: string; modulo: string; motivo: string; anuladoPor: string }>;
    /** Registro de si cada persistencia de CL pidió mantener el catálogo de unidades. */
    catalogo: boolean[];
  } = {
    carga: [],
    semanal: [],
    mensual: [],
    copiadas: [],
    validaciones: [],
    anulaciones: [],
    catalogo: [],
  };
  const paginas: Record<string, Array<Array<Record<string, unknown>>>> = paginasOverride ?? {
    // SOL en 2 páginas (prueba la paginación por cursor)
    SOL: [[SOL_ITEM, REPORTE_ITEM], [SOL_ROTO]],
    CL: [[CL_ITEM, CL_MENSUAL_ITEM]],
  };
  const deps: BackfillDeps = {
    ahora: () => "2026-07-27T12:00:00.000Z",
    leerPagina: async (tipo, cursor) => {
      const idx = (cursor?.pagina as number) ?? 0;
      const items = paginas[tipo]?.[idx] ?? [];
      const hayMas = idx + 1 < (paginas[tipo]?.length ?? 0);
      return { items, siguiente: hayMas ? { pagina: idx + 1 } : undefined };
    },
    copiarEvidencia: async (_tipo, _unidad, campo, key) => {
      escritos.copiadas.push(`${campo}:${key}`);
      return `opsgpa_${key.replace(/[/.]/g, "_")}`;
    },
    persistirCarga: async (input) => {
      escritos.carga.push(input);
    },
    persistirSemanal: async (unit, semanal, opts) => {
      escritos.semanal.push({ unit, semanal });
      escritos.catalogo.push(opts.mantenerCatalogo);
    },
    persistirChecklist: async (unit, checklist, opts) => {
      escritos.mensual.push({ unit, checklist });
      escritos.catalogo.push(opts.mantenerCatalogo);
    },
    persistirValidacion: async (input) => {
      escritos.validaciones.push(input);
    },
    persistirAnulacion: async (input) => {
      escritos.anulaciones.push(input);
    },
  };
  return { deps, escritos };
}

describe("runBackfill: reingesta pull con los mismos adaptadores", () => {
  it("procesa SOL (solicitud + carga), CL semanal Y CL mensual (2026-07-13)", async () => {
    const { deps, escritos } = depsMock();
    const r = await runBackfill({ backfill: true }, deps);
    expect(r.leidos).toBe(5);
    expect(r.escritos).toEqual({ solicitud: 1, carga: 1, semanal: 1, mensual: 1 });
    expect(r.omitidosOtroTipo).toBe(0);
    // el mensual produce Checklist con el shape del webhook (tipoInspeccion/resultados)
    const men = escritos.mensual[0] as {
      checklist: { tipoInspeccion: string; fecha: string; resultados: string };
    };
    expect(men.checklist.tipoInspeccion).toBe("mensual");
    expect(men.checklist.fecha).toBe("2026-07-09");
    expect(JSON.parse(men.checklist.resultados)).toMatchObject({ fuente: "ops-gpa" });
    // el registro sin económico queda en errores, no tumba el lote
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0]).toMatchObject({ id: "roto" });
    // 4 evidencias copiadas (photo + firma del SOL, f_radiador del semanal Y del mensual)
    expect(escritos.copiadas).toHaveLength(4);
    // idempotencia de folio: mismos eventoId OPS- que produciría el puente push
    expect((escritos.carga[0] as { eventoId: string }).eventoId).toBe("OPS-34354ae5d278");
    expect((escritos.carga[1] as { eventoId: string; tipo: string }).tipo).toBe("carga");
    // validación en origen: la SOL "Aprobada" genera ValidacionCarga; el reporte
    // (sin status) y el roto no
    expect(r.validadas).toBe(1);
    expect(escritos.validaciones).toHaveLength(1);
    expect(escritos.validaciones[0]).toMatchObject({
      loadId: "10|solicitud|OPS-34354ae5d278",
      verdictGlobal: "ok",
      fuenteDeteccion: "ops-gpa",
    });
  });

  it("dryRun: mapea y reporta sin copiar ni escribir nada", async () => {
    const { deps, escritos } = depsMock();
    const r = await runBackfill({ backfill: true, dryRun: true }, deps);
    expect(r.dryRun).toBe(true);
    expect(r.escritos).toEqual({ solicitud: 1, carga: 1, semanal: 1, mensual: 1 }); // contados
    expect(r.validadas).toBe(1); // contada
    expect(escritos.carga).toHaveLength(0); // pero NO persistidos
    expect(escritos.semanal).toHaveLength(0);
    expect(escritos.mensual).toHaveLength(0);
    expect(escritos.copiadas).toHaveLength(0); // ni copiados
    expect(escritos.validaciones).toHaveLength(0); // ni validaciones
  });

  it("limit acota por tipo y respeta tipos explícitos", async () => {
    const { deps, escritos } = depsMock();
    const r = await runBackfill({ backfill: true, tipos: ["SOL"], limit: 1 }, deps);
    expect(r.leidos).toBe(1);
    expect(escritos.semanal).toHaveLength(0); // CL no se tocó
  });
});

describe("helpers de contract", () => {
  it("stripInfra quita solo claves de infraestructura", () => {
    const plano = stripInfra(SOL_ITEM);
    expect(plano.PK).toBeUndefined();
    expect(plano.GSI1PK).toBeUndefined();
    expect(plano.id).toBe("34354ae5d278");
    expect(plano.km).toBe(77777);
  });

  /**
   * Sin esto quedaría un BACKLOG PERMANENTE: el backfill lee la tabla de Ops directamente
   * (no hay campo `evento`), así que los registros ya reasignados ANTES del despliegue
   * nunca reciben un `cambio_estado` — si el backfill no los anula, siguen contando para
   * siempre. Por eso el despacho va por `status`, nunca por `evento`.
   */
  it("un registro Anulado escribe la Anulacion y NO toca el catálogo de unidades", async () => {
    const { deps, escritos } = depsMock({
      SOL: [[SOL_ANULADO]],
      CL: [[CL_ANULADO]],
    });
    const r = await runBackfill({ backfill: true }, deps);

    expect(r.anuladas).toBe(2);
    expect(escritos.anulaciones).toHaveLength(2);
    // El folio del sustituto viaja al motivo (texto humano del panel de anulados).
    const comb = escritos.anulaciones.find((a) => a.modulo === "combustible")!;
    expect(comb.refId).toBe("combustible|10|solicitud|OPS-anul1234anul");
    expect(comb.motivo).toContain("OPS-nuevo1234nue");
    expect(comb.anuladoPor).toBe("admin@gpa.com.mx · ops-gpa");
    const sem = escritos.anulaciones.find((a) => a.modulo === "semanal")!;
    expect(sem.refId).toMatch(/^semanal\|\d{4}-W\d{2}\|PR3430A$/);

    // El registro se sigue persistiendo (queda consultable en la vista "Anuladas")...
    expect(escritos.carga).toHaveLength(1);
    expect(escritos.semanal).toHaveLength(1);
    // ...pero un registro invalidado NO manda sobre el catálogo de unidades.
    expect(escritos.catalogo).toEqual([false]);
    // Y "Anulado" no produce veredicto: la exclusión la hace la Anulacion.
    expect(escritos.validaciones).toHaveLength(0);
  });

  it("un registro del flujo normal SÍ mantiene el catálogo y no anula nada", async () => {
    const { deps, escritos } = depsMock({ SOL: [[SOL_ITEM]], CL: [[CL_ITEM]] });
    const r = await runBackfill({ backfill: true }, deps);
    expect(r.anuladas).toBe(0);
    expect(escritos.anulaciones).toHaveLength(0);
    expect(escritos.catalogo).toEqual([true]);
  });

  it("dryRun no escribe anulaciones pero las cuenta", async () => {
    const { deps, escritos } = depsMock({ SOL: [[SOL_ANULADO]], CL: [[]] });
    const r = await runBackfill({ backfill: true, dryRun: true }, deps);
    expect(r.anuladas).toBe(1);
    expect(escritos.anulaciones).toHaveLength(0);
  });

  it("extraerEvidencias recorre top-level y answers", () => {
    expect(extraerEvidencias(stripInfra(CL_ITEM))).toEqual([
      { campo: "answers.f_radiador", key: "CL/edab420e3fd949af96b77e9477518dd0.jpg" },
    ]);
    expect(extraerEvidencias(stripInfra(SOL_ITEM))).toHaveLength(2);
  });

  it("nombreEvidencia SIEMPRE en minúsculas (fix 2026-07-14: el front minusculiza antes de firmar y S3 es case-sensitive)", () => {
    // campo camelCase (reporte de carga de Ops) → lowercase
    expect(
      nombreEvidencia(
        "SOL",
        { economico: "19" },
        "fotoAntes",
        "SOL/006febea1234567890abcdef12345678.webp",
      ),
    ).toBe("opsgpa_19_006febea_fotoantes.webp");
    // placas MAYÚSCULAS (checklist) → lowercase
    expect(
      nombreEvidencia(
        "CL",
        { placas: "PR3430A" },
        "answers.f_radiador",
        "CL/edab420e3fd949af96b77e9477518dd0.jpg",
      ),
    ).toBe("opsgpa_pr3430a_edab420e_answers_f_radiador.jpg");
  });
});
