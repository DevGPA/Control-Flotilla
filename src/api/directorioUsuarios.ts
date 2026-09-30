/**
 * Directorio de usuarios para "Emitida por NOMBRE" (spec 2026-09-30 §4.7).
 *
 * Lee `UserProfile` del tenant UNA vez por sesión, con el selectionSet mínimo, paginando.
 * Cualquier miembro del tenant puede leerlo (`allow.groupDefinedIn("tenantId").to(["read"])`,
 * amplify/data/resource.ts): la misma regla que ya le deja ver el Taller. PASIVA: usa la
 * sesión que exista y NUNCA pide login (B-I5: el login encima del modal). Si falla, se calla
 * y la pantalla queda con el respaldo "un usuario de GPA".
 */
import { getCurrentUser } from "aws-amplify/auth";
import { getClient } from "./amplifyClient";
import type { Directorio, EntradaDirectorio, Yo } from "../taller/nombreUsuario";

let promesa: Promise<Directorio | null> | null = null;
let cache: Directorio | null = null;
let yo: Yo = { sub: null, email: null };

export function directorioEnCache(): Directorio | null {
  return cache;
}

export function yoEnCache(): Yo {
  return yo;
}

/** El sub sale de `getCurrentUser().userId` (como __crearPartidaManual, src/main.ts); el
 *  correo, de la sesión. Sin sesión ⇒ {null, null}. */
export async function yoActual(): Promise<Yo> {
  const s = window.__cloudSession;
  const email = s?.email || s?.username || null;
  let sub: string | null = null;
  try {
    sub = s ? (await getCurrentUser()).userId : null;
  } catch {
    sub = null;
  }
  yo = { sub, email };
  return yo;
}

type FilaPerfil = { cognitoSub?: string | null; email?: string | null; nombre?: string | null };

export function cargarDirectorio(): Promise<Directorio | null> {
  if (promesa) return promesa;
  promesa = (async (): Promise<Directorio | null> => {
    const tenantId = window.__cloudSession?.tenantId;
    if (!tenantId) return null;
    try {
      const c = getClient();
      const mapa = new Map<string, EntradaDirectorio>();
      let token: string | null = null;
      let pages = 0;
      do {
        const r: { data?: FilaPerfil[] | null; nextToken?: string | null; errors?: unknown[] } =
          await c.models.UserProfile.list({
            filter: { tenantId: { eq: tenantId } },
            limit: 1000,
            nextToken: token ?? undefined,
            selectionSet: ["cognitoSub", "email", "nombre"],
          });
        if (r.errors && r.errors.length) return null;
        for (const u of (r.data ?? []) as FilaPerfil[]) {
          if (!u.cognitoSub) continue;
          mapa.set(u.cognitoSub, {
            cognitoSub: u.cognitoSub,
            email: u.email ?? "",
            nombre: u.nombre ?? null,
          });
        }
        token = r.nextToken ?? null;
        pages++;
      } while (token && pages < 100);
      cache = mapa;
      return mapa;
    } catch {
      return null;
    }
  })().then((d) => {
    // Si falló, la próxima apertura del registro puede volver a intentarlo.
    if (d === null) promesa = null;
    return d;
  });
  return promesa;
}
