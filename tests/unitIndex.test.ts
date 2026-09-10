import { describe, it, expect } from "vitest";
import { indexaCatalogo, resuelveUnidad, placasSinUnidad } from "../src/fleet/unitIndex";

const u = (placa: string, eco = "") => ({ placa, economicoId: eco });

describe("indexaCatalogo — el cruce catalogo <-> registros", () => {
  it("indexa por la placa vigente, no por la escrita", () => {
    const i = indexaCatalogo([u("JV50090", "21")]); // placa RETIRADA en el catalogo
    expect([...i.porPlaca.keys()]).toEqual(["JB4255A"]);
    // una inspeccion archivada bajo la placa vigente encuentra su unidad
    expect(resuelveUnidad(i, "JB4255A")?.economicoId).toBe("21");
    // y una archivada bajo la retirada, tambien
    expect(resuelveUnidad(i, "JV50090")?.economicoId).toBe("21");
  });

  it("una unidad sana se resuelve a si misma", () => {
    const i = indexaCatalogo([u("JX36945", "13")]);
    expect(resuelveUnidad(i, "JX36945")?.economicoId).toBe("13");
    expect(i.duplicados).toEqual([]);
    expect(i.sinLlave).toBe(0);
  });

  it("DELATA los duplicados en vez de quedarse callado con el ultimo", () => {
    const i = indexaCatalogo([u("JV50090", "21-vieja"), u("JB4255A", "21-vigente")]);
    expect(i.porPlaca.size).toBe(1);
    expect(i.duplicados).toEqual([{ llave: "JB4255A", placas: ["JV50090", "JB4255A"] }]);
  });

  it("ante un duplicado gana la fila cuya placa YA es la vigente, en cualquier orden", () => {
    const a = indexaCatalogo([u("JV50090", "vieja"), u("JB4255A", "vigente")]);
    const b = indexaCatalogo([u("JB4255A", "vigente"), u("JV50090", "vieja")]);
    // determinista: NO depende del orden de paginacion de AppSync
    expect(a.porPlaca.get("JB4255A")?.economicoId).toBe("vigente");
    expect(b.porPlaca.get("JB4255A")?.economicoId).toBe("vigente");
  });

  it("tambien delata las variantes de captura de la misma placa", () => {
    const i = indexaCatalogo([u("JB4255A", "a"), u("JB-4255-A", "b")]);
    expect(i.duplicados).toHaveLength(1);
    expect(i.duplicados[0]!.llave).toBe("JB4255A");
  });

  it("excluye del indice las filas sin placa util y las cuenta", () => {
    const i = indexaCatalogo([u("JX36945"), u("—"), u(""), u("  ")]);
    expect(i.porPlaca.size).toBe(1);
    expect(i.sinLlave).toBe(3);
    // y no inventa una entrada vacia que las junte todas
    expect(i.porPlaca.has("")).toBe(false);
  });

  it("conserva los numeros de serie como identidad propia", () => {
    const i = indexaCatalogo([u("G25NXP58", "58"), u("560XM", "52"), u("H50FT", "50")]);
    expect(i.porPlaca.size).toBe(3);
    expect(resuelveUnidad(i, "560XM")?.economicoId).toBe("52");
    expect(i.duplicados).toEqual([]);
  });

  it("resuelveUnidad devuelve undefined si no esta y no truena con basura", () => {
    const i = indexaCatalogo([u("JX36945")]);
    expect(resuelveUnidad(i, "NOEXISTE")).toBeUndefined();
    expect(resuelveUnidad(i, "")).toBeUndefined();
    expect(resuelveUnidad(i, null)).toBeUndefined();
    expect(resuelveUnidad(i, {})).toBeUndefined();
  });
});

describe("placasSinUnidad — historial partido", () => {
  it("lista las placas con registros pero sin unidad, normalizadas y sin repetir", () => {
    const i = indexaCatalogo([u("JB4255A", "21")]);
    const fuera = placasSinUnidad(i, ["JB4255A", "JV50090", "JY38152", "jy38152", "82"]);
    // JB4255A y JV50090 resuelven a la unidad; quedan fuera JY38152 (una vez) y 82
    expect(fuera).toEqual(["82", "JY38152"]);
  });

  it("no reporta nada cuando todo encuentra su unidad", () => {
    const i = indexaCatalogo([u("JB4255A"), u("JX36945")]);
    expect(placasSinUnidad(i, ["JB4255A", "JV50090", "JX36945"])).toEqual([]);
  });

  it("ignora los vacios en vez de reportarlos como placa", () => {
    const i = indexaCatalogo([u("JB4255A")]);
    expect(placasSinUnidad(i, ["", null, undefined, "—", {}])).toEqual([]);
  });
});
