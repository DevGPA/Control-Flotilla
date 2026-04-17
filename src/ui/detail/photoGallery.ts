// photoGallery — sub-tab "Fotos" del panel detalle.
// Reemplaza `renderPhotos(u, body)` del legado.
// Combina fotos de ZIP (con lazy loading) + fotos manuales (con delete).
// DOM-API puro. Lightbox se pasa como dependencia (ver ./lightbox.ts).

import type { Unit } from "../../types";
import type { LightboxApi, LightboxItem } from "./lightbox";

export type PhotoEntry = {
  /** Nombre del archivo dentro del ZIP (para lazy resolve). */
  fname: string;
  /** Label legible — usualmente el nombre de columna XLSX. */
  col: string;
  /** Grupo para agrupación visual (usualmente categoría). */
  group: string;
};

export type ManualPhoto = {
  id: string;
  fname: string;
  label: string;
  /** Bytes o data URL — resolver via `manualPhotoUrl` callback. */
  data: Uint8Array | string;
};

export type PhotoGalleryDeps = {
  unit: Unit & { photos?: PhotoEntry[] };
  manualPhotos?: ManualPhoto[];
  hasZip?: boolean;
  /** Lightbox instance — creada al boot de la app, compartida. */
  lightbox?: LightboxApi;
  /** Resolver URL desde fname de ZIP. */
  resolveZipUrl?: (fname: string) => string | null;
  /** Resolver URL para foto manual (blob URL desde data). */
  resolveManualUrl?: (photo: ManualPhoto) => string;
  /** IntersectionObserver global (inyectado para compartir con legado). */
  lazyObserver?: IntersectionObserver;
  /** Callbacks UI. */
  onAddManualPhoto?: (uid: string) => void;
  onDeleteManualPhoto?: (uid: string, photoId: string) => void;
};

function lucideIcon(name: string, size = 12, extra = ""): HTMLElement {
  const i = document.createElement("i");
  i.setAttribute("data-lucide", name);
  i.style.cssText = `width:${size}px;height:${size}px;${extra}`;
  return i;
}

function shortLbl(col: string): string {
  const cleaned = col
    .replace(/^Foto(s)?\s+(de(l|los|la|las)?\s+|vehiculo\s+|del\s+|con\s+|gato.*)/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 28);
  return cleaned || col.substring(0, 28);
}

function buildEmptyStateNoZip(uid: string, onAdd?: (uid: string) => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.cssText = "text-align:center;padding:30px 16px";

  const icon = document.createElement("div");
  icon.style.cssText = "margin-bottom:10px;color:var(--s3)";
  icon.appendChild(lucideIcon("camera-off", 42, "stroke-width:1.5"));
  wrap.appendChild(icon);

  const title = document.createElement("div");
  title.style.cssText = "font-size:13px;color:var(--s1);font-weight:600;margin-bottom:6px";
  title.textContent = "Sin fotos disponibles";
  wrap.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.style.cssText = "font-size:11px;color:var(--s3);line-height:1.8;margin-bottom:16px";
  subtitle.textContent = "Puedes cargar el ZIP de MoreApp o agregar fotos manualmente.";
  wrap.appendChild(subtitle);

  const addBtn = document.createElement("button");
  addBtn.style.cssText = "padding:8px 16px;background:var(--ac);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px";
  addBtn.appendChild(lucideIcon("camera", 13));
  addBtn.appendChild(document.createTextNode(" Agregar fotos"));
  if (onAdd) addBtn.addEventListener("click", () => onAdd(uid));
  wrap.appendChild(addBtn);

  const help = document.createElement("div");
  help.style.cssText = "margin-top:14px;background:var(--bg3);border:1px solid var(--ln);border-radius:8px;padding:12px;text-align:left;font-size:11px;color:var(--s2)";
  const helpTitle = document.createElement("div");
  helpTitle.style.marginBottom = "5px";
  const helpB = document.createElement("b");
  helpB.style.color = "var(--s1)";
  helpB.textContent = "O desde MoreApp:";
  helpTitle.appendChild(helpB);
  help.appendChild(helpTitle);
  ["1. Ve a tu formulario → Exportar", "2. Selecciona Descargar ZIP", "3. Sube ese ZIP al dashboard"].forEach((t) => {
    const line = document.createElement("div");
    line.textContent = t;
    line.style.marginBottom = "3px";
    help.appendChild(line);
  });
  wrap.appendChild(help);

  return wrap;
}

