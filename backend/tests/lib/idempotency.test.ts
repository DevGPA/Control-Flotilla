import { describe, it, expect, beforeEach, beforeAll } from "vitest";

beforeAll(() => {
  process.env.IDEMPOTENCY_TABLE = "test-idempotency";
  process.env.APP_TABLE = "test-app";
  process.env.AWS_REGION = "us-east-1";
  process.env.AWS_ACCESS_KEY_ID = "test";
  process.env.AWS_SECRET_ACCESS_KEY = "test";
});

import { mockClient } from "aws-sdk-client-mock";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const ddbMock = mockClient(DynamoDBDocumentClient);

const { deterministicId, contentHash, checkIdempotency, recordResponse } =
  await import("../../src/lib/idempotency.js");

beforeEach(() => {
  ddbMock.reset();
});

describe("deterministicId", () => {
  it("produces same id for same inputs", () => {
    const a = deterministicId("gpa", "UNIT", "ABC-123");
    const b = deterministicId("gpa", "UNIT", "ABC-123");
    expect(a).toBe(b);
  });

  it("produces different id for different inputs", () => {
    const a = deterministicId("gpa", "UNIT", "ABC-123");
    const b = deterministicId("gpa", "UNIT", "ABC-124");
    expect(a).not.toBe(b);
  });

  it("is order-sensitive (tenant#placa != placa#tenant)", () => {
    const a = deterministicId("gpa", "ABC-123");
    const b = deterministicId("ABC-123", "gpa");
    expect(a).not.toBe(b);
  });

  it("returns UUID-shaped string (8-4-4-4-12 hex)", () => {
    const id = deterministicId("gpa", "UNIT", "X");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("isolates by tenant — same placa, different tenants → different ids", () => {
    const a = deterministicId("gpa", "UNIT", "ABC-123");
    const b = deterministicId("other-org", "UNIT", "ABC-123");
    expect(a).not.toBe(b);
  });
});

describe("contentHash", () => {
  it("is stable across calls", () => {
    const payload = { placa: "ABC-123", sucursal: "MTY" };
    expect(contentHash(payload)).toBe(contentHash(payload));
  });

  it("differs when payload differs", () => {
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });

  it("is sensitive to key order — JSON.stringify preserves insertion order", () => {
    // Documented behavior: callers must pass keys in stable order, or use a
    // canonicalizer before hashing if dedup across reordered payloads matters.
    expect(contentHash({ a: 1, b: 2 })).not.toBe(contentHash({ b: 2, a: 1 }));
  });

  it("returns 64-char hex (SHA-256)", () => {
    const h = contentHash({ x: 1 });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("checkIdempotency", () => {
  it("returns 'fresh' when no prior entry exists", async () => {
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const result = await checkIdempotency<{ ok: boolean }>("user1:POST:/units:abc");
    expect(result.kind).toBe("fresh");
  });

  it("returns 'replay' with cached response when prior completed entry exists", async () => {
    const cached = { statusCode: 201, body: '{"id":"x"}' };
    ddbMock.on(GetCommand).resolves({
      Item: { idempotencyKey: "k", status: "completed", response: cached },
    });

    const result = await checkIdempotency<typeof cached>("k");
    expect(result.kind).toBe("replay");
    if (result.kind === "replay") {
      expect(result.cachedResponse).toEqual(cached);
    }
  });

  it("handles race: Put conditional check fails → falls back to Get and replays", async () => {
    const cached = { ok: true };
    ddbMock
      .on(GetCommand)
      .resolvesOnce({})
      .resolvesOnce({
        Item: { idempotencyKey: "k", status: "completed", response: cached },
      });
    ddbMock
      .on(PutCommand)
      .rejectsOnce(new ConditionalCheckFailedException({ $metadata: {}, message: "race" }));

    const result = await checkIdempotency<typeof cached>("k");
    expect(result.kind).toBe("replay");
  });

  it("rethrows non-ConditionalCheckFailed errors", async () => {
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(PutCommand).rejects(new Error("network blew up"));

    await expect(checkIdempotency("k")).rejects.toThrow("network blew up");
  });
});

describe("recordResponse", () => {
  it("writes the cached response with TTL", async () => {
    ddbMock.on(PutCommand).resolves({});
    await recordResponse("k", { ok: true });

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls.length).toBe(1);
    const input = calls[0]!.args[0].input;
    expect(input.Item?.idempotencyKey).toBe("k");
    expect(input.Item?.status).toBe("completed");
    expect(input.Item?.response).toEqual({ ok: true });
    expect(typeof input.Item?.expiresAt).toBe("number");
    // TTL ~24h ahead (allow drift)
    const expected = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    expect(Math.abs((input.Item!.expiresAt as number) - expected)).toBeLessThan(60);
  });
});
