import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { extractAuth, json, errorResponse, httpError } from "../lib/http.js";
import { contentHash } from "../lib/idempotency.js";

const s3 = new S3Client({});
const BUCKET = process.env.IMAGES_BUCKET!;

interface PresignRequest {
  scope: "images" | "weekly" | "manual";
  parentId: string;
  filename: string;
  contentType: string;
  contentHashHex?: string;
}

/**
 * Presigned URL endpoint. Dedup:
 *   - S3 key is `${scope}/${parentId}/${contentHash || filename}`.
 *   - Same content uploaded twice → same key → S3 versioning keeps history,
 *     but logical reference stays one. Avoid duplicate refs in DDB by storing
 *     the contentHash as the primary identifier of the photo metadata.
 */
export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = extractAuth(event);
    const path = event.requestContext.http.path;

    if (event.requestContext.http.method === "POST" && path.endsWith("/presign")) {
      const body = JSON.parse(event.body ?? "{}") as PresignRequest;
      if (!body.scope || !body.parentId || !body.filename) {
        throw httpError(400, "scope, parentId, filename required");
      }
      const safeName = body.contentHashHex
        ? `${body.contentHashHex}-${body.filename}`
        : `${contentHash({ user: auth.userId, name: body.filename })}-${body.filename}`;
      const key = `${body.scope}/${body.parentId}/${safeName}`;
      const url = await getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          ContentType: body.contentType,
        }),
        { expiresIn: 300 },
      );
      return json(200, { url, key, expiresIn: 300 });
    }

    if (event.requestContext.http.method === "GET") {
      const key = event.pathParameters?.key;
      if (!key) throw httpError(400, "key required");
      const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
        expiresIn: 300,
      });
      return json(200, { url, expiresIn: 300 });
    }

    throw httpError(405, "Method not allowed");
  } catch (err) {
    return errorResponse(err);
  }
};
