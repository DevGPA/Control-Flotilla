/**
 * Adaptador: checklist de reparto (CL) de Operaciones-GPA → modelos de Fleet Command.
 *
 * SEMANAL: espeja `processSemanal` del webhook MoreApp — upsert de `Unit` (catálogo) +
 * `Semanal` idempotente por [tenantId, periodoId(semana ISO), unitUid(placa)]. Los
 * motores de riesgo canónicos (`analyzer/risk.ts`) ya entienden el vocabulario de
 * Operaciones-GPA sin traducción: "Nivel Optimo"→OK, "Bajo"/"Muy Bajo"/"Sin Nivel"→Revisar,
 * "Sin daños"→OK, "Si"/"No" de refacción→OK/Revisar. Misma regla de negocio (A1: solo
 * aceite y radiador votan el estatus) para ambas fuentes.
 *
 * MENSUAL (2026-07-13): espeja `processMensual` del webhook — construye la fila con los
 * NOMBRES DE COLUMNA del Excel MoreApp (el contrato de `analyzeRow`, clasificador canónico)
 * a partir de los itemIds del formulario de Ops (MENSUAL_SEC en Eco-Admin frontend), corre
 * `analyzeRow` y upsertea `Unit` + `Checklist` idempotente por [tenantId, unitUid(placa),
 * fecha]. Vocabularios verificados contra `isBinFail`: "Si"/"No", DOC_OPTS ("Si vigente"/
 * "Vencido"/"No cuenta") y carrocería ("Sin daños"/"Con Raspaduras/Golpes") pasan DIRECTO;
 * la única traducción necesaria es "Sin Nivel" (fluidos) → isBinFail no aplica ahí y
 * analyzeRow busca substring "bajo", que "Sin Nivel" no contiene.
 */
import { analyzeRow } from "../analyzer/analyzeRow";
import { calcEstatusSemanal, normBodyRisk, normFluidRisk, normTireRisk } from "../analyzer/risk";
import {
  OPS_SOURCE,
  OPS_TENANT_ID,
  opsEventoId,
  type EvidenceResolver,
  type OpsClRecord,
} from "./contract";

