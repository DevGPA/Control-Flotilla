import { afterEach, describe, expect, it, vi } from "vitest";
import {
  branchLabel,
  buildFleetMapModel,
  renderFleetMap,
  tileState,
  type FleetMapInput,
} from "../src/ui/fleetMap";

describe("tileState", () => {
  it("operativa = no está en taller; los hallazgos NO la sacan de operativa", () => {
    expect(tileState({ enTaller: true })).toBe("taller");
    expect(tileState({ enTaller: true, alertas: ["Servicio vencido"] })).toBe("taller");
    expect(tileState({ alertas: ["Servicio vencido"] })).toBe("ok");
    expect(tileState({})).toBe("ok");
  });
});

describe("branchLabel", () => {
  it("title case con partículas en minúscula; vacía → 'Sin sucursal'", () => {
    expect(branchLabel("GUADALAJARA")).toBe("Guadalajara");
    expect(branchLabel("CIUDAD DE MEXICO")).toBe("Ciudad de Mexico");
    expect(branchLabel("  cancun ")).toBe("Cancun");
    expect(branchLabel("")).toBe("Sin sucursal");
    expect(branchLabel(undefined)).toBe("Sin sucursal");
  });
});

describe("buildFleetMapModel", () => {
  const units: FleetMapInput[] = [
    { uid: "u46", eco: 46, branch: "GUADALAJARA", alertas: ["Frenos con falla"] },
    { uid: "u65", eco: 65, branch: "GUADALAJARA", enTaller: true },
    { uid: "u12", eco: 12, branch: "GUADALAJARA" },
    { uid: "u67", eco: 67, branch: "CEDIS", alertas: ["Servicio vencido"] },
    { uid: "u01", eco: 1, branch: "CEDIS" },
    { uid: "u99", eco: 99, branch: "" }, // sucursal vacía
  ];

  it("agrupa por sucursal (etiqueta legible); vacía → 'Sin sucursal'; grupos grandes primero", () => {
    const m = buildFleetMapModel(units);
    expect(m.map((g) => g.branch)).toEqual(["Guadalajara", "Cedis", "Sin sucursal"]);
    expect(m[0]!.tiles).toHaveLength(3);
  });

  it("la misma sucursal con distinta capitalización es UN solo grupo", () => {
    const m = buildFleetMapModel([
      { eco: 1, branch: "GUADALAJARA" },
      { eco: 2, branch: "Guadalajara" },
    ]);
    expect(m).toHaveLength(1);
    expect(m[0]!.total).toBe(2);
  });

  it("conteos por sucursal: total, operativas y en taller", () => {
    const gdl = buildFleetMapModel(units)[0]!;
    expect(gdl.total).toBe(3);
    expect(gdl.enTaller).toBe(1);
    expect(gdl.operativas).toBe(2);
  });

  it("dentro del grupo: puntito rojo primero, luego taller, luego operativa", () => {
    const gdl = buildFleetMapModel(units)[0]!;
    expect(gdl.tiles.map((t) => t.label)).toEqual(["46", "65", "12"]);
    expect(gdl.tiles.map((t) => t.state)).toEqual(["ok", "taller", "ok"]);
    expect(gdl.tiles.map((t) => t.alerta)).toEqual([true, false, false]);
  });

  it("en taller no lleva puntito aunque traiga alertas (ya se está atendiendo)", () => {
    const t = buildFleetMapModel([
      { eco: 5, branch: "X", enTaller: true, alertas: ["Servicio vencido"] },
    ])[0]!.tiles[0]!;
    expect(t.state).toBe("taller");
    expect(t.alerta).toBe(false);
    expect(t.detalle).toBe("En taller");
  });

  it("orden numérico de ECO (no lexicográfico) entre estados iguales", () => {
    const m = buildFleetMapModel([
      { eco: 10, branch: "X" },
      { eco: 2, branch: "X" },
    ]);
    expect(m[0]!.tiles.map((t) => t.label)).toEqual(["2", "10"]);
  });

  it("detalle resume los motivos: hasta 2 y luego 'y N más'", () => {
    const [a, b, c] = buildFleetMapModel([
      { eco: 1, branch: "X", alertas: ["Frenos con falla"] },
      { eco: 2, branch: "X", alertas: ["Frenos con falla", "Servicio vencido"] },
      { eco: 3, branch: "X", alertas: ["A", "B", "C", "D"] },
    ])[0]!.tiles;
    expect(a!.detalle).toBe("Operativa · Frenos con falla");
    expect(b!.detalle).toBe("Operativa · Frenos con falla, Servicio vencido");
    expect(c!.detalle).toBe("Operativa · A, B y 2 más");
  });

  it("tip (lector de pantalla) completo y key = uid (fallback al label)", () => {
    const m = buildFleetMapModel(units);
    const urg = m[0]!.tiles[0]!;
    expect(urg.key).toBe("u46");
    expect(urg.tip).toBe("ECO 46 · Operativa · Frenos con falla · Guadalajara");
    const sin = buildFleetMapModel([{ eco: 7, branch: "X" }])[0]!.tiles[0]!;
    expect(sin.key).toBe("7");
    expect(sin.tip).toBe("ECO 7 · Operativa · X");
  });
});

