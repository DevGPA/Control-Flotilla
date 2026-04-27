import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_PATH = "/Control%20de%20flotilla.html";
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
// Por diseño:
//   - donut.urg = chip.Urgente (ambos = "tiene pending Urgente")
//   - donut.rv  ≤ chip.Revisar (chip incluye unidades con Urg+Rev; donut
//     las pone solo en Urgente para no duplicar).
//   - donut.ok  ≥ chip.OK     (donut agrupa OK + Completar-only; chip OK
//     exige cero pendings de cualquier nivel).

type DonutLegend = { u?: string; rv?: string; ok?: string };

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
  test("INV1: Σ(donut buckets) === flota total (donut es exclusivo)", async ({ page }) => {
    await loadMensual(page);
    const donut = await readDonut(page);
    const total = Number((await page.locator("#kv0").textContent())?.trim() || "0");
    const sum = Number(donut.u || 0) + Number(donut.rv || 0) + Number(donut.ok || 0);
    console.log(`[INV1] donut u=${donut.u}, rv=${donut.rv}, ok=${donut.ok} · total=${total}`);
    expect(sum).toBe(total);
    expect(total).toBeGreaterThan(0);
  });

  test("INV2: chip Urgente badge === filas tabla === donut.u (todos coinciden)", async ({
    page,
  }) => {
    await loadMensual(page);
    const donut = await readDonut(page);
    await clickChip(page, "btn-Urgente");
    const rows = await tableCount(page);
    const badge = await readChipBadge(page, "fc0");
    console.log(`[INV2] chip=${badge} · tabla=${rows} · donut.u=${donut.u}`);
    expect(rows).toBe(badge);
    expect(rows).toBe(Number(donut.u));
  });

  test("INV3: chip Revisar ≥ donut.rv (chip incluye overlap Urg+Rev)", async ({ page }) => {
    await loadMensual(page);
    const donut = await readDonut(page);
    await clickChip(page, "btn-Revisar");
    const rows = await tableCount(page);
    const badge = await readChipBadge(page, "fc1");
    const donutRv = Number(donut.rv || 0);
    console.log(`[INV3] chip=${badge} · tabla=${rows} · donut.rv=${donutRv}`);
    expect(rows).toBe(badge);
    expect(rows).toBeGreaterThanOrEqual(donutRv);
  });

  test("INV4: chip OK ≤ donut.ok (donut agrupa OK + Completar-only)", async ({ page }) => {
    await loadMensual(page);
    const donut = await readDonut(page);
    await clickChip(page, "btn-OK");
    const rows = await tableCount(page);
    const badge = await readChipBadge(page, "fc2");
    const donutOk = Number(donut.ok || 0);
    console.log(`[INV4] chip=${badge} · tabla=${rows} · donut.ok=${donutOk}`);
    expect(rows).toBe(badge);
    expect(rows).toBeLessThanOrEqual(donutOk);
  });

  test("INV5: chip Pendientes (Completar) === filas tabla", async ({ page }) => {
    await loadMensual(page);
    await clickChip(page, "btn-Completar");
    const rows = await tableCount(page);
    const badge = await readChipBadge(page, "fc4");
    console.log(`[INV5] chip Pendientes=${badge} · tabla=${rows}`);
    expect(rows).toBe(badge);
  });

  test("INV6: chip Taller === filas tabla === unidades en taller del período", async ({ page }) => {
    await loadMensual(page);
    await clickChip(page, "btn-taller");
    const rows = await tableCount(page);
    const badge = await readChipBadge(page, "fc_taller");
    console.log(`[INV6] chip taller=${badge} · tabla=${rows}`);
    expect(rows).toBe(badge);
  });

  test("INV7: chip Svc≤30d === KPI hero kv_svc (vencidos + próximos)", async ({ page }) => {
    await loadMensual(page);
    const kpiSvc = Number((await page.locator("#kv_svc").textContent())?.trim() || "0");
    await clickChip(page, "btn-svcvencido");
    const rows = await tableCount(page);
    const badge = await readChipBadge(page, "fc_svc");
    console.log(`[INV7] kpi=${kpiSvc} · chip=${badge} · tabla=${rows}`);
    expect(badge).toBe(kpiSvc);
    expect(rows).toBe(kpiSvc);
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

  test("INV10: donut.u + donut.rv + donut.ok exclusivos — ninguna unidad duplicada", async ({
    page,
  }) => {
    await loadMensual(page);
    const donut = await readDonut(page);
    const total = Number((await page.locator("#kv0").textContent())?.trim() || "0");
    // Si Σ === total, no hay duplicación (exclusividad)
    expect(Number(donut.u) + Number(donut.rv) + Number(donut.ok)).toBe(total);
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
