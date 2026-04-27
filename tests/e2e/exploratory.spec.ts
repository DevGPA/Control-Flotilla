import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_PATH = "/Control%20de%20flotilla.html";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_MENSUAL = path.resolve(__dirname, "../fixtures/mensual.xlsx");
const FIXTURE_TALLER = path.resolve(__dirname, "../fixtures/taller.xlsx");
const FIXTURE_SEMANAL = path.resolve(__dirname, "../fixtures/semanal.zip");

// ════════════════════════════════════════════════════════════
// EXPLORATORY SUITE — retroalimentación funcional
// ════════════════════════════════════════════════════════════
// Carga real de data + interacciones usuario — captura console errors,
// warnings, screenshots por fase. Output: test-results/exploratory/*.png
// + log de hallazgos impresos en stdout.

type Report = {
  errors: string[];
  warnings: string[];
  notes: string[];
};

function setupConsoleCapture(page: Page): Report {
  const r: Report = { errors: [], warnings: [], notes: [] };
  const ignore = (t: string) =>
    t.includes("favicon") ||
    t.includes("source map") ||
    t.includes("Bad uncompressed size") ||
    t.includes("registerSW") ||
    t.includes("vite");

  page.on("console", (msg: ConsoleMessage) => {
    const t = msg.text();
    if (ignore(t)) return;
    if (msg.type() === "error") r.errors.push(t);
    else if (msg.type() === "warning") r.warnings.push(t);
  });
  page.on("pageerror", (err) => r.errors.push(`pageerror: ${err.message}`));
  return r;
}

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

