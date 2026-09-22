// Decisión 4 (spec §4.4): la columna `fechaSalida` no se podía borrar — `|| undefined` la dejaba
// como estaba en el upsert y la hidratación la REVIVÍA con `datos.fsalidaReal ?? t.fechaSalida`.
// Una visita reabierta cargaba una salida fantasma (fila real: datos.fsalidaReal NULL,
// fechaSalida 2026-09-22).
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

type Upsert = { fechaSalida?: string | null; estatus: string };
const upserts: Upsert[] = [];
vi.mock("../src/api/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/api/client")>();
  return {
    ...real,
    upsertTaller: (arg: Upsert) => {
      upserts.push(arg);
      return Promise.resolve({});
    },
  };
});
const { uploadTallerToCloud } = await import("../src/api/batchUpload");

describe("uploadTallerToCloud — la salida se manda como null explícito cuando no hay", () => {
  it("sin fsalidaReal ⇒ fechaSalida: null (no undefined) y estatus abierto", async () => {
    upserts.length = 0;
    await uploadTallerToCloud(
      [{ id: "tl_1", plate: "PRB001A", fentrada: "2026-09-22", estado: "En Diagnóstico" }],
      "tenant-x",
    );
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.fechaSalida).toBeNull();
    expect(upserts[0]!.estatus).toBe("abierto");
  });
  it("con fsalidaReal ⇒ viaja la fecha y estatus cerrado", async () => {
    upserts.length = 0;
    await uploadTallerToCloud(
      [
        {
          id: "tl_2",
          plate: "PRB001A",
          fentrada: "2026-09-22",
          fsalidaReal: "2026-09-25",
          estado: "Finalizado",
        },
      ],
      "tenant-x",
    );
    expect(upserts[0]!.fechaSalida).toBe("2026-09-25");
    expect(upserts[0]!.estatus).toBe("cerrado");
  });
});

describe("hidratación — fsalidaReal sale SOLO de datos, nunca de la columna vieja", () => {
  const src = readFileSync("src/api/cloudHydrate.ts", "utf8");
  it("la línea de fsalidaReal no cae a t.fechaSalida", () => {
    const linea = src.split("\n").find((l) => l.includes("fsalidaReal: String("));
    expect(linea, "no encontré la reconstrucción de fsalidaReal").toBeTruthy();
    expect(linea).not.toContain("t.fechaSalida");
    expect(linea).toContain('datos.fsalidaReal ?? ""');
  });
  it("fentrada conserva su fallback a la columna (es parte de la llave, siempre presente)", () => {
    expect(src).toContain("fentrada: String(datos.fentrada ?? t.fechaEntrada)");
  });
});
