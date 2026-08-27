// Atajos de periodo para la barra de rango de Inspecciones (#periodo-bar).
//
// El ciclo de inspección es mensual, pero el único control era el rango libre
// Desde/Hasta: ver "el mes pasado" exigía teclear dos fechas. Estos presets
// convierten los periodos de trabajo reales (mes, mes anterior, trimestre,
// año) en un clic, sin quitar el rango libre.
//
// Los botones se INYECTAN por DOM (createElement) para no tocar el HTML
// legado (cero csp:sync). Reutilizan el CSS .rango-presets/.rp-btn que ya
// existía en main.css (UX Fase 1) sin consumidores.
//
// Fechas: aritmética pura de strings/números con `hoyISO` inyectable — JAMÁS
// toISOString()/getMonth() sobre `new Date()` (en UTC-6 el día se corre; bug
// documentado en src/dashboard/charts.ts). El "hoy" local real lo da
// hoyLocalISO() vía Intl con America/Mexico_City (precedente cloudHydrate).

import { diasEnMes } from "../dates";

declare global {
  interface Window {
    /** Función global del legado (script clásico): aplica el rango Desde/Hasta. */
    aplicarRango?: () => void;
  }
}

export type PresetId = "mes" | "mesAnterior" | "trimestre" | "anio";

export type PresetRange = { desde: string; hasta: string };

/** Etiquetas de los botones, en orden de render. */
export const PRESETS: ReadonlyArray<{ id: PresetId; label: string; title: string }> = [
  { id: "mes", label: "Este mes", title: "Del 1º del mes a hoy" },
  { id: "mesAnterior", label: "Mes anterior", title: "El mes calendario anterior completo" },
  { id: "trimestre", label: "Trimestre", title: "Del inicio del trimestre calendario a hoy" },
  { id: "anio", label: "Año", title: "Del 1 de enero a hoy" },
];

/** "Hoy" local de México en ISO YYYY-MM-DD (México sin DST desde 2022). */
export function hoyLocalISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}

/** Calcula el rango [desde, hasta] en ISO para un preset, dado el día actual. */
export function presetRange(preset: PresetId, hoyISO: string): PresetRange {
  const m = hoyISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`hoyISO inválido: ${hoyISO}`);
  const anio = parseInt(m[1]!, 10);
  const mes = parseInt(m[2]!, 10);
  const mm = (n: number) => String(n).padStart(2, "0");

  switch (preset) {
    case "mes":
      return { desde: `${anio}-${mm(mes)}-01`, hasta: hoyISO };
    case "mesAnterior": {
      const aPrev = mes === 1 ? anio - 1 : anio;
      const mPrev = mes === 1 ? 12 : mes - 1;
      return {
        desde: `${aPrev}-${mm(mPrev)}-01`,
        hasta: `${aPrev}-${mm(mPrev)}-${mm(diasEnMes(aPrev, mPrev))}`,
      };
    }
    case "trimestre": {
      // Trimestre calendario en curso: Q3 (jul-sep) con hoy=2026-08-26 → desde 2026-07-01.
      const mQ = Math.floor((mes - 1) / 3) * 3 + 1;
      return { desde: `${anio}-${mm(mQ)}-01`, hasta: hoyISO };
    }
    case "anio":
      return { desde: `${anio}-01-01`, hasta: hoyISO };
  }
}

/**
 * Inyecta los botones de preset en #periodo-bar (tras #btn-rango) y los
 * cablea. No-op si la barra no existe. Idempotente (marca data-wired).
 * Aplicar el rango a mano (#btn-rango) limpia el preset activo.
 */
export function wirePeriodoPresets(doc: Document = document): void {
  const bar = doc.getElementById("periodo-bar");
  const btnRango = doc.getElementById("btn-rango");
  if (!bar || !btnRango) return;
  if (bar.querySelector(".rango-presets")) return; // ya cableado

  const grupo = doc.createElement("span");
  grupo.className = "rango-presets";
  grupo.setAttribute("role", "group");
  grupo.setAttribute("aria-label", "Atajos de periodo");
  grupo.dataset.wired = "1";

  const limpiarActivo = () => {
    grupo.querySelectorAll(".rp-btn.active").forEach((b) => b.classList.remove("active"));
  };

  for (const p of PRESETS) {
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "rp-btn";
    btn.textContent = p.label;
    btn.title = p.title;
    btn.addEventListener("click", () => {
      const desde = doc.getElementById("rango-desde") as HTMLInputElement | null;
      const hasta = doc.getElementById("rango-hasta") as HTMLInputElement | null;
      if (!desde || !hasta) return;
      const rango = presetRange(p.id, hoyLocalISO());
      desde.value = rango.desde;
      hasta.value = rango.hasta;
      if (typeof window.aplicarRango === "function") window.aplicarRango();
      limpiarActivo();
      btn.classList.add("active");
    });
    grupo.appendChild(btn);
  }

  btnRango.insertAdjacentElement("afterend", grupo);
  // Rango aplicado a mano ⇒ el preset deja de describir lo que se ve.
  btnRango.addEventListener("click", limpiarActivo);
}
