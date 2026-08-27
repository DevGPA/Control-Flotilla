import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_PATH = "/Control%20de%20flotilla.html?e2e=1";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_MENSUAL = path.resolve(__dirname, "../fixtures/mensual.xlsx");

// ════════════════════════════════════════════════════════════
// INSPECCIONES · PERIODO Y SEGUIMIENTO (feat/inspecciones-al-corriente)
// ════════════════════════════════════════════════════════════
// Cubre el flujo offline/XLSX (el e2e local no tiene cloud):
//  - presets de periodo inyectados y funcionales
//  - card Cobertura fail-closed sin catálogo cloud
//  - card Tendencia ya NO colapsa: muestra su empty state (antes era UI muerta)

async function dismissPeriodoModal(page: Page) {
  await page
    .waitForFunction(
      () => {
        const m = document.getElementById("periodo-modal");
        return m && m.classList.contains("open");
      },
      null,
      { timeout: 2000 },
    )
    .catch(() => {});
  await page.evaluate(() => {
    const w = window as unknown as { closePeriodoModal?: () => void };
    if (typeof w.closePeriodoModal === "function") w.closePeriodoModal();
    const m = document.getElementById("periodo-modal");
    if (m) m.classList.remove("open");
  });
}

async function loadMensual(page: Page) {
  await page.goto(APP_PATH);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("gpa_fleet");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.setInputFiles("#xinput", FIXTURE_MENSUAL);
  await expect(page.locator("#hfile")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#tbody").locator("> *").first()).toBeVisible({ timeout: 10_000 });
  await dismissPeriodoModal(page);
  await page.waitForTimeout(400);
}

test.describe("Inspecciones · atajos de periodo", () => {
  test("los 4 presets se inyectan en #periodo-bar tras el botón Aplicar", async ({ page }) => {
    await loadMensual(page);
    const grupo = page.locator("#periodo-bar .rango-presets");
    await expect(grupo).toHaveCount(1);
    const botones = grupo.locator("button.rp-btn");
    await expect(botones).toHaveCount(4);
    await expect(botones.nth(0)).toHaveText("Este mes");
    await expect(botones.nth(3)).toHaveText("Año");
  });

  test("click en 'Este mes' llena el rango (1º del mes → hoy) y marca activo", async ({ page }) => {
    await loadMensual(page);
    await page.evaluate(() => {
      (document.querySelector("#periodo-bar .rp-btn") as HTMLButtonElement).click();
    });
    const desde = await page.locator("#rango-desde").inputValue();
    const hasta = await page.locator("#rango-hasta").inputValue();
    expect(desde).toMatch(/^\d{4}-\d{2}-01$/);
    expect(hasta).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(desde.slice(0, 7)).toBe(hasta.slice(0, 7)); // mismo mes
    await expect(page.locator("#periodo-bar .rp-btn.active")).toHaveCount(1);
    // El contador refleja el rango (flujo offline: dedupe con fallback al conteo plano)
    await expect(page.locator("#rango-count")).toContainText("inspec");
  });
});

test.describe("Inspecciones · cobertura del ciclo", () => {
  test("la card existe y es fail-closed sin catálogo cloud (flujo XLSX)", async ({ page }) => {
    await loadMensual(page);
    const card = page.locator("#hero-cobertura");
    await expect(card).toHaveCount(1);
    // Sin window.__fleetUnits (catálogo cloud) la card se queda oculta.
    await expect(card).toBeHidden();
  });
});

test.describe("Analytics · tendencia mensual", () => {
  test("la card del trend ya no colapsa: sin datos muestra su empty state", async ({ page }) => {
    await loadMensual(page);
    await page.click("#mn-analytics");
    await page.waitForTimeout(800);
    const card = page.locator("#chart-card-trend");
    await expect(card).toBeVisible();
    const dataEmpty = await card.getAttribute("data-empty");
    expect(dataEmpty).toBeNull();
    // Flujo XLSX sin __inspections → empty state visible, con el copy nuevo (sin XLSX)
    const empty = page.locator("#chart-trend-empty");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("al menos 2 meses");
    await expect(empty).not.toContainText("XLSX");
  });
});
