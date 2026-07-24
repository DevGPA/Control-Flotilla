import { describe, expect, it } from "vitest";
import {
  aclarar,
  rampaSecuencial,
  animVivo,
  ejesVivo,
  tooltipVivo,
  gradBar,
  gradBarH,
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
  it("con prefers-reduced-motion: reduce devuelve animationDuration 0", () => {
    const orig = window.matchMedia;
    window.matchMedia = ((q: string) =>
      ({
        matches: q.includes("prefers-reduced-motion"),
        media: q,
      }) as MediaQueryList) as typeof window.matchMedia;
    try {
      expect(animVivo()).toEqual({ animationDuration: 0, animationEasing: "cubicOut" });
    } finally {
      window.matchMedia = orig;
    }
  });
});

describe("ejesVivo / tooltipVivo / gradBar", () => {
  it("ejes recesivos: sin axisLine ni ticks, splitLine suave", () => {
    const e = ejesVivo(P);
    expect(e.axisLine.show).toBe(false);
    expect(e.axisTick.show).toBe(false);
    expect(e.splitLine.lineStyle.opacity).toBeCloseTo(0.55);
    expect(e.axisLabel).toEqual({ color: "#666", fontSize: 10.5 });
  });
  it("tooltip usa superficie del tema", () => {
    expect(tooltipVivo(P)).toEqual({
      backgroundColor: "#fff",
      borderColor: "#ccc",
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: "#000", fontSize: 12 },
      extraCssText: "border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,.16)",
    });
  });
  it("gradBar produce LinearGradient vertical con 2 stops", () => {
    const g = gradBar("#1e4fa3") as unknown as { colorStops: { color: string }[]; y2: number };
    expect(g.colorStops).toHaveLength(2);
    expect(g.colorStops[0]!.color).toBe(aclarar("#1e4fa3", 0.28));
    expect(g.colorStops[0]!.color).not.toBe("#1e4fa3");
    expect(g.colorStops[1]!.color).toBe("#1e4fa3");
    expect(g.y2).toBe(1);
  });
  it("gradBarH es horizontal (x2=1, y2=0)", () => {
    const g = gradBarH("#1e4fa3") as unknown as { x2: number; y2: number };
    expect(g.x2).toBe(1);
    expect(g.y2).toBe(0);
  });
});
