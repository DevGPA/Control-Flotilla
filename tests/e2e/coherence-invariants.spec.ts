import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_PATH = "/Control%20de%20flotilla.html?e2e=1";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_MENSUAL = path.resolve(__dirname, "../fixtures/mensual.xlsx");

// ════════════════════════════════════════════════════════════
// COHERENCE INVARIANTS — propiedades que SIEMPRE deben cumplirse
// ════════════════════════════════════════════════════════════
// Modelo C-mod (overlap chips) + donut exclusivo. Esta suite codifica las
// reglas de negocio implícitas para que cualquier cambio futuro que las
// rompa falle el CI. NO test de instancia de bug — test de invariante.
//
// Glosario:
//   chip "X" = filtro botón en barra superior, count = cuántas unidades
//     matchean el criterio del chip (overlap permitido entre Urg/Rev/Comp).
//   donut bucket "X" = segmento del KPI hero, count = cuántas unidades
//     caen en ese segmento (EXCLUSIVO — Σ buckets = flota).
//
// Por diseño (modelo Operativa/Taller binario):
//   - donut.op + donut.tlr === flota total (exclusivo).
//   - chip Urgente/Revisar/OK/Completar funcionan independientes — no se
//     comparan contra buckets del donut binario.

type DonutLegend = { op?: string; tlr?: string };

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

async function readDonut(page: Page): Promise<DonutLegend> {
  return await page.evaluate(() => {
    const dleg = document.getElementById("dleg");
    if (!dleg) return {};
    const out: Record<string, string> = {};
    dleg.querySelectorAll(".dleg-i").forEach((el) => {
      const k = (el as HTMLElement).dataset.k || "";
      const n = el.querySelector(".dleg-num")?.textContent?.trim() || "";
      out[k] = n;
    });
    return out;
  });
}

async function readChipBadge(page: Page, id: string): Promise<number> {
  const txt = (await page.locator(`#${id}`).textContent()) || "";
  const m = txt.match(/\d+/);
  return m ? Number(m[0]) : 0;
}

async function tableCount(page: Page): Promise<number> {
  // #rcnt muestra "N/M" donde N = filas filtradas, M = total. Más confiable que
  // contar children de #tbody porque ese incluye el placeholder ".nores" en empty state.
  const txt = (await page.locator("#rcnt").textContent()) || "";
  const m = txt.match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

async function clickChip(page: Page, btnId: string) {
  await page.click(`#${btnId}`);
  await page.waitForTimeout(300);
}

test.describe("Coherence invariants — KPI/chip/tabla/donut", () => {
  test("INV1: donut.op + donut.tlr === flota total (donut binario exclusivo)", async ({ page }) => {
    await loadMensual(page);
    const donut = await readDonut(page);
    const total = Number((await page.locator("#kv0").textContent())?.trim() || "0");
    const sum = Number(donut.op || 0) + Number(donut.tlr || 0);
    console.log(`[INV1] donut op=${donut.op}, tlr=${donut.tlr} · total=${total}`);
    expect(sum).toBe(total);
    expect(total).toBeGreaterThan(0);
  });

  test("INV2: chip Urgente badge === filas tabla", async ({ page }) => {
    await loadMensual(page);
    await clickChip(page, "btn-Urgente");
    const rows = await tableCount(page);
    const badge = await readChipBadge(page, "fc0");
    console.log(`[INV2] chip=${badge} · tabla=${rows}`);
    expect(rows).toBe(badge);
  });

  // INV3-6: chips Revisar/OK/Completar/Taller eliminados del UI (chips simplificados
  // a Urgente/Comentarios/Svc). Tests obsoletos — eliminados con la feature.

  test("INV7: chip Svc≤30d badge ≤ filas tabla (filtro fecha incluye km-based)", async ({
    page,
  }) => {
    await loadMensual(page);
    await clickChip(page, "btn-svcvencido");
    const rows = await tableCount(page);
    const badge = await readChipBadge(page, "fc_svc");
    console.log(`[INV7] chip=${badge} · tabla=${rows}`);
    // Chip badge (vencidos km+fecha) puede ser ≤ filtro (solo fecha ≤30d).
    expect(rows).toBeGreaterThanOrEqual(badge);
  });

  test("INV8: chip Comentarios === unidades con obs", async ({ page }) => {
    await loadMensual(page);
    await clickChip(page, "btn-obs");
    const rows = await tableCount(page);
    const badge = await readChipBadge(page, "fc3");
    console.log(`[INV8] chip obs=${badge} · tabla=${rows}`);
    expect(rows).toBe(badge);
  });

  test("INV9: tras filtrar y volver a 'Todos', count restaurado a flota total", async ({
    page,
  }) => {
    await loadMensual(page);
    const total = await tableCount(page);
    await clickChip(page, "btn-Urgente");
    const filtered = await tableCount(page);
    expect(filtered).toBeLessThanOrEqual(total);
    await clickChip(page, "btn-all");
    const restored = await tableCount(page);
    console.log(`[INV9] total=${total} · filtrado=${filtered} · restaurado=${restored}`);
    expect(restored).toBe(total);
  });

  test("INV10: donut binario exclusivo — op + tlr === flota total", async ({ page }) => {
    await loadMensual(page);
    const donut = await readDonut(page);
    const total = Number((await page.locator("#kv0").textContent())?.trim() || "0");
    expect(Number(donut.op || 0) + Number(donut.tlr || 0)).toBe(total);
  });

  test("INV11: click donut segment 'Urgente' → activa chip Urgente con misma data", async ({
    page,
  }) => {
    await loadMensual(page);
    // Click sobre la leyenda del donut (proxy de click sobre segmento)
    await page.evaluate(() => {
      const w = window as unknown as { setF?: (k: string) => void };
      if (typeof w.setF === "function") w.setF("Urgente");
    });
    await page.waitForTimeout(300);
    const isOn = await page.evaluate(() => {
      return document.getElementById("btn-Urgente")?.classList.contains("chip-on") ?? false;
    });
    const rows = await tableCount(page);
    const badge = await readChipBadge(page, "fc0");
    console.log(`[INV11] btn-Urgente.chip-on=${isOn} · rows=${rows} · badge=${badge}`);
    expect(isOn).toBe(true);
    expect(rows).toBe(badge);
  });

  test("INV12: tras cambiar sucursal a una específica, sum chips filtrables ≤ total sucursal", async ({
    page,
  }) => {
    await loadMensual(page);
    const branches = await page.locator("#bsel option").allTextContents();
    if (branches.length < 2) {
      test.skip(true, "Solo una sucursal — invariante no aplica");
      return;
    }
    // Selecciona la primera sucursal real (no "Todas")
    const firstBranch = await page.locator("#bsel option").nth(1).getAttribute("value");
    if (!firstBranch) return;
    await page.selectOption("#bsel", firstBranch);
    await page.waitForTimeout(300);
    const allCount = await tableCount(page);
    expect(allCount).toBeGreaterThan(0);
    // Filtra Urgente — debe seguir filtrado por sucursal
    await clickChip(page, "btn-Urgente");
    const urgInBranch = await tableCount(page);
    console.log(`[INV12] sucursal=${firstBranch} · all=${allCount} · urg=${urgInBranch}`);
    expect(urgInBranch).toBeLessThanOrEqual(allCount);
  });
});
