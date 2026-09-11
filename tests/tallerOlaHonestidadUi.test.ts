// tests/tallerOlaHonestidadUi.test.ts
//
// Ola de fixes de la revisión final — las piezas PURAS de "honestidad de la UI
// y candado de identidad" (commit 3). Cada describe nombra el ID del
// consolidado que cubre.
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resumenBandeja, filasBandeja, visitaKeyDe } from "../src/api/tallerPartidas";
import { sinGastoSiTienePartidas, type LegacyTallerEntry } from "../src/api/batchUpload";
import { gastoCapturadoOriginal } from "../src/api/cloudHydrate";
import { uuidSeguro, type Partida } from "../src/taller/partidas";

const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");

const P = (o: Partial<Partida> = {}): Partida => ({
  partidaId: "p1",
  visitaKey: "JV98698|2026-09-01",
  descripcion: "Balatas",
  tipo: "refaccion",
  precio: 1850,
  estado: "propuesta",
  fotos: [],
  ...o,
});

// ── C-I1 / R85 — la franja de resumen de la bandeja (spec §9.2) ─────────────
describe("resumenBandeja — 'N partidas en M unidades · Suman $X' (R85)", () => {
  const entryA = {
    id: "tl_a",
    plate: "JV98698",
    eco: "42",
    fentrada: "2026-09-01",
  } as unknown as LegacyTallerEntry;
  const entryB = {
    id: "tl_b",
    plate: "JR54321",
    eco: "43",
    fentrada: "2026-09-02",
  } as unknown as LegacyTallerEntry;

  function filas() {
    const kA = visitaKeyDe(entryA);
    const kB = visitaKeyDe(entryB);
    const g = new Map<string, Partida[]>([
      [
        kA,
        [
          P({ partidaId: "a1", visitaKey: kA, precio: 1850 }),
          P({ partidaId: "a2", visitaKey: kA, precio: 1150 }),
          // Ya autorizada: NO cuenta como pendiente ni suma al monto.
          P({
            partidaId: "a3",
            visitaKey: kA,
            estado: "autorizada",
            precio: 9000,
            precioAutorizado: 9000,
          }),
        ],
      ],
      [kB, [P({ partidaId: "b1", visitaKey: kB, precio: 500 })]],
    ]);
    return filasBandeja([entryA, entryB], g, new Map());
  }

  it("cuenta partidas PENDIENTES, no todas las de la visita", () => {
    expect(resumenBandeja(filas()).partidas).toBe(3);
  });

  it("cuenta UNIDADES (visitas), no partidas", () => {
    expect(resumenBandeja(filas()).unidades).toBe(2);
  });

  it("suma lo COTIZADO de lo pendiente — lo ya autorizado no vuelve a contar", () => {
    expect(resumenBandeja(filas()).monto).toBe(1850 + 1150 + 500);
  });

  it("con la bandeja vacía, todo en cero (nunca NaN)", () => {
    expect(resumenBandeja([])).toEqual({ partidas: 0, unidades: 0, monto: 0 });
  });

  it("una partida sin precio cuenta como pendiente pero no infla el monto", () => {
    const k = visitaKeyDe(entryA);
    const g = new Map<string, Partida[]>([
      [k, [P({ partidaId: "x", visitaKey: k, precio: undefined })]],
    ]);
    const r = resumenBandeja(filasBandeja([entryA], g, new Map()));
    expect(r.partidas).toBe(1);
    expect(r.monto).toBe(0);
  });

  it("el monolito PINTA la franja — nunca recalcula la aritmética", () => {
    const i = html.indexOf("function renderBandeja(");
    const bloque = html.slice(i, html.indexOf("\n}", i));
    expect(bloque).toContain("window.__resumenBandeja(filas)");
    expect(bloque).toContain("Esperando tu firma");
  });
});

