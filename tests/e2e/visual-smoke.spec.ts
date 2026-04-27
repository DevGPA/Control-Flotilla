import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_PATH = "/Control%20de%20flotilla.html";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_MENSUAL = path.resolve(__dirname, "../fixtures/mensual.xlsx");

// Visual smoke post audit-P1: captura screenshots de todas las vistas clave
// en light + dark mode. No hace assertions strict — solo snapshots para
// revisión manual (paleta Tremor migration + hex→vars regression check).
//
// Screenshots salen a test-results/visual-smoke/<view>-<theme>.png

async function dismissPeriodoModal(page: Page) {
  await page
    .waitForFunction(
      () => {
        const m = document.getElementById("periodo-modal");
        return m && m.classList.contains("open");
      },
      null,
      { timeout: 3000 },
    )
    .catch(() => {});
  await page.evaluate(() => {
    const fn = (window as unknown as { closePeriodoModal?: () => void }).closePeriodoModal;
    if (typeof fn === "function") fn();
    const m = document.getElementById("periodo-modal");
    if (m) m.classList.remove("open");
  });
}

async function setTheme(page: Page, mode: "light" | "dark") {
  await page.evaluate((m) => {
    if (m === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    try {
      localStorage.setItem("gpa-theme", m);
    } catch {
      // localStorage may be unavailable in private mode — ignore
    }
  }, mode);
  await page.waitForTimeout(300); // dejar que ECharts + custom CSS resyncren
}

async function loadMensual(page: Page) {
  await page.goto(APP_PATH);
  await page.waitForLoadState("networkidle");
  await page.setInputFiles("#xinput", FIXTURE_MENSUAL);
  await expect(page.locator("#hfile")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#tbody").locator("> *").first()).toBeVisible({ timeout: 10_000 });
  await dismissPeriodoModal(page);
}

test.describe("visual smoke — paleta Tremor + dark mode", () => {
  test.describe.configure({ mode: "serial" });

  for (const theme of ["light", "dark"] as const) {
    test(`${theme} mode — dashboard + analytics panel + tabla`, async ({ page }) => {
      await loadMensual(page);
      await setTheme(page, theme);

      // Cambia a vista Análisis (4º tab) para capturar widgets
      await page.click("#mn-analytics");
      await page.waitForTimeout(800); // ECharts render

      // Screenshot full-page (dashboard + analytics + tabla)
      await page.screenshot({
        path: `test-results/visual-smoke/dashboard-${theme}.png`,
        fullPage: true,
      });

      // Verifica que charts del panel analytics estén visibles
      await expect(page.locator("#chart-branches")).toBeVisible();
      await expect(page.locator("#chart-categories")).toBeVisible();
    });

    test(`${theme} mode — alerts panel visible (si aplica)`, async ({ page }) => {
      await loadMensual(page);
      await setTheme(page, theme);

      const alerts = page.locator("#alerts-panel");
      if (await alerts.isVisible().catch(() => false)) {
        await alerts.screenshot({
          path: `test-results/visual-smoke/alerts-${theme}.png`,
        });
      }
    });

    test(`${theme} mode — taller tab`, async ({ page }) => {
      await loadMensual(page);
      await setTheme(page, theme);

      await page.click("text=Taller");
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `test-results/visual-smoke/taller-${theme}.png`,
        fullPage: true,
      });
    });

    test(`${theme} mode — semanal tab`, async ({ page }) => {
      await loadMensual(page);
      await setTheme(page, theme);

      await page.click("text=Semanales");
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `test-results/visual-smoke/semanal-${theme}.png`,
        fullPage: true,
      });
    });
  }
});
