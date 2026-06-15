// Handler de las custom operations adminUsers* (módulo de Administración de
// Usuarios, 2026-06-12). Una sola Lambda respalda todas las ops; se enruta por
// event.info.fieldName. AppSync YA validó que el invocador está en el grupo
// 'admin' (ver authorization en data/resource.ts) — aquí no se re-valida el rol,
// pero sí el dominio del correo y las reglas de negocio (logic.ts).
//
// I/O: Cognito Admin API (SDK) + cliente de datos Amplify (authMode iam) para
// UserProfile y AuditEvent. La lógica pura/testeable vive en logic.ts.

import type { AppSyncResolverEvent } from "aws-lambda";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/admin-users";
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminEnableUserCommand,
  AdminDisableUserCommand,
  AdminDeleteUserCommand,
  AdminResetUserPasswordCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { Schema } from "../../data/resource";
import {
  ROLES,
  validateCreateInput,
  normalizeEmail,
  isValidRol,
  buildAuditEvent,
  diffUserProfile,
  mapCognitoError,
} from "./logic";

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID ?? "";

let configured = false;
let dataClient: ReturnType<typeof generateClient<Schema>> | null = null;
async function getDataClient() {
  if (!configured) {
    const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(
      env as unknown as Parameters<typeof getAmplifyDataClientConfig>[0],
    );
    Amplify.configure(resourceConfig, libraryOptions);
    configured = true;
  }
  if (!dataClient) dataClient = generateClient<Schema>({ authMode: "iam" });
  return dataClient;
}

// Contexto del admin que invoca, extraído del identity de AppSync (Cognito).
type Identity = {
  sub: string;
  email: string;
  tenantId: string;
  ip: string;
  groups: string[];
};
function getIdentity(event: AppSyncResolverEvent<Record<string, unknown>>): Identity {
  const id = (event.identity ?? {}) as {
    claims?: Record<string, unknown>;
    sourceIp?: string[];
  };
  const claims = id.claims ?? {};
  const groupsRaw = claims["cognito:groups"];
  const groups = Array.isArray(groupsRaw) ? (groupsRaw as string[]) : [];
  // tenant = custom:tenantId del token; si no viaja en el idToken (depende de la
  // config del app client), se deriva del grupo que NO es un rol — el tenant del
  // proyecto ES el nombre del grupo Cognito (allow.groupDefinedIn("tenantId")).
  const roleSet = new Set<string>(ROLES as readonly string[]);
  const tenantFromClaim = String(claims["custom:tenantId"] ?? "");
  const tenantFromGroup = groups.find((g) => !roleSet.has(g)) ?? "";
  return {
    sub: String(claims.sub ?? ""),
    email: String(claims.email ?? ""),
    tenantId: tenantFromClaim || tenantFromGroup,
    ip: Array.isArray(id.sourceIp) ? (id.sourceIp[0] ?? "") : "",
    groups,
  };
}

// Sufijo aleatorio para el id del AuditEvent (no en logic.ts para mantenerla pura).
function randSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function writeAudit(
  who: Identity,
  accion: string,
  targetUser: string,
  diff: unknown,
): Promise<void> {
  const client = await getDataClient();
  const ev = buildAuditEvent({
    tenantId: who.tenantId,
    actor: who.email || who.sub,
    accion,
    targetUser,
    diff,
    ip: who.ip,
    now: new Date().toISOString(),
    idSuffix: randSuffix(),
  });
  await client.models.AuditEvent.create(ev);
}

const ROLE_GROUPS = ROLES as readonly string[];

async function setUserRole(username: string, rol: string): Promise<void> {
  // Quita de todos los grupos de rol y añade al nuevo (un solo rol activo).
  for (const g of ROLE_GROUPS) {
    if (g === rol) continue;
    try {
      await cognito.send(
        new AdminRemoveUserFromGroupCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
          GroupName: g,
        }),
      );
    } catch {
      /* no estaba en ese grupo */
    }
  }
  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      GroupName: rol,
    }),
  );
}

type Ok = { ok: true; message?: string; data?: unknown };
type Err = { ok: false; error: string };

