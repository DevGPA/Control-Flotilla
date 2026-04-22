import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_PATH = "/Control%20de%20flotilla.html";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_MENSUAL = path.resolve(__dirname, "../../public/mensual.xlsx");

async function dismissPeriodoModal(page) {
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

async function loadMensual(page) {
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

  test("counts (fc_all/fc0/fc1/fc2) presentes y numéricos", async ({ page }) => {
    await loadMensual(page);

    for (const id of ["fc_all", "fc0", "fc1", "fc2"]) {
      const txt = (await page.locator(`#${id}`).textContent()) || "";
      // Formato: "(123)" o vacío si 0
      if (txt) expect(txt).toMatch(/\(\d+\)/);
    }
  });
});
