/**
 * Construcción PURA del "Layout de carga masiva para Toka" a partir de FuelEntry.
 * Sin DOM ni xlsx — solo transforma datos → filas. Testeable con vitest.
 *
 * Estructura EXACTA que exige Toka (1 hoja "Hoja1", 5 columnas en este orden):
 *   ID CLIENTE | Nómina | MONTO DESEADO | Producto | OBSERVACIONES
 * - ID CLIENTE: constante del cliente GPA en Toka (20780).
 * - Nómina: el economicoId de la unidad (entero; "06" → 6).
 * - MONTO DESEADO: suma del "monto a cargar" de la solicitud (FuelEntry.montoEstimado,
 *   = answers.montoACargar de MoreApp). Las cargas no traen montoEstimado → no suman.
 * - Producto: el `producto` del registro (de eco.PRODUCTO), ya en formato Toka exacto.
 * - OBSERVACIONES: vacío.
 */
import type { FuelEntry } from "./types";

export const TOKA_ID_CLIENTE = 20780;

export const TOKA_HEADER = [
  "ID CLIENTE",
  "Nómina",
  "MONTO DESEADO",
  "Producto",
  "OBSERVACIONES",
] as const;

/**
 * Nombres EXACTOS que Toka exige en el layout (rebrand a EASYGAS, 2026-06; grafía del
 * diésel corregida a "DIESEL" 2026-07-14 por Tesorería — antes el código emitía "DISEL").
 * "LP" sin "GAS". El dato de origen (MoreApp o catálogo) suele traer las grafías viejas
 * ("TOKA COMBUSTIBLE … CHIP") o el typo "DISEL"; `normalizeTokaProducto` las convierte
 * a estas 4 antes de escribir el layout, así Toka no rechaza el archivo.
 */
export const TOKA_PRODUCTOS = [
  "EASYGAS DIESEL CHIP",
  "EASYGAS LP CHIP",
  "EASYGAS MAGNA CHIP",
  "EASYGAS PREMIUM CHIP",
] as const;

const PRODUCTO_SET = new Set<string>(TOKA_PRODUCTOS);

/**
 * Normaliza cualquier grafía de producto (vieja "TOKA COMBUSTIBLE …" o variantes) al nombre
 * EXACTO que Toka exige hoy, detectando el tipo de combustible. Idempotente. Si no reconoce
 * el tipo, devuelve el valor tal cual (no rompe productos desconocidos — se reportan aparte).
 */
export function normalizeTokaProducto(p: string | null | undefined): string {
  const u = String(p ?? "").toUpperCase();
  if (u.includes("PREMIUM")) return "EASYGAS PREMIUM CHIP";
  if (u.includes("MAGNA")) return "EASYGAS MAGNA CHIP";
  if (u.includes("DIESEL") || u.includes("DISEL")) return "EASYGAS DIESEL CHIP";
  if (u.includes("LP")) return "EASYGAS LP CHIP"; // cubre "GAS LP" y "LP"
  return String(p ?? "").trim();
}

export type TokaRow = {
  idCliente: number; // siempre TOKA_ID_CLIENTE
  nomina: string | number; // número si eco es numérico ("06"→6); string p/ STOCK/TR
  montoDeseado: number; // Σ montoEstimado, redondeado a 2 decimales
  producto: string; // uno de TOKA_PRODUCTOS
  observaciones: ""; // siempre vacío
};

export type TokaSkipMotivo = "monto-cero" | "producto-ausente" | "producto-desconocido";

export type TokaSkip = {
  eco: string;
  montoDeseado: number;
  producto?: string;
  motivo: TokaSkipMotivo;
};

export type TokaWarningTipo =
  | "nomina-no-numerica"
  | "producto-conflicto"
  | "producto-override-desconocido";

export type TokaWarning = {
  eco: string;
  tipo: TokaWarningTipo;
  detalle: string;
};

export type TokaLayoutResult = {
  rows: TokaRow[];
  skipped: TokaSkip[];
  warnings: TokaWarning[];
  totalUnidades: number; // unidades distintas en el conjunto filtrado
  totalMonto: number; // suma de montoDeseado de las filas emitidas
};

export type TokaLayoutOpts = {
  idCliente?: number;
  /**
   * Override de producto por unidad (economicoId → producto Toka), del catálogo de
   * Unidades que mantiene el admin. Tiene PRIORIDAD sobre el `producto` de MoreApp y se
   * usa tal cual (sin validar contra TOKA_PRODUCTOS, porque el admin puede fijar variantes
   * nuevas como EASYGAS). Resuelve el caso de unidades migradas de tarjeta.
   */
  productoOverride?: ReadonlyMap<string, string>;
};

/** Redondeo a 2 decimales (pesos) sin errores binarios groseros. */
function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/**
 * Clave canónica de economicoId para casar el override del catálogo con las cargas de
 * MoreApp. Numérico puro → sin ceros a la izquierda ("06"→"6"); si no → trim+UPPER.
 * FUENTE ÚNICA de normalización: la usan el lookup del override y la nómina, para que NO
 * diverjan (antes el lookup usaba el eco crudo y "06"≠"6" ignoraba el override en silencio).
 */
