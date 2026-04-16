import { beforeEach, describe, expect, it, vi } from "vitest";
import { fcell, mkpill, renderTable, tcell } from "../src/ui/renderTable";
import type { Unit } from "../src/types";

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
  document.body.innerHTML = '<div id="tbody"></div>';
  return document.getElementById("tbody")!;
}

// ─── mkpill ─────────────────────────────────────────────────────────

describe("mkpill", () => {
  it("Urgente → clase pu", () => {
    expect(mkpill("Urgente")).toContain('class="pill pu"');
    expect(mkpill("Urgente")).toContain("Urgente");
  });
  it("Revisar → clase pr", () => expect(mkpill("Revisar")).toContain('class="pill pr"'));
  it("Completar → clase pc", () => expect(mkpill("Completar")).toContain('class="pill pc"'));
  it("OK → clase po", () => expect(mkpill("OK")).toContain('class="pill po"'));
});

// ─── fcell ──────────────────────────────────────────────────────────

describe("fcell", () => {
  it("sin hallazgos → 'Ninguno' en verde", () => {
    const html = fcell(makeUnit({ F: [] }));
    expect(html).toContain("Ninguno");
    expect(html).toContain("color:var(--G)");
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
    const html = fcell(u);
    expect(html).toContain("2 urgentes");
    expect(html).toContain("1 revisar");
    expect(html).toContain("1 completar");
  });

  it("excluye findings marcados como done en checklistDB", () => {
    const u = makeUnit({
      F: [
        { cat: "Llantas", text: "piloto 3mm", lv: "Urgente" },
        { cat: "Llantas", text: "copiloto 5mm", lv: "Revisar" },
      ],
    });
    const db = { u1: { "piloto 3mm": { done: true } } };
    const html = fcell(u, db);
    expect(html).not.toContain("urgente");
    expect(html).toContain("1 revisar");
  });

  it("singular vs plural en 'urgente(s)'", () => {
    const u1 = makeUnit({ F: [{ cat: "Checklist", text: "x", lv: "Urgente" }] });
    expect(fcell(u1)).toContain("1 urgente</span>");
    const u2 = makeUnit({ F: [
      { cat: "Checklist", text: "a", lv: "Urgente" },
      { cat: "Checklist", text: "b", lv: "Urgente" },
    ] });
    expect(fcell(u2)).toContain("2 urgentes");
  });
});

// ─── tcell ──────────────────────────────────────────────────────────

describe("tcell", () => {
  it("minT null → placeholder", () => {
    expect(tcell(null)).toContain("—");
  });

  it("minT ≤ TCRIT (3.99) → color rojo", () => {
    const html = tcell(3);
    expect(html).toContain("var(--R)");
    expect(html).toContain("3mm");
  });

  it("minT entre TCRIT y TWARN → ámbar", () => {
    const html = tcell(5);
    expect(html).toContain("var(--A)");
    expect(html).toContain("5mm");
  });

  it("minT > TWARN (6.99) → verde", () => {
    const html = tcell(8);
    expect(html).toContain("var(--G)");
  });

  it("umbrales custom respetados", () => {
    expect(tcell(10, 5, 8)).toContain("var(--G)");
    expect(tcell(7, 5, 8)).toContain("var(--A)");
    expect(tcell(3, 5, 8)).toContain("var(--R)");
  });
});

// ─── renderTable ───────────────────────────────────────────────────

describe("renderTable", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
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
    expect(rows[0].className).toContain("ru");
    expect(rows[1].className).toContain("rr");
    expect(rows[2].className).toContain("ro");
  });

  it("selectedUid → agrega clase 'sel' solo a la fila correspondiente", () => {
    const c = setupContainer();
    renderTable(c, {
      units: [makeUnit({ uid: "u1" }), makeUnit({ uid: "u2" })],
      selectedUid: "u2",
    });
    const rows = c.querySelectorAll(".tr");
    expect(rows[0].className).not.toContain(" sel");
    expect(rows[1].className).toContain(" sel");
  });

  it("click en fila dispara onSelect con uid", () => {
    const c = setupContainer();
    const onSelect = vi.fn();
    renderTable(c, { units: [makeUnit({ uid: "u1" }), makeUnit({ uid: "u2" })], onSelect });
    (c.querySelectorAll(".tr")[1] as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith("u2");
  });

  it("input hostil en eco/plate se escapa (XSS safe via textContent)", () => {
    const c = setupContainer();
    renderTable(c, {
      units: [makeUnit({ eco: '<img src=x onerror=alert(1)>', obs: '<script>evil</script>' })],
    });
    // textContent lo preserva como texto; el navegador no lo ejecuta ni crea nodos.
    const plate = c.querySelector(".tplate");
    expect(plate?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(c.querySelector("img")).toBeNull();
    expect(c.querySelector("script")).toBeNull();
    // La observación también
    const cmt = c.querySelector(".tcmt");
    expect(cmt?.textContent).toContain('<script>evil</script>');
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
    expect(row.style.outline).toContain("#c4b5fd");
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
});
