#!/usr/bin/env node
/**
 * Compute sha256 hashes de los inline <script> blocks + inyecta en CSP del HTML.
 * Elimina necesidad de `'unsafe-inline'` — cada hash explícito autoriza un block.
 *
 * Uso: node scripts/compute-csp-hashes.mjs [--check]
 *   --check   Verifica que CSP meta tiene hashes vigentes. Sin modificar archivo.
 *             Exit 1 si desincronizado. Usar en CI para catch drift post-edit.
 *
 * Si agregas/modificas un <script> block sin src=, correr sin --check para regenerar.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const HTML_PATH = "Control de flotilla.html";
const NGINX_PATH = "nginx.conf";
const SCRIPT_BLOCK_RE = /<script>([\s\S]*?)<\/script>/g;

function sha256(content) {
  return createHash("sha256").update(content, "utf8").digest("base64");
}

function extractHashes(html) {
  const hashes = [];
  let match;
  SCRIPT_BLOCK_RE.lastIndex = 0;
  while ((match = SCRIPT_BLOCK_RE.exec(html)) !== null) {
    // Browser computa hash del content servido. Vite dev + nginx normalizan
    // CRLF→LF al servir HTML (verificado empíricamente Chrome dev tools).
    // Node readFileSync retorna raw (CRLF si archivo Windows).
    // Normalizar a LF antes del hash = match con browser.
    const body = match[1].replace(/\r\n/g, "\n");
    hashes.push(`'sha256-${sha256(body)}'`);
  }
  return hashes;
}

// connect-src endpoints AWS — necesarios para Amplify Gen 2:
// - cognito-idp.{region}.amazonaws.com → auth (signIn, getCurrentUser, etc.)
// - cognito-identity.{region}.amazonaws.com → identity pool (S3 access)
// - {appsync-id}.appsync-api.{region}.amazonaws.com → GraphQL queries/mutations
// - {appsync-id}.appsync-realtime-api.{region}.amazonaws.com → GraphQL subscriptions
// - {bucket}.s3.{region}.amazonaws.com → fotos S3
// Wildcard amazonaws.com cubre todos. amazoncognito.com necesario si activamos Hosted UI.
const AWS_ENDPOINTS = "https://*.amazonaws.com wss://*.amazonaws.com https://*.amazoncognito.com";

function buildCspDirective(hashes) {
  const scriptSrc = ["'self'", ...hashes].join(" ");
  // script-src-attr 'unsafe-inline': permite `onclick="..."` handlers statics (69 sites
  // HTML legado). NO permite inline <script> blocks (esos requieren hash).
  // Defense-in-depth: inline handlers escapan via escAttr/escHtml en generación;
  // external origins bloqueadas por script-src 'self'.
  return `default-src 'self'; script-src ${scriptSrc}; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://*.amazonaws.com; media-src 'self' blob: https://*.amazonaws.com; connect-src 'self' ${AWS_ENDPOINTS}; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'`;
}

function buildCspNginx(hashes) {
  const scriptSrc = ["'self'", ...hashes].join(" ");
  return `default-src 'self'; script-src ${scriptSrc}; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://*.amazonaws.com; media-src 'self' blob: https://*.amazonaws.com; connect-src 'self' ${AWS_ENDPOINTS}; font-src 'self' data:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`;
}

function updateHtml(html, hashes) {
  const newContent = buildCspDirective(hashes);
  return html.replace(
    /(<meta http-equiv="Content-Security-Policy" content=")[^"]+("\/>)/,
    `$1${newContent}$2`,
  );
}

function updateNginx(conf, hashes) {
  const newContent = buildCspNginx(hashes);
  return conf.replace(
    /(add_header Content-Security-Policy ")[^"]+(" always;)/,
    `$1${newContent}$2`,
  );
}

function main() {
  const check = process.argv.includes("--check");

  const html = readFileSync(HTML_PATH, "utf8");
  const hashes = extractHashes(html);

  if (!hashes.length) {
    console.warn("[csp] No inline <script> blocks detected");
    return;
  }

  console.log(`[csp] Computed ${hashes.length} sha256 hashes:`);
  hashes.forEach((h, i) => console.log(`  ${i + 1}. ${h}`));

  const updatedHtml = updateHtml(html, hashes);
  const nginxConf = readFileSync(NGINX_PATH, "utf8");
  const updatedNginx = updateNginx(nginxConf, hashes);

  const htmlChanged = updatedHtml !== html;
  const nginxChanged = updatedNginx !== nginxConf;

  if (check) {
    if (htmlChanged || nginxChanged) {
      console.error(
        "[csp] DRIFT: CSP en archivos no coincide con hashes actuales.",
      );
      console.error("  Correr sin --check para sincronizar.");
      console.error(`  HTML cambió: ${htmlChanged} | nginx cambió: ${nginxChanged}`);
      process.exit(1);
    }
    console.log("[csp] ✓ CSP sync con inline scripts actuales");
    return;
  }

  if (htmlChanged) {
    writeFileSync(HTML_PATH, updatedHtml, "utf8");
    console.log(`[csp] Updated ${HTML_PATH}`);
  } else {
    console.log(`[csp] ${HTML_PATH} already in sync`);
  }
  if (nginxChanged) {
    writeFileSync(NGINX_PATH, updatedNginx, "utf8");
    console.log(`[csp] Updated ${NGINX_PATH}`);
  } else {
    console.log(`[csp] ${NGINX_PATH} already in sync`);
  }
}

main();
