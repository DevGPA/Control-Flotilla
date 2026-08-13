import { describe, expect, it } from "vitest";
import { mapSolicitud } from "../src/opsgpa/mapSolicitud";
import type { EvidenceResolver, OpsSolRecord } from "../src/opsgpa/contract";

/**
 * Ops manda las evidencias de una solicitud en DOS lugares y el adaptador solo leía uno:
 *
 *   answers.photo  → una sola evidencia   (SÍ se leía)
 *   answers.fotos  → ARREGLO de evidencias (se IGNORABA por completo)
 *   firma          → nivel superior        (SÍ se leía)
 *
 * Medido sobre los 789 payloads crudos que el receptor archivó en agosto 2026:
 * `answers.fotos` aparece en 535 registros y contiene **328 fotos únicas** que nunca
 * llegaron a Fleet Command. Ninguna estaba duplicada en otro campo: eran pérdida neta.
 *
 * Caso que lo destapó: unidad 54, folio OPS-84b0eebed5ae (2026-08-12). En Operaciones-GPA
 * se veían dos fotos de evidencia (odómetro en 88118 km y el medidor de gasolina) y en Fleet
 * Command no aparecía ninguna de las dos.
 */
const resolver: EvidenceResolver = (key) => `resuelto_${String(key).split("/")[1]}`;

const base = (extra: Record<string, unknown> = {}): OpsSolRecord =>
  ({
    id: "84b0eebed5ae",
    economico: "54",
    placas: "PW9237A",
    fecha: "2026-08-12T13:38:38.571212-06:00",
    sucursal: "Cabos",
    status: "Aprobada",
    km: 88118,
    ...extra,
  }) as unknown as OpsSolRecord;

const K1 = "SOL/f52e8b80c0e04e3dbf5c9dacc3b50fdb.webp";
const K2 = "SOL/683a2d344fc54b6799331609145b4c97.webp";
const KPHOTO = "SOL/9c4fee0018c34108875474a3f05f6ecc.webp";
const KFIRMA = "SOL/47736c021ecb4caf9259391219b07004.png";

const fotosDe = (r: ReturnType<typeof mapSolicitud>) =>
  (JSON.parse(r.datos!) as { photos: { group: string; col: string; fname: string }[] }).photos;

describe("mapSolicitud — el arreglo `fotos` de Ops", () => {
  it("rescata las DOS fotos del caso real de la unidad 54", () => {
    const fotos = fotosDe(mapSolicitud(base({ fotos: [K1, K2] }), resolver));
    expect(fotos.map((f) => f.fname)).toEqual([
      "resuelto_f52e8b80c0e04e3dbf5c9dacc3b50fdb.webp",
      "resuelto_683a2d344fc54b6799331609145b4c97.webp",
    ]);
  });

  it("las junta con `photo` y `firma` sin perder ninguna", () => {
    const fotos = fotosDe(
      mapSolicitud(base({ photo: KPHOTO, fotos: [K1, K2], firma: KFIRMA }), resolver),
    );
    expect(fotos).toHaveLength(4);
    expect(fotos.map((f) => f.col)).toEqual(["foto", "foto 2", "foto 3", "firma"]);
    // La firma va al final y en su propio grupo: la galería agrupa por `group`.
    expect(fotos[3]!.group).toBe("Firma");
    expect(fotos.slice(0, 3).every((f) => f.group === "Evidencia")).toBe(true);
  });

  it("numera desde 1 cuando NO viene `photo` (el arreglo es la única evidencia)", () => {
    const fotos = fotosDe(mapSolicitud(base({ fotos: [K1, K2] }), resolver));
    expect(fotos.map((f) => f.col)).toEqual(["foto", "foto 2"]);
  });

  // Los payloads llegan varias veces (creacion + cambio_estado); si `fotos` repitiera la de
  // `photo`, duplicarla llenaría la galería de la misma imagen.
  it("no duplica una foto que ya venía en `photo`", () => {
    const fotos = fotosDe(mapSolicitud(base({ photo: KPHOTO, fotos: [KPHOTO, K1] }), resolver));
    expect(fotos).toHaveLength(2);
    expect(fotos.map((f) => f.fname)).toEqual([
      "resuelto_9c4fee0018c34108875474a3f05f6ecc.webp",
      "resuelto_f52e8b80c0e04e3dbf5c9dacc3b50fdb.webp",
    ]);
  });

  it("ignora entradas basura del arreglo sin perder las buenas", () => {
    const fotos = fotosDe(
      mapSolicitud(base({ fotos: [K1, "", null, 42, { x: 1 }, K2] as unknown[] }), resolver),
    );
    expect(fotos.map((f) => f.fname)).toEqual([
      "resuelto_f52e8b80c0e04e3dbf5c9dacc3b50fdb.webp",
      "resuelto_683a2d344fc54b6799331609145b4c97.webp",
    ]);
  });

  it("tolera que `fotos` no sea un arreglo", () => {
    for (const v of [undefined, null, "", "SOL/x.webp", {}, 0]) {
      const fotos = fotosDe(mapSolicitud(base({ photo: KPHOTO, fotos: v }), resolver));
      expect(fotos.map((f) => f.col), JSON.stringify(v)).toEqual(["foto"]);
    }
  });
});

describe("mapSolicitud — información que se estaba tirando", () => {
  it("conserva el comentario de quien autorizó", () => {
    const r = mapSolicitud(base({ comentarioAut: "autorizado con nota", autorizadoPor: "KARLA" }), resolver);
    const d = JSON.parse(r.datos!) as Record<string, unknown>;
    expect(d.comentarioAut).toBe("autorizado con nota");
  });

  it("conserva el rastro de una corrección pedida por Ops", () => {
    const r = mapSolicitud(
      base({
        camposCorregir: ["fotos"],
        correccion: { por: "GONZALEZ LOPEZ SERGIO RENE", en: "2026-08-03T09:06:40-06:00" },
      }),
      resolver,
    );
    const d = JSON.parse(r.datos!) as Record<string, unknown>;
    expect(d.camposCorregir).toEqual(["fotos"]);
    expect(d.correccion).toMatchObject({ por: "GONZALEZ LOPEZ SERGIO RENE" });
  });

  it("no inventa campos cuando Ops no los manda", () => {
    const d = JSON.parse(mapSolicitud(base(), resolver).datos!) as Record<string, unknown>;
    expect(d.comentarioAut).toBe("");
    expect(d.camposCorregir).toBeUndefined();
    expect(d.correccion).toBeUndefined();
  });
});
