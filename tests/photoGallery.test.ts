import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLightbox } from "../src/ui/detail/lightbox";
import {
  renderPhotoGallery,
  shortLbl,
  type ManualPhoto,
  type PhotoEntry,
} from "../src/ui/detail/photoGallery";
import type { Unit } from "../src/types";

function makeUnit(overrides: Partial<Unit & { photos?: PhotoEntry[] }> = {}): Unit & { photos?: PhotoEntry[] } {
  return {
    uid: "u1",
    risk: "OK",
    F: [],
    T: {},
    minT: null,
    photos: [],
    ...overrides,
  };
}

function setup(): HTMLElement {
  document.body.replaceChildren();
  const c = document.createElement("div");
  document.body.appendChild(c);
  return c;
}

describe("shortLbl", () => {
  it("quita prefix 'Foto del/del vehiculo/con/gato'", () => {
    expect(shortLbl("Foto del motor")).toBe("motor");
    expect(shortLbl("Fotos del vehiculo parte frontal")).toBe("vehiculo parte frontal");
    expect(shortLbl("Foto del chasis")).toBe("chasis");
  });
  it("colapsa whitespace múltiple", () => {
    expect(shortLbl("Foto   del   chasis")).toBe("chasis");
  });
  it("trunca a 28 chars", () => {
    const long = "a".repeat(40);
    expect(shortLbl(long).length).toBeLessThanOrEqual(28);
  });
  it("fallback cuando regex no matches", () => {
    expect(shortLbl("abcdef")).toBe("abcdef");
  });
});

describe("renderPhotoGallery — empty states", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("sin ZIP y sin manuales → empty state 'Sin fotos disponibles'", () => {
    const c = setup();
    renderPhotoGallery(c, { unit: makeUnit(), hasZip: false });
    expect(c.textContent).toContain("Sin fotos disponibles");
    expect(c.querySelector('[data-lucide="camera-off"]')).not.toBeNull();
  });

  it("empty state 'No ZIP' tiene botón Agregar fotos que dispara onAddManualPhoto", () => {
    const c = setup();
    const onAdd = vi.fn();
    renderPhotoGallery(c, { unit: makeUnit(), hasZip: false, onAddManualPhoto: onAdd });
    const btn = [...c.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Agregar"),
    ) as HTMLButtonElement;
    btn.click();
    expect(onAdd).toHaveBeenCalledWith("u1");
  });

  it("con ZIP pero sin fotos → empty state 'Sin fotos registradas' + botón manual", () => {
    const c = setup();
    const onAdd = vi.fn();
    renderPhotoGallery(c, {
      unit: makeUnit({ photos: [] }),
      hasZip: true,
      onAddManualPhoto: onAdd,
    });
    expect(c.textContent).toContain("Sin fotos registradas");
    const btn = [...c.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Agregar foto manual"),
    ) as HTMLButtonElement;
    btn.click();
    expect(onAdd).toHaveBeenCalled();
  });
});

describe("renderPhotoGallery — con fotos ZIP", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("header muestra count total + hint + botón", () => {
    const c = setup();
    renderPhotoGallery(c, {
      unit: makeUnit({
        photos: [
          { fname: "a.jpg", col: "Foto 1", group: "Grupo A" },
          { fname: "b.jpg", col: "Foto 2", group: "Grupo A" },
        ],
      }),
      hasZip: true,
    });
    expect(c.querySelector(".pg-count")?.textContent).toBe("2 fotos");
    expect(c.querySelector(".pg-hint")?.textContent).toContain("clic para ampliar");
  });

  it("agrupa fotos por group", () => {
    const c = setup();
    renderPhotoGallery(c, {
      unit: makeUnit({
        photos: [
          { fname: "1.jpg", col: "c1", group: "A" },
          { fname: "2.jpg", col: "c2", group: "A" },
          { fname: "3.jpg", col: "c3", group: "B" },
        ],
      }),
      hasZip: true,
    });
    const titles = [...c.querySelectorAll(".pgcat-title")].map((t) => t.textContent?.trim());
    expect(titles).toContain("A");
    expect(titles).toContain("B");
    expect(c.querySelectorAll(".pgitem").length).toBe(3);
  });

  it("thumb con data-src para lazy + label short", () => {
    const c = setup();
    renderPhotoGallery(c, {
      unit: makeUnit({
        photos: [{ fname: "motor.jpg", col: "Foto del motor", group: "Motor" }],
      }),
      hasZip: true,
    });
    const img = c.querySelector("img") as HTMLImageElement;
    expect(img.dataset.src).toBe("motor.jpg");
    expect(img.className).toContain("lazy-img");
    expect(c.querySelector(".pglbl")?.textContent).toBe("motor"); // shortLbl aplicado
  });

  it("click thumb abre lightbox con items correctos", () => {
    const c = setup();
    const lb = createLightbox({ resolveUrl: (fn) => `blob:${fn}` });
    const openSpy = vi.spyOn(lb, "open");
    renderPhotoGallery(c, {
      unit: makeUnit({
        photos: [
          { fname: "a.jpg", col: "A", group: "G" },
          { fname: "b.jpg", col: "B", group: "G" },
        ],
      }),
      hasZip: true,
      lightbox: lb,
    });
    const thumb = c.querySelectorAll(".pgitem")[1] as HTMLElement;
    thumb.click();
    expect(openSpy).toHaveBeenCalledWith(expect.any(Array), 1);
    expect(openSpy.mock.calls[0][0]).toHaveLength(2);
    lb.destroy();
  });

  it("lazyObserver invocado para cada thumb", () => {
    const c = setup();
    const observe = vi.fn();
    const fakeObs = { observe, unobserve: vi.fn(), disconnect: vi.fn() } as unknown as IntersectionObserver;
    renderPhotoGallery(c, {
      unit: makeUnit({
        photos: [
          { fname: "a.jpg", col: "A", group: "G" },
          { fname: "b.jpg", col: "B", group: "G" },
        ],
      }),
      hasZip: true,
      lazyObserver: fakeObs,
    });
    expect(observe).toHaveBeenCalledTimes(2);
  });
});

