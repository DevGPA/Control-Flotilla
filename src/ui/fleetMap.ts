/**
 * Mapa de flota (Híbrido B×C H4) — lógica PURA + render DOM-safe.
 *
 * Cada unidad de la flota es un tile numerado dentro de la tarjeta de su sucursal
 * (diseño "tarjeta por sucursal", Navares 2026-09-25). El COLOR es la capacidad
 * operativa real — operativa = NO está en taller (mismo criterio que la dona); los
 * hallazgos no la sacan de operativa. Lo urgente sin atender se marca aparte con un
 * puntito rojo que "pulsa". El wire inline (buildKPIs en el HTML) calcula enTaller y
 * los motivos del puntito; este módulo solo agrupa/ordena/pinta (100% testeable).
 *
 * Seguridad: createElement/textContent (sin innerHTML con datos). El caller debe
 * pasar unidades YA scopeadas por sucursal (scopeUnits) — igual que KPIs/alertas.
 */

export type FleetTileState = "taller" | "ok";

export type FleetMapInput = {
  uid?: string;
  eco?: string | number;
  plate?: string;
  branch?: string;
  /** unidad actualmente en taller (isUnitEnTaller) */
  enTaller?: boolean;
  /** motivos del puntito rojo (textos de hallazgos urgentes sin atender, "Servicio
   *  vencido"); vacío/ausente = sin puntito */
  alertas?: readonly string[];
};

export type FleetTile = {
  /** key para onSelect (uid si existe; si no, el label) */
  key: string;
  label: string;
  state: FleetTileState;
  /** puntito rojo: operativa con algo urgente pendiente */
  alerta: boolean;
  /** motivos del puntito (vacío si no hay puntito) */
  motivos: string[];
  /** estado + motivos resumidos — renglón de la tarjeta flotante */
  detalle: string;
  /** texto completo para lector de pantalla (aria-label) */
  tip: string;
};

export type FleetMapGroup = {
  branch: string;
  total: number;
  operativas: number;
  enTaller: number;
  tiles: FleetTile[];
};

const STATE_LABEL: Record<FleetTileState, string> = {
  taller: "En taller",
  ok: "Operativa",
};

const PARTICULAS = new Set(["de", "del", "la", "las", "los", "y"]);

