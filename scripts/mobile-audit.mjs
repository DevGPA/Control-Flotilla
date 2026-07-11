// Auditoría visual móvil (temporal): captura las vistas principales en viewport
// de celular con el fixture e2e cargado. Requiere dev server en :5190.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../test-results/mobile-audit");
mkdirSync(OUT, { recursive: true });
const FIXTURE = resolve(__dirname, "../tests/fixtures/mensual.xlsx");

const browser = await chromium.launch({ channel: "chrome" });
// iPhone 14/15 aprox — viewport chico + touch + DPR 3
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});
const page = await ctx.newPage();
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });

await page.goto("http://localhost:5190/Control%20de%20flotilla.html?e2e=1");
await page.waitForLoadState("networkidle");
await shot("01-boot-dropzone");

// Cargar fixture (20 unidades)
await page.setInputFiles("#xinput", FIXTURE);
// #hfile está oculto por CSS en móvil — esperar el estado de datos, no el DOM.
await page.waitForFunction(() => window.units && window.units.length > 0, null, {
  timeout: 15000,
});
// cerrar modal de período si aparece (por DOM: la clase .open intercepta clicks)
await page.waitForTimeout(800);
await page
  .evaluate(() => {
    const fn = window.closePeriodoModal;
    if (typeof fn === "function") fn();
    document.getElementById("periodo-modal")?.classList.remove("open");
  })
  .catch(() => {});
await page.waitForTimeout(400);
await shot("02-inspecciones-dashboard");

// Nav móvil (hamburguesa si existe)
const menuBtn = page.locator("#nav-toggle, .nav-burger, [aria-label*='men' i]").first();
if (await menuBtn.isVisible().catch(() => false)) {
  await menuBtn.click();
  await page.waitForTimeout(400);
  await shot("03-nav-movil-abierto");
  await page.keyboard.press("Escape").catch(() => {});
}

// Scroll a la tabla
await page.evaluate(() => document.getElementById("tw")?.scrollIntoView());
await page.waitForTimeout(300);
await shot("04-tabla-inspecciones");

// Detalle de unidad (click primera fila)
const firstRow = page.locator("#tbody > div, #tbody tr, #tbody [data-row]").first();
if (await firstRow.isVisible().catch(() => false)) {
  await firstRow.click();
  await page.waitForTimeout(700);
  await shot("05-detalle-unidad");
  // Cerrar el panel de detalle por DOM (Escape no siempre lo cierra y su overlay
  // contamina los screenshots de las demás vistas).
  await page.evaluate(() => document.getElementById("det")?.classList.remove("open"));
  await page.waitForTimeout(300);
}

// Vistas por pestaña (usar showView directo — el nav puede estar colapsado)
for (const [view, name] of [
  ["taller", "06-taller"],
  ["semanales", "07-semanales"],
  ["analytics", "08-analisis"],
  ["combustible", "09-combustible"],
  ["cumplimiento", "10-cumplimiento"],
]) {
  await page.evaluate((v) => window.showView && window.showView(v), view);
  await page.waitForTimeout(600);
  await shot(name);
}

await browser.close();
console.log("screenshots en", OUT);
