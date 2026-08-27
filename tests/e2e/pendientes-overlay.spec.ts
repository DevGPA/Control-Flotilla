import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_PATH = "/Control%20de%20flotilla.html?e2e=1";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_MENSUAL = path.resolve(__dirname, "../fixtures/mensual.xlsx");

// ════════════════════════════════════════════════════════════
// PENDIENTES: overlay auto-resueltos + arrastre (spec 2026-07-23 + 2026-08-27)
// ════════════════════════════════════════════════════════════
// El overlay real corre SOLO en hidratación cloud (?e2e=1 no la tiene, spec §7)
// — aquí se inyectan entradas/histórico sintéticos para ejercitar las
// superficies del monolito, que es lo que prod ve.

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

test.describe("Overlay auto-resueltos — superficies del monolito", () => {
  test("celda HALLAZGOS muestra el renglón verde tachado con fecha", async ({ page }) => {
    await loadMensual(page);
    const ok = await page.evaluate(() => {
      const w = window as unknown as {
        units?: Array<{ uid: string; F: Array<{ key?: string; text: string }> }>;
        checklistDB?: Record<string, Record<string, unknown>>;
        findingKey?: (f: { key?: string; text: string }) => string;
        renderTable?: () => void;
      };
      const u = (w.units ?? []).find((x) => x.F.length > 0);
      if (!u || !w.findingKey) return false;
      const k = w.findingKey(u.F[0]!);
      w.checklistDB = w.checklistDB ?? {};
      w.checklistDB[u.uid] = w.checklistDB[u.uid] ?? {};
      w.checklistDB[u.uid]![k] = { done: true, ts: "2026-07-06", by: "auto", auto: true };
      w.renderTable?.();
      return true;
    });
    expect(ok).toBe(true);
    await expect(page.locator("#tbody")).toContainText("resuelto · 06/07/2026");
  });

  test("detalle: leyenda 'resuelto — inspección' en el ítem auto-resuelto", async ({ page }) => {
    await loadMensual(page);
    const uid = await page.evaluate(() => {
      const w = window as unknown as {
        units?: Array<{ uid: string; F: Array<{ key?: string; text: string }> }>;
        checklistDB?: Record<string, Record<string, unknown>>;
        findingKey?: (f: { key?: string; text: string }) => string;
      };
      const u = (w.units ?? []).find((x) => x.F.length > 0);
      if (!u || !w.findingKey) return null;
      const k = w.findingKey(u.F[0]!);
      w.checklistDB = w.checklistDB ?? {};
      w.checklistDB[u.uid] = w.checklistDB[u.uid] ?? {};
      w.checklistDB[u.uid]![k] = { done: true, ts: "2026-07-06", by: "auto", auto: true };
      return u.uid;
    });
    expect(uid).toBeTruthy();
    await page.evaluate((id) => {
      (window as unknown as { selUnit?: (uid: string) => void }).selUnit?.(id as string);
    }, uid);
    await expect(page.locator("#det")).toHaveClass(/open/);
    await expect(page.locator("#dbody")).toContainText("resuelto — inspección 06/07/2026");
  });

  test("arrastre: chip '⏳ desde' en pendiente reportado en meses consecutivos", async ({
    page,
  }) => {
    await loadMensual(page);
    const uid = await page.evaluate(() => {
      const w = window as unknown as {
        units?: Array<{ uid: string; plate?: string; F: unknown[] }>;
        __inspections?: unknown[];
        selUnit?: (uid: string) => void;
      };
      const u = (w.units ?? []).find((x) => x.F.length > 0);
      if (!u) return null;
      const clon = (fecha: string) => ({ ...u, uid: `${u.plate}__${fecha}`, fecha });
      // Histórico sintético ANTERIOR al ancla (el arrastre mira hacia atrás):
      // el mismo hallazgo reportado 3 inspecciones seguidas.
      w.__inspections = [u, clon("2026-05-05"), clon("2026-04-05")] as never;
      return u.uid;
    });
    expect(uid).toBeTruthy();
    await page.evaluate((id) => {
      (window as unknown as { selUnit?: (uid: string) => void }).selUnit?.(id as string);
    }, uid);
    await expect(page.locator("#det")).toHaveClass(/open/);
    const chips = page.locator("#dbody .ck-arrastre");
    await expect(chips.first()).toBeVisible();
    await expect(chips.first()).toContainText("⏳ desde Abr 2026");
  });
});
