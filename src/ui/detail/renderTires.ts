// renderTires — sub-tab "Llantas" del panel detalle.
// Reemplaza el bloque `curTab === "t"` de renderDetBody() del legado.
// DOM-API puro (cero innerHTML).

import { TCRIT, TWARN } from "../../analyzer/constants";
import type { Unit } from "../../types";

export type RenderTiresDeps = {
  unit: Unit;
  tcrit?: number;
  twarn?: number;
};

function tireRow(name: string, valueMm: number, tcrit: number, twarn: number): HTMLElement {
  // Clamp en ambos extremos: un valueMm negativo (dato corrupto) producía un
  // ancho de barra negativo. El color/status ya cae en CRÍTICO por la cadena <=.
  const pct = Math.max(0, Math.min((valueMm / 10) * 100, 100));
  const color = valueMm <= tcrit ? "var(--R)" : valueMm <= twarn ? "var(--A)" : "var(--G)";
  const status = valueMm <= tcrit ? "CRÍTICO" : valueMm <= twarn ? "Vigilar" : "OK";

  const row = document.createElement("div");
  row.className = "trr";

  const label = document.createElement("div");
  label.className = "trn";
  label.textContent = name;
  row.appendChild(label);

  const barWrap = document.createElement("div");
  barWrap.className = "trrb";

  const st = document.createElement("div");
  st.className = "trrst";
  st.style.color = color;
  st.textContent = status;
  barWrap.appendChild(st);

  const bg = document.createElement("div");
  bg.className = "trrbg";
  const fill = document.createElement("div");
  fill.className = "trrfill";
  fill.style.cssText = `width:${pct}%;background:${color}`;
  bg.appendChild(fill);
  barWrap.appendChild(bg);

  const val = document.createElement("div");
  val.className = "trrv";
  val.style.color = color;
  val.textContent = `${valueMm}mm`;
  barWrap.appendChild(val);

  row.appendChild(barWrap);
  return row;
}

function noRefaccionRow(): HTMLElement {
  const row = document.createElement("div");
  row.className = "trr";

  const label = document.createElement("div");
  label.className = "trn";
  label.style.color = "var(--s2)";
  label.textContent = "Refacción";
  row.appendChild(label);

  const barWrap = document.createElement("div");
  barWrap.className = "trrb";

  const st = document.createElement("div");
  st.className = "trrst";
  st.style.color = "var(--s2)";
  st.textContent = "Sin refacción";
  barWrap.appendChild(st);

  const info = document.createElement("div");
  info.style.cssText = "font-size:10px;color:var(--s2);font-style:italic;padding-left:6px";
  info.textContent = "No disponible";
  barWrap.appendChild(info);

  row.appendChild(barWrap);
  return row;
}

function alertBox(minT: number, tcrit: number, twarn: number): HTMLElement {
  const ac = minT <= tcrit ? "var(--R)" : minT <= twarn ? "var(--A)" : "var(--G)";
  const ab = minT <= tcrit ? "var(--Rd)" : minT <= twarn ? "var(--Ad)" : "var(--Gd)";
  const al = minT <= tcrit ? "var(--Rl)" : minT <= twarn ? "var(--Al)" : "var(--Gl)";
  const text =
    minT <= tcrit ? "Reemplazo urgente" : minT <= twarn ? "Programar reemplazo" : "Buen estado";

  const alert = document.createElement("div");
  alert.className = "talert";
  alert.style.cssText = `background:${ab};border-color:${al};color:${ac}`;
  alert.appendChild(document.createTextNode("Taco mínimo: "));
  const b = document.createElement("b");
  b.textContent = `${Number(minT)}mm`;
  alert.appendChild(b);
  alert.appendChild(document.createTextNode(` — ${text}`));
  return alert;
}

function referenceLine(): HTMLElement {
  const ref = document.createElement("div");
  ref.className = "tref";
  ref.appendChild(document.createTextNode("Referencia: "));
  const ok = document.createElement("span");
  ok.style.color = "var(--G)";
  ok.textContent = "≥7mm OK";
  ref.appendChild(ok);
  ref.appendChild(document.createTextNode(" · "));
  const warn = document.createElement("span");
  warn.style.color = "var(--A)";
  warn.textContent = "4–6mm revisar";
  ref.appendChild(warn);
  ref.appendChild(document.createTextNode(" · "));
  const urg = document.createElement("span");
  urg.style.color = "var(--R)";
  urg.textContent = "≤3.99mm urgente";
  ref.appendChild(urg);
  return ref;
}

export function renderTires(container: HTMLElement, deps: RenderTiresDeps): void {
  const { unit, tcrit = TCRIT, twarn = TWARN } = deps;
  container.replaceChildren();

  const entries = Object.entries(unit.T ?? {});

  // Empty state: sin mediciones Y sí tiene refacción
  if (entries.length === 0 && unit.hasRefaccion !== false) {
    const empty = document.createElement("div");
    empty.style.cssText = "text-align:center;padding:36px;color:var(--s3);font-size:12px";
    empty.textContent = "Sin datos de llantas.";
    container.appendChild(empty);
    return;
  }

  // Renderizar una fila por llanta con reading válida
  for (const [name, value] of entries) {
    if (Number.isFinite(value)) {
      container.appendChild(tireRow(name, value, tcrit, twarn));
    }
  }

  // Si la unidad NO tiene refacción funcional, renderizar row "Sin refacción"
  if (unit.hasRefaccion === false) {
    container.appendChild(noRefaccionRow());
  }

  // Alert box + referencia
  if (unit.minT !== null && Number.isFinite(unit.minT)) {
    container.appendChild(alertBox(unit.minT, tcrit, twarn));
  }
  container.appendChild(referenceLine());
}
