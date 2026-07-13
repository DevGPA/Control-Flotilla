import { describe, expect, it } from "vitest";
import {
  SOLICITUDES_HEADER,
  buildSolicitudesLayout,
  solicitudesLayoutToAoa,
} from "../src/fuel/solicitudesLayout";
import type { FuelEntry } from "../src/fuel/types";

/** Índice de columna por encabezado (los tests leen celdas por nombre, no por número). */
function col(nombre: string): number {
  const i = (SOLICITUDES_HEADER as readonly string[]).indexOf(nombre);
  if (i < 0) throw new Error(`columna no existe: ${nombre}`);
  return i;
}

/** Solicitud estilo MoreApp (fechaHora local sin offset, formCerrado ISO UTC). */
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
    formCerrado: "2026-07-13T13:23:59.543Z", // 07:23 GDL (UTC-6)
    responsable: "CANDELARIO RIVERA LUIS MANUEL",
    km: 42573,
    submarca: 'Ram 4000 Chasis Plano Largo "PL"/V8 5 MT',
    area: "Logística",
    combustible: "Gasolina",
    producto: "TOKA COMBUSTIBLE PREMIUM CHIP",
    nivelAntes: "0.50(1/2)",
    nivelDeseado: "1.00",
    montoEstimado: 2423,
    maxLitros: 91,
    necesidad: 0.5,
    precioCatalogo: 26.63,
    observaciones: "",
    emailNotificar: "logisticaalmacenes@gpa.com.mx",
    photos: [
      {
        fname: "moreapp_56_eead991d_fotomedidordecombustible.jpg",
        col: "fotoMedidorDeCombustible",
        group: "Solicitud Combustible",
      },
      {
        fname: "moreapp_56_1410ea62_signatureofthecustomer.png",
        col: "signatureOfTheCustomer",
        group: "Solicitud Combustible",
      },
    ],
    ...over,
  };
}

/** Solicitud estilo Operaciones-GPA (eventoId OPS-, fechaHora ISO con offset, mail capturista). */
function solOps(over: Partial<FuelEntry> = {}): FuelEntry {
  return {
    loadId: "57|solicitud|OPS-d523616af161",
    tipo: "solicitud",
    eco: "57",
    eventoId: "OPS-d523616af161",
    placa: "G25NXP57",
    sucursal: "Monterrey",
    tanque: "41",
    fecha: "2026-07-13",
    fechaHora: "2026-07-13T08:46:50.786047-06:00",
    responsable: "GONZALEZ LOPEZ SERGIO RENE",
    km: 2976,
    combustible: "Gas LP",
    producto: "TOKA COMBUSTIBLE GAS LP CHIP",
    nivelAntes: "25%",
    nivelDeseado: "100%",
    montoEstimado: 341,
    maxLitros: 31,
    necesidad: 0.75,
    precioCatalogo: 11,
    mailSolicitante: "almty@gpa.com.mx",
    photos: [
      { fname: "opsgpa_57_47ac8ce1_photo.jpg", col: "foto", group: "Evidencia" },
      { fname: "opsgpa_57_ebb5b40d_firma.png", col: "firma", group: "Firma" },
    ],
    ...over,
  };
}

function carga(over: Partial<FuelEntry> = {}): FuelEntry {
  return {
    loadId: "47|carga|4340",
    tipo: "carga",
    eco: "47",
    eventoId: "4340",
    sucursal: "Cancun",
    fecha: "2026-07-11",
    monto: 800,
    litros: 30,
    photos: [],
    ...over,
  };
}

