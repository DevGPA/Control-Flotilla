/**
 * UI compartida de anulación admin: modal de anular (motivo obligatorio + confirmación
 * fuerte) y panel de registros anulados con Restaurar. DOM construido con createElement
 * (regla anti-XSS del proyecto). La usan Combustible (wire TS) y, en el Lote E3, los
 * módulos legacy vía window.__anulacionUI.
 */
import type { AnulacionRow } from "./anulacion";
import { esAnulacionActiva } from "./anulacion";

declare global {
  interface Window {
    esAdmin?: () => boolean;
    notify?: (msg: string, kind?: string, ms?: number) => void;
    __anulacionUI?: {
      openAnular: typeof openAnularModal;
      openPanel: typeof openAnuladosPanel;
    };
  }
}

const OVERLAY_ID = "anulacion-overlay";

function closeOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}

function overlay(): HTMLElement {
  closeOverlay();
  const ov = document.createElement("div");
  ov.id = OVERLAY_ID;
  ov.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px";
  ov.addEventListener("click", (ev) => {
    if (ev.target === ov) closeOverlay();
  });
  document.body.appendChild(ov);
  return ov;
}

function card(maxWidth: string): HTMLElement {
  const c = document.createElement("div");
  c.style.cssText = `background:var(--bg2);color:var(--s1);border:1px solid var(--ln);border-radius:10px;padding:18px;width:100%;max-width:${maxWidth};max-height:85vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.35)`;
  return c;
}

function btn(txt: string, kind: "primary" | "danger" | "ghost"): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = txt;
  const base =
    "padding:7px 14px;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;border:1px solid ";
  if (kind === "danger") b.style.cssText = `${base}var(--R);background:var(--R);color:#fff`;
  else if (kind === "primary") b.style.cssText = `${base}var(--ac);background:var(--ac);color:#fff`;
  else b.style.cssText = `${base}var(--ln);background:var(--bg3);color:var(--s1)`;
  b.addEventListener("mouseenter", () => (b.style.opacity = "0.85"));
  b.addEventListener("mouseleave", () => (b.style.opacity = "1"));
  return b;
}

export type AnularModalOpts = {
  /** Descripción legible del registro (p.ej. "Carga · unidad 44 · folio 4050 · 2026-07-02"). */
  etiqueta: string;
  /** Texto que el admin debe escribir para confirmar (p.ej. el económico o la placa). */
  confirmText: string;
  /** Persiste la anulación. Si lanza, el modal muestra el error y permanece abierto. */
  onConfirm: (motivo: string) => Promise<void>;
  /** Texto precargado del motivo (p.ej. triage de rechazadas de Ops); el admin puede editarlo. */
  motivoInicial?: string;
};

/** Modal de anulación: motivo OBLIGATORIO + confirmación escribiendo `confirmText`. */
export function openAnularModal(opts: AnularModalOpts): void {
  const ov = overlay();
  const c = card("440px");

  const h = document.createElement("h3");
  h.textContent = "Anular registro";
  h.style.cssText = "margin:0 0 6px;font-size:15px;color:var(--R)";
  c.appendChild(h);

  const desc = document.createElement("p");
  desc.textContent = opts.etiqueta;
  desc.style.cssText = "margin:0 0 10px;font-size:12px;color:var(--s2)";
  c.appendChild(desc);

  const nota = document.createElement("p");
  nota.textContent =
    "El registro NO se borra: se excluye de KPIs, rendimientos y reportes, y queda consultable en la vista de anulados. La acción es reversible (Restaurar).";
  nota.style.cssText = "margin:0 0 12px;font-size:11px;color:var(--s3)";
  c.appendChild(nota);

  const lblM = document.createElement("label");
  lblM.textContent = "Motivo de la anulación (obligatorio)";
  lblM.style.cssText = "display:block;font-size:11px;font-weight:700;margin-bottom:4px";
  c.appendChild(lblM);
  const motivo = document.createElement("textarea");
  motivo.rows = 3;
  motivo.placeholder = "Ej.: carga duplicada — el chofer registró dos veces el mismo ticket";
  motivo.style.cssText =
    "width:100%;box-sizing:border-box;font-size:12px;padding:7px;border:1px solid var(--ln);border-radius:7px;background:var(--bg);color:var(--s1);resize:vertical";
  if (opts.motivoInicial) motivo.value = opts.motivoInicial;
  c.appendChild(motivo);

  const lblC = document.createElement("label");
  lblC.style.cssText = "display:block;font-size:11px;font-weight:700;margin:12px 0 4px";
  lblC.textContent = `Escribe "${opts.confirmText}" para confirmar`;
  c.appendChild(lblC);
  const confirm = document.createElement("input");
  confirm.type = "text";
  confirm.style.cssText =
    "width:100%;box-sizing:border-box;font-size:12px;padding:7px;border:1px solid var(--ln);border-radius:7px;background:var(--bg);color:var(--s1)";
  c.appendChild(confirm);

  const err = document.createElement("div");
  err.style.cssText = "min-height:16px;font-size:11px;color:var(--R);margin-top:8px";
  c.appendChild(err);

  const row = document.createElement("div");
  row.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-top:8px";
  const cancel = btn("Cancelar", "ghost");
  cancel.addEventListener("click", closeOverlay);
  const ok = btn("Anular registro", "danger");
  ok.disabled = true;
  ok.style.opacity = "0.5";
  const sync = () => {
    const valid = motivo.value.trim().length > 0 && confirm.value.trim() === opts.confirmText;
    ok.disabled = !valid;
    ok.style.opacity = valid ? "1" : "0.5";
  };
  motivo.addEventListener("input", sync);
  confirm.addEventListener("input", sync);
  ok.addEventListener("click", () => {
    if (ok.disabled) return;
    ok.disabled = true;
    ok.textContent = "Anulando…";
    opts
      .onConfirm(motivo.value.trim())
      .then(() => closeOverlay())
      .catch((e) => {
        console.error("[anulacion] anular:", e);
        err.textContent =
          "No se pudo anular. Verifica tu sesión (se requiere rol admin) e intenta de nuevo.";
        ok.disabled = false;
        ok.textContent = "Anular registro";
      });
  });
  row.appendChild(cancel);
  row.appendChild(ok);
  c.appendChild(row);

  ov.appendChild(c);
  motivo.focus();
}

