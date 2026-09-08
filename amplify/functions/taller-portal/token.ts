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
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ErrorToken("firma-invalida");

  let payload: PortalToken;
  try {
    payload = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8")) as PortalToken;
  } catch {
    throw new ErrorToken("malformado");
  }

  if (!payload || typeof payload !== "object" || !payload.t || !payload.u || !payload.f) {
    throw new ErrorToken("malformado");
  }
  if (typeof payload.exp !== "number" || payload.exp <= ahora) throw new ErrorToken("expirado");
  // El alcance por partida (recotización) llega en el Plan 2. Rechazarlo
  // explícitamente es más seguro que ignorar el campo y servir la visita completa.
  if (payload.p) throw new ErrorToken("alcance-no-soportado");

  return payload;
}
