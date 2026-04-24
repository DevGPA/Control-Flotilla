import { describe, expect, it, vi } from "vitest";
import { A4, LETTER, PDF_COLORS, PdfDoc, riskColor } from "../src/pdf/engine";

// ─── Constantes + helpers puros ────────────────────────────────────

describe("PDF constants & helpers", () => {
  it("A4 y LETTER dimensiones correctas (mm)", () => {
    expect(A4).toEqual({ w: 210, h: 297 });
    expect(LETTER).toEqual({ w: 216, h: 279 });
  });

  it("paleta PDF_COLORS alineada con main.css Tremor", () => {
    expect(PDF_COLORS.R).toBe("#E11D48");
    expect(PDF_COLORS.G).toBe("#059669");
    expect(PDF_COLORS.T).toBe("#2563EB");
  });

  it.each([
    ["Urgente", PDF_COLORS.R],
    ["Revisar", PDF_COLORS.A],
    ["Completar", PDF_COLORS.B],
    ["OK", PDF_COLORS.G],
  ] as const)("riskColor('%s') → %s", (risk, color) => {
    expect(riskColor(risk)).toBe(color);
  });
});

// ─── PdfDoc ───────────────────────────────────────────────────────

describe("PdfDoc", () => {
  it("instancia con defaults A4 portrait", () => {
    const doc = new PdfDoc();
    expect(doc.size).toEqual(A4);
    expect(doc.margin).toBe(14);
    expect(doc.contentWidth).toBe(210 - 14 * 2); // 182
    expect(doc.contentBottom).toBe(297 - 14); // 283
    expect(doc.y).toBe(14);
    expect(doc.raw).toBeDefined();
  });

  it("landscape swap w/h", () => {
    const doc = new PdfDoc({ orientation: "landscape" });
    expect(doc.size).toEqual({ w: 297, h: 210 });
  });

  it("margen custom se respeta", () => {
    const doc = new PdfDoc({ margin: 20 });
    expect(doc.margin).toBe(20);
    expect(doc.y).toBe(20);
    expect(doc.contentWidth).toBe(210 - 40);
  });

  it("LETTER format", () => {
    const doc = new PdfDoc({ size: LETTER });
    expect(doc.size).toEqual(LETTER);
  });

  it("ensureSpace agrega página cuando `need` excede bottom", () => {
    const doc = new PdfDoc();
    doc.y = 280;
    const added = doc.ensureSpace(20); // 280 + 20 > 283
    expect(added).toBe(true);
    expect(doc.pageCount()).toBe(2);
    expect(doc.y).toBe(doc.margin);
  });

  it("ensureSpace NO pagina cuando hay espacio", () => {
    const doc = new PdfDoc();
    doc.y = 100;
    const added = doc.ensureSpace(50);
    expect(added).toBe(false);
    expect(doc.pageCount()).toBe(1);
    expect(doc.y).toBe(100);
  });

  it("addPage dispara onNewPage callback", () => {
    const onNewPage = vi.fn();
    const doc = new PdfDoc({ onNewPage });
    doc.addPage();
    expect(onNewPage).toHaveBeenCalledTimes(1);
    expect(onNewPage).toHaveBeenCalledWith(doc);
    doc.addPage();
    expect(onNewPage).toHaveBeenCalledTimes(2);
  });

  it("text con advance avanza cursor y", () => {
    const doc = new PdfDoc();
    const startY = doc.y;
    doc.text("hola", 10, 20, { advance: 8 });
    expect(doc.y).toBe(20 + 8);
    expect(doc.y).not.toBe(startY);
  });

  it("textBlock wrap + paginación automática", () => {
    const doc = new PdfDoc();
    doc.y = 270; // cerca del final de la página
    const longText = Array(30).fill("texto largo que debería hacer wrap y paginar").join(" ");
    doc.textBlock(longText, { lineHeight: 5 });
    expect(doc.pageCount()).toBeGreaterThan(1);
  });

  it("pill retorna ancho del badge", () => {
    const doc = new PdfDoc();
    const w = doc.pill("URGENTE", 10, 20, PDF_COLORS.R);
    expect(typeof w).toBe("number");
    expect(w).toBeGreaterThan(0);
  });

  it("line no revienta y afecta page state", () => {
    const doc = new PdfDoc();
    expect(() => doc.line(10, 10, 100, 10)).not.toThrow();
  });

  it("rect con fill y stroke", () => {
    const doc = new PdfDoc();
    expect(() => doc.rect(10, 10, 50, 20, PDF_COLORS.bg2, PDF_COLORS.ln)).not.toThrow();
  });

  it("roundedRect", () => {
    const doc = new PdfDoc();
    expect(() => doc.roundedRect(10, 10, 50, 20, 2, PDF_COLORS.bg2)).not.toThrow();
  });

  it("toBlob devuelve Blob con tipo pdf", () => {
    const doc = new PdfDoc();
    doc.text("test", 10, 20);
    const blob = doc.toBlob();
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toMatch(/pdf/i);
  });

  it("toBytes devuelve Uint8Array no vacío", () => {
    const doc = new PdfDoc();
    doc.text("test", 10, 20);
    const bytes = doc.toBytes();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    // PDF magic: "%PDF-"
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("pageCount refleja páginas añadidas", () => {
    const doc = new PdfDoc();
    expect(doc.pageCount()).toBe(1);
    doc.addPage();
    expect(doc.pageCount()).toBe(2);
    doc.addPage();
    expect(doc.pageCount()).toBe(3);
  });
});
