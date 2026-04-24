// PDF engine — wrapper delgado sobre jsPDF@4 para reusar desde los módulos
// de reporte (unit, fleet, semanal). Reemplaza las llamadas inline a
// `new jsPDF(...)` del legado.
//
// Dos paths de instanciación soportados:
//   1. Vite/ESM: `import { jsPDF } from "jspdf"` (preferido).
//   2. Legacy CDN: `window.jspdf.jsPDF` (fallback si el módulo npm no está).
//
// En tests corremos bajo happy-dom SIN jspdf global; usamos el import ESM.

import { jsPDF } from "jspdf";

export type PageSize = { w: number; h: number };
export type Orientation = "portrait" | "landscape";

export const A4: PageSize = { w: 210, h: 297 };
export const LETTER: PageSize = { w: 216, h: 279 };

export type PdfDocOptions = {
  orientation?: Orientation;
  size?: PageSize;
  margin?: number;
  /** Header callback llamado en cada `addPage` después de la primera. */
  onNewPage?: (doc: PdfDoc) => void;
};

/**
 * Paleta PDF — hex literales Tremor (sync con :root en src/styles/main.css).
 * jsPDF no acepta CSS vars — siempre hex literal. PDF printable = always light.
 *
 * Si Tremor cambia en main.css, actualizar aquí manual. No usar runtime
 * getComputedStyle() porque jsPDF 4.x es strict con formatos y el overhead
 * de resolución no vale.
 */
export const PDF_COLORS = {
  R: "#E11D48", // rose-600
  A: "#D97706", // amber-600
  G: "#059669", // emerald-600
  B: "#1D4ED8", // blue-700 (secondary)
  O: "#EA580C", // orange-600
  T: "#2563EB", // blue-600 primary
  T2: "#1D4ED8", // blue-700 hover
  bg: "#FFFFFF",
  bg2: "#EFF1F5",
  bg3: "#E8EAF0",
  ln: "#E5E6EB",
  s1: "#475569",
  s2: "#64748B",
  s3: "#6B7280",
  w1: "#0F172A",
  w2: "#1E293B",
  // Tints opacos (Tremor color-200/50)
  Rl: "#FECDD3",
  Rd: "#FFF1F2",
  Al: "#FDE68A",
  Ad: "#FFFBEB",
  Gl: "#A7F3D0",
  Gd: "#ECFDF5",
  Bl: "#BFDBFE",
  Bd: "#EFF6FF",
  Ol: "#FED7AA",
  Od: "#FFF7ED",
} as const;

/**
 * Wrapper con API ergonómica. Mantiene cursor `y`, maneja paginación auto,
 * y expone helpers de dibujo comunes. Para flujos avanzados, `.raw` devuelve
 * la instancia jsPDF subyacente.
 */
export class PdfDoc {
  public raw: jsPDF;
  public y: number;
  public readonly size: PageSize;
  public readonly margin: number;
  private readonly onNewPage?: (doc: PdfDoc) => void;

