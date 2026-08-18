/**
 * Columnas y filas de la exportación a Excel del módulo Taller. PURO y testeable:
 * no toca DOM ni la librería de Excel — el monolito arma el libro con esto.
 *
 * Por qué existe (auditoría 2026-08-14): la exportación se armaba con dos listas de columnas
 * escritas a mano dentro del monolito, y se quedaban cortas frente a `TallerEntry`:
 *   · Activas no llevaba `fsalidaReal`, `fcierre`, `id`, `unitKey` ni las marcas de tiempo.
 *   · Detalle del historial ADEMÁS se comía `refacciones` y `freporte` — el historial no decía
 *     qué refacciones se usaron, que es media razón de existir de un historial de taller.
 * Ahora hay UNA sola definición para las dos hojas (imposible que vuelvan a divergir) y un
 * test de cobertura que falla si alguien agrega un campo al modelo y no lo exporta.
 *
 * Formato: las fechas salen como `Date` y los montos como `number`, cada columna con su
 * formato de Excel (`formato` → `cell.z`). Antes las fechas iban como texto "14/08/2026", así
 * que Excel las ordenaba alfabéticamente y filtrar por rango no servía.
 */
import type { TallerEntry } from "./types";

export type TipoColumna = "texto" | "numero" | "moneda" | "fecha";

export interface ColumnaTaller {
  /** Campo de `TallerEntry` que representa. Los derivados usan un nombre propio. */
  campo: string;
  titulo: string;
  /** Ancho en caracteres (SheetJS `!cols[].wch`). */
  ancho: number;
  tipo: TipoColumna;
  /** Formato de celda de Excel (SheetJS `cell.z`). */
  formato?: string;
  valor: (e: TallerEntry, ctx: ContextoExport) => string | number | Date;
}

export interface ContextoExport {
  /** Reloj inyectado: los días en taller dependen de "hoy" y así el test es determinista. */
  hoy: Date;
}

const FMT_FECHA = "dd/mm/yyyy";
const FMT_MONEDA = '"$"#,##0.00';
const MS_DIA = 86400000;

/** Fecha válida o `""`. Nunca "Invalid Date" en la celda. */
function fecha(v: unknown): Date | "" {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s);
  return Number.isNaN(d.getTime()) ? "" : d;
}

const texto = (v: unknown): string => String(v ?? "").trim();

/**
 * Gasto total del ingreso. El desglose (refacciones + mano de obra) MANDA; el campo `gasto`
 * es el respaldo de los registros anteriores al desglose — sin él el total salía en $0
 * (auditoría 2026-06-04).
 */
export function gastoTotalDe(e: TallerEntry): number {
  const desglose = (e.gastoRef ?? 0) + (e.gastoMO ?? 0);
  return desglose > 0 ? desglose : (e.gasto ?? 0);
}

/**
 * Días que la unidad lleva (o llevó) en taller. Hasta la salida real si ya salió; hasta `hoy`
 * si sigue abierta. `""` sin fecha de entrada — no se inventa un número.
 */
export function diasEnTaller(e: TallerEntry, hoy: Date): number | "" {
  const entrada = fecha(e.fentrada);
  if (!entrada) return "";
  const fin = fecha(e.fsalidaReal) || hoy;
  return Math.max(0, Math.round((fin.getTime() - entrada.getTime()) / MS_DIA));
}

/**
 * Columnas del detalle por ingreso. Las usan LAS DOS hojas de entries (Activas e Historial):
 * es la misma entidad, así que una sola lista evita que vuelvan a divergir.
 *
 * Orden: primero lo que se lee a diario (identidad, estado, fechas, costos, texto libre) y al
 * final la trazabilidad técnica (id, llave, marcas de tiempo), que estorba si va al frente.
 */
