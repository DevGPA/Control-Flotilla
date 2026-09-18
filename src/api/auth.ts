// Wrapper sobre Amplify Auth. Expone helpers: login/logout/isLoggedIn/tenantId.
//
// tenantId viene del custom attribute `custom:tenantId` del usuario Cognito.
// Lo seteamos manualmente al crear el user (admin via Cognito Console).
// Si falta o el user no está en el group correspondiente, todas las queries
// GraphQL rechazan por authorization (allow.groupDefinedIn('tenantId')).

import {
  signIn,
  signOut,
  getCurrentUser,
  fetchUserAttributes,
  fetchAuthSession,
  confirmSignIn,
  resetPassword,
  confirmResetPassword,
  type SignInInput,
} from "aws-amplify/auth";
import { clearPhotoCache } from "./photoFetch";
import { parseModulos } from "./moduleAccess";

export interface AuthSession {
  username: string;
  email: string;
  tenantId: string;
  groups: string[];
  /** Sucursal del atributo custom:sucursal (filtro de UI del rol viewer). */
  sucursal?: string;
  /**
   * Módulos permitidos (de custom:modulos). `undefined`/`null` = todos (sin
   * asignación). Gating de UI; el dato sigue protegido por tenant+rol+sucursal.
   */
  modulos?: import("./moduleAccess").ModuleKey[] | null;
}

export type LoginResult =
  | { status: "success" }
  | { status: "requireNewPassword" }
  /** Cognito dejó la cuenta pendiente de restablecer: toca código + nueva. */
  | { status: "requireReset" }
  | { status: "error"; message: string };

/** Resultado de las acciones de recuperación (sin pasos intermedios). */
export type AccionResult = { status: "success" } | { status: "error"; message: string };

/**
 * Traduce los errores de Cognito a algo que una persona pueda accionar.
 *
 * Los mensajes del SDK vienen en inglés y de vuelta con jerga ("Password reset
 * required for the user"); el modal los escupía tal cual y dejaba al usuario sin
 * saber qué hacer. Lo que NO se reconoce se devuelve tal cual: es preferible un
 * mensaje feo a uno genérico que esconda la causa real.
 */
function mensajeAuth(e: unknown): string {
  const err = e as { name?: string; message?: string };
  switch (err?.name) {
    case "NotAuthorizedException":
      return "Correo o contraseña incorrectos.";
    case "UserNotFoundException":
      return "No hay ninguna cuenta con ese correo.";
    case "UserNotConfirmedException":
      return "La cuenta aún no está confirmada. Pide al administrador que la reactive.";
    case "CodeMismatchException":
      return "El código no coincide. Revísalo o pide uno nuevo.";
    case "ExpiredCodeException":
      return "El código ya caducó. Pide uno nuevo.";
    case "InvalidPasswordException":
      return "La contraseña debe tener al menos 8 caracteres, con mayúscula, minúscula, número y un símbolo.";
    case "LimitExceededException":
    case "TooManyRequestsException":
    case "TooManyFailedAttemptsException":
      return "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.";
    default:
      return err?.message || "Error desconocido";
  }
}

/**
 * Re-canjea las credenciales del Identity Pool usando el idToken recién emitido.
 *
 * CRÍTICO (incidente fotos 2026-06-17): Amplify Storage (`getUrl`/`uploadData`) NO
 * firma con el JWT — firma SigV4 con credenciales temporales del Identity Pool. Con
 * `unauthenticated_identities_enabled=true`, Amplify v6 cachea credenciales GUEST
 * (rol unauth, SIN s3:GetObject) y las REUSA para firmar aunque el usuario ya inició
 * sesión: `fetchAuthSession` no re-canjea solo porque aparecieron tokens. Resultado:
 * las URLs de fotos se firmaban con el rol guest → S3 devolvía 403 ("No disponible").
 * `forceRefresh:true` descarta las guest cacheadas y canjea credenciales del rol
 * AUTENTICADO (con s3:GetObject) → las fotos cargan. Llamar tras CADA login exitoso.
 */
async function refreshIdentityPoolCreds(): Promise<void> {
  try {
    await fetchAuthSession({ forceRefresh: true });
  } catch {
    /* best-effort: si falla, el hydrate vuelve a intentar el refresh */
  }
}

/**
 * Login con email + password. Maneja flow de NEW_PASSWORD_REQUIRED
 * (Cognito fuerza cambio al primer login con temp password).
 *
 * Returns status; el modal decide qué UI mostrar según el resultado.
 */
