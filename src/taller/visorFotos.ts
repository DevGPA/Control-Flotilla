/**
 * Visor de fotos del taller. Un solo overlay reutilizado por el registro de la
 * unidad y por la bandeja de entrada.
 *
 * Reglas del repo que aplican aquí: cero `innerHTML` (todo createElement +
 * textContent) y las URLs son FIRMADAS y por demanda — la misma función que ya
 * usa la miniatura de la bandeja, nunca un índice del bucket.
 */
const ID = "taller-visor-fotos";

export function abrirVisorFotos(opts: {
  llaves: readonly string[];
  inicial?: number;
  titulo?: string;
  subtitulo?: string;
  url: (llave: string) => Promise<string | null>;
}): void {
  const { llaves, titulo, subtitulo, url } = opts;
  if (!llaves.length) return;
  document.getElementById(ID)?.remove();

  let i = Math.min(Math.max(opts.inicial ?? 0, 0), llaves.length - 1);
  const devolverFoco = document.activeElement as HTMLElement | null;

  const overlay = document.createElement("div");
  overlay.id = ID;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Fotos del taller");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:9999;background:rgba(11,15,25,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px";

  const cabecera = document.createElement("div");
  cabecera.style.cssText =
    "position:absolute;top:16px;left:24px;right:24px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px";
  const textos = document.createElement("div");
  textos.style.cssText = "display:flex;flex-direction:column;gap:2px;min-width:0";
  const t1 = document.createElement("span");
  t1.style.cssText = "font-size:13px;font-weight:700;color:#e2e8f0";
  t1.textContent = titulo ?? "Foto del taller";
  const t2 = document.createElement("span");
  t2.style.cssText = "font-size:11px;color:#94a3b8";
  textos.append(t1, t2);

  const btnCerrar = document.createElement("button");
  btnCerrar.type = "button";
  btnCerrar.setAttribute("aria-label", "Cerrar");
  btnCerrar.textContent = "✕";
  btnCerrar.style.cssText =
    "min-width:44px;min-height:44px;border-radius:6px;border:1px solid rgba(148,170,205,.25);background:transparent;color:#e2e8f0;cursor:pointer;font-size:14px";
  cabecera.append(textos, btnCerrar);

  const img = document.createElement("img");
  img.alt = "Foto del taller";
  img.style.cssText =
    "max-width:90vw;max-height:78vh;object-fit:contain;border-radius:10px;background:#1a2234";
  const aviso = document.createElement("div");
  aviso.style.cssText = "font-size:11px;color:#94a3b8";

  const fila = document.createElement("div");
  fila.style.cssText = "display:flex;align-items:center;gap:18px";
  const flecha = (etiqueta: string, paso: number): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", etiqueta);
    b.textContent = paso < 0 ? "‹" : "›";
    b.style.cssText =
      "min-width:44px;min-height:44px;border-radius:22px;border:none;background:rgba(226,232,240,.12);color:#e2e8f0;font-size:20px;cursor:pointer";
    b.addEventListener("click", () => mover(paso));
    b.style.visibility = llaves.length > 1 ? "visible" : "hidden";
    return b;
  };
  fila.append(flecha("Foto anterior", -1), img, flecha("Foto siguiente", 1));

  overlay.append(cabecera, fila, aviso);

  function pintar(): void {
    t2.textContent = `${subtitulo ? subtitulo + " · " : ""}foto ${i + 1} de ${llaves.length}`;
    img.removeAttribute("src");
    aviso.textContent = "Cargando…";
    const llave = llaves[i] as string;
    void url(llave)
      .then((u) => {
        if (!document.getElementById(ID)) return;
        if (!u) {
          aviso.textContent = "Foto no disponible";
          return;
        }
        img.src = u;
        aviso.textContent = "";
      })
      .catch(() => {
        aviso.textContent = "Foto no disponible";
      });
  }

  function mover(paso: number): void {
    i = (i + paso + llaves.length) % llaves.length;
    pintar();
  }

  function cerrar(): void {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    devolverFoco?.focus?.();
  }

  function onKey(ev: KeyboardEvent): void {
    if (ev.key === "Escape") cerrar();
    else if (ev.key === "ArrowRight") mover(1);
    else if (ev.key === "ArrowLeft") mover(-1);
  }

  btnCerrar.addEventListener("click", cerrar);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) cerrar();
  });
  document.addEventListener("keydown", onKey);

  document.body.appendChild(overlay);
  img.onerror = () => {
    aviso.textContent = "Foto no disponible";
  };
  pintar();
  btnCerrar.focus();
}
