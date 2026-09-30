// Decisión 2 (spec §4.2): el cierre revoca la liga EN EL MISMO upsert. Aquí se prueba el
// contrato de subida (uploadTallerToCloud) y el cableado del monolito (cloudWire); la regla
// (revocacionPorCierre) ya tiene sus pruebas puras en tallerSeguimientoEstado.test.ts.
//
// B-1 (revisión de seguridad): antes de cerrar, la liga se RELEE de la nube (getTaller) y la
// revocación se calcula desde lo que hay allá — la copia local puede tener minutos de atraso.
// Las pruebas puras de esa composición (conLigaDeNube) están en tallerLigaNube.test.ts; aquí
// se prueba que uploadTallerToCloud relee cuando toca, no relee cuando no, y qué escribe.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import type { LegacyTallerEntry } from "../src/api/batchUpload";
import type { TallerEntry } from "../src/taller/types";

type Upsert = {
  estatus: string;
  ligaVersion?: number;
  ligaRevocadaEn?: string;
  ligaRevocadaPor?: string;
};
/** La fila `Taller` tal como la devuelve la nube: campos de liga nullable. */
type FilaNube = {
  ligaVersion?: number | null;
  ligaCreadaEn?: string | null;
  ligaCreadaPor?: string | null;
  ligaRevocadaEn?: string | null;
  ligaRevocadaPor?: string | null;
};
const upserts: Upsert[] = [];
// Cuando es true, el upsert simulado falla: prueba que el entry local NO se toca sin éxito.
let fallaUpsert = false;
// B-1: lo que la NUBE dice de la visita al releerla antes de cerrar. null = la fila no existe.
let filaNube: FilaNube | null = null;
let lecturas = 0;
let fallaLectura = false;
vi.mock("../src/api/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/api/client")>();
  return {
    ...real,
    upsertTaller: (arg: Upsert) => {
      if (fallaUpsert) return Promise.reject(new Error("falla simulada del backend"));
      upserts.push(arg);
      return Promise.resolve({});
    },
    getTaller: () => {
      lecturas += 1;
      if (fallaLectura) return Promise.reject(new Error("falla simulada al leer la fila"));
      return Promise.resolve(filaNube);
    },
  };
});
const { uploadTallerToCloud } = await import("../src/api/batchUpload");

