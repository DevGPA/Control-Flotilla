import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOTE_TYPES, renderNotes, type Note } from "../src/ui/detail/renderNotes";
import type { Unit } from "../src/types";

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
  c.id = "notes-body";
  document.body.appendChild(c);
  return c;
}

function fixedDate(_ts: string): string {
  return "15 abr, 10:30"; // determinístico para tests
}

describe("NOTE_TYPES", () => {
  it("tiene 4 tipos con label y color", () => {
    expect(Object.keys(NOTE_TYPES)).toEqual(["seguimiento", "taller", "alerta", "info"]);
    for (const t of Object.values(NOTE_TYPES)) {
      expect(t.label).toBeTruthy();
      expect(t.color).toMatch(/var\(--/);
    }
  });
});

describe("renderNotes", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("empty state: unidad sin notas → mensaje con icon notebook-pen", () => {
    const c = setupContainer();
    renderNotes(c, { unit: makeUnit(), formatDate: fixedDate });
    expect(c.querySelector(".note-empty")).not.toBeNull();
    expect(c.querySelector('[data-lucide="notebook-pen"]')).not.toBeNull();
    expect(c.textContent).toContain("Sin notas aún");
  });

  it("header cuenta singular/plural", () => {
    const c = setupContainer();
    renderNotes(c, { unit: makeUnit(), formatDate: fixedDate });
    expect(c.querySelector(".notes-cnt")?.textContent).toBe("0 notas");

    const notes: Record<string, Note[]> = {
      u1: [{ id: "n1", text: "foo", type: "info", ts: "2026-04-15T10:30:00Z" }],
    };
    renderNotes(c, { unit: makeUnit(), notesDB: notes, formatDate: fixedDate });
    expect(c.querySelector(".notes-cnt")?.textContent).toBe("1 nota");
  });

  it("renderiza notas en orden reverse (más recientes primero)", () => {
    const c = setupContainer();
    const notes: Record<string, Note[]> = {
      u1: [
        { id: "n1", text: "primera", type: "info", ts: "2026-04-10T10:00:00Z" },
        { id: "n2", text: "segunda", type: "seguimiento", ts: "2026-04-15T10:00:00Z" },
        { id: "n3", text: "tercera", type: "alerta", ts: "2026-04-17T10:00:00Z" },
      ],
    };
    renderNotes(c, { unit: makeUnit(), notesDB: notes, formatDate: fixedDate });
    const items = [...c.querySelectorAll(".note-item .note-text")].map((i) => i.textContent);
    expect(items).toEqual(["tercera", "segunda", "primera"]);
  });

  it("badge con color por tipo", () => {
    const c = setupContainer();
    const notes: Record<string, Note[]> = {
      u1: [{ id: "n1", text: "foo", type: "alerta", ts: "2026-04-15T10:00:00Z" }],
    };
    renderNotes(c, { unit: makeUnit(), notesDB: notes, formatDate: fixedDate });
    const badge = c.querySelector(".note-badge") as HTMLElement;
    expect(badge.textContent).toBe("Alerta");
    expect(badge.style.color).toBe("var(--R)");
  });

  it("click + botón 'Guardar nota' → dispara onAdd con uid, text, type", () => {
    const c = setupContainer();
    const onAdd = vi.fn();
    renderNotes(c, { unit: makeUnit(), onAdd, formatDate: fixedDate });

    const ta = c.querySelector("#note-input") as HTMLTextAreaElement;
    const select = c.querySelector("#note-type") as HTMLSelectElement;
    const btn = c.querySelector(".note-save") as HTMLButtonElement;

    ta.value = "revisar suspensión";
    select.value = "taller";
    btn.click();

    expect(onAdd).toHaveBeenCalledWith("u1", "revisar suspensión", "taller");
    expect(ta.value).toBe(""); // limpia después de submit
  });

  it("submit con textarea vacío NO dispara onAdd", () => {
    const c = setupContainer();
    const onAdd = vi.fn();
    renderNotes(c, { unit: makeUnit(), onAdd, formatDate: fixedDate });
    const btn = c.querySelector(".note-save") as HTMLButtonElement;
    btn.click();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("whitespace-only textarea NO dispara onAdd", () => {
    const c = setupContainer();
    const onAdd = vi.fn();
    renderNotes(c, { unit: makeUnit(), onAdd, formatDate: fixedDate });
    const ta = c.querySelector("#note-input") as HTMLTextAreaElement;
    const btn = c.querySelector(".note-save") as HTMLButtonElement;
    ta.value = "   \n\t  ";
    btn.click();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("botón ✕ de nota dispara onDelete con uid + noteId", () => {
    const c = setupContainer();
    const onDelete = vi.fn();
    const notes: Record<string, Note[]> = {
      u1: [{ id: "n-abc", text: "borrar", type: "info", ts: "2026-04-15T10:00:00Z" }],
    };
    renderNotes(c, { unit: makeUnit(), notesDB: notes, onDelete, formatDate: fixedDate });
    const delBtn = c.querySelector(".note-del") as HTMLButtonElement;
    delBtn.click();
    expect(onDelete).toHaveBeenCalledWith("u1", "n-abc");
  });

  it("sin onDelete → no renderiza botón ✕", () => {
    const c = setupContainer();
    const notes: Record<string, Note[]> = {
      u1: [{ id: "n1", text: "x", type: "info", ts: "2026-04-15T10:00:00Z" }],
    };
    renderNotes(c, { unit: makeUnit(), notesDB: notes, formatDate: fixedDate });
    expect(c.querySelector(".note-del")).toBeNull();
  });

  it("texto hostil en nota → textContent safe (no crea DOM)", () => {
    const c = setupContainer();
    const notes: Record<string, Note[]> = {
      u1: [
        {
          id: "n1",
          text: '<img src=x onerror=alert(1)><script>evil</script>',
          type: "info",
          ts: "2026-04-15T10:00:00Z",
        },
      ],
    };
    renderNotes(c, { unit: makeUnit(), notesDB: notes, formatDate: fixedDate });
    expect(c.querySelector("img")).toBeNull();
    expect(c.querySelector("script")).toBeNull();
    expect(c.querySelector(".note-text")?.textContent).toContain("<img");
  });

  it("select tiene las 4 opciones de tipo", () => {
    const c = setupContainer();
    renderNotes(c, { unit: makeUnit(), formatDate: fixedDate });
    const opts = [...c.querySelectorAll("#note-type option")].map((o) => o.getAttribute("value"));
    expect(opts).toEqual(["seguimiento", "taller", "alerta", "info"]);
  });

  it("re-render reemplaza contenido previo", () => {
    const c = setupContainer();
    const notes1: Record<string, Note[]> = {
      u1: [{ id: "a", text: "antes", type: "info", ts: "2026-04-15T10:00:00Z" }],
    };
    renderNotes(c, { unit: makeUnit(), notesDB: notes1, formatDate: fixedDate });
    expect(c.querySelectorAll(".note-item")).toHaveLength(1);
    renderNotes(c, { unit: makeUnit(), notesDB: {}, formatDate: fixedDate });
    expect(c.querySelectorAll(".note-item")).toHaveLength(0);
  });

  it("unidad sin entry en notesDB pero con entries de OTRA unidad → empty state", () => {
    const c = setupContainer();
    const notesDB: Record<string, Note[]> = {
      otraUnit: [{ id: "x", text: "otra", type: "info", ts: "2026-04-15T10:00:00Z" }],
    };
    renderNotes(c, { unit: makeUnit({ uid: "u1" }), notesDB, formatDate: fixedDate });
    expect(c.querySelector(".note-empty")).not.toBeNull();
  });
});
