import { test, expect, type Page } from "@playwright/test";

// Registro como ficha (spec 2026-09-30 §6/§8): la demo siembra 5 visitas inventadas y abre la
// unidad 06 con las funciones REALES de la app. Red externa bloqueada.
const URL_DEMO = "/Control%20de%20flotilla.html?e2e=1&demo=registro-ficha";
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

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

test.describe("registro como ficha — demo local", () => {
  test.beforeEach(async ({ page }) => {
    await abrir(page);
  });

  test("abre en la ficha: cómo va, datos plegados y hallazgos en Todas con los de firma primero", async ({
    page,
  }) => {
    const m = page.locator("#taller-modal");
    await expect(m.locator("#tl-mttl")).toHaveText(/Unidad 06 · PRB0006/);
    await expect(m.locator("#tf-ficha")).toBeVisible();
    await expect(m.locator("#tf-ficha")).toContainText("Cómo va");
    await expect(m.locator("#tf-ficha-gpa")).toContainText("En Reparación");
    await expect(m.locator("#tf-ficha-taller")).toContainText("REPARANDO");
    // La fórmula de la tabla (medianoche UTC) da 5 por la mañana y 6 por la tarde en México.
    await expect(m.locator("#tf-ficha-dias")).toContainText(/[56] días/);
    await expect(m.locator("#tf-ficha-salida")).toContainText("1 día después de lo estimado");
    await expect(m.locator("#tf-ficha-costo")).toContainText("Esperando tu firma");
    await expect(m.locator("#tf-datos")).not.toHaveAttribute("open", "");
    const grupos = m.locator("#tf-prov-partidas .tl-ficha-grupo");
    await expect(grupos.first()).toHaveText("Esperan tu firma");
    await expect(grupos.nth(1)).toContainText("Autorizados · suman");
  });

  test("el foco inicial está en el título, no en un botón que emite o firma", async ({ page }) => {
    await page.waitForTimeout(200);
    const id = await page.evaluate(() => document.activeElement?.id ?? "");
    expect(id).toBe("tl-mttl");
  });

  test("Guardar apagado hasta que cambias algo en Datos del registro", async ({ page }) => {
    const m = page.locator("#taller-modal");
    await expect(m.locator("#btn-guardar-taller")).toBeDisabled();
    await expect(m.locator("#tf-sin-cambios")).toBeVisible();
    await m.locator("#tf-datos > summary").click();
    await m.locator("#tf-km").fill("86000");
    await expect(m.locator("#btn-guardar-taller")).toBeEnabled();
    await expect(m.locator("#tf-sin-cambios")).toBeHidden();
  });

  test("la liga dice un nombre en cuanto llega el directorio, y nunca un GUID", async ({
    page,
  }) => {
    const meta = page.locator("#tf-prov-liga-meta");
    await expect(meta).toContainText("emitida por un usuario de GPA");
    await expect(meta).toContainText("emitida por Ana López", { timeout: 10_000 });
    expect(await page.locator("#taller-modal").innerText()).not.toMatch(GUID);
    await expect(page.locator("#btn-liga-copiar")).toHaveText("Copiar liga");
  });

  test("autorizar un hallazgo actualiza la ficha y no enciende Guardar", async ({ page }) => {
    const m = page.locator("#taller-modal");
    await expect(m.locator("#tf-ficha-costo")).toContainText("$2,400.00");
    await m
      .locator("#tf-prov-partidas")
      .getByRole("button", { name: /Autorizar/ })
      .first()
      .click();
    await expect(m.locator("#tf-ficha-costo")).not.toContainText("Esperando tu firma");
    await expect(m.locator("#tf-ficha-costo")).toContainText("$6,250.00");
    await expect(m.locator("#btn-guardar-taller")).toBeDisabled();
  });

  test("el alta abre con el formulario desplegado, sin ficha y con Guardar encendido", async ({
    page,
  }) => {
    await page.locator("#taller-modal .tl-cancel").click();
    await page
      .getByRole("button", { name: /Nuevo Ingreso/ })
      .first()
      .click();
    const m = page.locator("#taller-modal.open");
    await expect(m.locator("#tl-mttl")).toHaveText("Agregar unidad al taller");
    await expect(m.locator("#tf-ficha")).toBeHidden();
    await expect(m.locator("#tf-datos")).toHaveAttribute("open", "");
    await expect(m.locator("#btn-guardar-taller")).toBeEnabled();
  });

  test("cerrar con cambios pregunta; cancelar deja lo tecleado", async ({ page }) => {
    const m = page.locator("#taller-modal");
    await m.locator("#tf-datos > summary").click();
    await m.locator("#tf-km").fill("90000");
    let pregunta = "";
    page.once("dialog", async (d) => {
      pregunta = d.message();
      await d.dismiss();
    });
    await page.locator('#taller-modal button[aria-label="Cerrar modal de taller"]').click();
    expect(pregunta).toBe("¿Descartar los cambios?");
    await expect(m).toHaveClass(/open/);
    await expect(m.locator("#tf-km")).toHaveValue("90000");
  });

  test("viewer: ve la ficha, 'Ver datos' con campos deshabilitados y sin firmar", async ({
    page,
  }) => {
    await page.selectOption("#demo-rol-sel", "viewer");
    const m = page.locator("#taller-modal");
    await expect(m.locator("#tf-ficha")).toBeVisible();
    await expect(m.locator("#tf-datos .tl-datos-ver")).toHaveText("Ver datos");
    // Playwright no evalúa `disabled` sobre un <fieldset>; lo que cuenta es que sus campos lo hereden.
    await expect(m.locator("#tf-datos-campos")).toHaveAttribute("disabled", "");
    await m.locator("#tf-datos > summary").click();
    await expect(m.locator("#tf-km")).toBeDisabled();
    await expect(
      m.locator("#tf-prov-partidas").getByRole("button", { name: /Autorizar/ }),
    ).toHaveCount(0);
  });

  test("reingresar desde el registro deja las dos visitas en el historial de la unidad (decisión 26)", async ({
    page,
  }) => {
    await page.locator("#btn-reingreso").click();
    const m = page.locator("#taller-modal.open");
    await expect(m.locator("#tl-mttl")).toHaveText("Reingresar al Taller");
    await m.locator("#tf-tipo").selectOption("Correctivo");
    await m.locator("#tf-km").fill("85500");
    await m.locator("#btn-guardar-taller").click();
    const claves = await page.evaluate(() =>
      (window as unknown as { tallerEntries: { unitKey?: string; eco?: string }[] }).tallerEntries
        .filter((e) => e.eco === "06")
        .map((e) => e.unitKey),
    );
    expect(claves).toEqual(["demo-u06", "demo-u06"]);
  });
});

test.describe("registro como ficha — celular (390 px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("aviso tocable, cinco botones de al menos 44 px y sin scroll horizontal", async ({
    page,
  }) => {
    await abrir(page);
    const aviso = page.locator("#tf-aviso-firma");
    await expect(aviso).toBeVisible();
    await expect(aviso).toHaveText(/1 hallazgo espera tu firma · \$2,400\.00 · Ver →/);
    await aviso.click();
    await expect(
      page
        .locator("#tf-prov-partidas")
        .getByRole("button", { name: /Autorizar/ })
        .first(),
    ).toBeInViewport();
    for (const sel of [
      ".tl-cancel",
      "#btn-reingreso",
      "#btn-expediente",
      "#btn-finalizar",
      "#btn-guardar-taller",
    ]) {
      const b = page.locator(`#taller-modal ${sel}`);
      await expect(b).toBeVisible();
      expect((await b.boundingBox())!.height, sel).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
