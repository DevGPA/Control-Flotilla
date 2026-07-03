import { describe, expect, it, vi } from "vitest";
import {
  buildFleetMapModel,
  renderFleetMap,
  tileState,
  type FleetMapInput,
} from "../src/ui/fleetMap";

describe("tileState", () => {
  it("prioridad: taller > atención > revisar > ok", () => {
    expect(tileState({ enTaller: true, atencion: true, revisar: true })).toBe("taller");
    expect(tileState({ atencion: true, revisar: true })).toBe("urg");
    expect(tileState({ revisar: true })).toBe("rev");
    expect(tileState({})).toBe("ok");
  });
});

describe("buildFleetMapModel", () => {
  const units: FleetMapInput[] = [
    { uid: "u46", eco: 46, branch: "Guadalajara", atencion: true },
    { uid: "u65", eco: 65, branch: "Guadalajara", revisar: true },
    { uid: "u12", eco: 12, branch: "Guadalajara" },
    { uid: "u67", eco: 67, branch: "Cedis", atencion: true },
    { uid: "u01", eco: 1, branch: "Cedis" },
    { uid: "u99", eco: 99, branch: "" }, // sucursal vacía
  ];

  it("agrupa por sucursal; vacía → 'Sin sucursal'; grupos grandes primero", () => {
    const m = buildFleetMapModel(units);
    expect(m.map((g) => g.branch)).toEqual(["Guadalajara", "Cedis", "Sin sucursal"]);
    expect(m[0]!.tiles).toHaveLength(3);
  });

  it("dentro del grupo: severidad primero, luego ECO numérico", () => {
    const gdl = buildFleetMapModel(units)[0]!;
    expect(gdl.tiles.map((t) => t.label)).toEqual(["46", "65", "12"]);
    expect(gdl.tiles.map((t) => t.state)).toEqual(["urg", "rev", "ok"]);
  });

  it("orden numérico de ECO (no lexicográfico) entre estados iguales", () => {
    const m = buildFleetMapModel([
      { eco: 10, branch: "X" },
      { eco: 2, branch: "X" },
    ]);
    expect(m[0]!.tiles.map((t) => t.label)).toEqual(["2", "10"]);
  });

  it("tip descriptivo y key = uid (fallback al label)", () => {
    const m = buildFleetMapModel(units);
    const urg = m[0]!.tiles[0]!;
    expect(urg.key).toBe("u46");
    expect(urg.tip).toBe("ECO 46 · Requiere atención · Guadalajara");
    const sin = buildFleetMapModel([{ eco: 7, branch: "X" }])[0]!.tiles[0]!;
    expect(sin.key).toBe("7");
  });
});

describe("renderFleetMap", () => {
  it("pinta grupos y tiles accesibles; click dispara onSelect(key)", () => {
    const el = document.createElement("div");
    const onSelect = vi.fn();
    renderFleetMap(
      el,
      buildFleetMapModel([{ uid: "u46", eco: 46, branch: "GDL", atencion: true }]),
      onSelect,
    );
    const tile = el.querySelector<HTMLButtonElement>(".fm-tile")!;
    expect(tile.tagName).toBe("BUTTON");
    expect(tile.className).toContain("fm-urg");
    expect(tile.getAttribute("aria-label")).toContain("ECO 46");
    tile.click();
    expect(onSelect).toHaveBeenCalledWith("u46");
    expect(el.querySelector(".fm-glbl")!.textContent).toBe("GDL · 1");
  });

  it("re-render limpia el contenido previo", () => {
    const el = document.createElement("div");
    renderFleetMap(el, buildFleetMapModel([{ eco: 1, branch: "A" }]));
    renderFleetMap(el, buildFleetMapModel([{ eco: 2, branch: "B" }]));
    expect(el.querySelectorAll(".fm-group")).toHaveLength(1);
    expect(el.querySelector(".fm-glbl")!.textContent).toBe("B · 1");
  });
});
