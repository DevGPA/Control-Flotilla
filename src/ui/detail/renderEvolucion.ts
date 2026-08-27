// Tab "Evolución" del expediente (#det) — render del timeline por unidad.
//
// Pinta las filas de src/inspecciones/evolucionUnidad.ts usando las clases
// .evol-* de main.css (bloque "EVOLUCIÓN / TIMELINE" que existía sin
// consumidores). La fila ABIERTA (uid === selUid) se marca .evol-active con
// badge "ABIERTA" y NO lleva handler; el clic en cualquier otra fila salta a
// esa inspección (onJump) — el wire de main.ts re-activa esta tab tras el
// salto para que comparar meses no expulse al usuario a Checklist.
//
// DOM via createElement/textContent (XSS-safe, ESLint prohíbe innerHTML).

import type { EvolRow } from "../../inspecciones/evolucionUnidad";
import { mkpill } from "../renderTable";

export type RenderEvolucionDeps = {
  rows: EvolRow[];
  /** uid de la inspección actualmente abierta en el expediente. */
  selUid: string | null;
  onJump?: (uid: string) => void;
};

export function renderEvolucion(container: HTMLElement, deps: RenderEvolucionDeps): void {
  const { rows, selUid, onJump } = deps;
  const doc = container.ownerDocument;
  container.replaceChildren();

  if (!rows.length) {
    const empty = doc.createElement("div");
    empty.className = "evol-empty";
    empty.textContent = "Sin inspecciones históricas para esta unidad.";
    container.appendChild(empty);
    return;
  }

  const wrap = doc.createElement("div");
  wrap.className = "evol-timeline";

  for (const r of rows) {
    const esActiva = r.uid === selUid;
    const row = doc.createElement("div");
    row.className = esActiva ? "evol-row evol-active" : "evol-row";

    // ── Columna 1: período (mes · día) + badge ABIERTA / delta
    const periodo = doc.createElement("div");
    periodo.className = "evol-period";
    const lbl = doc.createElement("span");
    lbl.textContent = r.label;
    periodo.appendChild(lbl);
    if (esActiva) {
      const now = doc.createElement("span");
      now.className = "evol-now";
      now.textContent = "ABIERTA";
      periodo.appendChild(now);
    } else if (r.deltaPend != null) {
      periodo.appendChild(deltaBadge(doc, r.deltaPend));
    }
    row.appendChild(periodo);

    // ── Columna 2: badge de riesgo reportado
    const riesgo = doc.createElement("div");
    riesgo.className = "evol-risk";
    riesgo.appendChild(mkpill(r.risk));
    row.appendChild(riesgo);

    // ── Columna 3: hallazgos pendientes + contexto (llanta, km, inspector)
    const det = doc.createElement("div");
    det.className = "evol-findings";
    const partes: string[] = [];
    if (r.pendUrg) partes.push(`${r.pendUrg} urgente${r.pendUrg !== 1 ? "s" : ""}`);
    if (r.pendRev) partes.push(`${r.pendRev} a revisar`);
    if (r.pendComp) partes.push(`${r.pendComp} por completar`);
    const linea1 = doc.createElement("div");
    linea1.textContent = partes.length
      ? `Pendientes: ${partes.join(" · ")}`
      : r.totF
        ? `Sin pendientes (${r.totF} hallazgo${r.totF !== 1 ? "s" : ""} atendido${r.totF !== 1 ? "s" : ""})`
        : "Sin hallazgos";
    if (r.pendUrg) linea1.style.color = "var(--R)";
    det.appendChild(linea1);
    const ctx: string[] = [];
    if (r.minT != null) ctx.push(`llanta mín ${r.minT}mm`);
    if (r.km !== undefined && r.km !== "" && r.km !== 0) ctx.push(`${r.km} km`);
    if (r.insp) ctx.push(String(r.insp));
    if (ctx.length) {
      const linea2 = doc.createElement("div");
      linea2.textContent = ctx.join(" · ");
      det.appendChild(linea2);
    }
    row.appendChild(det);

    // ── Interacción: solo filas NO activas saltan a su inspección
    if (!esActiva && onJump) {
      row.style.cursor = "pointer";
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      row.title = `Abrir la inspección de ${r.label}`;
      const saltar = () => onJump(r.uid);
      row.addEventListener("click", saltar);
      row.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          saltar();
        }
      });
    }

    wrap.appendChild(row);
  }

  container.appendChild(wrap);
}

/** ▲+2 rojo (empeoró) / ▼−3 verde (mejoró) / = neutro, vs la inspección anterior. */
function deltaBadge(doc: Document, delta: number): HTMLElement {
  const el = doc.createElement("span");
  el.className = "evol-delta";
  el.style.fontSize = "9px";
  el.style.fontWeight = "700";
  if (delta > 0) {
    el.textContent = `▲ +${delta} vs anterior`;
    el.style.color = "var(--R)";
    el.title = "Más hallazgos pendientes que en la inspección anterior";
  } else if (delta < 0) {
    el.textContent = `▼ ${delta} vs anterior`;
    el.style.color = "var(--G)";
    el.title = "Menos hallazgos pendientes que en la inspección anterior";
  } else {
    el.textContent = "= igual que anterior";
    el.style.color = "var(--s2)";
    el.title = "Mismos hallazgos pendientes que en la inspección anterior";
  }
  return el;
}
