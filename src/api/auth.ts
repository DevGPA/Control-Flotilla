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
  confirmSignIn,
  type SignInInput,
} from "aws-amplify/auth";
import { clearPhotoCache } from "./photoFetch";

export interface AuthSession {
  username: string;
  email: string;
  tenantId: string;
  groups: string[];
}

export type LoginResult =
  | { status: "success" }
  | { status: "requireNewPassword" }
  | { status: "error"; message: string };

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
    if (result.isSignedIn) return { status: "success" };
    if (result.nextStep.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
      return { status: "requireNewPassword" };
    }
    return {
      status: "error",
      message: `Login incompleto. Next step: ${result.nextStep.signInStep}`,
    };
  } catch (e) {
    return { status: "error", message: (e as Error).message || "Error desconocido" };
  }
}

/**
 * Completa el flow de NEW_PASSWORD_REQUIRED. Llamar inmediatamente después de
 * login() que devolvió `requireNewPassword` con la nueva password elegida.
 */
export async function confirmNewPassword(newPassword: string): Promise<LoginResult> {
  try {
    const result = await confirmSignIn({ challengeResponse: newPassword });
    if (result.isSignedIn) return { status: "success" };
    return {
      status: "error",
      message: `Confirm falló. Next step: ${result.nextStep.signInStep}`,
    };
  } catch (e) {
    return { status: "error", message: (e as Error).message || "Error desconocido" };
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
    // Groups vienen del JWT — no en fetchUserAttributes directamente. Sin embargo,
    // el client GraphQL usa el JWT raw (groups incluidos) para authorization rules.
    // Aquí los exponemos como array vacío (no críticos para el wire). Si necesitamos
    // verificar groups en cliente, leer JWT via fetchAuthSession().tokens.idToken.payload['cognito:groups'].
    return {
      username: user.username,
      email: attrs.email ?? "",
      tenantId,
      groups: [],
    };
  } catch {
    return null;
  }
}
