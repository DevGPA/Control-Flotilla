import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Valida que los iconos referenciados en el manifest PWA existan en public/.
// Si falta alguno, falla el build con mensaje claro en lugar de producir un manifest roto
// que rompería "Add to Home Screen" silenciosamente en producción.
// Post-fix (2026-04-23): se unificó a un solo favicon.svg con type="image/svg+xml" y
// sizes="any" — modern PWA spec lo acepta para todos los tamaños. Si en el futuro se
// requiere soporte iOS home-screen legacy, añadir icon-180.png y listarla aquí.
const PWA_ICONS = ["favicon.svg"];
const verifyPwaIcons = {
  name: "verify-pwa-icons",
  buildStart() {
    const missing = PWA_ICONS.filter((f) => !existsSync(resolve("public", f)));
    if (missing.length) {
      const msg =
        `PWA manifest referencia iconos inexistentes en public/: ${missing.join(", ")}. ` +
        `Genera o copia los archivos antes de build, o actualiza vite.config.ts.`;
      this.warn(msg);
    }
  },
};

export default defineConfig({
  root: ".",
  base: "./",
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: "hidden",
    // manualChunks removido: xlsx/jspdf se sirven como ./vendor/*.js standalone,
    // no se importan en módulos TS actuales. Vite emitía chunks vacíos (0 kB).
    // Si algún módulo src/ empieza a importar xlsx/jspdf, reintroduce chunks aquí
    // para aislarlos del bundle principal.
  },
  test: {
    environment: "happy-dom",
    globals: true,
    // Excluye e2e (Playwright) — se corren con `npm run test:e2e`.
    exclude: ["**/node_modules/**", "**/dist/**", "tests/e2e/**"],
    coverage: {
      reporter: ["text", "html", "json-summary"],
      include: ["src/**"],
      exclude: ["src/main.ts", "src/**/*.d.ts"],
      // Threshold 80% — si baja, CI falla (P3.5 roadmap)
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
  plugins: [
    verifyPwaIcons,
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Control de Flotilla GPA",
        short_name: "Flotilla",
        description: "Control de checklist, taller e historial de flotilla GPA",
        theme_color: "#0F172A",
        background_color: "#F8FAFC",
        display: "standalone",
        start_url: "./",
        icons: [
          {
            src: "favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // Fuentes self-hosted en vendor/fonts/ (P1.8). globPatterns las precache al build.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
    }),
  ],
});
