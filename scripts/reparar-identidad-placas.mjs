#!/usr/bin/env node
/**
 * REPARACION DE IDENTIDAD DE UNIDAD — re-archiva bajo la placa VIGENTE todo registro que
 * quedo bajo una placa retirada, y corrige el catalogo.
 *
 * POR QUE EXISTE (y por que no basto la migracion unica de 2026-08-27)
 * `Unit` se identifica por [tenantId, placa] y Checklist/Semanal/CheckDone/Taller por
 * `unitUid` (= la placa). El cruce de la app es `unit.placa === registro.unitUid`. Las
 * fuentes de ingesta (el catalogo de MoreApp y el de Operaciones-GPA) SIGUEN enviando la
 * placa vieja de las 11 unidades que GPA reemplazo, asi que cada inspeccion nueva volvia a
 * crear la unidad bajo la placa retirada y le partia el historial en dos: la camioneta
 * aparecia "sin una sola inspeccion" mientras sus inspecciones salian aparte, con la placa
 * en la columna Economico.
 *
 * Medido en prod el 2026-09-08: 7 de las 11 unidades resucitadas en el catalogo con su placa
 * vieja (ecos 21, 23, 24, 47, 54, 55, 76) y una veintena de registros nuevos archivados bajo
 * placa retirada entre el 31-ago y el 2-sep.
 *
 * La causa se cerro en el codigo (`src/fleet/placaVigente.ts`, aplicado en los dos extremos:
 * ingesta y lectura). Este script limpia lo que ya entro. Comparte el mapa con ese modulo,
 * asi que no hay dos verdades: agregar un par alli y volver a correr esto.
 *
 * ORDEN SEGURO (igual que scripts/migrar-placas.mjs): respalda la pre-imagen, escribe la
 * llave nueva, la verifica leyendola, y solo entonces borra la vieja. Idempotente y
 * reanudable. Si el destino ya existe NO lo pisa: lo reporta como colision y deja ambos.
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
import { PLACAS_SUSTITUIDAS, placaVigente } from "../src/fleet/placaVigente.ts";

const args = process.argv.slice(2);
const iApi = args.indexOf("--api");
const API = iApi >= 0 ? args[iApi + 1] : undefined;
const APPLY = args.includes("--apply");
if (!API || API.startsWith("--")) {
  console.error("Falta --api <id del backend>");
  process.exit(1);
}

/**
 * Correcciones de CAPTURA en el catalogo. No son reemplacamientos: son placas mal escritas
 * a mano en el panel admin. Se listan aparte para no confundir las dos cosas.
 *
 * eco 75: el catalogo decia "JY138152", ocho caracteres, con un "1" de mas. La placa real es
 * JY38152 — lo confirman las 7,332 cargas de combustible, que identifican por numero
 * economico y traen la placa como dato: eco 75 => JY38152. Bajo JY38152 habia 10 inspecciones
 * mensuales, 27 semanales y 2 ingresos a taller sin poder encontrar su unidad.
 */
const CORRECCIONES_DE_CAPTURA = { JY138152: "JY38152" };

/** placa escrita => placa vigente, de las dos fuentes. */
const MAPA = { ...PLACAS_SUSTITUIDAS, ...CORRECCIONES_DE_CAPTURA };

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" });
const tabla = (m) => `${m}-${API}-NONE`;

/** Avisos que el script NO corrige por si solo (no inventa datos). */
const avisos = [];

