export type VirtualTableOptions<T> = {
  container: HTMLElement;
  rows: T[];
  rowHeight: number;
  overscan?: number;
  renderRow: (row: T, index: number) => HTMLElement;
  onVisibleRangeChange?: (start: number, end: number) => void;
};

type Controller<T> = {
  setRows: (rows: T[]) => void;
  scrollToIndex: (index: number) => void;
  destroy: () => void;
};

export function createVirtualTable<T>(opts: VirtualTableOptions<T>): Controller<T> {
  const { container, rowHeight, overscan = 6, renderRow, onVisibleRangeChange } = opts;
  let rows = opts.rows;

  container.style.position = container.style.position || "relative";
  container.style.overflowY = "auto";

  const sizer = document.createElement("div");
  sizer.style.cssText = "width:1px;pointer-events:none";
  const viewport = document.createElement("div");
  viewport.style.cssText = "position:absolute;top:0;left:0;right:0;will-change:transform";

  container.replaceChildren(sizer, viewport);

  let start = -1;
  let end = -1;
  let raf = 0;

  const render = () => {
    raf = 0;
    const scrollTop = container.scrollTop;
    const viewH = container.clientHeight;
    const total = rows.length;
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const last = Math.min(total, Math.ceil((scrollTop + viewH) / rowHeight) + overscan);

    if (first === start && last === end) return;
    start = first;
    end = last;

    viewport.style.transform = `translateY(${first * rowHeight}px)`;
    viewport.replaceChildren();
    for (let i = first; i < last; i++) {
      const row = rows[i];
      if (row === undefined) continue;
      const el = renderRow(row, i);
      el.style.height = `${rowHeight}px`;
      viewport.appendChild(el);
    }
    onVisibleRangeChange?.(first, last);
  };

  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(render);
  };

  const onScroll = () => schedule();
  container.addEventListener("scroll", onScroll, { passive: true });

  const ro = new ResizeObserver(schedule);
  ro.observe(container);

  const update = (next: T[]) => {
    rows = next;
    sizer.style.height = `${next.length * rowHeight}px`;
    start = end = -1;
    schedule();
  };

  update(rows);

  return {
    setRows: update,
    scrollToIndex: (i) => {
      container.scrollTop = i * rowHeight;
    },
    destroy: () => {
      container.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
