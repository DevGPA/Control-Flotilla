// tests/tallerPanelRechazoVisibilidad.test.ts
//
// El panel "Motivo del rechazo" de la bandeja nacía ABIERTO: el `display:flex`
// declarado EN LÍNEA le gana a la regla `[hidden]{display:none}` de la hoja del
// navegador (el repo no tiene regla `[hidden]` propia), así que `panel.hidden`
// dejaba de ocultar nada y "✕ No autorizar" solo alternaba un atributo
// invisible. El contrato que estas pruebas anclan: hidden y display se mueven
// JUNTOS, desde un solo lugar (`_bnPanelVisible`).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8").replace(
  /\r\n/g,
  "\n",
);

/** Texto de una función de nivel superior del monolito (hasta su `}` en columna 0). */
function fuenteFuncion(nombre: string): string {
  const i = html.indexOf(`\nfunction ${nombre}(`);
  expect(i, `no se encontró la función ${nombre} en el monolito`).toBeGreaterThan(-1);
  const fin = html.indexOf("\n}\n", i);
  expect(fin, `no se encontró el cierre de ${nombre}`).toBeGreaterThan(i);
  return html.slice(i + 1, fin + 3);
}

/** Cuerpo de una función de nivel superior (sin firma ni llaves externas). */
function cuerpoFuncion(nombre: string): string {
  const src = fuenteFuncion(nombre);
  return src.slice(src.indexOf("{") + 1, src.lastIndexOf("}"));
}

type PanelFalso = { hidden: boolean; style: { display: string } };

// (a) La aserción principal: se EJECUTA el literal real del HTML, no una copia.
// Si alguien vuelve a separar `hidden` de `display`, esto cae.
describe("_bnPanelVisible — hidden y display se mueven juntos (literal real del monolito)", () => {
  function corre(visible: boolean, inicial: PanelFalso): PanelFalso {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- se ejecuta el literal real del HTML, patrón del harness de tallerOlaHonestidadUi
    const fn = new Function("panel", "visible", cuerpoFuncion("_bnPanelVisible"));
    fn(inicial, visible);
    return inicial;
  }

  it("visible=false ⇒ hidden=true Y display:none", () => {
    const panel = corre(false, { hidden: false, style: { display: "" } });
    expect(panel.hidden).toBe(true);
    expect(panel.style.display).toBe("none");
  });

  it("visible=true ⇒ hidden=false Y display:flex", () => {
    const panel = corre(true, { hidden: false, style: { display: "" } });
    expect(panel.hidden).toBe(false);
    expect(panel.style.display).toBe("flex");
  });

  it("abrir desde el estado cerrado devuelve AMBAS cosas, no solo el atributo", () => {
    const panel = corre(true, { hidden: true, style: { display: "none" } });
    expect(panel.hidden).toBe(false);
    expect(panel.style.display).toBe("flex");
  });
});

// (b) El cssText ya no puede opinar sobre `display`: el helper es su único dueño.
describe("_bnPanelRechazo — el cssText no declara display", () => {
  it("el cssText del panel no trae `display:flex` ni ningún otro `display:`", () => {
    const cuerpo = cuerpoFuncion("_bnPanelRechazo");
    const m = cuerpo.match(/panel\.style\.cssText\s*=\s*"([^"]*)"/);
    expect(m, "no se encontró el cssText del panel").not.toBeNull();
    expect(m![1]).not.toContain("display:flex");
    expect(m![1]).not.toContain("display:");
  });

  it("el panel nace cerrado a través del helper", () => {
    expect(cuerpoFuncion("_bnPanelRechazo")).toContain("_bnPanelVisible(panel, false)");
  });
});

// (c) El toggle de "✕ No autorizar" pasa por el helper.
describe("_bnPartida — '✕ No autorizar' abre y cierra de verdad", () => {
  it("alterna con el helper", () => {
    expect(cuerpoFuncion("_bnPartida")).toContain("_bnPanelVisible(panel, panel.hidden)");
  });

  it("ya no alterna solo el atributo invisible", () => {
    expect(cuerpoFuncion("_bnPartida")).not.toContain("panel.hidden = !panel.hidden");
  });
});

// (d) Ningún `panel.hidden` suelto queda en las dos funciones que tocan el panel.
describe("ningún panel.hidden suelto", () => {
  it("_bnPartida no fija panel.hidden por su cuenta", () => {
    expect(cuerpoFuncion("_bnPartida")).not.toContain("panel.hidden = true");
  });

  it("_bnPanelRechazo (nacimiento y botón Cancelar) no fija panel.hidden por su cuenta", () => {
    expect(cuerpoFuncion("_bnPanelRechazo")).not.toContain("panel.hidden = true");
  });
});
