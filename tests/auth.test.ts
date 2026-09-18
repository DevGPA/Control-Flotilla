import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock de Amplify Auth. Verificamos el FIX del incidente fotos 2026-06-17: tras un
// login exitoso, auth.ts debe forzar el re-canje de credenciales del Identity Pool
// (fetchAuthSession {forceRefresh:true}) para descartar las credenciales GUEST
// cacheadas que hacían que getUrl firmara las fotos con el rol unauth → S3 403.
const signInMock = vi.fn();
const confirmSignInMock = vi.fn();
const fetchAuthSessionMock = vi.fn();
const resetPasswordMock = vi.fn();
const confirmResetPasswordMock = vi.fn();
vi.mock("aws-amplify/auth", () => ({
  signIn: (...a: unknown[]) => signInMock(...a),
  confirmSignIn: (...a: unknown[]) => confirmSignInMock(...a),
  fetchAuthSession: (...a: unknown[]) => fetchAuthSessionMock(...a),
  resetPassword: (...a: unknown[]) => resetPasswordMock(...a),
  confirmResetPassword: (...a: unknown[]) => confirmResetPasswordMock(...a),
  signOut: vi.fn(),
  getCurrentUser: vi.fn(),
  fetchUserAttributes: vi.fn(),
}));
vi.mock("../src/api/photoFetch", () => ({ clearPhotoCache: vi.fn() }));

import { login, confirmNewPassword, solicitarCodigoReset, confirmarReset } from "../src/api/auth";

beforeEach(() => {
  signInMock.mockReset();
  confirmSignInMock.mockReset();
  fetchAuthSessionMock.mockReset();
  resetPasswordMock.mockReset();
  confirmResetPasswordMock.mockReset();
  fetchAuthSessionMock.mockResolvedValue({});
});

describe("auth — re-canje de credenciales del Identity Pool tras login (fix fotos 403)", () => {
  it("login exitoso fuerza fetchAuthSession({forceRefresh:true})", async () => {
    signInMock.mockResolvedValue({ isSignedIn: true });
    const r = await login("u@gpa.com.mx", "pw");
    expect(r).toEqual({ status: "success" });
    expect(fetchAuthSessionMock).toHaveBeenCalledWith({ forceRefresh: true });
  });

  it("si signIn pide nueva contraseña NO re-canjea (aún no hay sesión)", async () => {
    signInMock.mockResolvedValue({
      isSignedIn: false,
      nextStep: { signInStep: "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED" },
    });
    const r = await login("u@gpa.com.mx", "pw");
    expect(r).toEqual({ status: "requireNewPassword" });
    expect(fetchAuthSessionMock).not.toHaveBeenCalled();
  });

  it("confirmNewPassword exitoso fuerza el re-canje", async () => {
    confirmSignInMock.mockResolvedValue({ isSignedIn: true });
    const r = await confirmNewPassword("NewPw123!");
    expect(r).toEqual({ status: "success" });
    expect(fetchAuthSessionMock).toHaveBeenCalledWith({ forceRefresh: true });
  });

  it("un fallo del re-canje no rompe el login (best-effort)", async () => {
    signInMock.mockResolvedValue({ isSignedIn: true });
    fetchAuthSessionMock.mockRejectedValue(new Error("network"));
    const r = await login("u@gpa.com.mx", "pw");
    expect(r).toEqual({ status: "success" });
  });
});

// ── Recuperación de contraseña (2026-09-18) ──────────────────────────────────
// Bug de origen: el panel dejaba al usuario en RESET_REQUIRED y el login no tenía
// pantalla donde pedir el código → cuenta atorada, con un mensaje críptico de
// Amplify como única pista. login() ahora RECONOCE ese estado y el modal puede
// mandar al usuario directo a escribir su código.
describe("auth — recuperación de contraseña", () => {
  it("login detecta a un usuario que Cognito dejó pendiente de restablecer", async () => {
    signInMock.mockResolvedValue({
      isSignedIn: false,
      nextStep: { signInStep: "RESET_PASSWORD" },
    });
    const r = await login("u@gpa.com.mx", "pw");
    expect(r).toEqual({ status: "requireReset" });
  });

  it("login traduce PasswordResetRequiredException (Cognito lo lanza como error)", async () => {
    signInMock.mockRejectedValue(
      Object.assign(new Error("Password reset required for the user"), {
        name: "PasswordResetRequiredException",
      }),
    );
    const r = await login("u@gpa.com.mx", "pw");
    expect(r).toEqual({ status: "requireReset" });
  });

  it("traduce al español los errores de Cognito que el usuario sí puede ver", async () => {
    signInMock.mockRejectedValue(
      Object.assign(new Error("Incorrect username or password."), {
        name: "NotAuthorizedException",
      }),
    );
    const r = await login("u@gpa.com.mx", "mala");
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.message).toContain("Correo o contraseña");
      expect(r.message).not.toContain("Incorrect username");
    }
  });

  it("solicitarCodigoReset pide el código a Cognito con el correo normalizado", async () => {
    resetPasswordMock.mockResolvedValue({
      nextStep: { resetPasswordStep: "CONFIRM_RESET_PASSWORD_WITH_CODE" },
    });
    const r = await solicitarCodigoReset("  U@GPA.com.mx ");
    expect(r).toEqual({ status: "success" });
    expect(resetPasswordMock).toHaveBeenCalledWith({ username: "u@gpa.com.mx" });
  });

  it("solicitarCodigoReset no delata si el correo existe o no", async () => {
    resetPasswordMock.mockRejectedValue(
      Object.assign(new Error("Username/client id combination not found."), {
        name: "UserNotFoundException",
      }),
    );
    // Responder "no existe" convierte la pantalla en un detector de correos válidos.
    const r = await solicitarCodigoReset("fantasma@gpa.com.mx");
    expect(r).toEqual({ status: "success" });
  });

  it("confirmarReset entrega código y contraseña nueva a Cognito", async () => {
    confirmResetPasswordMock.mockResolvedValue(undefined);
    const r = await confirmarReset("u@gpa.com.mx", "123456", "NuevaPw123!");
    expect(r).toEqual({ status: "success" });
    expect(confirmResetPasswordMock).toHaveBeenCalledWith({
      username: "u@gpa.com.mx",
      confirmationCode: "123456",
      newPassword: "NuevaPw123!",
    });
  });

  it("confirmarReset explica en español un código equivocado", async () => {
    confirmResetPasswordMock.mockRejectedValue(
      Object.assign(new Error("Invalid verification code provided, please try again."), {
        name: "CodeMismatchException",
      }),
    );
    const r = await confirmarReset("u@gpa.com.mx", "000000", "NuevaPw123!");
    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.message).toContain("código");
  });

  it("confirmarReset explica en español una contraseña que no cumple la política", async () => {
    confirmResetPasswordMock.mockRejectedValue(
      Object.assign(new Error("Password does not conform to policy"), {
        name: "InvalidPasswordException",
      }),
    );
    const r = await confirmarReset("u@gpa.com.mx", "123456", "corta");
    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.message).toContain("mayúscula");
  });
});
