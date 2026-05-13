import { describe, it, expect, beforeEach, beforeAll } from "vitest";

beforeAll(() => {
  process.env.APP_TABLE = "test-app";
  process.env.IDEMPOTENCY_TABLE = "test-idempotency";
  process.env.AWS_REGION = "us-east-1";
  process.env.AWS_ACCESS_KEY_ID = "test";
  process.env.AWS_SECRET_ACCESS_KEY = "test";
});

import { mockClient } from "aws-sdk-client-mock";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

const ddbMock = mockClient(DynamoDBDocumentClient);

const {
  keys,
  createIfAbsent,
  updateWithVersion,
  getItem,
  deleteItem,
  queryByTenant,
  queryByUnit,
  queryByBranch,
} = await import("../../src/lib/repo.js");

beforeEach(() => {
  ddbMock.reset();
});

describe("keys helpers", () => {
  it("pk formats TENANT prefix", () => {
    expect(keys.pk("gpa")).toBe("TENANT#gpa");
  });

  it("sk concatenates date#type#id", () => {
    expect(keys.sk("2026-05-13", "UNIT", "abc")).toBe("2026-05-13#UNIT#abc");
  });

  it("gsi1 emits UNIT prefix + date", () => {
    expect(keys.gsi1("ABC-123", "2026-05-13")).toEqual({
      GSI1PK: "UNIT#ABC-123",
      GSI1SK: "2026-05-13",
    });
  });

  it("gsi2 emits BRANCH prefix + date", () => {
    expect(keys.gsi2("MTY", "2026-05-13")).toEqual({
      GSI2PK: "BRANCH#MTY",
      GSI2SK: "2026-05-13",
    });
  });
});

describe("createIfAbsent — dedup via conditional write", () => {
  const item = {
    PK: "TENANT#gpa",
    SK: "2026-05-13#UNIT#abc",
    type: "UNIT" as const,
    id: "abc",
    tenantId: "gpa",
    createdAt: "2026-05-13T00:00:00Z",
    updatedAt: "2026-05-13T00:00:00Z",
    version: 1,
  };

  it("returns true when PK+SK didn't exist (fresh insert)", async () => {
    ddbMock.on(PutCommand).resolves({});
    const result = await createIfAbsent(item);
    expect(result).toBe(true);

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls.length).toBe(1);
    expect(calls[0]!.args[0].input.ConditionExpression).toContain("attribute_not_exists(PK)");
    expect(calls[0]!.args[0].input.ConditionExpression).toContain("attribute_not_exists(SK)");
  });

  it("returns false when PK+SK already exist (duplicate prevented)", async () => {
    ddbMock
      .on(PutCommand)
      .rejects(new ConditionalCheckFailedException({ $metadata: {}, message: "exists" }));
    const result = await createIfAbsent(item);
    expect(result).toBe(false);
  });

  it("rethrows non-conditional errors", async () => {
    ddbMock.on(PutCommand).rejects(new Error("throttled"));
    await expect(createIfAbsent(item)).rejects.toThrow("throttled");
  });
});

describe("updateWithVersion — optimistic locking", () => {
  it("increments version + applies patch when expected version matches", async () => {
    const updated = {
      PK: "TENANT#gpa",
      SK: "2026-05-13#UNIT#abc",
      type: "UNIT",
      version: 2,
      sucursal: "MTY",
    };
    ddbMock.on(UpdateCommand).resolves({ Attributes: updated });

    const result = await updateWithVersion("TENANT#gpa", "2026-05-13#UNIT#abc", 1, {
      sucursal: "MTY",
    });

    expect(result).toEqual(updated);
    const calls = ddbMock.commandCalls(UpdateCommand);
    const input = calls[0]!.args[0].input;
    expect(input.ConditionExpression).toBe("#v = :expectedV");
    expect(input.ExpressionAttributeValues?.[":expectedV"]).toBe(1);
    expect(input.ExpressionAttributeValues?.[":nextV"]).toBe(2);
  });

  it("returns null when version mismatch (concurrent edit conflict)", async () => {
    ddbMock
      .on(UpdateCommand)
      .rejects(new ConditionalCheckFailedException({ $metadata: {}, message: "mismatch" }));

    const result = await updateWithVersion("TENANT#gpa", "SK", 1, { x: 1 });
    expect(result).toBeNull();
  });

  it("skips PK, SK, version, createdAt from patch (cannot mutate)", async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { version: 2 } });

    await updateWithVersion("TENANT#gpa", "SK", 1, {
      PK: "MALICIOUS",
      SK: "MALICIOUS",
      version: 999,
      createdAt: "rewrite",
      legitField: "ok",
    });

    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    const exprNames = input.ExpressionAttributeNames ?? {};
    const valueKeys = Object.keys(input.ExpressionAttributeValues ?? {});
    // Should set legitField but NOT PK/SK/version/createdAt
    expect(Object.values(exprNames)).toContain("legitField");
    expect(Object.values(exprNames)).not.toContain("PK");
    expect(Object.values(exprNames)).not.toContain("SK");
    expect(Object.values(exprNames)).not.toContain("createdAt");
    // version is set internally via #v = :nextV, not from user patch
    expect(valueKeys).not.toContain(":a_version");
  });

  it("rethrows non-conditional errors", async () => {
    ddbMock.on(UpdateCommand).rejects(new Error("provisioned throughput"));
    await expect(updateWithVersion("PK", "SK", 1, {})).rejects.toThrow("provisioned throughput");
  });
});

describe("getItem", () => {
  it("returns Item when present", async () => {
    const item = { PK: "TENANT#gpa", SK: "x", type: "UNIT" };
    ddbMock.on(GetCommand).resolves({ Item: item });
    const result = await getItem("TENANT#gpa", "x");
    expect(result).toEqual(item);
  });

  it("returns null when absent", async () => {
    ddbMock.on(GetCommand).resolves({});
    const result = await getItem("TENANT#gpa", "x");
    expect(result).toBeNull();
  });
});

describe("deleteItem", () => {
  it("issues DeleteCommand with correct key", async () => {
    ddbMock.on(DeleteCommand).resolves({});
    await deleteItem("TENANT#gpa", "x");
    const calls = ddbMock.commandCalls(DeleteCommand);
    expect(calls[0]!.args[0].input.Key).toEqual({ PK: "TENANT#gpa", SK: "x" });
  });
});

describe("queries", () => {
  it("queryByTenant filters by type when requested", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { type: "UNIT", id: "1" },
        { type: "TALLER", id: "2" },
        { type: "UNIT", id: "3" },
      ],
    });
    const result = await queryByTenant("gpa", { type: "UNIT" });
    expect(result).toHaveLength(2);
    expect(result.every((i) => i.type === "UNIT")).toBe(true);
  });

  it("queryByTenant returns all items when no type filter", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ type: "UNIT" }, { type: "TALLER" }],
    });
    const result = await queryByTenant("gpa");
    expect(result).toHaveLength(2);
  });

  it("queryByUnit hits GSI1 with UNIT# prefix", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    await queryByUnit("ABC-123");
    const input = ddbMock.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(input.IndexName).toBe("GSI1");
    expect(input.ExpressionAttributeValues?.[":pk"]).toBe("UNIT#ABC-123");
  });

  it("queryByBranch hits GSI2 with BRANCH# prefix", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    await queryByBranch("MTY");
    const input = ddbMock.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(input.IndexName).toBe("GSI2");
    expect(input.ExpressionAttributeValues?.[":pk"]).toBe("BRANCH#MTY");
  });
});