async function handleCreate(args: Record<string, unknown>, who: Identity): Promise<Ok | Err> {
  const v = validateCreateInput(args);
  if (!v.valid) return { ok: false, error: v.errors.join(" ") };
  const email = normalizeEmail(args.email);
  const rol = String(args.rol);
  const nombre = String(args.nombre ?? "").trim();
  const telefono = String(args.telefono ?? "").trim();
  const sucursal = String(args.sucursal ?? "").trim();
  try {
    const created = await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        DesiredDeliveryMediums: ["EMAIL"],
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
          { Name: "custom:tenantId", Value: who.tenantId },
          ...(sucursal ? [{ Name: "custom:sucursal", Value: sucursal }] : []),
        ],
      }),
    );
    const attrs = created.User?.Attributes ?? [];
    const sub = attrs.find((a) => a.Name === "sub")?.Value ?? created.User?.Username ?? email;
    // Grupos: tenant + rol.
    if (who.tenantId) await setGroupSafe(email, who.tenantId);
    await setUserRole(email, rol);
    const now = new Date().toISOString();
    const client = await getDataClient();
    await client.models.UserProfile.create({
      tenantId: who.tenantId,
      cognitoSub: sub,
      email,
      nombre,
      telefono,
      sucursal,
      rol,
      estatus: "activo",
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(
      who,
      "crear",
      email,
      diffUserProfile(null, { nombre, telefono, sucursal, rol }),
    );
    return {
      ok: true,
      message: "Usuario creado. Se envió la invitación por correo.",
      data: { cognitoSub: sub, email },
    };
  } catch (e) {
    return { ok: false, error: mapCognitoError(e) };
  }
}

async function setGroupSafe(username: string, group: string): Promise<void> {
  try {
    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        GroupName: group,
      }),
    );
  } catch {
    /* el grupo de tenant podría no existir como grupo Cognito; no es fatal */
  }
}

async function loadProfile(tenantId: string, cognitoSub: string) {
  const client = await getDataClient();
  const r = await client.models.UserProfile.get({ tenantId, cognitoSub });
  return r.data ?? null;
}

async function handleUpdate(args: Record<string, unknown>, who: Identity): Promise<Ok | Err> {
  const sub = String(args.cognitoSub ?? "");
  if (!sub) return { ok: false, error: "Falta el identificador del usuario." };
  const prev = await loadProfile(who.tenantId, sub);
  if (!prev) return { ok: false, error: "El perfil no existe." };
  const next = {
    nombre: args.nombre !== undefined ? String(args.nombre).trim() : prev.nombre,
    telefono: args.telefono !== undefined ? String(args.telefono).trim() : prev.telefono,
    sucursal: args.sucursal !== undefined ? String(args.sucursal).trim() : prev.sucursal,
  };
  try {
    const username = prev.email;
    await cognito.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        UserAttributes: [
          ...(next.sucursal ? [{ Name: "custom:sucursal", Value: next.sucursal }] : []),
        ],
      }),
    );
    const now = new Date().toISOString();
    const client = await getDataClient();
    await client.models.UserProfile.update({
      tenantId: who.tenantId,
      cognitoSub: sub,
      ...next,
      updatedAt: now,
    });
    await writeAudit(who, "editar", prev.email, diffUserProfile(prev, next));
    return { ok: true, message: "Usuario actualizado." };
  } catch (e) {
    return { ok: false, error: mapCognitoError(e) };
  }
}

async function handleSetEnabled(args: Record<string, unknown>, who: Identity): Promise<Ok | Err> {
  const sub = String(args.cognitoSub ?? "");
  const enabled = Boolean(args.enabled);
  const prev = await loadProfile(who.tenantId, sub);
  if (!prev) return { ok: false, error: "El perfil no existe." };
  try {
    const cmd = enabled
      ? new AdminEnableUserCommand({ UserPoolId: USER_POOL_ID, Username: prev.email })
      : new AdminDisableUserCommand({ UserPoolId: USER_POOL_ID, Username: prev.email });
    await cognito.send(cmd);
    const now = new Date().toISOString();
    const estatus = enabled ? "activo" : "desactivado";
    const client = await getDataClient();
    await client.models.UserProfile.update({
      tenantId: who.tenantId,
      cognitoSub: sub,
      estatus,
      updatedAt: now,
    });
    await writeAudit(who, enabled ? "activar" : "desactivar", prev.email, {
      estatus: { de: prev.estatus, a: estatus },
    });
    return { ok: true, message: enabled ? "Usuario reactivado." : "Usuario desactivado." };
  } catch (e) {
    return { ok: false, error: mapCognitoError(e) };
  }
}

