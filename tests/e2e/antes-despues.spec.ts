import { test, expect } from "@playwright/test";

// Vista local del frente antes/después (spec 2026-09-28 §8.1): la demo de desarrollo
// siembra una visita INVENTADA y abre su registro usando las funciones REALES de la app.
// Red externa bloqueada: nada sale de la máquina.
const URL_DEMO = "/Control%20de%20flotilla.html?e2e=1&demo=antes-despues";

test.describe("antes y después por hallazgo — registro de la unidad (demo local)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/*", (r) => {
      const u = new URL(r.request().url());
      if (u.protocol === "data:" || u.protocol === "blob:") return r.continue();
      return ["localhost", "127.0.0.1"].includes(u.hostname) ? r.continue() : r.abort();
    });
    await page.goto(URL_DEMO);
    await expect(page.locator("#demo-antes-despues")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#taller-modal.open")).toBeVisible();
    // El registro abre en "Todas" (agrupado); el filtro "Autorizadas" sigue existiendo y aísla ese grupo.
    await page
      .locator("#tf-prov-partidas")
      .getByRole("button", { name: /Autorizadas/ })
      .click();
  });

  test("la refacción autorizada sin después lo dice en su fila", async ({ page }) => {
    await expect(page.locator("#tf-prov-partidas")).toContainText("Sin foto del después");
  });

  test("🖼 abre ANTES y DESPUÉS lado a lado; la tira cambia la foto; pantalla completa; Esc lo cierra", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: /Antes y después/ })
      .first()
      .click();
    const visor = page.locator("#taller-visor-antes-despues");
    await expect(visor).toBeVisible();
    await expect(visor).toContainText("ANTES · 14 sep · 1 foto");
    await expect(visor).toContainText("DESPUÉS · 16 sep · 2 fotos");

    // Spec §8: se cambia la foto con la tira. Solo cambia SU lado.
    const imgAntes = visor.locator('img[data-lado="antes"]');
    const imgDespues = visor.locator('img[data-lado="despues"]');
    await expect(imgAntes).toHaveAttribute("src", /^data:/);
    await expect(imgDespues).toHaveAttribute("src", /^data:/);
    const srcAntes = await imgAntes.getAttribute("src");
    const srcDespues1 = await imgDespues.getAttribute("src");
    const mini2 = visor.getByRole("button", { name: "después: foto 2 de 2" });
    await expect(mini2).toHaveAttribute("aria-pressed", "false");
    await mini2.click();
    await expect(mini2).toHaveAttribute("aria-pressed", "true");
    await expect(imgDespues).toHaveAttribute("src", /^data:/);
    await expect(imgDespues).not.toHaveAttribute("src", srcDespues1!);
    await expect(imgAntes).toHaveAttribute("src", srcAntes!);

    // Spec §8: abre pantalla completa. El clic real de Playwright falla si algo tapa el
    // botón (el aviso MODO DEMO lo tapaba antes de moverlo arriba y sin atrapar clics).
    await page.getByRole("button", { name: "Ver antes en pantalla completa" }).click();
    await expect(page.locator("#taller-visor-fotos")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Fotos del taller" })).toBeVisible();
    await expect(visor).toHaveCount(0);

    // Esc cierra la pantalla completa y el A+ vuelve con su estado (la foto 2 del después).
    await page.keyboard.press("Escape");
    await expect(page.locator("#taller-visor-fotos")).toHaveCount(0);
    await expect(visor).toBeVisible();
    await expect(visor.getByRole("button", { name: "después: foto 2 de 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.keyboard.press("Escape");
    await expect(visor).toHaveCount(0);
  });

  test("finalizar con una refacción sin después avisa, y cancelar no cierra nada", async ({
    page,
  }) => {
    const textos: string[] = [];
    page.on("dialog", async (d) => {
      textos.push(d.message());
      await d.dismiss();
    });
    await page.evaluate(() =>
      (window as unknown as { finalizarUnidad: (id: string) => void }).finalizarUnidad(
        "demo-antes-despues",
      ),
    );
    expect(textos.join("\n")).toContain("1 refacción autorizada no tiene foto del después");
    expect(textos.join("\n")).toContain("Balatas delanteras desgastadas");
    const estado = await page.evaluate(
      () => (window as unknown as { tallerEntries: { estado: string }[] }).tallerEntries[0]!.estado,
    );
    expect(estado).toBe("En Reparación");
  });

  // En el navegador normal de Navares no hay page.route: puede haber tokens de Cognito
  // guardados de un login anterior en localhost, y la sesión admin de mentira de la demo
  // abre en la UI caminos que escriben directo con el cliente de Amplify (Accesorios, la
  // captura manual de hallazgos). La demo misma corta la red externa; lo local sigue vivo.
  test("la demo corta la red externa ella misma; lo local sigue vivo", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const externo = await fetch("https://ejemplo.invalid/graphql", { method: "POST" }).then(
        () => "salió",
        (e: unknown) => String(e),
      );
      let xhr = "salió";
      try {
        new XMLHttpRequest().open("PUT", "https://ejemplo.invalid/foto.jpg");
      } catch (e) {
        xhr = String(e);
      }
      const local = (await fetch(window.location.href)).ok;
      return { externo, xhr, local };
    });
    expect(r.externo).toContain("red externa bloqueada");
    expect(r.xhr).toContain("red externa bloqueada");
    expect(r.local).toBe(true);
  });
});