// ── B-I3 / R87 — el subtotal tecleado se preserva, nunca se borra ───────────
describe("sinGastoSiTienePartidas — anulación, nunca borrado (R87)", () => {
  const base: LegacyTallerEntry = {
    id: "tl_1",
    plate: "ABC-123",
    fentrada: "2026-08-01",
    gasto: 9999,
    gastoRef: 100,
    gastoMO: 50,
  };

  it("sin partidas no toca nada — la visita histórica sigue igual", () => {
    expect(sinGastoSiTienePartidas(base, false)).toBe(base);
  });

  it("con partidas quita las tres llaves Y guarda lo tecleado en gastoCapturadoOriginal", () => {
    const r = sinGastoSiTienePartidas(base, true, "2026-09-11T10:00:00Z");
    expect(r).not.toHaveProperty("gasto");
    expect(r).not.toHaveProperty("gastoRef");
    expect(r).not.toHaveProperty("gastoMO");
    expect(r.gastoCapturadoOriginal).toEqual({
      gasto: 9999,
      gastoRef: 100,
      gastoMO: 50,
      en: "2026-09-11T10:00:00Z",
    });
  });

  it("NUNCA sobrescribe el original: un segundo recorte lo deja intacto", () => {
    const primero = sinGastoSiTienePartidas(base, true, "2026-09-11T10:00:00Z");
    // Segunda pasada, con otros números tecleados encima (caso imposible hoy,
    // pero el invariante es "el original es el original").
    const segundo = sinGastoSiTienePartidas({ ...primero, gasto: 1 }, true, "2026-12-31T23:59:59Z");
    expect(segundo.gastoCapturadoOriginal?.gasto).toBe(9999);
    expect(segundo.gastoCapturadoOriginal?.en).toBe("2026-09-11T10:00:00Z");
  });

  it("sin nada tecleado no inventa un registro vacío", () => {
    const r = sinGastoSiTienePartidas({ id: "tl_2", plate: "X" }, true);
    expect(r.gastoCapturadoOriginal).toBeUndefined();
  });

  it("round-trip: lo preservado sobrevive a la hidratación (si no, el próximo guardado lo borra)", () => {
    const subido = sinGastoSiTienePartidas(base, true, "2026-09-11T10:00:00Z");
    // `datos` viaja como JSON; la hidratación lo reconstruye con este helper.
    const datos = JSON.parse(JSON.stringify(subido)) as Record<string, unknown>;
    const rehidratado = gastoCapturadoOriginal(datos.gastoCapturadoOriginal);
    expect(rehidratado).toEqual(subido.gastoCapturadoOriginal);
    // Y el siguiente recorte, ya con el original presente, no lo pisa.
    const otraVez = sinGastoSiTienePartidas(
      { ...base, gastoCapturadoOriginal: rehidratado },
      true,
      "2027-01-01T00:00:00Z",
    );
    expect(otraVez.gastoCapturadoOriginal?.en).toBe("2026-09-11T10:00:00Z");
  });

  it("gastoCapturadoOriginal descarta basura en vez de fabricar un registro", () => {
    expect(gastoCapturadoOriginal(undefined)).toBeUndefined();
    expect(gastoCapturadoOriginal("x")).toBeUndefined();
    expect(gastoCapturadoOriginal({ gasto: 1 })).toBeUndefined(); // sin `en`
    expect(gastoCapturadoOriginal({ en: "2026-01-01" })).toBeUndefined(); // sin montos
  });
});

