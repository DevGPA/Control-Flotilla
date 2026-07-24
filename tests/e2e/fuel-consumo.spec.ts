import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Smoke del drill-down de la gráfica unificada de Combustible (spec "Producto Vivo"
// §3, review final I-2): comparativo por sucursal → click en barra → detalle mensual
// → "←" regresa → "Evolución global". Corre offline (?e2e=1, sin Cognito): la nube
// nunca llega a poblar window.fuelEntries (ensureSession lanza de inmediato en modo
// E2E — ver src/api/cloudWire.ts), así que se siembra un dataset sintético mínimo
// directamente en window.fuelEntries antes de entrar al módulo.
//
// El fixture .xlsx (mismo de visual-smoke.spec.ts) NO aporta datos de combustible —
// solo puebla `units`/inspecciones, lo mínimo indispensable para que showDash()
// revele #mainnav (display:none por CSS hasta la 1ª carga — ver main.css #mainnav
// y "Control de flotilla.html" showDash()). Sin él, #mn-combustible es inalcanzable.

const APP_PATH = "/Control%20de%20flotilla.html?e2e=1";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_MENSUAL = path.resolve(__dirname, "../fixtures/mensual.xlsx");

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
  await expect(page.locator("#mainnav")).toBeVisible();
}

type SyntheticFuelEntry = {
  tipo: "carga";
  eco: string;
  loadId: string;
  eventoId: string;
  fecha: string;
  litros: number;
  monto: number;
  sucursal: string;
  photos: never[];
};

// 8 cargas · 3 sucursales · 3 meses — montos bien separados por sucursal/mes para que
// SIEMPRE haya barras con altura apreciable (sin depender de redondeos "0k").
function buildFuelFixture(): SyntheticFuelEntry[] {
  const rows: Array<[string, string, number]> = [
    ["Guadalajara", "2026-05-03", 3000],
    ["Guadalajara", "2026-06-03", 3200],
    ["Guadalajara", "2026-07-03", 2800],
    ["Monterrey", "2026-05-10", 2000],
    ["Monterrey", "2026-06-10", 2100],
    ["Monterrey", "2026-07-10", 1900],
    ["Cancún", "2026-06-15", 1000],
    ["Cancún", "2026-07-15", 1100],
  ];
  return rows.map(([sucursal, fecha, monto], i) => ({
    tipo: "carga",
    eco: `ECO-${i + 1}`,
    loadId: `${fecha}-${sucursal}-${i}`,
    eventoId: `EV-${i + 1}`,
    fecha,
    litros: Math.round((monto / 24) * 10) / 10,
    monto,
    sucursal,
    photos: [],
  }));
}

async function seedFuelData(page: Page): Promise<void> {
  await page.evaluate((entries) => {
    (window as unknown as { fuelEntries: unknown[] }).fuelEntries = entries;
  }, buildFuelFixture());
}

async function openFuelDashboard(page: Page): Promise<void> {
  await page.click("#mn-combustible");
  await expect(page.locator("#view-combustible")).toBeVisible();
  await page.click("#fuel-seg-dash");
  await expect(page.locator("#fchart-consumo")).toBeVisible();
  await page.waitForSelector("#fchart-consumo canvas", { timeout: 10_000 });
  // La tarjeta suele quedar debajo del fold (grid de 3 filas) — sin esto,
  // getBoundingClientRect() en findBarPoint devuelve coordenadas fuera del
  // viewport y el click subsiguiente cae sobre otro elemento (o el vacío).
  await page.locator("#fchart-consumo").scrollIntoViewIfNeeded();
  // Deja terminar la animación de entrada (700ms, chartVivo.animVivo) antes de leer
  // pixeles / clickear — evita clickear a mitad de la animación de crecimiento.
  await page.waitForTimeout(900);
}

/**
 * Encuentra un punto clickeable DENTRO de una barra dibujada en el canvas de ECharts,
 * escaneando líneas horizontales (de más profunda a menos) en busca de la corrida de
 * píxeles no-fondo más ancha. Más robusto que porcentajes fijos del grid (el layout
 * exacto — ancho de labels del eje Y, alto de labels del eje X — no es 1:1 predecible
 * sin acceso a la instancia de ECharts, que el módulo no expone en window).
 */
