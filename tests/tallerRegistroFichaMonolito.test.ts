// Registro como ficha (spec 2026-09-30): estructura del modal y ayudantes del monolito,
// ejecutando los literales REALES del HTML (patrón de tests/tallerAntesDespuesMonolito.test.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hayCambios } from "../src/taller/cambiosFormulario";

const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");
const INI = "// ── Registro como ficha — estado y ayudantes";
const FIN = "// ── fin registro como ficha";
const bloque = (): string => {
  const i = html.indexOf(INI);
  const j = html.indexOf(FIN, i);
  expect(i, "falta el bloque de ayudantes").toBeGreaterThan(-1);
  expect(j, "falta el cierre del bloque").toBeGreaterThan(i);
  return html.slice(i, j);
};

type Ayudantes = {
  _tfTomarFoto: () => Record<string, { valor: string; readOnly: boolean }>;
  _tfRecalcularCambios: () => void;
  _tallerCerrarConAviso: () => boolean;
  _tfAutofoco: (id: string) => void;
  _tfRegistrarNombre: (
    n: HTMLElement,
    crudo: string,
    p: (s: string | null) => string,
    cierre?: boolean,
  ) => HTMLElement;
  _tfNombresRefrescar: () => void;
  _tfCablear: () => void;
  setFoto: (f: unknown) => void;
  setTocado: (v: boolean) => void;
  getTocado: () => boolean;
};

/** Ejecuta el bloque real con dobles de los globales que usa. */
function ayudantes(win: Record<string, unknown>, extra: Record<string, unknown> = {}): Ayudantes {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- se ejecuta el literal real
  const fabrica = new Function(
    "window",
    "document",
    "tallerEntries",
    "closeTallerModal",
    "_provPartidas",
    "confirm",
    "_tallerEditId",
    "_provFiltro",
    `${bloque()}
    return { _tfTomarFoto, _tfRecalcularCambios, _tallerCerrarConAviso, _tfAutofoco, _tfRegistrarNombre, _tfNombresRefrescar, _tfCablear,
      setFoto: (f) => { _tfFotoCampos = f; }, setTocado: (v) => { _tfTocado = v; }, getTocado: () => _tfTocado };`,
  );
  return fabrica(
    win,
    document,
    extra.tallerEntries ?? [],
    extra.closeTallerModal ?? vi.fn(),
    extra._provPartidas ?? vi.fn(),
    extra.confirm ?? vi.fn(() => true),
    extra._tallerEditId ?? null,
    "todas",
  ) as Ayudantes;
}

const formulario = (): void => {
  // eslint-disable-next-line no-restricted-syntax -- armado de prueba, literal controlado
  document.body.innerHTML = `
    <div id="taller-modal"><div class="tl-mttl" id="tl-mttl" tabindex="-1">T</div>
      <details id="tf-datos"><fieldset id="tf-datos-campos">
        <input id="tf-km" value="85000"><input id="tf-gasto" value="3850" readonly><input id="tf-tecnico" value="Taller X">
      </fieldset></details>
      <button id="btn-liga-copiar">Copiar</button>
      <span id="tf-sin-cambios" hidden>Sin cambios</span><button id="btn-guardar-taller">Guardar</button>
      <div id="tf-prov-partidas"></div>
    </div>`;
};

beforeEach(formulario);

