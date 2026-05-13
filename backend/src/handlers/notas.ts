import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { extractAuth, json, errorResponse } from "../lib/http.js";
import { queryByTenant } from "../lib/repo.js";

/**
 * Notas — stub for Fase 1. Full CRUD lands in Fase 5.
 * Natural key for dedup: (unitUid + timestamp + autorId).
 */
export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = extractAuth(event);
    const method = event.requestContext.http.method;
    if (method === "GET") {
      const items = await queryByTenant(auth.orgId, { type: "NOTA" });
      return json(200, { items });
    }
    return json(501, { error: "Not implemented — landing in Fase 5" });
  } catch (err) {
    return errorResponse(err);
  }
};
