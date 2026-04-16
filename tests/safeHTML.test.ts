import { describe, expect, it } from "vitest";
import { escAttr, escHtml, raw, safeHTML } from "../src/dom/safeHTML";

describe("escHtml", () => {
  it("escapa caracteres peligrosos", () => {
    expect(escHtml('<img src="x" onerror=alert(1)>')).toBe(
      "&lt;img src=&quot;x&quot; onerror=alert(1)&gt;",
    );
  });
  it("maneja null/undefined", () => {
    expect(escHtml(null)).toBe("");
    expect(escHtml(undefined)).toBe("");
  });
});

describe("escAttr", () => {
  it("escapa comillas simples también", () => {
    expect(escAttr("a'b\"c<d>")).toBe("a&#39;b&quot;c&lt;d&gt;");
  });
});

describe("safeHTML", () => {
  it("escapa interpolaciones por defecto", () => {
    const payload = '<script>alert(1)</script>';
    const out = safeHTML`<div>${payload}</div>`;
    expect(out).toBe("<div>&lt;script&gt;alert(1)&lt;/script&gt;</div>");
  });

  it("raw() inserta HTML sin escapar", () => {
    const out = safeHTML`<div>${raw("<b>bold</b>")}</div>`;
    expect(out).toBe("<div><b>bold</b></div>");
  });

  it("arrays se concatenan con escapado por elemento", () => {
    const items = ["<a>", "<b>"];
    const out = safeHTML`${items}`;
    expect(out).toBe("&lt;a&gt;&lt;b&gt;");
  });
});
