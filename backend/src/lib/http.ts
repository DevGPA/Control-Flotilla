import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";

export interface AuthContext {
  userId: string;
  email: string;
  orgId: string;
  role: "admin" | "editor" | "viewer";
}

export function extractAuth(event: APIGatewayProxyEventV2WithJWTAuthorizer): AuthContext {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const orgId = (claims["custom:orgId"] as string) ?? "";
  const role = ((claims["custom:role"] as string) ?? "viewer") as AuthContext["role"];
  if (!orgId) throw httpError(403, "Missing orgId claim");
  return {
    userId: String(claims.sub ?? ""),
    email: String(claims.email ?? ""),
    orgId,
    role,
  };
}

export function requireRole(
  auth: AuthContext,
  ...allowed: ReadonlyArray<AuthContext["role"]>
): void {
  if (!allowed.includes(auth.role)) {
    throw httpError(403, `Role ${auth.role} not permitted`);
  }
}

export function getIdempotencyKey(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): string | undefined {
  const headers = event.headers ?? {};
  return headers["idempotency-key"] ?? headers["Idempotency-Key"];
}

export function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function httpError(statusCode: number, message: string): HttpError {
  return new HttpError(statusCode, message);
}

export function errorResponse(err: unknown): APIGatewayProxyResultV2 {
  if (err instanceof HttpError) {
    return json(err.statusCode, { error: err.message });
  }
  console.error("unhandled", err);
  return json(500, { error: "Internal error" });
}