/** Nombre legible de la sucursal: "CIUDAD DE MEXICO" → "Ciudad de Mexico". */
export function branchLabel(branch: string | undefined): string {
  const s = String(branch ?? "")
    .trim()
    .toLowerCase();
  if (!s) return "Sin sucursal";
  return s
    .split(/\s+/)
    .map((w, i) => (i > 0 && PARTICULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function tileState(u: FleetMapInput): FleetTileState {
  return u.enTaller ? "taller" : "ok";
}

function resumenMotivos(m: readonly string[]): string {
  if (m.length <= 2) return m.join(", ");
  return `${m.slice(0, 2).join(", ")} y ${m.length - 2} más`;
}

/** ¿puntito aunque esté en taller? No: si ya está en taller, se está atendiendo. */
function tileRank(t: FleetTile): number {
  return t.alerta ? 0 : t.state === "taller" ? 1 : 2;
}

/** Agrupa por sucursal (etiqueta legible; vacía → "Sin sucursal"); grupos grandes
 *  primero; dentro del grupo: puntito rojo, taller, operativa; luego por ECO. */
export function buildFleetMapModel(units: readonly FleetMapInput[]): FleetMapGroup[] {
  const by = new Map<string, FleetTile[]>();
  for (const u of units) {
    const branch = branchLabel(u.branch);
    const label = String(u.eco ?? u.plate ?? "?");
    const state = tileState(u);
    const motivos = state === "ok" ? [...(u.alertas ?? [])] : [];
    const detalle = [STATE_LABEL[state], ...(motivos.length ? [resumenMotivos(motivos)] : [])].join(
      " · ",
    );
    const tile: FleetTile = {
      key: String(u.uid ?? label),
      label,
      state,
      alerta: motivos.length > 0,
      motivos,
      detalle,
      tip: `ECO ${label} · ${detalle} · ${branch}`,
    };
    const arr = by.get(branch);
    if (arr) arr.push(tile);
    else by.set(branch, [tile]);
  }
  const groups: FleetMapGroup[] = [...by.entries()].map(([branch, tiles]) => {
    const enTaller = tiles.filter((t) => t.state === "taller").length;
    return {
      branch,
      total: tiles.length,
      operativas: tiles.length - enTaller,
      enTaller,
      tiles: tiles.sort(
        (a, b) =>
          tileRank(a) - tileRank(b) || a.label.localeCompare(b.label, undefined, { numeric: true }),
      ),
    };
  });
  return groups.sort((a, b) => b.total - a.total || a.branch.localeCompare(b.branch));
}

// ── Tarjeta flotante (una sola para toda la página) ──────────────────────────
// Va en <body> con position:fixed: #fleet-map tiene overflow auto y recortaría una
// tarjeta anclada dentro. aria-hidden porque el aria-label del tile ya dice lo mismo.
let tipEl: HTMLDivElement | null = null;

function ensureTip(): HTMLDivElement {
  if (tipEl?.isConnected) return tipEl;
  const el = document.createElement("div");
  el.className = "fm-tip";
  el.setAttribute("aria-hidden", "true");
  el.hidden = true;
  document.body.appendChild(el);
  // Cualquier scroll (página o el propio mapa) la dejaría flotando fuera de lugar.
  window.addEventListener("scroll", () => (el.hidden = true), { capture: true, passive: true });
  tipEl = el;
  return el;
}

function showTip(anchor: HTMLElement, t: FleetTile, branch: string): void {
  const el = ensureTip();
  const title = document.createElement("div");
  title.className = "fm-tip-t";
  title.textContent = `ECO ${t.label} · ${branch}`;
  const det = document.createElement("div");
  det.className = "fm-tip-d";
  det.append(STATE_LABEL[t.state]);
  if (t.motivos.length) {
    const r = document.createElement("span");
    r.className = "fm-tip-r";
    r.textContent = resumenMotivos(t.motivos);
    det.append(" · ", r);
  }
  const hint = document.createElement("div");
  hint.className = "fm-tip-h";
  hint.textContent = "Click para abrir su expediente";
  el.replaceChildren(title, det, hint);
  el.hidden = false;
  // Arriba del tile, centrada; si no cabe arriba, abajo. Nunca fuera de la ventana.
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth,
    h = el.offsetHeight,
    gap = 8;
  const below = r.top - h - gap < gap;
  el.classList.toggle("fm-tip-below", below);
  const cx = r.left + r.width / 2;
  const left = Math.min(Math.max(gap, cx - w / 2), window.innerWidth - w - gap);
  el.style.left = `${left}px`;
  // La flechita apunta al tile aunque la tarjeta se haya recorrido para no salirse.
  el.style.setProperty("--fm-tip-ax", `${cx - left}px`);
  el.style.top = `${below ? r.bottom + gap : r.top - h - gap}px`;
}

function hideTip(): void {
  if (tipEl) tipEl.hidden = true;
}

/** Pinta el modelo en `container`: una tarjeta por sucursal con su conteo, barra
 *  operativas/taller y los tiles numerados. Cada tile es un <button> accesible
 *  (aria-label) con tarjeta flotante al pasar el mouse o con foco; click → onSelect(key). */
export function renderFleetMap(
  container: HTMLElement,
  groups: readonly FleetMapGroup[],
  onSelect?: (key: string) => void,
): void {
  hideTip();
  container.replaceChildren();
  for (const g of groups) {
    const card = document.createElement("div");
    card.className = "fm-card";

    const head = document.createElement("div");
    head.className = "fm-chead";
    const name = document.createElement("span");
    name.className = "fm-cname";
    name.textContent = g.branch;
    const count = document.createElement("span");
    count.className = "fm-ccount";
    count.textContent = `${g.operativas} de ${g.total} ${g.total === 1 ? "operativa" : "operativas"}`;
    head.append(name, count);

    const bar = document.createElement("div");
    bar.className = "fm-bar";
    bar.setAttribute("aria-hidden", "true");
    for (const [cls, n] of [
      ["fm-bar-ok", g.operativas],
      ["fm-bar-taller", g.enTaller],
    ] as const) {
      if (!n) continue;
      const seg = document.createElement("span");
      seg.className = cls;
      seg.style.flexGrow = String(n);
      bar.appendChild(seg);
    }

    const grid = document.createElement("div");
    grid.className = "fm-dots";
    for (const t of g.tiles) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `fm-tile fm-${t.state}${t.alerta ? " fm-alerta" : ""}`;
      b.textContent = t.label;
      b.setAttribute("aria-label", t.tip);
      b.addEventListener("mouseenter", () => showTip(b, t, g.branch));
      b.addEventListener("focus", () => showTip(b, t, g.branch));
      b.addEventListener("mouseleave", hideTip);
      b.addEventListener("blur", hideTip);
      if (onSelect) {
        const k = t.key;
        b.addEventListener("click", () => {
          hideTip();
          onSelect(k);
        });
      }
      grid.appendChild(b);
    }
    card.append(head, bar, grid);
    container.appendChild(card);
  }
}
