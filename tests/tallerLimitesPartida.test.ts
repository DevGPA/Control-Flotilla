// tests/tallerLimitesPartida.test.ts
//
// R68 — la app (src/taller/partidas.ts) y el portal (amplify/functions/
// taller-portal/validacion.ts) validan los MISMOS topes de descripción y
// precio para una partida. Si algún día divergen, una captura manual (Task
// 12) podría aceptar algo que el portal del proveedor (Task 6) rechazaría,
// o viceversa — dos reglas de negocio para el mismo dato.
//
// Este test es EL PUENTE: importa ambos módulos para comparar sus
// constantes. `src/taller/partidas.ts` (el que sí viaja al bundle del
// frontend) nunca importa el Lambda — solo este archivo de test, que no se
// empaqueta, se permite leer de `amplify/`.
import { describe, it, expect } from "vitest";
import { LARGO_DESCRIPCION, PRECIO_MAX } from "../amplify/functions/taller-portal/validacion";
import { LARGO_DESCRIPCION_PARTIDA, PRECIO_MAX_PARTIDA } from "../src/taller/partidas";

describe("límites de partida — la app y el portal no divergen (R68)", () => {
  it("el tope de descripción es el mismo en los dos lados", () => {
    expect(LARGO_DESCRIPCION_PARTIDA).toBe(LARGO_DESCRIPCION);
  });

  it("el tope de precio es el mismo en los dos lados", () => {
    expect(PRECIO_MAX_PARTIDA).toBe(PRECIO_MAX);
  });
});
