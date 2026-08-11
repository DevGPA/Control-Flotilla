import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard del ordenamiento de la tabla de Inspecciones (monolito).
 *
 * Bug 2026-08-11: la columna "# Económico" MUESTRA `u.eco || u.plate` (el económico, ej.
 * "06") pero ordenaba por `u.plate || u.eco` (la PLACA, ej. "JX86024"). Al hacer clic sí
 * ordenaba, pero por un valor que no está a la vista — la línea visible quedaba revuelta:
 *
 *   antes → 52, 85, 49, 57, 58, 33, 50, 82, 86, 87, 88, 90, 89, 10, 43…
 *   debe  → 06, 10, 12, 13, 16, 21, 22, 23, 24, 31, 32, 33, 41, 43, 44…
 *
 * La regla que este archivo protege: **la clave de orden de una columna tiene que ser el
 * mismo dato que la columna muestra.** El ordenamiento vive solo en el monolito (no hay
 * módulo TS equivalente), así que el test lee y evalúa el literal real del HTML — mismo
 * enfoque que tests/cspMediaSrc.test.ts.
 */
const html = readFileSync(join(__dirname, "..", "Control de flotilla.html"), "utf8");

/** Orden de severidad real del monolito, inyectado al evaluar el literal. */
const RO: Record<string, number> = { Urgente: 3, Revisar: 2, Completar: 1.5, OK: 1 };

type Unidad = Record<string, unknown>;
type Clave = (u: Unidad) => string | number;

function sortKeysDelMonolito(): Record<string, Clave> {
  const cuerpo = /const SORT_KEYS=\{([\s\S]*?)\n\};/.exec(html)?.[1];
  if (!cuerpo) throw new Error("No se encontró el literal SORT_KEYS en el monolito");
  return new Function("RO", `return {${cuerpo}\n}`)(RO) as Record<string, Clave>;
}

const SORT_KEYS = sortKeysDelMonolito();

const unidad = (eco: string, plate: string): Unidad => ({
  eco,
  plate,
  F: [],
  obs: "",
  minT: null,
  km: "",
  brand: "",
  risk: "OK",
});

describe("columna '# Económico' — ordena por lo que muestra", () => {
  it("la clave devuelve el ECONÓMICO, no la placa", () => {
    expect(SORT_KEYS.plate!(unidad("06", "JX86024"))).toBe("06");
  });

  it("cae a la placa cuando la unidad no tiene económico", () => {
    expect(SORT_KEYS.plate!({ eco: "", plate: "JX86024" })).toBe("JX86024");
  });

  it("ordena los económicos reales de prod de menor a mayor", () => {
    // Muestra real del catálogo (51 unidades, económicos de 2 dígitos con cero).
    const ecos = ["52", "85", "06", "33", "10", "90", "43", "21"];
    const filas = ecos.map((e, i) => unidad(e, `PL${String(999 - i)}ZZ`));
    const orden = [...filas].sort((a, b) =>
      String(SORT_KEYS.plate!(a)).localeCompare(String(SORT_KEYS.plate!(b)), "es", {
        numeric: true,
      }),
    );
    expect(orden.map((u) => u.eco)).toEqual(["06", "10", "21", "33", "43", "52", "85", "90"]);
  });
});

describe("comparador de la tabla", () => {
  // Hoy todos los económicos son de 2 dígitos, así que el orden alfabético coincide con el
  // numérico. Con uno de 3 dígitos dejaría de coincidir ("100" iría antes de "99"), y el
  // síntoma volvería en silencio. Misma colación que ya usa src/ui/fleetMap.ts.
  it("usa colación numérica, para que un económico de 3 dígitos no rompa el orden", () => {
    const cmp = /if\(typeof va==="string"\) return va\.localeCompare\(([^)]*)\)/.exec(html)?.[1];
    expect(cmp, "no se encontró el comparador de sortedUnits").toBeTruthy();
    expect(cmp).toMatch(/numeric:\s*true/);
  });
});

describe("las otras columnas ordenables no cambiaron de criterio", () => {
  it("Estado: pone lo más grave primero al ordenar ascendente", () => {
    const urgente = SORT_KEYS.risk!({ risk: "Urgente" }) as number;
    const ok = SORT_KEYS.risk!({ risk: "OK" }) as number;
    expect(urgente).toBeLessThan(ok);
  });

  it("Llantas: usa el TACO mínimo y manda al final a las unidades sin lectura", () => {
    expect(SORT_KEYS.tires!({ minT: 4 })).toBe(4);
    expect(SORT_KEYS.tires!({ minT: null })).toBe(999);
  });

  it("Hallazgos: más severidad ordena primero", () => {
    const grave = SORT_KEYS.findings!({ F: [{ lv: "Urgente" }] }) as number;
    const leve = SORT_KEYS.findings!({ F: [{ lv: "Completar" }] }) as number;
    expect(grave).toBeLessThan(leve);
  });

  it("Comentarios: las unidades CON comentario van primero", () => {
    const con = String(SORT_KEYS.obs!({ obs: "se poncho" }));
    const sin = String(SORT_KEYS.obs!({ obs: "" }));
    expect(con.localeCompare(sin, "es")).toBeLessThan(0);
  });

  it("KM: el kilometraje más alto ordena primero", () => {
    const alto = SORT_KEYS.km!({ km: "90000" }) as number;
    const bajo = SORT_KEYS.km!({ km: "1000" }) as number;
    expect(alto).toBeLessThan(bajo);
  });
});
