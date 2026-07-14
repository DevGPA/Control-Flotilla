// renderNotes — sub-tab "Notas" del panel detalle.
// Reemplaza `renderNotes(u, body)` del legado (línea ~2879). DOM-API puro.
//
// Capacidades:
//   - Lista de notas ordenadas reverse-cronológico (más recientes arriba)
//   - Cada nota: badge de tipo + fecha + texto + botón delete
//   - Form: textarea + select de tipo + botón "Guardar"
//   - Callbacks onAdd(uid, text, type) / onDelete(uid, noteId)
//   - Empty state con ícono notebook-pen

import type { Unit } from "../../types";

export type NoteType = "seguimiento" | "taller" | "alerta" | "info";

export type Note = {
  id: string;
  text: string;
  type: NoteType;
  ts: string; // ISO timestamp
};

export type NotesDB = Record<string, Note[]>;

export const NOTE_TYPES: Record<NoteType, { label: string; color: string }> = {
  seguimiento: { label: "Seguimiento", color: "var(--B)" },
  taller:      { label: "En taller",   color: "var(--violet)" },
  alerta:      { label: "Alerta",      color: "var(--R)" },
  info:        { label: "Info",        color: "var(--s3)" },
};

export type RenderNotesDeps = {
  unit: Unit;
  notesDB?: NotesDB;
  onAdd?: (uid: string, text: string, type: NoteType) => void;
  onDelete?: (uid: string, noteId: string) => void;
  /** Para testing: override default date formatting. */
  formatDate?: (ts: string) => string;
};

function defaultFormatDate(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function lucideIcon(name: string, size = 14): HTMLElement {
  const i = document.createElement("i");
  i.setAttribute("data-lucide", name);
  i.style.cssText = `width:${size}px;height:${size}px;vertical-align:-3px`;
  return i;
}

function buildHeader(count: number): HTMLElement {
  const hdr = document.createElement("div");
  hdr.className = "notes-hdr";
  const lbl = document.createElement("span");
  lbl.className = "notes-lbl";
  lbl.textContent = "Notas de seguimiento";
  const cnt = document.createElement("span");
  cnt.className = "notes-cnt";
  cnt.textContent = `${count} nota${count !== 1 ? "s" : ""}`;
  hdr.appendChild(lbl);
  hdr.appendChild(cnt);
  return hdr;
}

function buildForm(uid: string, onAdd?: (uid: string, text: string, type: NoteType) => void): HTMLElement {
  const form = document.createElement("div");
  form.className = "note-form";

  const ta = document.createElement("textarea");
  ta.className = "note-ta";
  ta.id = "note-input";
  ta.placeholder = "Escribe una observación, acción tomada, fecha de cita en taller…";
  ta.rows = 3;
  form.appendChild(ta);

  const row = document.createElement("div");
  row.className = "note-row";

  const select = document.createElement("select");
  select.className = "note-type";
  select.id = "note-type";
  for (const [key, val] of Object.entries(NOTE_TYPES)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = val.label;
    select.appendChild(opt);
  }
  row.appendChild(select);

  const btn = document.createElement("button");
  btn.className = "note-save";
  btn.textContent = "+ Guardar nota";
  btn.addEventListener("click", () => {
    const text = ta.value.trim();
    if (!text) return;
    const type = (select.value as NoteType) || "info";
    onAdd?.(uid, text, type);
    ta.value = "";
  });
  row.appendChild(btn);

  form.appendChild(row);
  return form;
}

function buildNoteItem(
  n: Note,
  uid: string,
  formatDate: (ts: string) => string,
  onDelete?: (uid: string, noteId: string) => void,
): HTMLElement {
  const item = document.createElement("div");
  item.className = "note-item";
  item.id = `ni-${n.id}`;

  // Delete button
  if (onDelete) {
    const del = document.createElement("button");
    del.className = "note-del";
    del.title = "Eliminar";
    del.textContent = "✕";
    del.addEventListener("click", () => onDelete(uid, n.id));
    item.appendChild(del);
  }

  // Meta row: badge + date
  const meta = document.createElement("div");
  meta.className = "note-meta";
  const nt = NOTE_TYPES[n.type] ?? NOTE_TYPES.info;
  const badge = document.createElement("span");
  badge.className = "note-badge";
  badge.style.cssText = `background:${nt.color}22;color:${nt.color};border:1px solid ${nt.color}44`;
  badge.textContent = nt.label;
  const dateSpan = document.createElement("span");
  dateSpan.textContent = formatDate(n.ts);
  meta.appendChild(badge);
  meta.appendChild(dateSpan);
  item.appendChild(meta);

  // Text (textContent = XSS safe)
  const text = document.createElement("div");
  text.className = "note-text";
  text.textContent = n.text;
  item.appendChild(text);

  return item;
}

function buildEmptyState(): HTMLElement {
  const empty = document.createElement("div");
  empty.className = "note-empty";
  empty.appendChild(lucideIcon("notebook-pen", 14));
  empty.appendChild(document.createTextNode(" Sin notas aún."));
  empty.appendChild(document.createElement("br"));
  empty.appendChild(document.createTextNode("Agrega una observación, seguimiento o alerta."));
  return empty;
}

// ═══════════════════════════════════════════════════════════════
//  renderNotes — entry point
// ═══════════════════════════════════════════════════════════════

export function renderNotes(container: HTMLElement, deps: RenderNotesDeps): void {
  const { unit, notesDB = {}, onAdd, onDelete, formatDate = defaultFormatDate } = deps;
  container.replaceChildren();

  const notes = notesDB[unit.uid] ?? [];

  const wrap = document.createElement("div");
  wrap.className = "notes-wrap";
  wrap.appendChild(buildHeader(notes.length));
  wrap.appendChild(buildForm(unit.uid, onAdd));

  const list = document.createElement("div");
  list.id = "note-list";
  if (notes.length === 0) {
    list.appendChild(buildEmptyState());
  } else {
    // Reverse orden — más recientes primero
    const reversed = [...notes].reverse();
    for (const n of reversed) {
      list.appendChild(buildNoteItem(n, unit.uid, formatDate, onDelete));
    }
  }
  wrap.appendChild(list);
  container.appendChild(wrap);

  // Focus en textarea (deferred para después de mount)
  setTimeout(() => {
    (container.querySelector("#note-input") as HTMLTextAreaElement | null)?.focus();
  }, 50);
}
