// Tests de la Fase C2 (auditoría 2026-06-04): claves estables de Taller
// (tallerCloudKey) y deduplicación en lectura de filas cloud duplicadas
// (dedupTallerCloudRows). Previenen los P1 #10/#11: duplicados fantasma al
// editar y proliferación de filas por claves con updatedAt regenerado.

import { describe, expect, it } from "vitest";
import { tallerCloudKey } from "../src/api/batchUpload";
import { dedupTallerCloudRows, tallerRowLegacyId } from "../src/api/tallerDedup";

describe("tallerCloudKey — clave estable (P1 #11)", () => {
  const base = { id: "tl_1718000000000", estado: "En Diagnóstico" as const };

  it("usa fentrada cuando existe", () => {
    const k = tallerCloudKey({ ...base, plate: "ABC-1", fentrada: "2026-06-01" });
    expect(k).toEqual({ unitUid: "ABC-1", fechaEntrada: "2026-06-01" });
  });

  it("cae a freporte si fentrada vacía", () => {
    const k = tallerCloudKey({ ...base, eco: "57", fentrada: "", freporte: "2026-06-02" });
    expect(k).toEqual({ unitUid: "57", fechaEntrada: "2026-06-02" });
  });

  it("sin fechas: fallback ESTABLE sin-fecha:+id (antes era updatedAt → fila nueva por guardado)", () => {
    const e = {
      ...base,
      plate: "ABC-1",
      fentrada: "",
      freporte: "",
      updatedAt: "2026-06-09T10:00:00Z",
    };
    const k1 = tallerCloudKey(e);
    const k2 = tallerCloudKey({ ...e, updatedAt: "2026-06-10T11:11:11Z" }); // re-guardado
    expect(k1.fechaEntrada).toBe("sin-fecha:tl_1718000000000");
    expect(k2).toEqual(k1); // RECOMPUTABLE: la clave no cambia entre guardados
  });

  it("unitUid: plate > eco > unitKey > id", () => {
    expect(tallerCloudKey({ ...base, plate: "P", eco: "E" }).unitUid).toBe("P");
    expect(tallerCloudKey({ ...base, eco: "E", unitKey: "U" }).unitUid).toBe("E");
    expect(tallerCloudKey({ ...base, unitKey: "U" }).unitUid).toBe("U");
    expect(tallerCloudKey({ ...base }).unitUid).toBe(base.id);
  });
});

describe("dedupTallerCloudRows — dedup en lectura (P1 #10)", () => {
  it("agrupa por id legacy (datos.id) y gana el datos.updatedAt mayor", () => {
    const rows = [
      {
        unitUid: "ABC-1",
        fechaEntrada: "2026-06-09T10:00:00.000Z", // clave vieja (updatedAt fallback)
        folio: "tl_1",
        datos: JSON.stringify({ id: "tl_1", updatedAt: "2026-06-09T10:00:00Z", gasto: 100 }),
      },
      {
        unitUid: "ABC-1",
        fechaEntrada: "sin-fecha:tl_1", // clave nueva estable
        folio: "tl_1",
        datos: JSON.stringify({ id: "tl_1", updatedAt: "2026-06-10T09:00:00Z", gasto: 250 }),
      },
      {
        unitUid: "XYZ-2",
        fechaEntrada: "2026-06-01",
        folio: "tl_2",
        datos: JSON.stringify({ id: "tl_2", updatedAt: "2026-06-01T08:00:00Z" }),
      },
    ];
    const out = dedupTallerCloudRows(rows);
    expect(out).toHaveLength(2);
    const t1 = out.find((r) => r.folio === "tl_1")!;
    expect(t1.fechaEntrada).toBe("sin-fecha:tl_1"); // ganó la edición más reciente
  });

  it("fallback de id: folio cuando datos no trae id; unitUid_fecha cuando no hay nada", () => {
    expect(tallerRowLegacyId({ unitUid: "A", fechaEntrada: "f", folio: "tl_9", datos: "{}" })).toBe(
      "tl_9",
    );
    expect(tallerRowLegacyId({ unitUid: "A", fechaEntrada: "f" })).toBe("A_f");
  });

  it("tie-break determinista: mismo updatedAt → prefiere clave con fecha real", () => {
    const rows = [
      {
        unitUid: "A",
        fechaEntrada: "sin-fecha:tl_3",
        folio: "tl_3",
        datos: JSON.stringify({ id: "tl_3", updatedAt: "2026-06-09" }),
      },
      {
        unitUid: "A",
        fechaEntrada: "2026-06-05",
        folio: "tl_3",
        datos: JSON.stringify({ id: "tl_3", updatedAt: "2026-06-09" }),
      },
    ];
    const out = dedupTallerCloudRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.fechaEntrada).toBe("2026-06-05");
  });

  it("datos corrupto no truena (cae a folio)", () => {
    const out = dedupTallerCloudRows([
      { unitUid: "A", fechaEntrada: "x", folio: "tl_4", datos: "{{{not json" },
      { unitUid: "A", fechaEntrada: "y", folio: "tl_4", datos: "{{{not json" },
    ]);
    expect(out).toHaveLength(1);
  });

  it("sin duplicados → passthrough", () => {
    const rows = [
      { unitUid: "A", fechaEntrada: "1", folio: "a", datos: '{"id":"a"}' },
      { unitUid: "B", fechaEntrada: "2", folio: "b", datos: '{"id":"b"}' },
    ];
    expect(dedupTallerCloudRows(rows)).toHaveLength(2);
  });
});
