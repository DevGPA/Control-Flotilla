import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock de Amplify Auth. Verificamos el FIX del incidente fotos 2026-06-17: tras un
// login exitoso, auth.ts debe forzar el re-canje de credenciales del Identity Pool
// (fetchAuthSession {forceRefresh:true}) para descartar las credenciales GUEST
// cacheadas que hacían que getUrl firmara las fotos con el rol unauth → S3 403.
const signInMock = vi.fn();
const confirmSignInMock = vi.fn();
const fetchAuthSessionMock = vi.fn();
vi.mock("aws-amplify/auth", () => ({
  signIn: (...a: unknown[]) => signInMock(...a),
  confirmSignIn: (...a: unknown[]) => confirmSignInMock(...a),
  fetchAuthSession: (...a: unknown[]) => fetchAuthSessionMock(...a),
  signOut: vi.fn(),
  getCurrentUser: vi.fn(),
  fetchUserAttributes: vi.fn(),
}));
vi.mock("../src/api/photoFetch", () => ({ clearPhotoCache: vi.fn() }));

import { login, confirmNewPassword } from "../src/api/auth";

beforeEach(() => {
  signInMock.mockReset();
  confirmSignInMock.mockReset();
  fetchAuthSessionMock.mockReset();
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
