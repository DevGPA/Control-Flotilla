// Flujo de recuperación de contraseña en la pantalla de login (2026-09-18).
//
// El bug de origen: el panel de admin dejaba la cuenta en RESET_REQUIRED y el
// login no tenía dónde pedir el código → la persona quedaba atorada viendo un
// mensaje de Amplify en inglés, sin ninguna salida. Estos tests cubren las dos
// puertas de entrada al flujo (el enlace manual y la detección automática) y
// que el modal nunca deje al usuario sin camino.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const loginMock = vi.fn();
const confirmNewPasswordMock = vi.fn();
const solicitarCodigoResetMock = vi.fn();
const confirmarResetMock = vi.fn();
vi.mock("../src/api/auth", () => ({
  login: (...a: unknown[]) => loginMock(...a),
  confirmNewPassword: (...a: unknown[]) => confirmNewPasswordMock(...a),
  solicitarCodigoReset: (...a: unknown[]) => solicitarCodigoResetMock(...a),
  confirmarReset: (...a: unknown[]) => confirmarResetMock(...a),
}));

import { showAuthModal } from "../src/ui/authModal";

/** Espera a que el DOM refleje los handlers async (microtareas pendientes). */
const asentar = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const porTexto = (texto: string): HTMLButtonElement | undefined =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === texto) as
    | HTMLButtonElement
    | undefined;

const campos = (): HTMLInputElement[] =>
  Array.from(document.querySelectorAll("#auth-modal-backdrop input"));

const titulo = (): string => document.getElementById("auth-modal-title")?.textContent ?? "";

