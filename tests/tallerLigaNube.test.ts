// B-1 (revisión de seguridad de la rama feat/taller-liga-cierre): la revocación por cierre se
// calculaba desde la copia LOCAL de la visita (`ligaVersion + 1`), que puede tener minutos de
// atraso (poll de 4 min; sin hidratación mientras hay un modal abierto). Si Riesgos actuó en esa
// ventana: (a) una revocación manual quedaba PISADA por el rastro "cierre:<quien>"; (b) tras
// revocar y RE-EMITIR, el cierre sellaba `ligaRevocadaEn` con la versión del token VIVO (pantalla
// "Liga revocada", portal sirviendo); (c) tras dos revocaciones, el cierre BAJABA la versión y un
// token ya revocado revivía al reabrir. Antes de cerrar, la liga se toma de la NUBE
// (`conLigaDeNube`) y la revocación sale de la MISMA regla de siempre (`revocacionPorCierre`).
import { describe, it, expect } from "vitest";
import {
  cierraVisitaConLiga,
  columnasLigaDe,
  conLigaDeNube,
  revocacionPorCierre,
} from "../src/taller/liga";
import type { TallerEntry } from "../src/taller/types";

const DIA_MS = 24 * 60 * 60 * 1000;
const AHORA = new Date().toISOString();
// Relativo al reloj: una emisión literal quedaría "vencida" a los 90 días y la prueba en rojo.
const iso = (diasAtras: number): string => new Date(Date.now() - diasAtras * DIA_MS).toISOString();
const EMITIDA = iso(7);
// Calculada UNA sola vez: dos llamadas a iso(1) en la misma prueba (entrada y esperado) cayeron
// con 1 ms de diferencia y la prueba salio en rojo por azar (2026-09-24).
const REVOCADA_AYER = iso(1);
const RIESGOS = "riesgos@ejemplo.test";
const OPERATIVO = "op@ejemplo.test";

/** La copia LOCAL: hidratada hace rato, con la liga tal como estaba entonces (v1, sin revocar),
 *  y la visita que este guardado CIERRA. */
const local: Partial<TallerEntry> = {
  ligaCreadaEn: EMITIDA,
  ligaCreadaPor: RIESGOS,
  ligaVersion: 1,
  fsalidaReal: "2026-09-22",
};

describe("columnasLigaDe — proyecta la fila de la nube (campos null) a las 5 columnas del entry", () => {
  it("null ⇒ undefined en las cinco; la versión solo si es número", () => {
    expect(
      columnasLigaDe({
        ligaVersion: null,
        ligaCreadaEn: null,
        ligaCreadaPor: null,
        ligaRevocadaEn: null,
        ligaRevocadaPor: null,
      }),
    ).toEqual({
      ligaVersion: undefined,
      ligaCreadaEn: undefined,
      ligaCreadaPor: undefined,
      ligaRevocadaEn: undefined,
      ligaRevocadaPor: undefined,
    });
  });
  it("copia los valores presentes tal cual", () => {
    expect(
      columnasLigaDe({
        ligaVersion: 3,
        ligaCreadaEn: EMITIDA,
        ligaCreadaPor: RIESGOS,
        ligaRevocadaEn: REVOCADA_AYER,
        ligaRevocadaPor: RIESGOS,
      }),
    ).toEqual({
      ligaVersion: 3,
      ligaCreadaEn: EMITIDA,
      ligaCreadaPor: RIESGOS,
      ligaRevocadaEn: REVOCADA_AYER,
      ligaRevocadaPor: RIESGOS,
    });
  });
});

describe("conLigaDeNube — la nube manda en emisión y revocación; la versión nunca baja", () => {
  it("toma las cuatro marcas de la nube y conserva lo demás del entry local", () => {
    const nube = {
      ligaVersion: 2,
      ligaCreadaEn: REVOCADA_AYER,
      ligaCreadaPor: RIESGOS,
      ligaRevocadaEn: undefined,
      ligaRevocadaPor: undefined,
    };
    const e = conLigaDeNube({ ...local, ligaRevocadaEn: iso(3) }, nube);
    expect(e.fsalidaReal).toBe("2026-09-22");
    expect(e.ligaCreadaEn).toBe(nube.ligaCreadaEn);
    expect(e.ligaCreadaPor).toBe(RIESGOS);
    // La revocación vieja de la copia local NO sobrevive: en la nube ya no está.
    expect(e.ligaRevocadaEn).toBeUndefined();
    expect(e.ligaVersion).toBe(2);
  });
  it("versión = máximo(nube, local): no baja a la local vieja ni ignora una local mayor", () => {
    expect(conLigaDeNube({ ...local, ligaVersion: 1 }, { ligaVersion: 3 }).ligaVersion).toBe(3);
    expect(conLigaDeNube({ ...local, ligaVersion: 5 }, { ligaVersion: 1 }).ligaVersion).toBe(5);
  });
  it("sin versión en ninguno de los dos lados ⇒ 1 (la versión implícita del portal)", () => {
    expect(
      conLigaDeNube({ ...local, ligaVersion: undefined }, { ligaVersion: undefined }).ligaVersion,
    ).toBe(1);
  });
  it("no muta el entry local que recibe", () => {
    const copia = { ...local };
    conLigaDeNube(copia, { ligaVersion: 9, ligaRevocadaEn: REVOCADA_AYER });
    expect(copia).toEqual(local);
  });
});

