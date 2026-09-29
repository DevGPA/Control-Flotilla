// Visor A+ (spec 2026-09-28 §6.4): se construye con createElement y vive en happy-dom.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { abrirVisorAntesDespues, abrirVisorFotos, fechaCorta } from "../src/taller/visorFotos";

const url = vi.fn(async (k: string) => `https://ejemplo.test/${k}`);

beforeEach(() => {
  // eslint-disable-next-line no-restricted-syntax -- limpieza de prueba, string literal controlado
  document.body.innerHTML = "";
  url.mockClear();
});

async function asentar() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

const abrir = (sobre: Partial<Parameters<typeof abrirVisorAntesDespues>[0]> = {}) =>
  abrirVisorAntesDespues({
    antes: { llaves: ["a1.jpg", "a2.jpg"], fecha: "2026-09-14" },
    despues: { llaves: ["d1.jpg"], fecha: "2026-09-16T15:00:00.000Z" },
    titulo: "Balatas traseras",
    subtitulo: "Refacción · $1,650.00 · terminada el 16/09/2026",
    url,
    ...sobre,
  });

const visor = () => document.querySelector<HTMLElement>("#taller-visor-antes-despues");
const imgs = () => Array.from(visor()!.querySelectorAll<HTMLImageElement>("img[data-lado]"));

describe("fechaCorta", () => {
  it("una fecha sola se lee tal cual (no se corre un día en México)", () => {
    expect(fechaCorta("2026-09-14")).toBe("14 sep");
  });
  it("un instante ISO usa el día local", () => {
    expect(fechaCorta("2026-09-16T15:00:00.000Z")).toBe("16 sep");
  });
  it.each([undefined, null, "", "basura", "2026-13-01"])("%j ⇒ '' (nunca 'Invalid Date')", (v) => {
    expect(fechaCorta(v as string | undefined)).toBe("");
  });
});

describe("visor A+ — antes y después", () => {
  it("abre con las dos columnas, su fecha y su conteo", async () => {
    abrir();
    await asentar();
    const v = visor();
    expect(v).not.toBeNull();
    expect(v!.getAttribute("role")).toBe("dialog");
    expect(v!.textContent).toContain("ANTES · 14 sep · 2 fotos");
    expect(v!.textContent).toContain("DESPUÉS · 16 sep · 1 foto");
    expect(v!.textContent).toContain("Balatas traseras");
  });

  it("pide la primera foto de cada lado y la pinta en su columna", async () => {
    abrir();
    await asentar();
    const [antes, despues] = imgs();
    expect(antes!.src).toBe("https://ejemplo.test/a1.jpg");
    expect(despues!.src).toBe("https://ejemplo.test/d1.jpg");
  });

  it("la tira cambia SOLO su lado", async () => {
    abrir();
    await asentar();
    const miniaturas = Array.from(
      visor()!.querySelectorAll<HTMLButtonElement>("button[data-miniatura]"),
    );
    const segundaAntes = miniaturas.find(
      (b) => b.getAttribute("aria-label") === "antes: foto 2 de 2",
    );
    expect(segundaAntes).toBeDefined();
    segundaAntes!.click();
    await asentar();
    const [antes, despues] = imgs();
    expect(antes!.src).toBe("https://ejemplo.test/a2.jpg");
    expect(despues!.src).toBe("https://ejemplo.test/d1.jpg");
  });

  it("un lado vacío (mano de obra sin foto) dice 'Sin foto' y no rompe nada", async () => {
    abrir({ despues: { llaves: [], fecha: "2026-09-16" } });
    await asentar();
    expect(visor()!.textContent).toContain("DESPUÉS · 16 sep · sin foto");
    expect(visor()!.textContent).toContain("Sin foto");
  });

  it("sin fecha, la leyenda no inventa una (Review Focus 3)", async () => {
    abrir({ antes: { llaves: ["a1.jpg"] } });
    await asentar();
    expect(visor()!.textContent).toContain("ANTES · 1 foto");
    expect(visor()!.textContent).not.toContain("Invalid");
  });

  it("sin ninguna foto de ningún lado no abre nada", () => {
    abrir({ antes: { llaves: [] }, despues: { llaves: [] } });
    expect(visor()).toBeNull();
  });

  it("Esc cierra y limpia el DOM", () => {
    abrir();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(visor()).toBeNull();
  });

  it("abrir el visor simple cierra el A+ (un solo visor vivo)", () => {
    abrir();
    abrirVisorFotos({ llaves: ["x.jpg"], url });
    expect(visor()).toBeNull();
    expect(document.querySelector("#taller-visor-fotos")).not.toBeNull();
  });

  it("el título viaja como texto, nunca como HTML", () => {
    abrir({ titulo: '<img src="x" onerror="alert(1)">' });
    expect(visor()!.querySelector('img[src="x"]')).toBeNull();
    expect(visor()!.textContent).toContain('<img src="x"');
  });

  it("el foco queda atrapado: Tab desde el último botón vuelve al primero", () => {
    abrir();
    const botones = Array.from(visor()!.querySelectorAll("button"));
    const ultimo = botones[botones.length - 1]!;
    ultimo.focus();
    const ev = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(botones[0]);
  });
});