beforeEach(() => {
  loginMock.mockReset();
  confirmNewPasswordMock.mockReset();
  solicitarCodigoResetMock.mockReset();
  confirmarResetMock.mockReset();
  document.body.replaceChildren();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("authModal — recuperación de contraseña", () => {
  it("ofrece la salida '¿Olvidaste tu contraseña?' desde el primer momento", () => {
    void showAuthModal();
    expect(porTexto("¿Olvidaste tu contraseña?")).toBeTruthy();
  });

  it("el enlace lleva a pedir el código y arrastra el correo ya escrito", async () => {
    void showAuthModal();
    campos()[0]!.value = "nava@gpa.com.mx";
    porTexto("¿Olvidaste tu contraseña?")!.click();
    await asentar();

    expect(titulo()).toBe("Recuperar contraseña");
    expect(campos()[0]!.value).toBe("nava@gpa.com.mx");
    expect(porTexto("Enviarme el código")).toBeTruthy();
  });

  it("una cuenta que Cognito dejó pendiente va DIRECTO a escribir el código", async () => {
    // Este es el caso que antes terminaba en un callejón sin salida.
    loginMock.mockResolvedValue({ status: "requireReset" });
    void showAuthModal();
    campos()[0]!.value = "tesoreria@gpa.com.mx";
    campos()[1]!.value = "la-que-sea";
    porTexto("Iniciar sesión")!.click();
    await asentar();

    expect(titulo()).toBe("Recuperar contraseña");
    expect(campos()[0]!.value).toBe("tesoreria@gpa.com.mx");
  });

  it("tras pedir el código, la pantalla dice a dónde llegó y avisa de la bandeja de spam", async () => {
    solicitarCodigoResetMock.mockResolvedValue({ status: "success" });
    void showAuthModal();
    porTexto("¿Olvidaste tu contraseña?")!.click();
    await asentar();
    campos()[0]!.value = "nava@gpa.com.mx";
    porTexto("Enviarme el código")!.click();
    await asentar();

    expect(solicitarCodigoResetMock).toHaveBeenCalledWith("nava@gpa.com.mx");
    expect(titulo()).toBe("Revisa tu correo");
    const texto = document.getElementById("auth-modal-backdrop")!.textContent ?? "";
    expect(texto).toContain("nava@gpa.com.mx");
    expect(texto).toContain("Correo no deseado");
  });

  it("no manda a Cognito dos contraseñas que no coinciden", async () => {
    solicitarCodigoResetMock.mockResolvedValue({ status: "success" });
    void showAuthModal();
    porTexto("¿Olvidaste tu contraseña?")!.click();
    await asentar();
    campos()[0]!.value = "nava@gpa.com.mx";
    porTexto("Enviarme el código")!.click();
    await asentar();

    const [codigo, nueva, confirma] = campos();
    codigo!.value = "123456";
    nueva!.value = "Contrasena1!";
    confirma!.value = "Contrasena2!";
    porTexto("Guardar contraseña")!.click();
    await asentar();

    expect(confirmarResetMock).not.toHaveBeenCalled();
    expect(document.getElementById("auth-modal-backdrop")!.textContent).toContain("no coinciden");
  });

  it("al guardar bien, regresa al login con el correo puesto y el aviso de que ya puede entrar", async () => {
    solicitarCodigoResetMock.mockResolvedValue({ status: "success" });
    confirmarResetMock.mockResolvedValue({ status: "success" });
    void showAuthModal();
    porTexto("¿Olvidaste tu contraseña?")!.click();
    await asentar();
    campos()[0]!.value = "nava@gpa.com.mx";
    porTexto("Enviarme el código")!.click();
    await asentar();

    const [codigo, nueva, confirma] = campos();
    codigo!.value = "123456";
    nueva!.value = "Contrasena1!";
    confirma!.value = "Contrasena1!";
    porTexto("Guardar contraseña")!.click();
    await asentar();

    expect(confirmarResetMock).toHaveBeenCalledWith("nava@gpa.com.mx", "123456", "Contrasena1!");
    // De vuelta en el login, operativo: el botón y el enlace responden otra vez.
    expect(porTexto("Iniciar sesión")).toBeTruthy();
    expect(porTexto("¿Olvidaste tu contraseña?")).toBeTruthy();
    expect(campos()[0]!.value).toBe("nava@gpa.com.mx");
    expect(document.getElementById("auth-modal-backdrop")!.textContent).toContain(
      "Ya puedes iniciar sesión",
    );
  });

  it("el error de Cognito se muestra y deja reintentar sin recargar", async () => {
    solicitarCodigoResetMock.mockResolvedValue({ status: "success" });
    confirmarResetMock.mockResolvedValue({
      status: "error",
      message: "El código no coincide. Revísalo o pide uno nuevo.",
    });
    void showAuthModal();
    porTexto("¿Olvidaste tu contraseña?")!.click();
    await asentar();
    campos()[0]!.value = "nava@gpa.com.mx";
    porTexto("Enviarme el código")!.click();
    await asentar();

    const [codigo, nueva, confirma] = campos();
    codigo!.value = "000000";
    nueva!.value = "Contrasena1!";
    confirma!.value = "Contrasena1!";
    porTexto("Guardar contraseña")!.click();
    await asentar();

    expect(document.getElementById("auth-modal-backdrop")!.textContent).toContain(
      "El código no coincide",
    );
    const reintento = porTexto("Guardar contraseña");
    expect(reintento).toBeTruthy();
    expect(reintento!.disabled).toBe(false);
  });

  it("se puede volver al login desde la pantalla de recuperación", async () => {
    void showAuthModal();
    porTexto("¿Olvidaste tu contraseña?")!.click();
    await asentar();
    porTexto("Volver a iniciar sesión")!.click();
    await asentar();

    expect(titulo()).toBe("Control Flotilla");
    expect(porTexto("Iniciar sesión")).toBeTruthy();
  });

  it("el paso de contraseña temporal (usuario nuevo) sigue funcionando", async () => {
    loginMock.mockResolvedValue({ status: "requireNewPassword" });
    void showAuthModal();
    campos()[0]!.value = "nuevo@gpa.com.mx";
    campos()[1]!.value = "Temporal1!";
    porTexto("Iniciar sesión")!.click();
    await asentar();

    expect(porTexto("Cambiar password")).toBeTruthy();
  });
});
