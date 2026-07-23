import { describe, expect, it } from "vitest";
import {
  aclarar,
  rampaSecuencial,
  animVivo,
  ejesVivo,
  tooltipVivo,
  gradBar,
} from "../src/dashboard/chartVivo";
import type { TremorPalette } from "../src/dashboard/chartTheme";

const P = {
  mode: "light",
  bg: "#fff",
  bg2: "#eee",
  bg3: "#ddd",
  ln: "#ccc",
  text: "#000",
  textSub: "#666",
  R: "#e11d48",
  A: "#b45309",
  G: "#047857",
  B: "#1d4ed8",
  O: "#ea580c",
  ac: "#1e4fa3",
  ac2: "#15397a",
  mes1: "#047857",
  mes2: "#1e4fa3",
  mes3: "#b45309",
} as TremorPalette;

describe("aclarar", () => {
  it("f=0 devuelve el color; f=1 devuelve blanco", () => {
    expect(aclarar("#1e4fa3", 0)).toBe("#1e4fa3");
    expect(aclarar("#1e4fa3", 1)).toBe("#ffffff");
  });
  it("f=0.5 mezcla a mitad de camino por canal", () => {
    expect(aclarar("#000000", 0.5)).toBe("#808080");
  });
});

describe("rampaSecuencial", () => {
  it("n pasos, monótona (más claro primero), termina en el color base", () => {
    const r = rampaSecuencial("#1e4fa3", 4);
    expect(r).toHaveLength(4);
    expect(r[3]).toBe("#1e4fa3");
    expect(new Set(r).size).toBe(4);
  });
});

describe("animVivo", () => {
  it("devuelve 700ms cubicOut (en node, sin matchMedia, no truena)", () => {
    expect(animVivo()).toEqual({ animationDuration: 700, animationEasing: "cubicOut" });
  });
});

describe("ejesVivo / tooltipVivo / gradBar", () => {
  it("ejes recesivos: sin axisLine ni ticks, splitLine suave", () => {
    const e = ejesVivo(P);
    expect(e.axisLine.show).toBe(false);
    expect(e.axisTick.show).toBe(false);
    expect(e.splitLine.lineStyle.opacity).toBeCloseTo(0.55);
  });
  it("tooltip usa superficie del tema", () => {
    expect(tooltipVivo(P).backgroundColor).toBe("#fff");
  });
  it("gradBar produce LinearGradient vertical con 2 stops", () => {
    const g = gradBar("#1e4fa3") as unknown as { colorStops: { color: string }[]; y2: number };
    expect(g.colorStops).toHaveLength(2);
    expect(g.colorStops[1]!.color).toBe("#1e4fa3");
    expect(g.y2).toBe(1);
  });
});
