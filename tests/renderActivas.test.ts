import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  countActivasFiltered,
  isUrgente,
  latestActivasPerUnit,
  renderActivas,
} from "../src/taller/renderActivas";
import type { TallerEntry } from "../src/taller/types";

const TODAY = new Date("2026-04-17T12:00:00Z");

function mk(overrides: Partial<TallerEntry> = {}): TallerEntry {
  return {
    id: "t1",
    unitKey: "U1",
    eco: "A-117",
    plate: "ABC-123",
    sucursal: "GDL",
    area: "LOGISTICA",
    tipo: "Preventivo",
    estado: "Reparando",
    fentrada: "2026-04-15",
    updatedAt: "2026-04-15T10:00:00Z",
    ...overrides,
  };
}

function setup(): { tbody: HTMLElement; thead: HTMLElement; rcnt: HTMLElement } {
  document.body.replaceChildren();
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  table.appendChild(thead);
  table.appendChild(tbody);
  document.body.appendChild(table);
  const rcnt = document.createElement("span");
  document.body.appendChild(rcnt);
  return { tbody, thead, rcnt };
}

describe("latestActivasPerUnit", () => {
  it("agrupa por unitKey y retorna solo unidades con latest no-cerrada", () => {
    const entries = [
      mk({ id: "1", unitKey: "U1", updatedAt: "2026-04-10T00:00:00Z", estado: "Finalizado" }),
      mk({ id: "2", unitKey: "U1", updatedAt: "2026-04-15T00:00:00Z", estado: "Reparando" }),
      mk({ id: "3", unitKey: "U2", updatedAt: "2026-04-16T00:00:00Z", estado: "Finalizado" }),
    ];
    const out = latestActivasPerUnit(entries);
    expect(out).toHaveLength(1);
    expect(out[0]!.key).toBe("U1");
    expect(out[0]!.latest.id).toBe("2");
    expect(out[0]!.count).toBe(2);
  });

  it("usa updatedAt para desempatar latest (no fentrada)", () => {
    const entries = [
      mk({
        id: "1",
        unitKey: "U1",
        fentrada: "2026-04-15",
        updatedAt: "2026-04-16T00:00:00Z",
        estado: "Reparando",
      }),
      mk({
        id: "2",
        unitKey: "U1",
        fentrada: "2026-04-16",
        updatedAt: "2026-04-15T00:00:00Z",
        estado: "Finalizado",
      }),
    ];
    const out = latestActivasPerUnit(entries);
    expect(out).toHaveLength(1);
    expect(out[0]!.latest.id).toBe("1");
  });

  it("empty array → empty out", () => {
    expect(latestActivasPerUnit([])).toEqual([]);
  });
});

describe("isUrgente", () => {
  it("fentrada >7 días atrás → true", () => {
    const e = mk({ fentrada: "2026-04-01" });
    expect(isUrgente(e, TODAY)).toBe(true);
  });
  it("fentrada reciente → false", () => {
    const e = mk({ fentrada: "2026-04-15" });
    expect(isUrgente(e, TODAY)).toBe(false);
  });
  it("entry cerrada → false aunque lleve >7d", () => {
    const e = mk({ fentrada: "2026-04-01", estado: "Finalizado" });
    expect(isUrgente(e, TODAY)).toBe(false);
  });
  it("sin fentrada → false", () => {
    const e = mk({ fentrada: undefined });
    expect(isUrgente(e, TODAY)).toBe(false);
  });
});

describe("countActivasFiltered", () => {
  const entries: TallerEntry[] = [
    mk({ id: "1", unitKey: "U1", sucursal: "GDL", tipo: "Correctivo" }),
    mk({ id: "2", unitKey: "U2", sucursal: "MEX", tipo: "Preventivo" }),
    mk({ id: "3", unitKey: "U3", sucursal: "GDL", tipo: "Preventivo", estado: "Finalizado" }),
  ];

  it("sin filtros cuenta todas las activas", () => {
    expect(countActivasFiltered(entries)).toBe(2);
  });
  it("filtro sucursal=GDL → 1", () => {
    expect(countActivasFiltered(entries, { sucursal: "GDL" })).toBe(1);
  });
  it("filtro tipo=Preventivo → 1 (U3 cerrada no cuenta)", () => {
    expect(countActivasFiltered(entries, { tipo: "Preventivo" })).toBe(1);
  });
  it("search match", () => {
    expect(countActivasFiltered(entries, { search: "A-117" })).toBe(2);
  });
});