export const COLUMNAS_TALLER: ColumnaTaller[] = [
  { campo: "eco", titulo: "No. Unidad", ancho: 12, tipo: "texto", valor: (e) => texto(e.eco) },
  { campo: "plate", titulo: "Placas", ancho: 12, tipo: "texto", valor: (e) => texto(e.plate) },
  { campo: "brand", titulo: "Modelo", ancho: 22, tipo: "texto", valor: (e) => texto(e.brand) },
  { campo: "sucursal", titulo: "Sucursal", ancho: 14, tipo: "texto", valor: (e) => texto(e.sucursal) },
  { campo: "area", titulo: "Área", ancho: 16, tipo: "texto", valor: (e) => texto(e.area) },
  { campo: "tipo", titulo: "Tipo", ancho: 13, tipo: "texto", valor: (e) => texto(e.tipo) },
  { campo: "estado", titulo: "Estado", ancho: 15, tipo: "texto", valor: (e) => texto(e.estado) },
  // Kilometraje al ingreso: obligatorio en el formulario y guardado en la nube desde
  // siempre, pero el tipo no lo declaraba y el reporte no lo llevaba (reporte usuario
  // 2026-08-14). 0 = registro viejo sin captura → celda vacía, no un "0 km" que miente.
  {
    campo: "km",
    titulo: "KM Ingreso",
    ancho: 11,
    tipo: "numero",
    formato: "#,##0",
    valor: (e) => {
      const n = Number(e.km);
      return Number.isFinite(n) && n > 0 ? n : "";
    },
  },
  { campo: "freporte", titulo: "F. Reporte", ancho: 12, tipo: "fecha", formato: FMT_FECHA, valor: (e) => fecha(e.freporte) },
  { campo: "fentrada", titulo: "F. Entrada", ancho: 12, tipo: "fecha", formato: FMT_FECHA, valor: (e) => fecha(e.fentrada) },
  { campo: "fsalidaEst", titulo: "F. Salida Est.", ancho: 13, tipo: "fecha", formato: FMT_FECHA, valor: (e) => fecha(e.fsalidaEst) },
  // Faltaba en Activas: una unidad "Por recuperar" ya tiene salida real y no se veía.
  { campo: "fsalidaReal", titulo: "F. Salida Real", ancho: 13, tipo: "fecha", formato: FMT_FECHA, valor: (e) => fecha(e.fsalidaReal) },
  { campo: "fcierre", titulo: "F. Cierre", ancho: 12, tipo: "fecha", formato: FMT_FECHA, valor: (e) => fecha(e.fcierre) },
  { campo: "_dias", titulo: "Días en Taller", ancho: 13, tipo: "numero", formato: "0", valor: (e, c) => diasEnTaller(e, c.hoy) },
  { campo: "tecnico", titulo: "Técnico", ancho: 20, tipo: "texto", valor: (e) => texto(e.tecnico) },
  // Referencia cruzada con el ERP (NetSuite): el pedido con el que se gestiona la
  // compra/servicio. Va junto a técnico y refacciones — es la cadena de gestión.
  { campo: "pedidoErp", titulo: "Pedido ERP", ancho: 15, tipo: "texto", valor: (e) => texto(e.pedidoErp) },
  // Faltaba en el Detalle del historial: sin esto el historial no dice qué se le puso.
  { campo: "refacciones", titulo: "Refacciones", ancho: 34, tipo: "texto", valor: (e) => texto(e.refacciones) },
  { campo: "gastoRef", titulo: "Gasto Refacciones", ancho: 16, tipo: "moneda", formato: FMT_MONEDA, valor: (e) => e.gastoRef ?? 0 },
  { campo: "gastoMO", titulo: "Gasto Mano de Obra", ancho: 17, tipo: "moneda", formato: FMT_MONEDA, valor: (e) => e.gastoMO ?? 0 },
  { campo: "_gastoTotal", titulo: "Gasto Total", ancho: 14, tipo: "moneda", formato: FMT_MONEDA, valor: (e) => gastoTotalDe(e) },
  // Se exporta aparte para poder auditar QUÉ registros no tienen desglose: en ésos el Gasto
  // Total viene de aquí, no de la suma.
  { campo: "gasto", titulo: "Gasto sin desglose", ancho: 16, tipo: "moneda", formato: FMT_MONEDA, valor: (e) => e.gasto ?? 0 },
  { campo: "comentario", titulo: "Comentario", ancho: 44, tipo: "texto", valor: (e) => texto(e.comentario) },
  { campo: "id", titulo: "ID registro", ancho: 16, tipo: "texto", valor: (e) => texto(e.id) },
  { campo: "unitKey", titulo: "Llave de unidad", ancho: 14, tipo: "texto", valor: (e) => texto(e.unitKey) },
  { campo: "createdAt", titulo: "Creado", ancho: 17, tipo: "fecha", formato: "dd/mm/yyyy hh:mm", valor: (e) => fecha(e.createdAt) },
  { campo: "updatedAt", titulo: "Actualizado", ancho: 17, tipo: "fecha", formato: "dd/mm/yyyy hh:mm", valor: (e) => fecha(e.updatedAt) },
];

