#!/usr/bin/env node
// verify-baseline.mjs — Compara estado DOM actual (capturado via vite-dev +
// preview_eval o devtools console) contra tests/fixtures/screenshots/baseline.json.
//
// Uso:
//   1. Levanta vite-dev (npm run dev) en otra terminal.
//   2. Abre http://localhost:5173/Control%20de%20flotilla.html en Chrome.
//   3. En devtools console, pega el snippet CAPTURE_SNIPPET de abajo y copia
//      el JSON que devuelve.
//   4. `node scripts/verify-baseline.mjs path/to/captured.json`
//
// Output: diff entre baseline y captured. Exit 1 si hay regresiones de tamaño
// > ±10% o elementos que cambiaron display/visible.

import { readFileSync } from "node:fs";

const TOLERANCE = 0.1;

export const CAPTURE_SNIPPET = `
(async () => {
  await document.fonts.ready;
  const sels = ['#hdr', '#mainnav', '#dz', '.hbrand', '.hname', '.hico', '.ubtn', '.mnav', '#kpi', '.hero-row', '#tb', '#det'];
  const out = {};
  for (const s of sels) {
    const el = document.querySelector(s);
    if (!el) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    out[s] = { display: cs.display, fontSize: cs.fontSize, w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 };
  }
  return { viewport: { w: innerWidth, h: innerHeight }, elements: out, horizontalOverflow: document.body.scrollWidth > innerWidth };
})()
`;

function diff(baseline, captured, viewportKey) {
  const regressions = [];
  const bEls = baseline[viewportKey]?.elements || {};
  const cEls = captured.elements || {};
  for (const [sel, b] of Object.entries(bEls)) {
    const c = cEls[sel];
    if (!c) {
      regressions.push(`${viewportKey} ${sel}: faltante en captura`);
      continue;
    }
    if (b.display !== c.display) {
      regressions.push(`${viewportKey} ${sel}: display ${b.display} -> ${c.display}`);
    }
    if (b.visible && !c.visible) {
      regressions.push(`${viewportKey} ${sel}: visible -> oculto`);
    }
    if (b.w && c.w && Math.abs(b.w - c.w) / b.w > TOLERANCE) {
      regressions.push(`${viewportKey} ${sel}: width ${b.w} -> ${c.w} (>${(TOLERANCE * 100).toFixed(0)}%)`);
    }
    if (b.h && c.h && Math.abs(b.h - c.h) / b.h > TOLERANCE) {
      regressions.push(`${viewportKey} ${sel}: height ${b.h} -> ${c.h} (>${(TOLERANCE * 100).toFixed(0)}%)`);
    }
  }
  if (baseline[viewportKey]?.horizontalOverflow === false && captured.horizontalOverflow) {
    regressions.push(`${viewportKey}: nuevo horizontal overflow`);
  }
  return regressions;
}

function main() {
  const [capPath] = process.argv.slice(2);
  if (!capPath) {
    console.log("Uso: node scripts/verify-baseline.mjs <captured.json>");
    console.log("\nSnippet para pegar en devtools console:");
    console.log(CAPTURE_SNIPPET);
    process.exit(0);
  }
  const baseline = JSON.parse(readFileSync("tests/fixtures/screenshots/baseline.json", "utf8"));
  const captured = JSON.parse(readFileSync(capPath, "utf8"));

  const viewports = ["mobile_375x812", "tablet_768x1024", "desktop_1280x800"];
  const key = viewports.find((v) => {
    const b = baseline[v];
    return b && b.viewport.w === captured.viewport.w;
  });
  if (!key) {
    console.error(`No baseline matches viewport w=${captured.viewport.w}`);
    process.exit(1);
  }

  const regs = diff(baseline, captured, key);
  if (regs.length === 0) {
    console.log(`OK ${key}: sin regresiones.`);
    process.exit(0);
  }
  console.log(`FAIL ${key}: ${regs.length} regresion(es):`);
  for (const r of regs) console.log("  - " + r);
  process.exit(1);
}

main();
