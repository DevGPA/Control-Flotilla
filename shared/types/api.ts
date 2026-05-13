/**
 * Shared API contract types. Lambda handlers and the frontend api-client
 * both import from here, so request/response shapes can never drift.
 */

export interface ApiError {
  error: string;
  details?: unknown;
}

export interface ListResponse<T> {
  items: T[];
  nextCursor?: string;
}

export interface PresignRequest {
  scope: "images" | "weekly" | "manual";
  parentId: string;
  filename: string;
  contentType: string;
  contentHashHex?: string;
}

export interface PresignResponse {
  url: string;
  key: string;
  expiresIn: number;
}

export interface VersionedUpdate<T> {
  version: number;
  patch: Partial<T>;
}
