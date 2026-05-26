import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_PATH = "/Control%20de%20flotilla.html?e2e=1";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_MENSUAL = path.resolve(__dirname, "../fixtures/mensual.xlsx");

async function loadMensual(page: Page) {
  await page.goto(APP_PATH);
  await page.waitForLoadState("networkidle");
  await page.setInputFiles("#xinput", FIXTURE_MENSUAL);
  await expect(page.locator("#hfile")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#tbody").locator("> *").first()).toBeVisible({ timeout: 10_000 });
  // Modal puede aparecer async post-render — wait + force close
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
  await expect(page.locator("#periodo-modal.open")).toHaveCount(0, { timeout: 3000 });
}

test.describe("PDF regression — post jspdf 4.2.1 upgrade", () => {
  test("exportFleetPDF corre sin throw + captura primer error", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const t = msg.text();
        if (t.includes("favicon") || t.includes("source map") || t.includes("Bad uncompressed"))
          return;
        errors.push(t);
      }
    });

    await loadMensual(page);

    const result = await page.evaluate(async () => {
      try {
        const fn = (window as unknown as { exportFleetPDF?: () => Promise<void> }).exportFleetPDF;
        if (typeof fn !== "function") return { ok: false, err: "exportFleetPDF not function" };
        await fn();
        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          err: e instanceof Error ? e.message + "\n" + (e.stack || "") : String(e),
        };
      }
    });

    expect(
      result.ok,
      `exportFleetPDF error: ${result.err}\nConsole errors: ${errors.join("\n")}`,
    ).toBe(true);
  });

  test("exportPDF(unit) corre sin throw", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

    await loadMensual(page);
    await page.locator("#tbody").locator("> *").first().click();
    await page.waitForTimeout(500);

    const result = await page.evaluate(async () => {
      try {
        const fn = (window as unknown as { exportPDF?: () => Promise<void> }).exportPDF;
        if (typeof fn !== "function") return { ok: false, err: "exportPDF not function" };
        await fn();
        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          err: e instanceof Error ? e.message + "\n" + (e.stack || "") : String(e),
        };
      }
    });

    expect(result.ok, `exportPDF error: ${result.err}\nConsole: ${errors.join("\n")}`).toBe(true);
  });
});