describe("SOLICITUDES_HEADER (golden: 30 encabezados EXACTOS del export de MoreApp)", () => {
  it("replica los 30 encabezados con grafía literal (doble espacio y 'montarcargas' incluidos)", () => {
    expect([...SOLICITUDES_HEADER]).toEqual([
      "Serial Number",
      "By",
      "On",
      "Summary",
      "Location - Latitude",
      "Location - Longitude",
      "Fecha y Hora",
      "# Economico - id",
      "# Economico - PLACAS",
      "# Economico - SUBMARCA",
      "# Economico - SUCURSAL",
      "# Economico - TANQUE",
      "# Economico - RESPONSABLE",
      "# Economico - combustible",
      "# Economico - precio",
      "Kilometraje",
      "Foto  de kilometraje y medidor de combustible al realizar esta solicitud (en la misma foto)",
      "Foto de horometro (montarcargas)",
      "Nivel del tanque antes de cargar (mas cercano)",
      "Nivel del tanque deseado",
      "Necesidad de gasolina (parte del tanque)",
      "Precio estimado x litros",
      "Maximo litros a cargar",
      "Monto a cargar ($)",
      "Observaciones",
      "Nombre del Solicitante - id",
      "Nombre del Solicitante - RESPONSABLE",
      "Nombre del Solicitante - MAIL",
      "Firma del Solicitante",
      "Email para notificar (no cambiar)",
    ]);
  });
});

describe("buildSolicitudesLayout — fila MoreApp", () => {
  const r = buildSolicitudesLayout([solMoreApp()]);
  const row = r.rows[0]!;

  it("emite una fila con 30 celdas", () => {
    expect(r.rows).toHaveLength(1);
    expect(row).toHaveLength(SOLICITUDES_HEADER.length);
  });

  it("Serial Number numérico para folios MoreApp", () => {
    expect(row[col("Serial Number")]).toBe(12292);
  });

  it("números editables: monto, precio(s), litros, km y necesidad como number", () => {
    expect(row[col("Monto a cargar ($)")]).toBe(2423);
    expect(row[col("# Economico - precio")]).toBe(26.63);
    expect(row[col("Precio estimado x litros")]).toBe(26.63);
    expect(row[col("Maximo litros a cargar")]).toBe(91);
    expect(row[col("Kilometraje")]).toBe(42573);
    expect(row[col("Necesidad de gasolina (parte del tanque)")]).toBe(0.5);
  });

  it("Fecha y Hora = Date local con la hora capturada (07:23)", () => {
    const d = row[col("Fecha y Hora")] as Date;
    expect(d).toBeInstanceOf(Date);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 7, 13, 7, 23,
    ]);
  });

  it("On = formCerrado convertido al huso de la sucursal (13:23Z → 07:23 GDL)", () => {
    const d = row[col("On")] as Date;
    expect(d).toBeInstanceOf(Date);
    expect([d.getHours(), d.getMinutes()]).toEqual([7, 23]);
  });

  it("datos de la unidad: eco, placas, submarca, sucursal, tanque, área en MAYÚSCULAS sin acento", () => {
    expect(row[col("# Economico - id")]).toBe("56");
    expect(row[col("# Economico - PLACAS")]).toBe("JX52508");
    expect(row[col("# Economico - SUBMARCA")]).toBe('Ram 4000 Chasis Plano Largo "PL"/V8 5 MT');
    expect(row[col("# Economico - SUCURSAL")]).toBe("Guadalajara");
    expect(row[col("# Economico - TANQUE")]).toBe("173");
    expect(row[col("# Economico - RESPONSABLE")]).toBe("LOGISTICA");
    expect(row[col("# Economico - combustible")]).toBe("Gasolina");
  });

  it("niveles, solicitante, firma, email notificar; no disponibles quedan vacíos", () => {
    expect(row[col("Nivel del tanque antes de cargar (mas cercano)")]).toBe("0.50(1/2)");
    expect(row[col("Nivel del tanque deseado")]).toBe("1.00");
    expect(row[col("Nombre del Solicitante - RESPONSABLE")]).toBe("CANDELARIO RIVERA LUIS MANUEL");
    expect(row[col("Firma del Solicitante")]).toBe(
      "moreapp_56_1410ea62_signatureofthecustomer.png",
    );
    expect(row[col("Email para notificar (no cambiar)")]).toBe("logisticaalmacenes@gpa.com.mx");
    // Sin dato en la nube → vacío.
    expect(row[col("By")]).toBe("");
    expect(row[col("Summary")]).toBe("");
    expect(row[col("Location - Latitude")]).toBe("");
    expect(row[col("Location - Longitude")]).toBe("");
    expect(row[col("Nombre del Solicitante - id")]).toBe("");
    expect(row[col("Nombre del Solicitante - MAIL")]).toBe("");
  });

  it("foto de medidor va a su columna; horómetro vacío si no hay", () => {
    expect(
      row[
        col(
          "Foto  de kilometraje y medidor de combustible al realizar esta solicitud (en la misma foto)",
        )
      ],
    ).toBe("moreapp_56_eead991d_fotomedidordecombustible.jpg");
    expect(row[col("Foto de horometro (montarcargas)")]).toBe("");
  });
});

