import { describe, expect, it } from "vitest";
import {
  debeMantenerCatalogo,
  esStatusAnulado,
  esStatusPorCorregir,
  metaAnulacionDeOps,
} from "../src/opsgpa/mapAnulacion";

/**
 * Statuses NUEVOS que Operaciones-GPA empezará a emitir (brief Ops 2026-07-27):
 *   "Anulado"      → el registro se reasignó a otra unidad; este queda sustituido.
 *   "Por corregir" → un autorizador lo devolvió para corregir un campo (estado retenido).
 *
 * Los predicados son TOLERANTES a propósito: el vocabulario exacto de Ops no está
 * confirmado (¿"Anulado" o "Anulada"? ¿"Por corregir" o "Por corrección"?) y un status
 * que no se reconozca hoy hace que el registro se upsertee como VIVO → doble conteo
 * silencioso. Tolerar variantes es la defensa.
 */
describe("esStatusAnulado", () => {
  it("reconoce el status con cualquier género, caja y espacios sobrantes", () => {
    for (const s of ["Anulado", "Anulada", "ANULADO", "anulada", "  Anulado  "]) {
      expect(esStatusAnulado(s)).toBe(true);
    }
  });

  it("no confunde los statuses del flujo normal", () => {
    for (const s of ["Aprobada", "Aprobado", "Rechazada", "Pendiente", "Por corregir", ""]) {
      expect(esStatusAnulado(s)).toBe(false);
    }
  });

  it("tolera ausencia de valor sin reventar", () => {
    expect(esStatusAnulado(undefined)).toBe(false);
    expect(esStatusAnulado(null)).toBe(false);
  });
});

describe("esStatusPorCorregir", () => {
  it("reconoce las variantes de grafía, incluida la acentuada", () => {
    // ⚠️ El prefijo común es "corre", no "correc": corregir = corre-G-ir y
    // corrección = corre-C-ción. Cortar en "correc" deja fuera "corregir" (bug real
    // que este test atrapó) y cortar en "correg" deja fuera "corrección".
    for (const s of [
      "Por corregir",
      "por corregir",
      "POR CORREGIR",
      "Por  corregir",
      "Por corrección",
      "por correccion",
      "  Por corregir  ",
    ]) {
      expect(esStatusPorCorregir(s)).toBe(true);
    }
  });

  it("no confunde los statuses del flujo normal ni prefijos vecinos", () => {
    for (const s of [
      "Aprobada",
      "Rechazada",
      "Pendiente",
      "Anulado",
      "Corregir", // sin el "por" no es este status
      "Por correo", // comparte "corre" pero no es una corrección
      "",
    ]) {
      expect(esStatusPorCorregir(s)).toBe(false);
    }
  });

  it("tolera ausencia de valor sin reventar", () => {
    expect(esStatusPorCorregir(undefined)).toBe(false);
    expect(esStatusPorCorregir(null)).toBe(false);
  });
});

/**
 * Un registro Anulado NO debe mandar sobre el catálogo de unidades. La `Unit` que
 * escriben mapMensual/mapSemanal NO se filtra por anulación (window.__fleetUnits se
 * arma con units.map(...)), así que upsertearla desde un Anulado puede crear una
 * unidad fantasma que infla la flota o pisar economicoId/marca/area de la unidad
 * correcta. Mismo razonamiento que ya justifica omitirEnUpdate:["sucursal"].
 */
describe("debeMantenerCatalogo", () => {
  it("es false SOLO para Anulado", () => {
    expect(debeMantenerCatalogo("Anulado")).toBe(false);
    expect(debeMantenerCatalogo("Anulada")).toBe(false);
  });

  it("es true para todo lo demás (el flujo normal sí actualiza el catálogo)", () => {
    for (const s of ["Aprobada", "Rechazada", "Pendiente", "Por corregir", "", undefined]) {
      expect(debeMantenerCatalogo(s)).toBe(true);
    }
  });
});

/**
 * Extracción de quién/cuándo/hacia-dónde de un registro Anulado.
 *
 * `reasignacion` SÍ existe en producción con la forma `{en, por, de:{...}}` (verificado en
 * gpa_operaciones_prod, 3 registros al 2026-07-27). El campo con el folio del SUSTITUTO en
 * cambio NO está en el contrato ni en los golden — el brief de Ops lo menciona como
 * `reasignadoDe`/`reasignadoA` sin fijar el nombre. De ahí la lista de candidatos y las
 * dos formas (string suelto u objeto con folio/registroId): si mañana Ops usa otro nombre
 * o otra forma, el motivo degrada con gracia en vez de decir "undefined".
 */
