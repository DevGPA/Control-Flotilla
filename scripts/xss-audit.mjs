#!/usr/bin/env node
// XSS audit: busca sinks de HTML crudo con template literals ${...} que no pasan
// por escHtml/escAttr ni son variables internas conocidas (constantes, loops, colores).
// Uso:  node scripts/xss-audit.mjs [ruta1] [ruta2] ...
// Exit code 0 si limpio, 1 si hay sospechosos. Wire a CI para que bloquee regresiones.
//
// A-5: acepta N rutas, no una sola. La segunda superficie HTML del repo
// (amplify/functions/taller-portal/pagina.ts) es la UNICA con texto de un
// tercero NO autenticado y estaba fuera de la guardia por completo — hoy esta
// limpia, pero sin guardia la siguiente edicion no tendria quien la detuviera.
// El regex de sinks tambien se amplia: innerHTML no es el unico camino a HTML
// crudo — outerHTML, insertAdjacentHTML y document.write hacen lo mismo.

import { readFileSync } from 'node:fs';

const targets = process.argv.slice(2);
if (targets.length === 0) targets.push('Control de flotilla.html');

const SINK_RE = /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write/;

const safeFns = /^(escHtml|escAttr|escaparHtml|Number|String|Math|parseFloat|parseInt|mkpill|fcell|tcell|safeHTML|raw)\(/;
const internalVars = new RegExp('^(' + [
  // layout/geom
  'cx','cy','R','sw','w','h','x','y','dx','dy','sz','mb','mp','pg','pd','ms',
  // colors / styles
  'c','k','l','n','at','ab','al','ac','bg','fg','rt','color','icon','sp',
  // ui state
  'on','cnt','badge','label','id','text','detail','action','tab','scroll',
  // loop / generic
  'i','j','t','r','u','rv','ok','comp','hm',
  // data
  'a','b','v','f','d','e','g','m','p','q','s','z','el','url','grp','html',
  'rows','paths','val','svc','dm','pct','lbl','first','last','total','ico',
  // pre-rendered HTML chunks (deben estar escapados en su construcción aguas arriba)
  'obsCards','weeklyCard','manThumbs','thumbs','tabs','chips','pills','kpis',
  'rowsHtml','summaryHtml','filterBar','itemsHtml','kpiBar','endpoints',
  // sw-pill del panel semanal: enums fijos derivados de effRisk (ok/rev/urg) +
  // icono/label literales — no llevan input de usuario (revisado 2026-06-11).
  'pillCls','pillIco','pillLbl',
].join('|') + ')$', 'i');

let total = 0;
for (const target of targets) {
  const src = readFileSync(target, 'utf8');
  const lines = src.split(/\r?\n/);
  const susp = [];

  lines.forEach((ln, idx) => {
    if (!SINK_RE.test(ln)) return;
    const matches = ln.match(/\$\{([^}]+)\}/g);
    if (!matches) return;

    const bad = matches.filter((x) => {
      const inner = x.slice(2, -1).trim();
      if (safeFns.test(inner)) return false;
      if (/\.toFixed\(|\.toLocaleString\(|\.length\b/.test(inner)) return false;
      if (/^["`']/.test(inner)) return false;
      if (/^\d/.test(inner)) return false;
      if (/^[a-z_$][a-z0-9_$]*$/i.test(inner) && internalVars.test(inner)) return false;
      if (/^\s*$/.test(inner)) return false;
      return true;
    });

    if (bad.length) susp.push([idx + 1, bad.join(' | '), ln.trim().substring(0, 150)]);
  });

  console.log(`[xss-audit] ${target}: ${susp.length} sospechoso(s)`);
  susp.forEach(([n, b, l]) => console.log(`  L${n}: ${b}\n    ${l}`));
  total += susp.length;
}

process.exit(total ? 1 : 0);
