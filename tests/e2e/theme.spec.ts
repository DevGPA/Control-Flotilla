import { test, expect } from "@playwright/test";

const APP_PATH = "/Control%20de%20flotilla.html?e2e=1";

test.describe("theme — toggle claro/oscuro persistente", () => {
  test("toggle alterna data-theme y persiste en localStorage", async ({ page }) => {
    await page.goto(APP_PATH);
    await page.evaluate(() => localStorage.removeItem("gpa-theme"));
    await page.reload();
    await expect(page.locator("#btn-theme")).toBeVisible();

    // Estado inicial: light (sin data-theme o data-theme!="dark")
    const initialTheme = await page.evaluate(
      () => document.documentElement.getAttribute("data-theme") || "light",
    );
    expect(["light", "dark"]).toContain(initialTheme);

    // Click → toggle
    await page.click("#btn-theme");
    const afterFirst = await page.evaluate(
      () => document.documentElement.getAttribute("data-theme") || "light",
    );
    expect(afterFirst).not.toBe(initialTheme);

    // Persistido en localStorage
    const stored = await page.evaluate(() => localStorage.getItem("gpa-theme"));
    expect(stored).toBe(afterFirst === "dark" ? "dark" : "light");

    // Reload → mantiene tema
    await page.reload();
    await page.waitForLoadState("networkidle");
    const afterReload = await page.evaluate(
      () => document.documentElement.getAttribute("data-theme") || "light",
    );
    expect(afterReload).toBe(afterFirst);
  });

  test("doble toggle vuelve al estado original", async ({ page }) => {
    await page.goto(APP_PATH);
    const t0 = await page.evaluate(
      () => document.documentElement.getAttribute("data-theme") || "light",
    );
    await page.click("#btn-theme");
    await page.click("#btn-theme");
    const t2 = await page.evaluate(
      () => document.documentElement.getAttribute("data-theme") || "light",
    );
    expect(t2).toBe(t0);
  });
});
