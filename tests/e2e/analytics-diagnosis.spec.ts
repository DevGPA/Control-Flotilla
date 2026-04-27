import { test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_PATH = "/Control%20de%20flotilla.html";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_MENSUAL = path.resolve(__dirname, "../fixtures/mensual.xlsx");

// Diagnóstico UX del panel Análisis avanzado — confirma estado de 5 widgets.
// Output: test-results/diagnosis/*.png + log estado cada widget.

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

test("analytics diagnosis — estado real de 5 widgets post data load", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(APP_PATH);
  await page.waitForLoadState("networkidle");
  // Clear IDB para estado limpio
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
  await page
    .waitForFunction(() => document.querySelectorAll("#tbody > *").length > 0, null, {
      timeout: 15_000,
    })
    .catch(() => {});
  await dismissPeriodoModal(page);

  await page.click("#mn-analytics");
  await page.waitForTimeout(1500); // ECharts render

  // Inspect each widget
  const report = await page.evaluate(() => {
    const widgets = [
      { id: "kpi-donut", name: "Donut hero (card 5 del hero row)" },
      { id: "chart-branches", name: "Sucursales por riesgo" },
      { id: "chart-categories", name: "Hallazgos por categoría" },
      { id: "chart-trend", name: "Tendencia por período" },
      { id: "chart-heatmap", name: "Taller · ingresos por día" },
      { id: "chart-km", name: "Km vs servicio" },
    ];

    type Status = {
      id: string;
      name: string;
      exists: boolean;
      visible: boolean;
      rect: { w: number; h: number; top: number };
      hasCanvas: boolean;
      canvasSize: { w: number; h: number } | null;
      emptyState: { id: string; visible: boolean; text: string } | null;
      parentCard: { display: string } | null;
    };

    return widgets.map((w): Status => {
      const el = document.getElementById(w.id);
      const emptyId = `${w.id}-empty`;
      const emptyEl = document.getElementById(emptyId);

      if (!el) {
        return {
          id: w.id,
          name: w.name,
          exists: false,
          visible: false,
          rect: { w: 0, h: 0, top: 0 },
          hasCanvas: false,
          canvasSize: null,
          emptyState: null,
          parentCard: null,
        };
      }

      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const canvas = el.querySelector("canvas");
      const parentCard = el.closest(".chart-card") as HTMLElement | null;
      const pcs = parentCard ? getComputedStyle(parentCard) : null;

      return {
        id: w.id,
        name: w.name,
        exists: true,
        visible: cs.display !== "none" && rect.width > 0 && rect.height > 0,
        rect: { w: Math.round(rect.width), h: Math.round(rect.height), top: Math.round(rect.top) },
        hasCanvas: !!canvas,
        canvasSize: canvas ? { w: canvas.width, h: canvas.height } : null,
        emptyState: emptyEl
          ? {
              id: emptyId,
              visible: !emptyEl.hidden && getComputedStyle(emptyEl).display !== "none",
              text: (emptyEl.textContent || "").trim().slice(0, 80),
            }
          : null,
        parentCard: parentCard ? { display: pcs?.display || "?" } : null,
      };
    });
  });

  // Data state
  const state = await page.evaluate(() => {
    const w = window as unknown as {
      units?: unknown[];
      periodos?: unknown[];
      tallerEntries?: unknown[];
    };
    return {
      units: w.units?.length ?? 0,
      periodos: w.periodos?.length ?? 0,
      tallerEntries: w.tallerEntries?.length ?? 0,
    };
  });

  console.log("\n═══ ANALYTICS WIDGETS DIAGNOSIS ═══");
  console.log(
    `Data: units=${state.units} · periodos=${state.periodos} · taller=${state.tallerEntries}`,
  );
  console.log("");
  for (const w of report) {
    console.log(`[${w.id}] ${w.name}`);
    console.log(`  exists=${w.exists} visible=${w.visible} rect=${JSON.stringify(w.rect)}`);
    console.log(`  canvas=${w.hasCanvas} size=${JSON.stringify(w.canvasSize)}`);
    if (w.emptyState) {
      console.log(
        `  emptyState#${w.emptyState.id}: visible=${w.emptyState.visible} text="${w.emptyState.text}"`,
      );
    } else {
      console.log(`  emptyState: no placeholder element`);
    }
    console.log(`  parentCard.display=${w.parentCard?.display || "none"}`);
    console.log("");
  }

  // Full-page screenshot
  await page.screenshot({
    path: "test-results/diagnosis/analytics-full-expanded.png",
    fullPage: true,
  });

  // Scroll al final del panel para captura completa (widgets empty pueden estar colapsados)
  await page.locator("#analytics-content").evaluate((el) => el.scrollIntoView({ block: "end" }));
  await page.waitForTimeout(300);
  await page.screenshot({
    path: "test-results/diagnosis/analytics-widgets-3-5.png",
    fullPage: false,
  });

  // Verificar cards con data-empty existen
  const emptyCards = await page.locator(".chart-card[data-empty='1']").count();
  console.log(`Cards colapsadas (data-empty="1"): ${emptyCards}`);

  console.log("Screenshots:");
  console.log("  test-results/diagnosis/analytics-full-expanded.png");
  console.log("  test-results/diagnosis/analytics-widgets-3-5.png");
});