describe("markup del registro (§4.1)", () => {
  it("orden: ficha → hallazgos → Datos del registro (formulario intacto dentro del fieldset)", () => {
    const iFicha = html.indexOf('id="tf-ficha"');
    const iProv = html.indexOf('id="tf-proveedor"');
    const iDatos = html.indexOf('id="tf-datos"');
    const iCampos = html.indexOf('id="tf-datos-campos"');
    const iIdent = html.indexOf(">Identificación de la unidad<");
    const iMant = html.indexOf('<div class="tl-sec">Mantenimiento</div>');
    const iNotas = html.indexOf('<div class="tl-sec">Notas</div>');
    const iFieldsetFin = html.indexOf("</fieldset>", iCampos);
    expect(iFicha).toBeGreaterThan(-1);
    expect(iProv).toBeGreaterThan(iFicha);
    expect(iDatos).toBeGreaterThan(iProv);
    expect(iCampos).toBeGreaterThan(iDatos);
    expect(iIdent).toBeGreaterThan(iCampos);
    expect(iMant).toBeGreaterThan(iIdent);
    expect(iNotas).toBeGreaterThan(iMant);
    expect(iFieldsetFin).toBeGreaterThan(html.indexOf('id="tf-comentario"'));
    expect(html).not.toContain('<div class="tl-sec needs-hibrido">Proveedor</div>');
  });
  it("ids nuevos, título enfocable, Guardar con id, Reingresar/Finalizar con needs-write", () => {
    for (const id of [
      "tl-msub",
      "tf-aviso-firma",
      "tf-ficha-gpa",
      "tf-ficha-taller",
      "tf-ficha-dias",
      "tf-ficha-salida",
      "tf-ficha-costo",
      "tf-ficha-liga",
      "tf-datos-resumen",
      "tf-sin-cambios",
      "btn-guardar-taller",
    ]) {
      expect(html, id).toContain(`id="${id}"`);
    }
    const iTtl = html.indexOf('id="tl-mttl"');
    const ttl = html.slice(html.lastIndexOf("<div", iTtl), html.indexOf(">", iTtl));
    expect(ttl).toContain('tabindex="-1"');
    for (const id of ["btn-reingreso", "btn-finalizar"]) {
      const i = html.indexOf(`id="${id}"`);
      expect(html.slice(html.lastIndexOf("<button", i), html.indexOf(">", i)), id).toContain(
        "needs-write",
      );
    }
  });
  it("el fondo, el ✕ y Cerrar pasan por _tallerCerrarConAviso; el aviso de firma se oculta con hidden", () => {
    expect(html).toContain(`if(event.target.id==='taller-modal')_tallerCerrarConAviso()`);
    expect(html).toContain(
      'aria-label="Cerrar modal de taller" style="position:static" onclick="_tallerCerrarConAviso()"',
    );
    expect(html).toContain(
      '<button class="tl-cancel" onclick="_tallerCerrarConAviso()">Cerrar</button>',
    );
    const i = html.indexOf('id="tf-aviso-firma"');
    expect(html.slice(html.lastIndexOf("<button", i), html.indexOf(">", i))).toContain(" hidden");
  });
  it("el bloque de ayudantes vive fuera de openTallerModal…closeTallerModal", () => {
    const iOpen = html.indexOf("function openTallerModal(");
    const iClose = html.indexOf("\nfunction closeTallerModal", iOpen);
    const iBloque = html.indexOf(INI);
    expect(iBloque < iOpen || iBloque > iClose).toBe(true);
  });
});

