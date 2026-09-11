// Lógica PURA del módulo de Administración de Usuarios (2026-06-12).
// Sin AWS SDK ni imports de $amplify → importable por el handler Y por los
// tests de vitest (mismo patrón que src/api/mergeCheckDones.ts). El handler
// (handler.ts) hace el I/O contra Cognito/DynamoDB; aquí vive lo testeable.

export const ALLOWED_DOMAIN = "gpa.com.mx";
export const ROLES = ["admin", "operativo", "viewer"] as const;
export type Rol = (typeof ROLES)[number];

/**
 * CREDENCIALES (Task 14): grupos Cognito que NO son roles. Una credencial es
 * ADITIVA — se suma al rol de la persona (p. ej. `operativo` + `riesgos`) y
 * habilita una capacidad puntual, sin abrir nada más. `riesgos` habilita
 * exactamente emitir y revocar la liga del proveedor de Taller (spec §7.7,
 * decisión 20).
 *
 * NO va en ROLES a propósito, y de ahí salen tres propiedades que importan:
 *  1. El panel de usuarios es de UN solo rol (`isValidRol`), así que `riesgos`
 *     no es asignable desde ahí — se asigna en la consola de Cognito.
 *  2. `setUserRole` (handler.ts) solo quita grupos de ROLES al cambiar de rol,
 *     así que la credencial SOBREVIVE un cambio de rol hecho desde el panel.
 *  3. Pero la derivación del tenant ("el grupo que no es un rol") SÍ tiene que
 *     conocerla — ver `esGrupoDeTenant`.
 */
export const CREDENCIALES = ["riesgos"] as const;

/**
 * ¿Este grupo Cognito es el TENANT del usuario? El tenant del proyecto ES el
 * nombre de un grupo (allow.groupDefinedIn("tenantId")), y cuando el idToken no
 * trae `custom:tenantId` se deriva por descarte. El descarte tiene que excluir
 * TODO grupo que no sea tenant: los roles Y las credenciales. Si `riesgos` no
 * se excluyera, a la persona de Riesgos se le derivaría `tenantId = "riesgos"`
 * y todas sus operaciones caerían en un tenant fantasma.
 */
export function esGrupoDeTenant(grupo: string): boolean {
  return (
    !(ROLES as readonly string[]).includes(grupo) &&
    !(CREDENCIALES as readonly string[]).includes(grupo)
  );
}

/** Tenant derivado de `cognito:groups` por descarte; "" si no hay ninguno. */
export function derivarTenantDeGrupos(grupos: readonly string[]): string {
  return grupos.find((g) => esGrupoDeTenant(g)) ?? "";
}

export function normalizeEmail(email: unknown): string {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

export function isAllowedDomain(email: string): boolean {
  return normalizeEmail(email).endsWith(`@${ALLOWED_DOMAIN}`);
}

export function isValidRol(rol: unknown): rol is Rol {
  return (ROLES as readonly string[]).includes(String(rol));
}

export type CreateInput = {
  email?: unknown;
  nombre?: unknown;
  telefono?: unknown;
  rol?: unknown;
  sucursal?: unknown;
};

/** Valida el alta de usuario. Devuelve errores legibles (en español) para el front. */
export function validateCreateInput(input: CreateInput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const email = normalizeEmail(input.email);
  if (!email) errors.push("El correo es obligatorio.");
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    errors.push("El correo no tiene un formato válido.");
  else if (!isAllowedDomain(email))
    errors.push(`El correo debe ser del dominio @${ALLOWED_DOMAIN}.`);
  if (!String(input.nombre ?? "").trim()) errors.push("El nombre es obligatorio.");
  if (!isValidRol(input.rol)) errors.push(`El rol debe ser uno de: ${ROLES.join(", ")}.`);
  return { valid: errors.length === 0, errors };
}

/** Teléfono opcional: si viene, debe ser E.164 (+52...) o vacío. */
export function validateTelefono(tel: unknown): boolean {
  const t = String(tel ?? "").trim();
  return t === "" || /^\+?[1-9]\d{7,14}$/.test(t.replace(/[\s()-]/g, ""));
}

/**
 * Construye el evento de auditoría. `now` e `idSuffix` se inyectan para que la
 * función sea pura/testeable (sin Date.now ni random internos). El id combina
 * timestamp + sufijo para ser único y ordenable.
 */
export function buildAuditEvent(opts: {
  tenantId: string;
  actor: string;
  accion: string;
  targetUser?: string;
  diff?: unknown;
  ip?: string;
  now: string;
  idSuffix: string;
}): {
  tenantId: string;
  id: string;
  actor: string;
  accion: string;
  targetUser: string;
  detalleCambios: string;
  ip: string;
  timestamp: string;
} {
  return {
    tenantId: opts.tenantId,
    id: `${opts.now}#${opts.idSuffix}`,
    actor: opts.actor,
    accion: opts.accion,
    targetUser: opts.targetUser ?? "",
    detalleCambios: JSON.stringify(opts.diff ?? {}),
    ip: opts.ip ?? "",
    timestamp: opts.now,
  };
}

/** Campos del perfil que se auditan en una edición. */
const PROFILE_FIELDS = ["nombre", "telefono", "sucursal", "rol", "modulos", "estatus"] as const;

/** Diff de perfil para la bitácora: { campo: { de, a } } solo de lo que cambió. */
export function diffUserProfile(
  prev: Record<string, unknown> | null | undefined,
  next: Record<string, unknown>,
): Record<string, { de: unknown; a: unknown }> {
  const out: Record<string, { de: unknown; a: unknown }> = {};
  for (const f of PROFILE_FIELDS) {
    const before = prev?.[f];
    const after = next[f];
    if (after !== undefined && String(before ?? "") !== String(after ?? "")) {
      out[f] = { de: before ?? null, a: after };
    }
  }
  return out;
}

/** Mapea errores de Cognito (por su `name`) a mensajes limpios en español. */
export function mapCognitoError(err: unknown): string {
  const name = (err as { name?: string })?.name ?? "";
  switch (name) {
    case "UsernameExistsException":
      return "Ya existe un usuario con ese correo.";
    case "UserNotFoundException":
      return "El usuario no existe o ya fue eliminado.";
    case "NotAuthorizedException":
      return "Operación no autorizada.";
    case "LimitExceededException":
      return "Se alcanzó el límite de intentos. Espera unos minutos e inténtalo de nuevo.";
    case "InvalidParameterException":
      return "Alguno de los datos enviados no es válido.";
    case "InvalidPasswordException":
      return "La contraseña no cumple la política de seguridad.";
    case "TooManyRequestsException":
      return "Demasiadas solicitudes. Espera un momento.";
    default:
      return "Ocurrió un error al procesar la solicitud en el servidor de identidad.";
  }
}