function buildEmptyStateZipNoPhotos(uid: string, onAdd?: (uid: string) => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.cssText = "text-align:center;padding:36px;color:var(--s3);font-size:12px";
  wrap.appendChild(document.createTextNode("Sin fotos registradas para esta unidad."));
  wrap.appendChild(document.createElement("br"));
  const btn = document.createElement("button");
  btn.style.cssText = "margin-top:8px;padding:5px 12px;background:none;border:1px dashed var(--ln);border-radius:6px;font-size:10px;color:var(--s1);cursor:pointer";
  btn.textContent = "+ Agregar foto manual";
  if (onAdd) btn.addEventListener("click", () => onAdd(uid));
  wrap.appendChild(btn);
  return wrap;
}

function buildHeader(totalPhotos: number, uid: string, onAdd?: (uid: string) => void): HTMLElement {
  const hdr = document.createElement("div");
  hdr.className = "pg-header";

  const count = document.createElement("span");
  count.className = "pg-count";
  count.textContent = `${totalPhotos} foto${totalPhotos !== 1 ? "s" : ""}`;
  hdr.appendChild(count);

  const hint = document.createElement("span");
  hint.className = "pg-hint";
  hint.textContent = "← clic para ampliar";
  hdr.appendChild(hint);

  const addBtn = document.createElement("button");
  addBtn.style.cssText = "margin-left:auto;padding:3px 8px;border:1px dashed var(--ln);border-radius:5px;font-size:9px;color:var(--s1);background:none;cursor:pointer";
  addBtn.textContent = "+ Agregar foto";
  if (onAdd) addBtn.addEventListener("click", () => onAdd(uid));
  hdr.appendChild(addBtn);

  return hdr;
}

function buildZipThumb(
  entry: PhotoEntry,
  lbIdx: number,
  lightbox: LightboxApi | undefined,
  items: LightboxItem[],
  lazyObserver?: IntersectionObserver,
): HTMLElement {
  const item = document.createElement("div");
  item.className = "pgitem";
  if (lightbox) {
    item.addEventListener("click", () => lightbox.open(items, lbIdx));
  }

  const img = document.createElement("img");
  img.dataset.src = entry.fname;
  img.alt = entry.col;
  img.className = "lazy-img";
  img.style.cssText = "opacity:0;transition:opacity .3s ease";
  img.addEventListener("error", () => {
    const errBox = document.createElement("div");
    errBox.className = "pgerr";
    const errIcon = document.createElement("div");
    errIcon.className = "pgerr-i";
    errIcon.textContent = "🖼";
    errBox.appendChild(errIcon);
    const errText = document.createElement("div");
    errText.className = "pgerr-t";
    errText.textContent = "No disponible";
    errBox.appendChild(errText);
    img.replaceWith(errBox);
  });
  item.appendChild(img);
  if (lazyObserver) lazyObserver.observe(img);

  const label = document.createElement("div");
  label.className = "pglbl";
  label.textContent = shortLbl(entry.col);
  item.appendChild(label);

  return item;
}

function buildManualThumb(
  mp: ManualPhoto,
  lbIdx: number,
  uid: string,
  lightbox: LightboxApi | undefined,
  items: LightboxItem[],
  resolveManualUrl?: (p: ManualPhoto) => string,
  onDelete?: (uid: string, photoId: string) => void,
): HTMLElement {
  const item = document.createElement("div");
  item.className = "pgitem";
  item.style.position = "relative";
  if (lightbox) {
    item.addEventListener("click", () => lightbox.open(items, lbIdx));
  }

  const img = document.createElement("img");
  img.src = resolveManualUrl ? resolveManualUrl(mp) : "";
  img.alt = mp.label;
  img.style.transition = "opacity .3s ease";
  item.appendChild(img);

  const label = document.createElement("div");
  label.className = "pglbl";
  label.textContent = mp.label;
  item.appendChild(label);

  if (onDelete) {
    const delBtn = document.createElement("button");
    delBtn.style.cssText = "position:absolute;top:2px;right:2px;background:rgba(0,0,0,.5);color:#fff;border:none;border-radius:50%;width:16px;height:16px;font-size:9px;cursor:pointer;line-height:1";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onDelete(uid, mp.id);
    });
    item.appendChild(delBtn);
  }

  return item;
}

