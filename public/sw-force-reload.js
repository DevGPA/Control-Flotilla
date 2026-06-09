// Importado por el service worker (workbox.importScripts en vite.config.ts).
//
// Incidente 2026-06-09: usuarios quedaban ATASCADOS en versiones viejas de la
// PWA — el SW nuevo se instalaba (autoUpdate: skipWaiting+clientsClaim) pero la
// página ya cargada nunca se recargaba, así que seguían viendo el app shell
// viejo precacheado (sin filtro de fechas semanal, sin flujo cloud, "cargar
// ZIP") hasta un hard refresh manual.
//
// Fix: cuando este SW se activa REEMPLAZANDO a uno anterior (update), navega
// (recarga) todas las pestañas/ventanas para que carguen el shell nuevo del
// precache. En la PRIMERA instalación (registration.active === null durante
// install) NO recarga — no interrumpe la primera visita ni el login.
let __isUpdate = false;
self.addEventListener("install", () => {
  __isUpdate = !!self.registration.active;
});
self.addEventListener("activate", (event) => {
  if (!__isUpdate) return;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) =>
        Promise.all(
          clients.map((c) =>
            typeof c.navigate === "function" ? c.navigate(c.url).catch(() => {}) : null,
          ),
        ),
      ),
  );
});
