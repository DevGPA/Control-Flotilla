import { test, expect, type Page } from "@playwright/test";

// Cambiar de decisión (2026-10-01): sobre la demo del registro como ficha (5 visitas
// inventadas; la unidad 06 abre con 1 autorizada sin terminar, 2 terminadas y 1 propuesta).
// Red externa bloqueada; el guardado es el doble local de la demo con las funciones REALES.
const URL_DEMO = "/Control%20de%20flotilla.html?e2e=1&demo=registro-ficha";

async function abrir(page: Page): Promise<void> {
  await page.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.protocol === "data:" || u.protocol === "blob:") return r.continue();
    return ["localhost", "127.0.0.1"].includes(u.hostname) ? r.continue() : r.abort();
  });
  await page.goto(URL_DEMO);
  await expect(page.locator("#demo-registro-ficha")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#taller-modal.open")).toBeVisible();
}

test.describe("cambiar de decisión — demo local", () => {
  test.beforeEach(async ({ page }) => {
    await abrir(page);
  });

  test("retirar una autorización y volver a autorizarla: la ficha y los grupos siguen el cambio", async ({
    page,
  }) => {
    const lista = page.locator("#tf-prov-partidas");
    const costo = page.locator("#tf-ficha-costo");
    await expect(costo).toContainText("$3,850.00");

    // Solo la autorizada SIN terminar ofrece la acción contraria: las 2 terminadas, no.
    const redecidir = lista.locator("button.tl-redecidir-btn");
    await expect(redecidir).toHaveCount(1);
    await expect(redecidir).toHaveText("✕ Retirar autorización");

    await redecidir.click();
    const panelSelect = lista.locator("select:visible");
    await expect(panelSelect).toHaveCount(1);
    await panelSelect.selectOption("No es necesario ahora");
    // El panel dice lo que estás haciendo (2026-10-02): no "rechazo".
    await expect(lista.getByText("¿Por qué retiras la autorización?")).toBeVisible();
    await lista
      .getByRole("button", { name: "Retirar autorización", exact: true })
      .filter({ visible: true })
      .click();

    // Queda rechazada: deja de sumar y pasa al grupo "No autorizados".
    await expect(costo).toContainText("$2,000.00");
    await expect(costo).not.toContainText("$3,850.00");
    const grupos = lista.locator(".tl-ficha-grupo");
    await expect(grupos.filter({ hasText: "No autorizados" })).toHaveCount(1);
    await expect(lista).toContainText("Rechazada por");
    await expect(lista).toContainText("No es necesario ahora");

    // La misma partida ahora ofrece volver a autorizar.
    await expect(redecidir).toHaveCount(1);
    await expect(redecidir).toHaveText("✓ Autorizar");
    await redecidir.click();
    await expect(costo).toContainText("$3,850.00");
    await expect(grupos.filter({ hasText: "No autorizados" })).toHaveCount(0);
    await expect(redecidir).toHaveText("✕ Retirar autorización");
  });

  // Navares (2026-10-02): "¿y si se rechaza primero y después se quiere autorizar?"
  test("rechazar primero un hallazgo que esperaba firma y después autorizarlo", async ({
    page,
  }) => {
    const lista = page.locator("#tf-prov-partidas");
    const costo = page.locator("#tf-ficha-costo");
    await expect(costo).toContainText("Esperando tu firma");

    // El que espera firma (Amortiguador, $2,400) se rechaza desde su fila de siempre.
    await lista
      .getByRole("button", { name: /No autorizar/ })
      .first()
      .click();
    await lista.locator("select:visible").selectOption("Precio alto — recotizar");
    await lista
      .getByRole("button", { name: "Confirmar rechazo" })
      .filter({ visible: true })
      .click();
    await expect(costo).not.toContainText("Esperando tu firma");
    await expect(
      lista.locator(".tl-ficha-grupo").filter({ hasText: "No autorizados" }),
    ).toHaveCount(1);
    await expect(lista).toContainText("Precio alto — recotizar");

    // Ya rechazado, ofrece volver a autorizarlo; al hacerlo suma al autorizado.
    const reautorizar = lista.locator("button.tl-redecidir-btn", { hasText: "✓ Autorizar" });
    await expect(reautorizar).toHaveCount(1);
    await reautorizar.click();
    await expect(costo).toContainText("$6,250.00");
    await expect(
      lista.locator(".tl-ficha-grupo").filter({ hasText: "No autorizados" }),
    ).toHaveCount(0);
  });

  test("viewer: no ve la acción contraria", async ({ page }) => {
    await page.selectOption("#demo-rol-sel", "viewer");
    await expect(page.locator("#tf-prov-partidas button.tl-redecidir-btn")).toBeHidden();
  });
});

// Revisión 2026-10-02 (Important C): en celular el botón "✕ Retirar autorización" no puede
// ensanchar el registro. Se mide el cuerpo del modal (tiene su propio scroll), no la página.
test.describe("cambiar de decisión — celular (390 px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("el botón de retirar cabe: el registro no se desplaza de lado", async ({ page }) => {
    await abrir(page);
    const btn = page.locator("#tf-prov-partidas button.tl-redecidir-btn");
    await expect(btn).toHaveText("✕ Retirar autorización");
    await btn.scrollIntoViewIfNeeded();
    const medida = await page.evaluate(() => {
      const b = document.querySelector("#taller-modal .tl-mbody") as HTMLElement;
      return { scroll: b.scrollWidth, cliente: b.clientWidth };
    });
    expect(medida.scroll, JSON.stringify(medida)).toBeLessThanOrEqual(medida.cliente + 1);
    const caja = await btn.boundingBox();
    expect(caja!.x + caja!.width).toBeLessThanOrEqual(390);
  });
});
