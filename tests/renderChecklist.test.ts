import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeDiff, renderChecklist, type PeriodDiff } from "../src/ui/detail/renderChecklist";
import type { Finding, Unit } from "../src/types";

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    uid: "u1",
    eco: "A-117",
    plate: "ABC-123",
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
  c.id = "detail-body";
  document.body.appendChild(c);
  return c;
}

// ─── computeDiff ────────────────────────────────────────────────

describe("computeDiff", () => {
  const prev: Finding[] = [
    { cat: "Llantas", text: "piloto 3mm", lv: "Urgente" },
    { cat: "Fluidos", text: "aceite bajo", lv: "Revisar" },
    { cat: "Checklist", text: "asientos", lv: "Revisar" },
  ];

  it("detecta nuevos findings", () => {
    const cur: Finding[] = [...prev, { cat: "Documentos", text: "tarjeta vencida", lv: "Completar" }];
    const d = computeDiff(cur, prev, "Marzo");
    expect(d.newFails).toHaveLength(1);
    expect(d.newFails[0].item).toBe("tarjeta vencida");
    expect(d.newFails[0].lv).toBe("Completar");
  });

  it("detecta resueltos", () => {
    const cur: Finding[] = prev.slice(0, 2); // quitado "asientos"
    const d = computeDiff(cur, prev, "Marzo");
    expect(d.resolved).toHaveLength(1);
    expect(d.resolved[0].item).toBe("asientos");
  });

  it("detecta empeorados", () => {
    const cur: Finding[] = prev.map((f) =>
      f.text === "aceite bajo" ? { ...f, lv: "Urgente" } : f,
    );
    const d = computeDiff(cur, prev, "Marzo");
    expect(d.worsened).toHaveLength(1);
    expect(d.worsened[0].item).toBe("aceite bajo");
    expect(d.worsened[0].from).toBe("Revisar");
    expect(d.worsened[0].to).toBe("Urgente");
  });

  it("detecta mejorados", () => {
    const cur: Finding[] = prev.map((f) =>
      f.text === "piloto 3mm" ? { ...f, lv: "Revisar" } : f,
    );
    const d = computeDiff(cur, prev, "Marzo");
    expect(d.improved).toHaveLength(1);
    expect(d.improved[0].item).toBe("piloto 3mm");
  });

  it("sin cambios → diff vacío", () => {
    const d = computeDiff(prev, prev, "Marzo");
    expect(d.newFails).toHaveLength(0);
    expect(d.resolved).toHaveLength(0);
    expect(d.worsened).toHaveLength(0);
    expect(d.improved).toHaveLength(0);
  });
});

// ─── renderChecklist ───────────────────────────────────────────

