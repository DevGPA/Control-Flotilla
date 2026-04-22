import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  root: ".",
  base: "./",
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: "hidden",
    rollupOptions: {
      output: {
        manualChunks: {
          xlsx: ["xlsx"],
          jspdf: ["jspdf"],
        },
      },
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
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
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // Fuentes self-hosted en vendor/fonts/ (P1.8). globPatterns las precache al build.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
    }),
  ],
});
