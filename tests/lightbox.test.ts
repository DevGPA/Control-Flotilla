import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLightbox } from "../src/ui/detail/lightbox";

describe("createLightbox", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("monta overlay con id default 'lb'", () => {
    const lb = createLightbox();
    expect(document.getElementById("lb")).not.toBeNull();
    lb.destroy();
  });

  it("overlay oculto por default (display:none)", () => {
    const lb = createLightbox();
    const ov = document.getElementById("lb") as HTMLElement;
    expect(ov.style.display).toBe("none");
    lb.destroy();
  });

  it("open() muestra overlay + setea imagen + label + counter", () => {
    const lb = createLightbox();
    lb.open([
      { url: "blob:foo", label: "Piloto" },
      { url: "blob:bar", label: "Copiloto" },
    ], 0);
    const ov = document.getElementById("lb") as HTMLElement;
    expect(ov.style.display).toBe("flex");
    expect((document.getElementById("lb-img") as HTMLImageElement).src).toContain("foo");
    expect(document.getElementById("lb-label")?.textContent).toBe("Piloto");
    expect(document.getElementById("lb-ctr")?.textContent).toBe("1 de 2");
    lb.destroy();
  });

  it("next/prev navegan circularmente", () => {
    const lb = createLightbox();
    lb.open([
      { url: "a", label: "A" },
      { url: "b", label: "B" },
      { url: "c", label: "C" },
    ], 0);
    lb.next();
    expect(document.getElementById("lb-label")?.textContent).toBe("B");
    lb.next();
    expect(document.getElementById("lb-label")?.textContent).toBe("C");
    lb.next();
    expect(document.getElementById("lb-label")?.textContent).toBe("A"); // wraps
    lb.prev();
    expect(document.getElementById("lb-label")?.textContent).toBe("C"); // wraps back
    lb.destroy();
  });

  it("close() oculta overlay", () => {
    const lb = createLightbox();
    lb.open([{ url: "a", label: "A" }]);
    lb.close();
    const ov = document.getElementById("lb") as HTMLElement;
    expect(ov.style.display).toBe("none");
    lb.destroy();
  });

  it("startIdx respetado", () => {
    const lb = createLightbox();
    lb.open([
      { url: "a", label: "A" },
      { url: "b", label: "B" },
      { url: "c", label: "C" },
    ], 2);
    expect(document.getElementById("lb-label")?.textContent).toBe("C");
    expect(document.getElementById("lb-ctr")?.textContent).toBe("3 de 3");
    lb.destroy();
  });

  it("startIdx fuera de rango se clampa", () => {
    const lb = createLightbox();
    lb.open([{ url: "a", label: "A" }], 99);
    expect(document.getElementById("lb-label")?.textContent).toBe("A");
    lb.destroy();
  });

  it("open con items vacío → no-op", () => {
    const lb = createLightbox();
    lb.open([]);
    const ov = document.getElementById("lb") as HTMLElement;
    expect(ov.style.display).toBe("none");
    lb.destroy();
  });

  it("con 1 item, botones prev/next ocultos", () => {
    const lb = createLightbox();
    lb.open([{ url: "a", label: "A" }]);
    const prev = document.querySelector("#lb button") as HTMLButtonElement;
    // Hay 3 buttons (prev, next, close). Validamos que prev/next tengan display:none.
    const allBtns = document.querySelectorAll("#lb button");
    const navBtns = [...allBtns].filter((b) => b.textContent === "‹" || b.textContent === "›");
    expect(navBtns.every((b) => (b as HTMLElement).style.display === "none")).toBe(true);
    expect(prev).toBeTruthy();
    lb.destroy();
  });

  it("con 2+ items, botones prev/next visibles", () => {
    const lb = createLightbox();
    lb.open([{ url: "a", label: "A" }, { url: "b", label: "B" }]);
    const navBtns = [...document.querySelectorAll("#lb button")].filter(
      (b) => b.textContent === "‹" || b.textContent === "›",
    );
    expect(navBtns.every((b) => (b as HTMLElement).style.display !== "none")).toBe(true);
    lb.destroy();
  });

  it("keyboard: ArrowRight → next", () => {
    const lb = createLightbox();
    lb.open([
      { url: "a", label: "A" },
      { url: "b", label: "B" },
    ]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(document.getElementById("lb-label")?.textContent).toBe("B");
    lb.destroy();
  });

  it("keyboard: ArrowLeft → prev", () => {
    const lb = createLightbox();
    lb.open([{ url: "a", label: "A" }, { url: "b", label: "B" }], 1);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(document.getElementById("lb-label")?.textContent).toBe("A");
    lb.destroy();
  });

  it("keyboard: Escape → close", () => {
    const lb = createLightbox();
    lb.open([{ url: "a", label: "A" }]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect((document.getElementById("lb") as HTMLElement).style.display).toBe("none");
    lb.destroy();
  });

  it("keyboard ignorado cuando overlay cerrado", () => {
    const lb = createLightbox();
    const updateLabel = document.getElementById("lb-label");
    lb.open([{ url: "a", label: "A" }]);
    lb.close();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    // Label no cambia después del close
    expect(updateLabel?.textContent).toBe("A");
    lb.destroy();
  });

  it("resolveUrl lazy resolution", () => {
    const resolve = vi.fn((fname: string) => `blob:resolved-${fname}`);
    const lb = createLightbox({ resolveUrl: resolve });
    lb.open([{ fname: "photo1.jpg", label: "Foto 1" }]);
    expect(resolve).toHaveBeenCalledWith("photo1.jpg");
    const img = document.getElementById("lb-img") as HTMLImageElement;
    expect(img.src).toContain("resolved-photo1.jpg");
    lb.destroy();
  });

  it("destroy remueve overlay + listener", () => {
    const lb = createLightbox();
    lb.open([{ url: "a", label: "A" }, { url: "b", label: "B" }]);
    lb.destroy();
    expect(document.getElementById("lb")).toBeNull();
    // Después de destroy, keyboard handler no debe estar activo
    // (no podemos re-testear después de destroy pero lo importante es sin error)
  });

  it("custom overlayId respetado", () => {
    const lb = createLightbox({ overlayId: "my-lb" });
    expect(document.getElementById("my-lb")).not.toBeNull();
    expect(document.getElementById("my-lb-img")).not.toBeNull();
    lb.destroy();
  });
});
