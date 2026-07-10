import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * Config LOCAL para esta máquina (red GPA): el CDN de Playwright está bloqueado,
 * así que no hay binarios de Chromium/ffmpeg descargados. Usa el Chrome del
 * sistema (channel) y apaga video (requiere el ffmpeg del CDN).
 *
 * Run: npx playwright test -c playwright.local.config.ts
 */
export default defineConfig({
  ...base,
  use: {
    ...base.use,
    video: "off",
  },
  projects: [
    {
      name: "chrome-local",
      use: { channel: "chrome" },
    },
  ],
});
