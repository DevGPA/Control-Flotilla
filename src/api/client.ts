// API client tipado para los 6 modelos GraphQL.
//
// Patrón upsert: try `create()` → si conflicto (record ya existe por composite
// identifier) → fallback a `update()`. Esto da idempotencia: re-subir el mismo
// ZIP no crea duplicados, sobrescribe.
//
// Composite identifiers (por modelo) están definidos en amplify/data/resource.ts:
// - Unit:       (tenantId, placa)
// - Taller:     (tenantId, unitUid, fechaEntrada)
// - Nota:       (tenantId, unitUid, timestamp)
// - Checklist:  (tenantId, unitUid, fecha)
// - Periodo:    (tenantId, tipo, fechaInicio)
// - Semanal:    (tenantId, periodoId, unitUid)
//
// DynamoDB rechaza writes que violen el composite PK con ConditionalCheckFailed.
// Lo capturamos y llamamos update con la misma natural key.

import { getClient, type Schema } from "./amplifyClient";

type GraphQLError = { errorType?: string; message?: string };

function isConditionalCheckFailed(errors: readonly GraphQLError[] | undefined): boolean {
  if (!errors) return false;
  return errors.some(
    (e) =>
      e.errorType === "DynamoDB:ConditionalCheckFailedException" ||
      (e.message ?? "").includes("ConditionalCheckFailed"),
  );
}

function throwOnErrors(label: string, errors: readonly GraphQLError[] | undefined): void {
  if (errors && errors.length > 0) {
    throw new Error(`${label} failed: ${JSON.stringify(errors)}`);
  }
}

/**
 * Pagina un `.list()` de Amplify siguiendo `nextToken` hasta agotar.
 * Sin esto, DynamoDB devuelve solo ~100 ítems por página y el resto se pierde
 * silenciosamente (causa del bug 34-envíos-vs-14-visibles en mayo 2026).
 */
async function listAll<T>(
  fn: (token: string | null) => Promise<{
    data: T[];
    nextToken?: string | null;
    errors?: unknown;
  }>,
  label: string,
): Promise<T[]> {
  const out: T[] = [];
  let token: string | null = null;
  let pages = 0;
  do {
    const { data, nextToken, errors } = await fn(token);
    throwOnErrors(label, errors as readonly GraphQLError[] | undefined);
    if (data) out.push(...data);
    token = nextToken ?? null;
    pages++;
  } while (token && pages < 100);
  return out;
}

// ───────────────────────── Unit ─────────────────────────

export type UnitInput = {
  tenantId: string;
  placa: string;
  economicoId?: string;
  marca?: string;
  modelo?: string;
  anio?: number;
  sucursal?: string;
  vin?: string;
};

export async function upsertUnit(input: UnitInput): Promise<Schema["Unit"]["type"]> {
  const c = getClient();
  const created = await c.models.Unit.create(input);
  if (!created.errors) return created.data!;
  if (isConditionalCheckFailed(created.errors)) {
    const updated = await c.models.Unit.update(input);
    throwOnErrors("upsertUnit(update)", updated.errors);
    return updated.data!;
  }
  throwOnErrors("upsertUnit(create)", created.errors);
  return created.data!;
}

export async function listUnits(tenantId: string): Promise<Schema["Unit"]["type"][]> {
  const c = getClient();
  return listAll<Schema["Unit"]["type"]>(
    (token) =>
      c.models.Unit.list({
        filter: { tenantId: { eq: tenantId } },
        limit: 1000,
        nextToken: token ?? undefined,
      }),
    "listUnits",
  );
}

// ───────────────────────── Taller ─────────────────────────

export type TallerInput = {
  tenantId: string;
  unitUid: string;
  fechaEntrada: string;
  fechaSalida?: string;
  folio?: string;
  motivo: string;
  estatus: "abierto" | "cerrado";
  datos?: unknown;
};

export async function upsertTaller(input: TallerInput): Promise<Schema["Taller"]["type"]> {
  const c = getClient();
  // AWSJSON datos field requiere STRING.
  const inputStringified = {
    ...input,
    datos: typeof input.datos === "string" ? input.datos : JSON.stringify(input.datos ?? {}),
  };
  const payload = inputStringified as unknown as Parameters<typeof c.models.Taller.create>[0];
  const created = await c.models.Taller.create(payload);
  if (!created.errors && created.data) return created.data;
  if (created.errors && isConditionalCheckFailed(created.errors)) {
    const updated = await c.models.Taller.update(payload);
    if (updated.errors)
      throw new Error(`upsertTaller(update) failed: ${JSON.stringify(updated.errors)}`);
    return updated.data!;
  }
  if (created.errors)
    throw new Error(`upsertTaller(create) failed: ${JSON.stringify(created.errors)}`);
  return created.data!;
}

export async function listTaller(tenantId: string): Promise<Schema["Taller"]["type"][]> {
  const c = getClient();
  return listAll<Schema["Taller"]["type"]>(
    (token) =>
      c.models.Taller.list({
        filter: { tenantId: { eq: tenantId } },
        limit: 1000,
        nextToken: token ?? undefined,
      }),
    "listTaller",
  );
}

/**
 * Borra un Taller record del cloud. Requiere los 3 fields del composite
 * identifier (tenantId, unitUid, fechaEntrada). Si no match exacto, no borra.
 */
export async function deleteTaller(input: {
  tenantId: string;
  unitUid: string;
  fechaEntrada: string;
}): Promise<void> {
  const c = getClient();
  const { errors } = await c.models.Taller.delete(input);
  throwOnErrors("deleteTaller", errors);
}

// ───────────────────────── Nota ─────────────────────────

