import { describe, expect, it, vi } from "vitest";
import { computeActivasKpis, renderActivasKpis } from "../src/taller/renderActivasKpis";
import type { TallerEntry } from "../src/taller/types";

const TODAY = new Date("2026-04-20T12:00:00Z");

function mk(overrides: Partial<TallerEntry> = {}): TallerEntry {
  return {
    id: "t1",
    unitKey: "U1",
    eco: "A-117",
    plate: "ABC-123",
    sucursal: "GDL",
    area: "MANTENIMIENTO",
    tipo: "Correctivo",
    estado: "Reparando",
    fentrada: "2026-04-15",
    updatedAt: "2026-04-15T10:00:00Z",
    ...overrides,
  };
}

function setup(): HTMLElement {
  document.body.replaceChildren();
  const c = document.createElement("div");
  document.body.appendChild(c);
  return c;
}

// ═══════════════════════════════════════════════════════════════
//  computeActivasKpis
// ═══════════════════════════════════════════════════════════════

describe("computeActivasKpis", () => {
  it("cuenta activos tomando latest-per-unit", () => {
    const k = computeActivasKpis([
      mk({ id: "a1", unitKey: "U1", updatedAt: "2026-04-10T10:00:00Z" }),
      mk({ id: "a2", unitKey: "U1", updatedAt: "2026-04-18T10:00:00Z", estado: "Finalizado" }),
      mk({ id: "b1", unitKey: "U2", updatedAt: "2026-04-15T10:00:00Z" }),
    ], {}, TODAY);
    // U1 latest = Finalizado (cerrada), U2 latest = activa
    expect(k.nActAll).toBe(1);
  });

  it("nRev solo cuenta estado='En Revisión'", () => {
    const k = computeActivasKpis([
      mk({ id: "a1", unitKey: "U1", estado: "En Revisión" }),
      mk({ id: "a2", unitKey: "U2", estado: "Reparando" }),
      mk({ id: "a3", unitKey: "U3", estado: "En Revisión" }),
    ], {}, TODAY);
    expect(k.nRev).toBe(2);
  });

  it("nCorr / nPrev contra filtered, respeta filtro sucursal", () => {
    const k = computeActivasKpis([
      mk({ id: "a1", unitKey: "U1", sucursal: "GDL", tipo: "Correctivo" }),
      mk({ id: "a2", unitKey: "U2", sucursal: "MTY", tipo: "Correctivo" }),
      mk({ id: "a3", unitKey: "U3", sucursal: "GDL", tipo: "Preventivo" }),
    ], { sucursal: "GDL" }, TODAY);
    expect(k.nCorr).toBe(1);
    expect(k.nPrev).toBe(1);
    expect(k.nFiltered).toBe(2);
  });

  it("nUrg cuenta >7 días y omite cerradas/sin fecha", () => {
    const k = computeActivasKpis([
      mk({ id: "a1", unitKey: "U1", fentrada: "2026-04-01" }), // 19 días
      mk({ id: "a2", unitKey: "U2", fentrada: "2026-04-18" }), // 2 días
      mk({ id: "a3", unitKey: "U3", fentrada: "2026-04-05", estado: "Finalizado" }), // cerrada
      mk({ id: "a4", unitKey: "U4" }), // sin fentrada
    ], {}, TODAY);
    expect(k.nUrg).toBe(1);
    expect(k.urgentEcos).toEqual(["A-117"]);
  });

  it("promDiasComp = media de días cerrados (fsalidaReal - fentrada)", () => {
    const k = computeActivasKpis([
      mk({ id: "a1", unitKey: "U1", estado: "Finalizado", fentrada: "2026-04-01", fsalidaReal: "2026-04-05" }), // 4
      mk({ id: "a2", unitKey: "U2", estado: "Listo", fentrada: "2026-04-10", fsalidaReal: "2026-04-20" }), // 10
    ], {}, TODAY);
    expect(k.promDiasComp).toBe(7);
  });

  it("promDiasEst = media de estado 'En Revisión' con fsalidaEst", () => {
    const k = computeActivasKpis([
      mk({ id: "a1", unitKey: "U1", estado: "En Revisión", fentrada: "2026-04-10", fsalidaEst: "2026-04-14" }), // 4
      mk({ id: "a2", unitKey: "U2", estado: "En Revisión", fentrada: "2026-04-12", fsalidaEst: "2026-04-20" }), // 8
    ], {}, TODAY);
    expect(k.promDiasEst).toBe(6);
  });

  it("promDiasRev = media de días de activos 'En Revisión' vs today", () => {
    const k = computeActivasKpis([
      // TODAY = 2026-04-20T12:00Z → entradas a 00:00Z dan media día extra
      mk({ id: "a1", unitKey: "U1", estado: "En Revisión", fentrada: "2026-04-10" }),
      mk({ id: "a2", unitKey: "U2", estado: "En Revisión", fentrada: "2026-04-14" }),
    ], {}, TODAY);
    expect(k.promDiasRev).toBe(9);
  });

  it("sin datos → todos los promedios null", () => {
    const k = computeActivasKpis([], {}, TODAY);
    expect(k.promDiasComp).toBeNull();
    expect(k.promDiasEst).toBeNull();
    expect(k.promDiasRev).toBeNull();
    expect(k.nActAll).toBe(0);
  });

  it("filtro search matchea contra eco/plate/tecnico/brand", () => {
    const k = computeActivasKpis([
      mk({ id: "a1", unitKey: "U1", eco: "A-100" }),
      mk({ id: "a2", unitKey: "U2", eco: "B-200", brand: "Toyota" }),
    ], { search: "toyota" }, TODAY);
    expect(k.nFiltered).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
//  renderActivasKpis (DOM)
// ═══════════════════════════════════════════════════════════════

describe("renderActivasKpis", () => {
  it("renderiza 6 tarjetas en kpi-row", () => {
    const c = setup();
    renderActivasKpis(c, { entries: [mk({ id: "a1", unitKey: "U1" })], today: TODAY });
    expect(c.querySelectorAll(".kpi-row > .kc").length).toBe(6);
  });

  it("card Correctivo dispara onFilterTipo con 'Correctivo'", () => {
    const c = setup();
    const onFilterTipo = vi.fn();
    renderActivasKpis(c, { entries: [mk({ id: "a1", unitKey: "U1" })], today: TODAY, onFilterTipo });
    const cards = c.querySelectorAll(".kpi-row > .kc");
    (cards[1] as HTMLElement).click();
    expect(onFilterTipo).toHaveBeenCalledWith("Correctivo");
  });

  it("card Preventivo dispara onFilterTipo con 'Preventivo'", () => {
    const c = setup();
    const onFilterTipo = vi.fn();
    renderActivasKpis(c, { entries: [mk({ id: "a1", unitKey: "U1" })], today: TODAY, onFilterTipo });
    const cards = c.querySelectorAll(".kpi-row > .kc");
    (cards[2] as HTMLElement).click();
    expect(onFilterTipo).toHaveBeenCalledWith("Preventivo");
  });

  it("card Urgentes dispara onSortUrgencia cuando nUrg>0", () => {
    const c = setup();
    const onSortUrgencia = vi.fn();
    renderActivasKpis(c, {
      entries: [mk({ id: "a1", unitKey: "U1", fentrada: "2026-04-01" })],
      today: TODAY,
      onSortUrgencia,
    });
    const cards = c.querySelectorAll(".kpi-row > .kc");
    (cards[3] as HTMLElement).click();
    expect(onSortUrgencia).toHaveBeenCalled();
  });

  it("card Urgentes NO dispara cuando nUrg=0", () => {
    const c = setup();
    const onSortUrgencia = vi.fn();
    renderActivasKpis(c, {
      entries: [mk({ id: "a1", unitKey: "U1", fentrada: "2026-04-18" })],
      today: TODAY,
      onSortUrgencia,
    });
    const cards = c.querySelectorAll(".kpi-row > .kc");
    (cards[3] as HTMLElement).click();
    expect(onSortUrgencia).not.toHaveBeenCalled();
  });

  it("alert strip aparece solo con urgentEcos", () => {
    const c = setup();
    renderActivasKpis(c, {
      entries: [
        mk({ id: "a1", unitKey: "U1", fentrada: "2026-04-01", eco: "A-100" }),
        mk({ id: "a2", unitKey: "U2", fentrada: "2026-04-05", eco: "B-200" }),
      ],
      today: TODAY,
    });
    expect(c.textContent).toContain("2 unidades llevan más de 7 días");
    expect(c.textContent).toContain("A-100");
    expect(c.textContent).toContain("B-200");
  });

  it("alert strip singular con 1 urgente", () => {
    const c = setup();
    renderActivasKpis(c, {
      entries: [mk({ id: "a1", unitKey: "U1", fentrada: "2026-04-01", eco: "A-100" })],
      today: TODAY,
    });
    expect(c.textContent).toContain("1 unidad lleva más de 7 días");
  });

  it("alert strip ausente sin urgentes", () => {
    const c = setup();
    renderActivasKpis(c, {
      entries: [mk({ id: "a1", unitKey: "U1", fentrada: "2026-04-18" })],
      today: TODAY,
    });
    expect(c.textContent).not.toContain("más de 7 días");
  });

  it("alert strip trunca lista a 5 + 'y N más'", () => {
    const c = setup();
    const entries = Array.from({ length: 7 }, (_, i) =>
      mk({ id: `a${i}`, unitKey: `U${i}`, eco: `E-${i}`, fentrada: "2026-04-01" }),
    );
    renderActivasKpis(c, { entries, today: TODAY });
    expect(c.textContent).toContain("y 2 más");
  });

  it("donut tiene segmento rev cuando nRev>0", () => {
    const c = setup();
    renderActivasKpis(c, {
      entries: [mk({ id: "a1", unitKey: "U1", estado: "En Revisión" })],
      today: TODAY,
    });
    const seg = c.querySelector("#tl-dwrap .dsvg circle[data-k='rev']");
    expect(seg).toBeTruthy();
  });

  it("donut omite segmento rev cuando nRev=0", () => {
    const c = setup();
    renderActivasKpis(c, {
      entries: [mk({ id: "a1", unitKey: "U1", estado: "Reparando" })],
      today: TODAY,
    });
    const seg = c.querySelector("#tl-dwrap .dsvg circle[data-k='rev']");
    expect(seg).toBeFalsy();
  });

  it("donut hover leyenda aplica clase dim a otros items", () => {
    const c = setup();
    renderActivasKpis(c, {
      entries: [
        mk({ id: "a1", unitKey: "U1", estado: "En Revisión" }),
        mk({ id: "a2", unitKey: "U2", estado: undefined as unknown as TallerEntry["estado"] }),
      ],
      today: TODAY,
    });
    const revItem = c.querySelector("#tl-dleg .dleg-i[data-k='rev']") as HTMLElement;
    const sinItem = c.querySelector("#tl-dleg .dleg-i[data-k='sin']") as HTMLElement;
    revItem.dispatchEvent(new Event("mouseenter"));
    expect(sinItem.classList.contains("dim")).toBe(true);
    revItem.dispatchEvent(new Event("mouseleave"));
    expect(sinItem.classList.contains("dim")).toBe(false);
  });

  it("value '—' cuando todos los promedios null", () => {
    const c = setup();
    renderActivasKpis(c, { entries: [], today: TODAY });
    const cards = c.querySelectorAll(".kpi-row > .kc");
    const promCard = cards[4];
    expect(promCard.querySelector(".kval")?.textContent).toBe("—");
  });

  it("prefiere promDiasComp sobre est/rev en tarjeta", () => {
    const c = setup();
    renderActivasKpis(c, {
      entries: [
        mk({ id: "a1", unitKey: "U1", estado: "Finalizado", fentrada: "2026-04-01", fsalidaReal: "2026-04-05" }), // 4
        mk({ id: "a2", unitKey: "U2", estado: "En Revisión", fentrada: "2026-04-10", fsalidaEst: "2026-04-20" }),
      ],
      today: TODAY,
    });
    const cards = c.querySelectorAll(".kpi-row > .kc");
    expect(cards[4].querySelector(".kval")?.textContent).toBe("4d");
    expect(cards[4].querySelector(".ksub")?.textContent).toContain("real");
  });

  it("XSS safe — eco con <script> escapa en alert strip", () => {
    const c = setup();
    renderActivasKpis(c, {
      entries: [mk({ id: "a1", unitKey: "U1", eco: "<img onerror=x>", fentrada: "2026-04-01" })],
      today: TODAY,
    });
    expect(c.querySelector("img")).toBeFalsy();
    expect(c.textContent).toContain("<img onerror=x>");
  });

  it("reemplaza contenido previo del container", () => {
    const c = setup();
    c.innerHTML = "<span>STALE</span>";
    renderActivasKpis(c, { entries: [], today: TODAY });
    expect(c.textContent).not.toContain("STALE");
  });
});
