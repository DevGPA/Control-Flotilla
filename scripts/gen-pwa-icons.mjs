// Genera los iconos PNG de la PWA desde public/favicon.svg usando Chrome
// (canvas → PNG, sin dependencias de imagen). Re-correr si cambia el favicon.
//
// Salidas en public/:
// - icon-192.png / icon-512.png       (manifest, purpose any)
// - icon-maskable-512.png             (manifest, purpose maskable — logo al 72%
//   centrado: la zona segura de Android recorta ~20% del borde)
// - apple-touch-icon.png              (180×180 — iOS "Añadir a pantalla de inicio")
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUB = resolve(__dirname, "../public");
const svg = readFileSync(resolve(PUB, "favicon.svg"), "utf8");

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();

async function render(size, { pad = 0, bg = null } = {}) {
  return page.evaluate(
    async ({ svg, size, pad, bg }) => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, size, size);
      }
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = url;
      });
      const inner = size - pad * 2;
      ctx.drawImage(img, pad, pad, inner, inner);
      URL.revokeObjectURL(url);
      return canvas.toDataURL("image/png").split(",")[1];
    },
    { svg, size, pad, bg },
  );
}

const out = [
  ["icon-192.png", await render(192)],
  ["icon-512.png", await render(512)],
  // maskable: logo al ~72% sobre el mismo azul del branding (safe zone Android)
  ["icon-maskable-512.png", await render(512, { pad: 72, bg: "#1E4FA3" })],
  // iOS no aplica esquinas por manifest: fondo sólido cuadrado, iOS redondea
  ["apple-touch-icon.png", await render(180, { pad: 14, bg: "#1E4FA3" })],
];
for (const [name, b64] of out) {
  writeFileSync(resolve(PUB, name), Buffer.from(b64, "base64"));
  console.log("✓", name);
}
await browser.close();
