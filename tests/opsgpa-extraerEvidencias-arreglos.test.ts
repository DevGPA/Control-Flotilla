import { describe, expect, it, vi } from "vitest";
import { dedupEvidencias, extraerEvidencias } from "../src/opsgpa/contract";
import { runBackfill, type BackfillDeps } from "../src/opsgpa/backfill";

/**
 * El BACKFILL usa `extraerEvidencias` para decidir qué fotos copiar al bucket de FC,
 * pero esa función no recorría ARREGLOS — el rescate del arreglo `fotos` (PR #6) leía
 * las fotos al mapear y el backfill jamás las copiaba: habría estampado la key CRUDA
 * de Ops ("SOL/<uuid>.webp") como `fname` en `datos.photos` → imagen rota en el drawer.
 *
 * La convención de `campo` viene del publisher REAL (verificada contra sobres crudos de
 * producción en ops-capture/, 2026-08-14):
 *
 *   fotos:  [k1, k2]                → campo "fotos[0]", "fotos[1]"
 *   answers.golpes: [{foto, desc}]  → campo "answers.golpes[0].foto"
 *
 * Copiarla EXACTA importa: `nombreEvidencia(campo, key)` deriva el fname; si el backfill
 * usara otra grafía de campo, generaría un SEGUNDO objeto en S3 y una referencia distinta
 * a la que el camino en vivo ya escribió (adiós idempotencia).
 */

const K1 = "SOL/772917b464a646ab90c8c0b242d07362.webp";
const K2 = "SOL/97e1b0b60f3747bdb99ec48a615057bf.webp";
const KPHOTO = "SOL/60f0a7fd4e094eea9bf06902bd028674.webp";
const KFIRMA = "SOL/a3636b622bed46139920def6d63fec6d.png";
const KGOLPE1 = "CL/da9a058adb1b4a53a17e5f8ce0b6c001.webp";
const KGOLPE2 = "CL/272ccb73f0de4be3a4a6f2c19c3d0002.webp";

describe("extraerEvidencias — arreglos (convención del publisher)", () => {
  it("recorre el arreglo `fotos` de la solicitud con campo indexado", () => {
    const out = extraerEvidencias({ photo: KPHOTO, fotos: [K1, K2], firma: KFIRMA });
    expect(out).toEqual([
      { campo: "photo", key: KPHOTO },
      { campo: "fotos[0]", key: K1 },
      { campo: "fotos[1]", key: K2 },
      { campo: "firma", key: KFIRMA },
    ]);
  });

  it("recorre `answers.golpes` (arreglo de objetos {foto, desc})", () => {
    const out = extraerEvidencias({
      answers: {
        radiador: "Nivel Optimo",
        golpes: [
          { foto: KGOLPE1, desc: "Abolladura" },
          { foto: KGOLPE2, desc: "Rayon" },
        ],
      },
    });
    expect(out).toEqual([
      { campo: "answers.golpes[0].foto", key: KGOLPE1 },
      { campo: "answers.golpes[1].foto", key: KGOLPE2 },
    ]);
  });

  it("no cambia la grafía de los campos planos que ya funcionaban", () => {
    const out = extraerEvidencias({
      fotoKm: KPHOTO,
      answers: { f_radiador: KGOLPE1 },
    });
    expect(out).toEqual([
      { campo: "fotoKm", key: KPHOTO },
      { campo: "answers.f_radiador", key: KGOLPE1 },
    ]);
  });

  it("deduplica por key (una foto repetida en dos campos se copia una sola vez)", () => {
    const out = extraerEvidencias({ photo: K1, fotos: [K1, K2] });
    expect(out).toEqual([
      { campo: "photo", key: K1 },
      { campo: "fotos[1]", key: K2 },
    ]);
  });

  it("avisa cuando el tope de profundidad corta el recorrido (nunca en silencio)", () => {
    // Una evidencia enterrada más allá del tope se omite — igual que antes — pero
    // dejando rastro en el log: la clase de bug que este fix corrige (key fuera del
    // recorrido → fname crudo) no debe poder reaparecer sin avisar.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const profundo = { a: { b: { c: { d: { e: { f: { foto: KGOLPE1 } } } } } } };
      expect(extraerEvidencias(profundo)).toEqual([]);
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0]![0])).toContain("evidencias_prof_max");
    } finally {
      warn.mockRestore();
    }
  });

  it("ignora valores que no son keys de evidencia dentro de arreglos y objetos", () => {
    const out = extraerEvidencias({
      fotos: ["no-es-key", 42, null],
      camposCorregir: ["fotos"],
      reasignacion: { por: "admin@gpa.com.mx" },
    });
    expect(out).toEqual([]);
  });
});