describe("renderPhotoGallery — fotos manuales", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  const fakeManual: ManualPhoto[] = [
    { id: "m1", fname: "manual-1.jpg", label: "Manual 1", data: new Uint8Array([1, 2, 3]) },
    { id: "m2", fname: "manual-2.jpg", label: "Manual 2", data: new Uint8Array([4, 5, 6]) },
  ];

  it("sección 'Fotos manuales' aparece con icon camera", () => {
    const c = setup();
    renderPhotoGallery(c, {
      unit: makeUnit(),
      manualPhotos: fakeManual,
      hasZip: true,
      resolveManualUrl: () => "blob:manual",
    });
    const titles = [...c.querySelectorAll(".pgcat-title")].map((t) => t.textContent?.trim());
    expect(titles.some((t) => t?.includes("Fotos manuales"))).toBe(true);
  });

  it("resolveManualUrl usado para src de img", () => {
    const c = setup();
    renderPhotoGallery(c, {
      unit: makeUnit(),
      manualPhotos: [fakeManual[0]],
      hasZip: true,
      resolveManualUrl: (p) => `blob:resolved-${p.id}`,
    });
    const img = c.querySelector(".pgitem img") as HTMLImageElement;
    expect(img.src).toContain("resolved-m1");
  });

  it("botón ✕ dispara onDeleteManualPhoto y NO propaga (no abre lightbox)", () => {
    const c = setup();
    const onDelete = vi.fn();
    const openSpy = vi.fn();
    const fakeLb = { open: openSpy, close: vi.fn(), next: vi.fn(), prev: vi.fn(), destroy: vi.fn() };
    renderPhotoGallery(c, {
      unit: makeUnit(),
      manualPhotos: [fakeManual[0]],
      hasZip: true,
      resolveManualUrl: () => "blob:x",
      onDeleteManualPhoto: onDelete,
      lightbox: fakeLb,
    });
    const delBtn = [...c.querySelectorAll(".pgitem button")].find(
      (b) => b.textContent === "✕",
    ) as HTMLButtonElement;
    delBtn.click();
    expect(onDelete).toHaveBeenCalledWith("u1", "m1");
    expect(openSpy).not.toHaveBeenCalled(); // stopPropagation funcionó
  });

  it("indices de lightbox coherentes: ZIP photos primero, luego manuales", () => {
    const c = setup();
    const lb = createLightbox();
    const openSpy = vi.spyOn(lb, "open");
    renderPhotoGallery(c, {
      unit: makeUnit({
        photos: [{ fname: "z1.jpg", col: "Z1", group: "G" }],
      }),
      manualPhotos: [fakeManual[0]],
      hasZip: true,
      lightbox: lb,
      resolveManualUrl: () => "blob:x",
    });
    const manualThumb = [...c.querySelectorAll(".pgitem")].find((i) =>
      i.textContent?.includes("Manual 1"),
    ) as HTMLElement;
    manualThumb.click();
    expect(openSpy).toHaveBeenCalledWith(expect.any(Array), 1); // index 1 = segundo (manual)
    const items = openSpy.mock.calls[0][0];
    expect(items[0].label).toBe("Z1");
    expect(items[1].label).toBe("Manual 1");
    lb.destroy();
  });
});

describe("renderPhotoGallery — re-render + edge cases", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("re-render reemplaza contenido", () => {
    const c = setup();
    renderPhotoGallery(c, { unit: makeUnit(), hasZip: false });
    expect(c.textContent).toContain("Sin fotos disponibles");
    renderPhotoGallery(c, {
      unit: makeUnit({
        photos: [{ fname: "a.jpg", col: "A", group: "G" }],
      }),
      hasZip: true,
    });
    expect(c.querySelectorAll(".pgitem")).toHaveLength(1);
    expect(c.textContent).not.toContain("Sin fotos disponibles");
  });

  it("sin lightbox: click thumb no revienta", () => {
    const c = setup();
    renderPhotoGallery(c, {
      unit: makeUnit({
        photos: [{ fname: "a.jpg", col: "A", group: "G" }],
      }),
      hasZip: true,
    });
    const thumb = c.querySelector(".pgitem") as HTMLElement;
    expect(() => thumb.click()).not.toThrow();
  });
});
