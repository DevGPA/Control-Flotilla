// Decisión 2 (spec §4.2): el cierre revoca la liga EN EL MISMO upsert. Aquí se prueba el
// contrato de subida (uploadTallerToCloud) y el cableado del monolito (cloudWire); la regla
// (revocacionPorCierre) ya tiene sus pruebas puras en tallerSeguimientoEstado.test.ts.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { LegacyTallerEntry } from "../src/api/batchUpload";
import type { TallerEntry } from "../src/taller/types";

type Upsert = {
  estatus: string;
  ligaVersion?: number;
  ligaRevocadaEn?: string;
  ligaRevocadaPor?: string;
};
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

/** Un entry del monolito: la forma legacy MÁS las columnas de liga que la hidratación le
 *  cuelga (TallerEntry). `LegacyTallerEntry` no las declara; tipar así evita que tsc rechace
 *  las literales de prueba por propiedad sobrante. */
type Visita = LegacyTallerEntry &
  Partial<
    Pick<
      TallerEntry,
      "ligaVersion" | "ligaCreadaEn" | "ligaCreadaPor" | "ligaRevocadaEn" | "ligaRevocadaPor"
    >
  >;

const DIA_MS = 24 * 60 * 60 * 1000;
// Relativo al reloj (no una fecha fija): la liga vive 90 días (VIGENCIA_LIGA_DIAS) y una
// emisión literal dejaría la liga "vencida" — y esta prueba en rojo — al cumplirse el plazo.
const EMITIDA = new Date(Date.now() - 7 * DIA_MS).toISOString();
const REVOCADA_AYER = new Date(Date.now() - 1 * DIA_MS).toISOString();
const visita = (extra: Partial<Visita>): Visita => ({
  id: "tl_1",
  plate: "PRB001A",
  fentrada: "2026-09-14",
  ligaCreadaEn: EMITIDA,
  ligaCreadaPor: "r@ejemplo.test",
  ...extra,
});

describe("uploadTallerToCloud — el cierre revoca la liga en el mismo guardado", () => {
  it("visita cerrada con liga vigente ⇒ viajan ligaVersion+1, ligaRevocadaEn y 'cierre:<quien>'", async () => {
    upserts.length = 0;
    await uploadTallerToCloud(
      [visita({ fsalidaReal: "2026-09-22", estado: "Finalizado", ligaVersion: 1 })],
      "tenant-x",
      undefined,
      "op@ejemplo.test",
    );
    expect(upserts).toHaveLength(1);
    const u = upserts[0]!;
    expect(u.estatus).toBe("cerrado");
    expect(u.ligaVersion).toBe(2);
    expect(u.ligaRevocadaPor).toBe("cierre:op@ejemplo.test");
    expect(typeof u.ligaRevocadaEn).toBe("string");
    expect(Number.isFinite(Date.parse(u.ligaRevocadaEn!))).toBe(true);
  });

  it("visita abierta ⇒ NO viaja ningún campo de liga", async () => {
    upserts.length = 0;
    await uploadTallerToCloud(
      [visita({ estado: "En Reparación" })],
      "tenant-x",
      undefined,
      "op@ejemplo.test",
    );
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.estatus).toBe("abierto");
    expect(upserts[0]).not.toHaveProperty("ligaVersion");
    expect(upserts[0]).not.toHaveProperty("ligaRevocadaEn");
    expect(upserts[0]).not.toHaveProperty("ligaRevocadaPor");
  });

  it("cerrada con liga ya revocada ⇒ NO se re-revoca", async () => {
    upserts.length = 0;
    await uploadTallerToCloud(
      [visita({ fsalidaReal: "2026-09-22", ligaRevocadaEn: REVOCADA_AYER, ligaVersion: 2 })],
      "tenant-x",
      undefined,
      "op@ejemplo.test",
    );
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.estatus).toBe("cerrado");
    expect(upserts[0]).not.toHaveProperty("ligaVersion");
    expect(upserts[0]).not.toHaveProperty("ligaRevocadaEn");
  });

  it("cerrada sin liga ⇒ nada que revocar, ningún campo de liga", async () => {
    upserts.length = 0;
    await uploadTallerToCloud(
      [visita({ fsalidaReal: "2026-09-22", ligaCreadaEn: undefined, ligaCreadaPor: undefined })],
      "tenant-x",
      undefined,
      "op@ejemplo.test",
    );
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).not.toHaveProperty("ligaVersion");
  });

  it("sin quien (llamador viejo) ⇒ 'cierre:desconocido', nunca vacío", async () => {
    upserts.length = 0;
    await uploadTallerToCloud([visita({ fsalidaReal: "2026-09-22" })], "tenant-x");
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.ligaRevocadaPor).toBe("cierre:desconocido");
  });
});

describe("cloudWire — los llamadores pasan el correo de la sesión y publican la guarda", () => {
  const src = readFileSync("src/api/cloudWire.ts", "utf8");

  it("__cloudSyncTaller y __cloudReplaceTaller pasan session.email como 4º argumento", () => {
    // `,?\s*` tolera la coma final que prettier pone al partir la llamada en varias líneas.
    const m = src.match(/uploadTallerToCloud\([^)]*session\.email,?\s*\)/g) ?? [];
    expect(m.length, "faltan llamadores con session.email").toBe(2);
  });

  it("declara window.__llaveEnUso en el declare global", () => {
    expect(src).toContain("__llaveEnUso?:");
  });

  it("publica window.__llaveEnUso componiendo las llaves con tallerCloudKey", () => {
    const i = src.indexOf("window.__llaveEnUso =");
    expect(i, "no encontré la asignación de window.__llaveEnUso").toBeGreaterThan(-1);
    const cuerpo = src.slice(i, i + 700);
    expect(cuerpo).toContain("tallerCloudKey(");
    expect(cuerpo).toContain("__anuladasActivas");
    expect(cuerpo).toContain("llaveEnUso(");
  });
});
