// Genera tests/fixtures/mensual.xlsx sintético para la suite e2e.
//
// El fixture real está gitignored (datos de flota GPA); este script produce uno
// equivalente en SHAPE (mismas columnas que consume loadWB/analyzeRow del monolito)
// con datos inventados, para que los e2e corran en cualquier máquina.
//
// Uso: node scripts/gen-fixture-mensual.mjs
import * as XLSX from "xlsx";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../tests/fixtures/mensual.xlsx");

const SUCURSALES = ["Guadalajara", "Monterrey", "Ciudad de Mexico", "Cancun", "Vallarta"];
const MARCAS = ["Aumark S6", "Ram 4000", "F-350", "Manager Furgon", "Aumark TM3"];
const INSPECTORES = ["PEREZ LOPEZ JUAN", "GOMEZ RUIZ ANA", "TORRES DIAZ LUIS"];

// Estados objetivo por unidad (analyzeRow): TACO <=3.99 → Urgente; 4-6.99 → Revisar;
// >=7 → OK; "Cuenta con llanta de Refacción?"=No → Completar (sin otro hallazgo).
const UNIDADES = Array.from({ length: 20 }, (_, i) => {
  const n = i + 1;
  const estado = n % 5 === 0 ? "urgente" : n % 4 === 0 ? "revisar" : n % 7 === 0 ? "sinref" : "ok";
  const taco = estado === "urgente" ? 2 : estado === "revisar" ? 5 : 8;
  return {
    "# Economico - id": String(n),
    "# Economico - PLACAS": `TST${String(n).padStart(3, "0")}A`,
    "# Economico - SUBMARCA": MARCAS[i % MARCAS.length],
    "# Economico - SUCURSAL": SUCURSALES[i % SUCURSALES.length],
    "# Economico - RESPONSABLE": "Logística",
    "Nombre del Solicitante - RESPONSABLE": INSPECTORES[i % INSPECTORES.length],
    "Fecha y Hora": `2026-06-${String((i % 28) + 1).padStart(2, "0")} 09:30`,
    Kilometraje: 10000 + n * 731,
    "Fecha del ultimo servicio": "2026-03-15",
    "Fecha estimada del siguiente servicio": "2026-09-15",
    "Kilometraje del siguiente servicio": 10000 + n * 731 + 5000,
    "Cuenta con llanta de Refacción?": estado === "sinref" ? "No" : "Si",
    "Nivel TACO de llanta piloto delantera": taco,
    "Nivel TACO de llanta copiloto delantera": taco + 1,
    "Nivel TACO de llanta piloto trasera": 8,
    "Nivel TACO de llanta copiloto trasera": 8,
    "Reportes o Comentarios en General (solo si aplica)":
      estado === "urgente" ? "Llanta delantera muy desgastada, requiere cambio" : "",
  };
});

mkdirSync(dirname(OUT), { recursive: true });
const ws = XLSX.utils.json_to_sheet(UNIDADES);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Mensual");
// El build ESM de xlsx no cablea fs (XLSX.writeFile lanza) → generar buffer y escribirlo.
const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
writeFileSync(OUT, buf);
console.log(`fixture generado: ${OUT} (${UNIDADES.length} filas)`);