export type NotaInput = {
  tenantId: string;
  unitUid: string;
  autorId: string;
  texto: string;
  timestamp: string;
};

export async function upsertNota(input: NotaInput): Promise<Schema["Nota"]["type"]> {
  const c = getClient();
  const created = await c.models.Nota.create(input);
  if (!created.errors) return created.data!;
  if (isConditionalCheckFailed(created.errors)) {
    const updated = await c.models.Nota.update(input);
    throwOnErrors("upsertNota(update)", updated.errors);
    return updated.data!;
  }
  throwOnErrors("upsertNota(create)", created.errors);
  return created.data!;
}

export async function listNotas(tenantId: string): Promise<Schema["Nota"]["type"][]> {
  const c = getClient();
  return listAll<Schema["Nota"]["type"]>(
    (token) =>
      c.models.Nota.list({
        filter: { tenantId: { eq: tenantId } },
        limit: 1000,
        nextToken: token ?? undefined,
      }),
    "listNotas",
  );
}

// ───────────────────────── Checklist ─────────────────────────

export type ChecklistInput = {
  tenantId: string;
  unitUid: string;
  fecha: string;
  tipoInspeccion: string;
  resultados?: unknown;
  responsable?: string;
};

export async function upsertChecklist(input: ChecklistInput): Promise<Schema["Checklist"]["type"]> {
  const c = getClient();
  // AWSJSON scalar requiere STRING, no objeto. JSON.stringify explicito.
  const inputStringified = {
    ...input,
    resultados:
      typeof input.resultados === "string"
        ? input.resultados
        : JSON.stringify(input.resultados ?? {}),
  };
  const payload = inputStringified as unknown as Parameters<typeof c.models.Checklist.create>[0];
  const created = await c.models.Checklist.create(payload);
  if (!created.errors && created.data) return created.data;
  if (created.errors && isConditionalCheckFailed(created.errors)) {
    const updated = await c.models.Checklist.update(payload);
    if (updated.errors) {
      throw new Error(`upsertChecklist(update) failed: ${JSON.stringify(updated.errors)}`);
    }
    if (!updated.data) {
      throw new Error(
        `upsertChecklist(update) returned null data for ${input.unitUid}/${input.fecha}. ` +
          `Authorization rule may be filtering. Raw response: ${JSON.stringify(updated)}`,
      );
    }
    return updated.data;
  }
  if (created.errors) {
    throw new Error(`upsertChecklist(create) failed: ${JSON.stringify(created.errors)}`);
  }
  // Sin errors pero sin data — bug típico: authorization filtra post-create.
  throw new Error(
    `upsertChecklist(create) returned null data for ${input.unitUid}/${input.fecha}. ` +
      `Probable authorization filtering. Raw response: ${JSON.stringify(created)}`,
  );
}

export async function listChecklists(tenantId: string): Promise<Schema["Checklist"]["type"][]> {
  const c = getClient();
  return listAll<Schema["Checklist"]["type"]>(
    (token) =>
      c.models.Checklist.list({
        filter: { tenantId: { eq: tenantId } },
        limit: 1000,
        nextToken: token ?? undefined,
      }),
    "listChecklists",
  );
}

// ───────────────────────── Periodo ─────────────────────────

export type PeriodoInput = {
  tenantId: string;
  tipo: string; // 'semanal' | 'mensual' | 'inspeccion'
  fechaInicio: string;
  fechaFin: string;
  estatus: "abierto" | "cerrado";
};

export async function upsertPeriodo(input: PeriodoInput): Promise<Schema["Periodo"]["type"]> {
  const c = getClient();
  const created = await c.models.Periodo.create(input);
  if (!created.errors) return created.data!;
  if (isConditionalCheckFailed(created.errors)) {
    const updated = await c.models.Periodo.update(input);
    throwOnErrors("upsertPeriodo(update)", updated.errors);
    return updated.data!;
  }
  throwOnErrors("upsertPeriodo(create)", created.errors);
  return created.data!;
}

export async function listPeriodos(tenantId: string): Promise<Schema["Periodo"]["type"][]> {
  const c = getClient();
  return listAll<Schema["Periodo"]["type"]>(
    (token) =>
      c.models.Periodo.list({
        filter: { tenantId: { eq: tenantId } },
        limit: 1000,
        nextToken: token ?? undefined,
      }),
    "listPeriodos",
  );
}

// ───────────────────────── Semanal ─────────────────────────

export type SemanalInput = {
  tenantId: string;
  periodoId: string;
  sucursal: string;
  unitUid: string;
  datos?: unknown;
};

export async function upsertSemanal(input: SemanalInput): Promise<Schema["Semanal"]["type"]> {
  const c = getClient();
  // AWSJSON scalar requiere STRING, no objeto.
  const inputStringified = {
    ...input,
    datos: typeof input.datos === "string" ? input.datos : JSON.stringify(input.datos ?? {}),
  };
  const payload = inputStringified as unknown as Parameters<typeof c.models.Semanal.create>[0];
  const created = await c.models.Semanal.create(payload);
  if (!created.errors) return created.data!;
  if (isConditionalCheckFailed(created.errors)) {
    const updated = await c.models.Semanal.update(payload);
    throwOnErrors("upsertSemanal(update)", updated.errors);
    return updated.data!;
  }
  throwOnErrors("upsertSemanal(create)", created.errors);
  return created.data!;
}

export async function listSemanales(tenantId: string): Promise<Schema["Semanal"]["type"][]> {
  const c = getClient();
  return listAll<Schema["Semanal"]["type"]>(
    (token) =>
      c.models.Semanal.list({
        filter: { tenantId: { eq: tenantId } },
        limit: 1000,
        nextToken: token ?? undefined,
      }),
    "listSemanales",
  );
}
