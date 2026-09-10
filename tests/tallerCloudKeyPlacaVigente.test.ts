/**
 * R59 — la llave de la visita de Taller usa la placa VIGENTE.
 *
 * Por qué importa aquí y no en otro módulo: desde Task 9 las partidas son la ÚNICA copia del
 * gasto firmado (`sinGastoSiTienePartidas` quita `gasto`/`gastoRef`/`gastoMO` de la fila cuando
 * la visita ya tiene partidas), y las partidas cuelgan de `visitaKey` = `juntaVisitaKey(
 * tallerCloudKey(e))`. `main` normaliza la placa al escribir (Excel/ZIP, unidades, semanales) y
 * al cruzar en la hidratación, pero NO tocaba `tallerCloudKey`: una visita cargada con la placa
 * retirada producía una `visitaKey` que no coincidía con la de su fila, y partidas, token de la
 * liga del proveedor (`u`) y el strip del gasto se desalineaban EN SILENCIO.
 *
 * Los tres consumidores derivan de `tallerCloudKey`, así que normalizar ahí los alinea a la vez
 * (R44: la llave se deriva, nunca se reimplementa).
 */
import { describe, it, expect } from "vitest";
import { tallerCloudKey, type LegacyTallerEntry } from "../src/api/batchUpload";
import { juntaVisitaKey, visitaKeyDe } from "../src/api/tallerPartidas";
import { PLACAS_SUSTITUIDAS, placaVigente } from "../src/fleet/placaVigente";

// Par REAL del catálogo de reemplacamientos (eco 21 — la unidad que da nombre al commit de
// `main`: "la 21 y la 75 salian sin una sola inspeccion"). Se lee del mapa en vez de escribirlo
// a mano para que el test siga siendo verdad si el par cambia de valor.
const PLACA_VIEJA = "JV50090";
// El `!` es seguro y además está verificado por el primer test ("el par está bien tomado"):
// si alguien saca ese par del mapa, ese test falla antes que cualquier otro.
const PLACA_VIGENTE = PLACAS_SUSTITUIDAS[PLACA_VIEJA]!;

/** Entry mínimo: solo lo que la llave lee. */
function entry(over: Partial<LegacyTallerEntry> = {}): LegacyTallerEntry {
  return { id: "tl_1757000000000", ...over };
}

