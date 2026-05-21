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

// ───────────────────────── Unit ─────────────────────────

export type UnitInput = {
  tenantId: string;
  placa: string;
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
  const { data, errors } = await c.models.Unit.list({
    filter: { tenantId: { eq: tenantId } },
  });
  throwOnErrors("listUnits", errors);
  return data;
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
};

export async function upsertTaller(input: TallerInput): Promise<Schema["Taller"]["type"]> {
  const c = getClient();
  const created = await c.models.Taller.create(input);
  if (!created.errors) return created.data!;
  if (isConditionalCheckFailed(created.errors)) {
    const updated = await c.models.Taller.update(input);
    throwOnErrors("upsertTaller(update)", updated.errors);
    return updated.data!;
  }
  throwOnErrors("upsertTaller(create)", created.errors);
  return created.data!;
}

export async function listTaller(tenantId: string): Promise<Schema["Taller"]["type"][]> {
  const c = getClient();
  const { data, errors } = await c.models.Taller.list({
    filter: { tenantId: { eq: tenantId } },
  });
  throwOnErrors("listTaller", errors);
  return data;
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
  const { data, errors } = await c.models.Nota.list({
    filter: { tenantId: { eq: tenantId } },
  });
  throwOnErrors("listNotas", errors);
  return data;
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

export async function upsertChecklist(
  input: ChecklistInput,
): Promise<Schema["Checklist"]["type"]> {
  const c = getClient();
  // resultados es a.json() → cast para que el SDK acepte arbitrary.
  const payload = input as unknown as Parameters<typeof c.models.Checklist.create>[0];
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

export async function listChecklists(
  tenantId: string,
): Promise<Schema["Checklist"]["type"][]> {
  const c = getClient();
  const { data, errors } = await c.models.Checklist.list({
    filter: { tenantId: { eq: tenantId } },
  });
  throwOnErrors("listChecklists", errors);
  return data;
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
  const { data, errors } = await c.models.Periodo.list({
    filter: { tenantId: { eq: tenantId } },
  });
  throwOnErrors("listPeriodos", errors);
  return data;
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
  const payload = input as unknown as Parameters<typeof c.models.Semanal.create>[0];
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
  const { data, errors } = await c.models.Semanal.list({
    filter: { tenantId: { eq: tenantId } },
  });
  throwOnErrors("listSemanales", errors);
  return data;
}
