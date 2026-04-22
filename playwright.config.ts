import { defineConfig, devices } from "@playwright/test";

/**
 * Config Playwright para suite e2e.
 *
 * - testDir apunta a tests/e2e/ (separado de tests/ unitarios de vitest).
 * - webServer: levanta Vite dev en puerto 5190 antes de correr la suite.
 * - reporter: HTML local + dot en stdout.
 * - retries=0 en local (CI debería usar 1-2).
 *
 * Run: npx playwright test
 *      npx playwright test --headed       # ver browser
 *      npx playwright test --ui           # modo interactivo
 *      npx playwright show-report         # ver reporte HTML post-corrida
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: "http://localhost:5190",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "npx vite --port 5190 --strictPort",
    url: "http://localhost:5190/Control%20de%20flotilla.html",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
