#!/usr/bin/env node
/**
 * REPARACION DE IDENTIDAD DE UNIDAD — re-archiva bajo la placa VIGENTE todo registro que
 * quedo bajo una placa retirada o mal capturada, y corrige el catalogo.
 *
 * POR QUE EXISTE (y por que una migracion unica no basta)
 * `Unit` se identifica por [tenantId, placa] y Checklist/Semanal/CheckDone/Taller por
 * `unitUid` (= la placa). El cruce de la app es `unit.placa === registro.unitUid`. La fuente
 * de ingesta (el catalogo de Operaciones-GPA) SIGUE enviando la placa vieja de las 11 unidades
 * que GPA reemplazo, asi que cada inspeccion nueva volvia a crear la unidad bajo la placa
 * retirada y le partia el historial en dos: la camioneta aparecia "sin una sola inspeccion".
 *
 * Medido en prod el 2026-09-08: 7 de las 11 unidades resucitadas en el catalogo con su placa
 * vieja (ecos 21, 23, 24, 47, 54, 55, 76) y una veintena de registros nuevos archivados ahi
 * entre el 31-ago y el 2-sep.
 *
 * La causa se cerro en el codigo: `src/fleet/placaVigente.ts` se aplica en la ingesta (puente
 * de Ops-GPA y carga por Excel/ZIP) y en la lectura. Este script limpia lo que ya entro.
 * COMPARTE el mapa con ese modulo, asi que no hay dos verdades: agregar un par alli y volver a
 * correr esto.
 *
 * ORDEN SEGURO
 *  1. Escanea y arma el plan completo.
 *  2. Escribe el RESPALDO (pre-imagen de todo lo afectado) a disco ANTES de tocar nada.
 *  3. Por registro: Put CONDICIONAL (falla si el destino ya existe, en vez de pisarlo) ->
 *     lo verifica leyendolo -> y solo entonces borra la llave vieja.
 * Idempotente y reanudable. Si el destino esta ocupado NO lo pisa: lo reporta como colision y
 * deja ambos, para triage manual.
 *
 * REQUIERE Node >= 23.6 (importa un modulo .ts directo). En Node 22.x:
 *   node --experimental-strip-types scripts/reparar-identidad-placas.mjs ...
 *
 * Uso:
 *   node scripts/reparar-identidad-placas.mjs --api t5zfjwkc6bgpvhxzlpjak3rlfa
 *   node scripts/reparar-identidad-placas.mjs --api t5zfjwkc6bgpvhxzlpjak3rlfa --apply
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  DynamoDBClient,
  paginateScan,
  PutItemCommand,
  DeleteItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { placaVigente } from "../src/fleet/placaVigente.ts";

const args = process.argv.slice(2);
const iApi = args.indexOf("--api");
const API = iApi >= 0 ? args[iApi + 1] : undefined;
const APPLY = args.includes("--apply");
if (!API || API.startsWith("--")) {
  console.error("Falta --api <id del backend>");
  process.exit(1);
}

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" });
const tabla = (m) => `${m}-${API}-NONE`;

/** Avisos que el script NO corrige por si solo: no inventa datos. */
const avisos = [];

/**
 * El `refId` de una Anulacion NO tiene un formato uniforme — la placa vive en un segmento
 * distinto segun el modulo (ver src/anulacion/anulacion.ts):
 *   checklist|<unitUid>|<fecha>                  -> placa en [1]
 *   semanal|<periodoId>|<unitUid>                -> placa en [2]
 *   taller|<unitUid>|<fechaEntrada>              -> placa en [1]
 *   combustible|<economicoId>|<tipo>|<eventoId>  -> NO lleva placa, jamas se toca
 * Leer siempre [1] resucitaria en silencio los semanales anulados de una unidad re-archivada:
 * el tombstone quedaria apuntando a una llave que ya no existe y el reporte volveria a los
 * KPIs. Esto es exactamente lo que el estandar "anulacion, nunca borrado" busca evitar.
 */
const SEGMENTO_DE_PLACA = { checklist: 1, semanal: 2, taller: 1 };

function placaDeRefId(refId) {
  const partes = String(refId ?? "").split("|");
  const modulo = partes[0] ?? "";
  if (modulo === "combustible") return undefined;
  const i = SEGMENTO_DE_PLACA[modulo];
  if (i === undefined) {
    avisos.push(`Anulacion con modulo desconocido en el refId, NO se toca: "${refId}"`);
    return undefined;
  }
  return partes[i];
}

