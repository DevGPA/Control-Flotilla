/**
 * Mapa de flota (Híbrido B×C H4) — lógica PURA + render DOM-safe.
 *
 * Cada unidad de la flota es un tile coloreado por estado, agrupado por sucursal:
 * toda la flota se lee en un vistazo y el urgente "pulsa". El wire inline
 * (buildKPIs en el HTML) calcula los flags (atención/revisar/enTaller) con las
 * MISMAS reglas que el hero y las alertas, y este módulo solo agrupa/ordena/pinta
 * (así el criterio vive en un solo lugar y esto queda 100% testeable).
 *
 * Seguridad: createElement/textContent (sin innerHTML con datos). El caller debe
 * pasar unidades YA scopeadas por sucursal (scopeUnits) — igual que KPIs/alertas.
 */

export type FleetTileState = "urg" | "taller" | "rev" | "ok";

export type FleetMapInput = {
  uid?: string;
  eco?: string | number;
  plate?: string;
  branch?: string;
  /** unidad actualmente en taller (isUnitEnTaller) */
  enTaller?: boolean;
  /** urgente ∪ llanta crítica ∪ svc vencido — mismo criterio que el hero H2 */
  atencion?: boolean;
  /** revisar/completar pendiente o svc próximo */
  revisar?: boolean;
};

export type FleetTile = {
  /** key para onSelect (uid si existe; si no, el label) */
  key: string;
  label: string;
  state: FleetTileState;
  tip: string;
};

export type FleetMapGroup = { branch: string; tiles: FleetTile[] };

const STATE_LABEL: Record<FleetTileState, string> = {
  urg: "Requiere atención",
  taller: "En taller",
  rev: "Revisar",
  ok: "Operativa",
};

/** urgente pinta aunque esté en taller? No: si ya está en taller, se está atendiendo. */
const STATE_ORDER: Record<FleetTileState, number> = { urg: 0, taller: 1, rev: 2, ok: 3 };

export function tileState(u: FleetMapInput): FleetTileState {
  if (u.enTaller) return "taller";
  if (u.atencion) return "urg";
  if (u.revisar) return "rev";
  return "ok";
}

/** Agrupa por sucursal (vacía → "Sin sucursal"); grupos grandes primero; dentro
 *  del grupo los tiles van por severidad y luego por ECO (orden numérico). */
export function buildFleetMapModel(units: readonly FleetMapInput[]): FleetMapGroup[] {
  const by = new Map<string, FleetTile[]>();
  for (const u of units) {
    const branch = String(u.branch ?? "").trim() || "Sin sucursal";
    const label = String(u.eco ?? u.plate ?? "?");
    const state = tileState(u);
    const tile: FleetTile = {
      key: String(u.uid ?? label),
      label,
      state,
      tip: `ECO ${label} · ${STATE_LABEL[state]} · ${branch}`,
    };
    const arr = by.get(branch);
    if (arr) arr.push(tile);
    else by.set(branch, [tile]);
  }
  const groups: FleetMapGroup[] = [...by.entries()].map(([branch, tiles]) => ({
    branch,
    tiles: tiles.sort(
      (a, b) =>
        STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
        a.label.localeCompare(b.label, undefined, { numeric: true }),
    ),
  }));
  return groups.sort((a, b) => b.tiles.length - a.tiles.length || a.branch.localeCompare(b.branch));
}

/** Pinta el modelo en `container`. Cada tile es un <button> accesible (aria-label
 *  + title nativo como tooltip); click → onSelect(key). */
export function renderFleetMap(
  container: HTMLElement,
  groups: readonly FleetMapGroup[],
  onSelect?: (key: string) => void,
): void {
  container.replaceChildren();
  for (const g of groups) {
    const wrap = document.createElement("div");
    wrap.className = "fm-group";
    const lbl = document.createElement("div");
    lbl.className = "fm-glbl";
    lbl.textContent = `${g.branch} · ${g.tiles.length}`;
    wrap.appendChild(lbl);
    const grid = document.createElement("div");
    grid.className = "fm-dots";
    for (const t of g.tiles) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `fm-tile fm-${t.state}`;
      b.title = t.tip;
      b.setAttribute("aria-label", t.tip);
      if (onSelect) {
        const k = t.key;
        b.addEventListener("click", () => onSelect(k));
      }
      grid.appendChild(b);
    }
    wrap.appendChild(grid);
    container.appendChild(wrap);
  }
}
