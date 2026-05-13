import { DynamoDBClient, ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const TABLE = process.env.APP_TABLE!;

export type EntityType = "UNIT" | "TALLER" | "NOTA" | "CHECKLIST" | "PERIODO" | "SEMANAL";

export interface BaseItem {
  PK: string;
  SK: string;
  type: EntityType;
  id: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK?: string;
  GSI2SK?: string;
}

export const keys = {
  pk: (tenantId: string): string => `TENANT#${tenantId}`,
  sk: (isoDate: string, type: EntityType, id: string): string => `${isoDate}#${type}#${id}`,
  gsi1: (plate: string, isoDate: string): { GSI1PK: string; GSI1SK: string } => ({
    GSI1PK: `UNIT#${plate}`,
    GSI1SK: isoDate,
  }),
  gsi2: (sucursal: string, isoDate: string): { GSI2PK: string; GSI2SK: string } => ({
    GSI2PK: `BRANCH#${sucursal}`,
    GSI2SK: isoDate,
  }),
};

/**
 * Create with conditional write — fails if PK+SK already exist (dedup).
 * Returns false when item already existed (caller should return 409 or 200-no-change).
 */
export async function createIfAbsent<T extends BaseItem>(item: T): Promise<boolean> {
  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: item,
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return false;
    }
    throw err;
  }
}

/**
 * Optimistic-lock update. Caller passes the version they read; we increment.
 * Returns null when version mismatch (caller should return 409 or refetch).
 */
export async function updateWithVersion<T extends Record<string, unknown>>(
  PK: string,
  SK: string,
  expectedVersion: number,
  patch: T,
): Promise<BaseItem | null> {
  const sets: string[] = ["#v = :nextV", "#u = :u"];
  const names: Record<string, string> = { "#v": "version", "#u": "updatedAt" };
  const values: Record<string, unknown> = {
    ":nextV": expectedVersion + 1,
    ":expectedV": expectedVersion,
    ":u": new Date().toISOString(),
  };
  for (const [k, v] of Object.entries(patch)) {
    if (k === "PK" || k === "SK" || k === "version" || k === "createdAt") continue;
    const nameKey = `#a_${k}`;
    const valKey = `:a_${k}`;
    sets.push(`${nameKey} = ${valKey}`);
    names[nameKey] = k;
    values[valKey] = v;
  }
  try {
    const out = await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK, SK },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ConditionExpression: "#v = :expectedV",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      }),
    );
    return (out.Attributes as BaseItem) ?? null;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return null;
    throw err;
  }
}

export async function getItem<T extends BaseItem>(PK: string, SK: string): Promise<T | null> {
  const out = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK, SK } }));
  return (out.Item as T) ?? null;
}

export async function deleteItem(PK: string, SK: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK, SK } }));
}

export async function queryByTenant<T extends BaseItem>(
  tenantId: string,
  opts: { type?: EntityType; limit?: number } = {},
): Promise<T[]> {
  const out = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": keys.pk(tenantId) },
      Limit: opts.limit,
    }),
  );
  const items = (out.Items as T[]) ?? [];
  return opts.type ? items.filter((i) => i.type === opts.type) : items;
}

export async function queryByUnit<T extends BaseItem>(plate: string): Promise<T[]> {
  const out = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": `UNIT#${plate}` },
    }),
  );
  return (out.Items as T[]) ?? [];
}

export async function queryByBranch<T extends BaseItem>(sucursal: string): Promise<T[]> {
  const out = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: "GSI2",
      KeyConditionExpression: "GSI2PK = :pk",
      ExpressionAttributeValues: { ":pk": `BRANCH#${sucursal}` },
    }),
  );
  return (out.Items as T[]) ?? [];
}