async function findBarPoint(
  page: Page,
  canvasSelector: string,
): Promise<{ x: number; y: number } | null> {
  return page.evaluate((sel) => {
    const canvas = document.querySelector(sel) as HTMLCanvasElement | null;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / rect.width || 1;
    // Referencia de "fondo": esquina sup-derecha — lejos de la leyenda (arriba-izq),
    // de las barras (abajo) y de las etiquetas del eje X (abajo).
    const bg = ctx.getImageData(canvas.width - 3, 3, 1, 1).data;
    const isBg = (d: Uint8ClampedArray, i: number) =>
      Math.abs(d[i]! - bg[0]!) < 14 &&
      Math.abs(d[i + 1]! - bg[1]!) < 14 &&
      Math.abs(d[i + 2]! - bg[2]!) < 14 &&
      Math.abs(d[i + 3]! - bg[3]!) < 14;
    // De más profundo (cerca del eje 0, donde TODAS las barras tienen presencia) a
    // menos profundo, por si la profundidad máxima cae sobre las etiquetas del eje X.
    const fracs = [0.82, 0.76, 0.7, 0.62, 0.54, 0.46];
    for (const f of fracs) {
      const y = Math.min(canvas.height - 1, Math.round(canvas.height * f));
      const row = ctx.getImageData(0, y, canvas.width, 1).data;
      let bestStart = -1,
        bestLen = 0,
        curStart = -1;
      for (let x = 0; x < canvas.width; x++) {
        const i = x * 4;
        if (!isBg(row, i)) {
          if (curStart === -1) curStart = x;
        } else if (curStart !== -1) {
          const len = x - curStart;
          if (len > bestLen) {
            bestLen = len;
            bestStart = curStart;
          }
          curStart = -1;
        }
      }
      if (curStart !== -1) {
        const len = canvas.width - curStart;
        if (len > bestLen) {
          bestLen = len;
          bestStart = curStart;
        }
      }
      // >4px descarta gridlines/anti-aliasing de 1px; una barra real mide varios px.
      if (bestLen > 4) {
        return {
          x: rect.left + (bestStart + bestLen / 2) / dpr,
          y: rect.top + y / dpr,
        };
      }
    }
    return null;
  }, canvasSelector);
}

test.describe("Combustible — drill-down del comparativo de consumo (smoke e2e)", () => {
  test("abre el dashboard, click en barra → detalle, ← regresa, evolución global", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (text.includes("favicon") || msg.location().url.includes("favicon")) return;
      if (text.includes("Bad uncompressed size")) return;
      // Esperado: cargar el fixture .xlsx dispara un intento de cloud-sync de unidades
      // que ensureSession() aborta A PROPÓSITO en modo E2E (bypass sin Cognito — ver
      // src/api/cloudWire.ts ensureSession). No es un error real de la app.
      if (text.includes("E2E bypass") || text.includes("cloud sync deshabilitado")) return;
      errors.push(text);
    });
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

    // Carga el fixture mensual SOLO para revelar #mainnav (ver comentario arriba) —
    // no aporta datos de combustible.
    await loadMensual(page);

    // Siembra ANTES de entrar a Combustible: initRangoFuel()/renderCombustible() (que
    // showView("combustible") invoca) deben leer el dataset sintético desde el primer render.
    await seedFuelData(page);

    // (1) abre el dashboard del módulo de Combustible sin errores de consola.
    await openFuelDashboard(page);

    // (2) la tarjeta unificada de consumo renderiza en su nivel "comparativo".
    await expect(page.locator("#fchart-consumo")).toBeVisible();
    await expect(page.locator("#fuel-consumo-title")).toHaveText("Consumo por sucursal");
    await expect(page.locator("#fuel-consumo-back")).toBeHidden();

    // (3) click en una barra de sucursal → drill-down a detalle mensual.
    const point = await findBarPoint(page, "#fchart-consumo canvas");
    expect(
      point,
      "no se encontró ninguna barra dibujada en el canvas (ver test-results)",
    ).not.toBeNull();
    // Ruta real: click de mouse sobre el canvas en las coordenadas encontradas
    // escaneando los píxeles ya renderizados (no un fallback simulado) — ejercita
    // el mismo chart.on("click") que un usuario real dispara.
    await page.mouse.click(point!.x, point!.y);

    await expect(page.locator("#fuel-consumo-title")).toContainText("evolución mensual", {
      timeout: 5000,
    });
    await expect(page.locator("#fuel-consumo-back")).toBeVisible();

    // (4) "←" regresa al comparativo.
    await page.click("#fuel-consumo-back");
    await expect(page.locator("#fuel-consumo-title")).toHaveText("Consumo por sucursal");
    await expect(page.locator("#fuel-consumo-back")).toBeHidden();

    // (5) "📈 Evolución global" — detalle de TODAS las sucursales (grupo=null).
    await page.click("#fuel-consumo-global");
    await expect(page.locator("#fuel-consumo-title")).toHaveText(
      "Todas las sucursales — evolución mensual",
    );
    await expect(page.locator("#fuel-consumo-back")).toBeVisible();

    expect(errors, `Console errors:\n${errors.join("\n")}`).toEqual([]);
  });
});
