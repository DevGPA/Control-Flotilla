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

describe("_fichaPintar y la liga con nombre (§4.2, §4.7)", () => {
  const GUID = "11111111-2222-4333-8444-555555555555";
  const cuerpo = (nombre: string): string => {
    const i = html.indexOf(`function ${nombre}(`);
    expect(i, `no existe ${nombre}`).toBeGreaterThan(-1);
    return html.slice(i, html.indexOf("\nfunction ", i + 10));
  };
  const dom = (): void => {
    // eslint-disable-next-line no-restricted-syntax -- armado de prueba, literal controlado
    document.body.innerHTML = `
      <div id="tl-mttl"></div><div id="tl-msub"></div><button id="tf-aviso-firma" hidden></button>
      <section id="tf-ficha"><div id="tf-ficha-gpa"></div><div id="tf-ficha-taller"><span id="tf-ficha-taller-nombre"></span>
      <div id="tf-prov-taller"></div><div id="tf-prov-taller-nota"></div></div>
      <div id="tf-ficha-dias"></div><div id="tf-ficha-salida"></div><div id="tf-ficha-costo"></div>
      <div id="tf-ficha-liga"><div id="tf-prov-liga"><button id="btn-liga-copiar">Copiar liga</button><button id="btn-liga-revocar">Revocar</button></div>
      <div id="tf-prov-liga-meta"></div></div></section>
      <div id="tf-proveedor"><div id="tf-prov-partidas"></div></div><span id="tf-datos-resumen"></span>`;
  };
  const FICHA = {
    estadoGpa: "En Reparación",
    tipo: "Correctivo",
    esperandoFirma: true,
    dias: { n: 5, cerrada: false, inicio: "2026-09-25", fin: null, tono: "ambar" },
    salida: {
      estimadaGpa: "2026-09-30",
      prometida: "2026-10-01",
      compromisoOriginal: null,
      senal: { kind: "despues-de-estimada", dias: 1 },
    },
    costo: { kind: "partidas", autorizado: 3850, pendiente: 2400 },
    tallerNombre: "Taller Frenos del Bajío",
  };
  /** Ejecuta _fichaPintar + _provPintar reales con dobles. */
  function pintar(
    e: Record<string, unknown>,
    win: Record<string, unknown>,
    ficha: unknown = FICHA,
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- se ejecutan los literales reales
    const fabrica = new Function(
      "window",
      "document",
      "_partidasDeVisita",
      "_partidasConfiables",
      "fmtDate",
      "_fmtMon2",
      "_tfRegistrarNombre",
      "_tfNodosNombre",
      "_tfRecalcularCambios",
      "_tfNombreRespaldo",
      "_provPartidas",
      `${cuerpo("_fichaPintar")}\n${cuerpo("_provPintar")}\nreturn { _fichaPintar, _provPintar };`,
    );
    const registrar = (
      nodo: HTMLElement,
      crudo: string,
      plantilla: (n: string | null) => string,
      cierre?: boolean,
    ): HTMLElement => {
      const n = cierre
        ? ((win.__describirRevocadaPor as ((c: string) => { nombre: string | null }) | undefined)?.(
            crudo,
          ).nombre ?? null)
        : typeof win.__nombreDeUsuario === "function"
          ? (win.__nombreDeUsuario as (c: string) => string)(crudo)
          : "un usuario de GPA";
      nodo.textContent = plantilla(n);
      return nodo;
    };
    const fns = fabrica(
      { ...win, __fichaRegistro: () => ficha },
      document,
      () => (e.__ps as unknown[]) ?? [],
      () => true,
      (d: unknown) =>
        String(d ?? "")
          .slice(0, 10)
          .split("-")
          .reverse()
          .join("/"),
      (n: number) => `$${n.toFixed(2)}`,
      registrar,
      new Set(),
      vi.fn(),
      (c: string) => (/@/.test(String(c)) ? String(c).split("@")[0] : "un usuario de GPA"),
      vi.fn(),
    ) as { _provPintar: (e: unknown) => void };
    fns._provPintar(e);
  }
  const E = (s: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: "e1",
    eco: "06",
    plate: "PRB0006",
    brand: "Nissan NP300",
    sucursal: "GDL",
    area: "Mantenimiento",
    estado: "En Reparación",
    tipo: "Correctivo",
    km: 85000,
    tecnico: "Taller Frenos del Bajío",
    ...s,
  });

  beforeEach(dom);

  it("pinta subtítulo, GPA/TALLER, días, salida y costo con los textos exactos", () => {
    const liga = {
      kind: "activa",
      diasRestantes: 88,
      emitidaPor: GUID,
      emitidaEn: "2026-09-24",
      venceEn: "2026-12-23",
    };
    pintar(E(), {
      __estadoLiga: () => liga,
      __promesaTaller: () => ({ kind: "sin-promesa" }),
      __tallerHibrido: true,
      __nombreDeUsuario: () => "Ana López",
    });
    const t = document.body.textContent ?? "";
    expect(document.getElementById("tl-msub")?.textContent).toBe(
      "Nissan NP300 · GDL · Mantenimiento",
    );
    // "Cómo va" es markup fijo (lo cubre la prueba de estructura); aquí solo lo pintado.
    for (const s of [
      "GPA",
      "lo decides tú",
      "En Reparación",
      "Se cambia en Datos del registro",
      "marca esta unidad «Esperando firma»",
      "TALLER",
      "Taller Frenos del Bajío",
      "nombre según GPA",
      "5",
      "Ingresó el 25/09/2026",
      "Estimada por GPA",
      "30/09/2026",
      "El taller promete",
      "01/10/2026",
      "1 día después de lo estimado",
      "Autorizado",
      "$3850.00",
      "Esperando tu firma",
      "$2400.00",
      "El subtotal es la suma de los hallazgos autorizados",
      "Liga del proveedor activa · vence en 88 días · emitida por Ana López el 24/09/2026",
      "Copiar vuelve a emitir: la liga queda a tu nombre y vence en 90 días",
      "Guardado: Km al ingreso 85,000",
    ]) {
      expect(t, s).toContain(s);
    }
    expect(t).not.toContain(GUID);
    expect(document.getElementById("btn-liga-copiar")?.textContent).toBe("Copiar liga");
  });
  it("sin directorio: revocada por un GUID ⇒ 'un usuario de GPA'; texto libre igual; sin 'Revocar'", () => {
    const liga = {
      kind: "revocada",
      revocadaPor: "revocacion manual (CLI admin) por incidente",
      revocadaEn: "2026-09-22",
      emitidaPor: GUID,
    };
    pintar(E(), {
      __estadoLiga: () => liga,
      __promesaTaller: () => ({ kind: "sin-promesa" }),
      __tallerHibrido: true,
    });
    expect(document.getElementById("tf-prov-liga-meta")?.textContent).toContain(
      "Liga revocada por un usuario de GPA el 22/09/2026",
    );
    expect(document.body.textContent).not.toContain("CLI admin");
    expect(document.getElementById("btn-liga-copiar")?.textContent).toBe("Emitir liga y copiar");
    expect((document.getElementById("btn-liga-revocar") as HTMLElement).style.display).toBe("none");
  });
  it("cierre: ⇒ 'Se cerró junto con la visita (Ana López) el …'", () => {
    const liga = {
      kind: "revocada",
      revocadaPor: "cierre:ana@ejemplo.test",
      revocadaEn: "2026-09-29",
    };
    pintar(
      E({ estado: "Finalizado", fsalidaReal: "2026-09-29" }),
      {
        __estadoLiga: () => liga,
        __promesaTaller: () => ({ kind: "sin-promesa" }),
        __tallerHibrido: true,
        __describirRevocadaPor: () => ({ porCierre: true, nombre: "Ana López" }),
      },
      {
        ...FICHA,
        dias: { n: 4, cerrada: true, inicio: "2026-09-25", fin: "2026-09-29", tono: "normal" },
      },
    );
    expect(document.getElementById("tf-prov-liga-meta")?.textContent).toContain(
      "Se cerró junto con la visita (Ana López) el 29/09/2026",
    );
    expect(document.getElementById("tf-ficha-dias")?.textContent).toContain(
      "Salió el 29/09/2026 · estuvo 4 días",
    );
  });
  it("costo sin datos no pinta $0; capturado con 'verificando…' cuando el apagador no se sabe", () => {
    const liga = { kind: "sin-liga" };
    pintar(
      E(),
      { __estadoLiga: () => liga, __promesaTaller: () => ({ kind: "sin-promesa" }) },
      { ...FICHA, costo: { kind: "sin-datos" } },
    );
    expect(document.getElementById("tf-ficha-costo")?.textContent).toContain(
      "No se pudieron cargar los hallazgos",
    );
    expect(document.getElementById("tf-ficha-costo")?.textContent).not.toContain("$0");
    pintar(
      E(),
      { __estadoLiga: () => liga, __promesaTaller: () => ({ kind: "sin-promesa" }) },
      { ...FICHA, costo: { kind: "capturado", monto: 999, verificando: true } },
    );
    expect(document.getElementById("tf-ficha-costo")?.textContent).toContain("Capturado por GPA");
    expect(document.getElementById("tf-ficha-costo")?.textContent).toContain("verificando…");
  });
  it("aviso de firma: texto exacto y solo con pendientes, confiables y apagador encendido", () => {
    const liga = {
      kind: "activa",
      diasRestantes: 88,
      emitidaPor: "x@ejemplo.test",
      emitidaEn: "2026-09-24",
    };
    const ps = [{ estado: "propuesta", precio: 2400 }];
    pintar(E({ __ps: ps }), {
      __estadoLiga: () => liga,
      __promesaTaller: () => ({ kind: "sin-promesa" }),
      __tallerHibrido: true,
      __pendientesDeFirma: () => 1,
      __montoPendienteDeFirma: () => 2400,
    });
    const aviso = document.getElementById("tf-aviso-firma") as HTMLElement;
    expect(aviso.hidden).toBe(false);
    expect(aviso.textContent).toBe("1 hallazgo espera tu firma · $2400.00 · Ver →");
    pintar(E({ __ps: ps }), {
      __estadoLiga: () => liga,
      __promesaTaller: () => ({ kind: "sin-promesa" }),
      __tallerHibrido: false,
      __pendientesDeFirma: () => 1,
    });
    expect(aviso.hidden).toBe(true);
  });
  it("estructura: _provPintar empieza con _fichaPintar(e) y conserva sus obligaciones", () => {
    const c = cuerpo("_provPintar");
    expect(c.indexOf("_fichaPintar(e)")).toBeLessThan(c.indexOf("getElementById"));
    for (const s of [
      "window.__estadoLiga(",
      "window.__promesaTaller(",
      "km del taller",
      "km ingreso",
      "El taller aún no ha reportado estado.",
    ])
      expect(c).toContain(s);
    expect(c).not.toContain(".innerHTML");
    expect(c).not.toContain("promete salida");
    expect(cuerpo("_fichaPintar")).not.toContain(".innerHTML");
  });
});

