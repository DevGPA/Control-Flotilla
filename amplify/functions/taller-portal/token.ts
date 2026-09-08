// Token de la liga del proveedor. La AUTENTICACIÓN ES LA FIRMA: sin secreto
// configurado no se valida nada (fail-closed, igual que opsgpa-receptor).
// El token NO se guarda en la base: se verifica por firma y se revoca subiendo
// `ligaVersion` en el registro de la visita.

import { createHmac, timingSafeEqual } from "node:crypto";

export const VIGENCIA_LIGA_MS = 90 * 24 * 60 * 60 * 1000;

export type PortalToken = {
  /** tenantId */
  t: string;
  /** unitUid */
  u: string;
  /** fechaEntrada */
  f: string;
  /** ligaVersion — subirla en la visita revoca todos los tokens anteriores */
  v: number;
  /** epoch ms */
  exp: number;
  /** partidaId: alcance de recotización. Plan 2. */
  p?: string;
};

export type MotivoToken =
  | "sin-secreto"
  | "malformado"
  | "firma-invalida"
  | "expirado"
  | "alcance-no-soportado";

export class ErrorToken extends Error {
  motivo: MotivoToken;
  constructor(motivo: MotivoToken) {
    super(`Token inválido: ${motivo}`);
    this.name = "ErrorToken";
    this.motivo = motivo;
  }
}

function firma(cuerpo: string, secreto: string): string {
  return createHmac("sha256", secreto).update(cuerpo).digest("base64url");
}

export function firmarToken(payload: PortalToken, secreto: string): string {
  if (!secreto) throw new ErrorToken("sin-secreto");
  const cuerpo = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${cuerpo}.${firma(cuerpo, secreto)}`;
}

export function verificarToken(
  token: string,
  secreto: string,
  ahora: number = Date.now(),
): PortalToken {
  if (!secreto) throw new ErrorToken("sin-secreto");

  const partes = String(token || "").split(".");
  if (partes.length !== 2 || !partes[0] || !partes[1]) throw new ErrorToken("malformado");
  const [cuerpo, dada] = partes;

  const esperada = firma(cuerpo, secreto);
  const a = Buffer.from(dada, "utf8");
  const b = Buffer.from(esperada, "utf8");
  // El chequeo de longitud va PRIMERO: timingSafeEqual LANZA con longitudes
  // distintas, así que sin él una firma forjada escapa como RangeError en vez
  // de rechazarse como ErrorToken.
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ErrorToken("firma-invalida");

  let payload: PortalToken;
  try {
    payload = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8")) as PortalToken;
  } catch {
    throw new ErrorToken("malformado");
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.t !== "string" ||
    !payload.t ||
    typeof payload.u !== "string" ||
    !payload.u ||
    typeof payload.f !== "string" ||
    !payload.f
  ) {
    throw new ErrorToken("malformado");
  }
  // `v` (ligaVersion) es el ÚNICO mecanismo de revocación: el token no se
  // guarda en la base, así que subir `v` en la visita es la forma de invalidar
  // ligas ya emitidas. JSON.stringify omite las claves `undefined`, así que un
  // payload firmado sin `v` numérico debe rechazarse aquí — no dejar que la
  // ambigüedad (¿"sin versión" cuenta como vigente?) la resuelva quien llame.
  if (typeof payload.v !== "number" || !Number.isFinite(payload.v)) {
    throw new ErrorToken("malformado");
  }
  if (typeof payload.exp !== "number" || payload.exp <= ahora) throw new ErrorToken("expirado");
  // El alcance por partida (recotización) llega en el Plan 2. Rechazarlo
  // explícitamente es más seguro que ignorar el campo y servir la visita completa.
  if (payload.p) throw new ErrorToken("alcance-no-soportado");

  return payload;
}
