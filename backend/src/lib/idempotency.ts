import { createHash } from "node:crypto";
import { DynamoDBClient, ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.IDEMPOTENCY_TABLE!;
const TTL_SECONDS = 24 * 60 * 60;

export type IdempotencyResult<T> = { kind: "fresh" } | { kind: "replay"; cachedResponse: T };

/**
 * Deterministic UUID-like id from natural key. Same input → same id.
 * Use for entity IDs so duplicate POSTs map to the same DDB PK.
 */
export function deterministicId(...parts: ReadonlyArray<string>): string {
  const h = createHash("sha256").update(parts.join("|")).digest("hex");
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)].join(
    "-",
  );
}

/**
 * SHA-256 of payload as content-addressable id. Same payload bytes → same id.
 * Use when natural key isn't obvious.
 */
export function contentHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Idempotency gate. Call BEFORE doing the work.
 *   - fresh   → proceed, then call `recordResponse` with final body.
 *   - replay  → return `cachedResponse` directly to client; do NOT re-execute.
 *
 * Key recipe: `${userId}:${method}:${path}:${clientKey}`.
 * Conditional Put prevents two concurrent requests from both being "fresh".
 */
export async function checkIdempotency<T>(idempotencyKey: string): Promise<IdempotencyResult<T>> {
  const existing = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { idempotencyKey },
      ConsistentRead: true,
    }),
  );

  if (existing.Item) {
    return {
      kind: "replay",
      cachedResponse: existing.Item.response as T,
    };
  }

  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          idempotencyKey,
          status: "in-flight",
          expiresAt: Math.floor(Date.now() / 1000) + TTL_SECONDS,
        },
        ConditionExpression: "attribute_not_exists(idempotencyKey)",
      }),
    );
    return { kind: "fresh" };
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      const race = await ddb.send(new GetCommand({ TableName: TABLE, Key: { idempotencyKey } }));
      if (race.Item?.response) {
        return {
          kind: "replay",
          cachedResponse: race.Item.response as T,
        };
      }
    }
    throw err;
  }
}

export async function recordResponse<T>(idempotencyKey: string, response: T): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        idempotencyKey,
        status: "completed",
        response,
        expiresAt: Math.floor(Date.now() / 1000) + TTL_SECONDS,
      },
    }),
  );
}
