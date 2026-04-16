#!/usr/bin/env node
// XSS audit: busca innerHTML con template literals ${...} que no pasan por
// escHtml/escAttr ni son variables internas conocidas (constantes, loops, colores).
// Uso:  node scripts/xss-audit.mjs [ruta.html]
// Exit code 0 si limpio, 1 si hay sospechosos. Wire a CI para que bloquee regresiones.

import { readFileSync } from 'node:fs';

const target = process.argv[2] || 'Control de flotilla.html';
const src = readFileSync(target, 'utf8');
const lines = src.split(/\r?\n/);

const safeFns = /^(escHtml|escAttr|Number|String|Math|parseFloat|parseInt|mkpill|fcell|tcell|safeHTML|raw)\(/;
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
].join('|') + ')$', 'i');

const susp = [];
lines.forEach((ln, idx) => {
  if (!ln.includes('.innerHTML')) return;
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
process.exit(susp.length ? 1 : 0);
