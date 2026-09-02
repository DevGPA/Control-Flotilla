/**
 * Render de la sub-pestaña Accesorios. Dos cosas se cuidan aquí:
 *  - que el DOM se arme con textContent (nada de innerHTML con datos: una marca con "<img>"
 *    debe quedar como texto, no como etiqueta),
 *  - que las columnas del Excel y de la tabla digan lo mismo que el rollup.
 */
import { describe, expect, it } from "vitest";
import {
  fmtAntiguedad,
  fmtFecha,
  fmtMXN,
  renderHistorialUnidad,
  renderKpisAccesorios,
  renderTableAccesorios,
  populateSucursalSelect,
} from "../src/accesorios/renderAccesorios";
import { filasHistorial, filasVigentes } from "../src/accesorios/accesoriosExcel";
import {
  buildKpisAccesorios,
  resumirPorUnidad,
  toAccesorioEntry,
} from "../src/accesorios/accesoriosAnalysis";
import type { AccesorioDoc, AccesorioUnidad } from "../src/accesorios/types";

const HOY = "2026-09-02";

function entry(over: Partial<AccesorioDoc> = {}, info?: { placa?: string; sucursal?: string }) {
  const doc: AccesorioDoc = {
    tenantId: "gpa",
    economicoId: "78",
    accesorioId: "bateria#AB1234",
    tipo: "bateria",
    marca: "LTH",
    numeroSerie: "AB1234",
    fechaCompra: "2026-03-15",
    costo: 3200,
    ...over,
  };
  return toAccesorioEntry(doc, HOY, info);
}

const LIMPIA: Partial<AccesorioDoc> = {
  accesorioId: "limpiabrisas#2025-08-01",
  tipo: "limpiabrisas",
  marca: "Bosch",
  numeroSerie: undefined,
  fechaCompra: "2025-08-01",
  costo: 480,
};

function unidad(): AccesorioUnidad {
  return resumirPorUnidad([
    entry({}, { placa: "JV98698", sucursal: "GDL" }),
    entry(LIMPIA, { placa: "JV98698", sucursal: "GDL" }),
  ])[0]!;
}

describe("formatos", () => {
  it("antigüedad en lenguaje humano", () => {
    expect(fmtAntiguedad(null)).toBe("—");
    expect(fmtAntiguedad(0)).toBe("este mes");
    expect(fmtAntiguedad(1)).toBe("1 mes");
    expect(fmtAntiguedad(5)).toBe("5 meses");
    expect(fmtAntiguedad(12)).toBe("1 año");
    expect(fmtAntiguedad(14)).toBe("1 año 2 meses");
    expect(fmtAntiguedad(24)).toBe("2 años");
  });

  it("fecha en dd/mm/aaaa y moneda sin centavos", () => {
    expect(fmtFecha("2026-03-15")).toBe("15/03/2026");
    expect(fmtFecha(undefined)).toBe("—");
    expect(fmtMXN(0)).toBe("$0");
    expect(fmtMXN(3200)).toContain("3,200");
  });
});

