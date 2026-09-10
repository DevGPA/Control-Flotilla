// Task 11, ronda 1 de review — Important 3: `tallerPortalUrl()` (src/api/
// amplifyClient.ts) es el comportamiento que corre HOY en todo ambiente
// local (la clave `custom.tallerPortalUrl` está ausente del
// amplify_outputs.json real hasta el primer deploy de esta rama, R66) y no
// tenía cobertura. El módulo mockeado abajo NUNCA asume que la clave existe
// — se muta entre pruebas para cubrir ausente / vacío / tipo incorrecto /
// presente, sin depender del contenido real (gitignored) del archivo ni
// copiar ninguno de sus valores (placeholders `example.invalid`, RFC 2606).
import { describe, it, expect, vi } from "vitest";

vi.mock("../amplify_outputs.json", () => ({ default: {} as Record<string, unknown> }));

import outputsMock from "../amplify_outputs.json";
import { tallerPortalUrl } from "../src/api/amplifyClient";

const outputsMutable = outputsMock as unknown as { custom?: Record<string, unknown> };

describe("tallerPortalUrl — lectura defensiva de custom.tallerPortalUrl (R66)", () => {
  it("sin la clave 'custom' en absoluto, devuelve null — el caso de HOY en todo ambiente local", () => {
    delete outputsMutable.custom;
    expect(tallerPortalUrl()).toBeNull();
  });

  it("con 'custom' presente pero sin 'tallerPortalUrl' (el shape real hoy: solo moreappWebhookUrl/opsgpaReceptorUrl), devuelve null", () => {
    outputsMutable.custom = { moreappWebhookUrl: "https://example.invalid/webhook" };
    expect(tallerPortalUrl()).toBeNull();
  });

  it("con 'tallerPortalUrl' vacío, devuelve null — un string vacío no es 'configurado'", () => {
    outputsMutable.custom = { tallerPortalUrl: "" };
    expect(tallerPortalUrl()).toBeNull();
  });

  it("con 'tallerPortalUrl' de un tipo no-string, devuelve null", () => {
    outputsMutable.custom = { tallerPortalUrl: 12345 };
    expect(tallerPortalUrl()).toBeNull();
  });

  it("con un string no vacío, devuelve exactamente ese valor", () => {
    outputsMutable.custom = { tallerPortalUrl: "https://example.invalid/portal" };
    expect(tallerPortalUrl()).toBe("https://example.invalid/portal");
  });
});
