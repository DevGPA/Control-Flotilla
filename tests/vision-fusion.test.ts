import { describe, expect, it } from "vitest";
import { fusionaLectura, normalizaFechaTicket, type LecturaVision } from "../src/vision/fusion";

// Lecturas simuladas con la forma EXACTA del tool schema de prompt.ts
// (lo que devolvería Bedrock tras el tool use forzado).
const TICKET_OK: LecturaVision["ticket"] = {
  monto: 850.5,
  litros: 35.2,
  precioLitro: 24.16,
  fecha: "04/06/2026",
  confianza: 0.92,
  estado: "ok",
};

describe("normalizaFechaTicket: DD/MM/AAAA mexicano → ISO en código, no por el modelo", () => {
  it("convierte DD/MM/AAAA y tolera separadores comunes", () => {
    expect(normalizaFechaTicket("04/06/2026")).toBe("2026-06-04");
    expect(normalizaFechaTicket("4/6/2026")).toBe("2026-06-04");
    expect(normalizaFechaTicket("04-06-2026")).toBe("2026-06-04");
  });

  it("ISO pasa directo (con o sin hora)", () => {
    expect(normalizaFechaTicket("2026-06-04")).toBe("2026-06-04");
    expect(normalizaFechaTicket("2026-06-04T18:22:00")).toBe("2026-06-04");
  });

  it("basura, null y fechas imposibles → null (jamás adivinar)", () => {
    expect(normalizaFechaTicket(null)).toBeNull();
    expect(normalizaFechaTicket("")).toBeNull();
    expect(normalizaFechaTicket("ayer")).toBeNull();
    expect(normalizaFechaTicket("32/13/2026")).toBeNull();
  });
});

describe("fusionaLectura: ticket canónico, bomba respaldo, confianza = mínimo usado", () => {
  it("ticket legible manda: campos planos desde el ticket", () => {
    const c = fusionaLectura(
      { ticket: TICKET_OK, tanqueDespues: { nivel: "lleno", confianza: 0.8, estado: "ok" } },
      [],
    );
    expect(c.montoDetectado).toBe(850.5);
    expect(c.litrosDetectado).toBe(35.2);
    expect(c.precioDetectado).toBe(24.16);
    expect(c.fechaDetectada).toBe("2026-06-04"); // normalizada a ISO
    expect(c.nivelDetectado).toBe("lleno");
    // mínimo de las evidencias USADAS (ticket 0.92, tanqueDespues 0.8)
    expect(c.confianzaVision).toBe(0.8);
  });

  it("ticket ilegible → la bomba es respaldo para monto/litros/precio (sin fecha)", () => {
    const c = fusionaLectura(
      {
        ticket: {
          monto: null,
          litros: null,
          precioLitro: null,
          fecha: null,
          confianza: 0.1,
          estado: "ilegible",
        },
        bomba: {
          monto: 500,
          litros: 20.7,
          precioLitro: 24.15,
          fecha: null,
          confianza: 0.75,
          estado: "ok",
        },
      },
      [],
    );
    expect(c.montoDetectado).toBe(500);
    expect(c.litrosDetectado).toBe(20.7);
    expect(c.fechaDetectada).toBeNull(); // el display de la bomba no trae fecha confiable
    expect(c.confianzaVision).toBe(0.75); // la ilegible NO promedia: no se usó
  });

  it("nada legible → todos los campos null y confianza null (no inventar 0 falso)", () => {
    const c = fusionaLectura(
      {
        ticket: {
          monto: null,
          litros: null,
          precioLitro: null,
          fecha: null,
          confianza: 0,
          estado: "ilegible",
        },
      },
      ["fotoBomba"],
    );
    expect(c.montoDetectado).toBeNull();
    expect(c.litrosDetectado).toBeNull();
    expect(c.nivelDetectado).toBeNull();
    expect(c.confianzaVision).toBeNull();
  });

  it("las fotos faltantes se estampan en visionDetalle con estado 'faltante' (lo pone el código, no el modelo)", () => {
    const c = fusionaLectura({ ticket: TICKET_OK }, ["fotoBomba", "fotoDespues"]);
    expect(c.visionDetalle.bomba?.estado).toBe("faltante");
    expect(c.visionDetalle.tanqueDespues?.estado).toBe("faltante");
    // y la evidencia leída se conserva íntegra para el drawer
    expect(c.visionDetalle.ticket?.estado).toBe("ok");
  });

  it("ilegible ≠ no cuadra: una lectura ilegible jamás produce valores numéricos", () => {
    const c = fusionaLectura(
      {
        ticket: {
          monto: 999,
          litros: 99,
          precioLitro: 99,
          fecha: null,
          confianza: 0.2,
          estado: "ilegible",
        },
      },
      [],
    );
    // Cinturón: aunque el modelo mandara números con estado ilegible, se descartan.
    expect(c.montoDetectado).toBeNull();
    expect(c.litrosDetectado).toBeNull();
  });
});
