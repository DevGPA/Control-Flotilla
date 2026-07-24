/**
 * Mapeo del checklist MENSUAL de MoreApp → fila con las columnas Excel que espera
 * `analyzeRow` (el clasificador canónico). Extraído del webhook (handler.ts) para
 * que sea puro y testeable — mismo patrón que src/opsgpa/ con su receptor.
 *
 * ⚠ Los dataNames los GENERA MoreApp desde la etiqueta del campo y CAMBIAN si el
 * campo se edita/recrea en el editor de formularios (les añade sufijo numérico).
 * Bug jun-jul 2026: los 3 campos de TACO de internas/refacción se renombraron con
 * sufijo "1" y el mapa solo conocía los nombres viejos → analyzeRow omitía esas
 * llantas EN SILENCIO (feb-may bien, jul 0 de 40; verificado contra un envío real
 * del 6-jul vía la API de MoreApp). Por eso: (a) el mapa acepta AMBOS nombres —
 * el nuevo va después para ganar si coexistieran; (b) `dataNamesLlantaNoMapeados`
 * permite al webhook avisar en CloudWatch cuando aparezca un rename futuro.
 * Precedente del mismo modo de falla: `cuentaConLlantaDeRefaccin` (semanal).
 */
import type { ExcelRow } from "../types";

// dataName (MoreApp) → nombre de columna Excel que espera analyzeRow.
export const FIELD_MAP: Record<string, string> = {
  kilometraje: "Kilometraje",
  kilometrajeDelSiguienteServicio: "Kilometraje del siguiente servicio",
  fechaEstimadaDelSiguienteServicio: "Fecha estimada del siguiente servicio",
  nivelTACODeLlantaPilotoDelantera: "Nivel TACO de llanta piloto delantera",
  nivelTACODeLlantaCopilotoDelantera: "Nivel TACO de llanta copiloto delantera",
  nivelTACODeLlantaPilotoTrasera: "Nivel TACO de llanta piloto trasera",
  nivelTACODeLlantaPilotoTraseraINTERNA: "Nivel TACO de llanta piloto trasera INTERNA",
  nivelTACODeLlantaCopilotoTrasera: "Nivel TACO de llanta copiloto trasera",
  nivelTACODeLlantaCopilotoTraseraINTERNA: "Nivel TACO de llanta copiloto trasera INTERNA",
  nivelTACODeLlantaREFACCION: "Nivel TACO de llanta REFACCION",
  // Renames de MoreApp (jun-2026, sufijo "1") — DESPUÉS de los viejos: si un envío
  // trajera ambos, el campo vigente del formulario (el renombrado) gana.
  nivelTACODeLlantaPilotoTraseraINTERNA1: "Nivel TACO de llanta piloto trasera INTERNA",
  nivelTACODeLlantaCopilotoTraseraINTERNA1: "Nivel TACO de llanta copiloto trasera INTERNA",
  nivelTACODeLlantaREFACCION1: "Nivel TACO de llanta REFACCION",
  cuentaConLlantaDeRefaccin: "Cuenta con llanta de Refacción?",
  cuentaConLlantaPilotoTraseraINTERNA: "¿Cuenta con Llanta Piloto trasera INTERNA?",
  cuentaConLlantaCopilotoTraseraINTERNA: "¿Cuenta con Llanta Copiloto trasera INTERNA?",
  lucesYCuartosDelanterosFuncionando: "Luces y cuartos delanteros funcionando",
  cinturonesDeSeguridadFuncionandoTodos: "Cinturones de seguridad funcionando (todos)",
  carroceriaSinGolpesORaspaduras: "Carroceria con golpes o raspaduras",
  espejosLateralesEnBuenEstado: "Espejos laterales en buen estado",
  cristalesEnBuenasCondiciones: "Cristales en buenas condiciones",
  taponDeLaGasolina: "Tapon de la gasolina",
  bocinaDelClaxonFuncionando: "Bocina del claxon funcionando",
  limpiaParaBrisasFuncionandoCorrectamente: "Limpia parabrisas funcionando correctamente",
  tacometroEnBuenasCondiciones: "Tacometro en buenas condiciones",
  espejoRetrovisorEnBuenasCondiciones: "Espejo retrovisor en buenas condiciones",
  lucesInterioresFuncionando: "Luces interiores funcionando",
  asientosEnBuenEstado: "Asientos en buen estado",
  tapetesCompletos: "Tapetes completos",
  gatoAdecuadoParaElVehiculoYSuPalanca: "Gato adecuado para el vehiculo y su palanca",
  llaveDeCruzOPalancaAcordeALosBirlosDeLasLlantas:
    "Llave de cruz o palanca acorde a los birlos de las llantas",
  trianguloDeSeguridad: "Triangulo de seguridad",
  cablesPasaCorriente: "Cables pasa corriente",
  nivelDeLiquidoDeFrenosMax: "Nivel de liquido de frenos max",
  nivelDeAceiteDeMotorMax: "Nivel de aceite de motor max",
  nivelDeLiquidoDeRadiadorMax: "Nivel de liquido de radiador max",
  nivelDeAceiteDeDireccionMax: "Nivel de aceite de direccion max",
  licenciaDeChoferAcordeAVehiculoVigente: 'Licencia de "chofer" acorde a vehiculo vigente',
  tarjetaDeCirculacionVigente: "Tarjeta de circulacion vigente",
  polizaDeSeguroVigente: "Poliza de seguro vigente",
  calcomoniaDeRefrendoVehicular: "Calcomonia de refrendo vehicular",
  tarjetacalcamoniaDeVerificacionAmbientalVigente:
    "Tarjeta/calcamonia de verificacion ambiental vigente",
  calcamoniaDeUltimoServicioEnParabrisas: "Calcamonia de ultimo servicio (en parabrisas)",
};

/** Construye un ExcelRow desde data.data usando FIELD_MAP + lookup economico. */
export function buildRow(answers: Record<string, unknown>): ExcelRow {
  const row: ExcelRow = {};
  for (const [dn, col] of Object.entries(FIELD_MAP)) {
    const v = answers[dn];
    if (v === null || v === undefined) continue;
    row[col] = typeof v === "object" ? JSON.stringify(v) : (v as string | number);
  }
  const eco = answers.economico;
  if (eco && typeof eco === "object") {
    const e = eco as Record<string, unknown>;
    if (e.PLACAS) row["# Economico - PLACAS"] = String(e.PLACAS);
    if (e.id) row["# Economico - id"] = String(e.id);
    if (e.SUBMARCA) row["# Economico - SUBMARCA"] = String(e.SUBMARCA);
    if (e.SUCURSAL) row["# Economico - SUCURSAL"] = String(e.SUCURSAL);
  }
  return row;
}

/**
 * dataNames de LLANTAS presentes en el envío pero desconocidos para FIELD_MAP —
 * la señal de que MoreApp volvió a regenerar nombres (form editado). El webhook
 * los loguea como warning para que el drift sea visible en CloudWatch, no un
 * mes de datos perdidos en silencio.
 */
export function dataNamesLlantaNoMapeados(answers: Record<string, unknown>): string[] {
  return Object.keys(answers)
    .filter((k) => /^(nivelTACODeLlanta|cuentaConLlanta)/i.test(k) && !(k in FIELD_MAP))
    .sort();
}
