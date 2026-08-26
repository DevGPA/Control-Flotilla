import { describe, expect, it } from "vitest";
import { fnamesParaVision } from "../src/vision/fnames";

function datosCon(photos: unknown): string {
  return JSON.stringify({ photos, fuente: "ops-gpa" });
}

describe("fnamesParaVision: qué fotos de datos.photos van a la visión IA", () => {
  it("un reporte de carga (ticket+bomba+niveles) → mapa col→fname de las 4 evidencias", () => {
    const datos = datosCon([
      { group: "Carga", col: "fotoAntes", fname: "opsgpa_10_a1_fotoantes.jpg" },
      { group: "Carga", col: "fotoDespues", fname: "opsgpa_10_a2_fotodespues.jpg" },
      { group: "Carga", col: "fotoBomba", fname: "opsgpa_10_a3_fotobomba.jpg" },
      { group: "Carga", col: "fotoTicket", fname: "opsgpa_10_a4_fototicket.jpg" },
      { group: "Carga", col: "fotoPersona", fname: "opsgpa_10_a5_fotopersona.jpg" },
      { group: "Firma", col: "firma", fname: "opsgpa_10_a6_firma.jpg" },
    ]);
    expect(fnamesParaVision(datos)).toEqual({
      fotoAntes: "opsgpa_10_a1_fotoantes.jpg",
      fotoDespues: "opsgpa_10_a2_fotodespues.jpg",
      fotoBomba: "opsgpa_10_a3_fotobomba.jpg",
      fotoTicket: "opsgpa_10_a4_fototicket.jpg",
    });
  });

  it("una SOLICITUD (sin ticket ni bomba) → vacío: no hay nada que leer, no se dispara visión", () => {
    const datos = datosCon([
      { group: "Solicitud", col: "photo", fname: "opsgpa_10_b1_photo.jpg" },
      { group: "Solicitud", col: "fotos[0]", fname: "opsgpa_10_b2_fotos0.jpg" },
    ]);
    expect(fnamesParaVision(datos)).toEqual({});
  });

  it("solo niveles sin ticket/bomba → vacío (sin evidencia de montos la lectura no aporta)", () => {
    const datos = datosCon([
      { group: "Carga", col: "fotoAntes", fname: "a.jpg" },
      { group: "Carga", col: "fotoDespues", fname: "b.jpg" },
    ]);
    expect(fnamesParaVision(datos)).toEqual({});
  });

  it("datos corruptos, vacíos o sin photos → vacío, jamás lanza", () => {
    expect(fnamesParaVision(null)).toEqual({});
    expect(fnamesParaVision("")).toEqual({});
    expect(fnamesParaVision("{no json")).toEqual({});
    expect(fnamesParaVision(JSON.stringify({ photos: "nope" }))).toEqual({});
  });
});
