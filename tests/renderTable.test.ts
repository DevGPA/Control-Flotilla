import { beforeEach, describe, expect, it, vi } from "vitest";
import { fcell, mkpill, renderTable, tcell } from "../src/ui/renderTable";
import type { Unit } from "../src/types";

// happy-dom no tiene ResizeObserver ni rAF real. Necesario para virtualTable.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
}
vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
  cb(0);
  return 0;
});

// ─── Helpers ────────────────────────────────────────────────────────

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    uid: "u1",
    eco: "A-117",
    plate: "ABC-123",
    brand: "Nissan NP300",
    insp: "Juan Navares",
    risk: "OK",
    F: [],
    T: {},
    minT: 8,
    ...overrides,
  };
}

function setupContainer(): HTMLElement {
  document.body.replaceChildren();
  const d = document.createElement("div");
  d.id = "tbody";
  document.body.appendChild(d);
  return d;
}

// ─── mkpill ─────────────────────────────────────────────────────────

describe("mkpill", () => {
  it("Urgente → span.pill.pu con texto 'Urgente'", () => {
    const el = mkpill("Urgente");
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toBe("pill pu");
    expect(el.textContent).toBe("Urgente");
  });
  it("Revisar → clase pr", () => expect(mkpill("Revisar").className).toBe("pill pr"));
  it("Completar → clase pc", () => expect(mkpill("Completar").className).toBe("pill pc"));
  it("OK → clase po", () => expect(mkpill("OK").className).toBe("pill po"));
  it("incluye dot decorador (.pd)", () => {
    expect(mkpill("OK").querySelector(".pd")).not.toBeNull();
  });
});

// ─── fcell ──────────────────────────────────────────────────────────

describe("fcell", () => {
  it("sin hallazgos → span verde 'Ninguno'", () => {
    const el = fcell(makeUnit({ F: [] }));
    expect(el.textContent).toBe("Ninguno");
    expect(el.getAttribute("style")).toMatch(/color:\s*var\(--G\)/);
  });

  it("cuenta urgentes, revisar, completar por separado", () => {
    const u = makeUnit({
      F: [
        { cat: "Llantas", text: "t1", lv: "Urgente" },
        { cat: "Llantas", text: "t2", lv: "Urgente" },
        { cat: "Fluidos", text: "t3", lv: "Revisar" },
        { cat: "Documentos", text: "t4", lv: "Completar" },
      ],
    });
    const el = fcell(u);
    expect(el.className).toBe("fcw");
    expect(el.textContent).toContain("2 urgentes");
    expect(el.textContent).toContain("1 revisar");
    expect(el.textContent).toContain("1 completar");
    expect(el.querySelectorAll(".fcr")).toHaveLength(3);
  });

  it("excluye findings marcados como done en checklistDB", () => {
    const u = makeUnit({
      F: [
        { cat: "Llantas", text: "piloto 3mm", lv: "Urgente" },
        { cat: "Llantas", text: "copiloto 5mm", lv: "Revisar" },
      ],
    });
    const db = { u1: { "piloto 3mm": { done: true } } };
    const el = fcell(u, db);
    expect(el.textContent).not.toContain("urgente");
    expect(el.textContent).toContain("1 revisar");
  });

  it("singular vs plural en 'urgente(s)'", () => {
    const u1 = makeUnit({ F: [{ cat: "Checklist", text: "x", lv: "Urgente" }] });
    expect(fcell(u1).textContent).toContain("1 urgente");
    expect(fcell(u1).textContent).not.toContain("1 urgentes");
    const u2 = makeUnit({
      F: [
        { cat: "Checklist", text: "a", lv: "Urgente" },
        { cat: "Checklist", text: "b", lv: "Urgente" },
      ],
    });
    expect(fcell(u2).textContent).toContain("2 urgentes");
  });
});

// ─── tcell ──────────────────────────────────────────────────────────

