// Modal de login vanilla TS. Aparece al boot si !isLoggedIn().
// Form simple email + password. Al success cierra modal y resuelve la Promise.
//
// XSS-safe: usa textContent + appendChild (no innerHTML con input usuario).
// Estilo: inline minimal — heredado del CSS app (--bg, --ac, etc.).

import { login, confirmNewPassword } from "../api/auth";

export interface AuthModalOptions {
  /** Mensaje arriba del form (ej: "Sesión expirada"). Default: "Inicia sesión". */
  title?: string;
  /** Email pre-llenado para reintento tras error. */
  prefillEmail?: string;
}

/**
 * Muestra el modal y resuelve cuando login es exitoso.
 * El modal queda en DOM hasta success — sin opción de cerrar/cancelar.
 * Para logout flow, llamar logout() y re-mostrar este modal.
 */
export function showAuthModal(opts: AuthModalOptions = {}): Promise<void> {
  return new Promise((resolve) => {
    // Backdrop fixed full-screen.
    const backdrop = document.createElement("div");
    backdrop.id = "auth-modal-backdrop";
    backdrop.style.cssText = [
      "position:fixed",
      "inset:0",
      "background:rgba(6,9,15,0.85)",
      "z-index:100000",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "backdrop-filter:blur(8px)",
    ].join(";");

    // Card. A11y (UX 2026-07 Lote 4): dialog con nombre accesible.
    const card = document.createElement("div");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "auth-modal-title");
    card.style.cssText = [
      "background:var(--bg)",
      "border:1px solid var(--ln)",
      "border-radius:12px",
      "padding:32px",
      "min-width:340px",
      "max-width:90vw",
      "box-shadow:0 20px 40px rgba(0,0,0,0.5)",
      "font-family:Inter,system-ui,sans-serif",
    ].join(";");

    // Header.
    const h = document.createElement("h2");
    h.id = "auth-modal-title";
    h.style.cssText = "margin:0 0 6px 0;font-size:20px;font-weight:600;color:var(--w1)";
    h.textContent = opts.title ?? "Control Flotilla";
    card.appendChild(h);

    const sub = document.createElement("p");
    sub.style.cssText = "margin:0 0 24px 0;font-size:13px;color:var(--s1)";
    sub.textContent = "Inicia sesión para continuar";
    card.appendChild(sub);

    // Email input.
    const emailLabel = document.createElement("label");
    emailLabel.style.cssText =
      "display:block;font-size:11px;font-weight:600;color:var(--s1);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px";
    emailLabel.textContent = "Email";
    card.appendChild(emailLabel);

    const emailInput = document.createElement("input");
    emailInput.type = "email";
    emailInput.autocomplete = "username";
    emailInput.required = true;
    emailInput.value = opts.prefillEmail ?? "";
    emailInput.style.cssText = [
      "width:100%",
      "padding:10px 12px",
      "font-size:14px",
      "background:var(--bg2)",
      "border:1px solid var(--ln)",
      "border-radius:8px",
      "color:var(--w1)",
      "margin-bottom:16px",
      "box-sizing:border-box",
      "font-family:inherit",
    ].join(";");
    card.appendChild(emailInput);

    // Password input.
    const passLabel = document.createElement("label");
    passLabel.style.cssText = emailLabel.style.cssText;
    passLabel.textContent = "Password";
    card.appendChild(passLabel);

    const passInput = document.createElement("input");
    passInput.type = "password";
    passInput.autocomplete = "current-password";
    passInput.required = true;
    passInput.style.cssText = emailInput.style.cssText;
    passInput.style.marginBottom = "20px";
    card.appendChild(passInput);

    // Error message holder.
    const err = document.createElement("div");
    err.style.cssText =
      "font-size:12px;color:var(--R);margin-bottom:12px;min-height:18px;line-height:1.4";
    card.appendChild(err);

    // Submit button.
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Iniciar sesión";
    btn.style.cssText = [
      "width:100%",
      "padding:11px",
      "background:var(--ac)",
      "color:#fff",
      "border:none",
      "border-radius:8px",
      "font-size:14px",
      "font-weight:600",
      "cursor:pointer",
      "transition:background 0.12s",
      "font-family:inherit",
    ].join(";");
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "var(--ac2)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "var(--ac)";
    });
    card.appendChild(btn);

    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    // Auto-focus email (o password si email pre-llenado).
    setTimeout(() => {
      if (opts.prefillEmail) passInput.focus();
      else emailInput.focus();
    }, 50);

    // Step 2: form de cambio de password obligatorio.
    // Se construye on-demand cuando login devuelve requireNewPassword.
    const showNewPasswordStep = (): void => {
      // Limpia el form actual del card (mantén el header).
      while (card.children.length > 2) card.removeChild(card.lastChild!);

      const subInfo = document.createElement("p");
      subInfo.style.cssText = "margin:0 0 16px 0;font-size:12px;color:var(--A);line-height:1.5";
      subInfo.textContent =
        "Tu password actual es temporal. Define una nueva para continuar (mín. 8 caracteres).";
      card.appendChild(subInfo);

      const newPassLabel = document.createElement("label");
      newPassLabel.style.cssText =
        "display:block;font-size:11px;font-weight:600;color:var(--s1);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px";
      newPassLabel.textContent = "Nueva password";
      card.appendChild(newPassLabel);

      const newPassInput = document.createElement("input");
      newPassInput.type = "password";
      newPassInput.autocomplete = "new-password";
      newPassInput.required = true;
      newPassInput.style.cssText = emailInput.style.cssText;
      card.appendChild(newPassInput);

      const confirmLabel = document.createElement("label");
      confirmLabel.style.cssText = newPassLabel.style.cssText;
      confirmLabel.textContent = "Confirmar password";
      card.appendChild(confirmLabel);

      const confirmInput = document.createElement("input");
      confirmInput.type = "password";
      confirmInput.autocomplete = "new-password";
      confirmInput.required = true;
      confirmInput.style.cssText = emailInput.style.cssText;
      confirmInput.style.marginBottom = "20px";
      card.appendChild(confirmInput);

      const err2 = document.createElement("div");
      err2.style.cssText = err.style.cssText;
      card.appendChild(err2);

      const btn2 = document.createElement("button");
      btn2.type = "button";
      btn2.textContent = "Cambiar password";
      btn2.style.cssText = btn.style.cssText;
      btn2.addEventListener("mouseenter", () => {
        btn2.style.background = "var(--ac2)";
      });
      btn2.addEventListener("mouseleave", () => {
        btn2.style.background = "var(--ac)";
      });
      card.appendChild(btn2);

      const submit2 = async (): Promise<void> => {
        const newP = newPassInput.value;
        const confP = confirmInput.value;
        if (newP.length < 8) {
          err2.textContent = "Password debe tener al menos 8 caracteres";
          return;
        }
        if (newP !== confP) {
          err2.textContent = "Las passwords no coinciden";
          return;
        }
        btn2.disabled = true;
        btn2.textContent = "Guardando...";
        err2.textContent = "";
        const res = await confirmNewPassword(newP);
        if (res.status === "success") {
          backdrop.remove();
          resolve();
        } else {
          err2.textContent = res.status === "error" ? res.message : "Cognito requiere otro paso";
          btn2.disabled = false;
          btn2.textContent = "Cambiar password";
        }
      };

      btn2.addEventListener("click", submit2);
      [newPassInput, confirmInput].forEach((inp) => {
        inp.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            void submit2();
          }
        });
      });

      setTimeout(() => newPassInput.focus(), 50);
    };

    // Submit handler step 1.
    const handleSubmit = async (): Promise<void> => {
      const email = emailInput.value.trim();
      const password = passInput.value;
      if (!email || !password) {
        err.textContent = "Email y password requeridos";
        return;
      }
      btn.disabled = true;
      btn.textContent = "Verificando...";
      err.textContent = "";
      const res = await login(email, password);
      if (res.status === "success") {
        backdrop.remove();
        resolve();
        return;
      }
      if (res.status === "requireNewPassword") {
        showNewPasswordStep();
        return;
      }
      err.textContent = res.message;
      btn.disabled = false;
      btn.textContent = "Iniciar sesión";
      passInput.value = "";
      passInput.focus();
    };

    btn.addEventListener("click", handleSubmit);
    // Enter en cualquier input dispara submit.
    [emailInput, passInput].forEach((inp) => {
      inp.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          void handleSubmit();
        }
      });
    });
  });
}
