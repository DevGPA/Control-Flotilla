// Modal de login vanilla TS. Aparece al boot si !isLoggedIn().
// Form simple email + password. Al success cierra modal y resuelve la Promise.
//
// XSS-safe: usa textContent + appendChild (no innerHTML con input usuario).
// Estilo: inline minimal — heredado del CSS app (--bg, --ac, etc.).

import { login, confirmNewPassword, solicitarCodigoReset, confirmarReset } from "../api/auth";

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

    // Recuperación (2026-09-18). Sin esta salida, una cuenta que Cognito dejaba
    // pendiente de restablecer no tenía forma de volver: el único camino era pedirle
    // al admin una contraseña temporal.
    const olvide = document.createElement("button");
    olvide.type = "button";
    olvide.textContent = "¿Olvidaste tu contraseña?";
    olvide.style.cssText = [
      "display:block",
      "width:100%",
      "margin-top:14px",
      "padding:4px",
      "background:none",
      "border:none",
      "color:var(--s1)",
      "font-size:12px",
      "font-family:inherit",
      "text-decoration:underline",
      "cursor:pointer",
    ].join(";");
    olvide.addEventListener("click", () => {
      pedirCodigo(emailInput.value.trim());
    });
    card.appendChild(olvide);

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

    // ── Recuperación de contraseña ──────────────────────────────────────────
    // Deja el card con solo el encabezado (título + subtítulo) para montar el
    // siguiente paso encima.
    const limpiarCard = (titulo: string, subtitulo: string): void => {
      while (card.children.length > 2) card.removeChild(card.lastChild!);
      h.textContent = titulo;
      sub.textContent = subtitulo;
    };

    const nuevoCampo = (
      etiqueta: string,
      tipo: string,
      autocompletar: AutoFill,
    ): HTMLInputElement => {
      const lab = document.createElement("label");
      lab.style.cssText = emailLabel.style.cssText;
      lab.textContent = etiqueta;
      card.appendChild(lab);
      const inp = document.createElement("input");
      inp.type = tipo;
      inp.autocomplete = autocompletar;
      inp.required = true;
      inp.style.cssText = emailInput.style.cssText;
      card.appendChild(inp);
      return inp;
    };

    const nuevoBoton = (texto: string): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = texto;
      b.style.cssText = btn.style.cssText;
      b.addEventListener("mouseenter", () => {
        if (!b.disabled) b.style.background = "var(--ac2)";
      });
      b.addEventListener("mouseleave", () => {
        if (!b.disabled) b.style.background = "var(--ac)";
      });
      card.appendChild(b);
      return b;
    };

    const nuevoEnlace = (texto: string, alHacerClic: () => void): void => {
      const a = document.createElement("button");
      a.type = "button";
      a.textContent = texto;
      a.style.cssText = olvide.style.cssText;
      a.addEventListener("click", alHacerClic);
      card.appendChild(a);
    };

    // Paso A: a qué correo mandamos el código.
    const pedirCodigo = (emailPrevio: string): void => {
      limpiarCard("Recuperar contraseña", "Te enviaremos un código por correo");
      const correo = nuevoCampo("Correo", "email", "username");
      correo.value = emailPrevio;
      correo.style.marginBottom = "20px";

      const errA = document.createElement("div");
      errA.style.cssText = err.style.cssText;
      card.appendChild(errA);

      const btnA = nuevoBoton("Enviarme el código");
      nuevoEnlace("Volver a iniciar sesión", () => volverALogin(correo.value.trim()));

      const enviar = async (): Promise<void> => {
        const valor = correo.value.trim();
        if (!valor) {
          errA.textContent = "Escribe tu correo";
          return;
        }
        btnA.disabled = true;
        btnA.textContent = "Enviando...";
        errA.textContent = "";
        const res = await solicitarCodigoReset(valor);
        if (res.status === "success") {
          escribirCodigo(valor);
          return;
        }
        errA.textContent = res.message;
        btnA.disabled = false;
        btnA.textContent = "Enviarme el código";
      };
      btnA.addEventListener("click", () => void enviar());
      correo.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          void enviar();
        }
      });
      setTimeout(() => (emailPrevio ? btnA.focus() : correo.focus()), 50);
    };

    // Paso B: código del correo + contraseña nueva.
    const escribirCodigo = (email: string): void => {
      limpiarCard(
        "Revisa tu correo",
        `Enviamos un código a ${email}. Si no aparece en tu bandeja, busca en Correo no deseado.`,
      );
      const codigo = nuevoCampo("Código del correo", "text", "one-time-code");
      codigo.inputMode = "numeric";
      const nueva = nuevoCampo("Nueva contraseña", "password", "new-password");
      const confirma = nuevoCampo("Confirmar contraseña", "password", "new-password");
      confirma.style.marginBottom = "20px";

      const errB = document.createElement("div");
      errB.style.cssText = err.style.cssText;
      card.appendChild(errB);

      const btnB = nuevoBoton("Guardar contraseña");
      nuevoEnlace("Enviar el código otra vez", () => pedirCodigo(email));

      const guardar = async (): Promise<void> => {
        if (!codigo.value.trim()) {
          errB.textContent = "Escribe el código que te llegó por correo";
          return;
        }
        if (nueva.value.length < 8) {
          errB.textContent = "La contraseña debe tener al menos 8 caracteres";
          return;
        }
        if (nueva.value !== confirma.value) {
          errB.textContent = "Las contraseñas no coinciden";
          return;
        }
        btnB.disabled = true;
        btnB.textContent = "Guardando...";
        errB.textContent = "";
        const res = await confirmarReset(email, codigo.value, nueva.value);
        if (res.status === "success") {
          // Cognito NO deja la sesión abierta tras el canje: se vuelve al login,
          // ya con el correo puesto, para entrar con la contraseña recién creada.
          volverALogin(email, "Contraseña actualizada. Ya puedes iniciar sesión.");
          return;
        }
        errB.textContent = res.message;
        btnB.disabled = false;
        btnB.textContent = "Guardar contraseña";
      };
      btnB.addEventListener("click", () => void guardar());
      [codigo, nueva, confirma].forEach((inp) => {
        inp.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            void guardar();
          }
        });
      });
      setTimeout(() => codigo.focus(), 50);
    };

    // Vuelve al formulario de entrada reconstruyendo el card con los nodos
    // ORIGINALES (no copias): conservan sus listeners y su estado.
    const volverALogin = (email: string, aviso?: string): void => {
      limpiarCard("Control Flotilla", aviso ?? "Inicia sesión para continuar");
      sub.style.color = aviso ? "var(--G)" : "var(--s1)";
      for (const nodo of [emailLabel, emailInput, passLabel, passInput, err, btn, olvide]) {
        card.appendChild(nodo);
      }
      emailInput.value = email;
      passInput.value = "";
      err.textContent = "";
      btn.disabled = false;
      btn.textContent = "Iniciar sesión";
      setTimeout(() => passInput.focus(), 50);
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
      // Cognito ya dejó la cuenta pendiente de restablecer (p. ej. porque un admin
      // lo pidió): no hay contraseña que valga, así que se manda directo a canjear
      // el código en vez de repetir un error que no lleva a ningún lado.
      if (res.status === "requireReset") {
        pedirCodigo(email);
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