// ── D-I4 / R82 — uuidSeguro: la captura manual no muere en HTTP plano ───────
describe("uuidSeguro — v4 también sin contexto seguro (R82)", () => {
  const original = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
  });

  const RE_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("usa crypto.randomUUID cuando existe", () => {
    expect(uuidSeguro()).toMatch(RE_V4);
  });

  it("sin randomUUID (HTTP plano) cae a getRandomValues con formato v4 correcto", () => {
    Object.defineProperty(globalThis, "crypto", {
      value: { getRandomValues: original.getRandomValues.bind(original) },
      configurable: true,
    });
    const id = uuidSeguro();
    expect(id).toMatch(RE_V4);
  });

  it("el respaldo sigue siendo único (1000 ids, cero colisiones)", () => {
    Object.defineProperty(globalThis, "crypto", {
      value: { getRandomValues: original.getRandomValues.bind(original) },
      configurable: true,
    });
    const vistos = new Set<string>();
    for (let i = 0; i < 1000; i++) vistos.add(uuidSeguro());
    expect(vistos.size).toBe(1000);
  });

  it("NUNCA Math.random: sin ninguna API de crypto, lanza en vez de inventar", () => {
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    expect(() => uuidSeguro()).toThrow();
  });

  it("partidaManual ya no llama crypto.randomUUID directo", () => {
    const src = readFileSync(join(__dirname, "..", "src", "taller", "partidas.ts"), "utf8");
    // Sin comentarios: el docstring de `uuidSeguro` NOMBRA la API que reemplaza.
    const codigo = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codigo).not.toContain("crypto.randomUUID()");
    expect(codigo).toContain("partidaId: uuidSeguro()");
    expect(codigo).not.toContain("Math.random");
  });
});

// ── B-I7 — el chip de gasto anual no se pierde por un espacio ───────────────
describe("filasBandeja — el económico se busca con .trim() (B-I7)", () => {
  it('un eco con espacios (" 42 ") sigue encontrando su gasto anual', () => {
    const entry = {
      id: "tl_1",
      plate: "JV98698",
      eco: " 42 ",
      fentrada: "2026-09-01",
    } as unknown as LegacyTallerEntry;
    const k = visitaKeyDe(entry);
    const g = new Map<string, Partida[]>([[k, [P({ visitaKey: k })]]]);
    // gastoAnualPorEco indexa con .trim(): la llave del mapa es "42".
    const anual = new Map([["42", { gasto: 38400, visitas: 4 }]]);
    const fila = filasBandeja([entry], g, anual)[0]!;
    expect(fila.gastoAnual).toBe(38400);
    expect(fila.visitasAnual).toBe(4);
  });
});

