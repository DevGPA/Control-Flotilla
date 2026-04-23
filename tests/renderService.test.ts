import { beforeEach, describe, expect, it } from "vitest";
import { renderService, type UnitSvc, type WeeklyPeriodo } from "../src/ui/detail/renderService";

function makeUnit(overrides: Partial<UnitSvc> = {}): UnitSvc {
  return {
    uid: "u1",
    risk: "OK",
    F: [],
    T: {},
    minT: null,
    ...overrides,
  };
}

function setupContainer(): HTMLElement {
  document.body.replaceChildren();
  const c = document.createElement("div");
  document.body.appendChild(c);
  return c;
}

describe("renderService", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("sin obs/svc/weekly → solo empty obs", () => {
    const c = setupContainer();
    renderService(c, { unit: makeUnit() });
    expect(c.textContent).toContain("Sin observaciones registradas");
    expect(c.querySelector(".svccard")).toBeNull();
    expect(c.querySelector(".sw-svccard")).toBeNull();
  });

  it("obs simple (string) → 1 obscard sin badge", () => {
    const c = setupContainer();
    renderService(c, { unit: makeUnit({ obs: "revisión general" }) });
    const cards = c.querySelectorAll(".obscard");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.textContent).toContain("revisión general");
    // Sin badge de count
    expect(c.querySelector(".obscard-hdr")).toBeNull();
  });

  it("obsArr múltiples → badge de count + header por card", () => {
    const c = setupContainer();
    renderService(c, {
      unit: makeUnit({ obs: "a", obsArr: ["a", "b", "c"] }),
    });
    expect(c.querySelectorAll(".obscard")).toHaveLength(3);
    expect(c.textContent).toContain("Comentario 1 de 3");
    expect(c.textContent).toContain("Comentario 2 de 3");
    expect(c.textContent).toContain("Comentario 3 de 3");
  });

  it("svc card aparece si al menos uno de lastSvc/nextSvc/kmNextSvc", () => {
    const c = setupContainer();
    renderService(c, { unit: makeUnit({ lastSvc: "2026-01-15" }) });
    expect(c.querySelector(".svccard")).not.toBeNull();
    expect(c.textContent).toContain("Último servicio");
    expect(c.textContent).toContain("2026-01-15");
  });

  it("svc row 'Próximo servicio' colorea ámbar", () => {
    const c = setupContainer();
    renderService(c, { unit: makeUnit({ nextSvc: "2026-05-20" }) });
    const row = [...c.querySelectorAll(".svcrow")].find((r) =>
      r.textContent?.includes("Próximo servicio"),
    );
    const val = row?.querySelector(".svcval") as HTMLElement;
    expect(val.style.color).toBe("var(--A)");
  });

  it("kmNextSvc formatea con separadores es-MX", () => {
    const c = setupContainer();
    renderService(c, { unit: makeUnit({ kmNextSvc: 125430 }) });
    expect(c.textContent).toContain("125,430 km");
  });

  it("weekly cross-ref: encuentra por uid", () => {
    const c = setupContainer();
    const periodos: WeeklyPeriodo[] = [
      {
        label: "Marzo",
        entries: [
          {
            uid: "u1",
            fecha: "2026-03-15",
            aceiteRisk: "Urgente",
            radiadorRisk: "OK",
          },
        ],
      },
    ];
    renderService(c, { unit: makeUnit({ uid: "u1" }), weeklyPeriodos: periodos });
    expect(c.querySelector(".sw-svccard")).not.toBeNull();
    expect(c.textContent).toContain("Última revisión semanal · Marzo");
    expect(c.textContent).toContain("2026-03-15");
  });

  it("weekly cross-ref: fallback por eco si uid no matches", () => {
    const c = setupContainer();
    const periodos: WeeklyPeriodo[] = [
      {
        label: "Abril",
        entries: [
          {
            uid: "different",
            eco: "A-117",
            fecha: "2026-04-01",
            aceiteRisk: "OK",
            radiadorRisk: "OK",
          },
        ],
      },
    ];
    renderService(c, { unit: makeUnit({ uid: "u1", eco: "A-117" }), weeklyPeriodos: periodos });
    expect(c.querySelector(".sw-svccard")).not.toBeNull();
    expect(c.textContent).toContain("Abril");
  });

  it("weekly cross-ref: ordena descendente por periodo label", () => {
    const c = setupContainer();
    const periodos: WeeklyPeriodo[] = [
      {
        label: "Enero 2026",
        entries: [{ uid: "u1", fecha: "2026-01-15", aceiteRisk: "OK", radiadorRisk: "OK" }],
      },
      {
        label: "Marzo 2026",
        entries: [{ uid: "u1", fecha: "2026-03-15", aceiteRisk: "OK", radiadorRisk: "OK" }],
      },
      {
        label: "Febrero 2026",
        entries: [{ uid: "u1", fecha: "2026-02-15", aceiteRisk: "OK", radiadorRisk: "OK" }],
      },
    ];
    renderService(c, { unit: makeUnit(), weeklyPeriodos: periodos });
    expect(c.textContent).toContain("Marzo 2026");
    // El más alto alfabéticamente desc sale primero
  });

  it("weekly: aceite Urgente → valor en rojo", () => {
    const c = setupContainer();
    const periodos: WeeklyPeriodo[] = [
      {
        label: "Marzo",
        entries: [{ uid: "u1", fecha: "x", aceiteRisk: "Urgente", radiadorRisk: "OK" }],
      },
    ];
    renderService(c, { unit: makeUnit(), weeklyPeriodos: periodos });
    const aceite = [...c.querySelectorAll(".sw-svcrow")].find((r) =>
      r.textContent?.includes("Aceite"),
    );
    const val = aceite?.querySelector(".sw-svcval") as HTMLElement;
    expect(val.style.color).toBe("var(--R)");
  });

  it("input hostil en obs/lastSvc → textContent safe", () => {
    const c = setupContainer();
    renderService(c, {
      unit: makeUnit({
        obs: "<script>alert(1)</script>",
        lastSvc: "<img src=x onerror=y>",
      }),
    });
    expect(c.querySelector("script")).toBeNull();
    expect(c.querySelector("img")).toBeNull();
    expect(c.textContent).toContain("<script>");
  });

  it("re-render reemplaza contenido", () => {
    const c = setupContainer();
    renderService(c, { unit: makeUnit({ obs: "primero" }) });
    expect(c.textContent).toContain("primero");
    renderService(c, { unit: makeUnit({ obs: "segundo" }) });
    expect(c.textContent).toContain("segundo");
    expect(c.textContent).not.toContain("primero");
  });
});