async function handleDelete(args: Record<string, unknown>, who: Identity): Promise<Ok | Err> {
  const sub = String(args.cognitoSub ?? "");
  const prev = await loadProfile(who.tenantId, sub);
  if (!prev) return { ok: false, error: "El perfil no existe." };
  try {
    await cognito.send(
      new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: prev.email }),
    );
    // Soft-delete en el perfil (no se borra la fila: conserva la trazabilidad).
    const now = new Date().toISOString();
    const client = await getDataClient();
    await client.models.UserProfile.update({
      tenantId: who.tenantId,
      cognitoSub: sub,
      estatus: "eliminado",
      updatedAt: now,
    });
    await writeAudit(who, "eliminar", prev.email, {
      estatus: { de: prev.estatus, a: "eliminado" },
    });
    return { ok: true, message: "Usuario eliminado." };
  } catch (e) {
    return { ok: false, error: mapCognitoError(e) };
  }
}

async function handleResetPassword(
  args: Record<string, unknown>,
  who: Identity,
): Promise<Ok | Err> {
  const sub = String(args.cognitoSub ?? "");
  const prev = await loadProfile(who.tenantId, sub);
  if (!prev) return { ok: false, error: "El perfil no existe." };
  try {
    // Envía código por correo y deja al usuario en RESET_REQUIRED: deberá fijar
    // una nueva contraseña en el siguiente inicio de sesión.
    await cognito.send(
      new AdminResetUserPasswordCommand({ UserPoolId: USER_POOL_ID, Username: prev.email }),
    );
    await writeAudit(who, "reset_password", prev.email, {});
    return { ok: true, message: "Se envió el correo para restablecer la contraseña." };
  } catch (e) {
    return { ok: false, error: mapCognitoError(e) };
  }
}

async function handleSetRole(args: Record<string, unknown>, who: Identity): Promise<Ok | Err> {
  const sub = String(args.cognitoSub ?? "");
  const rol = String(args.rol ?? "");
  if (!isValidRol(rol)) return { ok: false, error: `Rol inválido. Debe ser: ${ROLES.join(", ")}.` };
  const prev = await loadProfile(who.tenantId, sub);
  if (!prev) return { ok: false, error: "El perfil no existe." };
  try {
    await setUserRole(prev.email, rol);
    const now = new Date().toISOString();
    const client = await getDataClient();
    await client.models.UserProfile.update({
      tenantId: who.tenantId,
      cognitoSub: sub,
      rol,
      updatedAt: now,
    });
    await writeAudit(who, "cambiar_rol", prev.email, { rol: { de: prev.rol, a: rol } });
    return {
      ok: true,
      message: "Rol actualizado. Será efectivo al renovarse la sesión del usuario.",
    };
  } catch (e) {
    return { ok: false, error: mapCognitoError(e) };
  }
}

async function handleList(who: Identity): Promise<Ok | Err> {
  try {
    const client = await getDataClient();
    const r = await client.models.UserProfile.list({
      filter: { tenantId: { eq: who.tenantId } },
      limit: 1000,
    });
    return { ok: true, data: r.data ?? [] };
  } catch (e) {
    return { ok: false, error: mapCognitoError(e) };
  }
}

export const handler = async (
  event: AppSyncResolverEvent<Record<string, unknown>>,
): Promise<Ok | Err> => {
  const who = getIdentity(event);
  if (!who.tenantId) return { ok: false, error: "Sesión sin tenant; no se puede operar." };
  // El nombre de la operación puede venir en distintos lugares según cómo AppSync
  // invoque la función. Probamos las ubicaciones conocidas.
  const ev = event as unknown as {
    info?: { fieldName?: string };
    fieldName?: string;
    typeName?: string;
  };
  const field = event.info?.fieldName ?? ev.fieldName ?? "";
  const args = (event.arguments ?? {}) as Record<string, unknown>;
  switch (field) {
    case "adminCreateUser":
      return handleCreate(args, who);
    case "adminUpdateUser":
      return handleUpdate(args, who);
    case "adminSetEnabled":
      return handleSetEnabled(args, who);
    case "adminDeleteUser":
      return handleDelete(args, who);
    case "adminResetPassword":
      return handleResetPassword(args, who);
    case "adminSetRole":
      return handleSetRole(args, who);
    case "adminListUsers":
      return handleList(who);
    default:
      return { ok: false, error: `Operación no reconocida: ${field}` };
  }
};