/**
 * Campos de `TallerEntry` que NO se exportan, y por qué. El test de cobertura exige que todo
 * campo esté aquí o en las columnas: así, agregar un campo al modelo obliga a decidir.
 */
export const CAMPOS_OMITIDOS: Record<string, string> = {
  _cloud:
    "Bandera interna de hidratación (marca que el registro ya estuvo en la nube, guarda anti-resurrección). No es un dato de negocio.",
};

/** Fila por entry, en el orden de las columnas. */
export function filasDe(
  entries: readonly TallerEntry[],
  columnas: readonly ColumnaTaller[],
  ctx: ContextoExport,
): (string | number | Date)[][] {
  return entries.map((e) => columnas.map((c) => c.valor(e, ctx)));
}

// ── Hoja de resumen por unidad ───────────────────────────────────────────────────
/** Agregado por unidad que consume la hoja "Resumen". */
export interface ResumenUnidad {
  eco?: string;
  plate?: string;
  brand?: string;
  sucursal?: string;
  area?: string;
  visitas: number;
  gastoTotal: number;
  gastoRef: number;
  gastoMO: number;
  primerIngreso?: string;
  ultimaSalida?: string;
  diasPromedio?: number | "";
  /** Odómetro más alto conocido de la unidad (cualquier visita, abierta o cerrada). */
  kmUltimo?: number | "";
  /**
   * Gasto de mantenimiento registrado por cada 1,000 km de vida de la unidad — la base
   * del reparar-vs-reemplazar. Honestidad del dato: el numerador es el gasto CAPTURADO
   * en este módulo (visitas cerradas), no necesariamente todo el mantenimiento real.
   */
  costoPorMilKm?: number | "";
}

export interface ColumnaResumen {
  titulo: string;
  ancho: number;
  tipo: TipoColumna;
  formato?: string;
  valor: (u: ResumenUnidad) => string | number | Date;
}

export const COLUMNAS_RESUMEN: ColumnaResumen[] = [
  { titulo: "No. Unidad", ancho: 12, tipo: "texto", valor: (u) => texto(u.eco) },
  { titulo: "Placas", ancho: 12, tipo: "texto", valor: (u) => texto(u.plate) },
  { titulo: "Modelo", ancho: 22, tipo: "texto", valor: (u) => texto(u.brand) },
  { titulo: "Sucursal", ancho: 14, tipo: "texto", valor: (u) => texto(u.sucursal) },
  { titulo: "Área", ancho: 16, tipo: "texto", valor: (u) => texto(u.area) },
  { titulo: "Visitas", ancho: 9, tipo: "numero", formato: "0", valor: (u) => u.visitas },
  { titulo: "Gasto Total", ancho: 14, tipo: "moneda", formato: FMT_MONEDA, valor: (u) => u.gastoTotal },
  { titulo: "Refacciones", ancho: 14, tipo: "moneda", formato: FMT_MONEDA, valor: (u) => u.gastoRef },
  { titulo: "Mano de Obra", ancho: 14, tipo: "moneda", formato: FMT_MONEDA, valor: (u) => u.gastoMO },
  { titulo: "Días Promedio", ancho: 13, tipo: "numero", formato: "0.0", valor: (u) => u.diasPromedio ?? "" },
  { titulo: "KM Último", ancho: 11, tipo: "numero", formato: "#,##0", valor: (u) => u.kmUltimo ?? "" },
  { titulo: "$ / 1,000 km", ancho: 13, tipo: "moneda", formato: '"$"#,##0.00', valor: (u) => u.costoPorMilKm ?? "" },
  { titulo: "Primer Ingreso", ancho: 13, tipo: "fecha", formato: FMT_FECHA, valor: (u) => fecha(u.primerIngreso) },
  { titulo: "Última Salida", ancho: 13, tipo: "fecha", formato: FMT_FECHA, valor: (u) => fecha(u.ultimaSalida) },
];

/** Filas de la hoja de resumen. */
export function filasResumen(unidades: readonly ResumenUnidad[]): (string | number | Date)[][] {
  return unidades.map((u) => COLUMNAS_RESUMEN.map((c) => c.valor(u)));
}
