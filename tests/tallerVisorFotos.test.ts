// El visor se construye con createElement (nunca innerHTML) y vive en happy-dom.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { abrirVisorFotos } from "../src/taller/visorFotos";

const url = vi.fn(async (k: string) => `https://ejemplo.test/${k}`);

beforeEach(() => {
  // eslint-disable-next-line no-restricted-syntax -- limpieza de prueba, string literal controlado
  document.body.innerHTML = "";
  url.mockClear();
});

const abrir = () =>
  abrirVisorFotos({
    llaves: ["a.jpg", "b.jpg", "c.jpg"],
    titulo: "Balatas delanteras · $550.00",
    subtitulo: "Eco 06 · subida por el taller",
    url,
  });

describe("visor de fotos", () => {
  it("abre con la primera foto y dice cuántas hay", async () => {
    abrir();
    const visor = document.querySelector("#taller-visor-fotos");
    expect(visor).not.toBeNull();
    expect(visor!.getAttribute("role")).toBe("dialog");
    expect(visor!.textContent).toContain("1 de 3");
    expect(visor!.textContent).toContain("Balatas delanteras");
  });

  it("la flecha derecha avanza y la izquierda retrocede", async () => {
    abrir();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(document.querySelector("#taller-visor-fotos")!.textContent).toContain("2 de 3");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(document.querySelector("#taller-visor-fotos")!.textContent).toContain("1 de 3");
  });

  it("Esc cierra y limpia el DOM", () => {
    abrir();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector("#taller-visor-fotos")).toBeNull();
  });

  it("sin fotos no abre nada", () => {
    abrirVisorFotos({ llaves: [], url });
    expect(document.querySelector("#taller-visor-fotos")).toBeNull();
  });

  it("no usa innerHTML con datos: el título viaja como texto", () => {
    abrirVisorFotos({ llaves: ["a.jpg"], titulo: "<img src=x onerror=alert(1)>", url });
    const visor = document.querySelector("#taller-visor-fotos")!;
    expect(visor.querySelector("img[src='x']")).toBeNull();
    expect(visor.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("abrir de nuevo cierra el anterior DE VERDAD: no deja la escucha de teclado viva", () => {
    abrir();
    abrirVisorFotos({ llaves: ["x.jpg", "y.jpg"], url });
    // mientras esta abierto solo debe existir UN visor en el DOM
    expect(document.querySelectorAll("#taller-visor-fotos").length).toBe(1);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector("#taller-visor-fotos")).toBeNull();

    // si la escucha del PRIMER visor sobrevivio, esta flecha todavia dispararia
    // su propio mover()/pintar() (una llamada a `url` que nadie ve).
    const llamadasAntes = url.mock.calls.length;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(url.mock.calls.length).toBe(llamadasAntes);
  });

  it("una respuesta de foto vieja no pinta encima de la que el usuario ya esta viendo", async () => {
    const resolvers: Array<(v: string) => void> = [];
    const urlManual = vi.fn(
      (k: string) =>
        new Promise<string | null>((resolve) => {
          void k;
          resolvers.push(resolve);
        }),
    );

    abrirVisorFotos({ llaves: ["a.jpg", "b.jpg"], url: urlManual });
    // el usuario avanza a la segunda foto ANTES de que la primera petición responda
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(resolvers.length).toBe(2);

    // ahora responde la PRIMERA peticion (a.jpg), tarde
    resolvers[0]!("https://ejemplo.test/a.jpg");
    await Promise.resolve();
    await Promise.resolve();

    const img = document.querySelector("#taller-visor-fotos img") as HTMLImageElement;
    expect(img.src).not.toContain("a.jpg");

    // la SEGUNDA peticion (b.jpg) si debe pintarse cuando responda
    resolvers[1]!("https://ejemplo.test/b.jpg");
    await Promise.resolve();
    await Promise.resolve();
    expect(img.src).toContain("b.jpg");
  });
});
