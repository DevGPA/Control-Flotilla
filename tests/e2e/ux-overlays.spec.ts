import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_PATH = "/Control%20de%20flotilla.html?e2e=1";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_MENSUAL = path.resolve(__dirname, "../fixtures/mensual.xlsx");

// Auditoría UX 2026-07 · Fase F1 (encimamientos):
//  H1 — el panel #det NO debe permanecer abierto al cambiar de vista
//  H2 — el modal de Flota debe apilarse SOBRE #det y su botón ✕ debe vivir
//       dentro de la tarjeta del modal (no en la esquina del viewport)

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

async function loadMensual(page: Page) {
  await page.goto(APP_PATH);
  await page.waitForLoadState("networkidle");
  await page.setInputFiles("#xinput", FIXTURE_MENSUAL);
  await expect(page.locator("#hfile")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#tbody").locator("> *").first()).toBeVisible({ timeout: 10_000 });
  await dismissPeriodoModal(page);
}

async function openDetFromFirstRow(page: Page) {
  await page.evaluate(() => {
    const tb = document.getElementById("tbody");
    (tb?.firstElementChild as HTMLElement | null)?.click();
  });
  await expect(page.locator("#det.open")).toBeVisible({ timeout: 5_000 });
}

test.describe("UX F1 — encimamientos (#det entre vistas + modal Flota)", () => {
  test("H1: #det se cierra al cambiar de vista y no tapa Taller", async ({ page }) => {
    await loadMensual(page);
    await openDetFromFirstRow(page);

    await page.click("#mn-taller");
    await expect(page.locator("#det.open")).toHaveCount(0);
    await expect(page.locator("#det")).toBeHidden();
  });

  test("H1: #det tampoco sobrevive al pasar a Semanales ni a Análisis", async ({ page }) => {
    await loadMensual(page);
    await openDetFromFirstRow(page);

    await page.click("#mn-semanales");
    await expect(page.locator("#det.open")).toHaveCount(0);

    // volver a Inspecciones no lo re-abre solo
    await page.click("#mn-insp");
    await expect(page.locator("#det.open")).toHaveCount(0);

    await openDetFromFirstRow(page);
    await page.click("#mn-analytics");
    await expect(page.locator("#det.open")).toHaveCount(0);
  });

  test("H2: modal Flota apila sobre #det y su ✕ vive dentro de la tarjeta", async ({ page }) => {
    await loadMensual(page);
    await openDetFromFirstRow(page);

    await page.evaluate(() => {
      (window as unknown as { openFleetModal: (f?: string) => void }).openFleetModal();
    });
    const modal = page.locator("#fleet-modal");
    await expect(modal).toBeVisible();

    // z-index del modal por encima del panel #det (300)
    const z = await modal.evaluate((el) => parseInt(getComputedStyle(el).zIndex, 10));
    const detZ = await page
      .locator("#det")
      .evaluate((el) => parseInt(getComputedStyle(el).zIndex, 10) || 0);
    expect(z).toBeGreaterThan(detZ);

    // el botón cerrar debe quedar contenido en la tarjeta del modal
    const card = await modal.locator("> div").boundingBox();
    const close = await modal.locator(".dcls").boundingBox();
    expect(card).not.toBeNull();
    expect(close).not.toBeNull();
    if (card && close) {
      expect(close.x).toBeGreaterThanOrEqual(card.x);
      expect(close.x + close.width).toBeLessThanOrEqual(card.x + card.width + 1);
      expect(close.y).toBeGreaterThanOrEqual(card.y);
      expect(close.y + close.height).toBeLessThanOrEqual(card.y + card.height + 1);
    }

    // y debe cerrar el modal al click
    await modal.locator(".dcls").click();
    await expect(modal).toBeHidden();
  });
});
