---
name: visual-pass
description: Levanta la app real de Control Flotilla en un navegador y captura una vista con datos sembrados, en tema claro y oscuro. Úsalo cuando haya que VER en pantalla un cambio de UI antes de desplegar — pills, chips de KPI, tablas, modales, jerarquía visual — o cuando alguien pida screenshots de la app. Los tests unitarios no pueden verificar el aspecto.
version: "1.0"
user-invocable: true
argument-hint: "[vista: combustible | inspecciones | semanales | taller | cumplimiento]"
---

# Pasada visual de la app

Los 1,200+ tests de vitest verifican el DOM y la lógica, **no el aspecto**. Un cambio de CSS puede
dejar la suite verde y un elemento invisible en pantalla. Esta receta levanta la app de verdad, la
puebla con datos y captura claro + oscuro.

> **Origen:** escrita el 30-jul-2026 tras la fase 1 del programa de ruido de indicadores. En esa
> pasada la pill `Esperando a Ops` se pintaba **sin pastilla visible** (fondo y borde a 1-2 % de
> luminancia de la fila) con 1,225 tests en verde. Ningún test podía atraparlo.

## Lo que hay que saber antes (y cuesta descubrir)

1. **Usa la config LOCAL de Playwright, no la estándar.**
   ```bash
   npx playwright test -c playwright.local.config.ts tests/e2e/<spec>.spec.ts
   ```
   El CDN de Playwright está bloqueado en la red GPA, así que no hay binarios de Chromium ni ffmpeg
   descargados. `playwright.local.config.ts` usa el Chrome del sistema (`channel: "chrome"`) y apaga
   el video. La config estándar puede fallar por browser ausente.

2. **La app se abre con `?e2e=1`:** `/Control%20de%20flotilla.html?e2e=1`.
   Ese flag **salta Cognito** (`E2E_BYPASS` en `src/api/cloudWire.ts`) y el service worker
   (`src/main.ts`). Sin él te quedas en la pantalla de login. El dev server lo levanta el
   `webServer` de `playwright.config.ts` en el puerto 5190 — no lo arranques a mano.

3. **⚠️ Sin sesión, `canWrite` es `false`.** Todo lo que dependa de permiso de escritura **no se
   pinta**: el aviso `.fv-bloqueo`, los botones Anular/Restaurar, el corrector de odómetro. Si lo que
   necesitas ver es UI de admin, esta receta no basta: hace falta mockear la sesión.

4. **Hay un modal de período que tapa la vista** y hay que cerrarlo antes de capturar.

5. **Sembrar datos es obligatorio**: con `?e2e=1` no hay nube, así que los módulos salen vacíos. Cada
   módulo se hidrata desde un global de `window` y se re-pinta con su función global. Para Combustible:
   `window.fuelEntries` (array de `FuelEntry`) → `window.showView("combustible")` →
   `window.initRangoFuel()` → `window.renderCombustible()`.

6. **El rango de fechas puede esconderte los datos.** `initRangoFuel()` acota el período; si sembraste
   fechas viejas (histórico), ensancha el rango escribiendo en `#fuel-desde` / `#fuel-hasta` con un
   evento `change` y vuelve a renderizar.

7. **Las capturas van a `test-results/`, que está gitignoreado.** No se commitean.

8. **El spec es desechable: bórralo al terminar.** No lo commitees — y si lo dejas puesto, el hook de
   pre-push lo correrá con la config estándar (ver punto 1).

## Receta

Crea `tests/e2e/tmp-visual-<tema>.spec.ts`, córrelo, **mira las capturas con la herramienta Read**, y
bórralo.

```ts
import { test, type Page } from "@playwright/test";

const APP = "/Control%20de%20flotilla.html?e2e=1";
const OUT = "test-results/visual-<tema>";

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
    document.getElementById("periodo-modal")?.classList.remove("open");
  });
}

async function setTheme(page: Page, mode: "light" | "dark") {
  await page.evaluate((m) => {
    if (m === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    try {
      localStorage.setItem("gpa-theme", m);
    } catch {
      /* private mode */
    }
  }, mode);
  await page.waitForTimeout(350); // ECharts + CSS custom resyncan
}

test("pasada visual", async ({ page }) => {
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errores.push(m.text()));

  await page.goto(APP);
  await dismissPeriodoModal(page);

  // 1. SIEMBRA — adapta al módulo (ver tabla abajo)
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.fuelEntries = [
      /* FuelEntry[] mínimos: loadId, tipo, eco, eventoId, fecha, sucursal,
         tipoUnidad, esMontacargas, photos: [] — más lo que tu caso necesite */
    ];
    (w.showView as (v: string) => void)?.("combustible");
    (w.initRangoFuel as () => void)?.();
    (w.renderCombustible as () => void)?.();
  });
  await page.waitForTimeout(900);

  // 2. AFIRMA QUÉ SE PINTÓ — si esto sale vacío, la captura sería una mentira
  const pintado = await page.evaluate(() => ({
    tarjetas: [...document.querySelectorAll("#fuel-kpis .kc")].map((k) => ({
      label: k.querySelector(".klbl")?.textContent,
      value: k.querySelector(".kval")?.textContent,
      title: (k as HTMLElement).title || undefined,
    })),
    filas: document.querySelectorAll("#fuel-tbody tr").length,
  }));
  console.log("PINTADO:", JSON.stringify(pintado, null, 1));

  // 3. CAPTURA claro + oscuro
  for (const modo of ["light", "dark"] as const) {
    await setTheme(page, modo);
    await page.locator("#fuel-kpis").screenshot({ path: `${OUT}/kpis-${modo}.png` });
    await page.locator("#fuel-tbody").screenshot({ path: `${OUT}/tabla-${modo}.png` });
  }
  console.log("ERRORES:", JSON.stringify(errores.slice(0, 10)));
});
```

## Contrato de siembra por módulo

| Módulo | Global a sembrar | Re-pintar con |
|---|---|---|
| Combustible | `window.fuelEntries` | `showView("combustible")` · `initRangoFuel()` · `renderCombustible()` |
| Inspecciones | `window.__inspections` / `window.__fleetUnits` | `showView("inspecciones")` · `applyDateRange(desde, hasta)` |
| Semanales | `window.weeklyPeriodos` | `showView("semanales")` · `initRangoSemanal()` · `renderSemanales()` |
| Taller | `window.tallerEntries` | `showView("taller")` · `renderTaller()` |

Los nombres exactos viven en el bloque `declare global` de `src/api/cloudHydrate.ts` — confírmalos ahí
antes de sembrar, no de memoria.

## Regla de oro

**Mira la imagen.** Un `expect` que pasa no dice nada del aspecto, y un frame en blanco es un fallo de
arranque disfrazado de éxito. Si no abriste la captura con Read, no hiciste una pasada visual.