/**
 * Blob `datos` de Taller: puede venir como string JSON o como objeto. Se preserva la forma.
 * Actualiza los campos que guardan la PLACA. `datos.eco` guarda el numero economico en la
 * mayoria de los registros; si alguno trae una placa ahi, se AVISA en vez de adivinar el
 * numero.
 */
function transformaDatos(datos, vieja, nueva, folio) {
  if (datos == null) return { valor: datos, cambios: [] };
  const eraString = typeof datos === "string";
  let obj;
  try {
    obj = eraString ? JSON.parse(datos) : { ...datos };
  } catch {
    return { valor: datos, cambios: [] };
  }
  const cambios = [];
  for (const campo of ["plate", "unitKey"]) {
    if (obj[campo] === vieja) {
      obj[campo] = nueva;
      cambios.push(`datos.${campo}`);
    }
  }
  if (obj.eco === vieja) {
    avisos.push(
      `Taller ${folio}: datos.eco guarda la placa "${vieja}" en vez del numero economico. Corregir a mano en el panel.`,
    );
  }
  return { valor: eraString ? JSON.stringify(obj) : obj, cambios };
}

const TABLAS = [
  {
    modelo: "Unit",
    rangoAttr: "placa",
    viejaDe: (it) => it.placa,
    rango: (it) => it.placa,
    transforma: (it, vieja, nueva) => ({ ...it, placa: nueva }),
  },
  {
    modelo: "Checklist",
    rangoAttr: "unitUid#fecha",
    viejaDe: (it) => it.unitUid,
    rango: (it) => `${it.unitUid}#${it.fecha}`,
    transforma: (it, vieja, nueva) => ({
      ...it,
      unitUid: nueva,
      "unitUid#fecha": `${nueva}#${it.fecha}`,
    }),
  },
  {
    modelo: "Semanal",
    rangoAttr: "periodoId#unitUid",
    viejaDe: (it) => it.unitUid,
    rango: (it) => `${it.periodoId}#${it.unitUid}`,
    transforma: (it, vieja, nueva) => ({
      ...it,
      unitUid: nueva,
      "periodoId#unitUid": `${it.periodoId}#${nueva}`,
    }),
  },
  {
    // OJO: `CheckDone.unitUid` NO es una placa a secas — es el uid de la inspeccion,
    // `placa__fecha` (las filas viejas si traen la placa sola). La identidad es la PARTE de
    // la placa; normalizar la cadena completa aplanaria el separador y destruiria la llave
    // de los hallazgos ya marcados.
    modelo: "CheckDone",
    rangoAttr: "unitUid#itemKey",
    viejaDe: (it) => String(it.unitUid ?? "").split("__")[0],
    rango: (it) => `${it.unitUid}#${it.itemKey}`,
    transforma: (it, vieja, nueva) => {
      const partes = String(it.unitUid ?? "").split("__");
      const resto = partes.slice(1).join("__");
      const uid = resto ? `${nueva}__${resto}` : nueva;
      return {
        ...it,
        unitUid: uid,
        "unitUid#itemKey": `${uid}#${it.itemKey}`,
      };
    },
  },
  {
    modelo: "Taller",
    rangoAttr: "unitUid#fechaEntrada",
    viejaDe: (it) => it.unitUid,
    rango: (it) => `${it.unitUid}#${it.fechaEntrada}`,
    transforma: (it, vieja, nueva) => {
      const { valor, cambios } = transformaDatos(it.datos, vieja, nueva, it.folio);
      return {
        item: {
          ...it,
          unitUid: nueva,
          "unitUid#fechaEntrada": `${nueva}#${it.fechaEntrada}`,
          ...(valor === undefined ? {} : { datos: valor }),
        },
        extra: cambios,
      };
    },
  },
  {
    modelo: "Anulacion",
    rangoAttr: "refId",
    viejaDe: (it) => placaDeRefId(it.refId),
    rango: (it) => it.refId,
    transforma: (it, vieja, nueva) => {
      const partes = String(it.refId).split("|");
      const i = SEGMENTO_DE_PLACA[partes[0] ?? ""];
      if (i === undefined) throw new Error(`refId no mapeable: ${it.refId}`);
      partes[i] = nueva;
      return { ...it, refId: partes.join("|") };
    },
  },
];

async function scan(modelo) {
  const out = [];
  for await (const p of paginateScan({ client }, { TableName: tabla(modelo) })) {
    for (const it of p.Items ?? []) out.push(unmarshall(it));
  }
  return out;
}

async function existe(modelo, tenantId, rangoAttr, rangoVal) {
  const r = await client.send(
    new GetItemCommand({
      TableName: tabla(modelo),
      Key: marshall({ tenantId, [rangoAttr]: rangoVal }),
      ProjectionExpression: "tenantId",
    }),
  );
  return !!r.Item;
}