describe("tallerCloudKey — la identidad es la placa VIGENTE (R59)", () => {
  it("el par del catálogo está bien tomado (guarda del propio test)", () => {
    expect(PLACA_VIGENTE).toBe("JB4255A");
    expect(PLACA_VIGENTE).not.toBe(PLACA_VIEJA);
  });

  // Caso 1 — el corazón del fix: la misma camioneta con su placa vieja y con su placa vigente
  // tiene que dar UNA sola visita. Con la placa cruda esto falla y las partidas quedan huérfanas.
  it("la placa retirada y la vigente producen la MISMA unitUid y la misma visitaKey", () => {
    const vieja = entry({ plate: PLACA_VIEJA, fentrada: "2026-09-01" });
    const vigente = entry({ plate: PLACA_VIGENTE, fentrada: "2026-09-01" });

    expect(tallerCloudKey(vieja).unitUid).toBe(tallerCloudKey(vigente).unitUid);
    expect(tallerCloudKey(vieja).unitUid).toBe(PLACA_VIGENTE);
    expect(visitaKeyDe(vieja)).toBe(visitaKeyDe(vigente));
  });

  // Caso 2 — idempotencia: para las 100+ unidades que nunca se reemplacaron, la llave de hoy no
  // se mueve. Si esto cambiara, TODAS las partidas ya guardadas quedarían huérfanas de golpe.
  it("una placa ya vigente da la misma unitUid que antes del fix (idempotente)", () => {
    const e = entry({ plate: "JR54321", fentrada: "2026-08-15" });
    expect(tallerCloudKey(e).unitUid).toBe("JR54321");
    expect(placaVigente("JR54321")).toBe("JR54321");
    // Y aplicar la normalización dos veces no mueve nada.
    expect(placaVigente(tallerCloudKey(e).unitUid)).toBe(tallerCloudKey(e).unitUid);
  });

  // Caso 3 — la cadena de fallbacks sigue viva Y también normaliza: la placa retirada puede venir
  // en `eco` o en `unitKey` (el formulario legacy dejaba la placa en el campo de económico).
  describe("los fallbacks siguen vivos y también normalizan", () => {
    it("sin plate cae a eco", () => {
      const e = entry({ eco: PLACA_VIEJA, fentrada: "2026-09-01" });
      expect(tallerCloudKey(e).unitUid).toBe(PLACA_VIGENTE);
    });

    it("sin plate ni eco cae a unitKey", () => {
      const e = entry({ unitKey: PLACA_VIEJA, fentrada: "2026-09-01" });
      expect(tallerCloudKey(e).unitUid).toBe(PLACA_VIGENTE);
    });

    it("sin ninguno cae a id", () => {
      const e = entry({ id: PLACA_VIEJA, fentrada: "2026-09-01" });
      expect(tallerCloudKey(e).unitUid).toBe(PLACA_VIGENTE);
    });

    it("respeta la PRECEDENCIA plate > eco > unitKey > id", () => {
      const e = entry({
        plate: PLACA_VIEJA,
        eco: "21",
        unitKey: "otra",
        fentrada: "2026-09-01",
      });
      // Gana `plate` (normalizada), no `eco`.
      expect(tallerCloudKey(e).unitUid).toBe(PLACA_VIGENTE);
      expect(tallerCloudKey(entry({ eco: "21", unitKey: "otra" })).unitUid).toBe("21");
    });

    it("sin ningún identificador utilizable la llave sale vacía (no 'undefined')", () => {
      // `id` es obligatorio en el tipo, pero el legacy manda cadenas vacías; que salga "" es lo
      // que ya hacía `String(... || "")` — no debe volverse la cadena "undefined".
      expect(tallerCloudKey({ id: "" }).unitUid).toBe("");
    });
  });

  // Caso 4 — la regla de fechaEntrada NO cambia. Es la otra mitad de la clave compuesta
  // (tenantId, unitUid, fechaEntrada); moverla partiría las filas igual que la placa.
  describe("la regla de fechaEntrada no cambia", () => {
    it("usa fentrada cuando existe", () => {
      const e = entry({ plate: PLACA_VIGENTE, fentrada: "2026-09-01", freporte: "2026-08-30" });
      expect(tallerCloudKey(e).fechaEntrada).toBe("2026-09-01");
    });

    it("cae a freporte sin fentrada", () => {
      const e = entry({ plate: PLACA_VIGENTE, freporte: "2026-08-30" });
      expect(tallerCloudKey(e).fechaEntrada).toBe("2026-08-30");
    });

    it("cae a `sin-fecha:<id>` sin ninguna de las dos", () => {
      const e = entry({ id: "tl_1757000000000", plate: PLACA_VIGENTE });
      expect(tallerCloudKey(e).fechaEntrada).toBe("sin-fecha:tl_1757000000000");
    });
  });

  // Caso 5 — coherencia con la fila GUARDADA. La fila de Taller que llega de la nube ya trae su
  // `unitUid`, y la hidratación reconstruye el entry con `plate: datos.plate ?? t.unitUid`
  // (src/api/cloudHydrate.ts). Para una fila archivada con la placa vigente, la llave recomputada
  // desde el entry hidratado tiene que dar exactamente la llave de la fila — si no, el upsert
  // crearía una fila nueva y las partidas de la vieja quedarían inalcanzables.
  //
  // ⚠️ CASO REZAGADO (documentado a propósito, NO cubierto por una segunda regla de llave): si una
  // fila guardó su `unitUid` con la placa RETIRADA antes de la migración, la llave recomputada
  // (vigente) ya no coincide con la almacenada (vieja). La respuesta es re-archivar el dato —
  // `scripts/reparar-identidad-placas.mjs`, que corre Navares contra PROD —, nunca una segunda
  // regla de llave "que también acepte la vieja": dos llaves válidas para la misma visita es
  // exactamente el bug que este fix cierra, y dejaría el dinero firmado en dos montones.
  describe("coherencia con la fila guardada", () => {
    /** Reconstruye el entry como lo hace la hidratación de Taller. */
    function hidrata(fila: {
      unitUid: string;
      fechaEntrada: string;
      folio?: string;
      datos?: Record<string, unknown>;
    }): LegacyTallerEntry {
      const datos = fila.datos ?? {};
      return {
        id: String(datos.id ?? fila.folio ?? `${fila.unitUid}_${fila.fechaEntrada}`),
        unitKey: String(datos.unitKey ?? fila.unitUid),
        eco: String(datos.eco ?? ""),
        plate: String(datos.plate ?? fila.unitUid),
        fentrada: String(datos.fentrada ?? fila.fechaEntrada),
      };
    }

    it("la visitaKey del entry hidratado coincide con la de su fila (fila ya migrada)", () => {
      const fila = {
        unitUid: PLACA_VIGENTE, // como la archiva `main`: placa vigente
        fechaEntrada: "2026-09-01",
        folio: "tl_1757000000000",
        datos: { id: "tl_1757000000000", plate: PLACA_VIGENTE, fentrada: "2026-09-01", eco: "21" },
      };
      const e = hidrata(fila);
      expect(visitaKeyDe(e)).toBe(
        juntaVisitaKey({ unitUid: fila.unitUid, fechaEntrada: fila.fechaEntrada }),
      );
    });

    it("una fila cuyo `datos.plate` quedó con la placa vieja converge a la llave vigente", () => {
      // Fila ya re-archivada (unitUid vigente) pero con el JSON sin actualizar: la normalización
      // de la llave la trae de vuelta a la fila correcta en vez de abrir una segunda visita.
      const fila = {
        unitUid: PLACA_VIGENTE,
        fechaEntrada: "2026-09-01",
        folio: "tl_1757000000001",
        datos: { id: "tl_1757000000001", plate: PLACA_VIEJA, fentrada: "2026-09-01" },
      };
      const e = hidrata(fila);
      expect(e.plate).toBe(PLACA_VIEJA); // el JSON sigue trayendo la vieja
      expect(visitaKeyDe(e)).toBe(
        juntaVisitaKey({ unitUid: fila.unitUid, fechaEntrada: fila.fechaEntrada }),
      );
    });
  });
});