beforeEach(() => {
  upserts.length = 0;
  fallaUpsert = false;
  filaNube = null;
  lecturas = 0;
  fallaLectura = false;
});

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
// Una re-emisión de Riesgos POSTERIOR a la revocación de ayer (hace una hora).
const REEMITIDA = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const QUIEN = "op@ejemplo.test";
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
    await uploadTallerToCloud(
      [visita({ fsalidaReal: "2026-09-22", estado: "Finalizado", ligaVersion: 1 })],
      "tenant-x",
      undefined,
      QUIEN,
    );
    expect(upserts).toHaveLength(1);
    const u = upserts[0]!;
    expect(u.estatus).toBe("cerrado");
    expect(u.ligaVersion).toBe(2);
    expect(u.ligaRevocadaPor).toBe(`cierre:${QUIEN}`);
    expect(typeof u.ligaRevocadaEn).toBe("string");
    expect(Number.isFinite(Date.parse(u.ligaRevocadaEn!))).toBe(true);
  });

  it("visita abierta ⇒ NO viaja ningún campo de liga", async () => {
    await uploadTallerToCloud([visita({ estado: "En Reparación" })], "tenant-x", undefined, QUIEN);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.estatus).toBe("abierto");
    expect(upserts[0]).not.toHaveProperty("ligaVersion");
    expect(upserts[0]).not.toHaveProperty("ligaRevocadaEn");
    expect(upserts[0]).not.toHaveProperty("ligaRevocadaPor");
  });

  it("cerrada con liga ya revocada ⇒ NO se re-revoca", async () => {
    await uploadTallerToCloud(
      [visita({ fsalidaReal: "2026-09-22", ligaRevocadaEn: REVOCADA_AYER, ligaVersion: 2 })],
      "tenant-x",
      undefined,
      QUIEN,
    );
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.estatus).toBe("cerrado");
    expect(upserts[0]).not.toHaveProperty("ligaVersion");
    expect(upserts[0]).not.toHaveProperty("ligaRevocadaEn");
  });

  it("cerrada sin liga ⇒ nada que revocar, ningún campo de liga", async () => {
    await uploadTallerToCloud(
      [visita({ fsalidaReal: "2026-09-22", ligaCreadaEn: undefined, ligaCreadaPor: undefined })],
      "tenant-x",
      undefined,
      QUIEN,
    );
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).not.toHaveProperty("ligaVersion");
  });

  it("sin quien (llamador viejo) ⇒ 'cierre:desconocido', nunca vacío", async () => {
    await uploadTallerToCloud([visita({ fsalidaReal: "2026-09-22" })], "tenant-x");
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.ligaRevocadaPor).toBe("cierre:desconocido");
  });

  it("tras el guardado, el entry LOCAL ya trae la revocación (igual que la nube)", async () => {
    const v = visita({ fsalidaReal: "2026-09-22", ligaVersion: 1 });
    await uploadTallerToCloud([v], "tenant-x", undefined, QUIEN);
    expect(v.ligaVersion).toBe(2);
    expect(v.ligaRevocadaEn).toBe(upserts[0]!.ligaRevocadaEn);
    expect(v.ligaRevocadaPor).toBe(`cierre:${QUIEN}`);
  });

  it("un segundo guardado de la MISMA visita cerrada ya no vuelve a sellar la revocación", async () => {
    const v = visita({ fsalidaReal: "2026-09-22", ligaVersion: 1 });
    await uploadTallerToCloud([v], "tenant-x", undefined, QUIEN);
    await uploadTallerToCloud([v], "tenant-x", undefined, QUIEN);
    expect(upserts).toHaveLength(2);
    expect(upserts[0]!.ligaVersion).toBe(2);
    expect(upserts[1]).not.toHaveProperty("ligaVersion");
    expect(upserts[1]).not.toHaveProperty("ligaRevocadaEn");
    expect(v.ligaVersion).toBe(2);
  });

  it("si el upsert FALLA, el entry local no se toca y el error se reporta", async () => {
    fallaUpsert = true;
    const v = visita({ fsalidaReal: "2026-09-22", ligaVersion: 1 });
    const res = await uploadTallerToCloud([v], "tenant-x", undefined, QUIEN);
    expect(res.errors).toHaveLength(1);
    expect(v.ligaVersion).toBe(1);
    expect(v).not.toHaveProperty("ligaRevocadaEn");
  });
});

