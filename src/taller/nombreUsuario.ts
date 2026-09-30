/**
 * "Emitida por": el nombre, nunca el id (spec 2026-09-30 §4.7). Capa PURA.
 *
 * `ligaCreadaPor`/`ligaRevocadaPor` guardan hoy el `sub` de Cognito (medido en prod
 * 2026-09-30), a veces `"desconocido"`, `cierre:<correo>` (liga-cierre) o incluso texto
 * libre de una revocación manual. Las firmas guardan el correo. Todo entra aquí y sale
 * legible. Un GUID jamás llega al DOM: ni en el texto ni en un `title`.
 */
export type EntradaDirectorio = { cognitoSub: string; email: string; nombre?: string | null };
/** Clave = cognitoSub. */
export type Directorio = ReadonlyMap<string, EntradaDirectorio>;
export type Yo = { sub: string | null; email: string | null };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORREO = /^[^\s@]+@[^\s@]+$/;
const RESPALDO = "un usuario de GPA";

export function esGuid(s: string): boolean {
  return GUID.test(String(s ?? "").trim());
}

const sinDominio = (correo: string): string => correo.split("@")[0] ?? correo;

function buscar(directorio: Directorio | null, crudo: string): EntradaDirectorio | null {
  if (!directorio) return null;
  const porSub = directorio.get(crudo);
  if (porSub) return porSub;
  const c = crudo.toLowerCase();
  for (const e of directorio.values()) {
    if ((e.email ?? "").toLowerCase() === c) return e;
  }
  return null;
}

/** nombre → correo sin dominio → "tú" → "un usuario de GPA". */
export function nombreDeUsuario(
  crudo: string | null | undefined,
  directorio: Directorio | null,
  yo: Yo,
): string {
  const c = String(crudo ?? "").trim();
  if (!c || c === "desconocido") return RESPALDO;
  const soyYo =
    (!!yo.sub && c === yo.sub) || (!!yo.email && c.toLowerCase() === yo.email.toLowerCase());
  const entrada = buscar(directorio, c);
  const nombre = String(entrada?.nombre ?? "").trim();
  if (nombre) return soyYo ? `${nombre} (tú)` : nombre;
  const correo = CORREO.test(c) ? c : String(entrada?.email ?? "");
  if (correo && CORREO.test(correo)) {
    const corto = sinDominio(correo);
    return soyYo ? `${corto} (tú)` : corto;
  }
  if (soyYo) return "tú";
  return RESPALDO;
}

/** `cierre:<quien>` ⇒ "Se cerró junto con la visita (quien)"; `cierre:desconocido` ⇒ sin nombre. */
export function describirRevocadaPor(
  crudo: string | null | undefined,
  directorio: Directorio | null,
  yo: Yo,
): { porCierre: boolean; nombre: string | null } {
  const c = String(crudo ?? "").trim();
  if (c.startsWith("cierre:")) {
    const resto = c.slice("cierre:".length).trim();
    if (!resto || resto === "desconocido") return { porCierre: true, nombre: null };
    return { porCierre: true, nombre: nombreDeUsuario(resto, directorio, yo) };
  }
  return { porCierre: false, nombre: nombreDeUsuario(c, directorio, yo) };
}