describe("dedupEvidencias — el receptor copia cada key UNA vez (primera gana)", () => {
  it("colapsa una key repetida en dos campos y conserva el orden del publisher", () => {
    // Sin esto, el receptor copiaba la key duplicada DOS veces EN PARALELO y
    // `fnames.set` se quedaba con el fname del que TERMINARA último (carrera):
    // la referencia final no era determinística entre re-entregas.
    const dup = [
      { campo: "photo", key: K1 },
      { campo: "fotos[0]", key: K1 },
      { campo: "fotos[1]", key: K2 },
    ];
    expect(dedupEvidencias(dup)).toEqual([
      { campo: "photo", key: K1 },
      { campo: "fotos[1]", key: K2 },
    ]);
  });

  it("sin duplicados es identidad", () => {
    const sin = [
      { campo: "photo", key: KPHOTO },
      { campo: "fotos[0]", key: K1 },
    ];
    expect(dedupEvidencias(sin)).toEqual(sin);
  });
});

describe("backfill — las fotos del arreglo se copian y se referencian resueltas", () => {
  it("copia cada foto de `fotos` y datos.photos queda con fnames, no keys crudas", async () => {
    const copiadas: Array<{ campo: string; key: string }> = [];
    const cargas: Array<{ datos: string }> = [];
    const deps: BackfillDeps = {
      leerPagina: async (tipo) => ({
        items:
          tipo === "SOL"
            ? [
                {
                  PK: "SOL#84b0eebed5ae",
                  SK: "META",
                  tipo_reg: "SOL",
                  id: "84b0eebed5ae",
                  fecha: "2026-08-12T13:38:38-06:00",
                  sucursal: "Cabos",
                  status: "Aprobada",
                  economico: "54",
                  placas: "PW9237A",
                  km: 88118,
                  photo: KPHOTO,
                  fotos: [K1, K2],
                  firma: KFIRMA,
                },
              ]
            : [],
      }),
      copiarEvidencia: async (_tipo, _unidad, campo, key) => {
        copiadas.push({ campo, key });
        return `fname_${campo}`;
      },
      persistirCarga: async (input) => {
        cargas.push({ datos: input.datos });
      },
      persistirSemanal: async () => {},
      persistirChecklist: async () => {},
      persistirValidacion: async () => {},
      persistirAnulacion: async () => {},
    };

    const resumen = await runBackfill({ backfill: true, tipos: ["SOL"] }, deps);

    expect(resumen.errores).toEqual([]);
    expect(copiadas).toEqual([
      { campo: "photo", key: KPHOTO },
      { campo: "fotos[0]", key: K1 },
      { campo: "fotos[1]", key: K2 },
      { campo: "firma", key: KFIRMA },
    ]);
    const photos = (JSON.parse(cargas[0]!.datos) as { photos: Array<{ fname: string }> }).photos;
    expect(photos.map((p) => p.fname)).toEqual([
      "fname_photo",
      "fname_fotos[0]",
      "fname_fotos[1]",
      "fname_firma",
    ]);
    // Ninguna referencia debe quedar como key cruda de Ops.
    expect(photos.some((p) => p.fname.includes("/"))).toBe(false);
  });
});