describe("tcell", () => {
  it("minT null → placeholder '—'", () => {
    const el = tcell(null);
    expect(el.textContent).toBe("—");
  });

  it("minT ≤ TCRIT (3.99) → color rojo", () => {
    const el = tcell(3);
    const label = el.querySelector(".tml") as HTMLElement;
    expect(label?.style.color).toBe("var(--R)");
    expect(el.textContent).toContain("3mm");
  });

  it("minT entre TCRIT y TWARN → ámbar", () => {
    const el = tcell(5);
    const label = el.querySelector(".tml") as HTMLElement;
    expect(label?.style.color).toBe("var(--A)");
    expect(el.textContent).toContain("5mm");
  });

  it("minT > TWARN (6.99) → verde", () => {
    const el = tcell(8);
    const label = el.querySelector(".tml") as HTMLElement;
    expect(label?.style.color).toBe("var(--G)");
  });

  it("umbrales custom respetados", () => {
    expect((tcell(10, 5, 8).querySelector(".tml") as HTMLElement).style.color).toBe("var(--G)");
    expect((tcell(7, 5, 8).querySelector(".tml") as HTMLElement).style.color).toBe("var(--A)");
    expect((tcell(3, 5, 8).querySelector(".tml") as HTMLElement).style.color).toBe("var(--R)");
  });
});

// ─── renderTable ───────────────────────────────────────────────────