test.describe("Exploratory — funcionalidad end-to-end", () => {
  // mode default: si falla uno, los demás siguen corriendo.

  test("A) bootstrap inicial — vacío, sin datos", async ({ page }) => {
    const r = setupConsoleCapture(page);

    await page.goto(APP_PATH);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("#dz")).toBeVisible();
    await expect(page.locator("#hstxt")).toHaveText(/Sin datos cargados/);

    await page.screenshot({
      path: "test-results/exploratory/01-bootstrap-vacio.png",
      fullPage: true,
    });

    r.notes.push(`[A] Bootstrap vacío — DZ visible, app loads clean`);
    if (r.errors.length) r.notes.push(`  ⚠️ Console errors: ${r.errors.length}`);
    console.log(r.notes.join("\n"));
  });

  test("B) carga XLSX mensual + renderiza tabla + analytics", async ({ page }) => {
    const r = setupConsoleCapture(page);

    await page.goto(APP_PATH);
    await page.waitForLoadState("networkidle");
    await page.setInputFiles("#xinput", FIXTURE_MENSUAL);
    await expect(page.locator("#hfile")).toBeVisible({ timeout: 15_000 });

    const rows = await page.locator("#tbody").locator("> *").count();
    expect(rows).toBeGreaterThan(0);
    await dismissPeriodoModal(page);

    // Verifica hero KPI cards presentes con valores
    const flotaVal = await page.locator("#kv0").textContent();
    const llantasVal = await page.locator("#kv4").textContent();
    const tallerVal = await page.locator("#kv_taller").textContent();
    const svcVal = await page.locator("#kv_svc").textContent();

    r.notes.push(`[B] Mensual cargado — ${rows} unidades`);
    r.notes.push(
      `  KPIs: Flota=${flotaVal} · Llantas=${llantasVal} · Taller=${tallerVal} · Svc=${svcVal}`,
    );

    // Vista Análisis (4º tab) — kpi-donut vive en hero (oculto en analytics)
    await page.click("#mn-analytics");
    await page.waitForTimeout(1000);
    await expect(page.locator("#chart-branches")).toBeVisible();
    await expect(page.locator("#chart-categories")).toBeVisible();

    await page.screenshot({
      path: "test-results/exploratory/02-mensual-cargado.png",
      fullPage: true,
    });

    r.notes.push(`  Analytics expanded, donut + branches + categorías visibles`);
    if (r.errors.length) r.notes.push(`  ⚠️ Errors: ${r.errors.slice(0, 3).join(" | ")}`);
    console.log(r.notes.join("\n"));
  });

  test("C) selecciona unidad + navega tabs detalle", async ({ page }) => {
    const r = setupConsoleCapture(page);
    await page.goto(APP_PATH);
    await page.waitForLoadState("networkidle");
    await page.setInputFiles("#xinput", FIXTURE_MENSUAL);
    await expect(page.locator("#tbody").locator("> *").first()).toBeVisible({ timeout: 10_000 });
    await dismissPeriodoModal(page);

    // Click primera unidad
    const firstRow = page.locator("#tbody").locator("> *").first();
    const firstEco = await firstRow.locator(".tplate").first().textContent();
    await firstRow.click();
    await page.waitForTimeout(600);

    // Panel detalle debe abrir
    const detVisible = await page.locator("#det.open").count();
    r.notes.push(`[C] Detalle unidad "${firstEco}" — abre: ${detVisible > 0 ? "✓" : "✗"}`);

    await page.screenshot({
      path: "test-results/exploratory/03-detalle-unidad.png",
      fullPage: true,
    });

    // Navegar tabs detalle (Checklist, Notas, Fotos, Servicio)
    const tabs = page.locator("#det .dtab");
    const tabCount = await tabs.count();
    r.notes.push(`  Tabs detalle: ${tabCount} encontrados`);

    for (let i = 0; i < Math.min(tabCount, 5); i++) {
      const tab = tabs.nth(i);
      const label = (await tab.textContent())?.trim().slice(0, 30) || `tab-${i}`;
      try {
        await tab.click({ timeout: 3000 });
        await page.waitForTimeout(400);
        await page.screenshot({
          path: `test-results/exploratory/03b-det-tab-${i}-${label.replace(/[^\w]/g, "_")}.png`,
          clip: { x: 0, y: 0, width: 1280, height: 720 },
        });
        r.notes.push(`  ✓ Tab "${label}" navegada`);
      } catch (e) {
        r.notes.push(`  ✗ Tab "${label}" falló: ${(e as Error).message.slice(0, 60)}`);
      }
    }

    if (r.errors.length) r.notes.push(`  ⚠️ Errors: ${r.errors.length}`);
    console.log(r.notes.join("\n"));
  });

  test("D) filtros — chips + búsqueda + sucursal", async ({ page }) => {
    const r = setupConsoleCapture(page);
    await page.goto(APP_PATH);
    await page.waitForLoadState("networkidle");
    await page.setInputFiles("#xinput", FIXTURE_MENSUAL);
    await expect(page.locator("#tbody").locator("> *").first()).toBeVisible({ timeout: 10_000 });
    await dismissPeriodoModal(page);

    const baseCount = await page.locator("#tbody").locator("> *").count();
    r.notes.push(`[D] Filtros — base: ${baseCount} unidades`);

    // Chip Urgente
    await page.click("#btn-Urgente");
    await page.waitForTimeout(300);
    const urgCount = await page.locator("#tbody").locator("> *").count();
    r.notes.push(`  Chip Urgente → ${urgCount} unidades`);

    // Chip OK
    await page.click("#btn-OK");
    await page.waitForTimeout(300);
    const okCount = await page.locator("#tbody").locator("> *").count();
    r.notes.push(`  Chip OK → ${okCount} unidades`);

    // Volver a todos
    await page.click("#btn-all");
    await page.waitForTimeout(300);

    // Búsqueda texto
    await page.fill("#srch", "Nissan");
    await page.waitForTimeout(500);
    const srchCount = await page.locator("#tbody").locator("> *").count();
    r.notes.push(`  Búsqueda "Nissan" → ${srchCount} unidades`);

    await page.fill("#srch", "");
    await page.waitForTimeout(300);

    // Sucursal
    const bsel = page.locator("#bsel");
    const options = await bsel.locator("option").allTextContents();
    r.notes.push(`  Sucursales disponibles: ${options.length} (${options.slice(1, 4).join(", ")})`);

    if (options.length > 1) {
      await bsel.selectOption({ index: 1 });
      await page.waitForTimeout(300);
      const sucCount = await page.locator("#tbody").locator("> *").count();
      r.notes.push(`  Sucursal "${options[1]}" → ${sucCount} unidades`);
    }

    await page.screenshot({
      path: "test-results/exploratory/04-filtros.png",
      fullPage: true,
    });

    if (r.errors.length) r.notes.push(`  ⚠️ Errors: ${r.errors.length}`);
    console.log(r.notes.join("\n"));
  });

  test("E) tab Taller — importar + registrar ingreso", async ({ page }) => {
    const r = setupConsoleCapture(page);
    await page.goto(APP_PATH);
    await page.waitForLoadState("networkidle");
    await page.setInputFiles("#xinput", FIXTURE_MENSUAL);
    await expect(page.locator("#hfile")).toBeVisible({ timeout: 10_000 });
    await dismissPeriodoModal(page);

    // Click Taller tab
    await page.click('button:has-text("Taller")');
    await page.waitForTimeout(600);

    // Importar XLSX taller
    await page.setInputFiles("#tl-xinput", FIXTURE_TALLER);
    await page.waitForTimeout(2000);

    const tallerRows = await page
      .locator("#tl-tbody tr")
      .count()
      .catch(() => 0);
    r.notes.push(`[E] Taller importado — ${tallerRows} filas`);

    await page.screenshot({
      path: "test-results/exploratory/05-taller-importado.png",
      fullPage: true,
    });

    // Abrir modal nuevo ingreso
    const newBtn = page.locator('button:has-text("Nuevo Ingreso")');
    if (await newBtn.isVisible().catch(() => false)) {
      await newBtn.click();
      await page.waitForTimeout(500);
      const modalOpen = await page.locator("#taller-modal").isVisible();
      r.notes.push(`  Modal nuevo ingreso: ${modalOpen ? "abre ✓" : "no abre ✗"}`);

      if (modalOpen) {
        await page.screenshot({
          path: "test-results/exploratory/05b-taller-modal.png",
          fullPage: true,
        });
        // Cerrar modal vía función global
        await page.evaluate(() => {
          const w = window as unknown as { closeTallerModal?: () => void };
          if (typeof w.closeTallerModal === "function") w.closeTallerModal();
          const m = document.getElementById("taller-modal");
          if (m) m.classList.remove("open");
        });
        await page.waitForTimeout(400);
      }
    } else {
      r.notes.push(`  Botón "Nuevo Ingreso" no visible`);
    }

    // Tab Historial
    const histBtn = page.locator('button:has-text("Historial")');
    if (await histBtn.isVisible().catch(() => false)) {
      await histBtn.click();
      await page.waitForTimeout(600);
      await page.screenshot({
        path: "test-results/exploratory/05c-taller-historial.png",
        fullPage: true,
      });
      r.notes.push(`  Tab Historial navegada ✓`);
    }

    if (r.errors.length) r.notes.push(`  ⚠️ Errors: ${r.errors.slice(0, 2).join(" | ")}`);
    console.log(r.notes.join("\n"));
  });

  test("F) tab Semanales — carga ZIP 133MB", async ({ page }) => {
    test.setTimeout(120_000); // ZIP grande = carga lenta
    const r = setupConsoleCapture(page);

    await page.goto(APP_PATH);
    await page.waitForLoadState("networkidle");

    // Semanales tab visible requires data loaded first
    await page.setInputFiles("#xinput", FIXTURE_MENSUAL);
    await expect(page.locator("#hfile")).toBeVisible({ timeout: 10_000 });
    await dismissPeriodoModal(page);

    await page.click("#mn-semanales");
    await page.waitForTimeout(500);
    await page.screenshot({
      path: "test-results/exploratory/06-semanales-vacio.png",
      fullPage: true,
    });

    // Cargar ZIP semanal
    r.notes.push(`[F] Semanales — cargando ZIP 133MB…`);
    const start = Date.now();
    await page.setInputFiles("#sw-xinput", FIXTURE_SEMANAL);

    // Esperar render tabla — timeout extendido
    await page
      .waitForFunction(
        () => {
          const tbody = document.querySelector("#sw-tbody");
          return tbody && tbody.children.length > 0;
        },
        null,
        { timeout: 90_000 },
      )
      .catch(() => r.notes.push(`  ⚠️ Tabla semanal no renderizó en 90s`));

    const elapsedMs = Date.now() - start;
    const swRows = await page.locator("#sw-tbody tr").count();
    r.notes.push(`  Semanal cargado en ${(elapsedMs / 1000).toFixed(1)}s — ${swRows} unidades`);

    await page.screenshot({
      path: "test-results/exploratory/06b-semanales-cargado.png",
      fullPage: true,
    });

    if (r.errors.length) r.notes.push(`  ⚠️ Errors: ${r.errors.slice(0, 3).join(" | ")}`);
    console.log(r.notes.join("\n"));
  });

  test("G) persistencia — reload + restore session", async ({ page }) => {
    const r = setupConsoleCapture(page);
    await page.goto(APP_PATH);
    await page.waitForLoadState("networkidle");
    await page.setInputFiles("#xinput", FIXTURE_MENSUAL);
    await expect(page.locator("#hfile")).toBeVisible({ timeout: 10_000 });
    await dismissPeriodoModal(page);
    await page.waitForTimeout(2500); // persistState async

    const rowsBefore = await page.locator("#tbody").locator("> *").count();
    r.notes.push(`[G] Pre-reload: ${rowsBefore} unidades`);

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#tbody").locator("> *").first()).toBeVisible({ timeout: 10_000 });

    const rowsAfter = await page.locator("#tbody").locator("> *").count();
    const hstxt = (await page.locator("#hstxt").textContent()) || "";
    r.notes.push(`  Post-reload: ${rowsAfter} unidades, hstxt="${hstxt}"`);
    r.notes.push(`  Restore: ${rowsBefore === rowsAfter ? "✓" : "✗ DESSINCRONIZADO"}`);

    if (r.errors.length) r.notes.push(`  ⚠️ Errors: ${r.errors.length}`);
    console.log(r.notes.join("\n"));
  });

  test("H) theme toggle + dashboards en dark", async ({ page }) => {
    const r = setupConsoleCapture(page);
    await page.goto(APP_PATH);
    await page.waitForLoadState("networkidle");
    await page.setInputFiles("#xinput", FIXTURE_MENSUAL);
    await expect(page.locator("#tbody").locator("> *").first()).toBeVisible({ timeout: 10_000 });
    await dismissPeriodoModal(page);

    await page.click("#mn-analytics");
    await page.waitForTimeout(800);

    // Toggle dark
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await page.waitForTimeout(500);

    const darkTheme = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme"),
    );
    r.notes.push(`[H] Dark theme aplicado: ${darkTheme}`);

    await page.screenshot({
      path: "test-results/exploratory/07-dark-dashboard.png",
      fullPage: true,
    });

    // Back a light
    await page.evaluate(() => {
      document.documentElement.removeAttribute("data-theme");
    });
    await page.waitForTimeout(300);

    if (r.errors.length) r.notes.push(`  ⚠️ Errors: ${r.errors.length}`);
    console.log(r.notes.join("\n"));
  });

  test("I) export PDF individual — download", async ({ page }) => {
    const r = setupConsoleCapture(page);
    await page.goto(APP_PATH);
    await page.waitForLoadState("networkidle");
    await page.setInputFiles("#xinput", FIXTURE_MENSUAL);
    await expect(page.locator("#tbody").locator("> *").first()).toBeVisible({ timeout: 10_000 });
    await dismissPeriodoModal(page);

    await page.locator("#tbody").locator("> *").first().click();
    await page.waitForTimeout(600);

    const dlPromise = page.waitForEvent("download", { timeout: 10_000 }).catch(() => null);
    await page.evaluate(async () => {
      const fn = (window as unknown as { exportPDF?: () => Promise<void> }).exportPDF;
      if (typeof fn === "function") await fn();
    });
    const dl = await dlPromise;

    if (dl) {
      r.notes.push(`[I] PDF unit generado: "${dl.suggestedFilename()}"`);
      const p = await dl.path();
      if (p) {
        const fs = await import("node:fs");
        const size = fs.statSync(p).size;
        r.notes.push(`  Tamaño: ${(size / 1024).toFixed(1)} KB`);
      }
    } else {
      r.notes.push(`[I] ⚠️ PDF download no disparó (timeout 10s)`);
    }

    if (r.errors.length) r.notes.push(`  ⚠️ Errors: ${r.errors.slice(0, 2).join(" | ")}`);
    console.log(r.notes.join("\n"));
  });
});
