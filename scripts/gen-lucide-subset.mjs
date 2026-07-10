// Genera src/ui/lucideSubset.ts con SOLO los iconos que la app usa (~51 de 1,939).
//
// Perf F2-4: el vendor lucide.min.js completo pesa 388 KB para usar ~51 iconos.
// Este script extrae los iconNodes del vendor (fuente de verdad, sin red) y emite
// un módulo TS con un createIcons() compatible con el uso del monolito
// (window.lucide.createIcons()). Si un icono pedido no existe en el vendor, FALLA
// en build-time (mejor que un icono invisible en prod).
//
// Uso: node scripts/gen-lucide-subset.mjs   (re-correr si se agregan iconos nuevos)
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VENDOR = resolve(__dirname, "./vendor/lucide.min.js");
const OUT = resolve(__dirname, "../src/ui/lucideSubset.ts");

// ── Iconos usados por la app (auditoría 2026-07-10) ─────────────────────────
// Estáticos: grep -rhoE 'data-lucide="[a-z0-9-]+"' HTML+src
// Dinámicos: theme toggle (sun/moon), usuarios (user-x/user-check), alertas
// (a.icon: alert-circle/siren/...), _klbl (pie-chart/search), setBadge (shield-*).
// Si agregas un icono NUEVO en el código, añádelo aquí y re-corre este script.
const USED = [
  "alert-circle", "alert-triangle", "banknote", "calendar-clock", "calendar-range",
  "calendar-x", "camera", "camera-off", "car", "check", "check-circle-2",
  "check-square", "chevron-down", "circle", "clipboard-list", "clock", "cloud",
  "disc-3", "download", "droplet", "file-text", "gauge", "key-round", "lightbulb",
  "log-out", "menu", "message-square", "moon", "more-horizontal", "notebook-pen",
  "pencil", "pie-chart", "plus", "search", "settings", "shield", "shield-alert",
  "shield-check", "siren", "sun", "trash-2", "trending-up", "truck", "upload",
  "user", "user-check", "user-plus", "user-x", "wrench", "x", "zap",
];

// Cargar el UMD del vendor forzando la rama CommonJS (el package.json del proyecto
// es type:module → require normal no puebla exports).
const src = readFileSync(VENDOR, "utf8");
const exportsObj = {};
new Function("exports", "module", src)(exportsObj, { exports: exportsObj });
const icons = exportsObj.icons;
if (!icons) throw new Error("No se pudo extraer lucide.icons del vendor");

// kebab-case → PascalCase con dígitos como segmento ("check-circle-2" → "CheckCircle2")
const pascal = (kebab) =>
  kebab.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");

const entries = [];
const missing = [];
for (const name of USED) {
  const node = icons[pascal(name)];
  if (!node) { missing.push(name); continue; }
  entries.push(`  "${name}": ${JSON.stringify(node)},`);
}
if (missing.length) {
  throw new Error(`Iconos NO encontrados en el vendor: ${missing.join(", ")}`);
}

const ts = `// GENERADO por scripts/gen-lucide-subset.mjs — NO editar a mano.
// Perf F2-4: subset de ${USED.length} iconos Lucide (el vendor completo pesa 388 KB
// para ~51 usados). Para agregar un icono: añadirlo a USED en el script y re-correr.
// createIcons() replica el contrato del UMD: materializa <i data-lucide="x"> → <svg>,
// copiando los atributos del elemento (style/class/aria) y SIN conservar data-lucide
// en el svg (así los re-scans del MutationObserver solo procesan iconos nuevos).

type IconNode = ReadonlyArray<readonly [string, Record<string, string | number>]>;

const ICONS: Record<string, IconNode> = {
${entries.join("\n")}
};

const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_ATTRS: Record<string, string> = {
  xmlns: SVG_NS,
  width: "24",
  height: "24",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "2",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
};

/** Materializa todos los <i data-lucide> pendientes del documento (contrato del UMD). */
export function createIcons(): void {
  const els = document.querySelectorAll("[data-lucide]");
  els.forEach((el) => {
    const name = el.getAttribute("data-lucide") ?? "";
    const node = ICONS[name];
    if (!node) {
      // Icono fuera del subset: avisar en consola (visible en dev/e2e) y no tocar el DOM.
      console.warn(\`[lucideSubset] icono "\${name}" no está en el subset — agrégalo a scripts/gen-lucide-subset.mjs\`);
      return;
    }
    const svg = document.createElementNS(SVG_NS, "svg");
    for (const [k, v] of Object.entries(DEFAULT_ATTRS)) svg.setAttribute(k, v);
    // Copiar atributos del <i> (style, aria, id, width/height custom) — class se mergea.
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === "data-lucide" || attr.name === "class") continue;
      svg.setAttribute(attr.name, attr.value);
    }
    const extraClass = el.getAttribute("class");
    svg.setAttribute("class", \`lucide lucide-\${name}\${extraClass ? " " + extraClass : ""}\`);
    for (const [tag, attrs] of node) {
      const child = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) child.setAttribute(k, String(v));
      svg.appendChild(child);
    }
    el.replaceWith(svg);
  });
}
`;

writeFileSync(OUT, ts);
console.log(`subset generado: ${OUT} (${USED.length} iconos)`);