// ── C-I2 / C-I5 / C-I6 / B-C4 — el monolito, estructural ───────────────────
describe("expediente y modal — honestidad de la UI (C-I2, C-I5, C-I6, B-C4)", () => {
  it("C-I2: la descripción de una partida se pinta por textContent, nunca por innerHTML", () => {
    const i = html.indexOf("function _borradorManualItemHtml(");
    const cuerpo = html.slice(i, html.indexOf("\n}", i));
    expect(cuerpo).not.toContain("escHtml(p.descripcion)");
    expect(cuerpo).toContain("data-desc-partida=");
    // Y hay quien los llene, justo después de asignar el HTML del expediente.
    expect(html).toContain("function _pintarDescripcionesBorrador(");
    expect(html).toContain("span.textContent =");
    const iRender = html.indexOf("function renderHistorialModal(");
    const bloqueRender = html.slice(iRender);
    const iInner = bloqueRender.indexOf("histBody.innerHTML =");
    const iPintar = bloqueRender.indexOf("_pintarDescripcionesBorrador(histBody");
    expect(iInner).toBeGreaterThan(-1);
    expect(iPintar).toBeGreaterThan(iInner);
  });

  it("C-I6: la lista de borradores filtra a los capturados por GPA", () => {
    const i = html.indexOf("function _hallazgoManualHtml(");
    const cuerpo = html.slice(i, html.indexOf("\n}", i));
    expect(cuerpo).toContain("_esBorradorDeGPA(p)");
    expect(html).toContain('p.creadoPor.indexOf("user:") === 0');
  });

  it("C-I5: finalizar avisa de partidas pendientes y borradores sin enviar", () => {
    const i = html.indexOf("function finalizarUnidad(");
    const cuerpo = html.slice(i, html.indexOf("\n}", i));
    expect(cuerpo).toContain("__pendientesDeFirma");
    expect(cuerpo).toContain("esperando firma");
    expect(cuerpo).toContain("sin enviar");
  });

  it("C-I5: una visita CERRADA declara sus borradores varados en solo lectura", () => {
    expect(html).toContain("function _borradoresCerradaHtml(");
    const i = html.indexOf("function _hallazgoManualHtml(");
    expect(html.slice(i, i + 200)).toContain("_borradoresCerradaHtml(ps)");
  });

  it("B-C4: con partidas, los tres campos de identidad quedan en readOnly con leyenda", () => {
    const i = html.indexOf("function openTallerModal(");
    const cuerpo = html.slice(i, html.indexOf("\nfunction closeTallerModal", i));
    expect(cuerpo).toContain('["tf-fentrada","tf-plate","tf-eco"]');
    expect(cuerpo).toContain("La visita tiene partidas: su identidad no se edita.");
    expect(cuerpo).toContain("el.readOnly = idLock");
  });

  // Remate §2.1 — el residual de B-C4: el candado no miraba el tri-estado, así
  // que con las partidas NO cargadas (`_partidasConfiables() === false`) los tres
  // campos de identidad quedaban EDITABLES justo en el estado donde no se sabe si
  // la visita tiene dinero firmado. Se EJECUTA el bloque real extraído del HTML,
  // no una copia: si alguien revierte el `|| idDudoso`, el primer `it` cae.
  describe("remate B-C4: el candado de identidad también cierra en estado DESCONOCIDO", () => {
    /** El bloque real de openTallerModal que fija el candado de identidad. */
    function bloqueCandadoIdentidad(): string {
      const i = html.indexOf("const idDudoso = !_partidasConfiables();");
      expect(i).toBeGreaterThan(-1);
      const fin = html.indexOf("idHint.style.display = idLock", i);
      expect(fin).toBeGreaterThan(i);
      return html.slice(i, html.indexOf("}", fin) + 1);
    }

    type Campo = { readOnly: boolean; title?: string; removeAttribute(n: string): void };

    function nuevoCampo(): Campo {
      const c: Campo = {
        readOnly: false,
        removeAttribute(n: string) {
          if (n === "title") delete c.title;
        },
      };
      return c;
    }

    /**
     * Ejecuta el bloque REAL con un `document` falso y un tri-estado dado.
     * `persistida: false` modela una captura NUEVA (`openTallerModal()` sin id ⇒ `e === null`).
     */
    function corre(opts: { partidas: number; confiables: boolean; persistida?: boolean }) {
      const campos: Record<string, Campo> = {};
      const hint = { textContent: "", style: { display: "" } };
      const doc = {
        getElementById(id: string): unknown {
          if (id === "tf-identidad-hint") return hint;
          if (!campos[id]) campos[id] = nuevoCampo();
          return campos[id]!;
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-implied-eval -- se ejecuta el literal real del HTML, patrón del harness de tallerSaveEntryGastoCandado
      const fn = new Function(
        "document",
        "psGasto",
        "_partidasConfiables",
        "e",
        bloqueCandadoIdentidad(),
      );
      const e = opts.persistida === false ? null : { id: "tl_persistida" };
      fn(doc, new Array(opts.partidas).fill(null), () => opts.confiables, e);
      return { campos, hint };
    }

    it("partidas NO cargadas y CERO partidas visibles ⇒ los tres campos quedan bloqueados", () => {
      const { campos, hint } = corre({ partidas: 0, confiables: false });
      for (const id of ["tf-fentrada", "tf-plate", "tf-eco"]) {
        expect(campos[id]!.readOnly, `${id} debe quedar en readOnly`).toBe(true);
      }
      expect(hint.style.display).toBe("");
      expect(hint.textContent).toBe(
        "No se pudieron cargar las partidas: la identidad no se edita hasta que carguen.",
      );
    });

    it("con partidas cargadas y presentes ⇒ bloqueado, con la leyenda de siempre", () => {
      const { campos, hint } = corre({ partidas: 2, confiables: true });
      expect(campos["tf-fentrada"]!.readOnly).toBe(true);
      expect(hint.textContent).toBe("La visita tiene partidas: su identidad no se edita.");
    });

    it("estado CONFIABLE y sin partidas ⇒ la identidad sigue editable (R62 intacto)", () => {
      const { campos, hint } = corre({ partidas: 0, confiables: true });
      for (const id of ["tf-fentrada", "tf-plate", "tf-eco"]) {
        expect(campos[id]!.readOnly, `${id} debe seguir editable`).toBe(false);
      }
      expect(hint.style.display).toBe("none");
    });

    // Regresión que atrapó el e2e kpi-taller (autocompletado): el candado no exigía
    // una visita persistida, y en una captura NUEVA el tri-estado es "desconocido"
    // (en local siempre; en prod hasta la primera hidratación) ⇒ #tf-eco llegaba en
    // readonly antes de poder teclear. Una visita nueva no puede tener partidas: su
    // visitaKey no existe todavía.
    it("captura NUEVA (sin `e`) en estado DESCONOCIDO ⇒ la identidad sigue editable", () => {
      const { campos, hint } = corre({ partidas: 0, confiables: false, persistida: false });
      for (const id of ["tf-fentrada", "tf-plate", "tf-eco"]) {
        expect(campos[id]!.readOnly, `${id} debe seguir editable en una captura nueva`).toBe(false);
      }
      expect(hint.style.display).toBe("none");
    });
  });

  // Remate §2.3.1 — el servidor cierra la visita con DOS reglas (`visitaCerrada`
  // también mira `estatus === "cerrado"`, derivado de `fsalidaReal`); la UI solo
  // miraba `isClosed(estado)` y ofrecía "Copiar liga" para visitas que el portón
  // ya rechazaba.
  it("remate: 'Copiar liga' tampoco se ofrece con la salida REAL ya capturada", () => {
    const i = html.indexOf("const ligaOfrecible =");
    expect(i).toBeGreaterThan(-1);
    expect(html.slice(i, html.indexOf("\n", i))).toContain(
      "!!e && !isClosed(e?.estado) && !e?.fsalidaReal",
    );
  });

  it("B-C4: un reingreso (visita NUEVA) libera el candado de identidad", () => {
    const i = html.indexOf("function clearTallerEntryFields(");
    const cuerpo = html.slice(i, html.indexOf("\n}", i));
    expect(cuerpo).toContain('["tf-fentrada","tf-plate","tf-eco"]');
    expect(cuerpo).toContain("el.readOnly = false");
  });

  it("B-I5: el estado de la liga solo se consulta con el esquema prendido y pudiendo emitirla (Task 14)", () => {
    expect(html).toContain("window.__tallerHibrido && puedeEmitirLiga() && window.__tallerLiga");
    // El gate viejo (solo admin) ya no existe: Riesgos no es admin y se habría
    // quedado sin el botón "Revocar liga" que su propia credencial le permite.
    expect(html).not.toContain("window.__tallerHibrido && esAdmin() && window.__tallerLiga");
  });

  // ── Task 14 — la credencial `riesgos` en la capa de UI ────────────────────
  describe("Task 14: los botones de liga cuelgan de needs-liga, no de needs-admin", () => {
    it("puedeEmitirLiga() es exactamente admin || riesgos", () => {
      const i = html.indexOf("function puedeEmitirLiga(");
      expect(i).toBeGreaterThan(-1);
      const cuerpo = html.slice(i, html.indexOf("\n", i));
      expect(cuerpo).toContain('g.includes("admin")');
      expect(cuerpo).toContain('g.includes("riesgos")');
      expect(cuerpo).toContain("sessionGroups()");
      // Ni escritura genérica ni viewer: la credencial no es "poder escribir".
      expect(cuerpo).not.toContain('g.includes("operativo")');
      expect(cuerpo).not.toContain('g.includes("viewer")');
    });

    it("los dos botones llevan needs-liga + needs-hibrido y NO needs-admin", () => {
      for (const id of ["btn-liga-copiar", "btn-liga-revocar"]) {
        const i = html.indexOf(`id="${id}"`);
        expect(i, `no existe el botón ${id}`).toBeGreaterThan(-1);
        // La etiqueta <button ...> completa que contiene ese id.
        const inicioTag = html.lastIndexOf("<button", i);
        const tag = html.slice(inicioTag, html.indexOf(">", i) + 1);
        expect(tag, `${id}: falta needs-liga`).toContain("needs-liga");
        expect(tag, `${id}: falta needs-hibrido`).toContain("needs-hibrido");
        expect(tag, `${id}: needs-admin ya no aplica (Riesgos no es admin)`).not.toContain(
          "needs-admin",
        );
      }
    });

    it("la regla CSS de .needs-liga y el toggle de .puede-liga existen (sin ellos el gate no oculta nada)", () => {
      expect(html).toContain("body:not(.puede-liga) .needs-liga{display:none !important}");
      expect(html).toContain('document.body.classList.toggle("puede-liga", puedeEmitirLiga())');
    });

    it("el gate de admin (.needs-admin / is-admin) sigue intacto para anulaciones y paneles", () => {
      expect(html).toContain("body:not(.is-admin) .needs-admin{display:none !important}");
      expect(html).toContain('document.body.classList.toggle("is-admin", esAdmin())');
      expect(html).toContain('function esAdmin(){ return sessionGroups().includes("admin"); }');
    });
  });

  it("minor: el toast de 'Liga copiada' dice cuándo vence", () => {
    const i = html.indexOf("async function copiarLigaProveedor(");
    const cuerpo = html.slice(i, html.indexOf("\n}", i));
    expect(cuerpo).toContain("vence el");
    expect(cuerpo).toContain("r.expira");
  });

  it("minor: #hibrido-style se inyecta junto con #ro-style, no solo desde renderTaller", () => {
    const i = html.indexOf("function applyRolePermissions(");
    const cuerpo = html.slice(i, html.indexOf("\n}", i));
    expect(cuerpo).toContain('st.id="ro-style"');
    expect(cuerpo).toContain('sh.id="hibrido-style"');
  });

  it("minor: el contenedor de captura manual lleva needs-write, no solo el botón", () => {
    expect(html).toContain('class="needs-hibrido needs-write"');
  });

  it("minor: la bandeja usa _fmtMon2 (centavos) y los KPIs siguen con _fmtMon", () => {
    expect(html).toContain("function _fmtMon2(v)");
    expect(html).toContain("_fmtMon2(fila.totales.cotizado)");
    expect(html).toContain("_fmtMon2(fila.totales.autorizado)");
    // El KPI del mes NO cambia de formato.
    expect(html).toContain("kv.textContent=_monDerivado(gAct)");
  });

  it("minor: la miniatura de la partida tiene onerror y el catch avisa en consola", () => {
    const i = html.indexOf("function _bnThumb(");
    const cuerpo = html.slice(i, html.indexOf("\n}", i));
    expect(cuerpo).toContain("img.onerror = sinFotoDisponible");
    expect(cuerpo).toContain("console.warn");
  });

  it("minor: 'Abrir expediente' se deshabilita cuando no hay entry que abrir", () => {
    const i = html.indexOf("function _bnFooter(");
    const cuerpo = html.slice(i, html.indexOf("\n}", i));
    expect(cuerpo).toContain("if(!entry){");
    expect(cuerpo).toContain("btnExp.disabled = true");
    // Y ya no cae a placa/eco, que no son unitKey.
    expect(cuerpo).not.toContain("(fila.placa || fila.eco)");
  });

  it("minor: los dos botones sueltos de la bandeja llevan la clase de 44px", () => {
    const iFooter = html.indexOf("function _bnFooter(");
    expect(html.slice(iFooter, html.indexOf("\n}", iFooter))).toContain(
      'btnExp.className = "bandeja-firma-btn"',
    );
    expect(html).toContain('btnCancelar.className = "bandeja-firma-btn"');
  });
});