describe("metaAnulacionDeOps", () => {
  const AHORA = "2026-07-27T12:00:00.000Z";

  it("toma quién y cuándo de `reasignacion` (la forma real de producción)", () => {
    const m = metaAnulacionDeOps(
      {
        status: "Anulado",
        reasignacion: { en: "2026-07-24T10:51:51.753655-06:00", por: "admin@gpa.com.mx" },
        autorizadoPor: "OTRO",
        fechaAut: "2026-01-01T00:00:00Z",
      },
      AHORA,
    );
    expect(m.anuladoPor).toBe("admin@gpa.com.mx");
    expect(m.ts).toBe("2026-07-24T10:51:51.753655-06:00");
    expect(m.ahora).toBe(AHORA);
  });

  it("sin `reasignacion` cae a autorizadoPor / fechaAut", () => {
    const m = metaAnulacionDeOps(
      { status: "Anulado", autorizadoPor: "quien", fechaAut: "2026-07-01T00:00:00Z" },
      AHORA,
    );
    expect(m.anuladoPor).toBe("quien");
    expect(m.ts).toBe("2026-07-01T00:00:00Z");
  });

  it("extrae el folio del sustituto de cualquiera de los nombres candidatos", () => {
    for (const campo of ["reasignadoA", "reasignadoDe", "folioNuevo", "nuevoFolio"]) {
      const m = metaAnulacionDeOps({ status: "Anulado", [campo]: "OPS-abc123abc123" }, AHORA);
      expect(m.folioNuevo, campo).toBe("OPS-abc123abc123");
    }
  });

  it("si el candidato es un objeto, prefiere su folio y si no deriva OPS-<registroId>", () => {
    expect(
      metaAnulacionDeOps(
        {
          status: "Anulado",
          reasignadoA: { folio: "OPS-deadbeef1234", registroId: "deadbeef1234" },
        },
        AHORA,
      ).folioNuevo,
    ).toBe("OPS-deadbeef1234");
    expect(
      metaAnulacionDeOps({ status: "Anulado", reasignadoA: { registroId: "cafe12345678" } }, AHORA)
        .folioNuevo,
    ).toBe("OPS-cafe12345678");
  });

  it("sin ningún candidato deja folioNuevo vacío (el motivo degrada con gracia)", () => {
    const m = metaAnulacionDeOps({ status: "Anulado" }, AHORA);
    expect(m.folioNuevo).toBeUndefined();
    expect(m.status).toBe("Anulado");
  });

  /**
   * Forma CONFIRMADA por el brief de Ops del 2026-07-29: el rastro es
   * `answers.reasignadoA` = { id, folio, vehicleId, economico, sucursal, por, en }.
   * Ojo con las dos diferencias frente a lo que asumíamos: `por`/`en` viven DENTRO del
   * rastro (no en el campo `reasignacion` viejo), y la llave del registro se llama `id`
   * (no `registroId`).
   */
  it("toma quién y cuándo de DENTRO del rastro (forma confirmada por Ops)", () => {
    const m = metaAnulacionDeOps(
      {
        status: "Anulado",
        reasignadoA: {
          id: "nuevo1234nue",
          folio: "OPS-nuevo1234nue",
          vehicleId: "92",
          economico: "92",
          sucursal: "Monterrey",
          por: "admin@gpa.com.mx",
          en: "2026-07-29T09:15:00-06:00",
        },
        // Estos NO deben ganar: son el respaldo, no la fuente.
        autorizadoPor: "OTRO",
        fechaAut: "2026-01-01T00:00:00Z",
      },
      AHORA,
    );
    expect(m.folioNuevo).toBe("OPS-nuevo1234nue");
    expect(m.anuladoPor).toBe("admin@gpa.com.mx");
    expect(m.ts).toBe("2026-07-29T09:15:00-06:00");
  });

  it("deriva el folio de `id` cuando el rastro no trae `folio`", () => {
    const m = metaAnulacionDeOps(
      { status: "Anulado", reasignadoA: { id: "cafe12345678", por: "x@gpa.com.mx" } },
      AHORA,
    );
    expect(m.folioNuevo).toBe("OPS-cafe12345678");
    expect(m.anuladoPor).toBe("x@gpa.com.mx");
  });

  it("el campo `reasignacion` viejo sigue sirviendo de respaldo", () => {
    const m = metaAnulacionDeOps(
      {
        status: "Anulado",
        reasignacion: { en: "2026-07-24T10:51:51-06:00", por: "viejo@gpa.com.mx" },
      },
      AHORA,
    );
    expect(m.anuladoPor).toBe("viejo@gpa.com.mx");
    expect(m.ts).toBe("2026-07-24T10:51:51-06:00");
  });
});
