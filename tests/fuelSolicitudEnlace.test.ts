import { describe, expect, it } from "vitest";
import { buildFuelEntries } from "../src/fuel/mapEntry";
import type { OpsCargaRecord } from "../src/opsgpa/contract";
import { mapCarga } from "../src/opsgpa/mapCarga";

/**
 * Cierra el círculo del vínculo solicitud ↔ carga que Ops habilitó el 2026-07-28:
 * registro de Ops → mapCarga → fila persistida → hidratación → FuelEntry.
 *
 * Se prueba de punta a punta a propósito. El campo viaja dentro del blob `datos` (no es
 * columna, así que no hubo cambio de esquema), y ese es justo el patrón que ya nos costó
 * antes: "Ops manda el dato y FC lo entierra en JSON donde nadie lo lee". Si la promoción
 * a `FuelEntry` se rompe, el dato sigue ahí pero deja de existir para la aplicación —
 * en silencio.
 */
const resolve = (k: string): string => `opsgpa_${k.replace(/[/.]/g, "_")}`;

function reporteOps(extra: Record<string, unknown> = {}): OpsCargaRecord {
  return {
    tipo_reg: "SOL",
    formato: "reporte",
    id: "bc5fcabd088f",
    fecha: "2026-07-28T08:06:00-06:00",
    sucursal: "Guadalajara",
    economico: "06",
    placas: "JT98490",
    km: 12345,
    litros: 40,
    precioLitro: 25,
    monto: 1000,
    ...extra,
  } as unknown as OpsCargaRecord;
}

describe("vínculo solicitud → carga, de Ops hasta FuelEntry", () => {
  it("el folio de la solicitud llega hidratado y en la convención de FC", () => {
    // Valores REALES de producción (reporte bc5fcabd088f, eco 06, 28-jul).
    const input = mapCarga(
      reporteOps({ solicitudId: "08f0553fee77", folioSolicitud: "SOL-08F0553FEE77" }),
      resolve,
    );
    const [entry] = buildFuelEntries([input as never]);
    expect(entry!.solicitudFolio).toBe("OPS-08f0553fee77");
  });

  it("el folio hidratado casa con el eventoId con que se guardó la solicitud", () => {
    // La solicitud entra a FC por mapSolicitud con eventoId = "OPS-<id>". Este es el
    // emparejamiento que antes era imposible: lo medimos en 69 % de casos ambiguos al
    // intentar casar por económico y fecha.
    const solicitud = { economicoId: "06", tipo: "solicitud", eventoId: "OPS-08f0553fee77" };
    const carga = mapCarga(reporteOps({ solicitudId: "08f0553fee77" }), resolve);
    const entries = buildFuelEntries([solicitud as never, carga as never]);
    const laCarga = entries.find((e) => e.tipo === "carga")!;
    const suSolicitud = entries.find((e) => e.eventoId === laCarga.solicitudFolio);
    expect(suSolicitud).toBeDefined();
    expect(suSolicitud!.tipo).toBe("solicitud");
  });

  it("una carga sin solicitud de origen queda con el vínculo vacío, no inventado", () => {
    const carga = mapCarga(reporteOps(), resolve);
    const [entry] = buildFuelEntries([carga as never]);
    expect(entry!.solicitudFolio).toBeUndefined();
  });
});
