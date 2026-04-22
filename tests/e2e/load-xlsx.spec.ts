import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_PATH = "/Control%20de%20flotilla.html";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_MENSUAL = path.resolve(__dirname, "../../public/mensual.xlsx");

test.describe("loadXLSX — flujo mensual", () => {
  test("carga XLSX mensual y renderiza tabla con filas", async ({ page }) => {
    await page.goto(APP_PATH);
    await page.waitForLoadState("networkidle");

    // Estado inicial: tabla vacía
    const initialRows = await page.locator("#tbody [data-row], #tbody tr").count();
    expect(initialRows).toBe(0);

    // Disparar input file (oculto)
    await page.setInputFiles("#xinput", FIXTURE_MENSUAL);

    // Esperar render — hfile se muestra cuando carga lista
    await expect(page.locator("#hfile")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#hdot.live")).toBeVisible();

    // Cerrar modal de período si aparece (mes/año)
    const modal = page.locator("#periodo-modal.open");
    if (await modal.isVisible().catch(() => false)) {
      await page.evaluate(() => {
        const fn = (window as any).closePeriodoModal;
        if (typeof fn === "function") fn();
      });
    }

    // Filas renderizadas
    const rowsHandle = page.locator("#tbody [data-row], #tbody .row, #tbody > div");
    await expect(rowsHandle.first()).toBeVisible({ timeout: 10_000 });
    const rowCount = await rowsHandle.count();
    expect(rowCount).toBeGreaterThan(0);

    // rcnt actualizado
    const rcntText = await page.locator("#rcnt").textContent();
    expect(rcntText).toMatch(/\d+/);

    // hfile contiene nombre del archivo
    const hfileText = await page.locator("#hfile").textContent();
    expect(hfileText?.toLowerCase()).toContain("mensual");
  });

  test("rechaza archivo no XLSX sin crash", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto(APP_PATH);
    await page.waitForLoadState("networkidle");

    // Crear blob basura como "archivo.xlsx"
    await page.evaluate(() => {
      const dt = new DataTransfer();
      const file = new File([new Uint8Array([0x00, 0x01, 0x02, 0x03])], "fake.xlsx", {
        type: "application/vnd.ms-excel",
      });
      dt.items.add(file);
      const inp = document.getElementById("xinput") as HTMLInputElement;
      inp.files = dt.files;
      inp.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // App debe seguir viva — sin pageerror
    await page.waitForTimeout(2000);
    expect(errors).toEqual([]);
    await expect(page.locator("#srch")).toBeVisible();
  });
});