describe("hallazgos del taller agrupados y firmas con nombre (§4.3)", () => {
  const cuerpo = (nombre: string): string => {
    const i = html.indexOf(`function ${nombre}(`);
    expect(i, `no existe ${nombre}`).toBeGreaterThan(-1);
    return html.slice(i, html.indexOf("\nfunction ", i + 10));
  };
  const P = (s: Record<string, unknown> = {}): Record<string, unknown> => ({
    partidaId: "p",
    visitaKey: "vk",
    descripcion: "Balatas",
    estado: "autorizada",
    tipo: "refaccion",
    fotos: ["a.jpg"],
    precio: 1850,
    precioAutorizado: 1850,
    creadoEn: "2026-09-14T16:00:00.000Z",
    decididoPor: "11111111-2222-4333-8444-555555555555",
    decididoEn: "2026-09-15T10:00:00.000Z",
    ...s,
  });
  function filaDe(p: Record<string, unknown>, win: Record<string, unknown> = {}): HTMLElement {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- se ejecuta el literal real
    const fabrica = new Function(
      "window",
      "_bnThumb",
      "_fmtMon2",
      "fmtDate",
      `${cuerpo("_provFilaHistorial")}\nreturn _provFilaHistorial;`,
    );
    const fn = fabrica(
      win,
      () => document.createElement("button"),
      (n: number) => `$${n.toFixed(2)}`,
      (d: unknown) => String(d ?? "").slice(0, 10),
    ) as (p: unknown) => HTMLElement;
    return fn(p);
  }
  it("estructura: abre en 'Todas', tres subtítulos, título nuevo, sin la línea de totales", () => {
    expect(html).toContain('let _provFiltro = "todas";');
    const c = cuerpo("_provPartidas");
    for (const s of [
      "Hallazgos del taller (",
      "espera",
      "tu firma",
      "Esperan tu firma",
      "Autorizados · suman ",
      "No autorizados",
      "Autorizar y No autorizar se guardan solos; no necesitas Guardar.",
      "window.__ordenarHallazgos",
      "_bnPartida(",
      "window.__resumenPartidas(",
      "_partidasConfiables()",
      "No se pudieron cargar las partidas",
      "Esta visita no tiene partidas del proveedor.",
      "terminada",
      "e.tecnico",
    ]) {
      expect(c, s).toContain(s);
    }
    expect(c).not.toContain("Autorizado ${");
    expect(c).not.toContain('_provFiltro = "pendientes"; }');
    expect(c).not.toContain(".innerHTML");
  });
  it("_provFilaHistorial con window = {} ⇒ 'Autorizada por un usuario de GPA', sin GUID ni excepción", () => {
    const t = filaDe(P()).textContent ?? "";
    expect(t).toContain("Autorizada por un usuario de GPA");
    expect(t).not.toContain("11111111-2222");
  });
  it("con el puente ⇒ 'Autorizada por Ana López'; rechazada y terminada igual", () => {
    const win = { __nombreDeUsuario: () => "Ana López" };
    expect(filaDe(P(), win).textContent).toContain("Autorizada por Ana López");
    expect(
      filaDe(P({ estado: "rechazada", motivoRechazo: "Precio alto" }), win).textContent,
    ).toContain("Rechazada por Ana López");
    expect(
      filaDe(P({ estado: "terminada", terminadoEn: "2026-09-16" }), win).textContent,
    ).toContain("Autorizada por Ana López");
  });
  it("una terminada con fotos: tocar la miniatura abre el A+ (misma llamada que el botón)", () => {
    const abrir = vi.fn();
    const fila = filaDe(
      P({ estado: "terminada", evidenciaFinal: ["b.jpg"], terminadoEn: "2026-09-16" }),
      {
        __abrirVisorAntesDespues: abrir,
      },
    );
    (fila.querySelector("button") as HTMLButtonElement).click();
    expect(abrir).toHaveBeenCalledTimes(1);
    expect(abrir.mock.calls[0]![0]).toMatchObject({
      antes: { llaves: ["a.jpg"] },
      despues: { llaves: ["b.jpg"] },
    });
  });
});
