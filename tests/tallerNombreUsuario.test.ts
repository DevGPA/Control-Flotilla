// "Emitida por": el nombre, nunca el id (spec 2026-09-30 §4.7) + Guardar solo con cambios (§4.5).
import { describe, expect, it } from "vitest";
import {
  describirRevocadaPor,
  esGuid,
  nombreDeUsuario,
  type Directorio,
  type Yo,
} from "../src/taller/nombreUsuario";
import { hayCambios, type FotoCampos } from "../src/taller/cambiosFormulario";

const SUB_ANA = "11111111-2222-4333-8444-555555555555";
const SUB_SIN_NOMBRE = "22222222-2222-4333-8444-555555555555";
const SUB_AJENO = "33333333-2222-4333-8444-555555555555";
const SUB_YO = "44444444-2222-4333-8444-555555555555";
const DIR: Directorio = new Map([
  [SUB_ANA, { cognitoSub: SUB_ANA, email: "ana@ejemplo.test", nombre: "Ana López" }],
  [SUB_SIN_NOMBRE, { cognitoSub: SUB_SIN_NOMBRE, email: "luis@ejemplo.test", nombre: "" }],
  [SUB_YO, { cognitoSub: SUB_YO, email: "yo@ejemplo.test", nombre: "Navares" }],
]);
const YO: Yo = { sub: SUB_YO, email: "yo@ejemplo.test" };
const NADIE: Yo = { sub: null, email: null };
// Existe en prod (medición 2026-09-30): un ligaRevocadaPor con texto libre.
const TEXTO_LIBRE =
  "revocacion manual (CLI admin) por incidente 2026-09-22, autorizada por Navares";

describe("esGuid", () => {
  it("reconoce un sub de Cognito y nada más", () => {
    expect(esGuid(SUB_ANA)).toBe(true);
    expect(esGuid("ana@ejemplo.test")).toBe(false);
    expect(esGuid(TEXTO_LIBRE)).toBe(false);
  });
});

describe("nombreDeUsuario — la cadena de respaldo (§4.7)", () => {
  it("sub en el directorio ⇒ el nombre", () => {
    expect(nombreDeUsuario(SUB_ANA, DIR, NADIE)).toBe("Ana López");
  });
  it("perfil sin nombre ⇒ el correo sin dominio", () => {
    expect(nombreDeUsuario(SUB_SIN_NOMBRE, DIR, NADIE)).toBe("luis");
  });
  it("un correo crudo ⇒ sin dominio, aunque no haya directorio", () => {
    expect(nombreDeUsuario("riesgos@ejemplo.test", null, NADIE)).toBe("riesgos");
  });
  it("mi propio sub o correo ⇒ '(tú)' con nombre, o 'tú' sin nada más", () => {
    expect(nombreDeUsuario(SUB_YO, DIR, YO)).toBe("Navares (tú)");
    expect(nombreDeUsuario("yo@ejemplo.test", null, YO)).toBe("yo (tú)");
    expect(nombreDeUsuario(SUB_YO, null, YO)).toBe("tú");
  });
  it("'desconocido', vacío, null, un sub que no está o texto libre ⇒ 'un usuario de GPA'", () => {
    for (const crudo of ["desconocido", "", null, undefined, SUB_AJENO, TEXTO_LIBRE]) {
      expect(nombreDeUsuario(crudo, DIR, NADIE)).toBe("un usuario de GPA");
    }
  });
  it("la salida NUNCA parece un GUID", () => {
    for (const crudo of [SUB_ANA, SUB_SIN_NOMBRE, SUB_AJENO, SUB_YO]) {
      expect(esGuid(nombreDeUsuario(crudo, DIR, YO))).toBe(false);
      expect(esGuid(nombreDeUsuario(crudo, null, NADIE))).toBe(false);
    }
  });
});

describe("describirRevocadaPor — el prefijo 'cierre:'", () => {
  it("cierre:correo ⇒ porCierre con el nombre resuelto", () => {
    expect(describirRevocadaPor("cierre:ana@ejemplo.test", DIR, NADIE)).toEqual({
      porCierre: true,
      nombre: "Ana López",
    });
  });
  it("cierre:desconocido ⇒ porCierre sin nombre", () => {
    expect(describirRevocadaPor("cierre:desconocido", DIR, NADIE)).toEqual({
      porCierre: true,
      nombre: null,
    });
  });
  it("sin prefijo ⇒ revocación normal con su nombre (o el respaldo)", () => {
    expect(describirRevocadaPor(SUB_ANA, DIR, NADIE)).toEqual({
      porCierre: false,
      nombre: "Ana López",
    });
    expect(describirRevocadaPor(TEXTO_LIBRE, DIR, NADIE)).toEqual({
      porCierre: false,
      nombre: "un usuario de GPA",
    });
  });
});

describe("hayCambios — Guardar solo con cambios (§4.5)", () => {
  const foto: FotoCampos = {
    "tf-km": { valor: "85000", readOnly: false },
    "tf-gasto": { valor: "3850", readOnly: true },
    "tf-tecnico": { valor: "Taller X", readOnly: false },
  };
  it("sin cambios ⇒ false", () => {
    expect(hayCambios(foto, { ...foto })).toBe(false);
  });
  it("cambiar un campo editable ⇒ true", () => {
    expect(hayCambios(foto, { ...foto, "tf-km": { valor: "86000", readOnly: false } })).toBe(true);
  });
  it("#tf-gasto repintado por _tfGastoPintar (readOnly, otro valor) ⇒ NO cuenta", () => {
    expect(hayCambios(foto, { ...foto, "tf-gasto": { valor: "5200", readOnly: true } })).toBe(
      false,
    );
  });
  it("un campo que pasó a readOnly después de la foto tampoco cuenta", () => {
    expect(hayCambios(foto, { ...foto, "tf-km": { valor: "0", readOnly: true } })).toBe(false);
  });
  it("campos que solo están en uno de los dos lados se ignoran", () => {
    expect(hayCambios(foto, { "tf-km": foto["tf-km"]! })).toBe(false);
  });
});
