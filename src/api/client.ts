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
  // No truncar en silencio: si llegamos al tope con token pendiente, faltan datos.
  if (token && pages >= 100) {
    console.warn(
      `[${label}] paginación cortada en 100 páginas (${out.length} ítems) con nextToken pendiente — datos incompletos`,
    );
  }
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
  productoToka?: string;
  area?: string;
};

export async function upsertUnit(input: UnitInput): Promise<Schema["Unit"]["type"]> {
  const c = getClient();
  const created = await c.models.Unit.create(input);
  if (!created.errors) {
    if (!created.data)
      throw new Error(
        `upsertUnit(create) sin errores pero sin data (¿auth filtering?): ${JSON.stringify(created)}`,
      );
    return created.data;
  }
  if (isConditionalCheckFailed(created.errors)) {
    const updated = await c.models.Unit.update(input);
    throwOnErrors("upsertUnit(update)", updated.errors);
    if (!updated.data) throw new Error(`upsertUnit(update) sin data: ${JSON.stringify(updated)}`);
    return updated.data;
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

/** Borra una unidad del catálogo (composite id tenantId+placa). */
export async function deleteUnit(input: { tenantId: string; placa: string }): Promise<void> {
  const c = getClient();
  const { errors } = await c.models.Unit.delete(input);
  throwOnErrors("deleteUnit", errors);
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
    if (!updated.data)
      throw new Error(
        `upsertTaller(update) sin data (¿auth filtering?): ${JSON.stringify(updated)}`,
      );
    return updated.data;
  }
  if (created.errors)
    throw new Error(`upsertTaller(create) failed: ${JSON.stringify(created.errors)}`);
  throw new Error(`upsertTaller(create) sin errores pero sin data: ${JSON.stringify(created)}`);
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

/**
 * Localiza TODAS las filas cloud de un registro de taller por su id legacy
 * (folio) — Fase C2 (audit 2026-06-04 P1 #10/H13). Las filas históricas se
 * escribieron con claves irreproducibles (fallback a `updatedAt` regenerado),
 * así que para editar/borrar NUNCA se recomputa la clave: se busca por
 * `folio === id` (batchUpload siempre escribe folio=e.id) con fallback a
 * `datos.id === id` (filas muy viejas sin folio), y cada fila encontrada se
 * borra por SU clave real (unitUid, fechaEntrada).
 */
export async function findCloudTallerByFolio(
  tenantId: string,
  folioId: string,
): Promise<Schema["Taller"]["type"][]> {
  if (!folioId) return [];
  const rows = await listTaller(tenantId);
  return rows.filter((t) => {
    if (t.folio === folioId) return true;
    try {
      const datos =
        typeof t.datos === "string"
          ? (JSON.parse(t.datos) as { id?: unknown })
          : ((t.datos ?? {}) as { id?: unknown });
      return String(datos.id ?? "") === folioId;
    } catch {
      return false;
    }
  });
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
  if (!created.errors && created.data) return created.data;
  if (created.errors && isConditionalCheckFailed(created.errors)) {
    const updated = await c.models.Nota.update(input);
    throwOnErrors("upsertNota(update)", updated.errors);
    if (!updated.data)
      throw new Error(`upsertNota(update) null data para ${input.unitUid} — auth filtering?`);
    return updated.data;
  }
  throwOnErrors("upsertNota(create)", created.errors);
  // Sin errors pero sin data = authorization filtra post-create (bug clase re-key).
  throw new Error(`upsertNota(create) null data para ${input.unitUid} — auth filtering?`);
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
  if (!created.errors && created.data) return created.data;
  if (created.errors && isConditionalCheckFailed(created.errors)) {
    const updated = await c.models.Periodo.update(input);
    throwOnErrors("upsertPeriodo(update)", updated.errors);
    if (!updated.data) throw new Error(`upsertPeriodo(update) null data — auth filtering?`);
    return updated.data;
  }
  throwOnErrors("upsertPeriodo(create)", created.errors);
  throw new Error(`upsertPeriodo(create) null data — auth filtering?`);
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
  if (!created.errors && created.data) return created.data;
  if (created.errors && isConditionalCheckFailed(created.errors)) {
    const updated = await c.models.Semanal.update(payload);
    throwOnErrors("upsertSemanal(update)", updated.errors);
    if (!updated.data)
      throw new Error(`upsertSemanal(update) null data para ${input.unitUid} — auth filtering?`);
    return updated.data;
  }
  throwOnErrors("upsertSemanal(create)", created.errors);
  throw new Error(`upsertSemanal(create) null data para ${input.unitUid} — auth filtering?`);
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

// ───────────────────────── CheckDone (completaciones compartidas) ─────────────────────────

export type CheckDoneInput = {
  tenantId: string;
  unitUid: string;
  itemKey: string;
  done?: boolean;
  por?: string;
  ts?: string;
};

export async function upsertCheckDone(input: CheckDoneInput): Promise<Schema["CheckDone"]["type"]> {
  const c = getClient();
  const payload = { done: true, ...input };
  const created = await c.models.CheckDone.create(payload);
  if (!created.errors && created.data) return created.data;
  if (created.errors && isConditionalCheckFailed(created.errors)) {
    const updated = await c.models.CheckDone.update(payload);
    throwOnErrors("upsertCheckDone(update)", updated.errors);
    if (!updated.data)
      throw new Error(`upsertCheckDone(update) null data ${input.unitUid}/${input.itemKey}`);
    return updated.data;
  }
  throwOnErrors("upsertCheckDone(create)", created.errors);
  throw new Error(`upsertCheckDone(create) null data ${input.unitUid}/${input.itemKey}`);
}

export async function deleteCheckDone(input: {
  tenantId: string;
  unitUid: string;
  itemKey: string;
}): Promise<void> {
  const c = getClient();
  const { errors } = await c.models.CheckDone.delete(input);
  throwOnErrors("deleteCheckDone", errors);
}

export async function listCheckDone(tenantId: string): Promise<Schema["CheckDone"]["type"][]> {
  const c = getClient();
  return listAll<Schema["CheckDone"]["type"]>(
    (token) =>
      c.models.CheckDone.list({
        filter: { tenantId: { eq: tenantId } },
        limit: 1000,
        nextToken: token ?? undefined,
      }),
    "listCheckDone",
  );
}

// ───────────────────────── Combustible (Solicitudes/Cargas) ─────────────────────────
// Solo LECTURA desde el front (lo ingiere el webhook de MoreApp). El estado de
// revisión humana se persiste aparte en ValidacionCarga (upsert idempotente).

export async function listCombustible(
  tenantId: string,
): Promise<Schema["CargaCombustible"]["type"][]> {
  const c = getClient();
  return listAll<Schema["CargaCombustible"]["type"]>(
    (token) =>
      c.models.CargaCombustible.list({
        filter: { tenantId: { eq: tenantId } },
        limit: 1000,
        nextToken: token ?? undefined,
      }),
    "listCombustible",
  );
}

/**
 * Perf F3-1/F3-2: cargas de combustible por VENTANA de fechas vía el GSI
 * byTenantAndFecha — Query real de DynamoDB (KeyCondition tenantId + fecha BETWEEN),
 * no Scan del histórico completo. Es la tabla más grande del sistema (~1k filas/mes);
 * el costo queda O(ventana) en vez de O(histórico).
 *
 * `fromISO`/`toISO` en YYYY-MM-DD (mismo formato que CargaCombustible.fecha).
 */
export async function listCombustibleRange(
  tenantId: string,
  fromISO: string,
  toISO: string,
): Promise<Schema["CargaCombustible"]["type"][]> {
  const c = getClient();
  return listAll<Schema["CargaCombustible"]["type"]>(
    (token) =>
      c.models.CargaCombustible.listCargaCombustibleByTenantIdAndFecha(
        { tenantId, fecha: { between: [fromISO, toISO] } },
        { limit: 1000, nextToken: token ?? undefined },
      ),
    "listCombustibleRange",
  );
}

export type ValidacionCargaInput = {
  tenantId: string;
  loadId: string;
  verdictGlobal?: string;
  porEvidencia?: unknown;
  revisadoPor?: string;
  nota?: string;
  ts?: string;
  // Origen del veredicto ('manual' | 'ia' | 'ops-gpa'). Debe persistirse: el receptor del
  // puente Ops-GPA lee este campo (no el local) para decidir si respeta una validación
  // humana ya guardada — sin esto, un reenvío del webhook pisa el veredicto de tesorería.
  fuenteDeteccion?: string;
};

export async function upsertValidacionCarga(
  input: ValidacionCargaInput,
): Promise<Schema["ValidacionCarga"]["type"]> {
  const c = getClient();
  // porEvidencia es a.json() → AWSJSON requiere STRING.
  const inputStringified = {
    ...input,
    porEvidencia:
      typeof input.porEvidencia === "string"
        ? input.porEvidencia
        : JSON.stringify(input.porEvidencia ?? {}),
  };
  const payload = inputStringified as unknown as Parameters<
    typeof c.models.ValidacionCarga.create
  >[0];
  const created = await c.models.ValidacionCarga.create(payload);
  if (!created.errors && created.data) return created.data;
  if (created.errors && isConditionalCheckFailed(created.errors)) {
    const updated = await c.models.ValidacionCarga.update(payload);
    throwOnErrors("upsertValidacionCarga(update)", updated.errors);
    if (!updated.data)
      throw new Error(`upsertValidacionCarga(update) null data ${input.loadId} — auth filtering?`);
    return updated.data;
  }
  throwOnErrors("upsertValidacionCarga(create)", created.errors);
  throw new Error(`upsertValidacionCarga(create) null data ${input.loadId} — auth filtering?`);
}

export async function listValidaciones(
  tenantId: string,
): Promise<Schema["ValidacionCarga"]["type"][]> {
  const c = getClient();
  return listAll<Schema["ValidacionCarga"]["type"]>(
    (token) =>
      c.models.ValidacionCarga.list({
        filter: { tenantId: { eq: tenantId } },
        limit: 1000,
        nextToken: token ?? undefined,
      }),
    "listValidaciones",
  );
}

// ───────────────────────── Anulación admin (Anulacion) ─────────────────────────
// Tombstone lógico reversible de registros de evento (ver src/anulacion/anulacion.ts).
// Escritura SOLO admin (AppSync valida el grupo); todos los del tenant leen.

export type AnulacionInput = {
  tenantId: string;
  refId: string;
  modulo: string; // 'combustible' | 'checklist' | 'semanal'
  motivo: string;
  anuladoPor: string;
  ts: string;
};

/**
 * Anula un registro (upsert idempotente por refId). Re-anular tras una restauración
 * ACTUALIZA la fila: nuevo motivo/anuladoPor/ts y limpia restauradaPor/Ts.
 */
export async function upsertAnulacion(input: AnulacionInput): Promise<Schema["Anulacion"]["type"]> {
  const c = getClient();
  const payload = {
    ...input,
    restauradaPor: null,
    restauradaTs: null,
  } as unknown as Parameters<typeof c.models.Anulacion.create>[0];
  const created = await c.models.Anulacion.create(payload);
  if (!created.errors && created.data) return created.data;
  if (created.errors && isConditionalCheckFailed(created.errors)) {
    const updated = await c.models.Anulacion.update(payload);
    throwOnErrors("upsertAnulacion(update)", updated.errors);
    if (!updated.data)
      throw new Error(`upsertAnulacion(update) null data ${input.refId} — auth filtering?`);
    return updated.data;
  }
  throwOnErrors("upsertAnulacion(create)", created.errors);
  throw new Error(`upsertAnulacion(create) null data ${input.refId} — auth filtering?`);
}

/**
 * Restaura un registro anulado: NO borra la fila — la marca con restauradaPor/Ts
 * (historial bidireccional para auditoría). La exclusión deja de aplicar.
 */
export async function restaurarAnulacion(
  tenantId: string,
  refId: string,
  restauradaPor: string,
): Promise<Schema["Anulacion"]["type"]> {
  const c = getClient();
  const updated = await c.models.Anulacion.update({
    tenantId,
    refId,
    restauradaPor,
    restauradaTs: new Date().toISOString(),
  } as unknown as Parameters<typeof c.models.Anulacion.update>[0]);
  throwOnErrors("restaurarAnulacion", updated.errors);
  if (!updated.data)
    throw new Error(`restaurarAnulacion null data ${refId} — ¿no existe o auth filtering?`);
  return updated.data;
}

export async function listAnulaciones(tenantId: string): Promise<Schema["Anulacion"]["type"][]> {
  const c = getClient();
  return listAll<Schema["Anulacion"]["type"]>(
    (token) =>
      c.models.Anulacion.list({
        filter: { tenantId: { eq: tenantId } },
        limit: 1000,
        nextToken: token ?? undefined,
      }),
    "listAnulaciones",
  );
}

// ───────────────────────── Cumplimiento (ComplianceDoc) ─────────────────────────
// Expediente de cumplimiento por unidad (captura manual operativo/admin). Identidad
// (tenantId, economicoId, docId). El estado vencido/por-vencer se DERIVA en el front
// (complianceStatus), no se persiste. Upsert idempotente como el resto de modelos.

export type ComplianceDocInput = {
  tenantId: string;
  economicoId: string;
  docId: string;
  tipoDoc: string;
  jurisdiccion?: string;
  fechaVencimiento?: string;
  fechaEmision?: string;
  referencia?: string;
  monto?: number;
  fuente?: string;
  evidenciaFname?: string;
  operador?: string;
  nota?: string;
  ultimaActualizacion?: string;
};

export async function upsertComplianceDoc(
  input: ComplianceDocInput,
): Promise<Schema["ComplianceDoc"]["type"]> {
  const c = getClient();
  const created = await c.models.ComplianceDoc.create(input);
  if (!created.errors && created.data) return created.data;
  if (created.errors && isConditionalCheckFailed(created.errors)) {
    const updated = await c.models.ComplianceDoc.update(input);
    throwOnErrors("upsertComplianceDoc(update)", updated.errors);
    if (!updated.data)
      throw new Error(
        `upsertComplianceDoc(update) null data ${input.economicoId}/${input.docId} — auth filtering?`,
      );
    return updated.data;
  }
  throwOnErrors("upsertComplianceDoc(create)", created.errors);
  throw new Error(
    `upsertComplianceDoc(create) null data ${input.economicoId}/${input.docId} — auth filtering?`,
  );
}

export async function listComplianceDocs(
  tenantId: string,
): Promise<Schema["ComplianceDoc"]["type"][]> {
  const c = getClient();
  return listAll<Schema["ComplianceDoc"]["type"]>(
    (token) =>
      c.models.ComplianceDoc.list({
        filter: { tenantId: { eq: tenantId } },
        limit: 1000,
        nextToken: token ?? undefined,
      }),
    "listComplianceDocs",
  );
}

export async function deleteComplianceDoc(input: {
  tenantId: string;
  economicoId: string;
  docId: string;
}): Promise<void> {
  const c = getClient();
  const { errors } = await c.models.ComplianceDoc.delete(input);
  throwOnErrors("deleteComplianceDoc", errors);
}

// ───────────────────────── Administración de Usuarios (2026-06-12) ─────────────
// PRIMER uso de client.mutations/queries (custom ops). Cada op devuelve a.json()
// con forma { ok, message?, error?, data? }. La autorización (grupo admin) la
// hace AppSync; aquí solo se envuelve la llamada y se normaliza el resultado.

export type AdminResult = { ok: boolean; message?: string; error?: string; data?: unknown };

function asAdminResult(raw: unknown): AdminResult {
  const v = typeof raw === "string" ? safeJson(raw) : raw;
  if (v && typeof v === "object") return v as AdminResult;
  return { ok: false, error: "Respuesta del servidor no reconocida." };
}
function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export type AdminCreateInput = {
  email: string;
  nombre: string;
  telefono?: string;
  rol: string;
  sucursal?: string;
  /** CSV de módulos permitidos (custom:modulos). Vacío = todos. */
  modulos?: string;
};

export async function adminCreateUser(input: AdminCreateInput): Promise<AdminResult> {
  const c = getClient();
  const r = await c.mutations.adminCreateUser(input);
  throwOnErrors("adminCreateUser", r.errors as readonly GraphQLError[] | undefined);
  return asAdminResult(r.data);
}

export async function adminUpdateUser(input: {
  cognitoSub: string;
  nombre?: string;
  telefono?: string;
  sucursal?: string;
  modulos?: string;
}): Promise<AdminResult> {
  const c = getClient();
  const r = await c.mutations.adminUpdateUser(input);
  throwOnErrors("adminUpdateUser", r.errors as readonly GraphQLError[] | undefined);
  return asAdminResult(r.data);
}

export async function adminSetEnabled(cognitoSub: string, enabled: boolean): Promise<AdminResult> {
  const c = getClient();
  const r = await c.mutations.adminSetEnabled({ cognitoSub, enabled });
  throwOnErrors("adminSetEnabled", r.errors as readonly GraphQLError[] | undefined);
  return asAdminResult(r.data);
}

export async function adminDeleteUser(cognitoSub: string): Promise<AdminResult> {
  const c = getClient();
  const r = await c.mutations.adminDeleteUser({ cognitoSub });
  throwOnErrors("adminDeleteUser", r.errors as readonly GraphQLError[] | undefined);
  return asAdminResult(r.data);
}

export async function adminResetPassword(cognitoSub: string): Promise<AdminResult> {
  const c = getClient();
  const r = await c.mutations.adminResetPassword({ cognitoSub });
  throwOnErrors("adminResetPassword", r.errors as readonly GraphQLError[] | undefined);
  return asAdminResult(r.data);
}

export async function adminSetRole(cognitoSub: string, rol: string): Promise<AdminResult> {
  const c = getClient();
  const r = await c.mutations.adminSetRole({ cognitoSub, rol });
  throwOnErrors("adminSetRole", r.errors as readonly GraphQLError[] | undefined);
  return asAdminResult(r.data);
}

export async function adminListUsers(): Promise<AdminResult> {
  const c = getClient();
  const r = await c.queries.adminListUsers();
  throwOnErrors("adminListUsers", r.errors as readonly GraphQLError[] | undefined);
  return asAdminResult(r.data);
}

/** Bitácora: lee AuditEvent directamente del modelo (solo admin, paginado). */
export async function listAuditEvents(tenantId: string): Promise<Schema["AuditEvent"]["type"][]> {
  const c = getClient();
  return listAll<Schema["AuditEvent"]["type"]>(
    (token) =>
      c.models.AuditEvent.list({
        filter: { tenantId: { eq: tenantId } },
        limit: 1000,
        nextToken: token ?? undefined,
      }),
    "listAuditEvents",
  );
}
