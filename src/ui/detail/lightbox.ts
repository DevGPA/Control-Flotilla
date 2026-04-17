// lightbox — viewer full-screen de imágenes con navegación prev/next,
// atajos de teclado (←/→/Esc) y click-bg para cerrar.
// Autónomo: NO depende del DOM legado; monta su propio overlay.
// DOM-API puro (zero innerHTML).

export type LightboxItem = {
  /** URL directa si ya resuelta (blob URL, data URL, http). */
  url?: string;
  /** Nombre de archivo para lazy-resolve via `resolveUrl` callback. */
  fname?: string;
  /** Label que se muestra bajo la imagen. */
  label: string;
};

export type LightboxOptions = {
  /** Callback para resolver url desde fname (lazy). Si retorna null, muestra placeholder. */
  resolveUrl?: (fname: string) => string | null;
  /** Container donde montar el overlay. Default: document.body. */
  mountIn?: HTMLElement;
  /** ID del overlay (para estilos custom). Default 'lb'. */
  overlayId?: string;
};

export type LightboxApi = {
  open: (items: LightboxItem[], startIdx?: number) => void;
  close: () => void;
  next: () => void;
  prev: () => void;
  /** Destruye overlay + listeners. */
  destroy: () => void;
};

/** Crea una instancia de lightbox con su propio overlay + keyboard handler. */
export function createLightbox(opts: LightboxOptions = {}): LightboxApi {
  const { resolveUrl, mountIn = document.body, overlayId = "lb" } = opts;

  // State
  let items: LightboxItem[] = [];
  let idx = 0;

  // Build overlay DOM
  const overlay = document.createElement("div");
  overlay.id = overlayId;
  overlay.className = "lb";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:10000;display:none;align-items:center;justify-content:center;flex-direction:column;gap:10px";

  const img = document.createElement("img");
  img.id = `${overlayId}-img`;
  img.style.cssText = "max-width:92vw;max-height:80vh;object-fit:contain";
  overlay.appendChild(img);

  const label = document.createElement("div");
  label.id = `${overlayId}-label`;
  label.style.cssText = "color:#fff;font-size:14px;font-weight:600;max-width:90vw;text-align:center";
  overlay.appendChild(label);

  const counter = document.createElement("div");
  counter.id = `${overlayId}-ctr`;
  counter.style.cssText = "color:#aaa;font-size:11px";
  overlay.appendChild(counter);

  // Nav buttons (prev/next/close)
  const mkBtn = (text: string, handler: () => void, extraStyle: string): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = text;
    btn.style.cssText = `position:absolute;background:rgba(255,255,255,.1);color:#fff;border:none;border-radius:50%;width:44px;height:44px;font-size:18px;cursor:pointer;${extraStyle}`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handler();
    });
    return btn;
  };

  const prevBtn = mkBtn("‹", () => prev(), "left:20px;top:50%;transform:translateY(-50%)");
  const nextBtn = mkBtn("›", () => next(), "right:20px;top:50%;transform:translateY(-50%)");
  const closeBtn = mkBtn("✕", () => close(), "top:20px;right:20px;");
  overlay.appendChild(prevBtn);
  overlay.appendChild(nextBtn);
  overlay.appendChild(closeBtn);

  // Click-bg closes
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  mountIn.appendChild(overlay);

  // Keyboard handler
  function onKey(e: KeyboardEvent): void {
    if (overlay.style.display === "none") return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      next();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      prev();
    } else if (e.key === "Escape") {
      close();
    }
  }
  document.addEventListener("keydown", onKey);

  function update(): void {
    const item = items[idx];
    if (!item) return;
    if (!item.url && item.fname && resolveUrl) {
      item.url = resolveUrl(item.fname) ?? undefined;
    }
    img.src = item.url ?? "";
    label.textContent = item.label;
    counter.textContent = `${idx + 1} de ${items.length}`;
    // Hide nav buttons if only 1 item
    const onlyOne = items.length <= 1;
    prevBtn.style.display = onlyOne ? "none" : "";
    nextBtn.style.display = onlyOne ? "none" : "";
  }

  function open(newItems: LightboxItem[], startIdx = 0): void {
    if (!newItems.length) return;
    items = newItems;
    idx = Math.max(0, Math.min(startIdx, items.length - 1));
    update();
    overlay.style.display = "flex";
    overlay.classList.add("open");
  }

  function close(): void {
    overlay.style.display = "none";
    overlay.classList.remove("open");
  }

  function next(): void {
    if (items.length === 0) return;
    idx = (idx + 1) % items.length;
    update();
  }

  function prev(): void {
    if (items.length === 0) return;
    idx = (idx - 1 + items.length) % items.length;
    update();
  }

  function destroy(): void {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  }

  return { open, close, next, prev, destroy };
}
