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
export const LARGO_DESCRIPCION = 500;
export const PRECIO_MAX = 10_000_000;

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

/**
 * ligaVersion es el ÚNICO interruptor de revocación: el token de la liga no
 * se guarda en la base, así que subir esta columna en la visita es la forma
 * de invalidar ligas ya emitidas. Comparación SIEMPRE !==, nunca < — no es
 * un contador donde "menor o igual" tenga sentido; es un interruptor, y
 * cualquier desajuste (para arriba o para abajo) es revocación.
 *
 * Un valor AUSENTE en la columna (visita sobre la que nunca se emitió
 * ninguna liga, o emitida antes de que existiera esta columna) se trata
 * como versión 1 — el mismo valor con el que Task 11 estampará el primer
 * token de cada visita. Explícito aquí, con su propia prueba, en vez de un
 * fallback suelto en el punto de lectura.
 */
export function ligaRevocada(ligaVersionActual: unknown, tk: { v: number }): boolean {
  const actual = typeof ligaVersionActual === "number" ? ligaVersionActual : 1;
  return actual !== tk.v;
}

const EXTENSIONES_FOTO = "jpg|png|webp";

/**
 * Verifica la FORMA COMPLETA de una llave de foto que manda el cliente (no
 * solo el prefijo): el prefijo exacto de esta visita, seguido de UN SOLO
 * segmento (sin más "/") que respete el charset y el tope de longitud que
 * produce segmento(), sin ".." en la cola, y terminado en una de las tres
 * extensiones permitidas — nunca la que el cliente diga por fuera.
 *
 * Sin esto, un startsWith() a secas deja pasar una cola con ".." (una
 * forma que el generador jamás produce, pero que igual queda escrita en
 * fotos para que la rendericen tareas futuras) y colas sin tope de
 * longitud (seis de esas pueden acercarse al límite de 400 KB por item de
 * DynamoDB).
 */
export function llaveFotoValida(tenantId: string, visitaKey: string, key: string): boolean {
  const prefijo = `photos/${segmento(tenantId)}/taller-partidas/${segmento(visitaKey)}/`;
  if (!key.startsWith(prefijo)) return false;
  const cola = key.slice(prefijo.length);
  if (cola.includes("..")) return false;
  return new RegExp(`^[A-Za-z0-9_.:@+-]{1,120}\\.(?:${EXTENSIONES_FOTO})$`).test(cola);
}

/**
 * §8.2: se puede subir fotos y capturar hallazgos desde el minuto uno, pero
 * NO se puede mandar la visita a autorización sin kilometraje ni fecha
 * estimada de salida. Espejo SERVIDOR de la regla que ya deshabilita el
 * botón "Enviar a autorización" en la página (Tarea 6): el botón es
 * cortesía de UI, esto es lo que de verdad lo impide.
 *
 * `km` puede llegar como número o como string numérico según el origen del
 * dato (mismo caso que ya normaliza actualizarVisita en handler.ts), asi
 * que se acepta cualquiera de los dos siempre que sea finito y positivo.
 */
export function puedeEnviarAAutorizacion(v: { km?: unknown; fsalidaEst?: unknown }): boolean {
  const km = typeof v.km === "number" ? v.km : Number(v.km);
  return (
    Number.isFinite(km) && km > 0 && typeof v.fsalidaEst === "string" && v.fsalidaEst.length > 0
  );
}