describe("renderFleetMap", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("una tarjeta por sucursal: nombre, 'N de M operativas' y barra proporcional", () => {
    const el = document.createElement("div");
    renderFleetMap(
      el,
      buildFleetMapModel([
        { eco: 1, branch: "GDL" },
        { eco: 2, branch: "GDL" },
        { eco: 3, branch: "GDL", enTaller: true },
      ]),
    );
    const card = el.querySelector(".fm-card")!;
    expect(card.querySelector(".fm-cname")!.textContent).toBe("Gdl");
    expect(card.querySelector(".fm-ccount")!.textContent).toBe("2 de 3 operativas");
    const segs = card.querySelectorAll<HTMLElement>(".fm-bar > span");
    expect(segs).toHaveLength(2);
    expect(segs[0]!.className).toBe("fm-bar-ok");
    expect(segs[0]!.style.flexGrow).toBe("2");
    expect(segs[1]!.className).toBe("fm-bar-taller");
    expect(segs[1]!.style.flexGrow).toBe("1");
  });

  it("sin unidades en taller la barra solo lleva el tramo verde; sucursal de 1 en singular", () => {
    const el = document.createElement("div");
    renderFleetMap(el, buildFleetMapModel([{ eco: 1, branch: "A" }]));
    expect(el.querySelectorAll(".fm-bar > span")).toHaveLength(1);
    expect(el.querySelector(".fm-ccount")!.textContent).toBe("1 de 1 operativa");
  });

  it("tiles numerados y accesibles; sin title nativo; click dispara onSelect(key)", () => {
    const el = document.createElement("div");
    const onSelect = vi.fn();
    renderFleetMap(
      el,
      buildFleetMapModel([{ uid: "u46", eco: 46, branch: "GDL", alertas: ["Frenos con falla"] }]),
      onSelect,
    );
    const tile = el.querySelector<HTMLButtonElement>(".fm-tile")!;
    expect(tile.tagName).toBe("BUTTON");
    expect(tile.textContent).toBe("46");
    expect(tile.className).toContain("fm-ok");
    expect(tile.className).toContain("fm-alerta");
    expect(tile.getAttribute("aria-label")).toBe("ECO 46 · Operativa · Frenos con falla · Gdl");
    expect(tile.hasAttribute("title")).toBe(false);
    tile.click();
    expect(onSelect).toHaveBeenCalledWith("u46");
  });

  it("sin alertas no lleva la clase del puntito", () => {
    const el = document.createElement("div");
    renderFleetMap(el, buildFleetMapModel([{ eco: 1, branch: "A", enTaller: true }]));
    const tile = el.querySelector(".fm-tile")!;
    expect(tile.className).toContain("fm-taller");
    expect(tile.className).not.toContain("fm-alerta");
  });

  it("tarjeta al pasar el mouse (y con foco de teclado); se oculta al salir", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    renderFleetMap(
      el,
      buildFleetMapModel([{ eco: 79, branch: "MONTERREY", alertas: ["Frenos con falla"] }]),
    );
    const tile = el.querySelector<HTMLButtonElement>(".fm-tile")!;
    tile.dispatchEvent(new MouseEvent("mouseenter"));
    const tip = document.querySelector<HTMLElement>(".fm-tip")!;
    expect(tip).not.toBeNull();
    expect(tip.hidden).toBe(false);
    expect(tip.getAttribute("aria-hidden")).toBe("true");
    expect(tip.querySelector(".fm-tip-t")!.textContent).toBe("ECO 79 · Monterrey");
    expect(tip.querySelector(".fm-tip-d")!.textContent).toBe("Operativa · Frenos con falla");
    expect(tip.querySelector(".fm-tip-r")!.textContent).toBe("Frenos con falla");
    tile.dispatchEvent(new MouseEvent("mouseleave"));
    expect(tip.hidden).toBe(true);
    tile.dispatchEvent(new FocusEvent("focus"));
    expect(tip.hidden).toBe(false);
    tile.dispatchEvent(new FocusEvent("blur"));
    expect(tip.hidden).toBe(true);
  });

  it("una sola tarjeta flotante aunque se re-pinte varias veces", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const model = buildFleetMapModel([{ eco: 1, branch: "A" }]);
    renderFleetMap(el, model);
    el.querySelector(".fm-tile")!.dispatchEvent(new MouseEvent("mouseenter"));
    renderFleetMap(el, model);
    el.querySelector(".fm-tile")!.dispatchEvent(new MouseEvent("mouseenter"));
    expect(document.querySelectorAll(".fm-tip")).toHaveLength(1);
  });

  it("re-render limpia el contenido previo", () => {
    const el = document.createElement("div");
    renderFleetMap(el, buildFleetMapModel([{ eco: 1, branch: "A" }]));
    renderFleetMap(el, buildFleetMapModel([{ eco: 2, branch: "B" }]));
    expect(el.querySelectorAll(".fm-card")).toHaveLength(1);
    expect(el.querySelector(".fm-cname")!.textContent).toBe("B");
  });
});