describe("buildSolicitudesLayout — fila OPS (Operaciones-GPA)", () => {
  const row = buildSolicitudesLayout([solOps()]).rows[0]!;

  it("Serial Number queda como texto OPS-…", () => {
    expect(row[col("Serial Number")]).toBe("OPS-d523616af161");
  });

  it("By y MAIL llevan el correo del capturista", () => {
    expect(row[col("By")]).toBe("almty@gpa.com.mx");
    expect(row[col("Nombre del Solicitante - MAIL")]).toBe("almty@gpa.com.mx");
  });

  it("Fecha y Hora conserva la hora local de la sucursal (08:46 MTY, ignora el offset ISO)", () => {
    const d = row[col("Fecha y Hora")] as Date;
    expect([d.getHours(), d.getMinutes()]).toEqual([8, 46]);
  });

  it("On cae a fechaHora convertida por huso cuando no hay formCerrado (08:46-06:00 → 08:46 MTY)", () => {
    const d = row[col("On")] as Date;
    expect(d).toBeInstanceOf(Date);
    expect([d.getHours(), d.getMinutes()]).toEqual([8, 46]);
  });

  it("la foto genérica de evidencia va a la columna de kilometraje/medidor y la firma a la suya", () => {
    expect(
      row[
        col(
          "Foto  de kilometraje y medidor de combustible al realizar esta solicitud (en la misma foto)",
        )
      ],
    ).toBe("opsgpa_57_47ac8ce1_photo.jpg");
    expect(row[col("Firma del Solicitante")]).toBe("opsgpa_57_ebb5b40d_firma.png");
  });

  it("área ausente en el catálogo → RESPONSABLE del económico vacío", () => {
    expect(row[col("# Economico - RESPONSABLE")]).toBe("");
  });
});

describe("buildSolicitudesLayout — alcance y orden", () => {
  it("excluye cargas y anuladas; solo solicitudes vigentes", () => {
    const anulada = solMoreApp({
      loadId: "56|solicitud|12299",
      eventoId: "12299",
      anulada: { motivo: "duplicada", anuladoPor: "admin", ts: "2026-07-13T15:00:00Z" },
    });
    const r = buildSolicitudesLayout([carga(), anulada, solOps()]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]![col("Serial Number")]).toBe("OPS-d523616af161");
  });

  it("ordena por fecha/hora ascendente aun mezclando formatos MoreApp y OPS", () => {
    // 09:33 MoreApp (formato con espacio) debe salir DESPUÉS de 08:46 OPS (formato ISO):
    // el orden es cronológico real, no alfabético de strings.
    const tarde = solMoreApp({ eventoId: "12314", fechaHora: "2026-07-13 09:33" });
    const r = buildSolicitudesLayout([tarde, solOps()]);
    expect(r.rows.map((row) => row[col("Serial Number")])).toEqual(["OPS-d523616af161", 12314]);
  });

  it("totaliza monto y cuenta incluidas", () => {
    const r = buildSolicitudesLayout([solMoreApp(), solOps()]);
    expect(r.incluidas).toBe(2);
    expect(r.totalMonto).toBe(2764);
  });
});

describe("solicitudesLayoutToAoa", () => {
  it("antepone el header exacto a las filas", () => {
    const r = buildSolicitudesLayout([solMoreApp()]);
    const aoa = solicitudesLayoutToAoa(r);
    expect(aoa[0]).toEqual([...SOLICITUDES_HEADER]);
    expect(aoa).toHaveLength(2);
  });
});