describe("renderTable", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("estado vacío → mensaje 'Sin resultados'", () => {
    const c = setupContainer();
    renderTable(c, { units: [] });
    expect(c.textContent).toContain("Sin resultados");
    expect(c.querySelector(".nores")).not.toBeNull();
  });

  it("3 units → 3 rows con clase de riesgo", () => {
    const c = setupContainer();
    renderTable(c, {
      units: [
        makeUnit({ uid: "u1", risk: "Urgente" }),
        makeUnit({ uid: "u2", risk: "Revisar" }),
        makeUnit({ uid: "u3", risk: "OK" }),
      ],
    });
    const rows = c.querySelectorAll(".tr");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.className).toContain("ru");
    expect(rows[1]!.className).toContain("rr");
    expect(rows[2]!.className).toContain("ro");
  });

  it("selectedUid → agrega clase 'sel' solo a la fila correspondiente", () => {
    const c = setupContainer();
    renderTable(c, {
      units: [makeUnit({ uid: "u1" }), makeUnit({ uid: "u2" })],
      selectedUid: "u2",
    });
    const rows = c.querySelectorAll(".tr");
    expect(rows[0]!.className).not.toContain(" sel");
    expect(rows[1]!.className).toContain(" sel");
  });

  it("click en fila dispara onSelect con uid", () => {
    const c = setupContainer();
    const onSelect = vi.fn();
    renderTable(c, { units: [makeUnit({ uid: "u1" }), makeUnit({ uid: "u2" })], onSelect });
    (c.querySelectorAll(".tr")[1] as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith("u2");
  });

  it("input hostil en eco/plate/obs se trata como texto (XSS safe)", () => {
    const c = setupContainer();
    renderTable(c, {
      units: [makeUnit({ eco: "<img src=x onerror=alert(1)>", obs: "<script>evil</script>" })],
    });
    const plate = c.querySelector(".tplate");
    expect(plate?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(c.querySelector("img")).toBeNull();
    expect(c.querySelector("script")).toBeNull();
    const cmt = c.querySelector(".tcmt");
    expect(cmt?.textContent).toContain("<script>evil</script>");
  });

  it("hasZip + photos → agrega icono cámara", () => {
    const c = setupContainer();
    renderTable(c, {
      units: [makeUnit({ photos: ["a.jpg", "b.jpg"] })],
      hasZip: true,
    });
    expect(c.querySelector('[data-lucide="camera"]')).not.toBeNull();
  });

  it("isUnitEnTaller true → badge TALLER + outline", () => {
    const c = setupContainer();
    renderTable(c, {
      units: [makeUnit({ uid: "u1" })],
      isUnitEnTaller: (u) => u.uid === "u1",
    });
    expect(c.querySelector(".taller-badge-row")).not.toBeNull();
    const row = c.querySelector(".tr") as HTMLElement;
    expect(row.style.outline).toContain("var(--B)");
  });

  it("obsArr.length > 1 → muestra count badge", () => {
    const c = setupContainer();
    renderTable(c, {
      units: [makeUnit({ obs: "primero", obsArr: ["primero", "segundo", "tercero"] })],
    });
    const cmt = c.querySelector(".tcmt");
    expect(cmt?.textContent).toContain("3");
    expect(cmt?.textContent).toContain("primero");
  });

  it("nextSvc vencido → alerta 'Svc vencido' con icono alert-triangle", () => {
    const c = setupContainer();
    const today = new Date("2026-04-16");
    renderTable(c, {
      units: [makeUnit({ nextSvc: "2026-03-01" })],
      parseSvcDate: (s) => new Date(s),
      today,
    });
    expect(c.textContent).toContain("Svc vencido");
    expect(c.querySelector('[data-lucide="alert-triangle"]')).not.toBeNull();
  });

  it("nextSvc próximo (≤30 días) → alerta 'Svc próximo'", () => {
    const c = setupContainer();
    const today = new Date("2026-04-16");
    renderTable(c, {
      units: [makeUnit({ nextSvc: "2026-05-01" })],
      parseSvcDate: (s) => new Date(s),
      today,
    });
    expect(c.textContent).toContain("Svc próximo");
  });

  it("re-render reemplaza contenido previo", () => {
    const c = setupContainer();
    renderTable(c, { units: [makeUnit({ uid: "u1" }), makeUnit({ uid: "u2" })] });
    expect(c.querySelectorAll(".tr")).toHaveLength(2);
    renderTable(c, { units: [makeUnit({ uid: "u3" })] });
    expect(c.querySelectorAll(".tr")).toHaveLength(1);
  });

  it("virtualize=true: container usa sizer + viewport (no renderiza todas las filas)", () => {
    // happy-dom necesita clientHeight explícito para virtualTable
    const c = setupContainer();
    Object.defineProperty(c, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(c, "clientWidth", { value: 800, configurable: true });
    const units = Array.from({ length: 500 }, (_, i) => makeUnit({ uid: `u${i}`, eco: `E-${i}` }));
    renderTable(c, { units, virtualize: true, rowHeight: 40 });
    // Estructura esperada: 2 children top-level (sizer, viewport). Las filas
    // viven DENTRO del viewport, solo subset.
    expect(c.children.length).toBe(2);
    const allRows = c.querySelectorAll(".tr");
    expect(allRows.length).toBeLessThan(500); // virtualizado
    expect(allRows.length).toBeGreaterThan(0);
    // Sizer refleja altura total: 500 × 40 = 20000px
    const sizer = c.firstElementChild as HTMLElement;
    expect(sizer.style.height).toBe("20000px");
  });

  it("auto-virtualización cuando units.length >= 200 (threshold)", () => {
    const c = setupContainer();
    Object.defineProperty(c, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(c, "clientWidth", { value: 800, configurable: true });
    const units = Array.from({ length: 250 }, (_, i) => makeUnit({ uid: `u${i}` }));
    renderTable(c, { units });
    // En modo virtualizado NO todas las filas renderizan
    const allRows = c.querySelectorAll(".tr");
    expect(allRows.length).toBeLessThan(250);
  });

  it("virtualize=false fuerza modo clásico aunque sean muchas filas", () => {
    const c = setupContainer();
    const units = Array.from({ length: 300 }, (_, i) => makeUnit({ uid: `u${i}` }));
    renderTable(c, { units, virtualize: false });
    expect(c.querySelectorAll(".tr")).toHaveLength(300);
  });
});
