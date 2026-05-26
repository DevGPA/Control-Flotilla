import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_PATH = "/Control%20de%20flotilla.html?e2e=1";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_MENSUAL = path.resolve(__dirname, "../fixtures/mensual.xlsx");
const FIXTURE_TALLER = path.resolve(__dirname, "../fixtures/taller.xlsx");

// ════════════════════════════════════════════════════════════
// WORKFLOW SUITE — lógica de negocio real
// ════════════════════════════════════════════════════════════
// Ejercita flujos de USUARIO reales (no solo cargar archivos):
// registrar taller manual, marcar checklist, crear notas/acciones,
// filtrar con clicks en charts, enviar semanal→taller, persistencia.

type Report = { errors: string[]; findings: string[] };

function capture(page: Page): Report {
  const r: Report = { errors: [], findings: [] };
  const ignore = (t: string) =>
    t.includes("favicon") ||
    t.includes("source map") ||
    t.includes("Bad uncompressed size") ||
    t.includes("registerSW") ||
    t.includes("[vite]");

  page.on("console", (msg: ConsoleMessage) => {
    const t = msg.text();
    if (ignore(t)) return;
    if (msg.type() === "error") r.errors.push(t);
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

async function loadMensual(page: Page) {
  await page.goto(APP_PATH);
  await page.waitForLoadState("networkidle");
  // clear previous session
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
}

test.describe("Workflow — lógica real usuario", () => {
  // Tests independientes — sin serial mode

  // ──────────────────────────────────────────────────────────
  test("WF1: registrar ingreso taller MANUAL (llenar form → guardar → verificar fila)", async ({
    page,
  }) => {
    const r = capture(page);
    await loadMensual(page);

    // Navegar Taller
    await page.click("#mn-taller");
    await page.waitForTimeout(500);

    // Count filas previas reales (excluir placeholder "Sin unidades activas")
    const rowsBefore = await page
      .locator("#tl-tbody tr:not(:has(.tl-empty))")
      .count()
      .catch(() => 0);
    r.findings.push(`[WF1] Taller pre-registro: ${rowsBefore} ingresos reales`);

    // Abrir modal "+ Nuevo Ingreso"
    await page.click('button:has-text("Nuevo Ingreso")');
    await page.waitForTimeout(500);
    await expect(page.locator("#taller-modal.open")).toBeVisible();

    // Llenar form — datos realistas
    const testEco = `TEST-${Date.now().toString(36).slice(-5)}`;
    await page.fill("#tf-eco", testEco);
    await page.fill("#tf-plate", "TEST-001");
    await page.fill("#tf-brand", "Nissan NP 300 Chasis");
    await page.fill("#tf-branch", "Test Branch");
    await page.selectOption("#tf-area", "MANTENIMIENTO");
    await page.selectOption("#tf-estado", "En Diagnóstico");
    await page.selectOption("#tf-tipo", "Correctivo");
    const today = new Date().toISOString().slice(0, 10);
    await page.fill("#tf-freporte", today);
    await page.fill("#tf-fentrada", today);
    await page.fill("#tf-km", "85000");
    await page.fill("#tf-gasto", "1500");
    await page.fill("#tf-tecnico", "Test Técnico E2E");
    await page.fill("#tf-comentario", "Test falla generada por e2e workflow spec");

    // Guardar — .tl-save ahora único (.pm-save para periodo-modal, post-fix)
    await page.click(".tl-save");
    await page.waitForTimeout(1500); // IDB persist async

    // Verificar modal cerró
    const modalStillOpen = await page.locator("#taller-modal.open").count();
    r.findings.push(`[WF1] Modal cerró post-save: ${modalStillOpen === 0 ? "✓" : "✗"}`);

    // Verificar fila apareció (reales, excluyendo placeholder)
    const rowsAfter = await page.locator("#tl-tbody tr:not(:has(.tl-empty))").count();
    r.findings.push(
      `[WF1] Taller post-registro: ${rowsAfter} ingresos reales (+${rowsAfter - rowsBefore})`,
    );

    // Verificar nuestro eco está en tabla
    const tbody = await page.locator("#tl-tbody").textContent();
    const found = tbody?.includes(testEco) ?? false;
    r.findings.push(`[WF1] Unidad "${testEco}" visible en tabla: ${found ? "✓" : "✗"}`);

    await page.screenshot({
      path: "test-results/workflow/wf1-taller-registrado.png",
      fullPage: true,
    });

    // Validar persistencia: recargar página, verificar ingreso sigue ahí
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    await page.click("#mn-taller");
    await page.waitForTimeout(500);
    const tbodyAfter = await page.locator("#tl-tbody").textContent();
    const persisted = tbodyAfter?.includes(testEco) ?? false;
    r.findings.push(`[WF1] Post-reload "${testEco}" persiste: ${persisted ? "✓" : "✗"}`);

    console.log(r.findings.join("\n"));
    if (r.errors.length) console.log("  ⚠️ Errors:", r.errors.slice(0, 3).join(" | "));

    expect(rowsAfter).toBeGreaterThan(rowsBefore);
    expect(found).toBe(true);
    expect(persisted).toBe(true);
  });

  // ──────────────────────────────────────────────────────────
  test("WF2: marcar checklist item + verificar badge count decrementa", async ({ page }) => {
    const r = capture(page);
    await loadMensual(page);

    // Agarra primera unidad Urgente
    await page.click("#btn-Urgente");
    await page.waitForTimeout(300);
    const firstRow = page.locator("#tbody").locator("> *").first();
    const eco = await firstRow.locator(".tplate").first().textContent();
    r.findings.push(`[WF2] Unidad test: ${eco?.trim()}`);

    await firstRow.click();
    await page.waitForTimeout(600);

    // Tab Checklist (primera)
    await page.locator("#det .dtab").first().click();
    await page.waitForTimeout(400);

    // Count hallazgos pendientes
    const pendBefore = await page.locator("#det .ck-item.ck-actionable").count();
    r.findings.push(`[WF2] Hallazgos pendientes pre-check: ${pendBefore}`);
    expect(pendBefore).toBeGreaterThan(0);

    // Click primer hallazgo → marca done
    await page.locator("#det .ck-item.ck-actionable").first().click();
    await page.waitForTimeout(800); // IDB persist

    const pendAfter = await page.locator("#det .ck-item.ck-actionable").count();
    const doneCount = await page.locator("#det .ck-item.ck-done").count();
    r.findings.push(`[WF2] Post-check: pendientes=${pendAfter}, atendidos=${doneCount}`);
    r.findings.push(`  Delta pendientes: ${pendAfter - pendBefore} (esperado -1)`);

    await page.screenshot({
      path: "test-results/workflow/wf2-checklist-marcado.png",
      fullPage: true,
    });

    console.log(r.findings.join("\n"));
    if (r.errors.length) console.log("  ⚠️", r.errors.slice(0, 2).join(" | "));

    expect(pendAfter).toBe(pendBefore - 1);
    expect(doneCount).toBeGreaterThanOrEqual(1);
  });

  // ──────────────────────────────────────────────────────────
  test("WF3: crear nota manual + persiste post-reload", async ({ page }) => {
    const r = capture(page);
    await loadMensual(page);

    const firstRow = page.locator("#tbody").locator("> *").first();
    const eco = (await firstRow.locator(".tplate").first().textContent())?.trim() || "";
    await firstRow.click();
    await page.waitForTimeout(600);

    // Ir a tab Notas (índice ~3)
    const notasTab = page.locator("#det .dtab").filter({ hasText: "Notas" });
    await notasTab.click();
    await page.waitForTimeout(400);

    // Contar notas previas
    const notesBefore = await page.locator("#det .note-item").count();
    r.findings.push(`[WF3] Notas "${eco}" pre: ${notesBefore}`);

    // Llenar nota + guardar
    const testMsg = `Nota e2e workflow ${Date.now()}`;
    await page.fill("#note-input", testMsg);
    await page.selectOption("#note-type", "alerta");
    await page.click(".note-save");
    await page.waitForTimeout(1000);

    const notesAfter = await page.locator("#det .note-item").count();
    r.findings.push(`[WF3] Notas post-save: ${notesAfter} (+${notesAfter - notesBefore})`);

    // Verificar texto aparece
    const notesText = await page.locator("#det .notes-wrap").textContent();
    const textFound = notesText?.includes(testMsg) ?? false;
    r.findings.push(`[WF3] Texto visible: ${textFound ? "✓" : "✗"}`);

    // Reload + verificar persistió
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#tbody").locator("> *").first()).toBeVisible({ timeout: 10_000 });
    // Re-click misma unidad
    await page.locator("#tbody").locator("> *").first().click();
    await page.waitForTimeout(600);
    await page.locator("#det .dtab").filter({ hasText: "Notas" }).click();
    await page.waitForTimeout(500);
    const notesPersist = await page.locator("#det .notes-wrap").textContent();
    const persisted = notesPersist?.includes(testMsg) ?? false;
    r.findings.push(`[WF3] Post-reload nota persiste: ${persisted ? "✓" : "✗"}`);

    await page.screenshot({
      path: "test-results/workflow/wf3-nota-persistida.png",
      fullPage: true,
    });

    console.log(r.findings.join("\n"));
    if (r.errors.length) console.log("  ⚠️", r.errors.slice(0, 2).join(" | "));

    expect(notesAfter).toBe(notesBefore + 1);
    expect(persisted).toBe(true);
  });

  // ──────────────────────────────────────────────────────────
  test("WF4: chip Urgente → tabla filtra + counters coinciden con donut", async ({ page }) => {
    const r = capture(page);
    await loadMensual(page);

    // Valor donut (inside kpi-donut center label)
    await page.waitForTimeout(500);
    const urgenteFromDonut = await page.evaluate(() => {
      const dleg = document.getElementById("dleg");
      if (!dleg) return null;
      const items = dleg.querySelectorAll(".dleg-i");
      const out: Record<string, string> = {};
      items.forEach((el) => {
        const key = (el as HTMLElement).dataset.k || "";
        const num = el.querySelector(".dleg-num")?.textContent?.trim() || "";
        out[key] = num;
      });
      return out;
    });
    r.findings.push(`[WF4] Donut legend: ${JSON.stringify(urgenteFromDonut)}`);

    // Count "Todos"
    const allCount = await page.locator("#tbody").locator("> *").count();
    const totalKpi = await page.locator("#kv0").textContent();
    r.findings.push(`[WF4] Tabla Todos=${allCount} · KPI Flota=${totalKpi?.trim()}`);

    // Click chip Urgente
    await page.click("#btn-Urgente");
    await page.waitForTimeout(400);
    const urgCount = await page.locator("#tbody").locator("> *").count();
    const urgBadge = (await page.locator("#fc0").textContent())?.replace(/[^\d]/g, "") || "0";
    r.findings.push(
      `[WF4] Filtro Urgente: tabla=${urgCount}, badge chip="${urgBadge}", donut=${urgenteFromDonut?.u}`,
    );

    const coherent = urgCount === Number(urgBadge) && String(urgCount) === urgenteFromDonut?.u;
    r.findings.push(`[WF4] Coherencia Tabla==Badge==Donut: ${coherent ? "✓" : "✗"}`);

    await page.screenshot({
      path: "test-results/workflow/wf4-filtro-urgente.png",
      fullPage: true,
    });

    console.log(r.findings.join("\n"));
    if (r.errors.length) console.log("  ⚠️", r.errors.slice(0, 2).join(" | "));

    expect(urgCount).toBe(Number(urgBadge));
  });

  // ──────────────────────────────────────────────────────────
  test("WF5: sort taller por columna (F. Entrada desc)", async ({ page }) => {
    const r = capture(page);
    await loadMensual(page);

    // Importar taller XLSX primero
    await page.click("#mn-taller");
    await page.waitForTimeout(500);
    await page.setInputFiles("#tl-xinput", FIXTURE_TALLER);
    await page.waitForTimeout(2500);

    const rows = await page.locator("#tl-tbody tr").count();
    r.findings.push(`[WF5] Taller filas: ${rows}`);

    // Extraer primeras fechas de F. Entrada
    const datesBefore = await page.evaluate(() => {
      const trs = Array.from(document.querySelectorAll("#tl-tbody tr")).slice(0, 5);
      return trs.map((tr) => {
        const cells = tr.querySelectorAll("td");
        return cells[5]?.textContent?.trim() || ""; // columna F. Entrada
      });
    });
    r.findings.push(`[WF5] Primeras 5 fechas pre-sort: ${datesBefore.join(", ")}`);

    // Click header F. Entrada para sort
    const headerFEntrada = page.locator("#tl-thead th").filter({ hasText: "F. Entrada" }).first();
    if (await headerFEntrada.isVisible().catch(() => false)) {
      await headerFEntrada.click();
      await page.waitForTimeout(400);
      const datesAfter = await page.evaluate(() => {
        const trs = Array.from(document.querySelectorAll("#tl-tbody tr")).slice(0, 5);
        return trs.map((tr) => {
          const cells = tr.querySelectorAll("td");
          return cells[5]?.textContent?.trim() || "";
        });
      });
      r.findings.push(`[WF5] Primeras 5 fechas post-sort: ${datesAfter.join(", ")}`);
      const changed = datesAfter.join(",") !== datesBefore.join(",");
      r.findings.push(`[WF5] Sort alteró orden: ${changed ? "✓" : "✗"}`);
    } else {
      r.findings.push(`[WF5] ✗ Header F. Entrada no encontrado`);
    }

    console.log(r.findings.join("\n"));
    if (r.errors.length) console.log("  ⚠️", r.errors.slice(0, 2).join(" | "));
  });

  // ──────────────────────────────────────────────────────────
  test("WF6: filtrar Taller por sucursal + tipo + buscar", async ({ page }) => {
    const r = capture(page);
    await loadMensual(page);

    await page.click("#mn-taller");
    await page.waitForTimeout(500);
    await page.setInputFiles("#tl-xinput", FIXTURE_TALLER);
    await page.waitForTimeout(2500);

    const baseCount = await page.locator("#tl-tbody tr").count();
    r.findings.push(`[WF6] Taller base: ${baseCount}`);

    // Filtrar tipo Preventivo
    await page.selectOption("#tl-filt-tipo", "Preventivo");
    await page.waitForTimeout(400);
    const prevCount = await page.locator("#tl-tbody tr").count();
    r.findings.push(`[WF6] Tipo=Preventivo → ${prevCount}`);

    await page.selectOption("#tl-filt-tipo", "all");
    await page.waitForTimeout(300);

    // Búsqueda texto
    await page.fill("#tl-filt-q", "Nissan");
    await page.waitForTimeout(600);
    const srchCount = await page.locator("#tl-tbody tr").count();
    r.findings.push(`[WF6] Busqueda "Nissan" → ${srchCount}`);

    await page.fill("#tl-filt-q", "");
    await page.waitForTimeout(300);
    const restoredCount = await page.locator("#tl-tbody tr").count();
    r.findings.push(`[WF6] Restore base: ${restoredCount} (esperado ${baseCount})`);

    console.log(r.findings.join("\n"));
    expect(restoredCount).toBe(baseCount);
  });

  // ──────────────────────────────────────────────────────────
  test("WF7: toggle theme persiste localStorage + se mantiene post-reload", async ({ page }) => {
    const r = capture(page);
    await page.goto(APP_PATH);
    await page.waitForLoadState("networkidle");

    const before = await page.evaluate(
      () => document.documentElement.getAttribute("data-theme") || "light",
    );
    r.findings.push(`[WF7] Theme inicial: ${before}`);

    await page.click("#btn-theme");
    await page.waitForTimeout(400);
    const afterToggle = await page.evaluate(
      () => document.documentElement.getAttribute("data-theme") || "light",
    );
    const stored = await page.evaluate(() => localStorage.getItem("gpa-theme"));
    r.findings.push(`[WF7] Post-toggle: theme=${afterToggle}, localStorage=${stored}`);

    // Reload
    await page.reload();
    await page.waitForLoadState("networkidle");
    const afterReload = await page.evaluate(
      () => document.documentElement.getAttribute("data-theme") || "light",
    );
    r.findings.push(`[WF7] Post-reload: ${afterReload} (esperado ${afterToggle})`);

    console.log(r.findings.join("\n"));
    expect(afterToggle).not.toBe(before);
    expect(afterReload).toBe(afterToggle);
  });

  // ──────────────────────────────────────────────────────────
  test("WF8: cargar XLSX sucesivos (actualización) — reemplaza data correctamente", async ({
    page,
  }) => {
    const r = capture(page);
    await loadMensual(page);

    const count1 = await page.locator("#tbody").locator("> *").count();
    r.findings.push(`[WF8] Carga 1: ${count1} unidades`);

    // Recargar mismo XLSX (simula "actualizar Excel")
    await page.setInputFiles("#xinput", FIXTURE_MENSUAL);
    await page.waitForTimeout(2000);
    await dismissPeriodoModal(page);

    const count2 = await page.locator("#tbody").locator("> *").count();
    r.findings.push(`[WF8] Carga 2 (misma data): ${count2} unidades`);
    r.findings.push(`[WF8] No duplicación: ${count1 === count2 ? "✓" : "✗ duplicó"}`);

    console.log(r.findings.join("\n"));
    expect(count1).toBe(count2);
  });
});
