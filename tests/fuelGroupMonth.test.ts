import { describe, expect, it } from "vitest";
import { aggByGroupAndMonth } from "../src/fuel/fuelAggregates";
import type { FuelEntry } from "../src/fuel/types";

const carga = (over: Partial<FuelEntry>): FuelEntry =>
  ({
    tipo: "carga",
    eco: "12",
    loadId: "x",
    fecha: "2026-07-01",
    litros: 10,
    monto: 240,
    ...over,
  }) as FuelEntry;

describe("aggByGroupAndMonth", () => {
  it("matriz grupo×mes con celdas en 0 donde no hay datos, meses cronológicos, grupos por gasto DESC", () => {
    const m = aggByGroupAndMonth(
      [
        carga({ sucursal: "GDL", fecha: "2026-05-10", monto: 100, litros: 4 }),
        carga({ sucursal: "GDL", fecha: "2026-07-02", monto: 300, litros: 12 }),
        carga({ sucursal: "MTY", fecha: "2026-06-01", monto: 900, litros: 40 }),
      ],
      (e) => e.sucursal ?? "(sin dato)",
    );
    expect(m.meses).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(m.grupos).toEqual(["MTY", "GDL"]); // 900 > 400
    expect(m.celdas["GDL"]!["2026-06"]).toEqual({ litros: 0, gasto: 0, cargas: 0 }); // hueco = 0
    expect(m.celdas["GDL"]!["2026-07"]!.gasto).toBe(300);
    expect(m.totalesGrupo["GDL"]!.cargas).toBe(2);
    expect(m.totalesMes["2026-06"]!.gasto).toBe(900);
  });
  it("ignora solicitudes y fechas malformadas", () => {
    const m = aggByGroupAndMonth(
      [
        carga({ tipo: "solicitud", sucursal: "GDL" }),
        carga({ sucursal: "GDL", fecha: "sin-fecha" }),
        carga({ sucursal: "GDL", fecha: "2026-07-01", monto: 50 }),
      ],
      (e) => e.sucursal ?? "",
    );
    expect(m.totalesGrupo["GDL"]!.cargas).toBe(1);
  });
});