export type AnuladosPanelOpts = {
  /** 'combustible' | 'checklist' | 'semanal' */
  modulo: string;
  titulo: string;
  /** Carga las anulaciones (normalmente window.__anulaciones.list). */
  fetchRows: () => Promise<AnulacionRow[]>;
  /** Etiqueta legible de un refId (p.ej. "Carga · unidad 44 · 2026-07-02"). */
  resolveEtiqueta: (refId: string) => string;
  /** Restaura (solo se ofrece en filas activas). Si lanza, se notifica y la lista no cambia. */
  onRestaurar: (refId: string) => Promise<void>;
};

/** Panel de registros anulados del módulo: historial completo + Restaurar (admin). */
export function openAnuladosPanel(opts: AnuladosPanelOpts): void {
  const ov = overlay();
  const c = card("720px");

  const h = document.createElement("h3");
  h.textContent = opts.titulo;
  h.style.cssText = "margin:0 0 10px;font-size:15px";
  c.appendChild(h);

  const cont = document.createElement("div");
  cont.textContent = "Cargando…";
  cont.style.cssText = "font-size:12px;color:var(--s2)";
  c.appendChild(cont);

  const row = document.createElement("div");
  row.style.cssText = "display:flex;justify-content:flex-end;margin-top:12px";
  const close = btn("Cerrar", "ghost");
  close.addEventListener("click", closeOverlay);
  row.appendChild(close);
  c.appendChild(row);
  ov.appendChild(c);

  const fechaCorta = (iso: string | null | undefined): string => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
    return m ? `${m[3]}/${m[2]}/${m[1]!.slice(2)}` : "—";
  };
  const handle = (email: string | null | undefined): string =>
    String(email ?? "").split("@")[0] || "—";

  const paint = (rows: AnulacionRow[]): void => {
    cont.replaceChildren();
    const propias = rows
      .filter((r) => r.modulo === opts.modulo)
      .sort((a, b) => String(b.ts ?? "").localeCompare(String(a.ts ?? "")));
    if (propias.length === 0) {
      cont.textContent = "No hay registros anulados en este módulo.";
      return;
    }
    const admin = typeof window.esAdmin === "function" ? window.esAdmin() : false;
    const table = document.createElement("table");
    table.style.cssText = "width:100%;border-collapse:collapse;font-size:11.5px";
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    for (const t of ["Registro", "Motivo", "Anulado", "Estado", ""]) {
      const th = document.createElement("th");
      th.textContent = t;
      th.style.cssText =
        "text-align:left;padding:6px 8px;border-bottom:1px solid var(--ln);color:var(--s2);font-size:10.5px;text-transform:uppercase";
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const r of propias) {
      const activa = esAnulacionActiva(r);
      const tr = document.createElement("tr");
      const td = (txt: string, title?: string) => {
        const el = document.createElement("td");
        el.textContent = txt;
        if (title) el.title = title;
        el.style.cssText = "padding:7px 8px;border-bottom:1px solid var(--ln);vertical-align:top";
        return el;
      };
      tr.appendChild(td(opts.resolveEtiqueta(r.refId)));
      const motivo = String(r.motivo ?? "");
      tr.appendChild(td(motivo.length > 60 ? `${motivo.slice(0, 59)}…` : motivo, motivo));
      tr.appendChild(td(`${handle(r.anuladoPor)} · ${fechaCorta(r.ts)}`));
      tr.appendChild(
        td(
          activa
            ? "Activa"
            : `Restaurada · ${handle(r.restauradaPor)} · ${fechaCorta(r.restauradaTs)}`,
        ),
      );
      const acc = document.createElement("td");
      acc.style.cssText = "padding:7px 8px;border-bottom:1px solid var(--ln)";
      if (activa && admin) {
        const rest = btn("Restaurar", "primary");
        rest.style.fontSize = "11px";
        rest.addEventListener("click", () => {
          rest.disabled = true;
          rest.textContent = "Restaurando…";
          opts
            .onRestaurar(r.refId)
            .then(() => opts.fetchRows())
            .then(paint)
            .catch((e) => {
              console.error("[anulacion] restaurar:", e);
              window.notify?.("No se pudo restaurar el registro.", "error", 5000);
              rest.disabled = false;
              rest.textContent = "Restaurar";
            });
        });
        acc.appendChild(rest);
      }
      tr.appendChild(acc);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    cont.appendChild(table);
  };

  opts
    .fetchRows()
    .then(paint)
    .catch((e) => {
      console.error("[anulacion] list:", e);
      cont.textContent = "No se pudieron cargar las anulaciones.";
    });
}

// Puente para los módulos legacy (Inspecciones/Semanales, Lote E3) desde el JS inline.
window.__anulacionUI = { openAnular: openAnularModal, openPanel: openAnuladosPanel };
