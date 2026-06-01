import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Cubre features de la sesión: KPIs clickeables → modal de flota (#fleet-modal)
// y autocompletado del modal de Taller. Corre offline con ?e2e=1 (sin Cognito);
// el modal/autocomplete caen a window.units cuando no hay __fleetUnits cloud.

const APP_PATH = "/Control%20de%20flotilla.html?e2e=1";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_MENSUAL = path.resolve(__dirname, "../fixtures/mensual.xlsx");

async function loadMensual(page: Page) {
  await page.goto(APP_PATH);
  await page.waitForLoadState("networkidle");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase("gpa_fleet");
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      }),
  );
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.setInputFiles("#xinput", FIXTURE_MENSUAL);
  await expect(page.locator("#hfile")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#tbody").locator("> *").first()).toBeVisible({ timeout: 10_000 });
  // El modal de período abre ~400ms DESPUÉS de procesar (setTimeout en
  // "Control de flotilla.html":2362). Hay que esperar a que abra y luego cerrarlo;
  // si se cierra antes de que dispare el setTimeout, reabre e intercepta el clic
  // en las hero-cards (flake). Determinista: visible → cerrar → oculto.
  const periodoModal = page.locator("#periodo-modal");
  await expect(periodoModal).toBeVisible({ timeout: 5000 });
  await page.evaluate(() => {
    const w = window as unknown as { closePeriodoModal?: () => void };
    w.closePeriodoModal?.();
    document.getElementById("periodo-modal")?.classList.remove("open");
  });
  await expect(periodoModal).toBeHidden();
}

test.describe("KPIs clickeables → modal de flota", () => {
  test("card FLOTA abre el modal con filas y cierra con ✕", async ({ page }) => {
    await loadMensual(page);
    // card FLOTA = primera .hero-card (onclick openFleetModal())
    await page.locator(".hero-card").first().click();
    const modal = page.locator("#fleet-modal");
    await expect(modal).toBeVisible();
    await expect(page.locator("#fleet-mod-ttl")).toHaveText(/Flota completa/i);
    const rows = await page.locator("#fleet-mod-tbody tr").count();
    console.log("[KPI] FLOTA filas en modal:", rows);
    expect(rows).toBeGreaterThan(0);
    // cerrar con ESC (lo maneja el listener del modal)
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
  });

  test("card LLANTAS CRÍTICAS abre modal con título y columna de detalle", async ({ page }) => {
    await loadMensual(page);
    // Dispara el kind directamente (robusto a la posición de la card).
    await page.evaluate(() => {
      (window as unknown as { openFleetModal: (k: string) => void }).openFleetModal("tiresCrit");
    });
    await expect(page.locator("#fleet-modal")).toBeVisible();
    await expect(page.locator("#fleet-mod-ttl")).toHaveText(/Unidades con llanta/i);
    await expect(page.locator("#fleet-mod-coldet")).toHaveText(/Llanta/i);
    // El conteo del modal debe coincidir con el KPI kv4.
    const kpi = (await page.locator("#kv4").textContent())?.trim() || "0";
    const filas = await page.locator("#fleet-mod-tbody tr").count();
    console.log(`[KPI] llantas kv4=${kpi} filas-modal=${filas}`);
    expect(filas).toBe(Number(kpi) || 0);
  });

  test("card SERVICIO: conteo del modal coincide con el KPI kv_svc", async ({ page }) => {
    await loadMensual(page);
    await page.evaluate(() => {
      (window as unknown as { openFleetModal: (k: string) => void }).openFleetModal("svc");
    });
    await expect(page.locator("#fleet-mod-ttl")).toHaveText(/Servicio/i);
    const kpi = (await page.locator("#kv_svc").textContent())?.trim() || "0";
    const filas = await page.locator("#fleet-mod-tbody tr").count();
    console.log(`[KPI] servicio kv_svc=${kpi} filas-modal=${filas}`);
    expect(filas).toBe(Number(kpi) || 0);
  });

  test("card SIN CHECK mensual: modal lista catálogo − presentes en rango", async ({ page }) => {
    await loadMensual(page);
    // En e2e no hay cloud (__fleetUnits ausente). Simulamos un catálogo = units del rango
    // + 2 unidades que NO están en el rango → deben salir como "sin check".
    await page.evaluate(() => {
      const w = window as unknown as {
        units: { plate?: string }[];
        __fleetUnits: unknown[];
      };
      w.__fleetUnits = [
        ...w.units,
        { plate: "TEST-MISS-1", eco: "9001", brand: "X", branch: "Norte", fecha: "2026-01-15" },
        { plate: "TEST-MISS-2", eco: "9002", brand: "X", branch: "Norte" }, // sin fecha → "Nunca"
      ];
      (window as unknown as { openFleetModal: (k: string) => void }).openFleetModal(
        "missingMensual",
      );
    });
    await expect(page.locator("#fleet-modal")).toBeVisible();
    await expect(page.locator("#fleet-mod-ttl")).toHaveText(/Sin check mensual/i);
    const filas = await page.locator("#fleet-mod-tbody tr").count();
    console.log(`[KPI] sin-check filas-modal=${filas}`);
    expect(filas).toBe(2); // las 2 unidades fuera del rango
    // La columna de detalle muestra fecha o "Nunca".
    await expect(page.locator("#fleet-mod-tbody")).toContainText(/Nunca/i);
  });
});

test.describe("Taller — autocompletado de unidad", () => {
  test("escribir económico → dropdown → rellena placa/modelo", async ({ page }) => {
    await loadMensual(page);
    // Toma un económico real de los datos cargados.
    const u = await page.evaluate(() => {
      const list =
        (window as unknown as { units?: { eco?: string; plate?: string }[] }).units || [];
      const hit = list.find((x) => x.eco || x.plate);
      return hit ? { eco: hit.eco || "", plate: hit.plate || "" } : null;
    });
    expect(u, "fixture debe traer al menos una unidad con eco/placa").not.toBeNull();
    const query = (u!.eco || u!.plate).slice(0, 4);

    await page.click("#mn-taller");
    await expect(page.locator("#taller-view")).toBeVisible();
    // Abre el modal directo (probamos el autocomplete, no el botón de abrir).
    await page.evaluate(() => {
      (window as unknown as { openTallerModal: () => void }).openTallerModal();
    });
    await expect(page.locator("#taller-modal.open")).toBeVisible();

    await page.fill("#tf-eco", query);
    await page.dispatchEvent("#tf-eco", "input");
    const drop = page.locator("#tl-ac-drop");
    await expect(drop).toBeVisible({ timeout: 4000 });
    const items = drop.locator(".tl-ac-item");
    await expect(items.first()).toBeVisible();

    await items.first().click();
    // Tras seleccionar, placa o modelo deben quedar rellenados.
    const plate = await page.locator("#tf-plate").inputValue();
    const brand = await page.locator("#tf-brand").inputValue();
    console.log(`[Taller AC] query=${query} → plate="${plate}" brand="${brand}"`);
    expect(plate.length + brand.length).toBeGreaterThan(0);
  });
});