const raya = "=".repeat(78);
console.log(raya);
console.log(`REPARACION DE IDENTIDAD DE PLACAS  (${APPLY ? "APLICAR" : "SIMULACION"})`);
console.log(raya);

// ── FASE 1: escanear y armar el plan ────────────────────────────────────────
const plan = [];
const porTabla = [];
for (const t of TABLAS) {
  let items;
  try {
    items = await scan(t.modelo);
  } catch (e) {
    console.log(`\n-- ${t.modelo}: NO LEIDO (${e.name})`);
    porTabla.push([t.modelo, "?", 0]);
    continue;
  }
  let afectados = 0;
  for (const it of items) {
    const vieja = t.viejaDe(it);
    if (vieja == null || vieja === "") continue;
    // Filtro CANONICO, no exacto: asi tambien alcanza las variantes de captura
    // ("jv50090", "JV-50090"), que un `MAPA[vieja]` literal dejaba fuera — y la auditoria
    // final SI las normaliza, asi que el desajuste imprimia "sin huerfanos" en falso.
    const nueva = placaVigente(vieja);
    if (!nueva || nueva === vieja) continue;
    const res = t.transforma(it, vieja, nueva);
    const nuevoItem = res.item ?? res;
    plan.push({
      t,
      item: it,
      vieja,
      nueva,
      rangoViejo: t.rango(it),
      rangoNuevo: nuevoItem[t.rangoAttr],
      nuevoItem,
      extra: res.extra ?? [],
    });
    afectados++;
  }
  porTabla.push([t.modelo, items.length, afectados]);
}

for (const [m, tot, af] of porTabla) {
  if (af) console.log(`\n-- ${m}: ${tot} registros, ${af} bajo placa a corregir`);
  for (const p of plan.filter((p) => p.t.modelo === m)) {
    console.log(
      `   ${p.vieja} -> ${p.nueva}  ${String(p.rangoViejo).padEnd(26)} => ${p.rangoNuevo}`,
    );
  }
  const extras = new Set(plan.filter((p) => p.t.modelo === m).flatMap((p) => p.extra));
  if (extras.size) console.log(`   campos del blob actualizados: ${[...extras].join(", ")}`);
}

// ── FASE 2: respaldo a disco ANTES de escribir nada ─────────────────────────
if (plan.length) {
  mkdirSync(".scratch/reparacion-placas", { recursive: true });
  const sello = new Date().toISOString().replace(/[:.]/g, "-");
  const ruta = `.scratch/reparacion-placas/respaldo-${sello}.json`;
  writeFileSync(
    ruta,
    JSON.stringify(
      plan.map((p) => ({
        modelo: p.t.modelo,
        rangoAttr: p.t.rangoAttr,
        rangoViejo: p.rangoViejo,
        rangoNuevo: p.rangoNuevo,
        item: p.item,
      })),
      null,
      1,
    ),
  );
  console.log(`\nRespaldo de ${plan.length} registros (pre-imagen) ESCRITO ANTES de tocar nada:`);
  console.log(`  ${ruta}`);
}

// ── FASE 3: escribir ───────────────────────────────────────────────────────
let escritos = 0;
let borrados = 0;
let colisiones = 0;
let errores = 0;

for (const p of plan) {
  const { t } = p;
  if (!APPLY) {
    if (await existe(t.modelo, p.item.tenantId, t.rangoAttr, p.rangoNuevo)) {
      colisiones++;
      console.log(`   [DESTINO OCUPADO, no se pisaria] ${t.modelo} ${p.rangoNuevo}`);
    }
    continue;
  }
  try {
    // Put CONDICIONAL: si el receptor creo el destino entre el scan y ahora, esto falla en
    // vez de reemplazarlo (el Put a secas era una carrera de perdida de escritura, y el
    // receptor ahora escribe exactamente las llaves canonicas que este script persigue).
    await client.send(
      new PutItemCommand({
        TableName: tabla(t.modelo),
        Item: marshall(p.nuevoItem, { removeUndefinedValues: true }),
        ConditionExpression: "attribute_not_exists(tenantId)",
      }),
    );
    escritos++;
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") {
      colisiones++;
      console.log(`   [DESTINO OCUPADO, no se pisa] ${t.modelo} ${p.rangoNuevo}`);
      continue;
    }
    errores++;
    console.log(`   FALLO Put ${t.modelo} ${p.rangoViejo}: ${String(e).slice(0, 160)}`);
    continue;
  }
  try {
    // Verificar que quedo escrita ANTES de borrar la vieja.
    if (!(await existe(t.modelo, p.item.tenantId, t.rangoAttr, p.rangoNuevo))) {
      errores++;
      console.log(`   NO VERIFICADO, no se borra el viejo: ${t.modelo} ${p.rangoNuevo}`);
      continue;
    }
    if (p.rangoViejo !== p.rangoNuevo) {
      await client.send(
        new DeleteItemCommand({
          TableName: tabla(t.modelo),
          Key: marshall({ tenantId: p.item.tenantId, [t.rangoAttr]: p.rangoViejo }),
        }),
      );
      borrados++;
    }
  } catch (e) {
    errores++;
    console.log(`   FALLO Delete ${t.modelo} ${p.rangoViejo}: ${String(e).slice(0, 160)}`);
  }
}

