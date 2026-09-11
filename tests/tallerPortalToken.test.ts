import { createHmac } from "node:crypto";
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

// Firma un cuerpo JSON "crudo" (sin pasar por firmarToken) para poder probar
// cuerpos firmados que son estructuralmente inválidos — algo que firmarToken
// nunca produciría, pero que verificarToken debe rechazar igual porque llega
// con firma válida (no puede confiar en que solo esta app emite tokens).
function firmarCrudo(cuerpoJson: string): string {
  const cuerpo = Buffer.from(cuerpoJson, "utf8").toString("base64url");
  return `${cuerpo}.${createHmac("sha256", SECRETO).update(cuerpo).digest("base64url")}`;
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

// Los tests de "basura y formas raras" arriba son todos NO firmados: mueren
// en el chequeo de forma del token o en la firma, antes de llegar a validar
// el payload. Este bloque firma cuerpos válidamente pero estructuralmente
// incompletos para probar que esa validación de payload existe y hace algo
// (borrar esas líneas hace que estos tests, y solo estos, fallen).
describe("payload firmado pero con forma inválida — la firma sola no basta", () => {
  it("rechaza un cuerpo firmado que no es JSON", () => {
    const t = firmarCrudo("esto no es json");
    expect(motivo(() => verificarToken(t, SECRETO, AHORA))).toBe("malformado");
  });

  it.each(["t", "u", "f"] as const)("rechaza un cuerpo firmado sin '%s'", (campo) => {
    const cuerpo: Record<string, unknown> = { ...payload() };
    delete cuerpo[campo];
    const t = firmarCrudo(JSON.stringify(cuerpo));
    expect(motivo(() => verificarToken(t, SECRETO, AHORA))).toBe("malformado");
  });

  it("rechaza un cuerpo firmado sin 'v' — es el único mecanismo de revocación", () => {
    const cuerpo: Record<string, unknown> = { ...payload() };
    delete cuerpo.v;
    const t = firmarCrudo(JSON.stringify(cuerpo));
    expect(motivo(() => verificarToken(t, SECRETO, AHORA))).toBe("malformado");
  });

  it("rechaza un cuerpo firmado con 'v' no numérico", () => {
    const t = firmarCrudo(JSON.stringify({ ...payload(), v: "1" }));
    expect(motivo(() => verificarToken(t, SECRETO, AHORA))).toBe("malformado");
  });

  it("rechaza un cuerpo firmado sin 'exp'", () => {
    const cuerpo: Record<string, unknown> = { ...payload() };
    delete cuerpo.exp;
    const t = firmarCrudo(JSON.stringify(cuerpo));
    expect(motivo(() => verificarToken(t, SECRETO, AHORA))).toBe("expirado");
  });

  it("rechaza un cuerpo firmado con 'exp' no numérico", () => {
    const t = firmarCrudo(JSON.stringify({ ...payload(), exp: "mañana" }));
    expect(motivo(() => verificarToken(t, SECRETO, AHORA))).toBe("expirado");
  });
});
