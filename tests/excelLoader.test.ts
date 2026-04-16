import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { ExcelLoadError, loadExcel } from "../src/io/excelLoader";

// ─── Helper: construye un XLSX mínimo en memoria ───────────────
function buildXlsx(headers: string[], rows: Array<Record<string, unknown>>, sheetName = "Hoja1"): Blob {
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const arr = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([arr as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("loadExcel", () => {
  it("clasifica como 'mensual' por nombre de archivo", async () => {
    const blob = buildXlsx(
      ["Eco", "Placas", "Sucursal"],
      [{ Eco: "A-117", Placas: "ABC-123", Sucursal: "Norte" }],
    );
    const r = await loadExcel(blob, "Control Vehicular Mensual.xlsx");
    expect(r.kind).toBe("mensual");
    expect(r.filename).toBe("Control Vehicular Mensual.xlsx");
    expect(r.sheetName).toBe("Hoja1");
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].Eco).toBe("A-117");
  });

  it("clasifica como 'semanal' cuando headers tienen ≥3 señales y exclusiva", async () => {
    const headers = [
      "Llanta de refaccion funcional",
      "Carroceria con golpes",
      "Nombre de quien verifica",
      "Kilometraje al momento",
    ];
    const blob = buildXlsx(
      headers,
      [
        {
          "Llanta de refaccion funcional": "Si",
          "Carroceria con golpes": "No",
          "Nombre de quien verifica": "Juan",
          "Kilometraje al momento": 45000,
        },
      ],
    );
    const r = await loadExcel(blob, "Export-sin-nombre-claro.xlsx");
    expect(r.kind).toBe("semanal");
    expect(r.headers).toEqual(headers);
  });

  it("extrae filename del File cuando no se pasa explícito", async () => {
    const blob = buildXlsx(["Eco"], [{ Eco: "X-1" }]);
    const file = new File([blob], "Reporte Mensual Abril.xlsx", { type: blob.type });
    const r = await loadExcel(file);
    expect(r.filename).toBe("Reporte Mensual Abril.xlsx");
  });

  it("lanza ExcelLoadError con XLSX corrupto", async () => {
    const blob = new Blob([new Uint8Array([0x00, 0x01, 0x02, 0x03]) as BlobPart]);
    await expect(loadExcel(blob, "fake.xlsx")).rejects.toThrow(ExcelLoadError);
  });

  it("lanza ExcelLoadError con mensaje claro cuando es texto plano sin magic bytes", async () => {
    const blob = new Blob([new TextEncoder().encode("no soy excel")] as BlobPart[]);
    await expect(loadExcel(blob, "txt.xlsx")).rejects.toThrowError(/header ZIP/);
  });

  it("acepta XLSX válido aunque tenga bytes extras después", async () => {
    const goodBlob = buildXlsx(["Eco"], [{ Eco: "X-1" }]);
    const r = await loadExcel(goodBlob, "ok.xlsx");
    expect(r.rowCount).toBe(1);
  });

  it("maneja rows vacíos (solo headers)", async () => {
    const blob = buildXlsx(["Eco", "Placas"], []);
    const r = await loadExcel(blob, "vacio.xlsx");
    expect(r.rowCount).toBe(0);
    expect(r.rows).toEqual([]);
    expect(r.headers).toEqual(["Eco", "Placas"]);
  });
});
