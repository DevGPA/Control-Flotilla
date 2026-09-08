// Capa PURA del portal del proveedor: los topes del Plan 1, la generación de
// la llave de S3 y la validación de lo que manda el taller. Nada aquí toca
// AWS ni módulos virtuales de Amplify — por diseño, para que
// tests/tallerPortalHandler.test.ts pueda importar este módulo sin necesitar
// un backend real ni un alias de bundler. `handler.ts` (el punto de entrada
// I/O: rutas, cliente AppSync por IAM, S3) importa de aquí lo que necesita.

export const MIMES_FOTO = ["image/jpeg", "image/png", "image/webp"] as const;
export const TOPE_FOTOS_PARTIDA = 6;
export const TOPE_PARTIDAS_VISITA = 60;
// 10 MB — tope de bytes por foto subida (spec §7.3): sin esto, una liga
// válida podría empujar archivos sin límite hacia el bucket de producción
// mientras el token siga vigente.
export const TOPE_BYTES_FOTO = 10 * 1024 * 1024;
const LARGO_DESCRIPCION = 500;
const PRECIO_MAX = 10_000_000;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Error de ENTRADA: el dato lo mandó el cliente y el mensaje describe qué
 * tiene mal (precio, tipo, mime, tope...). Es seguro devolverlo tal cual en
 * un 400 — no describe infraestructura.
 *
 * Cualquier otro error (fallo de GraphQL, S3, excepción no prevista) NO se
 * expone: se registra completo en la bitácora y el cliente recibe un 500
 * genérico. Sin esta distinción, un error de AppSync (que puede traer
 * nombres de tabla/campo) se filtraría tal cual al proveedor externo.
 */
export class ErrorEntrada extends Error {}

/** Un segmento seguro de ruta S3: sin barras, sin puntos dobles, acotado. */
export function segmento(s: string): string {
  return String(s)
    .replace(/[^A-Za-z0-9_.:@+-]/g, "_")
    .replace(/\.{2,}/g, "_")
    .slice(0, 120);
}

export function llaveFoto(tenantId: string, visitaKey: string, uuid: string, mime: string): string {
  const ext = EXT[mime];
  if (!ext) throw new Error(`Tipo de archivo no permitido: ${mime}`);
  return `photos/${segmento(tenantId)}/taller-partidas/${segmento(visitaKey)}/${segmento(uuid)}.${ext}`;
}

export type PartidaEntrante = {
  descripcion: string;
  tipo: "refaccion" | "manoObra";
  precio: number;
};

export function validarPartidaEntrante(body: unknown): PartidaEntrante {
  const b = (body ?? {}) as Record<string, unknown>;

  const descripcion = String(b.descripcion ?? "")
    .trim()
    .slice(0, LARGO_DESCRIPCION);
  if (!descripcion) throw new ErrorEntrada("La descripción del hallazgo es obligatoria");

  const tipo = b.tipo;
  if (tipo !== "refaccion" && tipo !== "manoObra") {
    throw new ErrorEntrada(`Tipo no válido: ${String(tipo)}`);
  }

  const precio = b.precio;
  if (typeof precio !== "number" || !Number.isFinite(precio) || precio < 0 || precio > PRECIO_MAX) {
    throw new ErrorEntrada(`Precio no válido: ${String(precio)}`);
  }

  // Nada más se toma del cliente: el estado, la autoría y las fechas los pone
  // el servidor. Un cliente NO puede mandar una partida ya autorizada.
  return { descripcion, tipo, precio };
}

/**
 * El tamaño declarado de una foto ANTES de firmar su URL de subida. El límite
 * es real (§7.3): sin él, cualquiera con una liga vigente podría empujar
 * archivos de tamaño arbitrario al bucket de producción mientras el token
 * no expire. Se valida ANTES de emitir la URL prefirmada — nunca después —
 * y el valor validado se firma como ContentLength exacto en el PUT: S3
 * rechaza cualquier subida cuyo tamaño real no coincida.
 */
export function validarTamanoFoto(tamano: unknown): number {
  if (typeof tamano !== "number" || !Number.isInteger(tamano) || tamano <= 0) {
    throw new ErrorEntrada(`Tamaño de archivo no válido: ${String(tamano)}`);
  }
  if (tamano > TOPE_BYTES_FOTO) {
    throw new ErrorEntrada(`El archivo excede el máximo de ${TOPE_BYTES_FOTO} bytes`);
  }
  return tamano;
}
