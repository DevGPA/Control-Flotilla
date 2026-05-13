import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import {
  extractAuth,
  getIdempotencyKey,
  json,
  errorResponse,
  httpError,
  requireRole,
} from "../lib/http.js";
import { checkIdempotency, recordResponse, deterministicId } from "../lib/idempotency.js";
import {
  createIfAbsent,
  getItem,
  keys,
  queryByTenant,
  updateWithVersion,
  type BaseItem,
} from "../lib/repo.js";

interface UnitInput {
  placa: string;
  marca?: string;
  modelo?: string;
  anio?: number;
  sucursal?: string;
  vin?: string;
}
interface Unit extends BaseItem, UnitInput {
  type: "UNIT";
}

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = extractAuth(event);
    const method = event.requestContext.http.method;
    const id = event.pathParameters?.id;

    if (method === "GET" && !id) {
      const items = await queryByTenant<Unit>(auth.orgId, { type: "UNIT" });
      return json(200, { items });
    }

    if (method === "GET" && id) {
      const item = await getItem<Unit>(keys.pk(auth.orgId), unitSK(auth.orgId, id));
      if (!item) throw httpError(404, "Not found");
      return json(200, item);
    }

    if (method === "POST") {
      requireRole(auth, "admin", "editor");
      const body = parseBody<UnitInput>(event.body);
      if (!body.placa) throw httpError(400, "placa required");

      const idemKey = buildIdemKey(auth.userId, "POST", "/units", getIdempotencyKey(event));
      const gate = await checkIdempotency<APIGatewayProxyResultV2>(idemKey);
      if (gate.kind === "replay") return gate.cachedResponse;

      const unitId = deterministicId(auth.orgId, "UNIT", body.placa);
      const now = new Date().toISOString();
      const item: Unit = {
        PK: keys.pk(auth.orgId),
        SK: unitSK(auth.orgId, unitId),
        type: "UNIT",
        id: unitId,
        tenantId: auth.orgId,
        createdAt: now,
        updatedAt: now,
        version: 1,
        ...keys.gsi1(body.placa, now),
        ...(body.sucursal ? keys.gsi2(body.sucursal, now) : {}),
        ...body,
      };

      const created = await createIfAbsent(item);
      const response = created ? json(201, item) : json(200, await getItem<Unit>(item.PK, item.SK));

      await recordResponse(idemKey, response);
      return response;
    }

    if (method === "PUT" && id) {
      requireRole(auth, "admin", "editor");
      const body = parseBody<Partial<UnitInput> & { version: number }>(event.body);
      if (typeof body.version !== "number") {
        throw httpError(400, "version required for optimistic lock");
      }
      const updated = await updateWithVersion(
        keys.pk(auth.orgId),
        unitSK(auth.orgId, id),
        body.version,
        body,
      );
      if (!updated) throw httpError(409, "Version conflict — refetch and retry");
      return json(200, updated);
    }

    throw httpError(405, "Method not allowed");
  } catch (err) {
    return errorResponse(err);
  }
};

function unitSK(_tenantId: string, id: string): string {
  return `0000-00-00#UNIT#${id}`;
}

function parseBody<T>(raw: string | null | undefined): T {
  if (!raw) throw httpError(400, "Body required");
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw httpError(400, "Invalid JSON");
  }
}

function buildIdemKey(
  userId: string,
  method: string,
  path: string,
  clientKey: string | undefined,
): string {
  const k = clientKey ?? `auto-${Date.now()}-${Math.random()}`;
  return `${userId}:${method}:${path}:${k}`;
}
