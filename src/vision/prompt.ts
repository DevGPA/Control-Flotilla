/**
 * Prompt y contrato de salida de la visión IA de tickets (Fase 1) — puro, sin AWS.
 *
 * Decisiones de diseño (no re-litigar sin leer el plan):
 *  - La IA lee A CIEGAS: buildVisionPrompt no acepta los valores capturados — el sesgo
 *    de confirmación queda imposible por construcción. La comparación es de código.
 *  - Salida por tool use FORZADO con strict: la respuesta valida contra el shape que
 *    fusion.ts espera (LecturaVision), sin parseo heurístico.
 *  - "faltante" no existe para el modelo (lo estampa el código si la foto no está en S3);
 *    el modelo solo puede decir ok | ilegible | no-corresponde.
 */

/** Etiqueta en español con la que se presenta cada foto al modelo. */
export const ETIQUETA_FOTO: Record<string, string> = {
  fotoTicket: "ticket de la gasolinera",
  fotoBomba: "display de la bomba (dispensario)",
  fotoAntes: "medidor de combustible ANTES de la carga",
  fotoDespues: "medidor de combustible DESPUÉS de la carga",
};

const ESTADOS = ["ok", "ilegible", "no-corresponde"];
const NIVELES = ["lleno", "3/4", "1/2", "1/4", "vacío", null];

const NUM_NULABLE = { type: ["number", "null"] };

/** Sub-schema de una evidencia con montos (ticket / bomba). */
const MONTOS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["monto", "litros", "precioLitro", "fecha", "confianza", "estado"],
  properties: {
    monto: { ...NUM_NULABLE, description: "Total en MXN, o null si no se lee" },
    litros: NUM_NULABLE,
    precioLitro: NUM_NULABLE,
    fecha: {
      type: ["string", "null"],
      description: "Fecha impresa TAL CUAL se ve (p.ej. 04/06/2026); null si no se lee",
    },
    confianza: { type: "number", minimum: 0, maximum: 1 },
    estado: { type: "string", enum: ESTADOS },
  },
};

/** Sub-schema del medidor de tanque (antes / después). */
const NIVEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["nivel", "confianza", "estado"],
  properties: {
    nivel: { enum: NIVELES, description: "Nivel de la aguja; null si no se distingue" },
    confianza: { type: "number", minimum: 0, maximum: 1 },
    estado: { type: "string", enum: ESTADOS },
  },
};

/** Tool que el modelo está FORZADO a llamar (tool_choice en el handler). */
export const TOOL_LECTURA = {
  name: "registrar_lectura",
  description:
    "Registra la lectura estructurada de las fotos de una carga de combustible. " +
    "Incluye SOLO las evidencias cuya foto recibiste.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [],
    properties: {
      ticket: MONTOS_SCHEMA,
      bomba: MONTOS_SCHEMA,
      tanqueAntes: NIVEL_SCHEMA,
      tanqueDespues: NIVEL_SCHEMA,
      notas: {
        type: "string",
        description: "Observaciones breves (tachaduras, foto movida, ticket parcial)",
      },
    },
  },
} as const;

export interface VisionPrompt {
  system: string;
  /** Texto que acompaña a las imágenes (cada imagen va precedida de su etiqueta). */
  texto: string;
}

/**
 * Construye el prompt para las fotos PRESENTES (nombres de campo: "fotoTicket", ...).
 * Deliberadamente NO recibe los valores capturados — lectura a ciegas.
 */
export function buildVisionPrompt(fotosPresentes: string[]): VisionPrompt {
  const lista = fotosPresentes
    .filter((c) => ETIQUETA_FOTO[c])
    .map((c, i) => `Foto ${i + 1}: ${ETIQUETA_FOTO[c]}`)
    .join("\n");

  return {
    system:
      "Eres un lector de evidencias de cargas de combustible de una flotilla en México. " +
      "Lees tickets de gasolinera (a menudo térmicos y borrosos), displays de bomba y " +
      "medidores de tanque. Regla dura: JAMÁS adivines — si un campo no se lee con " +
      "claridad, devuélvelo null y marca la evidencia como 'ilegible'. No inventes " +
      "valores plausibles. Reporta la fecha TAL CUAL está impresa, sin convertirla.",
    texto:
      `Recibes ${fotosPresentes.length ? "estas fotos" : "cero fotos"} de una carga:\n` +
      `${lista}\n\n` +
      "Lee cada evidencia y registra la lectura con la herramienta registrar_lectura. " +
      "Si una foto no corresponde a lo que dice su etiqueta (p.ej. es una selfie), " +
      "marca esa evidencia como 'no-corresponde'. No adivines ningún valor.",
  };
}