describe("revocacionPorCierre sobre la liga de la NUBE — los tres escenarios de B-1", () => {
  it("(a) Riesgos ya revocó a mano ⇒ null: el cierre NO pisa quién revocó ni cuándo", () => {
    const nube = {
      ligaVersion: 2,
      ligaCreadaEn: EMITIDA,
      ligaCreadaPor: RIESGOS,
      ligaRevocadaEn: REVOCADA_AYER,
      ligaRevocadaPor: RIESGOS,
    };
    expect(revocacionPorCierre(conLigaDeNube(local, nube), AHORA, OPERATIVO)).toBeNull();
    // Desde la copia local sola SÍ habría salido una revocación (v2, "cierre:op@…") que
    // sobrescribía el rastro de Riesgos.
    expect(revocacionPorCierre(local, AHORA, OPERATIVO)?.ligaRevocadaPor).toBe(
      `cierre:${OPERATIVO}`,
    );
  });
  it("(b) Riesgos revocó y RE-EMITIÓ (token vivo v2) ⇒ v3, con revocación POSTERIOR a la nueva emisión", () => {
    const nube = {
      ligaVersion: 2,
      ligaCreadaEn: REVOCADA_AYER,
      ligaCreadaPor: RIESGOS,
      ligaRevocadaEn: undefined,
      ligaRevocadaPor: undefined,
    };
    const r = revocacionPorCierre(conLigaDeNube(local, nube), AHORA, OPERATIVO);
    expect(r?.ligaVersion).toBe(3);
    expect(Date.parse(r?.ligaRevocadaEn ?? "")).toBeGreaterThanOrEqual(
      Date.parse(nube.ligaCreadaEn),
    );
    // Desde la copia local sola habría salido v2 = la versión del token VIVO: pantalla
    // "Liga revocada" y el portal sirviendo al reabrir.
    expect(revocacionPorCierre(local, AHORA, OPERATIVO)?.ligaVersion).toBe(2);
  });
  it("(c) la nube ya va en v3 (dos revocaciones) con liga viva ⇒ v4, nunca v2 (un token v2 revocado no revive)", () => {
    const nube = {
      ligaVersion: 3,
      ligaCreadaEn: REVOCADA_AYER,
      ligaCreadaPor: RIESGOS,
      ligaRevocadaEn: undefined,
      ligaRevocadaPor: undefined,
    };
    expect(revocacionPorCierre(conLigaDeNube(local, nube), AHORA, OPERATIVO)?.ligaVersion).toBe(4);
  });
  it("la nube sin liga (fila que nunca la tuvo) ⇒ null aunque la copia local traiga una", () => {
    const nube = columnasLigaDe({ ligaVersion: null, ligaCreadaEn: null });
    expect(revocacionPorCierre(conLigaDeNube(local, nube), AHORA, OPERATIVO)).toBeNull();
  });
});

describe("cierraVisitaConLiga — cuándo vale la pena releer la nube (una lectura, camino raro)", () => {
  it("solo cuando el guardado CIERRA la visita y la copia local alguna vez tuvo liga", () => {
    expect(cierraVisitaConLiga(local)).toBe(true);
    expect(cierraVisitaConLiga({ ...local, fsalidaReal: "", estado: "Finalizado" })).toBe(true);
    // La copia local dice "revocada": igual se relee — Riesgos pudo re-emitir después de esa copia.
    expect(cierraVisitaConLiga({ ...local, ligaRevocadaEn: REVOCADA_AYER })).toBe(true);
  });
  it("abierta, o cerrada sin rastro de liga ⇒ false (ni una lectura extra)", () => {
    expect(cierraVisitaConLiga({ ...local, fsalidaReal: "", estado: "En Reparación" })).toBe(false);
    expect(cierraVisitaConLiga({ fsalidaReal: "2026-09-22" })).toBe(false);
    expect(cierraVisitaConLiga({ fsalidaReal: "2026-09-22", ligaCreadaEn: "  " })).toBe(false);
  });
});
