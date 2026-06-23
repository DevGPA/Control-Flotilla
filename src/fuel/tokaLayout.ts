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
 * Productos Toka conocidos (para validar el dato derivado de MoreApp y poblar el
 * desplegable del panel). Toka está migrando algunas tarjetas de "TOKA COMBUSTIBLE"
 * a "EASYGAS"; el catálogo de Unidades (override del admin) acepta cualquier valor,
 * así que esta lista NO es un límite — solo valida lo que viene de MoreApp.
 */
export const TOKA_PRODUCTOS = [
  "TOKA COMBUSTIBLE DIESEL CHIP",
  "TOKA COMBUSTIBLE GAS LP CHIP",
  "TOKA COMBUSTIBLE MAGNA CHIP",
  "TOKA COMBUSTIBLE PREMIUM CHIP",
  "EASYGAS DIESEL CHIP",
] as const;

const PRODUCTO_SET = new Set<string>(TOKA_PRODUCTOS);

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

    // Producto: 1º el override del catálogo de Unidades (admin, se usa tal cual y no se
    // valida contra TOKA_PRODUCTOS); si no, el `producto` de MoreApp (único del grupo, o
    // el del registro de mayor monto si hay conflicto, y validado contra el catálogo).
    const override = opts.productoOverride?.get(ecoKey(eco))?.trim();
    let producto: string | undefined;
    let desdeOverride = false;
    if (override) {
      producto = override;
      desdeOverride = true;
      // El override se usa tal cual (admite variantes nuevas tipo EASYGAS), pero si no
      // coincide con ningún producto Toka conocido avisamos (no bloquea): suele ser errata
      // de captura (p.ej. falta "CHIP" o mayúsculas) que Toka rechazaría al subir.
      if (!PRODUCTO_SET.has(producto))
        warnings.push({
          eco,
          tipo: "producto-override-desconocido",
          detalle: `Producto del catálogo "${producto}" no coincide con un producto Toka conocido; verifica mayúsculas y "CHIP".`,
        });
    } else {
      const productos = [...new Set(grupo.map((e) => (e.producto ?? "").trim()).filter(Boolean))];
      if (productos.length === 1) {
        producto = productos[0];
      } else if (productos.length > 1) {
        const ganador = [...grupo]
          .filter((e) => (e.producto ?? "").trim())
          .sort(
            (a, b) => (b.montoEstimado ?? 0) - (a.montoEstimado ?? 0) || ts(b).localeCompare(ts(a)),
          )[0];
        producto = (ganador?.producto ?? "").trim();
        warnings.push({
          eco,
          tipo: "producto-conflicto",
          detalle: `Productos distintos en el período (${productos.join(" / ")}); se usó "${producto}".`,
        });
      }
    }

    // Validaciones que excluyen la unidad (se reportan).
    if (!producto) {
      skipped.push({ eco, montoDeseado, motivo: "producto-ausente" });
      continue;
    }
    if (!desdeOverride && !PRODUCTO_SET.has(producto)) {
      skipped.push({ eco, montoDeseado, producto, motivo: "producto-desconocido" });
      continue;
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