// ═══════════════════════════════════════════════════════════════
//  renderPhotoGallery — entry point
// ═══════════════════════════════════════════════════════════════

export function renderPhotoGallery(container: HTMLElement, deps: PhotoGalleryDeps): void {
  const {
    unit,
    manualPhotos = [],
    hasZip = false,
    lightbox,
    resolveZipUrl,
    resolveManualUrl,
    lazyObserver,
    onAddManualPhoto,
    onDeleteManualPhoto,
  } = deps;

  container.replaceChildren();

  const photos = (unit.photos ?? []) as unknown as PhotoEntry[];

  // Empty states
  if (!hasZip && manualPhotos.length === 0) {
    container.appendChild(buildEmptyStateNoZip(unit.uid, onAddManualPhoto));
    return;
  }
  if (photos.length === 0 && manualPhotos.length === 0) {
    container.appendChild(buildEmptyStateZipNoPhotos(unit.uid, onAddManualPhoto));
    return;
  }

  const total = photos.length + manualPhotos.length;
  container.appendChild(buildHeader(total, unit.uid, onAddManualPhoto));

  const cats = document.createElement("div");
  cats.className = "pg-cats";

  // Build lightbox items array. Lazy photos get pre-pushed so indices align.
  const lbItems: LightboxItem[] = [];
  for (const p of photos) lbItems.push({ fname: p.fname, label: p.col });
  for (const mp of manualPhotos) {
    lbItems.push({
      url: resolveManualUrl ? resolveManualUrl(mp) : undefined,
      label: mp.label,
      fname: mp.fname,
    });
  }

  // Pre-resolve ZIP URLs lazily via lightbox.resolveUrl but we also need sync
  // resolution for thumb display. Let the IntersectionObserver handle thumbs.

  // Group ZIP photos by group
  const grouped: Record<string, PhotoEntry[]> = {};
  for (const p of photos) {
    (grouped[p.group] = grouped[p.group] ?? []).push(p);
  }

  let zipIdx = 0;
  for (const [grp, items] of Object.entries(grouped)) {
    const grpWrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "pgcat-title";
    title.textContent = grp;
    grpWrap.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "pgrid";
    for (const entry of items) {
      grid.appendChild(buildZipThumb(entry, zipIdx, lightbox, lbItems, lazyObserver));
      zipIdx++;
    }
    grpWrap.appendChild(grid);
    cats.appendChild(grpWrap);
  }

  // Manual photos section
  if (manualPhotos.length) {
    const grpWrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "pgcat-title";
    title.style.cssText = "display:flex;align-items:center;gap:6px";
    title.appendChild(lucideIcon("camera", 12));
    title.appendChild(document.createTextNode(" Fotos manuales"));
    grpWrap.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "pgrid";
    let manualIdx = photos.length;
    for (const mp of manualPhotos) {
      grid.appendChild(
        buildManualThumb(
          mp,
          manualIdx,
          unit.uid,
          lightbox,
          lbItems,
          resolveManualUrl,
          onDeleteManualPhoto,
        ),
      );
      manualIdx++;
    }
    grpWrap.appendChild(grid);
    cats.appendChild(grpWrap);
  }

  container.appendChild(cats);

  // Also accept if caller passes resolveZipUrl — rewire lightbox to use it
  if (lightbox && resolveZipUrl) {
    // Patch lightbox's resolveUrl by replacing urls on-the-fly during open.
    // (Lightbox's internal resolveUrl is set at construction; we already
    // passed it via LightboxOptions at boot. No-op here.)
  }
  void resolveZipUrl;
}

// Export helper for tests
export { shortLbl };