describe("renderActivas", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("empty entries → empty row", () => {
    const { tbody, thead, rcnt } = setup();
    const s = renderActivas(tbody, thead, rcnt, { entries: [], today: TODAY });
    expect(s.totalActivas).toBe(0);
    expect(s.visibles).toBe(0);
    expect(tbody.querySelector(".tl-empty")).not.toBeNull();
  });

  it("renderiza fila por unidad activa", () => {
    const { tbody, thead, rcnt } = setup();
    const entries = [
      mk({ id: "1", unitKey: "U1", eco: "A-100" }),
      mk({ id: "2", unitKey: "U2", eco: "A-200" }),
    ];
    const s = renderActivas(tbody, thead, rcnt, { entries, today: TODAY });
    expect(s.totalActivas).toBe(2);
    expect(s.visibles).toBe(2);
    expect(tbody.querySelectorAll("tr")).toHaveLength(2);
    expect(tbody.textContent).toContain("A-100");
    expect(tbody.textContent).toContain("A-200");
    expect(rcnt.textContent).toBe("2 unidades activas");
  });

  it("singular en rcnt cuando totalActivas=1", () => {
    const { tbody, thead, rcnt } = setup();
    renderActivas(tbody, thead, rcnt, { entries: [mk()], today: TODAY });
    expect(rcnt.textContent).toBe("1 unidad activa");
  });

  it("rcnt con filtro muestra 'N de M (filtrado)'", () => {
    const { tbody, thead, rcnt } = setup();
    const entries = [
      mk({ id: "1", unitKey: "U1", sucursal: "GDL" }),
      mk({ id: "2", unitKey: "U2", sucursal: "MEX" }),
    ];
    renderActivas(tbody, thead, rcnt, { entries, filter: { sucursal: "GDL" }, today: TODAY });
    expect(rcnt.textContent).toBe("1 de 2 (filtrado)");
  });

  it("filtra entradas cerradas — solo muestra activas", () => {
    const { tbody } = setup();
    const entries = [
      mk({ id: "1", unitKey: "U1" }),
      mk({ id: "2", unitKey: "U2", estado: "Finalizado" }),
    ];
    renderActivas(tbody, null, null, { entries, today: TODAY });
    const rows = tbody.querySelectorAll("tr");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("A-117");
  });

  it("días tag colorea por umbral: verde ≤3, ámbar 4-7, rojo >7", () => {
    const { tbody } = setup();
    const entries = [
      mk({ id: "1", unitKey: "U1", eco: "VRD", fentrada: "2026-04-16" }), // 1d
      mk({ id: "2", unitKey: "U2", eco: "AMB", fentrada: "2026-04-12" }), // 5d
      mk({ id: "3", unitKey: "U3", eco: "ROJ", fentrada: "2026-04-01" }), // 16d
    ];
    renderActivas(tbody, null, null, { entries, today: TODAY });
    const tags = tbody.querySelectorAll(".tl-dias-tag");
    expect(tags).toHaveLength(3);
    // urgentes first (orden default por días desc)
    expect((tags[0] as HTMLElement).style.color).toContain("--R");
    expect((tags[1] as HTMLElement).style.color).toContain("--A");
    expect((tags[2] as HTMLElement).style.color).toContain("--G");
  });

  it("sortCol=eco sortDir=1 ordena ascendente", () => {
    const { tbody } = setup();
    const entries = [
      mk({ id: "1", unitKey: "U1", eco: "C-300" }),
      mk({ id: "2", unitKey: "U2", eco: "A-100" }),
      mk({ id: "3", unitKey: "U3", eco: "B-200" }),
    ];
    renderActivas(tbody, null, null, { entries, sortCol: "eco", sortDir: 1, today: TODAY });
    const rows = [...tbody.querySelectorAll("tr")].map((r) =>
      r.querySelector("td")?.textContent?.slice(0, 5),
    );
    expect(rows).toEqual(["A-100", "B-200", "C-300"]);
  });

  it("onOpen callback invocado al click en fila (no en botones hijos)", () => {
    const { tbody } = setup();
    const onOpen = vi.fn();
    renderActivas(tbody, null, null, {
      entries: [mk()],
      today: TODAY,
      onOpen,
    });
    const row = tbody.querySelector("tr") as HTMLElement;
    row.click();
    expect(onOpen).toHaveBeenCalledWith("t1");
  });

  it("onFinalize callback — event no propaga a onOpen", () => {
    const { tbody } = setup();
    const onOpen = vi.fn();
    const onFinalize = vi.fn();
    renderActivas(tbody, null, null, {
      entries: [mk()],
      today: TODAY,
      onOpen,
      onFinalize,
    });
    const btn = tbody.querySelector(".tl-fin-btn") as HTMLButtonElement;
    btn.click();
    expect(onFinalize).toHaveBeenCalledWith("t1");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("hist badge solo cuando count>1; click invoca onOpenHist y no onOpen", () => {
    const { tbody } = setup();
    const onOpen = vi.fn();
    const onOpenHist = vi.fn();
    const entries = [
      mk({ id: "1", unitKey: "U1", estado: "Finalizado", updatedAt: "2026-04-10T00:00:00Z" }),
      mk({ id: "2", unitKey: "U1", estado: "Reparando", updatedAt: "2026-04-15T00:00:00Z" }),
    ];
    renderActivas(tbody, null, null, { entries, today: TODAY, onOpen, onOpenHist });
    const badge = tbody.querySelector(".tl-hist-badge") as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe("2×");
    badge.click();
    expect(onOpenHist).toHaveBeenCalledWith("U1");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("XSS: eco malicioso se renderiza como texto, no ejecuta", () => {
    const { tbody } = setup();
    const pwned = { v: false };
    (window as unknown as { __pwned?: { v: boolean } }).__pwned = pwned;
    const entries = [mk({ eco: "<img src=x onerror='window.__pwned.v=true'>" })];
    renderActivas(tbody, null, null, { entries, today: TODAY });
    expect(pwned.v).toBe(false);
    expect(tbody.querySelector("img")).toBeNull();
    expect(tbody.textContent).toContain("<img");
  });

  it("thead renderiza cabeceras con flecha en columna activa", () => {
    const { tbody, thead } = setup();
    const onSort = vi.fn();
    renderActivas(tbody, thead, null, {
      entries: [mk()],
      sortCol: "eco",
      sortDir: 1,
      onSort,
      today: TODAY,
    });
    const headers = thead.querySelectorAll("th");
    expect(headers.length).toBeGreaterThan(0);
    const ecoTh = [...headers].find((h) => h.textContent?.startsWith("No. Unidad"));
    expect(ecoTh?.textContent).toBe("No. Unidad ▲");
    ecoTh?.click();
    expect(onSort).toHaveBeenCalledWith("eco");
  });

  it("sortCol=dias ordena por días en taller", () => {
    const { tbody } = setup();
    const entries = [
      mk({ id: "1", unitKey: "U1", eco: "X", fentrada: "2026-04-16" }),
      mk({ id: "2", unitKey: "U2", eco: "Y", fentrada: "2026-04-10" }),
    ];
    renderActivas(tbody, null, null, { entries, sortCol: "dias", sortDir: 1, today: TODAY });
    const first = tbody.querySelector("tr td")?.textContent;
    expect(first).toBe("X"); // menos días (1) primero
  });

  it("summary.urgentes cuenta unidades con >7 días", () => {
    const { tbody } = setup();
    const entries = [
      mk({ id: "1", unitKey: "U1", fentrada: "2026-04-01" }), // 16d
      mk({ id: "2", unitKey: "U2", fentrada: "2026-04-16" }), // 1d
    ];
    const s = renderActivas(tbody, null, null, { entries, today: TODAY });
    expect(s.urgentes).toBe(1);
  });
});