export function ecoKey(eco: string | null | undefined): string {
  const t = String(eco ?? "").trim();
  return /^\d+$/.test(t) ? String(parseInt(t, 10)) : t.toUpperCase();
}

/** economicoId → nómina Toka: entero si es numérico puro ("06"→6); si no, passthrough. */
function toNomina(eco: string): { nomina: string | number; numerica: boolean } {
  const t = eco.trim();
  if (/^\d+$/.test(t)) return { nomina: parseInt(t, 10), numerica: true };
  return { nomina: t, numerica: false };
}

/** Timestamp para desempatar "registro más reciente" (fechaHora si existe, si no fecha). */
function ts(e: FuelEntry): string {
  return String(e.fechaHora || e.fecha || "");
}

/**
 * Arma el layout Toka agrupando por unidad (economicoId). Una fila por unidad con la suma
 * de `montoEstimado`. Devuelve también las unidades omitidas y advertencias (nada silencioso).
 */
export function buildTokaLayout(
  entries: readonly FuelEntry[],
  opts: TokaLayoutOpts = {},
): TokaLayoutResult {
  const idCliente = opts.idCliente ?? TOKA_ID_CLIENTE;

  const byEco = new Map<string, FuelEntry[]>();
  for (const e of entries) {
    const arr = byEco.get(e.eco);
    if (arr) arr.push(e);
    else byEco.set(e.eco, [e]);
  }

  const rows: TokaRow[] = [];
  const skipped: TokaSkip[] = [];
  const warnings: TokaWarning[] = [];

  for (const [eco, grupo] of byEco) {
    const montoDeseado = round2(grupo.reduce((s, e) => s + (e.montoEstimado ?? 0), 0));

    // Producto en crudo: 1º el override del catálogo de Unidades; si no, el `producto` de
    // MoreApp (único del grupo, o el del registro de mayor monto si hay conflicto).
    const override = opts.productoOverride?.get(ecoKey(eco))?.trim();
    let raw: string | undefined;
    let desdeOverride = false;
    if (override) {
      raw = override;
      desdeOverride = true;
    } else {
      const productos = [...new Set(grupo.map((e) => (e.producto ?? "").trim()).filter(Boolean))];
      if (productos.length === 1) {
        raw = productos[0];
      } else if (productos.length > 1) {
        const ganador = [...grupo]
          .filter((e) => (e.producto ?? "").trim())
          .sort(
            (a, b) => (b.montoEstimado ?? 0) - (a.montoEstimado ?? 0) || ts(b).localeCompare(ts(a)),
          )[0];
        raw = (ganador?.producto ?? "").trim();
        warnings.push({
          eco,
          tipo: "producto-conflicto",
          detalle: `Productos distintos en el período (${productos.join(" / ")}); se usó "${raw}".`,
        });
      }
    }

    // Validaciones que excluyen la unidad (se reportan).
    if (!raw) {
      skipped.push({ eco, montoDeseado, motivo: "producto-ausente" });
      continue;
    }
    // Normaliza a la grafía EXACTA de Toka (EASYGAS …); el origen suele traer la vieja.
    const producto = normalizeTokaProducto(raw);
    if (!PRODUCTO_SET.has(producto)) {
      // Tipo de combustible no reconocido tras normalizar. Override se respeta (passthrough)
      // con aviso; lo derivado de MoreApp se omite (no arriesgamos un producto inválido).
      if (desdeOverride)
        warnings.push({
          eco,
          tipo: "producto-override-desconocido",
          detalle: `Producto del catálogo "${raw}" no corresponde a ningún producto Toka conocido; verifica la captura.`,
        });
      else {
        skipped.push({ eco, montoDeseado, producto, motivo: "producto-desconocido" });
        continue;
      }
    }
    if (!(montoDeseado > 0)) {
      skipped.push({ eco, montoDeseado, producto, motivo: "monto-cero" });
      continue;
    }

    const { nomina, numerica } = toNomina(eco);
    if (!numerica) {
      warnings.push({
        eco,
        tipo: "nomina-no-numerica",
        detalle: `La nómina "${nomina}" no es numérica; verifica que coincida con Toka.`,
      });
    }

    rows.push({ idCliente, nomina, montoDeseado, producto, observaciones: "" });
  }

  // Orden estable: nóminas numéricas por valor asc, luego las string A-Z.
  rows.sort((a, b) => {
    const an = typeof a.nomina === "number";
    const bn = typeof b.nomina === "number";
    if (an && bn) return (a.nomina as number) - (b.nomina as number);
    if (an !== bn) return an ? -1 : 1;
    return String(a.nomina).localeCompare(String(b.nomina));
  });

  return {
    rows,
    skipped,
    warnings,
    totalUnidades: byEco.size,
    totalMonto: round2(rows.reduce((s, r) => s + r.montoDeseado, 0)),
  };
}

/** Filas como array-of-arrays para XLSX.utils.aoa_to_sheet (header + datos, orden EXACTO). */
export function tokaLayoutToAoa(result: TokaLayoutResult): (string | number)[][] {
  return [
    [...TOKA_HEADER],
    ...result.rows.map((r) => [r.idCliente, r.nomina, r.montoDeseado, r.producto, r.observaciones]),
  ];
}
