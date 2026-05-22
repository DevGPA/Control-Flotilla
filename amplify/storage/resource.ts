import { defineStorage } from "@aws-amplify/backend";

/**
 * S3 bucket para fotos del flotilla.
 * Path convention: photos/{tenantId}/{filename}
 *
 * Auth: usuarios autenticados leen/escriben/borran path photos/*.
 * NOTA: Amplify Gen 2 solo soporta {entity_id} como placeholder de path; otros
 * tokens como {tenantId} se tratan literal (la IAM policy generada no los
 * expande). Por eso usamos wildcard simple `photos/*` y aplicamos isolation
 * multi-tenant a nivel de app code (cada cliente solo lista/sube a su carpeta
 * `photos/${tenantId}/`). Para strict isolation, futuro: Lambda authorizer.
 */
export const storage = defineStorage({
  name: "gpa-fleet-photos",
  access: (allow) => ({
    "photos/*": [allow.authenticated.to(["read", "write", "delete"])],
  }),
});
