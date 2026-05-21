import { defineStorage } from "@aws-amplify/backend";

/**
 * S3 bucket para fotos del flotilla por tenant.
 * Path convention: photos/{tenantId}/{unitUid}/{filename}
 *
 * Auth: usuarios autenticados leen/escriben/borran su carpeta de tenant.
 * Group 'admin' tiene acceso cross-tenant.
 *
 * Las URLs firmadas se generan vía Amplify Storage client SDK desde el front.
 */
export const storage = defineStorage({
  name: "gpa-fleet-photos",
  access: (allow) => ({
    "photos/{tenantId}/*": [
      allow.authenticated.to(["read", "write", "delete"]),
      allow.groups(["admin"]).to(["read", "write", "delete"]),
    ],
  }),
});
