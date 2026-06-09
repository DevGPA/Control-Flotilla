// unitReport — genera PDF ejecutivo de una sola unidad.
// Reemplazo progresivo de `exportPDF()` del legado (línea ~3075). Esta
// versión cubre el layout esencial (header + identificación + risk + findings
// + tires); sections avanzadas (fotos, notas, historial) son iteraciones
// futuras. Por ahora coexiste con legado via feature flag.

import { PdfDoc, PDF_COLORS, riskColor } from "./engine";
import { isFindingDone } from "../analyzer/findingKey";
import type { Unit, ChecklistDB } from "../types";

export type UnitReportOptions = {
  /** Timestamp a mostrar en el header (default: now). */
  generatedAt?: Date;
  /** Título del reporte (default: "Reporte de Inspección"). */
  title?: string;
  /** Subtítulo bajo el header (e.g. "GPA Tesorería"). */
  subtitle?: string;
  /** DB de tareas cerradas para descontar findings. */
  checklistDB?: ChecklistDB;
};

export function buildUnitReport(unit: Unit, opts: UnitReportOptions = {}): PdfDoc {
  const {
    generatedAt = new Date(),
    title = "Reporte de Inspección",
    subtitle = "GPA — Control de Flotilla",
    checklistDB = {},
  } = opts;

  const doc = new PdfDoc({
    orientation: "portrait",
    onNewPage: drawPageHeader,
  });

  drawPageHeader(doc);

  // ── Identificación de la unidad ──────────────────────────────────────
  const idBlockY = doc.y;
  doc.rect(doc.margin, idBlockY, doc.contentWidth, 28, PDF_COLORS.bg2, PDF_COLORS.ln);

  doc.text(unit.eco || unit.plate || "—", doc.margin + 6, idBlockY + 10, {
    size: 18,
    bold: true,
    color: PDF_COLORS.w1,
  });
  doc.text(unit.brand || "Unidad sin marca", doc.margin + 6, idBlockY + 18, {
    size: 10,
    color: PDF_COLORS.s1,
  });
  doc.text(
    [unit.eco ? unit.plate : "", unit.branch, unit.insp ? `Inspector: ${unit.insp}` : ""]
      .filter(Boolean)
      .join("  ·  "),
    doc.margin + 6,
    idBlockY + 25,
    { size: 8, color: PDF_COLORS.s2 },
  );

  // Risk pill en la esquina derecha
  const pillX = doc.margin + doc.contentWidth - 40;
  doc.pill(unit.risk.toUpperCase(), pillX, idBlockY + 6, riskColor(unit.risk), { fontSize: 9 });

  doc.y = idBlockY + 34;

  // ── Metadata adicional ────────────────────────────────────────────────
  doc.ensureSpace(30);
  doc.text("DATOS", doc.margin, doc.y, { size: 7, bold: true, color: PDF_COLORS.s1 });
  doc.y += 5;
  doc.line(doc.margin, doc.y, doc.margin + doc.contentWidth, doc.y);
  doc.y += 4;

  // Kilometraje: km es number|string; un string no numérico ("N/A", "12,345")
  // produce Number(...) = NaN y "NaN km" en el reporte. Validar finitud.
  const kmNum = Number(unit.km);
  const kmStr =
    unit.km !== undefined && unit.km !== "" && Number.isFinite(kmNum)
      ? `${kmNum.toLocaleString("es-MX")} km`
      : "—";

  const rows: Array<[string, string]> = [
    ["Fecha de inspección", unit.fecha || "—"],
    ["Sucursal", unit.branch || "—"],
    ["Kilometraje", kmStr],
    ["Próximo servicio", unit.nextSvc || "—"],
    [
      "Llanta mínima (TACO)",
      unit.minT !== null && Number.isFinite(unit.minT) ? `${unit.minT} mm` : "—",
    ],
    ["Refacción disponible", unit.hasRefaccion === false ? "NO" : "Sí"],
  ];
  for (const [label, value] of rows) {
    doc.ensureSpace(6);
    doc.text(label, doc.margin, doc.y, { size: 9, color: PDF_COLORS.s1 });
    doc.text(value, doc.margin + 60, doc.y, { size: 9, color: PDF_COLORS.w1 });
    doc.y += 5;
  }

  // ── Hallazgos pendientes ──────────────────────────────────────────────
  doc.y += 4;
  doc.ensureSpace(20);
  doc.text("HALLAZGOS", doc.margin, doc.y, { size: 7, bold: true, color: PDF_COLORS.s1 });
  doc.y += 5;
  doc.line(doc.margin, doc.y, doc.margin + doc.contentWidth, doc.y);
  doc.y += 4;

  const dm = checklistDB[unit.uid] || {};
  const pending = unit.F.filter((f) => !isFindingDone(dm, f, unit.fecha));
  if (pending.length === 0) {
    doc.text("Sin hallazgos pendientes. Unidad operativa.", doc.margin, doc.y, {
      size: 9,
      color: PDF_COLORS.G,
    });
    doc.y += 6;
  } else {
    for (const f of pending) {
      doc.ensureSpace(7);
      doc.pill(f.lv.toUpperCase(), doc.margin, doc.y - 1, riskColor(f.lv), { fontSize: 6 });
      doc.text(f.text, doc.margin + 18, doc.y + 3, { size: 9, color: PDF_COLORS.w1 });
      doc.text(f.cat, doc.margin + doc.contentWidth - 30, doc.y + 3, {
        size: 8,
        color: PDF_COLORS.s2,
      });
      doc.y += 6;
    }
  }

  // ── Observaciones del responsable ─────────────────────────────────────
  if (unit.obs) {
    doc.y += 4;
    doc.ensureSpace(20);
    doc.text("OBSERVACIONES", doc.margin, doc.y, { size: 7, bold: true, color: PDF_COLORS.s1 });
    doc.y += 5;
    doc.line(doc.margin, doc.y, doc.margin + doc.contentWidth, doc.y);
    doc.y += 4;
    const arr = unit.obsArr && unit.obsArr.length ? unit.obsArr : [unit.obs];
    for (const t of arr) {
      doc.textBlock(t, { size: 9, color: PDF_COLORS.w2, lineHeight: 4.5 });
      doc.y += 2;
    }
  }

  // ── Footer con timestamp ──────────────────────────────────────────────
  drawFooter(doc, generatedAt);

  return doc;

  function drawPageHeader(d: PdfDoc) {
    d.rect(0, 0, d.size.w, 18, PDF_COLORS.T);
    d.text(title, d.margin, 10, { size: 14, bold: true, color: PDF_COLORS.bg });
    d.text(subtitle, d.margin, 15, { size: 8, color: PDF_COLORS.Bl });
    d.y = 24;
  }
}

function drawFooter(doc: PdfDoc, generatedAt: Date): void {
  const total = doc.pageCount();
  for (let i = 1; i <= total; i++) {
    doc.raw.setPage(i);
    doc.raw.setFontSize(7);
    doc.raw.setTextColor(PDF_COLORS.s2);
    doc.raw.text(`Generado ${generatedAt.toLocaleString("es-MX")}`, doc.margin, doc.size.h - 6);
    doc.raw.text(`Página ${i} de ${total}`, doc.size.w - doc.margin - 25, doc.size.h - 6);
  }
}
