// Directorio de usuarios para "Emitida por NOMBRE" (spec 2026-09-30 §4.7): lectura
// PASIVA (nunca ensureSession), UNA vez por sesión, paginada, y que se calla si falla.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.fn();
vi.mock("../src/api/amplifyClient", () => ({
  getClient: () => ({ models: { UserProfile: { list } } }),
}));
vi.mock("aws-amplify/auth", () => ({
  getCurrentUser: vi.fn(async () => ({ userId: "44444444-2222-4333-8444-555555555555" })),
}));

const SUB_ANA = "11111111-2222-4333-8444-555555555555";
const pagina = (data: unknown[], nextToken: string | null) => ({
  data,
  nextToken,
  errors: undefined,
});
const sesion = (s: unknown): void => {
  (window as unknown as { __cloudSession: unknown }).__cloudSession = s;
};

describe("directorioUsuarios", () => {
  beforeEach(() => {
    vi.resetModules();
    list.mockReset();
    sesion({
      username: "yo@ejemplo.test",
      email: "yo@ejemplo.test",
      tenantId: "demo",
      groups: ["operativo"],
    });
  });

  it("pagina con nextToken y arma el mapa por cognitoSub", async () => {
    list
      .mockResolvedValueOnce(
        pagina([{ cognitoSub: SUB_ANA, email: "ana@ejemplo.test", nombre: "Ana López" }], "t1"),
      )
      .mockResolvedValueOnce(
        pagina(
          [
            {
              cognitoSub: "22222222-2222-4333-8444-555555555555",
              email: "luis@ejemplo.test",
              nombre: null,
            },
          ],
          null,
        ),
      );
    const m = await import("../src/api/directorioUsuarios");
    const d = await m.cargarDirectorio();
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[1]![0]).toMatchObject({ nextToken: "t1" });
    expect(d?.get(SUB_ANA)?.nombre).toBe("Ana López");
    expect(m.directorioEnCache()).toBe(d);
  });

  it("pide una sola vez aunque se llame dos veces (una por sesión)", async () => {
    list.mockResolvedValue(pagina([], null));
    const m = await import("../src/api/directorioUsuarios");
    await Promise.all([m.cargarDirectorio(), m.cargarDirectorio()]);
    await m.cargarDirectorio();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("sin sesión ⇒ null sin llamar a la nube; con error ⇒ null sin lanzar", async () => {
    sesion(null);
    const m = await import("../src/api/directorioUsuarios");
    expect(await m.cargarDirectorio()).toBeNull();
    expect(list).not.toHaveBeenCalled();
    sesion({ tenantId: "demo", username: "x@ejemplo.test", email: "x@ejemplo.test", groups: [] });
    list.mockRejectedValueOnce(new Error("red"));
    expect(await m.cargarDirectorio()).toBeNull();
  });

  it("yoActual: sub de getCurrentUser y correo de la sesión, en caché", async () => {
    const m = await import("../src/api/directorioUsuarios");
    expect(await m.yoActual()).toEqual({
      sub: "44444444-2222-4333-8444-555555555555",
      email: "yo@ejemplo.test",
    });
    expect(m.yoEnCache().sub).toBe("44444444-2222-4333-8444-555555555555");
  });

  it("nunca llama a ensureSession (lectura pasiva, B-I5)", () => {
    const src = readFileSync(join(__dirname, "..", "src", "api", "directorioUsuarios.ts"), "utf8");
    expect(src).not.toContain("ensureSession");
  });

  it("cloudWire publica los seis puentes y cloudHydrate los declara", () => {
    const wire = readFileSync(join(__dirname, "..", "src", "api", "cloudWire.ts"), "utf8");
    const hyd = readFileSync(join(__dirname, "..", "src", "api", "cloudHydrate.ts"), "utf8");
    for (const p of [
      "__fichaRegistro",
      "__ordenarHallazgos",
      "__nombreDeUsuario",
      "__describirRevocadaPor",
      "__hayCambios",
      "__directorioUsuarios",
    ]) {
      expect(wire, p).toContain(`window.${p} =`);
      expect(hyd, p).toContain(`${p}?:`);
    }
  });
});
