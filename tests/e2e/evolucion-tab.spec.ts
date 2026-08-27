import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_PATH = "/Control%20de%20flotilla.html?e2e=1";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_MENSUAL = path.resolve(__dirname, "../fixtures/mensual.xlsx");

// ════════════════════════════════════════════════════════════
// TAB EVOLUCIÓN — timeline por unidad en el expediente (etapa 2)
// ════════════════════════════════════════════════════════════
// Flujo offline/XLSX: __inspections no existe → la fuente cae a window.units
// (fixture de 1 mes ⇒ timeline de 1 fila, la abierta, con badge ABIERTA).

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

test.describe("Expediente · tab Evolución", () => {
  test("la tab existe, pinta el timeline y marca la inspección abierta", async ({ page }) => {
    await loadMensual(page);
    await page.locator("#tbody > *").first().click();
    await expect(page.locator("#det")).toHaveClass(/open/);

    const tabEv = page.locator("#dtabs .dtab", { hasText: "Evolución" });
    await expect(tabEv).toHaveCount(1);
    await tabEv.click();
    await page.waitForTimeout(300);

    // El body del expediente muestra el timeline (no el checklist)
    await expect(page.locator("#dbody .evol-timeline")).toBeVisible();
    const filas = page.locator("#dbody .evol-row");
    await expect(filas.first()).toBeVisible();
    // La inspección abierta lleva el badge ABIERTA
    await expect(page.locator("#dbody .evol-row.evol-active .evol-now")).toHaveText("ABIERTA");
  });

  test("saltar a otra inspección mantiene la tab Evolución activa", async ({ page }) => {
    await loadMensual(page);
    await page.locator("#tbody > *").first().click();
    // Simular histórico multi-mes: clonar la unidad abierta con fechas previas
    await page.evaluate(() => {
      const w = window as unknown as {
        units?: Array<Record<string, unknown>>;
        __inspections?: Array<Record<string, unknown>>;
        selId?: string | null;
        renderDet?: () => void;
      };
      const abierta = (w.units ?? []).find((u) => u.uid === w.selId);
      if (!abierta) return;
      const clon = (fecha: string) => ({ ...abierta, uid: `${abierta.plate}__${fecha}`, fecha });
      w.__inspections = [abierta, clon("2026-06-10"), clon("2026-05-05")] as never;
      w.renderDet?.();
    });
    await page.locator("#dtabs .dtab", { hasText: "Evolución" }).click();
    await page.waitForTimeout(300);
    const filas = page.locator("#dbody .evol-row");
    await expect(filas).toHaveCount(3);

    // Saltar a un mes viejo: el header cambia y la tab sigue siendo Evolución
    const fechaAntes = await page.locator("#dmeta").textContent();
    await filas.nth(2).click(); // la más vieja (2026-05-05)
    await page.waitForTimeout(400);
    await expect(page.locator("#dtabs .dtab.on", { hasText: "Evolución" })).toHaveCount(1);
    await expect(page.locator("#dbody .evol-timeline")).toBeVisible();
    const fechaDespues = await page.locator("#dmeta").textContent();
    expect(fechaDespues).not.toBe(fechaAntes);
    // La fila recién abierta ahora es la activa
    await expect(page.locator("#dbody .evol-row.evol-active")).toContainText("May 2026");
  });
});
