import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Valida que los iconos referenciados en el manifest PWA existan en public/.
// Si falta alguno, falla el build con mensaje claro en lugar de producir un manifest roto
// que rompería "Add to Home Screen" silenciosamente en producción.
// 2026-07-10 (instalabilidad móvil): PNGs reales generados por
// scripts/gen-pwa-icons.mjs — Chrome exige 192+512 png para el prompt de instalación
// (el favicon.svg solo no bastaba) e iOS necesita apple-touch-icon.png.
const PWA_ICONS = [
  "favicon.svg",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "apple-touch-icon.png",
];
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

export default defineConfig(({ mode }) => ({
  root: ".",
  base: "./",
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: "hidden",
    rollupOptions: {
      // Doble entry: index.html (redirect-stub) + Control de flotilla.html (app legacy).
      // Sin esto, Vite solo bundlea index.html y la app real queda fuera del dist.
      input: {
        index: resolve(__dirname, "index.html"),
        app: resolve(__dirname, "Control de flotilla.html"),
      },
    },
    // manualChunks removido: xlsx/jspdf se sirven como ./vendor/*.js standalone,
    // no se importan en módulos TS actuales. Vite emitía chunks vacíos (0 kB).
    // Si algún módulo src/ empieza a importar xlsx/jspdf, reintroduce chunks aquí
    // para aislarlos del bundle principal.
  },
  // WCAG aparte — limpieza hygiene prod: esbuild drop elimina `console.*` y
  // `debugger` del bundle producción (sigue activo en dev). Afecta solo módulos
  // TS bajo src/; el HTML legado con inline `console.*` no pasa por esbuild.
  esbuild:
    mode === "production" ? { drop: ["console", "debugger"], pure: ["console.log"] } : undefined,
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
      // ── PWA REACTIVADA (2026-07-10, pedido: instalar la app en el celular) ──
      // Historia: el SW se desmanteló el 2026-06-18 (selfDestroying) por el
      // incidente de shell viejo. La causa de RAÍZ ya está corregida por diseño
      // abajo: el HTML NUNCA se precachea (NetworkFirst + navigateFallback:null),
      // los assets con hash sí (inmutables), sw-force-reload recarga pestañas al
      // activarse un update y el registro manual (main.ts) re-chequea el sw.js
      // por hora/visibilidad con updateViaCache:'none'. Con eso la instalación
      // móvil (Android prompt + iOS A2HS) es segura sin revivir el stale-shell.
      selfDestroying: false,
      registerType: "autoUpdate",
      // Registro MANUAL en src/main.ts (updateViaCache:'none' + update periódico).
      // El registerSW.js autogenerado era un register() pelón sin mecanismo de
      // actualización → usuarios atascados en versiones viejas (2026-06-09).
      injectRegister: null,
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "GPA Fleet Command — Control de Flotilla",
        short_name: "Flotilla GPA",
        description: "Control vehicular GPA: inspecciones, taller, combustible y cumplimiento",
        lang: "es-MX",
        theme_color: "#1E4FA3",
        background_color: "#F8FAFC",
        display: "standalone",
        start_url: "./",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        // ── Fix de RAÍZ del stale-shell (2026-06-15): el HTML NO se precachea ──
        // Causa de fondo de la clase "app sin estilos / shell viejo": el SW servía
        // el HTML del precache (cache-first), y un HTML viejo apunta a bundles con
        // hash que ya no existen. Solución: el app-shell va por NetworkFirst →
        // siempre intenta la red primero (HTML fresco con internet, que es el 99%
        // del tiempo) y cae a caché solo offline. Los assets con hash (js/css/svg/
        // woff2) SÍ se precachean (son inmutables por hash). Se conserva la PWA
        // instalable y la carga offline del último shell visto.
        globPatterns: ["**/*.{js,css,svg,png,woff2}"], // sin html → shell no precacheado
        navigateFallback: null, // no servir un index precacheado en navegación
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "html-shell",
              networkTimeoutSeconds: 4, // red lenta/caída → cae a caché tras 4s
              expiration: { maxEntries: 8 },
            },
          },
        ],
        // Recarga las pestañas con app shell viejo al activarse un SW de UPDATE
        // (ver public/sw-force-reload.js — incidente PWA stale 2026-06-09).
        importScripts: ["sw-force-reload.js"],
        // Al activarse un SW nuevo, purga los precaches de versiones anteriores.
        cleanupOutdatedCaches: true,
      },
    }),
  ],
}));