// ── FASE 4: auditoria ──────────────────────────────────────────────────────
console.log(`\n${raya}`);
console.log("AUDITORIA: registros que NO encuentran su unidad en el catalogo");
console.log(raya);
const units = await scan("Unit");
const delCatalogo = new Set(units.map((u) => placaVigente(u.placa)).filter(Boolean));

// Duplicados del catalogo: dos filas para la misma unidad inflan la flota y la cobertura.
const porLlave = new Map();
for (const u of units) {
  const k = placaVigente(u.placa);
  if (k) porLlave.set(k, [...(porLlave.get(k) ?? []), u.placa]);
}
const dup = [...porLlave].filter(([, ps]) => ps.length > 1);
console.log(`  Unit       ${units.length} filas, ${porLlave.size} unidades distintas`);
for (const [k, ps] of dup) console.log(`     DUPLICADA ${k} <- ${ps.join(" + ")}`);

for (const modelo of ["Checklist", "Semanal", "CheckDone", "Taller"]) {
  const rows = await scan(modelo).catch(() => []);
  const huerf = new Map();
  for (const r of rows) {
    // CheckDone usa el uid compuesto `placa__fecha`; la identidad es la parte de la placa.
    const p = placaVigente(String(r.unitUid ?? "").split("__")[0]);
    if (p && !delCatalogo.has(p)) huerf.set(p, (huerf.get(p) ?? 0) + 1);
  }
  const txt = [...huerf]
    .sort()
    .map(([p, n]) => `${p}(${n})`)
    .join(" ");
  console.log(`  ${modelo.padEnd(10)} ${huerf.size ? txt : "sin huerfanos"}`);
}

// Anulacion: un tombstone ACTIVO cuyo registro destino ya no existe es una anulacion
// resucitada en silencio — exactamente lo que hay que reportar.
{
  const [anul, chk, sem, tal] = await Promise.all([
    scan("Anulacion").catch(() => []),
    scan("Checklist").catch(() => []),
    scan("Semanal").catch(() => []),
    scan("Taller").catch(() => []),
  ]);
  const kChk = new Set(chk.map((r) => `${r.unitUid}|${r.fecha}`));
  const kSem = new Set(sem.map((r) => `${r.periodoId}|${r.unitUid}`));
  const kTal = new Set(tal.map((r) => `${r.unitUid}|${r.fechaEntrada}`));
  const rotas = [];
  for (const a of anul) {
    const p = String(a.refId ?? "").split("|");
    const modulo = p[0] ?? "";
    let ok = null;
    if (modulo === "checklist") ok = kChk.has(`${p[1]}|${p[2]}`);
    else if (modulo === "semanal") ok = kSem.has(`${p[1]}|${p[2]}`);
    else if (modulo === "taller") ok = kTal.has(`${p[1]}|${p[2]}`);
    if (ok === false) rotas.push(a.refId);
  }
  console.log(
    `  Anulacion  ${anul.length} filas, ${rotas.length} apuntando a un registro que ya NO existe`,
  );
  for (const r of rotas) console.log(`     HUERFANA ${r}`);
}

if (avisos.length) {
  console.log(`\n${raya}`);
  console.log("AVISOS (el script no los corrige por si solo)");
  console.log(raya);
  for (const a of [...new Set(avisos)]) console.log(`  - ${a}`);
}

console.log(`\n${raya}`);
for (const [m, tot, af] of porTabla) {
  console.log(`  ${m.padEnd(10)} ${String(tot).padStart(5)} registros, ${af} afectados`);
}
if (!APPLY) {
  console.log(`\n  A re-archivar: ${plan.length} registros. Colisiones: ${colisiones}.`);
  console.log("  SIMULACION. Corre con --apply para escribir.");
} else {
  console.log(
    `\n  escritos: ${escritos} - borrados: ${borrados} - colisiones: ${colisiones} - errores: ${errores}`,
  );
}
