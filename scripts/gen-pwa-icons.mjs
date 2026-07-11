// Genera los iconos PNG de la PWA desde public/gpa-logo.png (logo GPA Aqua)
// usando Chrome (canvas → PNG, sin dependencias de imagen). Re-correr si cambia
// el logo (pedido 2026-07-10: el icono de la app debe ser el logo real de GPA).
//
// El logo es más ancho que alto y con transparencia → se dibuja "contain"
// centrado en canvas cuadrado con FONDO BLANCO (iOS pinta negro el alfa; y el
// blanco hace resaltar el emblema azul). Salidas en public/:
// - icon-192.png / icon-512.png       (manifest, purpose any)
// - icon-maskable-512.png             (manifest, purpose maskable — logo al ~62%
//   centrado: la zona segura de Android recorta ~20% del borde en círculo)
// - apple-touch-icon.png              (180×180 — iOS "Añadir a pantalla de inicio")
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUB = resolve(__dirname, "../public");
const logoB64 = readFileSync(resolve(PUB, "gpa-logo.png")).toString("base64");

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();

async function render(size, { pad = 0, bg = "#FFFFFF" } = {}) {
  return page.evaluate(
    async ({ logoB64, size, pad, bg }) => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, size, size);
      }
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = "data:image/png;base64," + logoB64;
      });
      // "contain" centrado: el logo no es cuadrado — escalar al lado mayor
      // dentro del área útil (size - 2*pad) preservando proporción.
      const area = size - pad * 2;
      const scale = Math.min(area / img.width, area / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      return canvas.toDataURL("image/png").split(",")[1];
    },
    { logoB64, size, pad, bg },
  );
}

const out = [
  ["icon-192.png", await render(192, { pad: 14 })],
  ["icon-512.png", await render(512, { pad: 38 })],
  // maskable: Android recorta en círculo el 20% exterior — logo más chico (safe zone)
  ["icon-maskable-512.png", await render(512, { pad: 96 })],
  // iOS redondea él mismo las esquinas; fondo blanco sólido obligatorio (alfa → negro)
  ["apple-touch-icon.png", await render(180, { pad: 18 })],
];
for (const [name, b64] of out) {
  writeFileSync(resolve(PUB, name), Buffer.from(b64, "base64"));
  console.log("✓", name);
}
await browser.close();
