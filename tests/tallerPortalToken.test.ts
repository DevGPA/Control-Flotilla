import { describe, it, expect } from "vitest";
import {
  ErrorToken,
  VIGENCIA_LIGA_MS,
  firmarToken,
  verificarToken,
  type PortalToken,
} from "../amplify/functions/taller-portal/token";

const SECRETO = "secreto-de-prueba-no-real";
const AHORA = Date.parse("2026-09-08T12:00:00Z");

const payload = (o: Partial<PortalToken> = {}): PortalToken => ({
  t: "gpa",
  u: "JV98698",
  f: "2026-09-01",
  v: 1,
  exp: AHORA + VIGENCIA_LIGA_MS,
  ...o,
});

function motivo(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof ErrorToken ? e.motivo : `otro:${String(e)}`;
  }
  return "no-lanzo";
}

describe("token de la liga", () => {
  it("ida y vuelta: lo firmado se verifica", () => {
    const t = firmarToken(payload(), SECRETO);
    expect(verificarToken(t, SECRETO, AHORA)).toEqual(payload());
  });

  it("FAIL-CLOSED: sin secreto no valida nada, ni un token bien firmado", () => {
    const t = firmarToken(payload(), SECRETO);
    expect(motivo(() => verificarToken(t, "", AHORA))).toBe("sin-secreto");
    expect(motivo(() => firmarToken(payload(), ""))).toBe("sin-secreto");
  });

  it("rechaza firma ajena — el payload no manda solo", () => {
    const t = firmarToken(payload(), "otro-secreto");
    expect(motivo(() => verificarToken(t, SECRETO, AHORA))).toBe("firma-invalida");
  });

  it("rechaza un payload manipulado aunque conserve la firma original", () => {
    const t = firmarToken(payload(), SECRETO);
    const [cuerpo, firma] = t.split(".");
    const alterado = Buffer.from(
      JSON.stringify({ ...payload(), u: "OTRA-PLACA" }),
      "utf8",
    ).toString("base64url");
    expect(motivo(() => verificarToken(`${alterado}.${firma}`, SECRETO, AHORA))).toBe(
      "firma-invalida",
    );
    expect(cuerpo).not.toBe(alterado);
  });

  it("rechaza basura y formas raras", () => {
    for (const malo of ["", "sinpunto", "a.b.c", "....", "x."]) {
      expect(motivo(() => verificarToken(malo, SECRETO, AHORA))).toMatch(
        /malformado|firma-invalida/,
      );
    }
  });

  it("rechaza expirado", () => {
    const t = firmarToken(payload({ exp: AHORA - 1000 }), SECRETO);
    expect(motivo(() => verificarToken(t, SECRETO, AHORA))).toBe("expirado");
  });

  it("el Plan 1 no soporta alcance por partida: lo rechaza en vez de ignorarlo", () => {
    const t = firmarToken(payload({ p: "p1" }), SECRETO);
    expect(motivo(() => verificarToken(t, SECRETO, AHORA))).toBe("alcance-no-soportado");
  });

  it("la vigencia por defecto son 90 días", () => {
    expect(VIGENCIA_LIGA_MS).toBe(90 * 24 * 60 * 60 * 1000);
  });
});
