import { describe, expect, it } from "vitest";
import { inputSinCampos } from "../src/opsgpa/contract";

// Blindaje "sucursal editable-admin" (2026-07-17): el upsert de la ingesta usa esto
// para OMITIR sucursal en el UPDATE de una unidad existente (el admin de FC manda),
// pero SÍ la escribe en el CREATE. Aquí se prueba la función pura que lo implementa.

describe("inputSinCampos (omitir campos en el UPDATE del upsert)", () => {
  const unit = { tenantId: "gpa", placa: "PW9237A", economicoId: "54", sucursal: "Cabos" };

  it("quita las claves indicadas y conserva el resto", () => {
    const upd = inputSinCampos(unit, ["sucursal"]);
    expect(upd).toEqual({ tenantId: "gpa", placa: "PW9237A", economicoId: "54" });
    expect("sucursal" in upd).toBe(false);
  });

  it("NO muta el input original (el CREATE sigue con sucursal)", () => {
    const upd = inputSinCampos(unit, ["sucursal"]);
    expect(unit.sucursal).toBe("Cabos"); // intacto
    expect(upd).not.toBe(unit); // copia distinta
  });

  it("lista vacía → copia idéntica (CargaCombustible/Semanal/Checklist no omiten nada)", () => {
    const upd = inputSinCampos(unit, []);
    expect(upd).toEqual(unit);
    expect(upd).not.toBe(unit);
  });

  it("clave ausente → no-op seguro", () => {
    expect(inputSinCampos({ a: 1 }, ["sucursal"])).toEqual({ a: 1 });
  });

  it("varias claves a la vez", () => {
    expect(inputSinCampos(unit, ["sucursal", "economicoId"])).toEqual({
      tenantId: "gpa",
      placa: "PW9237A",
    });
  });
});