describe("Guardar solo con cambios (§4.5)", () => {
  it("sin cambios ⇒ Guardar apagado y 'Sin cambios' visible; teclear en Km lo enciende", () => {
    const a = ayudantes({ __hayCambios: hayCambios });
    a.setFoto(a._tfTomarFoto());
    a._tfRecalcularCambios();
    const btn = document.getElementById("btn-guardar-taller") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect((document.getElementById("tf-sin-cambios") as HTMLElement).hidden).toBe(false);
    (document.getElementById("tf-km") as HTMLInputElement).value = "86000";
    a._tfRecalcularCambios();
    expect(btn.disabled).toBe(false);
    expect((document.getElementById("tf-sin-cambios") as HTMLElement).hidden).toBe(true);
  });
  it("#tf-gasto repintado (readOnly) no enciende Guardar", () => {
    const a = ayudantes({ __hayCambios: hayCambios });
    a.setFoto(a._tfTomarFoto());
    (document.getElementById("tf-gasto") as HTMLInputElement).value = "5200";
    a._tfRecalcularCambios();
    expect((document.getElementById("btn-guardar-taller") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
  it("alta o reingreso (sin foto) ⇒ Guardar siempre encendido", () => {
    const a = ayudantes({ __hayCambios: hayCambios });
    a.setFoto(null);
    a._tfRecalcularCambios();
    expect((document.getElementById("btn-guardar-taller") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

describe("_tallerCerrarConAviso (§2 #23)", () => {
  it("con cambios y confirm=false ⇒ no cierra; confirm=true ⇒ cierra", () => {
    const cerrar = vi.fn();
    const confirmar = vi.fn(() => false);
    const a = ayudantes(
      { __hayCambios: hayCambios },
      { closeTallerModal: cerrar, confirm: confirmar },
    );
    a.setFoto(a._tfTomarFoto());
    (document.getElementById("tf-km") as HTMLInputElement).value = "1";
    expect(a._tallerCerrarConAviso()).toBe(false);
    expect(confirmar).toHaveBeenCalledWith("¿Descartar los cambios?");
    expect(cerrar).not.toHaveBeenCalled();
    confirmar.mockReturnValue(true);
    expect(a._tallerCerrarConAviso()).toBe(true);
    expect(cerrar).toHaveBeenCalledTimes(1);
  });
  it("sin cambios ⇒ cierra sin preguntar; en el alta pregunta solo si se tecleó algo", () => {
    const cerrar = vi.fn();
    const confirmar = vi.fn(() => false);
    const a = ayudantes(
      { __hayCambios: hayCambios },
      { closeTallerModal: cerrar, confirm: confirmar },
    );
    a.setFoto(a._tfTomarFoto());
    expect(a._tallerCerrarConAviso()).toBe(true);
    expect(confirmar).not.toHaveBeenCalled();
    a.setFoto(null);
    a.setTocado(false);
    expect(a._tallerCerrarConAviso()).toBe(true);
    a.setTocado(true);
    expect(a._tallerCerrarConAviso()).toBe(false);
    expect(confirmar).toHaveBeenCalledTimes(1);
  });
  it("_tfCablear: teclear en Datos marca tocado y recalcula", () => {
    const a = ayudantes({ __hayCambios: hayCambios });
    a._tfCablear();
    a.setFoto(a._tfTomarFoto());
    const km = document.getElementById("tf-km") as HTMLInputElement;
    km.value = "2";
    km.dispatchEvent(new Event("input", { bubbles: true }));
    expect(a.getTocado()).toBe(true);
    expect((document.getElementById("btn-guardar-taller") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

describe("autofoco y nombres", () => {
  it("_tfAutofoco mueve el atributo y nunca lo deja en un botón de liga", () => {
    const a = ayudantes({});
    a._tfAutofoco("btn-liga-copiar");
    a._tfAutofoco("tl-mttl");
    expect(document.getElementById("tl-mttl")?.hasAttribute("data-autofocus")).toBe(true);
    expect(document.getElementById("btn-liga-copiar")?.hasAttribute("data-autofocus")).toBe(false);
  });
  it("_tfRegistrarNombre pinta con el puente o con el respaldo, nunca el GUID; refrescar reescribe", () => {
    const GUID = "11111111-2222-4333-8444-555555555555";
    const win: Record<string, unknown> = {};
    const a = ayudantes(win);
    const nodo = document.createElement("span");
    document.body.appendChild(nodo);
    a._tfRegistrarNombre(nodo, GUID, (n) => `emitida por ${n}`);
    expect(nodo.textContent).toBe("emitida por un usuario de GPA");
    win.__nombreDeUsuario = () => "Ana López";
    a._tfNombresRefrescar();
    expect(nodo.textContent).toBe("emitida por Ana López");
    expect(document.body.innerHTML).not.toContain(GUID);
  });
  it("cierre: usa __describirRevocadaPor y sin nombre deja la frase sola", () => {
    const win: Record<string, unknown> = {
      __describirRevocadaPor: () => ({ porCierre: true, nombre: null }),
    };
    const a = ayudantes(win);
    const nodo = document.createElement("span");
    document.body.appendChild(nodo);
    a._tfRegistrarNombre(
      nodo,
      "cierre:desconocido",
      (n) => (n ? `Se cerró junto con la visita (${n})` : "Se cerró junto con la visita"),
      true,
    );
    expect(nodo.textContent).toBe("Se cerró junto con la visita");
  });
});