/** Semana ISO "YYYY-Www" — misma implementación que el webhook (`isoWeekId`, en sync). */
export function isoWeekId(dateStr: string): string {
  const d = new Date(String(dateStr).replace(" ", "T"));
  if (isNaN(d.getTime())) return "sin-fecha";
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const wk =
    1 +
    Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(wk).padStart(2, "0")}`;
}

/** Input idempotente para Unit (subset del catálogo que el ingest mantiene). */
export interface UnitInput {
  tenantId: string;
  placa: string;
  economicoId?: string;
  marca?: string;
  sucursal?: string;
  // El área NO viene en el checklist; el receptor la estampa desde el catálogo de Ops
  // (CAT#VEHICLE) antes del upsert. A diferencia de sucursal, Ops manda (create+update).
  area?: string;
}

/** Input idempotente para Semanal ([tenantId, periodoId, unitUid]). */
export interface SemanalInput {
  tenantId: string;
  periodoId: string;
  sucursal?: string;
  unitUid: string;
  datos: string; // JSON — mismo shape que produce el webhook (el front lo consume igual)
}

const esKeyEvidencia = (v: unknown): v is string =>
  typeof v === "string" && /^(SOL|CL|MC|FRM)\/[0-9a-f]{32}\.(jpg|png|webp)$/.test(v);

/** Input idempotente para Checklist ([tenantId, unitUid, fecha]) — mensual. */
export interface ChecklistInput {
  tenantId: string;
  unitUid: string;
  fecha: string;
  tipoInspeccion: string;
  resultados: string; // JSON — MISMO shape que produce processMensual del webhook
  responsable?: string;
}

export function mapSemanal(
  ops: OpsClRecord,
  resolveFname: EvidenceResolver,
): { unit: UnitInput; semanal: SemanalInput } {
  if (ops.tipo !== "semanal") {
    throw new Error(`CL ${ops.id}: tipo "${String(ops.tipo)}" no implementado (solo semanal)`);
  }
  const placa = String(ops.placas ?? "").trim();
  if (!placa) throw new Error(`CL ${ops.id}: registro sin placas — no mapeable`);

  const answers = (ops.answers ?? {}) as Record<string, unknown>;

  // Riesgos con los motores canónicos (mismos que webhook y front).
  const aceite = String(answers.aceite ?? "");
  const radiador = String(answers.radiador ?? "");
  const carroceria = String(answers.carroceria ?? "");
  const llanta = String(answers.llanta_ref ?? "");
  const aceiteRisk = normFluidRisk(aceite);
  const radiadorRisk = normFluidRisk(radiador);
  const carroceriaRisk = normBodyRisk(carroceria);
  const llantaRisk = normTireRisk(llanta);
  const risk = calcEstatusSemanal(aceiteRisk, radiadorRisk, carroceriaRisk, llantaRisk);

  // Fotos: fotoKm + toda evidencia dentro de answers → fnames (shape que espera el front).
  const photos: string[] = [];
  if (esKeyEvidencia(ops.fotoKm)) photos.push(resolveFname(ops.fotoKm));
  for (const [, v] of Object.entries(answers)) {
    if (esKeyEvidencia(v)) photos.push(resolveFname(v));
  }
  // Golpes: daños con foto + DESCRIPCIÓN (answers.golpes = [{foto,desc}] o key directa).
  // Antes el array se descartaba COMPLETO (S-1/S-2, addendum 2026-07-17): se perdían las
  // fotos del daño y su descripción ("Abolladura", "Rayon"…). La foto entra a la galería
  // y el desc viaja en datos.golpes.
  const golpes: Array<{ fname: string; desc?: string }> = [];
  for (const item of Array.isArray(answers.golpes) ? answers.golpes : []) {
    if (esKeyEvidencia(item)) {
      golpes.push({ fname: resolveFname(item) });
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const key = Object.values(o).find(esKeyEvidencia);
      const desc = typeof o.desc === "string" && o.desc.trim() ? o.desc.trim() : undefined;
      if (key) golpes.push({ fname: resolveFname(key), ...(desc ? { desc } : {}) });
    }
  }
  photos.push(...golpes.map((g) => g.fname));
  if (esKeyEvidencia(ops.firma)) photos.push(resolveFname(ops.firma));

  const economicoId = String(ops.economico ?? "").trim() || undefined;
  const sucursal = String(ops.sucursal ?? "").trim() || undefined;
  const brand = String(ops.subMarca ?? "").trim();

  const datos = {
    economicoId: economicoId ?? "",
    brand,
    km: ops.km != null ? String(ops.km) : "",
    fecha: String(ops.fecha ?? ""),
    responsable: String(ops.responsable ?? ""),
    aceite,
    aceiteRisk,
    radiador,
    radiadorRisk,
    carroceria,
    carroceriaRisk,
    llanta,
    llantaRisk,
    risk,
    // Folio visible en el front (mismo campo que usa el flujo MoreApp).
    moreappId: opsEventoId(ops.id),
    photos,
    // Observación del chofer (S-1): el mensual ya la guardaba; el semanal la tiraba.
    obs: String(ops.obs ?? ""),
    // Daños con descripción (S-2): [{fname, desc?}] — la foto también va en photos.
    ...(golpes.length ? { golpes } : {}),
    fuente: OPS_SOURCE,
    opsId: ops.id,
    opsStatus: ops.status ?? null,
  };

  return {
    unit: {
      tenantId: OPS_TENANT_ID,
      placa,
      economicoId: economicoId && economicoId !== placa ? economicoId : undefined,
      marca: brand || undefined,
      sucursal,
    },
    semanal: {
      tenantId: OPS_TENANT_ID,
      periodoId: isoWeekId(String(ops.fecha ?? "")),
      sucursal,
      unitUid: placa,
      datos: JSON.stringify(datos),
    },
  };
}

// ── MENSUAL ───────────────────────────────────────────────────────────────────

/**
 * itemId del formulario mensual de Ops → columna Excel que `analyzeRow` entiende.
 * Fuente: MENSUAL_SEC (Eco-Admin frontend/index.html) ↔ FIELD_MAP (webhook MoreApp).
 * Los items sin equivalente en el motor de riesgo (diablito, extinguidor,
 * liq_limpiaparab) se omiten del análisis a propósito.
 */
const MENSUAL_COL: Record<string, string> = {
  // Llantas (TACO 1-10 = mm directos) + gating de internas/refacción
  taco_pd: "Nivel TACO de llanta piloto delantera",
  taco_cd: "Nivel TACO de llanta copiloto delantera",
  taco_pt: "Nivel TACO de llanta piloto trasera",
  taco_pt_int: "Nivel TACO de llanta piloto trasera INTERNA",
  taco_ct: "Nivel TACO de llanta copiloto trasera",
  taco_ct_int: "Nivel TACO de llanta copiloto trasera INTERNA",
  taco_ref: "Nivel TACO de llanta REFACCION",
  pt_int: "¿Cuenta con Llanta Piloto trasera INTERNA?",
  ct_int: "¿Cuenta con Llanta Copiloto trasera INTERNA?",
  refacc: "Cuenta con llanta de Refacción?",
  // Exterior / luces (BIN Si/No — isBinFail entiende el vocabulario tal cual)
  carroceria: "Carroceria con golpes o raspaduras",
  luces_d: "Luces y cuartos delanteros funcionando",
  espejos: "Espejos laterales en buen estado",
  cristales: "Cristales en buenas condiciones",
  molduras: "Molduras completas y en buen estado",
  tapon: "Tapon de la gasolina",
  // Interior
  claxon: "Bocina del claxon funcionando",
  limpiaparab: "Limpia parabrisas funcionando correctamente",
  tacometro: "Tacometro en buenas condiciones",
  retrovisor: "Espejo retrovisor en buenas condiciones",
  cinturones: "Cinturones de seguridad funcionando (todos)",
  luces_int: "Luces interiores funcionando",
  asientos: "Asientos en buen estado",
  tapetes: "Tapetes completos",
  // Herramientas y seguridad
  gato: "Gato adecuado para el vehiculo y su palanca",
  llave_cruz: "Llave de cruz o palanca acorde a los birlos de las llantas",
  triangulo: "Triangulo de seguridad",
  cables: "Cables pasa corriente",
  // Documentación (DOC_OPTS "Si vigente"/"Vencido"/"No cuenta" — isBinFail directo)
  tarj_circ: "Tarjeta de circulacion vigente",
  poliza: "Poliza de seguro vigente",
  refrendo: "Calcomonia de refrendo vehicular",
  verif: "Tarjeta/calcamonia de verificacion ambiental vigente",
  licencia: 'Licencia de "chofer" acorde a vehiculo vigente',
  calcomonia: "Calcamonia de ultimo servicio (en parabrisas)",
  // Cofre (fluidos NIVEL_OPTS — ver traducción de "Sin Nivel" abajo)
  liq_frenos: "Nivel de liquido de frenos max",
  aceite_motor: "Nivel de aceite de motor max",
  radiador: "Nivel de liquido de radiador max",
  aceite_dir: "Nivel de aceite de direccion max",
  // Mantenimiento predictivo
  km_sig_serv: "Kilometraje del siguiente servicio",
  fecha_sig_serv: "Fecha estimada del siguiente servicio",
};

/** itemIds de fluidos: "Sin Nivel" (peor caso de NIVEL_OPTS) no contiene el substring
 *  "bajo" que analyzeRow busca → se traduce preservando el sentido y la severidad. */
const MENSUAL_FLUIDOS = new Set(["liq_frenos", "aceite_motor", "radiador", "aceite_dir"]);

/** Etiqueta legible por foto del formulario mensual (col del registro de foto en FC). */
const MENSUAL_FOTO_LBL: Record<string, [group: string, col: string]> = {
  f_frente_d: ["Exterior", "Foto 3/4 Frente derecho"],
  f_frente_i: ["Exterior", "Foto 3/4 Frente izquierdo"],
  f_tras_d: ["Exterior", "Foto 3/4 Trasera derecha"],
  f_tras_i: ["Exterior", "Foto 3/4 Trasera izquierda"],
  f_pd: ["Llantas", "Foto piloto delantera"],
  f_cd: ["Llantas", "Foto copiloto delantera"],
  f_pt: ["Llantas", "Foto piloto trasera"],
  f_ct: ["Llantas", "Foto copiloto trasera"],
  f_ref: ["Llantas", "Foto refacción"],
  f_luces_d: ["Luces", "Foto luces delanteras"],
  f_luces_t: ["Luces", "Foto faros traseros"],
  f_esp_p: ["Luces", "Foto espejo piloto"],
  f_esp_c: ["Luces", "Foto espejo copiloto"],
  f_tapon: ["Luces", "Foto tapón gasolina"],
  f_limpiaparab: ["Interior", "Foto limpiaparabrisas"],
  f_retrovisor: ["Interior", "Foto espejo retrovisor"],
  f_cinturones: ["Interior", "Foto cinturones"],
  f_luces_int: ["Interior", "Foto luces interiores"],
  f_asientos: ["Interior", "Foto asientos"],
  f_tapetes: ["Interior", "Foto tapetes"],
  f_diablito: ["Herramientas", "Foto diablito"],
  f_herr: ["Herramientas", "Foto herramientas"],
  f_extinguidor: ["Herramientas", "Foto extinguidor"],
  f_bateria: ["Herramientas", "Foto batería"],
  f_tarj_circ: ["Documentos", "Foto tarjeta circulación"],
  f_poliza: ["Documentos", "Foto póliza seguro"],
  f_refrendo: ["Documentos", "Foto refrendo"],
  f_verif: ["Documentos", "Foto verificación"],
  f_licencia: ["Documentos", "Foto licencia"],
  f_calcomonia: ["Documentos", "Foto calcomanía servicio"],
  f_radiador: ["Cofre", "Foto radiador"],
  f_liq_limpiaparab: ["Cofre", "Foto limpiaparabrisas"],
  f_aceite_dir: ["Cofre", "Foto dirección"],
  f_aceite_motor: ["Cofre", "Foto motor"],
  f_liq_frenos: ["Cofre", "Foto frenos"],
};

/** Foto del registro Checklist mensual — mismo shape que produce el webhook MoreApp. */
interface MensualPhoto {
  group: string;
  col: string;
  fname: string;
}

/** Extrae keys de evidencia de `golpes` (damage_list de Ops: array cuyos elementos
 *  pueden ser una key directa o un objeto con la key en alguna propiedad). */
function fotosDeGolpes(v: unknown, resolveFname: EvidenceResolver): MensualPhoto[] {
  if (!Array.isArray(v)) return [];
  const out: MensualPhoto[] = [];
  for (const item of v) {
    if (esKeyEvidencia(item)) {
      out.push({ group: "Exterior", col: "Foto daño", fname: resolveFname(item) });
    } else if (item && typeof item === "object") {
      for (const val of Object.values(item as Record<string, unknown>)) {
        if (esKeyEvidencia(val)) {
          out.push({ group: "Exterior", col: "Foto daño", fname: resolveFname(val) });
        }
      }
    }
  }
  return out;
}

export function mapMensual(
  ops: OpsClRecord,
  resolveFname: EvidenceResolver,
): { unit: UnitInput; checklist: ChecklistInput } {
  if (ops.tipo !== "mensual") {
    throw new Error(`CL ${ops.id}: mapMensual recibió tipo "${String(ops.tipo)}"`);
  }
  const placa = String(ops.placas ?? "").trim();
  if (!placa) throw new Error(`CL ${ops.id}: registro sin placas — no mapeable`);
  const fecha = String(ops.fecha ?? "")
    .split(/[ T]/)[0]!
    .trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new Error(`CL ${ops.id}: sin fecha válida ("${String(ops.fecha)}") — no mapeable`);
  }

  const answers = (ops.answers ?? {}) as Record<string, unknown>;
  const economicoId = String(ops.economico ?? "").trim() || undefined;
  const sucursal = String(ops.sucursal ?? "").trim() || undefined;
  const brand = String(ops.subMarca ?? "").trim();

  // ── Fila con las columnas del contrato de analyzeRow ─────────────────────
  const row: Record<string, unknown> = {
    "# Economico - PLACAS": placa,
    "# Economico - id": economicoId ?? "",
    Kilometraje: ops.km != null ? String(ops.km) : "",
  };
  for (const [itemId, col] of Object.entries(MENSUAL_COL)) {
    const v = answers[itemId];
    if (v == null || v === "") continue;
    if (MENSUAL_FLUIDOS.has(itemId) && String(v).trim().toLowerCase() === "sin nivel") {
      // "Sin Nivel" es el PEOR caso de NIVEL_OPTS pero no contiene "bajo" →
      // analyzeRow no lo detectaría. Traducción explícita preservando la severidad.
      row[col] = "Sin nivel (bajo)";
    } else {
      row[col] = v;
    }
  }

  const analyzed = analyzeRow(row as Parameters<typeof analyzeRow>[0]);

  // ── Fotos {group,col,fname} (shape del webhook; la galería agrupa por group) ──
  const photos: MensualPhoto[] = [];
  if (esKeyEvidencia(ops.fotoKm)) {
    photos.push({ group: "General", col: "Foto kilometraje", fname: resolveFname(ops.fotoKm) });
  }
  for (const [k, v] of Object.entries(answers)) {
    if (k === "golpes") continue; // array — abajo
    if (!esKeyEvidencia(v)) continue;
    const [group, col] = MENSUAL_FOTO_LBL[k] ?? ["Mensual", k];
    photos.push({ group, col, fname: resolveFname(v) });
  }
  photos.push(...fotosDeGolpes(answers.golpes, resolveFname));
  if (esKeyEvidencia(ops.firma)) {
    photos.push({ group: "General", col: "Firma", fname: resolveFname(ops.firma) });
  }

  // Observaciones: obs del registro + comentario de radiador (único texto libre del form).
  const obs = [String(ops.obs ?? "").trim(), String(answers.com_radiador ?? "").trim()]
    .filter(Boolean)
    .join("\n\n");

  // MISMO shape que processMensual del webhook (contrato con cloudHydrate/el front),
  // + metadatos de trazabilidad del puente (extras — parseResultados los ignora).
  const resultados = JSON.stringify({
    findings: analyzed.F,
    tires: analyzed.T,
    max: analyzed.max,
    risk: analyzed.max,
    minT: analyzed.minT ?? null,
    validationErrors: analyzed.validationErrors,
    obs,
    km: ops.km != null ? String(ops.km) : "",
    nextSvc: String(answers.fecha_sig_serv ?? ""),
    kmNextSvc: String(answers.km_sig_serv ?? ""),
    moreappId: opsEventoId(ops.id),
    photos,
    fuente: OPS_SOURCE,
    opsId: ops.id,
    opsStatus: ops.status ?? null,
  });

  return {
    unit: {
      tenantId: OPS_TENANT_ID,
      placa,
      economicoId: economicoId && economicoId !== placa ? economicoId : undefined,
      marca: brand || undefined,
      sucursal,
    },
    checklist: {
      tenantId: OPS_TENANT_ID,
      unitUid: placa,
      fecha,
      tipoInspeccion: "mensual",
      resultados,
      responsable: String(ops.responsable ?? "") || undefined,
    },
  };
}
