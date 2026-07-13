import { describe, expect, it } from "vitest";
import type ExcelJS from "exceljs";
import { buildSolicitudesVista, SOLICITUDES_HEADER } from "../src/fuel/solicitudesLayout";
import { buildSolicitudesWorkbook, VISTA_HEADER } from "../src/fuel/solicitudesExcel";
import type { FuelEntry } from "../src/fuel/types";

/** Solicitud MoreApp real (12292, GDL 07:23) — misma fixture que solicitudesLayout.test. */
function solMoreApp(over: Partial<FuelEntry> = {}): FuelEntry {
  return {
    loadId: "56|solicitud|12292",
    tipo: "solicitud",
    eco: "56",
    eventoId: "12292",
    placa: "JX52508",
    sucursal: "Guadalajara",
    tanque: "173",
    fecha: "2026-07-13",
    fechaHora: "2026-07-13 07:23",
    formCerrado: "2026-07-13T13:23:59.543Z",
    responsable: "CANDELARIO RIVERA LUIS MANUEL",
    km: 42573,
    submarca: 'Ram 4000 Chasis Plano Largo "PL"/V8 5 MT',
    area: "Logística",
    combustible: "Gasolina",
    nivelAntes: "0.50(1/2)",
    nivelDeseado: "1.00",
    montoEstimado: 2423,
    maxLitros: 91,
    necesidad: 0.5,
    precioCatalogo: 26.63,
    observaciones: "urge",
    emailNotificar: "logisticaalmacenes@gpa.com.mx",
    photos: [],
    ...over,
  };
}

/** Solicitud OPS real (eco 57, MTY 08:46). */
function solOps(over: Partial<FuelEntry> = {}): FuelEntry {
  return {
    loadId: "57|solicitud|OPS-d523616af161",
    tipo: "solicitud",
    eco: "57",
    eventoId: "OPS-d523616af161",
    placa: "G25NXP57",
    sucursal: "Monterrey",
    fecha: "2026-07-13",
    fechaHora: "2026-07-13T08:46:50.786047-06:00",
    responsable: "GONZALEZ LOPEZ SERGIO RENE",
    combustible: "Gas LP",
    nivelAntes: "25%",
    nivelDeseado: "100%",
    montoEstimado: 341,
    maxLitros: 31,
    necesidad: 0.75,
    precioCatalogo: 11,
    mailSolicitante: "almty@gpa.com.mx",
    photos: [],
    ...over,
  };
}

const META = { exportadoEl: new Date(2026, 6, 13, 12, 0), filtroSucursal: "" };

describe("buildSolicitudesVista (filas legibles para la hoja de trabajo)", () => {
  const vista = buildSolicitudesVista([solOps(), solMoreApp()]);

  it("mismo alcance y orden cronológico que el layout (MoreApp 07:23 antes que OPS 08:46)", () => {
    expect(vista.filas.map((f) => f.folio)).toEqual([12292, "OPS-d523616af161"]);
    expect(vista.incluidas).toBe(2);
    expect(vista.totalMonto).toBe(2764);
  });

  it("expone la FUENTE del registro (clave para ver duplicados MoreApp↔OPS del piloto)", () => {
    expect(vista.filas[0]!.fuente).toBe("MoreApp");
    expect(vista.filas[1]!.fuente).toBe("Operaciones-GPA");
  });

  it("área legible (con acento), montos/precios/necesidad numéricos", () => {
    const f = vista.filas[0]!;
    expect(f.area).toBe("Logística");
    expect(f.monto).toBe(2423);
    expect(f.precio).toBe(26.63);
    expect(f.necesidad).toBe(0.5);
    expect(f.maxLitros).toBe(91);
    expect(f.solicitante).toBe("CANDELARIO RIVERA LUIS MANUEL");
  });

  it("excluye cargas y anuladas igual que el layout", () => {
    const anulada = solMoreApp({
      anulada: { motivo: "dup", anuladoPor: "admin", ts: "2026-07-13T15:00:00Z" },
    });
    expect(buildSolicitudesVista([anulada]).incluidas).toBe(0);
  });
});

describe("buildSolicitudesWorkbook (formato profesional, 2 hojas)", async () => {
  const wb = await buildSolicitudesWorkbook([solMoreApp(), solOps()], META);
  const ws = wb.getWorksheet("Solicitudes") as ExcelJS.Worksheet;

  it("trae las hojas Solicitudes (vista) y Submissions (réplica 30 columnas)", () => {
    expect(wb.worksheets.map((s) => s.name)).toEqual(["Solicitudes", "Submissions"]);
  });

  it("título y línea de contexto con conteo y total", () => {
    expect(String(ws.getCell("A1").value)).toContain("Solicitudes de Combustible");
    const sub = String(ws.getCell("A2").value);
    expect(sub).toContain("2 solicitudes");
    expect(sub).toContain("Sucursal: Todas");
  });

  it("encabezados de la vista en la fila 4, con estilo (negrita + relleno)", () => {
    const values = VISTA_HEADER.map((_, i) => ws.getRow(4).getCell(i + 1).value);
    expect(values).toEqual([...VISTA_HEADER]);
    expect(ws.getRow(4).getCell(1).font?.bold).toBe(true);
    expect(ws.getRow(4).getCell(1).fill).toBeDefined();
  });

  it("datos desde la fila 5 en orden cronológico, con formatos numéricos", () => {
    expect(ws.getCell("A5").value).toBe(12292);
    expect(ws.getCell("A6").value).toBe("OPS-d523616af161");
    const monto = ws.getCell("N5");
    expect(monto.value).toBe(2423);
    expect(monto.numFmt).toBe('"$"#,##0');
    expect(ws.getCell("K5").numFmt).toBe("0%"); // necesidad
    expect(ws.getCell("Q5").value).toBe("MoreApp");
    expect(ws.getCell("Q6").value).toBe("Operaciones-GPA");
  });

  it("fila TOTAL con fórmula SUM viva (se recalcula al editar montos)", () => {
    const total = ws.getCell("N7").value as ExcelJS.CellFormulaValue;
    expect(total.formula).toBe("SUM(N5:N6)");
    expect(ws.getCell("M7").value).toBe("TOTAL");
  });

  it("encabezado congelado (freeze panes) y autofiltro activo", () => {
    expect(ws.views?.[0]).toMatchObject({ state: "frozen", ySplit: 4 });
    expect(ws.autoFilter).toBeTruthy();
  });

  it("zebra: la segunda fila de datos lleva relleno suave", () => {
    const fill = ws.getRow(6).getCell(3).fill as ExcelJS.FillPattern;
    expect(fill?.type).toBe("pattern");
  });

  it("hoja Submissions conserva la réplica exacta: header 30 columnas y datos crudos", () => {
    const rep = wb.getWorksheet("Submissions") as ExcelJS.Worksheet;
    const header = SOLICITUDES_HEADER.map((_, i) => rep.getRow(1).getCell(i + 1).value);
    expect(header).toEqual([...SOLICITUDES_HEADER]);
    expect(rep.getCell("A2").value).toBe(12292);
    expect(rep.getCell("X2").value).toBe(2423); // Monto a cargar ($) = col 24
    expect(rep.getCell("G2").value).toBeInstanceOf(Date); // Fecha y Hora
  });

  it("aviso de sucursal filtrada aparece en la línea de contexto", async () => {
    const wb2 = await buildSolicitudesWorkbook([solOps()], {
      ...META,
      filtroSucursal: "Monterrey",
    });
    const sub = String(wb2.getWorksheet("Solicitudes")!.getCell("A2").value);
    expect(sub).toContain("Sucursal: Monterrey");
  });
});