describe("renderChecklist", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("empty state: unidad sin findings → mensaje verde", () => {
    const c = setupContainer();
    renderChecklist(c, { unit: makeUnit({ F: [] }) });
    expect(c.textContent).toContain("Sin hallazgos");
    expect(c.textContent).toContain("✓");
  });

  it("findings → summary chips + progress bar + categorías", () => {
    const c = setupContainer();
    const u = makeUnit({
      F: [
        { cat: "Llantas", text: "piloto 3mm", lv: "Urgente" },
        { cat: "Fluidos", text: "aceite", lv: "Revisar" },
        { cat: "Documentos", text: "tarjeta", lv: "Completar" },
      ],
    });
    renderChecklist(c, { unit: u });

    expect(c.querySelector(".ck-inline-summary")).not.toBeNull();
    expect(c.querySelector(".ck-progress")).not.toBeNull();
    expect(c.querySelectorAll(".ck-chip")).toHaveLength(3); // urg, rev, comp
    expect(c.querySelector(".ck-total")?.textContent).toBe("3 total");
  });

  it("checklistDB con done descuenta del pendiente y marca ✓", () => {
    const c = setupContainer();
    const u = makeUnit({
      F: [
        { cat: "Llantas", text: "piloto 3mm", lv: "Urgente" },
        { cat: "Fluidos", text: "aceite", lv: "Revisar" },
      ],
    });
    const db = { u1: { "piloto 3mm": { done: true } } };
    renderChecklist(c, { unit: u, checklistDB: db });

    const doneItem = c.querySelector(".ck-done");
    expect(doneItem).not.toBeNull();
    expect(doneItem?.textContent).toContain("✓");
    expect(doneItem?.textContent).toContain("piloto 3mm");
  });

  it("click en finding actionable → dispara onToggle con uid + text", () => {
    const c = setupContainer();
    const onToggle = vi.fn();
    const u = makeUnit({
      F: [{ cat: "Llantas", text: "piloto 3mm", lv: "Urgente" }],
    });
    renderChecklist(c, { unit: u, onToggle });

    const item = c.querySelector(".ck-actionable") as HTMLElement;
    expect(item).not.toBeNull();
    item.click();
    expect(onToggle).toHaveBeenCalledWith("u1", "piloto 3mm");
  });

  it("item done no dispara onToggle... bueno SI lo dispara (permite des-marcar)", () => {
    const c = setupContainer();
    const onToggle = vi.fn();
    const u = makeUnit({
      F: [{ cat: "Llantas", text: "x", lv: "Urgente" }],
    });
    renderChecklist(c, { unit: u, checklistDB: { u1: { x: { done: true } } }, onToggle });

    const item = c.querySelector(".ck-done") as HTMLElement;
    item.click();
    expect(onToggle).toHaveBeenCalledWith("u1", "x");
  });

  it("agrupa por categoría en orden Llantas → Fluidos → Documentos → Checklist", () => {
    const c = setupContainer();
    const u = makeUnit({
      F: [
        { cat: "Checklist", text: "a", lv: "Revisar" },
        { cat: "Llantas", text: "b", lv: "Urgente" },
        { cat: "Documentos", text: "c", lv: "Completar" },
        { cat: "Fluidos", text: "d", lv: "Revisar" },
      ],
    });
    renderChecklist(c, { unit: u });

    const titles = [...c.querySelectorAll(".ck-cat-ttl")].map((t) => t.textContent?.trim() ?? "");
    const categoryTexts = titles.map((t) => t.split(" ").slice(1, 2)[0]); // second token
    expect(categoryTexts).toEqual(["Llantas", "Fluidos", "Documentos", "Checklist"]);
  });

  it("dentro de categoría ordena Urgente → Revisar → Completar", () => {
    const c = setupContainer();
    const u = makeUnit({
      F: [
        { cat: "Llantas", text: "rev1", lv: "Revisar" },
        { cat: "Llantas", text: "urg1", lv: "Urgente" },
        { cat: "Llantas", text: "comp1", lv: "Completar" },
      ],
    });
    renderChecklist(c, { unit: u });
    const items = [...c.querySelectorAll(".ck-item")].map((i) => i.textContent?.replace(/[✓]/g, "").trim());
    expect(items).toEqual(["urg1", "rev1", "comp1"]);
  });

  it("diff newFails marca con highlight inset outline", () => {
    const c = setupContainer();
    const u = makeUnit({
      F: [{ cat: "Llantas", text: "nuevo", lv: "Urgente" }],
    });
    const diff: PeriodDiff = {
      newFails: [{ item: "nuevo", lv: "Urgente" }],
      resolved: [],
      worsened: [],
      improved: [],
      label: "Marzo",
    };
    renderChecklist(c, { unit: u, diff });
    const item = c.querySelector(".ck-item") as HTMLElement;
    expect(item.style.boxShadow).toContain("var(--O)");
  });

  it("diff con resuelto se renderiza en sección de cambios", () => {
    const c = setupContainer();
    const u = makeUnit({
      F: [{ cat: "Llantas", text: "quedan", lv: "Urgente" }],
    });
    const diff: PeriodDiff = {
      newFails: [],
      resolved: [{ item: "antes-arreglado", lv: "Revisar" }],
      worsened: [],
      improved: [],
      label: "Marzo",
    };
    renderChecklist(c, { unit: u, diff });
    expect(c.textContent).toContain("Cambios vs Marzo");
    expect(c.textContent).toContain("Resuelto");
    expect(c.textContent).toContain("antes-arreglado");
  });

  it("input hostil en findings.text → textContent safe", () => {
    const c = setupContainer();
    const u = makeUnit({
      F: [{ cat: "Llantas", text: "<img src=x onerror=alert(1)>", lv: "Urgente" }],
    });
    renderChecklist(c, { unit: u });
    expect(c.querySelector("img")).toBeNull();
    expect(c.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("re-render reemplaza contenido previo", () => {
    const c = setupContainer();
    renderChecklist(c, { unit: makeUnit({ F: [{ cat: "Llantas", text: "a", lv: "Urgente" }] }) });
    expect(c.querySelectorAll(".ck-item")).toHaveLength(1);
    renderChecklist(c, { unit: makeUnit({ F: [] }) });
    expect(c.querySelectorAll(".ck-item")).toHaveLength(0);
    expect(c.textContent).toContain("Sin hallazgos");
  });
});