/**
 * Blob `datos` de Taller: puede venir como string JSON o como objeto. Se preserva la forma.
 * Actualiza los campos que guardan la PLACA. `datos.eco` guarda el numero economico en la
 * mayoria de los registros; si alguno trae una placa retirada ahi, se AVISA en vez de
 * adivinar el numero (la migracion de agosto ya corrigio el unico caso conocido, la eco 24).
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
      `Taller ${folio}: datos.eco guarda la placa retirada "${vieja}" en vez del numero economico. Corregir a mano en el panel.`,
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
    modelo: "CheckDone",
    rangoAttr: "unitUid#itemKey",
    viejaDe: (it) => it.unitUid,
    rango: (it) => `${it.unitUid}#${it.itemKey}`,
    transforma: (it, vieja, nueva) => ({
      ...it,
      unitUid: nueva,
      "unitUid#itemKey": `${nueva}#${it.itemKey}`,
    }),
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
    // refId = "<modulo>|<unitUid>|<fecha>" — la placa es el segundo segmento.
    viejaDe: (it) => String(it.refId ?? "").split("|")[1],
    rango: (it) => it.refId,
    transforma: (it, vieja, nueva) => {
      const partes = String(it.refId).split("|");
      partes[1] = nueva;
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

let plan = 0;
let escritos = 0;
let borrados = 0;
let saltados = 0;
let errores = 0;
let colisiones = 0;
const respaldo = [];
const porTabla = [];

for (const t of TABLAS) {
  let items;
  try {
    items = await scan(t.modelo);
  } catch (e) {
    console.log(`\n-- ${t.modelo}: NO LEIDO (${e.name})`);
    continue;
  }
  const afectados = items.filter((it) => MAPA[t.viejaDe(it)]);
  porTabla.push([t.modelo, items.length, afectados.length]);
  if (!afectados.length) continue;
  console.log(
    `\n-- ${t.modelo}: ${items.length} registros, ${afectados.length} bajo placa retirada`,
  );
  plan += afectados.length;
  const extras = new Set();

  for (const it of afectados) {
    const vieja = t.viejaDe(it);
    const nueva = MAPA[vieja];
    const res = t.transforma(it, vieja, nueva);
    const nuevoItem = res.item ?? res;
    for (const c of res.extra ?? []) extras.add(c);
    const rangoViejo = t.rango(it);
    const rangoNuevo = nuevoItem[t.rangoAttr];
    respaldo.push({ modelo: t.modelo, rangoAttr: t.rangoAttr, rangoViejo, rangoNuevo, item: it });

    const ocupado = await existe(t.modelo, it.tenantId, t.rangoAttr, rangoNuevo);
    console.log(
      `   ${vieja} -> ${nueva}  ${String(rangoViejo).padEnd(26)} => ${String(rangoNuevo).padEnd(26)} ${ocupado ? "[DESTINO OCUPADO, no se pisa]" : ""}`,
    );
    if (ocupado) {
      colisiones++;
      continue;
    }
    if (!APPLY) continue;

    try {
      await client.send(
        new PutItemCommand({
          TableName: tabla(t.modelo),
          Item: marshall(nuevoItem, { removeUndefinedValues: true }),
        }),
      );
      escritos++;
      // Verificar que quedo escrita ANTES de borrar la vieja.
      if (!(await existe(t.modelo, it.tenantId, t.rangoAttr, rangoNuevo))) {
        errores++;
        console.log("      NO VERIFICADO, no se borra el viejo");
        continue;
      }
      if (rangoViejo !== rangoNuevo) {
        await client.send(
          new DeleteItemCommand({
            TableName: tabla(t.modelo),
            Key: marshall({ tenantId: it.tenantId, [t.rangoAttr]: rangoViejo }),
          }),
        );
        borrados++;
      } else {
        saltados++;
      }
    } catch (e) {
      errores++;
      console.log(`      FALLO: ${String(e).slice(0, 160)}`);
    }
  }
  if (extras.size) console.log(`   campos del blob actualizados: ${[...extras].join(", ")}`);
}

// Respaldo: pre-imagen completa de todo lo afectado, reversible a mano si hiciera falta.
if (respaldo.length) {
  mkdirSync(".scratch/reparacion-placas", { recursive: true });
  const sello = new Date().toISOString().replace(/[:.]/g, "-");
  const ruta = `.scratch/reparacion-placas/respaldo-${sello}.json`;
  writeFileSync(ruta, JSON.stringify(respaldo, null, 1));
  console.log(`\nRespaldo de ${respaldo.length} registros (pre-imagen): ${ruta}`);
}

// Auditoria final: que sigue sin poder encontrar su unidad en el catalogo.
console.log(`\n${raya}`);
console.log("AUDITORIA: registros que NO encuentran su unidad en el catalogo");
console.log(raya);
const units = await scan("Unit");
const delCatalogo = new Set(units.map((u) => placaVigente(u.placa)));
for (const modelo of ["Checklist", "Semanal", "CheckDone", "Taller"]) {
  const rows = await scan(modelo).catch(() => []);
  const huerf = new Map();
  for (const r of rows) {
    // CheckDone usa el uid compuesto `placa__fecha`; la identidad es la parte de la placa.
    const p = placaVigente(String(r.unitUid ?? "").split("__")[0].split("#")[0]);
    if (p && !delCatalogo.has(p)) huerf.set(p, (huerf.get(p) ?? 0) + 1);
  }
  const txt = [...huerf]
    .sort()
    .map(([p, n]) => `${p}(${n})`)
    .join(" ");
  console.log(`  ${modelo.padEnd(10)} ${huerf.size ? txt : "sin huerfanos"}`);
}

if (avisos.length) {
  console.log(`\n${raya}`);
  console.log("AVISOS (el script no los corrige por si solo)");
  console.log(raya);
  for (const a of avisos) console.log(`  - ${a}`);
}

console.log(`\n${raya}`);
for (const [m, tot, af] of porTabla) {
  console.log(`  ${m.padEnd(10)} ${String(tot).padStart(5)} registros, ${af} afectados`);
}
if (!APPLY) {
  console.log(`\n  A re-archivar: ${plan} registros. Colisiones: ${colisiones}.`);
  console.log("  SIMULACION. Corre con --apply para escribir.");
} else {
  console.log(
    `\n  escritos: ${escritos} - borrados: ${borrados} - ya estaban: ${saltados} - colisiones: ${colisiones} - errores: ${errores}`,
  );
}
