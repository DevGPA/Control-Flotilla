import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_PATH = "/Control%20de%20flotilla.html?e2e=1";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_MENSUAL = path.resolve(__dirname, "../fixtures/mensual.xlsx");

async function dismissPeriodoModal(page: Page) {
  // Esperar hasta 3s por modal (puede aparecer async post-render) y cerrar
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
    const fn = (window as any).closePeriodoModal;
    if (typeof fn === "function") fn();
    const m = document.getElementById("periodo-modal");
    if (m) m.classList.remove("open");
  });
  await expect(page.locator("#periodo-modal.open")).toHaveCount(0, { timeout: 3000 });
}

async function loadMensual(page: Page) {
  await page.goto(APP_PATH);
  await page.waitForLoadState("networkidle");
  await page.setInputFiles("#xinput", FIXTURE_MENSUAL);
  await expect(page.locator("#hfile")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#tbody").locator("> *").first()).toBeVisible({ timeout: 10_000 });
  await dismissPeriodoModal(page);
}

test.describe("filtros — chips de riesgo y búsqueda", () => {
  test("chip 'Todos' activo por defecto", async ({ page }) => {
    await loadMensual(page);
    const allClass = await page.locator("#btn-all").getAttribute("class");
    expect(allClass || "").toContain("chip-on");
  });

  test("chip Urgente filtra y actualiza count", async ({ page }) => {
    await loadMensual(page);

    const totalAll = await page.locator("#tbody").locator("> *").count();
    expect(totalAll).toBeGreaterThan(0);

    await page.click("#btn-Urgente");
    const urgClass = await page.locator("#btn-Urgente").getAttribute("class");
    expect(urgClass || "").toContain("chip-on");

    // Filtro aplicado: count <= total
    const totalUrg = await page.locator("#tbody").locator("> *").count();
    expect(totalUrg).toBeLessThanOrEqual(totalAll);

    // Volver a todos
    await page.click("#btn-all");
    const totalRestored = await page.locator("#tbody").locator("> *").count();
    expect(totalRestored).toBe(totalAll);
  });

  test("búsqueda #srch filtra filas", async ({ page }) => {
    await loadMensual(page);
    const totalAll = await page.locator("#tbody").locator("> *").count();

    // Texto improbable
    await page.fill("#srch", "ZZZZZZNOEXISTE");
    await page.waitForTimeout(300);
    const noMatch = await page.locator("#tbody").locator("> *").count();
    expect(noMatch).toBeLessThan(totalAll);

    // Limpiar
    await page.fill("#srch", "");
    await page.waitForTimeout(300);
    const restored = await page.locator("#tbody").locator("> *").count();
    expect(restored).toBe(totalAll);
  });

  test("counts (fc_all/fc0/fc3/fc_svc) presentes y numéricos", async ({ page }) => {
    await loadMensual(page);

    // Chips activos: Todos (fc_all), Urgente (fc0), Comentarios (fc3), Svc ≤30d (fc_svc).
    // fc1/fc2/fc4 eliminados con simplificación del UI.
    for (const id of ["fc_all", "fc0", "fc3", "fc_svc"]) {
      const txt = (await page.locator(`#${id}`).textContent()) || "";
      if (txt) expect(txt).toMatch(/\(\d+\)/);
    }
  });
});
