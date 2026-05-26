import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_PATH = "/Control%20de%20flotilla.html?e2e=1";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_MENSUAL = path.resolve(__dirname, "../fixtures/mensual.xlsx");
const DB_NAME = "gpa_fleet";

test.describe("persist+restore — IndexedDB session", () => {
  async function wipeIDB(page: Page) {
    await page.goto(APP_PATH);
    await page.evaluate(
      (dbName: string) =>
        new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(dbName);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        }),
      DB_NAME,
    );
  }

  test("loadXLSX → IDB tiene meta.session", async ({ page }) => {
    await wipeIDB(page);
    await page.goto(APP_PATH);
    await page.waitForLoadState("networkidle");

    await page.setInputFiles("#xinput", FIXTURE_MENSUAL);
    await expect(page.locator("#hfile")).toBeVisible({ timeout: 15_000 });

    // Cerrar modal de período si aparece
    await page.evaluate(() => {
      const fn = (window as any).closePeriodoModal;
      if (typeof fn === "function") fn();
    });

    // Esperar persistState (async, post-render)
    await page.waitForTimeout(2000);

    const session = await page.evaluate((dbName) => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("meta")) {
            resolve(null);
            return;
          }
          const tx = db.transaction("meta", "readonly");
          const getReq = tx.objectStore("meta").get("session");
          getReq.onsuccess = () => resolve(getReq.result);
          getReq.onerror = () => reject(getReq.error);
        };
        req.onerror = () => reject(req.error);
      });
    }, DB_NAME);

    expect(session).toBeTruthy();
    expect((session as any).units).toBeTruthy();
    expect(Array.isArray((session as any).units)).toBe(true);
    expect((session as any).units.length).toBeGreaterThan(0);
    expect((session as any).filename).toContain("mensual");
  });

  test("reload restaura sesión sin re-cargar XLSX", async ({ page }) => {
    await wipeIDB(page);
    // Primer load: cargar XLSX
    await page.goto(APP_PATH);
    await page.waitForLoadState("networkidle");
    await page.setInputFiles("#xinput", FIXTURE_MENSUAL);
    await expect(page.locator("#hfile")).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => {
      const fn = (window as any).closePeriodoModal;
      if (typeof fn === "function") fn();
    });
    await page.waitForTimeout(2000); // dejar que persistState termine

    const rowsBefore = await page.locator("#tbody").locator("> *").count();
    expect(rowsBefore).toBeGreaterThan(0);

    // Reload — restoreState debe ejecutarse
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Verificar mensaje "Sesión restaurada" o filas presentes
    await expect(page.locator("#tbody").locator("> *").first()).toBeVisible({ timeout: 10_000 });
    const rowsAfter = await page.locator("#tbody").locator("> *").count();
    expect(rowsAfter).toBe(rowsBefore);

    const hstxt = await page.locator("#hstxt").textContent();
    expect(hstxt?.toLowerCase()).toContain("restaurada");
  });
});
