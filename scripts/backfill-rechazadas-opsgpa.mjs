#!/usr/bin/env node
/**
 * Backfill único (spec 2026-07-21): reclasifica las ValidacionCarga que el puente de Ops
 * escribió como "discrepancia" cuando en realidad eran RECHAZOS en origen.
 *
 *   criterio: fuenteDeteccion="ops-gpa" AND verdictGlobal="discrepancia"
 *             AND nota="Rechazada en origen (Operaciones-GPA)"
 *   cambio:   verdictGlobal → "rechazada"
 *
 * Dry-run por default; --apply para escribir. Idempotente: re-correrlo da 0 candidatas.
 * Uso:  node scripts/backfill-rechazadas-opsgpa.mjs --table <ValidacionCarga-...-NONE> [--apply]
 */
import { DynamoDBClient, paginateScan, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const args = process.argv.slice(2);
const table = args[args.indexOf("--table") + 1];
const apply = args.includes("--apply");
if (args.indexOf("--table") < 0 || !table || table.startsWith("--")) {
  console.error("Falta --table <nombre de la tabla ValidacionCarga>");
  process.exit(1);
}

const NOTA = "Rechazada en origen (Operaciones-GPA)";
const client = new DynamoDBClient({});
let escaneadas = 0;
let candidatas = 0;
let actualizadas = 0;
let errores = 0;

const pages = paginateScan(
  { client },
  {
    TableName: table,
    // AND contains(revisadoPor, :ops): el puente escribe revisadoPor "ops-gpa" o
    // "<quien> · ops-gpa"; un humano escribe su email. Nunca tocar filas revisadas
    // por una persona, aunque coincidan fuenteDeteccion/verdictGlobal/nota.
    FilterExpression:
      "fuenteDeteccion = :f AND verdictGlobal = :d AND nota = :n AND contains(revisadoPor, :ops)",
    ExpressionAttributeValues: {
      ":f": { S: "ops-gpa" },
      ":d": { S: "discrepancia" },
      ":n": { S: NOTA },
      ":ops": { S: "ops-gpa" },
    },
  },
);

for await (const page of pages) {
  escaneadas += page.ScannedCount ?? 0;
  for (const item of page.Items ?? []) {
    const row = unmarshall(item);
    candidatas++;
    console.log(
      `${apply ? "ACTUALIZA" : "haría"}: ${row.loadId} (ts=${row.ts ?? "—"}, revisadoPor=${row.revisadoPor ?? "—"})`,
    );
    if (!apply) continue;
    try {
      await client.send(
        new UpdateItemCommand({
          TableName: table,
          // Llave compuesta real del modelo (.identifier(["tenantId","loadId"])) — no hay
          // atributo "id" en esta tabla.
          Key: { tenantId: item.tenantId, loadId: item.loadId },
          UpdateExpression: "SET verdictGlobal = :r",
          // Guardia de idempotencia/carrera: solo si sigue siendo discrepancia.
          ConditionExpression: "verdictGlobal = :d",
          ExpressionAttributeValues: { ":r": { S: "rechazada" }, ":d": { S: "discrepancia" } },
        }),
      );
      actualizadas++;
    } catch (err) {
      // Solo se tolera ConditionalCheckFailedException (carrera con otro proceso: la fila
      // dejó de ser discrepancia entre el Scan y el Update) — se cuenta y se sigue. Cualquier
      // otro error (credenciales expiradas, throttling, permisos) es sistémico: abortar
      // ruidosamente en vez de terminar "exitosamente" con datos a medio migrar.
      if (err?.name === "ConditionalCheckFailedException") {
        console.error(`ERROR (tolerado): ${row.loadId}:`, err.name);
        errores++;
        continue;
      }
      throw err;
    }
  }
}

console.log(
  `\nEscaneadas: ${escaneadas} · candidatas: ${candidatas} · actualizadas: ${actualizadas} · errores: ${errores}` +
    (apply ? "" : "  (dry-run — usa --apply para escribir)"),
);
process.exitCode = errores > 0 ? 1 : 0;
