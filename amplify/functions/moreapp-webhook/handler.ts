import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

// FASE 1 — captura. Recibe el webhook de MoreApp, guarda el payload crudo en S3
// (prefix moreapp-capture/) y lo loguea a CloudWatch. GET devuelve la captura más
// reciente para inspección vía curl. No mapea nada todavía.

const s3 = new S3Client({});
const BUCKET = process.env.CAPTURE_BUCKET ?? "";
const TOKEN = process.env.WEBHOOK_TOKEN ?? "";
const PREFIX = "moreapp-capture/";

function res(status: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function streamToString(stream: unknown): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext?.http?.method ?? "POST";
  const token = event.queryStringParameters?.t ?? "";

  if (!TOKEN || token !== TOKEN) {
    return res(401, { error: "unauthorized" });
  }

  if (method === "GET") {
    // Inspección: devuelve el contenido del objeto más reciente.
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX }));
    const items = (listed.Contents ?? [])
      .filter((o) => o.Key && o.Key !== PREFIX)
      .sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0));
    if (items.length === 0) return res(200, { captures: 0, latest: null });

    const readKey = async (k: string) => {
      const o = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: k }));
      return JSON.parse(await streamToString(o.Body));
    };

    // ?key=<fullKey> → captura específica. ?all=1 → todas (cap 10). default → última.
    const wantKey = event.queryStringParameters?.key;
    const wantAll = event.queryStringParameters?.all === "1";
    const keys = items.slice(0, 20).map((o) => o.Key!);

    if (wantKey) {
      return res(200, { captures: items.length, keys, payload: await readKey(wantKey) });
    }
    if (wantAll) {
      const top = items.slice(0, 10).map((o) => o.Key!);
      const payloads = await Promise.all(top.map((k) => readKey(k)));
      return res(200, {
        captures: items.length,
        keys,
        all: top.map((k, i) => ({ key: k, payload: payloads[i] })),
      });
    }
    return res(200, {
      captures: items.length,
      latestKey: items[0]!.Key!,
      keys,
      payload: await readKey(items[0]!.Key!),
    });
  }

  // POST (webhook real de MoreApp).
  const raw =
    event.isBase64Encoded && event.body
      ? Buffer.from(event.body, "base64").toString("utf-8")
      : (event.body ?? "");

  // Loguea headers para detectar firma (X-Signature, etc.) y el body completo.
  const record = {
    receivedAt: new Date().toISOString(),
    headers: event.headers,
    bodyRaw: raw,
  };
  console.info("[moreapp-webhook] capture", JSON.stringify(record));

  const key = `${PREFIX}${Date.now()}.json`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(record, null, 2),
      ContentType: "application/json",
    }),
  );

  return res(200, { ok: true, stored: key });
};