describe("uploadTallerToCloud — B-1: al cerrar con liga, la liga se toma de la NUBE, no de la copia local", () => {
  /** Riesgos revocó (ayer) y RE-EMITIÓ (hace una hora): en la nube hay un token VIVO v2. */
  const NUBE_REEMITIDA_V2: FilaNube = {
    ligaVersion: 2,
    ligaCreadaEn: REEMITIDA,
    ligaCreadaPor: "riesgos@ejemplo.test",
    ligaRevocadaEn: null,
    ligaRevocadaPor: null,
  };

  it("(a) la nube ya está revocada por Riesgos ⇒ no viaja ninguna llave de liga y el local espeja el rastro de la nube", async () => {
    filaNube = {
      ligaVersion: 2,
      ligaCreadaEn: EMITIDA,
      ligaCreadaPor: "r@ejemplo.test",
      ligaRevocadaEn: REVOCADA_AYER,
      ligaRevocadaPor: "riesgos@ejemplo.test",
    };
    const v = visita({ fsalidaReal: "2026-09-22", ligaVersion: 1 });
    await uploadTallerToCloud([v], "tenant-x", undefined, QUIEN);
    expect(lecturas).toBe(1);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.estatus).toBe("cerrado");
    expect(upserts[0]).not.toHaveProperty("ligaVersion");
    expect(upserts[0]).not.toHaveProperty("ligaRevocadaEn");
    expect(upserts[0]).not.toHaveProperty("ligaRevocadaPor");
    // El espejo local dice lo que dice la nube: quién revocó de verdad.
    expect(v.ligaVersion).toBe(2);
    expect(v.ligaRevocadaEn).toBe(REVOCADA_AYER);
    expect(v.ligaRevocadaPor).toBe("riesgos@ejemplo.test");
  });

  it("(b) la nube tiene una liga RE-EMITIDA viva (v2) ⇒ se revoca v3 — nunca v2, la versión del token vivo", async () => {
    filaNube = NUBE_REEMITIDA_V2;
    const v = visita({ fsalidaReal: "2026-09-22", ligaVersion: 1 });
    await uploadTallerToCloud([v], "tenant-x", undefined, QUIEN);
    expect(lecturas).toBe(1);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.ligaVersion).toBe(3);
    expect(Date.parse(upserts[0]!.ligaRevocadaEn!)).toBeGreaterThanOrEqual(Date.parse(REEMITIDA));
    expect(upserts[0]!.ligaRevocadaPor).toBe(`cierre:${QUIEN}`);
    expect(v.ligaVersion).toBe(3);
    expect(v.ligaCreadaEn).toBe(REEMITIDA);
    expect(v.ligaCreadaPor).toBe("riesgos@ejemplo.test");
  });

  it("(c) la nube ya va en v3 (dos revocaciones) con liga viva ⇒ v4: la versión nunca BAJA", async () => {
    filaNube = { ...NUBE_REEMITIDA_V2, ligaVersion: 3 };
    const v = visita({ fsalidaReal: "2026-09-22", ligaVersion: 1 });
    await uploadTallerToCloud([v], "tenant-x", undefined, QUIEN);
    expect(upserts[0]!.ligaVersion).toBe(4);
    expect(v.ligaVersion).toBe(4);
  });

  it("la copia local dice 'revocada' pero la nube re-emitió ⇒ también relee y mata la liga viva", async () => {
    filaNube = NUBE_REEMITIDA_V2;
    const v = visita({ fsalidaReal: "2026-09-22", ligaRevocadaEn: REVOCADA_AYER, ligaVersion: 2 });
    await uploadTallerToCloud([v], "tenant-x", undefined, QUIEN);
    expect(lecturas).toBe(1);
    expect(upserts[0]!.ligaVersion).toBe(3);
    expect(v.ligaRevocadaPor).toBe(`cierre:${QUIEN}`);
  });

  it("sin fila en la nube todavía ⇒ se calcula desde la copia local (v2)", async () => {
    filaNube = null;
    const v = visita({ fsalidaReal: "2026-09-22", ligaVersion: 1 });
    await uploadTallerToCloud([v], "tenant-x", undefined, QUIEN);
    expect(lecturas).toBe(1);
    expect(upserts[0]!.ligaVersion).toBe(2);
  });

  it("una visita ABIERTA o cerrada SIN liga no relee la nube (camino barato: cero lecturas)", async () => {
    await uploadTallerToCloud(
      [
        visita({ estado: "En Reparación" }),
        visita({ fsalidaReal: "2026-09-22", ligaCreadaEn: undefined, ligaCreadaPor: undefined }),
      ],
      "tenant-x",
      undefined,
      QUIEN,
    );
    expect(upserts).toHaveLength(2);
    expect(lecturas).toBe(0);
  });

  it("si la relectura FALLA, no se escribe nada de ese entry (fail-closed), el error se reporta y el local no se toca", async () => {
    fallaLectura = true;
    const v = visita({ fsalidaReal: "2026-09-22", ligaVersion: 1 });
    const res = await uploadTallerToCloud([v], "tenant-x", undefined, QUIEN);
    expect(lecturas).toBe(1);
    expect(upserts).toHaveLength(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]!.error).toContain("falla simulada al leer");
    expect(v.ligaVersion).toBe(1);
    expect(v).not.toHaveProperty("ligaRevocadaEn");
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