export async function login(email: string, password: string): Promise<LoginResult> {
  const input: SignInInput = { username: email, password };
  try {
    const result = await signIn(input);
    if (result.isSignedIn) {
      await refreshIdentityPoolCreds();
      return { status: "success" };
    }
    if (result.nextStep.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
      return { status: "requireNewPassword" };
    }
    // Cuenta en RESET_REQUIRED. Cognito lo reporta por DOS caminos según el flujo
    // (aquí como nextStep; más abajo como excepción) — los dos llevan a la misma
    // pantalla de código, y antes los dos terminaban en un callejón sin salida.
    if (result.nextStep.signInStep === "RESET_PASSWORD") {
      return { status: "requireReset" };
    }
    return {
      status: "error",
      message: `Login incompleto. Next step: ${result.nextStep.signInStep}`,
    };
  } catch (e) {
    if ((e as { name?: string })?.name === "PasswordResetRequiredException") {
      return { status: "requireReset" };
    }
    return { status: "error", message: mensajeAuth(e) };
  }
}

/**
 * Paso 1 del autoservicio: pide a Cognito el código de un solo uso por correo.
 *
 * Un correo inexistente responde ÉXITO a propósito: contestar "esa cuenta no
 * existe" convertiría la pantalla en un detector de correos válidos para
 * cualquiera que la abra.
 */
export async function solicitarCodigoReset(email: string): Promise<AccionResult> {
  const username = email.trim().toLowerCase();
  try {
    await resetPassword({ username });
    return { status: "success" };
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === "UserNotFoundException") return { status: "success" };
    return { status: "error", message: mensajeAuth(e) };
  }
}

/** Paso 2 del autoservicio: canjea el código del correo por la contraseña nueva. */
export async function confirmarReset(
  email: string,
  codigo: string,
  nueva: string,
): Promise<AccionResult> {
  try {
    await confirmResetPassword({
      username: email.trim().toLowerCase(),
      confirmationCode: codigo.trim(),
      newPassword: nueva,
    });
    return { status: "success" };
  } catch (e) {
    return { status: "error", message: mensajeAuth(e) };
  }
}

/**
 * Completa el flow de NEW_PASSWORD_REQUIRED. Llamar inmediatamente después de
 * login() que devolvió `requireNewPassword` con la nueva password elegida.
 */
export async function confirmNewPassword(newPassword: string): Promise<LoginResult> {
  try {
    const result = await confirmSignIn({ challengeResponse: newPassword });
    if (result.isSignedIn) {
      await refreshIdentityPoolCreds();
      return { status: "success" };
    }
    return {
      status: "error",
      message: `Confirm falló. Next step: ${result.nextStep.signInStep}`,
    };
  } catch (e) {
    return { status: "error", message: mensajeAuth(e) };
  }
}

/** Cierra sesión y limpia JWT del local storage. */
export async function logout(): Promise<void> {
  await signOut();
  // Limpia el cache de URLs firmadas e índice de fotos: al loguear como otro
  // tenant en el mismo navegador no debe reusarse nada del tenant anterior.
  clearPhotoCache();
}

/** True si hay sesión Cognito válida. No throws. */
export async function isLoggedIn(): Promise<boolean> {
  try {
    await getCurrentUser();
    return true;
  } catch {
    return false;
  }
}

/**
 * Devuelve datos de sesión actual o null si no hay login.
 * Lee custom:tenantId del JWT — si falta, error explícito porque queries
 * GraphQL no van a funcionar sin él.
 */
export async function getSession(): Promise<AuthSession | null> {
  try {
    const user = await getCurrentUser();
    const attrs = await fetchUserAttributes();
    const tenantId = attrs["custom:tenantId"];
    if (!tenantId) {
      throw new Error(
        "Usuario sin custom:tenantId. Configúralo en Cognito Console → User attributes.",
      );
    }
    // Módulo Admin Usuarios (2026-06-12): los grupos (roles) viven en el JWT.
    // Se leen de cognito:groups del idToken para que el front pueda mostrar la
    // vista admin solo a quien corresponde. La autorización REAL la sigue
    // haciendo AppSync por grupo; esto es solo para la UI.
    let groups: string[] = [];
    try {
      const s = await fetchAuthSession();
      const raw = s.tokens?.idToken?.payload["cognito:groups"];
      if (Array.isArray(raw)) groups = raw.map(String);
    } catch {
      /* sin token todavía → grupos vacíos */
    }
    return {
      username: user.username,
      email: attrs.email ?? "",
      tenantId,
      groups,
      sucursal: attrs["custom:sucursal"] ?? undefined,
      modulos: parseModulos(attrs["custom:modulos"]),
    };
  } catch {
    return null;
  }
}

/** True si la sesión actual pertenece al grupo 'admin' (gate de UI). */
export async function isAdmin(): Promise<boolean> {
  const s = await getSession();
  return !!s && s.groups.includes("admin");
}

/**
 * Fuerza la renovación del idToken para que un cambio de rol/grupo recién hecho
 * sea efectivo sin esperar el ciclo natural (~1 h). Módulo Admin Usuarios.
 */
export async function forceRefreshSession(): Promise<void> {
  try {
    await fetchAuthSession({ forceRefresh: true });
  } catch {
    /* best-effort */
  }
}
