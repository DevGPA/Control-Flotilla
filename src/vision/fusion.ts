/**
 * Fusión determinística de la lectura de visión IA (Fase 1 — tickets de combustible).
 *
 * La IA lee las fotos A CIEGAS (nunca ve lo capturado) y devuelve una lectura por
 * evidencia vía tool use forzado (ver prompt.ts). Este módulo — puro, sin AWS — decide
 * los campos planos que se persisten en ValidacionCarga:
 *
 *   - El TICKET es canónico; la BOMBA es respaldo para monto/litros/precio si el
 *     ticket no se pudo leer (el display no trae fecha confiable → fecha solo del ticket).
 *   - confianzaVision = mínimo de las confianzas de las evidencias USADAS.
 *   - "ilegible" ≠ "no cuadra": una lectura ilegible jamás aporta valores (cinturón:
 *     aunque el modelo mandara números, se descartan).
 *   - "faltante" lo estampa el CÓDIGO (objeto ausente en S3), nunca el modelo.
 *   - La comparación capturado-vs-detectado NO vive aquí: es client-side
 *     (regla "ticket-no-cuadra" en fuelAnalysis), para que el humano decida.
 */

export type EstadoEvidencia = "ok" | "ilegible" | "no-corresponde" | "faltante";

/** Lectura de una evidencia con montos (ticket de gasolinera o display de la bomba). */
export interface LecturaMontos {
  monto: number | null;
  litros: number | null;
  precioLitro: number | null;
  fecha: string | null; // como la leyó el modelo; se normaliza aquí
  confianza: number; // 0-1
  estado: EstadoEvidencia;
}

/** Lectura del medidor de tanque (fotoAntes / fotoDespues). */
export interface LecturaNivel {
  nivel: string | null; // "lleno" | "3/4" | "1/2" | "1/4" | "vacío" (enum del schema)
  confianza: number;
  estado: EstadoEvidencia;
}

/** Forma EXACTA del input del tool use (prompt.ts fuerza este shape con strict). */
export interface LecturaVision {
  ticket?: LecturaMontos;
  bomba?: LecturaMontos;
  tanqueAntes?: LecturaNivel;
  tanqueDespues?: LecturaNivel;
  notas?: string;
}

/** Campos planos que la Lambda persiste en ValidacionCarga (solo campos de visión). */
export interface CamposVision {
  montoDetectado: number | null;
  litrosDetectado: number | null;
  precioDetectado: number | null;
  fechaDetectada: string | null; // YYYY-MM-DD
  nivelDetectado: string | null; // nivel DESPUÉS de la carga
  confianzaVision: number | null;
  visionDetalle: LecturaVision;
}

/** Campo de foto → llave de evidencia en LecturaVision (para estampar faltantes). */
type EvidenciaKey = "ticket" | "bomba" | "tanqueAntes" | "tanqueDespues";
const CAMPO_A_EVIDENCIA: Record<string, EvidenciaKey> = {
  fotoTicket: "ticket",
  fotoBomba: "bomba",
  fotoAntes: "tanqueAntes",
  fotoDespues: "tanqueDespues",
};

const FALTANTE_MONTOS: LecturaMontos = {
  monto: null,
  litros: null,
  precioLitro: null,
  fecha: null,
  confianza: 0,
  estado: "faltante",
};

const FALTANTE_NIVEL: LecturaNivel = { nivel: null, confianza: 0, estado: "faltante" };

/**
 * Normaliza la fecha del ticket a YYYY-MM-DD. Los tickets mexicanos vienen DD/MM/AAAA
 * (también tolera "-" y dígitos sueltos); un ISO pasa directo. Basura → null: la regla
 * dura es jamás adivinar.
 */
export function normalizaFechaTicket(fecha: string | null | undefined): string | null {
  const f = String(fecha ?? "").trim();
  if (!f) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(f);
  if (iso) {
    const [y, m, d] = [iso[1] ?? "", iso[2] ?? "", iso[3] ?? ""];
    return fechaValida(+y, +m, +d) ? `${y}-${m}-${d}` : null;
  }

  const mx = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(f);
  if (mx) {
    const [d, m, y] = [mx[1] ?? "", mx[2] ?? "", mx[3] ?? ""];
    if (!fechaValida(+y, +m, +d)) return null;
    return `${y}-${String(+m).padStart(2, "0")}-${String(+d).padStart(2, "0")}`;
  }

  return null;
}

function fechaValida(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Una lectura solo se USA si su estado es "ok" (ilegible/faltante/no-corresponde no aportan). */
function usable<T extends { estado: EstadoEvidencia }>(l: T | undefined): l is T {
  return !!l && l.estado === "ok";
}

/**
 * Fusiona la lectura del modelo + la lista de fotos que el código detectó ausentes en
 * S3 (`faltantes`, por nombre de campo: "fotoTicket", "fotoBomba", ...).
 */
export function fusionaLectura(lectura: LecturaVision, faltantes: string[]): CamposVision {
  // Estampar faltantes SIN pisar lecturas reales (el modelo no vio esas fotos).
  const detalle: LecturaVision = { ...lectura };
  for (const campo of faltantes) {
    const ev = CAMPO_A_EVIDENCIA[campo];
    if (!ev || detalle[ev]) continue;
    if (ev === "tanqueAntes" || ev === "tanqueDespues") detalle[ev] = { ...FALTANTE_NIVEL };
    else detalle[ev] = { ...FALTANTE_MONTOS };
  }

  const ticket = usable(detalle.ticket) ? detalle.ticket : undefined;
  const bomba = usable(detalle.bomba) ? detalle.bomba : undefined;
  const despues = usable(detalle.tanqueDespues) ? detalle.tanqueDespues : undefined;

  // Ticket canónico; bomba respaldo (solo montos — el display no trae fecha confiable).
  const montos = ticket ?? bomba;
  const usadas = [ticket ?? bomba, despues].filter((l): l is LecturaMontos | LecturaNivel => !!l);

  return {
    montoDetectado: montos?.monto ?? null,
    litrosDetectado: montos?.litros ?? null,
    precioDetectado: montos?.precioLitro ?? null,
    fechaDetectada: ticket ? normalizaFechaTicket(ticket.fecha) : null,
    nivelDetectado: despues?.nivel ?? null,
    confianzaVision: usadas.length ? Math.min(...usadas.map((l) => l.confianza)) : null,
    visionDetalle: detalle,
  };
}
