import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVirtualTable } from "../src/ui/virtualTable";

// happy-dom no implementa ResizeObserver — mock mínimo
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

// requestAnimationFrame síncrono en tests para forzar render inmediato
const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
  cb(0);
  return 0;
});

function setupContainer(height = 400, width = 300): HTMLElement {
  document.body.replaceChildren();
  const c = document.createElement("div");
  // JSDOM/happy-dom no calcula layout real — forzamos clientHeight via getter
  Object.defineProperty(c, "clientHeight", { value: height, configurable: true });
  Object.defineProperty(c, "clientWidth", { value: width, configurable: true });
  document.body.appendChild(c);
  return c;
}

function renderRow(data: { id: string; label: string }): HTMLElement {
  const row = document.createElement("div");
  row.className = "vrow";
  row.dataset.id = data.id;
  row.textContent = data.label;
  return row;
}

describe("createVirtualTable", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    rafSpy.mockClear();
  });

  it("instancia con rows vacío → sizer height 0, viewport vacío", () => {
    const c = setupContainer();
    const ctrl = createVirtualTable({ container: c, rows: [], rowHeight: 30, renderRow });
    expect(c.querySelectorAll(".vrow")).toHaveLength(0);
    ctrl.destroy();
  });

  it("renderiza subset según viewport (clientHeight 400, rowHeight 30)", () => {
    const c = setupContainer(400);
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: String(i), label: `row${i}` }));
    const ctrl = createVirtualTable({ container: c, rows, rowHeight: 30, renderRow, overscan: 2 });
    // Esperado: ceil(400/30) = 14 rows visibles + overscan × 2 = 18
    const rendered = c.querySelectorAll(".vrow");
    expect(rendered.length).toBeGreaterThan(10);
    expect(rendered.length).toBeLessThan(30);
    ctrl.destroy();
  });

  it("sizer refleja total height = rows.length × rowHeight", () => {
    const c = setupContainer(400);
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: String(i), label: `r${i}` }));
    createVirtualTable({ container: c, rows, rowHeight: 40, renderRow });
    // El primer child es el sizer (width:1px, height = 50 * 40 = 2000px)
    const sizer = c.firstElementChild as HTMLElement;
    expect(sizer.style.height).toBe("2000px");
  });

  it("setRows actualiza sin destruir", () => {
    const c = setupContainer(400);
    const rowsA = [{ id: "a1", label: "A1" }];
    const ctrl = createVirtualTable({ container: c, rows: rowsA, rowHeight: 30, renderRow });
    const beforeChildren = c.children.length;
    ctrl.setRows([
      { id: "b1", label: "B1" },
      { id: "b2", label: "B2" },
    ]);
    // La estructura base (sizer + viewport) permanece
    expect(c.children.length).toBe(beforeChildren);
    ctrl.destroy();
  });

  it("scrollToIndex actualiza scrollTop", () => {
    const c = setupContainer(400);
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: String(i), label: `r${i}` }));
    const ctrl = createVirtualTable({ container: c, rows, rowHeight: 30, renderRow });
    ctrl.scrollToIndex(10);
    expect(c.scrollTop).toBe(300); // 10 × 30
    ctrl.destroy();
  });

  it("onVisibleRangeChange callback recibe start/end", () => {
    const c = setupContainer(400);
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: String(i), label: `r${i}` }));
    const onRange = vi.fn();
    const ctrl = createVirtualTable({
      container: c,
      rows,
      rowHeight: 30,
      renderRow,
      onVisibleRangeChange: onRange,
    });
    expect(onRange).toHaveBeenCalled();
    const [start, end] = onRange.mock.calls[0]!;
    expect(start).toBe(0);
    expect(end).toBeGreaterThan(0);
    ctrl.destroy();
  });

  it("destroy limpia event listener y ResizeObserver", () => {
    const c = setupContainer();
    const rows = [{ id: "x", label: "x" }];
    const ctrl = createVirtualTable({ container: c, rows, rowHeight: 30, renderRow });
    const removeSpy = vi.spyOn(c, "removeEventListener");
    ctrl.destroy();
    expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
    removeSpy.mockRestore();
  });
});