describe("renderTableAccesorios", () => {
  function pintar(unidades: AccesorioUnidad[], search?: string) {
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");
    renderTableAccesorios({ thead, tbody, unidades, sortCol: "eco", sortDir: 1, search });
    return { thead, tbody };
  }

  it("una fila por unidad, con lo vigente de cada tipo", () => {
    const { tbody } = pintar([unidad()]);
    expect(tbody.querySelectorAll("tr")).toHaveLength(1);
    const texto = tbody.textContent ?? "";
    expect(texto).toContain("78");
    expect(texto).toContain("JV98698");
    expect(texto).toContain("LTH");
    expect(texto).toContain("Serie AB1234");
    expect(texto).toContain("Bosch");
  });

  it("marca la columna sin registro en vez de dejarla en blanco", () => {
    const soloBateria = resumirPorUnidad([entry()])[0]!;
    const { tbody } = pintar([soloBateria]);
    expect(tbody.textContent).toContain("Sin registro");
  });

  it("NO interpreta HTML en los datos capturados (anti-XSS)", () => {
    const malicioso = resumirPorUnidad([entry({ marca: "<img src=x onerror=alert(1)>" })])[0]!;
    const { tbody } = pintar([malicioso]);
    expect(tbody.querySelector("img")).toBeNull();
    expect(tbody.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("el encabezado marca la columna ordenada y avisa al hacer clic", () => {
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");
    const clicks: string[] = [];
    renderTableAccesorios({
      thead,
      tbody,
      unidades: [unidad()],
      sortCol: "gasto",
      sortDir: -1,
      onSort: (col) => clicks.push(col),
    });
    const ths = [...thead.querySelectorAll("th")];
    expect(ths.map((t) => t.textContent)).toContain("Gasto▼");
    ths.find((t) => t.textContent?.startsWith("Unidad"))?.dispatchEvent(new Event("click"));
    expect(clicks).toEqual(["eco"]);
  });

  it("clic en la fila abre el historial de esa unidad", () => {
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");
    const abiertas: string[] = [];
    renderTableAccesorios({
      thead,
      tbody,
      unidades: [unidad()],
      sortCol: "eco",
      sortDir: 1,
      onOpen: (eco) => abiertas.push(eco),
    });
    tbody.querySelector("tr")?.dispatchEvent(new Event("click"));
    expect(abiertas).toEqual(["78"]);
  });

  it("sin resultados: menciona el texto buscado como TEXTO, no como HTML", () => {
    const { tbody } = pintar([], "<b>x</b>");
    expect(tbody.textContent).toContain("<b>x</b>");
    expect(tbody.querySelectorAll("b")).toHaveLength(1); // el <b> del render, no el del dato
  });
});

describe("renderKpisAccesorios", () => {
  it("pinta los seis conteos", () => {
    const c = document.createElement("div");
    renderKpisAccesorios(c, buildKpisAccesorios([unidad()]));
    const texto = c.textContent ?? "";
    expect(texto).toContain("Unidades");
    expect(texto).toContain("Con batería");
    expect(texto).toContain("Con limpiabrisas");
    expect(texto).toContain("Sin registro");
    expect(texto).toContain("Cambios capturados");
    expect(texto).toContain("Gasto en accesorios");
  });
});

describe("renderHistorialUnidad", () => {
  it("lista los cambios y etiqueta el vigente de cada tipo", () => {
    const u = resumirPorUnidad([
      entry({ accesorioId: "bateria#VIEJA", numeroSerie: "VIEJA", fechaCompra: "2024-01-10" }),
      entry({ accesorioId: "bateria#NUEVA", numeroSerie: "NUEVA", fechaCompra: "2026-03-15" }),
    ])[0]!;
    const c = document.createElement("div");
    renderHistorialUnidad(c, { unidad: u, puedeEscribir: false });
    expect(c.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(c.textContent).toContain("VIGENTE");
    expect(c.textContent).toContain("2 accesorios capturados");
  });

  it("sin permiso de escritura no hay botones de editar ni borrar", () => {
    const c = document.createElement("div");
    renderHistorialUnidad(c, { unidad: unidad(), puedeEscribir: false });
    expect(c.querySelectorAll("button")).toHaveLength(0);
  });

  it("con permiso, editar y borrar devuelven el registro exacto", () => {
    const c = document.createElement("div");
    const editados: string[] = [];
    const borrados: string[] = [];
    renderHistorialUnidad(c, {
      unidad: unidad(),
      puedeEscribir: true,
      onEditar: (e) => editados.push(e.accesorioId),
      onBorrar: (e) => borrados.push(e.accesorioId),
    });
    const botones = [...c.querySelectorAll("button")];
    botones.find((b) => b.textContent === "Editar")?.dispatchEvent(new Event("click"));
    botones.find((b) => b.textContent === "Borrar")?.dispatchEvent(new Event("click"));
    expect(editados).toHaveLength(1);
    expect(borrados).toHaveLength(1);
    expect(editados[0]).toBe(borrados[0]);
  });

  it("unidad sin captura: lo dice en lugar de pintar una tabla vacía", () => {
    const c = document.createElement("div");
    renderHistorialUnidad(c, {
      unidad: {
        economicoId: "104",
        vigentes: {},
        historial: [],
        cambios: 0,
        gastoTotal: 0,
      },
      puedeEscribir: true,
    });
    expect(c.querySelector("table")).toBeNull();
    expect(c.textContent).toContain("todavía no tiene accesorios");
  });
});

describe("populateSucursalSelect", () => {
  it("lista las sucursales presentes, sin repetir, y conserva la selección", () => {
    const sel = document.createElement("select");
    const unidades = [
      unidad(),
      { ...unidad(), economicoId: "104", sucursal: "MTY" },
      { ...unidad(), economicoId: "9", sucursal: "GDL" },
    ];
    populateSucursalSelect(sel, unidades);
    expect([...sel.options].map((o) => o.value)).toEqual(["", "GDL", "MTY"]);
    sel.value = "MTY";
    populateSucursalSelect(sel, unidades);
    expect(sel.value).toBe("MTY");
  });
});

describe("filas del Excel", () => {
  it("la hoja de vigentes trae una fila por unidad con las 12 columnas", () => {
    const filas = filasVigentes([unidad()]);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toHaveLength(12);
    expect(filas[0]).toContain("AB1234");
    expect(filas[0]).toContain("Bosch");
    expect(filas[0]?.at(-1)).toBe(3680);
  });

  it("las unidades sin captura dicen 'Sin registro' en vez de quedar vacías", () => {
    const filas = filasVigentes([
      { economicoId: "104", vigentes: {}, historial: [], cambios: 0, gastoTotal: 0 },
    ]);
    expect(filas[0]).toContain("Sin registro");
  });

  it("la hoja de historial trae una fila por cambio y marca el vigente", () => {
    const filas = filasHistorial([unidad()]);
    expect(filas).toHaveLength(2);
    expect(filas.every((f) => f.length === 12)).toBe(true);
    expect(filas.filter((f) => f[9] === "Sí")).toHaveLength(2); // uno por tipo
  });
});