  constructor(opts: PdfDocOptions = {}) {
    const { orientation = "portrait", size = A4, margin = 14, onNewPage } = opts;
    this.size = orientation === "portrait" ? size : { w: size.h, h: size.w };
    this.margin = margin;
    this.onNewPage = onNewPage;
    try {
      this.raw = new jsPDF({ orientation, unit: "mm", format: [this.size.w, this.size.h] });
    } catch (err) {
      throw new Error(
        `jsPDF init falló — revisa que la librería esté cargada (./vendor/jspdf.umd.min.js). Causa: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    this.y = margin;
  }

  /** Ancho disponible (w - 2*margen). */
  get contentWidth(): number {
    return this.size.w - this.margin * 2;
  }

  /** Altura útil considerando margen inferior. */
  get contentBottom(): number {
    return this.size.h - this.margin;
  }

  /** Agrega página si el cursor + `need` excede el área útil. */
  ensureSpace(need = 10): boolean {
    if (this.y + need > this.contentBottom) {
      this.addPage();
      return true;
    }
    return false;
  }

  /** Nueva página; resetea cursor y dispara `onNewPage`. */
  addPage(): void {
    this.raw.addPage();
    this.y = this.margin;
    this.onNewPage?.(this);
  }

  /** Línea simple entre dos puntos con color/grosor opcional. */
  line(x1: number, y1: number, x2: number, y2: number, color = PDF_COLORS.ln, width = 0.3): void {
    this.raw.setDrawColor(color);
    this.raw.setLineWidth(width);
    this.raw.line(x1, y1, x2, y2);
  }

  /** Rectángulo con fill/stroke opcionales. */
  rect(x: number, y: number, w: number, h: number, fill?: string, stroke?: string): void {
    if (fill) {
      this.raw.setFillColor(fill);
      this.raw.rect(x, y, w, h, "F");
    }
    if (stroke) {
      this.raw.setDrawColor(stroke);
      this.raw.setLineWidth(0.3);
      this.raw.rect(x, y, w, h, "S");
    }
  }

  /** Rectángulo con esquinas redondeadas. */
  roundedRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    fill?: string,
    stroke?: string,
  ): void {
    if (fill) {
      this.raw.setFillColor(fill);
      this.raw.roundedRect(x, y, w, h, r, r, "F");
    }
    if (stroke) {
      this.raw.setDrawColor(stroke);
      this.raw.setLineWidth(0.3);
      this.raw.roundedRect(x, y, w, h, r, r, "S");
    }
  }

  /**
   * Texto con opciones ergonómicas. `size` en puntos, `color` hex, `bold` usa
   * la variante del font actual. Devuelve `y` avanzado si `advance` > 0.
   */
  text(
    str: string,
    x: number,
    y: number,
    opts: {
      size?: number;
      color?: string;
      bold?: boolean;
      align?: "left" | "center" | "right";
      maxWidth?: number;
      advance?: number;
    } = {},
  ): void {
    const { size = 10, color = PDF_COLORS.w1, bold = false, align = "left", maxWidth, advance = 0 } = opts;
    this.raw.setFontSize(size);
    this.raw.setTextColor(color);
    this.raw.setFont("helvetica", bold ? "bold" : "normal");
    const args: Parameters<jsPDF["text"]> = [str, x, y];
    if (maxWidth || align !== "left") {
      args[3] = { align, maxWidth };
    }
    this.raw.text(...args);
    if (advance > 0) this.y = y + advance;
  }

  /**
   * Texto multilínea con wrap automático al ancho dado. Avanza `y` por la
   * altura del bloque y pagina si es necesario. Devuelve y final.
   */
  textBlock(
    str: string,
    opts: {
      x?: number;
      width?: number;
      size?: number;
      color?: string;
      bold?: boolean;
      lineHeight?: number;
    } = {},
  ): number {
    const { x = this.margin, width = this.contentWidth, size = 10, color = PDF_COLORS.w1, bold = false, lineHeight = size * 0.45 } = opts;
    this.raw.setFontSize(size);
    this.raw.setTextColor(color);
    this.raw.setFont("helvetica", bold ? "bold" : "normal");
    const lines = this.raw.splitTextToSize(str, width) as string[];
    for (const ln of lines) {
      this.ensureSpace(lineHeight + 1);
      this.raw.text(ln, x, this.y);
      this.y += lineHeight;
    }
    return this.y;
  }

  /** Pill colorido (badge de riesgo). */
  pill(
    label: string,
    x: number,
    y: number,
    color: string,
    opts: { fontSize?: number; paddingX?: number; paddingY?: number } = {},
  ): number {
    const { fontSize = 8, paddingX = 3, paddingY = 1.5 } = opts;
    this.raw.setFontSize(fontSize);
    this.raw.setFont("helvetica", "bold");
    const tw = this.raw.getTextWidth(label);
    const bw = tw + paddingX * 2;
    const bh = fontSize * 0.35 + paddingY * 2;
    this.raw.setFillColor(color);
    this.raw.roundedRect(x, y, bw, bh, 1, 1, "F");
    this.raw.setTextColor("#FFFFFF");
    this.raw.text(label, x + paddingX, y + bh - paddingY - 0.5);
    return bw; // ancho del pill para chaining
  }

  /** Número de páginas actuales. */
  pageCount(): number {
    return this.raw.internal.pages.length - 1; // array 1-indexed
  }

  /** Descarga via browser (file.pdf o nombre dado). */
  save(filename = "reporte.pdf"): void {
    this.raw.save(filename);
  }

  /** Devuelve el PDF como `Blob` (útil para preview o upload). */
  toBlob(): Blob {
    return this.raw.output("blob") as Blob;
  }

  /** Devuelve el PDF como `Uint8Array` (útil para tests o stream). */
  toBytes(): Uint8Array {
    const arr = this.raw.output("arraybuffer") as ArrayBuffer;
    return new Uint8Array(arr);
  }
}

/** Color del pill según RiskLevel — atajo para integración con analyzer. */
export function riskColor(risk: "Urgente" | "Revisar" | "Completar" | "OK"): string {
  return risk === "Urgente"
    ? PDF_COLORS.R
    : risk === "Revisar"
      ? PDF_COLORS.A
      : risk === "Completar"
        ? PDF_COLORS.B
        : PDF_COLORS.G;
}
