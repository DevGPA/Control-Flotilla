/**
 * Orquestador de la visión IA de una carga (Fase 1) — testeable con deps inyectadas.
 *
 * La Lambda vision-combustible provee las deps reales (S3, Bedrock, data client) y
 * este módulo decide el flujo: idempotencia → bajar fotos → reescalar → una sola
 * llamada a Bedrock → fusión determinística → update parcial SOLO de campos de visión.
 *
 * Reglas que este módulo garantiza (ver plan Fase 1):
 *  - Idempotencia por (tsVision + set de fnames): una re-entrega del puente con las
 *    mismas fotos no gasta una segunda llamada a Bedrock; si llegó una foto nueva
 *    (la copia tolerante a fallo se reparó), SÍ se re-analiza.
 *  - CERO fotos disponibles → no se escribe nada: la fila queda "sin visión" y la
 *    repara la siguiente re-entrega o el modo reproceso.
 *  - Un error de Bedrock se propaga: el invoke asíncrono de Lambda reintenta solo.
 */
import { buildVisionPrompt, type VisionPrompt } from "./prompt";
import { fusionaLectura, type CamposVision, type LecturaVision } from "./fusion";
import { preparaImagen, type ImagenPreparada } from "./resize";

export interface EventoVision {
  tenantId: string;
  loadId: string;
  /** campo → fname en S3 photos/ (solo los que el receptor conoce; pueden faltar). */
  fnames: Record<string, string>;
}

/** Lo que se persiste: campos de visión + autoría de la lectura. */
export interface EscritoVision extends CamposVision {
  tsVision: string;
  modeloVision: string;
  visionDetalle: LecturaVision & { fnames: string[] };
}

export interface ValidacionExistente {
  tsVision?: string | null;
  visionDetalle?: { fnames?: string[] } | null;
}

export interface DepsAnaliza {
  /** Bytes de la foto, o null si el objeto no existe en S3 (copia tolerante a fallo). */
  bajaFoto(fname: string): Promise<Buffer | null>;
  /** Una sola llamada a Bedrock con tool use forzado; devuelve el input del tool. */
  llamaBedrock(prompt: VisionPrompt, imagenes: ImagenPreparada[]): Promise<LecturaVision>;
  leeValidacion(loadId: string): Promise<ValidacionExistente | null>;
  /** Update/create parcial: SOLO campos de visión, jamás veredicto. */
  escribeVision(loadId: string, campos: EscritoVision): Promise<void>;
  ahora(): string;
  modelo: string;
}

export interface ResultadoAnalisis {
  estado: "analizada" | "skip" | "sin-fotos";
  faltantes: string[];
}

const CAMPOS_FOTO = ["fotoTicket", "fotoBomba", "fotoAntes", "fotoDespues"] as const;

function llaveFnames(fnames: string[]): string {
  return [...fnames].sort().join("|");
}

export async function analizaCarga(
  evento: EventoVision,
  deps: DepsAnaliza,
): Promise<ResultadoAnalisis> {
  const entradas = CAMPOS_FOTO.filter((c) => evento.fnames[c]).map((c) => ({
    campo: c,
    fname: evento.fnames[c] as string,
  }));

  // Idempotencia: misma lectura ya hecha sobre el mismo set de fotos → skip.
  const existente = await deps.leeValidacion(evento.loadId);
  if (
    existente?.tsVision &&
    llaveFnames(existente.visionDetalle?.fnames ?? []) === llaveFnames(entradas.map((e) => e.fname))
  ) {
    return { estado: "skip", faltantes: [] };
  }

  // Bajar y reescalar lo que sí existe; lo ausente se estampa "faltante" en la fusión.
  const faltantes: string[] = [];
  const presentes: { campo: string; imagen: ImagenPreparada }[] = [];
  for (const { campo, fname } of entradas) {
    const bytes = await deps.bajaFoto(fname);
    if (!bytes) {
      faltantes.push(campo);
      continue;
    }
    presentes.push({ campo, imagen: await preparaImagen(bytes) });
  }

  if (!presentes.length) return { estado: "sin-fotos", faltantes };

  const prompt = buildVisionPrompt(presentes.map((p) => p.campo));
  const lectura = await deps.llamaBedrock(
    prompt,
    presentes.map((p) => p.imagen),
  );

  const campos = fusionaLectura(lectura, faltantes);
  await deps.escribeVision(evento.loadId, {
    ...campos,
    tsVision: deps.ahora(),
    modeloVision: deps.modelo,
    visionDetalle: { ...campos.visionDetalle, fnames: entradas.map((e) => e.fname) },
  });

  return { estado: "analizada", faltantes };
}
