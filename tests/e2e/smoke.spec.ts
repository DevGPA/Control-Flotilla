import { test, expect } from "@playwright/test";

const APP_PATH = "/Control%20de%20flotilla.html";

test.describe("smoke — bootstrap básico", () => {
  test("carga la app sin errores de consola críticos", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        // Ignorar 404 favicon y warnings de SheetJS benignos
        if (text.includes("favicon")) return;
        if (text.includes("Bad uncompressed size")) return;
        errors.push(text);
      }
    });
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

    await page.goto(APP_PATH);
    await page.waitForLoadState("networkidle");

    // Vendor scripts cargados
    const xlsxLoaded = await page.evaluate(() => typeof window.XLSX !== "undefined");
    const jspdfLoaded = await page.evaluate(
      () => typeof window.jspdf !== "undefined" || typeof window.jsPDF !== "undefined",
    );
    expect(xlsxLoaded, "XLSX (vendor) debe estar cargado").toBe(true);
    expect(jspdfLoaded, "jsPDF (vendor) debe estar cargado").toBe(true);

    // Estado inicial: drop zone visible (sin datos)
    await expect(page.locator("#dz")).toBeVisible();
    await expect(page.locator("#hstxt")).toHaveText(/Sin datos cargados/);

    expect(errors, `Console errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("CSP bloquea conexiones externas (intento de fetch a CDN)", async ({ page }) => {
    await page.goto(APP_PATH);
    const blocked = await page.evaluate(async () => {
      try {
        const res = await fetch("https://cdn.sheetjs.com/test.js");
        return { ok: res.ok, blocked: false };
      } catch (e) {
        return { ok: false, blocked: true, msg: (e as Error).message };
      }
    });
    expect(blocked.blocked, "fetch a dominio externo debe ser bloqueado por CSP").toBe(true);
  });

  test("title y meta CSP presentes", async ({ page }) => {
    await page.goto(APP_PATH);
    await expect(page).toHaveTitle(/GPA Fleet Command/);
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
  });
});
