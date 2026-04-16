export function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escAttr(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/'/g, "&#39;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

type Primitive = string | number | boolean | null | undefined;
type Raw = { __raw: string };

export const raw = (html: string): Raw => ({ __raw: html });

export function safeHTML(
  strings: TemplateStringsArray,
  ...values: Array<Primitive | Raw | Array<Primitive | Raw>>
): string {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    let piece: string;
    if (v == null) piece = "";
    else if (Array.isArray(v)) piece = v.map((x) => (isRaw(x) ? x.__raw : escHtml(x))).join("");
    else if (isRaw(v)) piece = v.__raw;
    else piece = escHtml(v);
    out += piece + strings[i + 1];
  }
  return out;
}

function isRaw(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && "__raw" in (v as Record<string, unknown>);
}

export function setSafeText(el: Element | null, text: unknown): void {
  if (el) el.textContent = String(text ?? "");
}
