import { test, expect } from "@playwright/test";

const APP_PATH = "/Control%20de%20flotilla.html?e2e=1";

test.describe("smoke — bootstrap básico", () => {
  test("carga la app sin errores de consola críticos", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      // Perf F2-4: un icono pedido que no está en el subset de Lucide emite un
      // console.warn("[lucideSubset] …") — tratarlo como FALLO del smoke para
      // detectar iconos faltantes en cuanto una vista los pida.
      if (msg.type() === "warning" && text.includes("[lucideSubset]")) {
        errors.push(text);
        return;
      }
      if (msg.type() === "error") {
        // Ignorar 404 favicon y warnings de SheetJS benignos. Chrome real (channel:
        // "chrome") pone la URL del recurso en msg.location(), no en el text — cubrir
        // ambos para que el spec sea estable cross-browser (chromium no pide favicon).
        if (text.includes("favicon") || msg.location().url.includes("favicon")) return;
        if (text.includes("Bad uncompressed size")) return;
        errors.push(text);
      }
    });
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

    await page.goto(APP_PATH);
    await page.waitForLoadState("networkidle");

    // Perf F1-6: xlsx/jspdf NO deben cargar en el boot (salen del critical path,
    // ~1.34 MB). Se inyectan on-demand vía ensureXLSX()/ensureJsPDF() al importar/
    // exportar — el flujo real lo valida load-xlsx.spec (setInputFiles → re-entra).
    const xlsxLoaded = await page.evaluate(
      () => typeof (window as unknown as { XLSX?: unknown }).XLSX !== "undefined",
    );
    const jspdfLoaded = await page.evaluate(() => {
      const w = window as unknown as { jspdf?: unknown };
      return typeof w.jspdf !== "undefined";
    });
    const loadersReady = await page.evaluate(() => {
      const w = window as unknown as { ensureXLSX?: unknown; ensureJsPDF?: unknown };
      return typeof w.ensureXLSX === "function" && typeof w.ensureJsPDF === "function";
    });
    expect(xlsxLoaded, "XLSX NO debe cargar en el boot (lazy F1-6)").toBe(false);
    expect(jspdfLoaded, "jsPDF NO debe cargar en el boot (lazy F1-6)").toBe(false);
    expect(loadersReady, "ensureXLSX/ensureJsPDF deben estar disponibles").toBe(true);

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
    const csp = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute("content");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
  });
});
